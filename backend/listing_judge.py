"""
Check suggested items' listings with a language model.

Rate my outfit and Complete the look suggest items that aren't in any photo
("tan leather loafers", "small gold jhumkas"), so their listings can't be
compared visually. Google's results for such a search mix in other colours,
other materials, kids' sizes, combos and ₹80,000 real-gold pieces. A text
model on Groq reads the listing titles and keeps the ones that really are
the suggested item, best first, within the suggestion's price range.

It runs on a different Groq model from the vision and query models, so it
doesn't use their per-minute token allowance. If it fails, a word match on
the item's colour and type is used instead.
"""

import os
import re

from llm_query_parser import chat_json, llm_available

JUDGE_MODELS = [
    model
    for model in (os.getenv("GROQ_JUDGE_MODEL"), "openai/gpt-oss-120b", "openai/gpt-oss-20b")
    if model
]
JUDGE_TIMEOUT_SECONDS = 8
MAX_LISTINGS = 30
MAX_MATCHES = 10
# Listings above this multiple of the suggestion's top price are left out
# (while enough others remain).
PRICE_HEADROOM = 1.5
MIN_LEFT = 4

JUDGE_PROMPT = """You check shopping search results for a stylist in India.

Suggested item: {item_type}: {description}
Why: {reason}
For: {gender}
{budget}
Listings (number. title | price | store):
{listings}

Return JSON only: {{"matches": [numbers of the listings that ARE this suggested item, best match first]}}
Keep a listing only if it is the same kind of item ({item_type}) and its colour, material and style fit the suggestion.
Leave out: a different item type, a clearly different colour, the wrong gender, kids' items for adults, combos or sets that weren't asked for, and luxury pieces (real gold, diamond, designer) far outside the price range.
At most {max_matches} numbers. Return {{"matches": []}} if none fit."""


def _price_text(product):
    price = product.get("price")
    return f"₹{price:,.0f}" if isinstance(price, (int, float)) and price > 0 else "price not listed"


def within_budget(listings, price_range):
    """Drop listings far above the suggestion's price range, keeping at least MIN_LEFT."""
    top = (price_range or [None, None])[1]
    if not top:
        return listings
    affordable = [p for p in listings if not p.get("price") or p["price"] <= PRICE_HEADROOM * top]
    return affordable if len(affordable) >= MIN_LEFT else listings


def word_match(item, listings):
    """Fallback: listings ordered by how many of the description's words their title has."""
    words = set(re.findall(r"[a-z]+", (item.get("description") or "").lower())) - {"for", "with", "and", "women", "men"}
    type_words = set(re.findall(r"[a-z]+", (item.get("type") or "").lower()))

    def score(product):
        title = set(re.findall(r"[a-z]+", (product.get("name") or "").lower()))
        return (bool(type_words & title), len(words & title))

    return sorted(listings, key=score, reverse=True)


def judge_listings(item, listings, gender="unisex"):
    """
    The listings that are the suggested item, best first (a subset of
    listings). Falls back to a word match if the model can't answer.
    """
    listings = within_budget(listings[:MAX_LISTINGS], item.get("price_range"))
    if not listings or not llm_available():
        return word_match(item, listings)

    price_range = item.get("price_range")
    budget = (
        f"Price range: about ₹{price_range[0]:,.0f} to ₹{price_range[1]:,.0f}\n"
        if price_range else ""
    )
    lines = "\n".join(
        f"{number}. {(p.get('name') or '')[:110]} | {_price_text(p)} | {(p.get('marketplace') or '')[:30]}"
        for number, p in enumerate(listings, 1)
    )
    prompt = JUDGE_PROMPT.format(
        item_type=item.get("type") or "item",
        description=item.get("description") or "",
        reason=item.get("reason") or "-",
        gender=gender,
        budget=budget,
        listings=lines,
        max_matches=MAX_MATCHES,
    )
    try:
        answer = chat_json(
            [{"role": "user", "content": prompt}],
            max_tokens=700,
            timeout=JUDGE_TIMEOUT_SECONDS,
            models=JUDGE_MODELS,
        )
    except Exception as exc:
        print(f"Listing judge failed for {item.get('description')!r}: {exc}")
        return word_match(item, listings)

    picked = []
    for value in answer.get("matches") or []:
        try:
            index = int(value) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(listings) and listings[index] not in picked:
            picked.append(listings[index])
        if len(picked) == MAX_MATCHES:
            break
    if not picked:
        # Nothing fit: better to show the closest words than nothing.
        return word_match(item, listings)[:MIN_LEFT]
    return picked
