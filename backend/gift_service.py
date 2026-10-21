"""
Gift finder: "bhai ke liye, gym ka shauk hai, 2000 tak" becomes six gift
ideas with real listings.

A Groq language model reads who the gift is for, what they like, the
occasion and the budget (English, Hindi or Hinglish) and suggests six
varied ideas, each with a reason; each idea is searched in parallel and its
listings are checked by the listing judge, keeping gifts within budget.
"""

import requests

from llm_query_parser import chat_json, llm_available
from outfit_service import GENDERS, OutfitError, _clean, _emitter, shop_items
from query_understanding import parse_query

MAX_IDEAS = 6
MIN_IDEAS = 3
TIMEOUT_SECONDS = 12
# A gift may cost a little over the budget, never far over it.
OVER_BUDGET = 1.1

GIFT_PROMPT = """You are a thoughtful gift advisor for an Indian shopping app.

Request: {request}
Budget per gift: {budget}

Return JSON only:
{{
  "title": a short heading, e.g. "Gifts for your gym-loving brother",
  "recipient": who the gift is for in 1-3 words, e.g. "brother", "mom", "colleague",
  "gender": "men" | "women" | "boys" | "girls" | "kids" | "unisex",
  "ideas": [
    {{
      "type": the common shopping name of the gift, e.g. "smart fitness band", "insulated shaker bottle",
      "description": a 4-9 word shopping search for it, e.g. "stainless steel insulated gym shaker bottle",
      "reason": under 14 words on why this person would love it,
      "price": typical price in rupees
    }}
  ]
}}
Rules:
- 6 ideas across different kinds of gift (something useful, something fun, something personal); no two of the same type.
- Fit the person's interests, age and the occasion when given; understand Hindi and Hinglish ("bhai" = brother, "didi" = elder sister, "mummy" = mom).
- Every idea must be buyable online in India and cost no more than the budget; typical prices, not luxury.
- No gift cards, cash, experiences or subscriptions."""


class GiftError(OutfitError):
    """Gift ideas couldn't be found; the message is safe to show users."""


def read_budget(request, budget=None):
    """The budget in rupees (given, or read from the request), or None."""
    if budget:
        return float(budget)
    return parse_query(request or "").max_price


def ask_gift_model(request, budget):
    if not llm_available():
        raise GiftError("The gift finder isn't set up on this server yet.")
    prompt = GIFT_PROMPT.format(
        request=request,
        budget=f"up to ₹{budget:,.0f}" if budget else "not given; suggest typical gift prices",
    )
    try:
        return chat_json(
            [{"role": "user", "content": prompt}],
            max_tokens=1000,
            timeout=TIMEOUT_SECONDS,
            temperature=0.5,
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise GiftError("The gift finder is busy right now. Please try again in a minute.")
        print(f"Gift model error: {exc}")
        raise GiftError("Couldn't find gift ideas. Please try again.")
    except Exception as exc:
        print(f"Gift model failed: {exc}")
        raise GiftError("Couldn't find gift ideas. Please try again.")


def _amount(value):
    try:
        number = float(str(value).replace(",", "").replace("₹", ""))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def read_ideas(answer, budget):
    """The model's ideas as {"title", "recipient", "gender", "items"}."""
    items, types = [], set()
    for raw in answer.get("ideas") or []:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), 40).lower()
        description = _clean(raw.get("description"), 90)
        if not item_type or not description or item_type in types:
            continue
        types.add(item_type)
        price = _amount(raw.get("price"))
        if budget:
            price = min(price or budget, budget)
        top = budget or (price * 1.6 if price else None)
        items.append({
            "id": f"gift-{len(items) + 1}",
            "type": item_type,
            "description": description,
            "reason": _clean(raw.get("reason"), 120),
            "price_range": [round((price or top) * 0.3), round(top)] if top else None,
            "box": None,
        })
        if len(items) == MAX_IDEAS:
            break
    if len(items) < MIN_IDEAS:
        raise GiftError("Couldn't find gift ideas for this. Try saying who it's for and what they like.")
    gender = _clean(answer.get("gender"), 10).lower()
    return {
        "title": _clean(answer.get("title"), 70) or "Gift ideas",
        "recipient": _clean(answer.get("recipient"), 30),
        "gender": gender if gender in GENDERS else "unisex",
        "items": items,
    }


def keep_within_budget(items, budget):
    """Drop listings priced well over the budget (while an idea keeps some)."""
    if not budget:
        return
    limit = budget * OVER_BUDGET
    for item in items:
        for section in ("best_matches", "cheapest_alternatives"):
            listings = item.get(section) or []
            affordable = [p for p in listings if not p.get("price") or p["price"] <= limit]
            item[section] = affordable


def find_gifts(request, budget=None, on_event=None):
    """
    Suggest six gifts and shop each. Emits "gifts" (title, recipient,
    budget), "items", one "item" per idea; returns {"title", "recipient",
    "budget", "gender", "items"}.
    """
    request = _clean(request, 200)
    if len(request) < 3:
        raise GiftError("Say who the gift is for, e.g. \"brother who loves the gym, under ₹2,000\".")
    budget = read_budget(request, budget)
    gifts = read_ideas(ask_gift_model(request, budget), budget)

    emit = _emitter(on_event)
    emit("gifts", {"title": gifts["title"], "recipient": gifts["recipient"], "budget": budget})
    result = shop_items(gifts["items"], gifts["gender"], emit, judge=True)
    keep_within_budget(result["items"], budget)
    return {**result, "title": gifts["title"], "recipient": gifts["recipient"], "budget": budget}
