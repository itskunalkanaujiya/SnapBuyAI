"""
Budget look planner: "wedding outfit for men under ₹5,000" becomes a whole
look that fits the budget.

A language model on Groq plans the pieces for the occasion and splits the
budget between them; each piece is searched in parallel and its listings are
checked by the listing judge within that piece's share. Then one listing is
picked per piece so the total stays within the budget: the best-ranked
listing within each piece's share, and while the total is over budget, the
piece costing most above its cheapest option steps down to a cheaper one.
"""

import re

import requests

from llm_query_parser import chat_json, llm_available
from outfit_service import GENDERS, OutfitError, _clean, _emitter, shop_items
from query_understanding import parse_query

MIN_ITEMS = 2
MAX_ITEMS = 6
MIN_BUDGET = 300
MAX_BUDGET = 500000
PLAN_TIMEOUT_SECONDS = 12
# Each piece's listings are searched between these shares of its budget.
LOW_SHARE = 0.3
HIGH_SHARE = 1.15

PLAN_PROMPT = """You are a stylist for an Indian shopping app who plans complete looks on a budget.

Request: {request}
Total budget: ₹{budget:,.0f} for everything
For: {gender}

Return JSON only:
{{
  "title": a short name for the look, e.g. "Wedding guest look",
  "gender": "men" | "women" | "boys" | "girls" | "kids" | "unisex",
  "items": [
    {{
      "type": the common shopping name of the piece, e.g. "kurta set", "mojaris", "stole",
      "description": a 4-9 word shopping search: colour, fabric, style, then the piece, e.g. "maroon silk blend kurta pyjama set",
      "reason": under 14 words on why it suits the occasion,
      "budget": rupees for this piece
    }}
  ]
}}
Rules:
- 3 to 5 pieces that together make the complete look for this occasion, most important first (the main garment first).
- Only things worn or carried as part of the look: clothes, footwear, and visible accessories such as a watch, stole, jewellery, belt, sunglasses or bag. No wallets, perfume or gadgets unless asked.
- Colours of the pieces must go together; suit Indian occasions and prices.
- The budgets must add up to no more than ₹{budget:,.0f}; give the main garment the biggest share, and realistic prices for India.
- Each piece is a different item. No brands unless asked."""


class PlanError(OutfitError):
    """The look couldn't be planned; the message is safe to show users."""


def read_budget(request, budget=None):
    """The budget in rupees: the given number, else read from the request ("under 5k")."""
    if budget:
        value = float(budget)
    else:
        value = parse_query(request or "").max_price
    if not value:
        raise PlanError("Add a budget, for example \"under ₹5,000\".")
    if value < MIN_BUDGET:
        raise PlanError(f"The budget is too small to plan a look; try at least ₹{MIN_BUDGET}.")
    return min(float(value), MAX_BUDGET)


