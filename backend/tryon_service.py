"""
Virtual try-on: show a person wearing a garment from the search results.

Uses free public try-on models on Hugging Face Spaces through gradio_client:
Leffa (MIT licence) first, IDM-VTON (non-commercial licence) as a fallback
for upper-body garments. Both run on Hugging Face's free ZeroGPU quota,
which is tied to the HF_TOKEN account.
"""

import io
import ipaddress
import os
import re
import socket
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image, ImageOps

TRYON_SIZE = (768, 1024)  # width, height the models are trained on (3:4)
MAX_GARMENT_BYTES = 8 * 1024 * 1024
MODEL_TIMEOUT_SECONDS = 150

LEFFA_SPACE = os.getenv("TRYON_LEFFA_SPACE", "franciszzj/Leffa")
IDM_SPACE = os.getenv("TRYON_IDM_SPACE", "yisol/IDM-VTON")

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
}

# Product words that identify a wearable garment, by try-on category.
GARMENT_WORDS = {
    "upper_body": {
        "shirt", "tshirt", "t-shirt", "tee", "top", "kurti", "kurta", "blouse",
        "sweater", "sweatshirt", "hoodie", "jacket", "blazer", "coat", "cardigan",
        "tunic", "polo", "jersey", "pullover", "crop top", "shrug", "vest",
    },
    "lower_body": {
        "jean", "jeans", "trouser", "trousers", "pant", "pants", "short", "shorts",
        "skirt", "legging", "leggings", "jogger", "joggers", "palazzo", "chino",
        "chinos", "cargo", "cargos",
    },
    "dresses": {"dress", "gown", "jumpsuit", "frock", "maxi", "romper", "playsuit"},
}

# Products that mention a garment word but are not garments.
NOT_GARMENT = re.compile(
    r"\b(watch|shoe|shoes|sneaker|bag|wallet|belt|cap|hat|sunglass|glasses|"
    r"earbud|phone|case|cover|hanger|pattern|fabric|cloth material|mannequin|"
    r"doll|toy|sticker|poster|mug|frame|socks?)\b",
    re.IGNORECASE,
)


class TryOnError(Exception):
    """A try-on could not be produced; the message is safe to show users."""


def garment_category(name):
    """Return "upper_body", "lower_body", "dresses" or None for a product name."""
    text = (name or "").lower()
    if not text or NOT_GARMENT.search(text):
        return None

    words = set(re.findall(r"[a-z]+(?:-[a-z]+)?", text))
    # Dresses first ("kurti dress" is a dress), then tops before bottoms, so
    # outfits like "kurti with palazzo" or "short kurti" try on the top.
    for category in ("dresses", "upper_body", "lower_body"):
        vocabulary = GARMENT_WORDS[category]
        if words & vocabulary or any(" " in v and v in text for v in vocabulary):
            return category
    return None


# --------------------------------------------------
# Image preparation
# --------------------------------------------------


def fit_person(image):
    """Centre-crop the person photo to 3:4 and resize, without stretching."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    return ImageOps.fit(image, TRYON_SIZE, Image.LANCZOS, centering=(0.5, 0.4))


def fit_garment(image):
    """Pad the garment photo to 3:4 on white and resize, without cropping."""
    image = ImageOps.exif_transpose(image).convert("RGB")
    return ImageOps.pad(image, TRYON_SIZE, Image.LANCZOS, color=(255, 255, 255))


def is_public_host(hostname):
    """Reject loopback, private and link-local addresses (no internal fetches)."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False

    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            return False
    return True


def download_garment(url):
    """Download a product image from a public http(s) URL."""
    parsed = urlparse(url or "")
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise TryOnError("This product doesn't have a usable image.")
    if not is_public_host(parsed.hostname):
        raise TryOnError("This product image can't be used.")

    try:
        with requests.get(url, headers=REQUEST_HEADERS, timeout=15, stream=True) as response:
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_content(65536):
                content.extend(chunk)
                if len(content) > MAX_GARMENT_BYTES:
                    raise TryOnError("This product image is too large.")
        image = Image.open(io.BytesIO(content))
        image.load()
        return image
    except TryOnError:
        raise
    except Exception as exc:
        print(f"Could not load garment image {url}: {exc}")
        raise TryOnError("Couldn't load this product's image. Try another item.")


# --------------------------------------------------
# Models
# --------------------------------------------------


def _client(space):
    from gradio_client import Client  # imported lazily; only try-on needs it

    # HF_TOKEN in production; locally, fall back to the saved `hf auth login`.
    token = os.getenv("HF_TOKEN")
    if not token:
        from huggingface_hub import get_token

        token = get_token()
    return Client(space, token=token or None, verbose=False)


def _result_path(result):
    first = result[0] if isinstance(result, (list, tuple)) else result
    return first if isinstance(first, str) else (first or {}).get("path")


def run_leffa(person_path, garment_path, category):
    from gradio_client import handle_file

    # Leffa's VITON-HD model handles tops best; Dress Code covers the rest.
    model = "viton_hd" if category == "upper_body" else "dress_code"
    job = _client(LEFFA_SPACE).submit(
        src_image_path=handle_file(person_path),
        ref_image_path=handle_file(garment_path),
        ref_acceleration=False,
        step=30,
        scale=2.5,
        seed=42,
        vt_model_type=model,
        vt_garment_type=category,
        vt_repaint=False,
        api_name="/leffa_predict_vt",
    )
    return _result_path(job.result(timeout=MODEL_TIMEOUT_SECONDS))


def run_idm_vton(person_path, garment_path, description):
    from gradio_client import handle_file

    job = _client(IDM_SPACE).submit(
        dict={"background": handle_file(person_path), "layers": [], "composite": None},
        garm_img=handle_file(garment_path),
        garment_des=description[:120],
        is_checked=True,
        is_checked_crop=False,
        denoise_steps=30,
        seed=42,
        api_name="/tryon",
    )
    return _result_path(job.result(timeout=MODEL_TIMEOUT_SECONDS))


def try_on(person_image, garment_url, category, garment_name=""):
    """
    Render the person wearing the garment. Returns JPEG bytes.

    Raises TryOnError with a user-facing message if every model fails.
    """
    if category not in GARMENT_WORDS:
        raise TryOnError("This item can't be tried on.")

    garment_image = download_garment(garment_url)

    with tempfile.TemporaryDirectory() as folder:
        person_path = Path(folder) / "person.jpg"
        garment_path = Path(folder) / "garment.jpg"
        fit_person(person_image).save(person_path, quality=95)
        fit_garment(garment_image).save(garment_path, quality=95)

        attempts = [("Leffa", lambda: run_leffa(person_path, garment_path, category))]
        if category == "upper_body":
            attempts.append(
                ("IDM-VTON", lambda: run_idm_vton(person_path, garment_path, garment_name or "top"))
            )

        for model_name, attempt in attempts:
            try:
                result_path = attempt()
                if not result_path:
                    raise RuntimeError("no image returned")
                with Image.open(result_path) as result:
                    output = io.BytesIO()
                    result.convert("RGB").save(output, format="JPEG", quality=90)
                print(f"Try-on succeeded with {model_name}.")
                return output.getvalue()
            except Exception as exc:
                print(f"Try-on with {model_name} failed: {type(exc).__name__}: {exc}")

    raise TryOnError(
        "The try-on service is busy right now. Please try again in a minute."
    )
