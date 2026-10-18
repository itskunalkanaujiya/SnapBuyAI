"""
Find the outfit: identify everything a person in a photo is wearing, then
find shopping options for each item.

A vision model on Groq (Qwen3.8 27B, free tier) lists the clothing and
accessories with a short shopping description and an approximate box for
each. Every item is then searched on Google Shopping (the text search
pipeline, through Serper) in parallel, so a whole outfit costs no Google
Lens searches.
"""

import base64
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from PIL import Image, ImageOps

from llm_query_parser import GROQ_URL
from text_shopping_service import search_products_by_text

VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
VISION_IMAGE_SIZE = 768  # smaller images use fewer of the per-minute tokens
VISION_TIMEOUT_SECONDS = 25
MAX_ITEMS = 6
RESULTS_PER_ITEM = 6
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


def find_outfit(image, on_event=None):
    """
    Identify the outfit, then search every item in parallel.

    on_event(event_type, payload) is called with "items" once the outfit is
    identified and "item" as each item's results arrive. Returns
    {"gender", "items": [{..., "query", "best_matches", "cheapest_alternatives"}]}.
    """

    def emit(event_type, payload):
        if on_event is not None:
            try:
                on_event(event_type, payload)
            except Exception as exc:
                print(f"Outfit event handler failed: {exc}")

    outfit = identify_outfit(image)
    gender, items = outfit["gender"], outfit["items"]
    if not items:
        raise OutfitError("Couldn't find a person's outfit in this photo. Try a clear photo of someone.")

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
