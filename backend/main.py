from collections import OrderedDict
from contextlib import asynccontextmanager, contextmanager
from io import BytesIO
from pathlib import Path
import hashlib
import tempfile
import threading
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from image_shopping_service import (
    identify_product,
    load_clip_model,
    search_products_by_image as search_online_products,
)

# --------------------------------------------------
# 1. Create the FastAPI application
# --------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load CLIP in the background so the first search does not wait for it,
    # while the server still starts accepting requests immediately.
    threading.Thread(target=load_clip_model, daemon=True).start()
    yield


app = FastAPI(
    title="SnapBuy AI",
    version="0.4.0",
    lifespan=lifespan,
)


# --------------------------------------------------
# 2. Allow requests from the React frontend
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# 3. Image upload settings
# --------------------------------------------------

MAX_FILE_SIZE = 8 * 1024 * 1024  # 8 MB
MAX_IMAGE_PIXELS = 20_000_000

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_IMAGE_FORMATS = {
    "JPEG",
    "PNG",
    "WEBP",
}


# --------------------------------------------------
# 4. Validate and open an uploaded image
# --------------------------------------------------


async def read_uploaded_image(file: UploadFile) -> Image.Image:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Upload a JPEG, PNG, or WebP image.",
        )

    contents = await file.read(MAX_FILE_SIZE + 1)

    if not contents:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty.",
        )

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image size must not exceed 8 MB.",
        )

    try:
        # Verify that the uploaded bytes form a valid image.
        with Image.open(BytesIO(contents)) as check_image:
            if check_image.format not in ALLOWED_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=415,
                    detail="Unsupported image format.",
                )

            if check_image.width * check_image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="Image dimensions are too large.",
                )

            check_image.verify()

        # Reopen because verify() invalidates normal image access.
        with Image.open(BytesIO(contents)) as image:
            image.load()
            return image.convert("RGB")

    except HTTPException:
        raise

    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
    ):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image.",
        )


# --------------------------------------------------
# 5. Prepare the image for Google Lens
# --------------------------------------------------

LENS_MAX_BYTES = 500_000

ONLINE_SEARCH_ERROR = (
    "Online search failed. Check the backend terminal for details, "
    "and verify your SerpApi API key, quota, and internet connection."
)


