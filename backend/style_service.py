"""
Personal styling: rate an outfit, and find the colours that suit someone.

Rate my outfit: a vision model scores the outfit in a photo, says what
works, and suggests two or three changes; each change is a product that is
then searched like a Find the outfit item, so every tip is shoppable.

Colours that suit you: from a selfie, a vision model reads the person's
colouring (undertone, contrast) and returns a palette in plain shopping
colour words ("olive", "rust", "navy") so results can be matched against
listing titles. The selfie isn't stored; the browser keeps only the palette.

Both use the same vision models as Find the outfit (Gemini, then Groq).
"""

import re

from outfit_service import GENDERS, OutfitError, _clean, _emitter, ask_vision, shop_items

MAX_FIXES = 3
MAX_STRENGTHS = 3
MAX_BEST_COLOURS = 10
MAX_AVOID_COLOURS = 5
HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
UNDERTONES = {"warm", "cool", "neutral", "olive"}

RATE_PROMPT = """You are a friendly, honest fashion stylist for an Indian shopping app.
Rate the outfit worn by the main person in the photo for everyday style.

Return JSON only:
{
  "gender": "men" | "women" | "boys" | "girls" | "kids" | "unisex",
  "score": number from 1 to 10 with one decimal, e.g. 7.5,
  "verdict": one encouraging sentence under 20 words summing up the look,
  "occasion": what the outfit suits best in 2-4 words, e.g. "casual day out",
  "strengths": 2 or 3 short phrases on what works, e.g. "colours go well together",
  "fixes": [
    {
      "type": short category of the item to add or swap, e.g. "belt", "sneakers", "watch",
      "advice": one sentence under 18 words, e.g. "Swap the brown belt for a black one to match the shoes",
      "description": a 4-10 word shopping search for the suggested item with colour, material and style, e.g. "black leather slim belt"
    }
  ]
}
Rules:
- Judge only the clothes, accessories, colours, fit and styling. Never comment on the person's body, weight, face, skin or looks.
- Be kind and specific. 2 or 3 fixes, each a different item that would most improve the look; suggest adding accessories if nothing needs swapping.
- Every fix is a NEW item to buy, different from what they already wear: never suggest the same item again ("striped t-shirt" when they wear one). A swap names the new item, e.g. "white leather sneakers" instead of their black ones.
- Every fix must have its "advice" sentence.
- If no person or outfit is visible, return {"score": 0, "fixes": []}."""

COLOUR_PROMPT = """You are a personal colour analyst for an Indian shopping app.
From the person's natural colouring in this selfie (skin undertone, hair and eye colour, contrast between them), find the clothing colours that suit them best.

Return JSON only:
{
  "undertone": "warm" | "cool" | "neutral" | "olive",
  "season": the seasonal colour type, e.g. "Deep Autumn", "Soft Summer", "Bright Winter", "Warm Spring",
  "summary": one friendly sentence under 25 words on why these colours work, about colouring and contrast only,
  "best": 8 to 10 colours, each {"name": one or two common shopping colour words, e.g. "olive", "rust", "navy", "mustard", "emerald", "maroon", "teal", "cream", "hex": "#RRGGBB"},
  "avoid": 3 to 5 colours that are less flattering, same format
}
Rules:
- Use colour words shoppers type and that appear in product names. No poetic names.
- Talk only about colours. Never comment on attractiveness, and never suggest changing skin colour.
- Allow for the photo's lighting; if no face is clearly visible, return {"best": []}."""


def _number(value, low, high):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(min(high, max(low, number)), 1)


def _phrases(values, limit, length):
    phrases = []
    for value in values if isinstance(values, list) else []:
        text = _clean(value, length)
        if text and text not in phrases:
            phrases.append(text)
        if len(phrases) == limit:
            break
    return phrases


def read_rating(answer):
    """The model's rating as {"gender", "score", "verdict", "occasion", "strengths", "fixes"}."""
    score = _number(answer.get("score"), 0, 10)
    gender = _clean(answer.get("gender"), 10).lower()
    fixes = []
    for raw in answer.get("fixes") or []:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), 30).lower()
        description = _clean(raw.get("description"), 90)
        if not item_type or not description or any(fix["type"] == item_type for fix in fixes):
            continue
        fixes.append({
            "id": f"fix-{len(fixes) + 1}",
            "type": item_type,
            "description": description,
            "reason": _clean(raw.get("advice") or raw.get("reason") or raw.get("tip"), 140),
            "box": None,
        })
        if len(fixes) == MAX_FIXES:
            break
    return {
        "gender": gender if gender in GENDERS else "unisex",
        "score": score,
        "verdict": _clean(answer.get("verdict"), 160),
        "occasion": _clean(answer.get("occasion"), 40),
        "strengths": _phrases(answer.get("strengths"), MAX_STRENGTHS, 80),
        "fixes": fixes,
    }


def rate_outfit(image, on_event=None):
    """
    Rate the outfit in a photo and shop its suggested fixes.

    Emits "rating" (score, verdict, strengths), then "items" and one "item"
    per fix like Find the outfit. Returns {"rating", "gender", "items"}.
    """
    answer, _, _, name = ask_vision(image, RATE_PROMPT, "Rate my outfit isn't set up on this server yet.")
    rating = read_rating(answer)
    if not rating["score"]:
        raise OutfitError("Couldn't see an outfit to rate. Try a clear photo of someone, ideally full length.")

    emit = _emitter(on_event)
    public = {key: rating[key] for key in ("score", "verdict", "occasion", "strengths")}
    emit("rating", {"rating": public})
    if not rating["fixes"]:
        return {"rating": public, "gender": rating["gender"], "items": [], "model": name}
    result = shop_items(rating["fixes"], rating["gender"], emit)
    return {**result, "rating": public, "model": name}


def _colours(values, limit):
    colours = []
    for raw in values if isinstance(values, list) else []:
        if not isinstance(raw, dict):
            continue
        name = _clean(raw.get("name"), 24).lower()
        hex_value = _clean(raw.get("hex"), 7)
        if not name or not HEX_COLOUR.match(hex_value) or any(c["name"] == name for c in colours):
            continue
        colours.append({"name": name, "hex": hex_value.lower()})
        if len(colours) == limit:
            break
    return colours


def analyse_colours(image):
    """
    The colours that suit the person in a selfie: {"undertone", "season",
    "summary", "best": [{"name", "hex"}], "avoid": [...]}. Raises OutfitError.
    """
    answer, _, _, _ = ask_vision(image, COLOUR_PROMPT, "Colour analysis isn't set up on this server yet.")
    best = _colours(answer.get("best"), MAX_BEST_COLOURS)
    if len(best) < 3:
        raise OutfitError("Couldn't see a face clearly. Try a front-facing selfie in daylight, without filters.")
    undertone = _clean(answer.get("undertone"), 10).lower()
    return {
        "undertone": undertone if undertone in UNDERTONES else None,
        "season": _clean(answer.get("season"), 30),
        "summary": _clean(answer.get("summary"), 200),
        "best": best,
        "avoid": _colours(answer.get("avoid"), MAX_AVOID_COLOURS),
    }
