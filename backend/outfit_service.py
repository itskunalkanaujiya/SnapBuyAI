"""
Find the outfit: identify everything a person in a photo is wearing, then
find shopping options for each item.

A vision model on Groq (Qwen3.8 27B, free tier) lists the clothing and
accessories with a short shopping description and an approximate box for
each. Every item is then searched on Google Shopping (the text search
pipeline, through Serper) in parallel, so a whole outfit costs no Google
Lens searches.

Complete the look works the same way from a product instead of a photo: a
text model suggests the items that go with it (shoes and a belt for a
shirt, a bag and a mouse for a laptop), and each is searched in parallel.
"""

import base64
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image, ImageOps

from llm_query_parser import GROQ_URL, chat_json
from text_shopping_service import search_products_by_text

VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
VISION_IMAGE_SIZE = 768  # smaller images use fewer of the per-minute tokens
VISION_TIMEOUT_SECONDS = 25
MAX_ITEMS = 6
RESULTS_PER_ITEM = 6
LOOK_ITEMS = 4
LOOK_TIMEOUT_SECONDS = 10
GENDERS = {"men", "women", "boys", "girls", "kids", "unisex"}

PROMPT = """You are a fashion assistant for an Indian shopping app.
List the clothing items and accessories worn by the main person in the photo, most noticeable first.
Return JSON only:
{
  "gender": "men" | "women" | "boys" | "girls" | "kids" | "unisex",
  "items": [
    {
      "type": short category, e.g. "t-shirt", "jeans", "sneakers", "watch", "sunglasses", "handbag",
      "description": a 3-8 word shopping search with colour, pattern, style and material, e.g. "dark blue slim fit denim jeans",
      "box": [x1, y1, x2, y2] around the item, each from 0 to 1000 relative to the image width and height
    }
  ]
}
Rules:
- Only things the person wears or carries. Not body parts, hair, background or furniture.
- At most 6 items. One entry per item: a pair of shoes is one item.
- Name a brand only if its logo or name is clearly readable on the item.
- If no person is visible, return {"gender": "unisex", "items": []}."""


LOOK_PROMPT = """You are a stylist for an Indian shopping app.
The customer is looking at one product. Suggest the other items that go best with it.
Return JSON only:
{
  "gender": "men" | "women" | "boys" | "girls" | "kids" | "unisex",
  "items": [
    {
      "type": short category, e.g. "chinos", "loafers", "leather belt", "laptop bag",
      "description": a 3-8 word shopping search with colour, style and material that matches the product, e.g. "tan leather slip-on loafers",
      "reason": under 12 words on why it goes well, e.g. "Tan leather keeps the navy shirt smart but relaxed"
    }
  ]
}
Rules:
- 3 or 4 items, most useful first, each a different type, none the same type as the product.
- Clothing: complete a wearable outfit (bottom or top, footwear, one or two accessories) in colours that suit the product.
- Anything else (a laptop, phone, kitchen item): suggest the accessories people usually buy with it.
- No brands unless the product's brand makes its own matching accessories.
- Gender from the product name; "unisex" if unclear."""


class OutfitError(Exception):
    """An outfit couldn't be identified; the message is safe to show users."""

    user_facing = True


def _image_data_url(image):
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((VISION_IMAGE_SIZE, VISION_IMAGE_SIZE))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def _box(value):
    """A model box (0-1000) as fractions [x1, y1, x2, y2], or None if unusable."""
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x1, y1, x2, y2 = (min(1000.0, max(0.0, float(v))) / 1000 for v in value)
    except (TypeError, ValueError):
        return None
    if x2 - x1 < 0.02 or y2 - y1 < 0.02:
        return None
    return [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]


def _clean(text, limit):
    if not isinstance(text, str):
        return ""
    return re.sub(r"\s+", " ", text).strip()[:limit]


