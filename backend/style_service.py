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

from outfit_service import GENDERS, OutfitError, _clean, _emitter, ask_vision, price_range, shop_items

MAX_FIXES = 3
MAX_STRENGTHS = 3
MAX_BEST_COLOURS = 10
MAX_AVOID_COLOURS = 5
HEX_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
UNDERTONES = {"warm", "cool", "neutral", "olive"}

RATE_PROMPT = """You are an expert, friendly fashion stylist for an Indian shopping app.
Rate the outfit worn by the main person in the photo.

First look closely at what they are wearing, then score it honestly against this rubric (1-10 each, one decimal):
- colours: how well the colours and patterns work together
- fit: fit and proportions of the garments (how they sit, lengths, silhouette), never the body itself
- styling: footwear, accessories and finishing touches
- occasion: how well the outfit suits the setting it looks meant for
Use the whole scale: 5 is ordinary, 7 is good, 9+ is rare and exceptional. Different outfits should get different scores.

Return JSON only:
{
  "gender": "men" | "women" | "boys" | "girls" | "kids" | "unisex",
  "wearing": the items you can see with colour, e.g. ["yellow-blue striped t-shirt", "dark blue jeans", "black sneakers"],
  "scores": {"colours": number, "fit": number, "styling": number, "occasion": number},
  "verdict": one specific, encouraging sentence under 22 words about THIS outfit,
  "occasion": what the outfit suits best in 2-4 words, e.g. "casual day out",
  "strengths": 2 or 3 short, specific phrases on what works, naming the items, e.g. "navy stripes pick up the jeans",
  "fixes": [
    {
      "type": the common shopping name of the item to add or swap, e.g. "belt", "sneakers", "watch", "jhumka earrings",
      "advice": one sentence under 20 words that names what they wear now and why the change helps, e.g. "Swap the black sneakers for white ones so the yellow tee stands out",
      "description": a 4-9 word shopping search for exactly that item: colour, material, style, then the item, e.g. "white leather low-top sneakers",
      "price_range": [lowest, highest] sensible price in rupees for this item at the same price level as the outfit, e.g. [800, 2500]
    }
  ]
}
Rules:
- Judge only the clothes, accessories, colours, fit and styling. Never comment on the person's body, weight, face, skin or looks.
- 2 or 3 fixes, each a different item, chosen to raise the weakest scores. Suggest accessories if nothing needs swapping.
- Every fix is a NEW item to buy, not something they already wear. A swap names the new item ("white leather sneakers" instead of their black ones).
- "type", "advice" and "description" must all be about the same item.
- Match the outfit's style and price level: everyday clothes get everyday prices, not designer or real gold.
PALETTE_RULE- If no person or outfit is visible, return {"scores": {}, "fixes": []}."""

PALETTE_RULE = "- Their best colours are {colours}: when a fix has a colour choice, prefer one of these.\n"
SCORE_AREAS = ("colours", "fit", "styling", "occasion")

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
    """
    The model's rating as {"gender", "score", "scores", "wearing", "verdict",
    "occasion", "strengths", "fixes"}. The score is the mean of the rubric
    scores, which is steadier than asking for one number.
    """
    raw_scores = answer.get("scores") if isinstance(answer.get("scores"), dict) else {}
    scores = {
        area: value
        for area in SCORE_AREAS
        if (value := _number(raw_scores.get(area), 1, 10)) is not None
    }
    if len(scores) >= 2:
        score = round(sum(scores.values()) / len(scores), 1)
    else:
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
            "price_range": price_range(raw.get("price_range")),
            "box": None,
        })
        if len(fixes) == MAX_FIXES:
            break
    return {
        "gender": gender if gender in GENDERS else "unisex",
        "score": score,
        "scores": scores,
        "wearing": _phrases(answer.get("wearing"), 8, 60),
        "verdict": _clean(answer.get("verdict"), 160),
        "occasion": _clean(answer.get("occasion"), 40),
        "strengths": _phrases(answer.get("strengths"), MAX_STRENGTHS, 80),
        "fixes": fixes,
    }


def rate_prompt(colours=None):
    """The rating prompt, preferring the person's best colours when known."""
    names = [_clean(colour, 24).lower() for colour in (colours or [])][:10]
    names = [name for name in names if name]
    rule = PALETTE_RULE.format(colours=", ".join(names)) if names else ""
    return RATE_PROMPT.replace("PALETTE_RULE", rule)


def rate_outfit(image, on_event=None, colours=None):
    """
    Rate the outfit in a photo and shop its suggested fixes. colours: the
    person's best colours ("Colours that suit you"), used for the fixes.

    Emits "rating" (score, rubric scores, verdict, strengths), then "items"
    and one "item" per fix like Find the outfit; each fix's listings are
    checked by the listing judge. Returns {"rating", "gender", "items"}.
    """
    answer, _, _, name = ask_vision(
        image, rate_prompt(colours), "Rate my outfit isn't set up on this server yet."
    )
    rating = read_rating(answer)
    if not rating["score"]:
        raise OutfitError("Couldn't see an outfit to rate. Try a clear photo of someone, ideally full length.")

    emit = _emitter(on_event)
    public = {key: rating[key] for key in ("score", "scores", "wearing", "verdict", "occasion", "strengths")}
    public["personalised"] = bool(colours)
    emit("rating", {"rating": public})
    if not rating["fixes"]:
        return {"rating": public, "gender": rating["gender"], "items": [], "model": name}
    result = shop_items(rating["fixes"], rating["gender"], emit, judge=True)
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
