"""
Shop this room: find the furniture and decor in a photo of a room and shop
each piece, like Find the outfit does for clothes.

The vision model (Gemini, then Groq) lists the pieces with a shopping
description and a box; each piece is searched on Google Shopping in
parallel, and its listings are re-ranked against the piece's crop from the
photo (CLIP), so a whole room costs no Google Lens searches.
"""

import threading

from image_shopping_service import load_clip_model
from outfit_service import (
    OutfitError,
    _clean,
    _emitter,
    ask_vision,
    read_outfit,
    shop_items,
)

ROOM_PROMPT = """You are an interior stylist for an Indian shopping app.
Look carefully at this room photo and list the furniture, lighting and decor a shopper could buy to recreate it.

Check each of these and include every one that is clearly visible:
- seating: sofa, armchair, accent chair, ottoman, pouf, bench, dining chairs
- tables: coffee table, side table, console table, dining table, desk, TV unit
- bedroom: bed, headboard, bedsheet or bedspread, bedside table, wardrobe
- soft furnishings: cushions, throw blanket, rug, curtains
- lighting: floor lamp, table lamp, pendant light, chandelier, wall light
- decor: wall art, mirror, wall shelf, bookshelf, plant with planter, vase, clock, basket, candles

Return JSON only:
{
  "style": the room's style in 2-4 words, e.g. "modern boho living room",
  "items": [
    {
      "type": short category from the list above, e.g. "sofa", "floor lamp", "rug",
      "description": a 4-10 word shopping search: colour, material, shape or style, then the item, e.g. "beige linen three seater sofa",
      "box": BOX_FORMAT
    }
  ]
}
Rules:
- Only things that can be bought: not walls, floors, windows, doors, ceilings or the view.
- Every description is a home furnishing search, so add the room or furniture it's for when the item word alone could mean something else: "mustard velvet cushion covers for sofa", not "brown leather cushions" (which finds car pillows).
- Name the material you can actually see: suede, velvet, linen, leather, wood, metal, rattan, cotton; if unsure, use "fabric" or leave it out.
- One entry per kind of item: several matching cushions are one item.
- Name a brand only if it is clearly readable.
- At most 8 items, the biggest and most noticeable first.
- If this is not a room or interior, return {"style": "", "items": []}."""


def identify_room(image):
    """The pieces in a room photo: {"style", "items": [{"id", "type", "description", "box"}], "model"}."""
    answer, frame, order, name = ask_vision(image, ROOM_PROMPT, "Shop this room isn't set up on this server yet.")
    room = read_outfit(answer, frame, order)
    return {
        "style": _clean(answer.get("style"), 40),
        "items": [{**item, "id": item["id"].replace("item-", "piece-")} for item in room["items"]],
        "model": name,
    }


def find_room(image, on_event=None):
    """
    Identify the room's pieces, then search each in parallel; emits "items"
    and one "item" per piece like Find the outfit. Returns {"style",
    "gender", "items", "model"}.
    """
    threading.Thread(target=load_clip_model, daemon=True).start()
    room = identify_room(image)
    if not room["items"]:
        raise OutfitError("Couldn't find furniture or decor in this photo. Try a clear photo of a room.")
    result = shop_items(room["items"], "unisex", _emitter(on_event), image=image)
    return {**result, "style": room["style"], "model": room["model"]}
