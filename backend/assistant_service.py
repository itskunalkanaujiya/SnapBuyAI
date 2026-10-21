"""
The shopping assistant: a chat about the results on screen.

The customer asks things like "which one is the best value?" or "koi
achhi rating wala sasta option?" and a Groq model answers from the listings
they're looking at (name, price, store, rating, reviews), points at the
listings it recommends, and can suggest a new search when they want
something else.
"""

import json
import re

import requests

from llm_query_parser import chat_json

MAX_PRODUCTS = 20
MAX_MESSAGES = 12  # the most recent turns sent to the model
MAX_MESSAGE_LENGTH = 500
MAX_PICKS = 3
TIMEOUT_SECONDS = 15

SYSTEM_PROMPT = """You are SnapBuy's shopping assistant for customers in India.
The customer is looking at the numbered product listings below{search}. Help them choose.

Listings:
{listings}

Return JSON only:
{{
  "reply": your answer, friendly and under 80 words, plain text without markdown,
  "picks": up to 3 listing numbers you recommend for this question, best first, or [],
  "search": a short new shopping search (2-8 words) if they want something these listings don't cover, else null
}}

Rules:
- Use only the facts in the listings. Never invent specs, discounts or delivery times; if something isn't listed, say so and suggest checking the store.
- Refer to listings by store and price, e.g. "the ₹1,299 one on Myntra", not by number.
- Weigh price against rating and number of reviews; a 4.5 rating from 3 reviews means little.
- Answer in the customer's language: English, Hindi or Hinglish.
- Stay on shopping. Politely decline anything else."""


class AssistantError(Exception):
    """The assistant couldn't answer; the message is safe to show users."""

    user_facing = True
    status_code = 502


class AssistantInputError(AssistantError):
    """The request can't be answered as sent."""

    status_code = 400