@contextmanager
def lens_ready_image(image: Image.Image):
    """Yield a temporary JPEG small enough for the online service."""
    with tempfile.NamedTemporaryFile(
        suffix=".jpg",
        delete=False,
    ) as temp_file:
        temp_image_path = Path(temp_file.name)

    try:
        online_image = image.copy()
        online_image.thumbnail((1000, 1000))

        quality = 85

        while True:
            online_image.save(
                temp_image_path,
                format="JPEG",
                quality=quality,
                optimize=True,
            )

            if temp_image_path.stat().st_size <= LENS_MAX_BYTES:
                break

            if quality > 45:
                quality -= 10
            else:
                online_image.thumbnail(
                    (
                        max(1, online_image.width // 2),
                        max(1, online_image.height // 2),
                    )
                )
                quality = 75

            if online_image.width < 100 or online_image.height < 100:
                raise ValueError("Unable to compress the uploaded image.")

        yield temp_image_path

    finally:
        temp_image_path.unlink(missing_ok=True)


# --------------------------------------------------
# 6. Home and health-check endpoints
# --------------------------------------------------


@app.get("/")
def home():
    return {
        "app": "SnapBuy AI",
        "message": "Backend is working!",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
    }


# --------------------------------------------------
# 7. Identify the product in an uploaded image
# --------------------------------------------------


@app.post("/api/v1/products/recognize-image")
async def recognize_image(file: UploadFile = File(...)):
    image = await read_uploaded_image(file)

    def identify(image):
        with lens_ready_image(image) as image_path:
            return identify_product(image_path)

    try:
        # Run the blocking work off the event loop.
        result = await run_in_threadpool(identify, image)

    except Exception as exc:
        print(f"Product identification failed: {exc}")
        raise HTTPException(
            status_code=502,
            detail=ONLINE_SEARCH_ERROR,
        )

    return {
        "message": "Product identification completed.",
        "query": result["query"],
        "top_titles": result["top_titles"],
        "note": (
            "The query is built from the titles of the closest "
            "Google Lens matches."
        ),
    }


# --------------------------------------------------
# 8. Cache results for repeated searches
# --------------------------------------------------

# Searching the same photo again is answered from memory: instant, and it
# does not use another SerpApi search. Results expire after an hour because
# prices and stock change.
CACHE_TTL_SECONDS = 60 * 60
CACHE_MAX_ENTRIES = 100

_search_cache = OrderedDict()
_search_cache_lock = threading.Lock()


def image_fingerprint(image: Image.Image) -> str:
    """Hash the decoded pixels, so re-saved copies of a photo still match."""
    digest = hashlib.sha256()
    digest.update(f"{image.width}x{image.height}".encode())
    digest.update(image.tobytes())
    return digest.hexdigest()


def get_cached_search(key):
    with _search_cache_lock:
        entry = _search_cache.get(key)

        if entry is None:
            return None

        stored_at, result = entry
        if time.monotonic() - stored_at > CACHE_TTL_SECONDS:
            del _search_cache[key]
            return None

        _search_cache.move_to_end(key)
        return result


def store_cached_search(key, result):
    with _search_cache_lock:
        _search_cache[key] = (time.monotonic(), result)
        _search_cache.move_to_end(key)

        while len(_search_cache) > CACHE_MAX_ENTRIES:
            _search_cache.popitem(last=False)


# --------------------------------------------------
# 9. Search online products using an image
# --------------------------------------------------


@app.post("/api/v1/products/search-by-image")
async def search_products_by_image(file: UploadFile = File(...)):
    # Step 1: Validate and read the uploaded image.
    image = await read_uploaded_image(file)

    cache_key = await run_in_threadpool(image_fingerprint, image)
    cached = get_cached_search(cache_key)

    if cached is not None:
        print("Search served from cache.")
        return {**cached, "cached": True}

    # Step 2: Search online. Google Lens identifies the product itself,
    # and the search query is derived from its results.
    def search(image):
        with lens_ready_image(image) as image_path:
            return search_online_products(
                image_path=image_path,
                max_results=10,
            )

    try:
        # Run the blocking work off the event loop so other requests
        # are still served while a search is in progress.
        online_results = await run_in_threadpool(search, image)

    except Exception as exc:
        print(f"Online product search failed: {exc}")
        raise HTTPException(
            status_code=502,
            detail=ONLINE_SEARCH_ERROR,
        )

    best_matches = online_results.get("best_matches", [])
    cheapest_alternatives = online_results.get("cheapest_alternatives", [])
    query = online_results.get("online_search_query", "")

    # Defensive validation in case the service returns unexpected data.
    if not isinstance(best_matches, list):
        best_matches = []

    if not isinstance(cheapest_alternatives, list):
        cheapest_alternatives = []

    # Step 3: Return both online sections.
    response = {
        "category": query,
        # Online visual matches.
        "best_matches": best_matches,
        "best_matches_count": len(best_matches),
        # Online products sorted by known price.
        "cheapest_alternatives": cheapest_alternatives,
        "cheapest_alternatives_count": len(cheapest_alternatives),
        # Combined online count.
        "online_count": len(best_matches) + len(cheapest_alternatives),
        "online_search_query": query,
        "note": (
            "Best Matches are ranked by visual similarity and text relevance. "
            "Cheapest Alternatives are sorted by known numeric price. "
            "Online listings are candidates, not guaranteed identical "
            "products. Prices and availability may change."
        ),
    }

    # Only cache searches that found something, so a temporary Lens
    # failure is retried next time.
    if best_matches or cheapest_alternatives:
        store_cached_search(cache_key, response)

    return {**response, "cached": False}
