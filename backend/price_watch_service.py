"""
Price watch: re-check the current price of products people are watching.

The browser keeps the watch list (no account or database) and asks for a
re-check when the app opens. Each product's price is read, in order:

1. from its store page, when the link is a store page that shows a price
   (the same reader the photo search uses, including the MRP);
2. from Google Shopping (Serper): the same store's listing whose title
   matches the product's name.

A product whose price can't be found is reported as "unknown", never as a
drop.
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from image_shopping_service import (
    extract_price,
    fetch_page_details,
    store_key,
    title_words,
)

MAX_ITEMS = 20
WORKERS = 8
SEARCH_WORDS = 8  # the first words of the name make the Google Shopping search
GOOGLE_HOSTS = ("google.", "googleadservices.")
# A store often lists near-identical products ("Boldfit gym towel" in three
# sizes), so a Google Shopping listing must match the name closely, and
# among equally close ones the price nearest the last one seen is taken.
TITLE_MATCH = 0.75
TIE_MARGIN = 0.05
# A price that moved more than this share is likely another product's.
MAX_CHANGE = 0.6


class PriceWatchError(Exception):
    """The request can't be checked; the message is safe to show users."""

    user_facing = True


def is_store_page(url):
    """True for a link to a store's own page (not a Google Shopping page)."""
    try:
        host = urlparse(url or "").hostname or ""
    except ValueError:
        return False
    return bool(host) and not any(part in host for part in GOOGLE_HOSTS)


def search_text(name):
    words = re.findall(r"[A-Za-z0-9]+", name or "")
    return " ".join(words[:SEARCH_WORDS])


def price_from_store_page(item):
    """The store page's price, or None."""
    if not is_store_page(item.get("product_url")):
        return None
    details = fetch_page_details(item["product_url"])
    if details.get("price") is None:
        return None
    return {
        "price": details["price"],
        "original_price": details.get("original_price"),
        "availability": details.get("availability"),
        "source": "store page",
    }


def price_from_shopping(item):
    """The same store's Google Shopping price for a matching title, or None."""
    if not os.getenv("SERPER_API_KEY"):
        return None
    store = store_key(item.get("marketplace"))
    words = title_words(item.get("name"))
    query = search_text(item.get("name"))
    if not store or not words or not query:
        return None
    from text_shopping_service import run_serper_shopping  # avoids a circular import

    matches = []
    for entry in run_serper_shopping(query):
        if store_key(entry.get("source")) != store:
            continue
        price = extract_price(entry)["price"]
        offer_words = title_words(entry.get("title"))
        if price is None or not offer_words:
            continue
        overlap = len(words & offer_words) / max(len(words), len(offer_words))
        if overlap >= TITLE_MATCH:
            matches.append((overlap, price))
    if not matches:
        return None
    best_overlap = max(overlap for overlap, _ in matches)
    close = [price for overlap, price in matches if overlap >= best_overlap - TIE_MARGIN]
    previous = item.get("price")
    if isinstance(previous, (int, float)) and previous > 0:
        price = min(close, key=lambda value: abs(value - previous))
    else:
        price = close[0]
    return {"price": price, "original_price": None, "availability": None, "source": "Google Shopping"}


def check_item(item):
    """{"id", "price", "original_price", "availability", "source", "status"} for one product."""
    result = {"id": item.get("id"), "price": None, "original_price": None, "availability": None, "source": None}
    try:
        found = price_from_store_page(item) or price_from_shopping(item)
    except Exception as exc:
        print(f"Price check failed for {item.get('name')!r}: {exc}")
        found = None
    if not found:
        return {**result, "status": "unknown"}

    previous = item.get("price")
    if isinstance(previous, (int, float)) and previous > 0 and abs(found["price"] - previous) > MAX_CHANGE * previous:
        # Probably a different product (another size or pack) — don't alert.
        return {**result, "status": "unknown"}
    result.update(found)
    if isinstance(previous, (int, float)) and previous > 0:
        if found["price"] < previous:
            result["status"] = "down"
        elif found["price"] > previous:
            result["status"] = "up"
        else:
            result["status"] = "same"
    else:
        result["status"] = "same"
    return result


def check_prices(items):
    """
    Re-check up to MAX_ITEMS watched products in parallel. items: [{"id",
    "name", "product_url", "marketplace", "price"}] where price is the last
    price seen. Returns the results in the same order.
    """
    items = [item for item in (items or []) if isinstance(item, dict) and item.get("id")]
    if not items:
        raise PriceWatchError("Nothing to check: watch a product first.")
    items = items[:MAX_ITEMS]
    with ThreadPoolExecutor(max_workers=min(WORKERS, len(items))) as pool:
        return list(pool.map(check_item, items))