def _clean(text, limit):
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _number(value):
    if isinstance(value, str):
        value = re.sub(r"[^0-9.]", "", value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def describe_listing(position, product):
    """One line per listing, e.g. '3. Puma sneakers | ₹2,499 | Myntra | 4.3★ (812 reviews)'."""
    parts = [_clean(product.get("name"), 120) or "Unnamed product"]
    price = _number(product.get("price"))
    parts.append(f"₹{price:,.0f}" if price else "price not listed")
    if product.get("marketplace"):
        parts.append(_clean(product["marketplace"], 40))
    rating = _number(product.get("rating"))
    if rating:
        reviews = _number(product.get("reviews"))
        parts.append(f"{rating:.1f}★" + (f" ({reviews:,.0f} reviews)" if reviews else ""))
    if product.get("condition"):
        parts.append(_clean(product["condition"], 20))
    return f"{position}. " + " | ".join(parts)


def clean_messages(messages):
    """The conversation as model messages; ends with the customer's turn."""
    cleaned = []
    for message in (messages or [])[-MAX_MESSAGES:]:
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
            continue
        content = _clean(message.get("content"), MAX_MESSAGE_LENGTH)
        if content:
            cleaned.append({"role": message["role"], "content": content})
    if not cleaned or cleaned[-1]["role"] != "user":
        raise AssistantInputError("Ask a question about these products.")
    return cleaned


def ask_assistant(messages, products, search_query=""):
    """
    Answer the customer's latest message about the products shown.

    Returns {"reply", "picks": [indexes into products], "search": str|None}.
    Raises AssistantError with a user-facing message.
    """
    conversation = clean_messages(messages)
    products = [product for product in (products or []) if isinstance(product, dict)][:MAX_PRODUCTS]
    if not products:
        raise AssistantInputError("Search for something first, then ask about the results.")

    listings = "\n".join(describe_listing(position, product) for position, product in enumerate(products, 1))
    search = _clean(search_query, 100)
    system = SYSTEM_PROMPT.format(
        listings=listings,
        search=f' (they searched for "{search}")' if search else "",
    )

    try:
        data = chat_json(
            [{"role": "system", "content": system}, *conversation],
            max_tokens=500,
            timeout=TIMEOUT_SECONDS,
            temperature=0.3,
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise AssistantError("The assistant is busy right now. Please try again in a minute.")
        print(f"Assistant model error: {exc}")
        raise AssistantError("The assistant couldn't answer. Please try again.")
    except (requests.RequestException, RuntimeError, ValueError, KeyError, IndexError, TypeError,
            json.JSONDecodeError) as exc:
        print(f"Assistant model failed: {exc}")
        raise AssistantError("The assistant couldn't answer. Please try again.")

    reply = _clean(data.get("reply"), 800)
    if not reply:
        raise AssistantError("The assistant couldn't answer. Please try again.")

    picks = []
    for value in data.get("picks") or []:
        try:
            index = int(value) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(products) and index not in picks:
            picks.append(index)
        if len(picks) == MAX_PICKS:
            break

    new_search = _clean(data.get("search"), 80) or None
    return {"reply": reply, "picks": picks, "search": new_search}


# --------------------------------------------------
# Compare products side by side
# --------------------------------------------------

MIN_COMPARE = 2
MAX_COMPARE = 3
MAX_ATTRIBUTES = 6

COMPARE_PROMPT = """You compare products for a shopper in India.{search}

Products:
{listings}

Return JSON only:
{{
  "attributes": up to 6 features that differ or matter for this kind of product, read from the product names, each {{"name": short label, e.g. "RAM", "Material", "Display", "Strap", "values": one short value per product in the same order, "not listed" when the name doesn't say}},
  "pros": for each product in order, 1 or 2 short phrases on its strongest points,
  "best": the number of the product you recommend overall, or null if they are too close to call,
  "verdict": two sentences under 45 words: which to buy and why, and when the other is the better choice
}}
Rules:
- Use only facts from the names, prices, stores, ratings and review counts. Never invent specs.
- Don't repeat price, store or rating as attributes; those are shown already.
- Weigh price against rating and number of reviews; a 4.5 rating from 3 reviews means little.
- Refer to products by brand or store and price, e.g. "the ₹1,299 Puma", not by number."""


def compare_products(products, search_query=""):
    """
    Compare 2-3 listings: {"attributes": [{"name", "values"}], "pros":
    [[...], ...], "best": index or None, "verdict"}. Raises AssistantError.
    """
    products = [product for product in (products or []) if isinstance(product, dict)]
    if not MIN_COMPARE <= len(products) <= MAX_COMPARE:
        raise AssistantInputError(f"Pick {MIN_COMPARE} or {MAX_COMPARE} products to compare.")

    listings = "\n".join(describe_listing(position, product) for position, product in enumerate(products, 1))
    search = _clean(search_query, 100)
    prompt = COMPARE_PROMPT.format(
        listings=listings,
        search=f' They searched for "{search}".' if search else "",
    )
    try:
        data = chat_json(
            [{"role": "user", "content": prompt}],
            max_tokens=700,
            timeout=TIMEOUT_SECONDS,
            temperature=0.2,
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise AssistantError("The assistant is busy right now. Please try again in a minute.")
        print(f"Compare model error: {exc}")
        raise AssistantError("Couldn't compare these products. Please try again.")
    except (requests.RequestException, RuntimeError, ValueError, KeyError, IndexError, TypeError,
            json.JSONDecodeError) as exc:
        print(f"Compare model failed: {exc}")
        raise AssistantError("Couldn't compare these products. Please try again.")

    count = len(products)
    attributes = []
    for raw in data.get("attributes") or []:
        if not isinstance(raw, dict):
            continue
        name = _clean(raw.get("name"), 30)
        values = raw.get("values") if isinstance(raw.get("values"), list) else []
        values = [_clean(str(value), 60) or "not listed" for value in values[:count]]
        if not name or len(values) != count or all(v.lower() == "not listed" for v in values):
            continue
        attributes.append({"name": name, "values": values})
        if len(attributes) == MAX_ATTRIBUTES:
            break

    raw_pros = data.get("pros") if isinstance(data.get("pros"), list) else []
    pros = []
    for index in range(count):
        entry = raw_pros[index] if index < len(raw_pros) else []
        phrases = entry if isinstance(entry, list) else [entry]
        pros.append([text for text in (_clean(p, 80) for p in phrases[:2] if isinstance(p, str)) if text])

    best = None
    try:
        if data.get("best") is not None:
            index = int(data["best"]) - 1
            best = index if 0 <= index < count else None
    except (TypeError, ValueError):
        best = None

    verdict = _clean(data.get("verdict"), 400)
    if not verdict:
        raise AssistantError("Couldn't compare these products. Please try again.")
    return {"attributes": attributes, "pros": pros, "best": best, "verdict": verdict}