def identify_outfit(image):
    """
    The items the main person wears: {"gender", "items": [{"id", "type",
    "description", "box"}]}. Raises OutfitError with a user-facing message.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise OutfitError("Find the outfit isn't set up on this server yet.")

    try:
        response = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": VISION_MODEL,
                "temperature": 0,
                "max_tokens": 900,
                "response_format": {"type": "json_object"},
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT},
                        {"type": "image_url", "image_url": {"url": _image_data_url(image)}},
                    ],
                }],
            },
            timeout=VISION_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        print(f"Outfit model request failed: {exc}")
        raise OutfitError("Couldn't reach the outfit AI. Please try again.")

    if response.status_code == 429:
        raise OutfitError("The outfit AI is busy right now. Please try again in a minute.")
    if response.status_code != 200:
        print(f"Outfit model error {response.status_code}: {response.text[:300]}")
        raise OutfitError("Couldn't identify the outfit. Please try again.")

    try:
        data = json.loads(response.json()["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        print(f"Outfit model returned unreadable output: {exc}")
        raise OutfitError("Couldn't identify the outfit. Please try another photo.")

    gender = _clean(data.get("gender"), 10).lower()
    items = []
    for raw in data.get("items") or []:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), 30).lower()
        description = _clean(raw.get("description"), 80)
        if not item_type or not description:
            continue
        items.append({
            "id": f"item-{len(items) + 1}",
            "type": item_type,
            "description": description,
            "box": _box(raw.get("box")),
        })
        if len(items) == MAX_ITEMS:
            break

    return {"gender": gender if gender in GENDERS else "unisex", "items": items}


def item_query(item, gender):
    """The shopping search for one item, e.g. "men dark blue slim fit jeans"."""
    description = item["description"]
    if gender in GENDERS - {"unisex"} and gender not in description.lower():
        return f"{gender} {description}"
    return description


def _emitter(on_event):
    def emit(event_type, payload):
        if on_event is not None:
            try:
                on_event(event_type, payload)
            except Exception as exc:
                print(f"Outfit event handler failed: {exc}")

    return emit


def shop_items(items, gender, emit):
    """Search every item in parallel, adding its results; emits "item" each."""
    for item in items:
        item["query"] = item_query(item, gender)
    emit("items", {"gender": gender, "items": items})

    def search(item):
        try:
            # The description is already a clean search; skip the text model.
            result = search_products_by_text(item["query"], RESULTS_PER_ITEM, understand=False)
            return item, result, None
        except Exception as exc:
            print(f"Outfit item search failed for {item['query']!r}: {exc}")
            return item, None, exc

    with ThreadPoolExecutor(max_workers=len(items)) as pool:
        for future in as_completed([pool.submit(search, item) for item in items]):
            item, result, error = future.result()
            item["best_matches"] = (result or {}).get("best_matches", [])
            item["cheapest_alternatives"] = (result or {}).get("cheapest_alternatives", [])
            item["failed"] = error is not None
            emit("item", {"item": item})

    return {"gender": gender, "items": items}


def find_outfit(image, on_event=None):
    """
    Identify the outfit, then search every item in parallel.

    on_event(event_type, payload) is called with "items" once the outfit is
    identified and "item" as each item's results arrive. Returns
    {"gender", "items": [{..., "query", "best_matches", "cheapest_alternatives"}]}.
    """
    outfit = identify_outfit(image)
    if not outfit["items"]:
        raise OutfitError("Couldn't find a person's outfit in this photo. Try a clear photo of someone.")
    return shop_items(outfit["items"], outfit["gender"], _emitter(on_event))


def suggest_look(product_name):
    """
    The items that go with a product: {"gender", "items": [{"id", "type",
    "description", "reason", "box": None}]}. Raises OutfitError.
    """
    if not os.getenv("GROQ_API_KEY"):
        raise OutfitError("Complete the look isn't set up on this server yet.")

    try:
        data = chat_json(
            [
                {"role": "system", "content": LOOK_PROMPT},
                {"role": "user", "content": f"Product: {product_name}"},
            ],
            max_tokens=700,
            timeout=LOOK_TIMEOUT_SECONDS,
            temperature=0.3,
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            raise OutfitError("The styling AI is busy right now. Please try again in a minute.")
        print(f"Look model error: {exc}")
        raise OutfitError("Couldn't put a look together. Please try again.")
    except Exception as exc:
        print(f"Look model failed: {exc}")
        raise OutfitError("Couldn't put a look together. Please try again.")

    gender = _clean(data.get("gender"), 10).lower()
    product_words = set(re.findall(r"[a-z]+", product_name.lower()))
    items, types = [], set()
    for raw in data.get("items") or []:
        if not isinstance(raw, dict):
            continue
        item_type = _clean(raw.get("type"), 30).lower()
        description = _clean(raw.get("description"), 80)
        # Skip repeats, and the product's own type ("shirt" for a shirt).
        if not item_type or not description or item_type in types:
            continue
        if set(item_type.split()) <= product_words:
            continue
        types.add(item_type)
        items.append({
            "id": f"look-{len(items) + 1}",
            "type": item_type,
            "description": description,
            "reason": _clean(raw.get("reason"), 100),
            "box": None,
        })
        if len(items) == LOOK_ITEMS:
            break

    return {"gender": gender if gender in GENDERS else "unisex", "items": items}


def complete_the_look(product_name, on_event=None):
    """Suggest what goes with a product, then search each item in parallel."""
    look = suggest_look(product_name)
    if not look["items"]:
        raise OutfitError("Couldn't find items to go with this product.")
    return shop_items(look["items"], look["gender"], _emitter(on_event))