def ask_planner(request, budget, gender):
    """The model's plan as a dict. Raises PlanError with a user-facing message."""
    if not llm_available():
        raise PlanError("The look planner isn't set up on this server yet.")
    prompt = PLAN_PROMPT.format(request=request, budget=budget, gender=gender or "not stated")
    try:
        return chat_json(
            [{"role": "user", "content": prompt}],
            max_tokens=900,
            timeout=PLAN_TIMEOUT_SECONDS,
            temperature=0.3,
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise PlanError("The look planner is busy right now. Please try again in a minute.")
        print(f"Planner model error: {exc}")
        raise PlanError("Couldn't plan this look. Please try again.")
    except Exception as exc:
        print(f"Planner model failed: {exc}")
        raise PlanError("Couldn't plan this look. Please try again.")


def _amount(value):
    if isinstance(value, str):
        value = re.sub(r"[^0-9.]", "", value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def read_plan(answer, budget, gender=None):
    """
    The plan as {"title", "gender", "items"}, each piece with its "budget"
    and a "price_range" around it. Shares are scaled down when the model's
    add up to more than the budget, and filled in evenly when missing.
    """
    items, types = [], set()
    for raw in answer.get("items") or []:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), 30).lower()
        description = _clean(raw.get("description"), 90)
        if not item_type or not description or item_type in types:
            continue
        types.add(item_type)
        items.append({
            "id": f"plan-{len(items) + 1}",
            "type": item_type,
            "description": description,
            "reason": _clean(raw.get("reason"), 120),
            "budget": _amount(raw.get("budget")),
            "box": None,
        })
        if len(items) == MAX_ITEMS:
            break
    if len(items) < MIN_ITEMS:
        raise PlanError("Couldn't plan a look for this. Try describing the occasion, e.g. \"office party look for women\".")

    missing = [item for item in items if not item["budget"]]
    planned = sum(item["budget"] for item in items if item["budget"])
    if missing:
        spare = max(budget - planned, budget * 0.1)
        for item in missing:
            item["budget"] = spare / len(missing)
    total = sum(item["budget"] for item in items)
    scale = min(1.0, budget / total)
    for item in items:
        share = round(item["budget"] * scale)
        item["budget"] = share
        item["price_range"] = [round(share * LOW_SHARE), round(share * HIGH_SHARE)]

    model_gender = _clean(answer.get("gender"), 10).lower()
    chosen = gender if gender in GENDERS else model_gender
    return {
        "title": _clean(answer.get("title"), 60) or "Your look",
        "gender": chosen if chosen in GENDERS else "unisex",
        "items": items,
    }


def _price(product):
    price = product.get("price")
    return price if isinstance(price, (int, float)) and price > 0 else None


def _options(item):
    """An item's priced listings in ranked order, without repeats."""
    seen, options = set(), []
    for product in (item.get("best_matches") or []) + (item.get("cheapest_alternatives") or []):
        key = product.get("product_url") or product.get("name")
        if key in seen or _price(product) is None:
            continue
        seen.add(key)
        options.append(product)
    return options


def choose_picks(items, budget):
    """
    One listing per piece, keeping the total within budget where possible.
    Returns ({item id: product key}, total).
    """
    chosen = {}
    for item in items:
        options = _options(item)
        if not options:
            continue
        within = [p for p in options if _price(p) <= item["budget"] * 1.1]
        chosen[item["id"]] = (within or sorted(options, key=_price))[0]

    def total():
        return sum(_price(product) for product in chosen.values())

    while total() > budget:
        # Step down the piece with the most to save, to its next cheaper option.
        best_step = None
        for item in items:
            current = chosen.get(item["id"])
            if current is None:
                continue
            cheaper = sorted(
                (p for p in _options(item) if _price(p) < _price(current)),
                key=_price,
                reverse=True,
            )
            if cheaper:
                saving = _price(current) - min(_price(p) for p in cheaper)
                if best_step is None or saving > best_step[0]:
                    best_step = (saving, item["id"], cheaper[0])
        if best_step is None:
            break  # every piece is already at its cheapest
        chosen[best_step[1]] = best_step[2]

    picks = {item_id: product.get("product_url") or product.get("name") for item_id, product in chosen.items()}
    return picks, round(total())


def plan_look(request, budget=None, gender=None, on_event=None):
    """
    Plan a look within budget and shop it. Emits "plan" (title, budget,
    gender), "items", one "item" per piece, then returns {"title", "budget",
    "gender", "items", "picks", "total"}.
    """
    request = _clean(request, 200)
    if len(request) < 3:
        raise PlanError("Describe the look you want, e.g. \"wedding outfit for men under ₹5,000\".")
    budget = read_budget(request, budget)
    plan = read_plan(ask_planner(request, budget, gender), budget, gender)

    emit = _emitter(on_event)
    emit("plan", {"title": plan["title"], "budget": budget, "gender": plan["gender"]})
    result = shop_items(plan["items"], plan["gender"], emit, judge=True)
    picks, total = choose_picks(result["items"], budget)
    return {
        **result,
        "title": plan["title"],
        "budget": budget,
        "picks": picks,
        "total": total,
    }
