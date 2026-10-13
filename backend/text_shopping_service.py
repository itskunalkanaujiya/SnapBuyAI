"""
Text search: find products for a typed query with Google Shopping (SerpApi).

Returns the same sections as the photo search ("best_matches" and
"cheapest_alternatives") so the frontend can show both the same way.
"""

import os
import re

import requests

from image_shopping_service import (
    QUERY_STOPWORDS,
    SERPAPI_URL,
    extract_price,
    get_domain,
    parse_numeric_price,
    format_price_text,
)

# Listings in Lowest Prices must share at least this share of the query's
# words, so cheap accessories ("strap for ...") don't crowd out the product.
MIN_QUERY_OVERLAP = 0.5


def query_words(text):
    return {
        word
        for word in re.findall(r"[a-z0-9]+", (text or "").lower())
        if len(word) > 1 and word not in QUERY_STOPWORDS
    }


def query_overlap(title, query):
    """Share of the query's meaningful words that appear in a title."""
    wanted = query_words(query)
    if not wanted:
        return 1.0
    return len(wanted & query_words(title)) / len(wanted)


def run_google_shopping(query: str) -> list[dict]:
    """Search Google Shopping in India and return the raw shopping results."""
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        raise RuntimeError("SERPAPI_API_KEY is missing from backend/.env")

    response = requests.get(
        SERPAPI_URL,
        params={
            "engine": "google_shopping",
            "q": query,
            "gl": "in",
            "hl": "en",
            "api_key": api_key,
        },
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()

    error = data.get("error")
    if error:
        # SerpApi reports an empty result as an error message.
        if "hasn't returned any results" in error:
            return []
        raise RuntimeError(error)

    results = data.get("shopping_results", [])
    return results if isinstance(results, list) else []


def build_shopping_product(item, query):
    """Convert a Google Shopping result into the frontend product format."""
    price_info = extract_price(item)
    if price_info["currency"] is None and price_info["price"] is not None:
        # gl=in returns rupee prices; label bare numbers as INR.
        price_info["currency"] = "INR"
        price_info["price_text"] = format_price_text(price_info["price"], "INR")

    original = parse_numeric_price(item.get("extracted_old_price"))
    if original is None:
        original = parse_numeric_price(item.get("old_price"))
    if original is not None and (price_info["price"] is None or original <= price_info["price"]):
        original = None

    url = item.get("link") or item.get("product_link")

    return {
        "pending": False,
        "result_type": "shopping",
        "name": item.get("title") or "Unknown product",
        "price": price_info["price"],
        "price_text": price_info["price_text"],
        "currency": price_info["currency"],
        "original_price": original,
        "original_price_text": (
            format_price_text(original, price_info["currency"] or "INR")
            if original is not None
            else None
        ),
        # Google Shopping does not report stock.
        "availability": "unknown",
        "marketplace": item.get("source") or get_domain(url) or "Online store",
        "multiple_sources": bool(item.get("multiple_sources")),
        "product_url": url,
        "image_url": item.get("thumbnail") or item.get("serpapi_thumbnail"),
        "source_icon": item.get("source_icon"),
        "rating": item.get("rating"),
        "reviews": item.get("reviews"),
        "visual_similarity_score": None,
        "text_relevance_score": round(query_overlap(item.get("title"), query), 4),
        "match_type": "Google Shopping result",
    }


def search_products_by_text(query: str, max_results: int = 10) -> dict:
    """
    Search Google Shopping for a typed query.

    Top results keep Google's relevance order; Lowest Prices are the cheapest
    remaining listings that still match the query's words.
    """
    if not 1 <= max_results <= 40:
        raise ValueError("max_results must be between 1 and 40.")

    query = (query or "").strip()
    if not query:
        raise ValueError("Search query cannot be empty.")

    results = run_google_shopping(query)

    products = []
    seen = set()
    for item in results:
        if not isinstance(item, dict):
            continue
        product = build_shopping_product(item, query)

        # Skip sponsored blocks and listings without a price or link.
        if product["price"] is None or not product["product_url"]:
            continue
        if product["currency"] != "INR":
            continue

        key = (product["name"].strip().lower(), product["marketplace"].lower())
        if key in seen:
            continue
        seen.add(key)
        products.append(product)

    best_matches = products[:max_results]
    best_urls = {product["product_url"] for product in best_matches}

    cheapest_alternatives = sorted(
        (
            product
            for product in products
            if product["product_url"] not in best_urls
            and product["text_relevance_score"] >= MIN_QUERY_OVERLAP
        ),
        key=lambda product: product["price"],
    )[:max_results]

    print(
        f"Google Shopping: {len(results)} results, {len(products)} kept "
        f"for {query!r}."
    )

    return {
        "best_matches": best_matches,
        "cheapest_alternatives": cheapest_alternatives,
        "online_count": len(best_matches) + len(cheapest_alternatives),
        "online_search_query": query,
    }
