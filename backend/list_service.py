"""
Snap your shopping list: a photo of a handwritten note, a printed list or a
chat screenshot ("Diwali list: kurta for papa, diya set, dry fruit box")
becomes one cart.

The vision model (Gemini, then Groq) reads each line, including Hindi and
Hinglish, into an English shopping search with who it's for and how many;
typed lists skip the vision step and go to a language model. Each item is
searched in parallel and checked by the listing judge, then the best listing
per item is picked and the cart total worked out.
"""

import re
import statistics

import requests

from llm_query_parser import chat_json, llm_available
from outfit_service import OutfitError, _clean, _emitter, ask_vision, shop_items
from planner_service import choose_picks

MAX_ITEMS = 10
MAX_QUANTITY = 20
TIMEOUT_SECONDS = 15
# A line without a written budget gets the best listing priced up to about
# the typical (median) price of its options, not a ₹12,000 pure-silver payal
# when the others cost ₹500.

LIST_RULES = """Return JSON only:
{
  "title": the list's name if written, else a short one, e.g. "Diwali shopping list",
  "items": [
    {
      "line": the line as written,
      "type": the common shopping name of the item in English, e.g. "kurta", "diya set",
      "description": a 3-9 word English shopping search, including who it's for when written, e.g. "men cotton kurta" for "kurta for papa",
      "quantity": number to buy (1 if not written),
      "budget": rupees if a price is written for this line, else null
    }
  ]
}
Rules:
- One entry per thing to buy, in the list's order, at most 10. Skip headings, dates, crossed-out lines and notes that aren't items.
- Lines may be Hindi, Hinglish or English: always answer in English ("papa" = men, "mummy" = women, "chhotu" or "bachche" = kids).
- Keep brands and sizes that are written.
- If there is no shopping list, return {"title": "", "items": []}."""

PHOTO_PROMPT = "Read the shopping list in this photo: a handwritten note, a printed list or a chat screenshot.\n\n" + LIST_RULES
TEXT_PROMPT = "Read this shopping list:\n\nLIST_TEXT\n\n" + LIST_RULES


class ListError(OutfitError):
    """The list couldn't be read; the message is safe to show users."""


def _number(value):
    if isinstance(value, str):
        value = re.sub(r"[^0-9.]", "", value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def read_list(answer):
    """The model's list as {"title", "items"}, each with quantity and an optional budget."""
    items = []
    for raw in answer.get("items") or []:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), 40).lower()
        description = _clean(raw.get("description"), 90)
        if not item_type or not description:
            continue
        quantity = int(min(MAX_QUANTITY, max(1, _number(raw.get("quantity")) or 1)))
        budget = _number(raw.get("budget"))
        items.append({
            "id": f"line-{len(items) + 1}",
            "type": item_type,
            "description": description,
            "line": _clean(raw.get("line"), 120),
            "reason": _clean(raw.get("line"), 120),
            "quantity": quantity,
            "budget": budget,
            "price_range": [round(budget * 0.3), round(budget * 1.15)] if budget else None,
            "box": None,
        })
        if len(items) == MAX_ITEMS:
            break
    if not items:
        raise ListError("Couldn't read a shopping list here. Try a clear, well-lit photo of the list.")
    return {"title": _clean(answer.get("title"), 60) or "Your shopping list", "items": items}


def read_typed_list(text):
    if not llm_available():
        raise ListError("Shopping lists aren't set up on this server yet.")
    try:
        return chat_json(
            [{"role": "user", "content": TEXT_PROMPT.replace("LIST_TEXT", text)}],
            max_tokens=1200,
            timeout=TIMEOUT_SECONDS,
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise ListError("The list reader is busy right now. Please try again in a minute.")
        raise ListError("Couldn't read this list. Please try again.")
    except Exception as exc:
        print(f"List model failed: {exc}")
        raise ListError("Couldn't read this list. Please try again.")


def shop_list(image=None, text=None, on_event=None):
    """
    Read a list (a photo, or typed text) and shop every line. Emits "list"
    (title), "items", one "item" per line; returns {"title", "items",
    "picks", "total"} where the total counts quantities.
    """
    if image is not None:
        answer, _, _, _ = ask_vision(image, PHOTO_PROMPT, "Shopping lists aren't set up on this server yet.")
    else:
        text = _clean(text, 2000)
        if len(text) < 3:
            raise ListError("Write or photograph a shopping list first.")
        answer = read_typed_list(text)
    shopping_list = read_list(answer)

    emit = _emitter(on_event)
    emit("list", {"title": shopping_list["title"]})
    result = shop_items(shopping_list["items"], "unisex", emit, judge=True)

    # The best listing per line, within its written budget or else around
    # the typical price of its options.
    written = {item["id"]: item["budget"] for item in result["items"]}
    for item in result["items"]:
        if not item["budget"]:
            prices = [p["price"] for p in (item.get("best_matches") or []) + (item.get("cheapest_alternatives") or [])
                      if p.get("price")]
            item["budget"] = statistics.median(prices) if prices else 0
    picks, _ = choose_picks(result["items"], float("inf"))
    total = 0
    for item in result["items"]:
        item["budget"] = written[item["id"]]
        chosen = next(
            (p for p in (item.get("best_matches") or []) + (item.get("cheapest_alternatives") or [])
             if (p.get("product_url") or p.get("name")) == picks.get(item["id"])),
            None,
        )
        if chosen and chosen.get("price"):
            total += chosen["price"] * item["quantity"]
    return {**result, "title": shopping_list["title"], "picks": picks, "total": round(total)}
