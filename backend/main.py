from collections import OrderedDict, deque
from contextlib import asynccontextmanager, contextmanager
from io import BytesIO
from pathlib import Path
import asyncio
import hashlib
import json
import os
import tempfile
import threading
import time

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from image_shopping_service import (
    identify_product,
    load_clip_model,
    search_products_by_image as search_online_products,
)
from text_shopping_service import search_products_by_text as search_shopping_text
from tryon_service import GARMENT_WORDS, TryOnError, product_overlay, try_on

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

# Local development is always allowed. In production, list the frontend's
# address in ALLOWED_ORIGINS (comma-separated), and optionally allow Vercel
# preview deployments with ALLOWED_ORIGIN_REGEX, for example
#   https://snapbuy-ai(-[a-z0-9-]+)?\.vercel\.app
LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

allowed_origins = LOCAL_ORIGINS + [
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX") or None,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Lens-Centres"],
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
async def recognize_image(request: Request, file: UploadFile = File(...)):
    image = await read_uploaded_image(file)
    check_search_limit(request)

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
# 9. Limit searches per client
# --------------------------------------------------

# Every uncached search spends SerpApi credit, so each client (by IP
# address) gets a limited number per time window. Cached results are free
# and do not count. Set SEARCH_LIMIT=0 in .env to turn the limit off.
SEARCH_LIMIT = int(os.getenv("SEARCH_LIMIT", "10"))
SEARCH_WINDOW_SECONDS = int(os.getenv("SEARCH_WINDOW_SECONDS", "600"))

# Behind a hosting proxy (Hugging Face Spaces, Render, ...) every request
# arrives from the proxy, so the visitor's address must be read from
# X-Forwarded-For. Only enable this when a trusted proxy sets that header.
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() in {
    "true",
    "1",
    "yes",
}

_search_log = {}
_search_log_lock = threading.Lock()


def client_address(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for", "")
        first_hop = forwarded.split(",")[0].strip()
        if first_hop:
            return first_hop

    return request.client.host if request.client else "unknown"


def enforce_limit(request: Request, usage_log, limit, window_seconds, noun):
    """Record a request for this client, or raise 429 if over the limit."""
    if limit <= 0:
        return

    client = client_address(request)
    now = time.monotonic()

    with _search_log_lock:
        # Drop requests that have left the window (and idle clients).
        for key in list(usage_log):
            log = usage_log[key]
            while log and now - log[0] > window_seconds:
                log.popleft()
            if not log:
                del usage_log[key]

        log = usage_log.setdefault(client, deque())

        if len(log) >= limit:
            retry_after = int(window_seconds - (now - log[0])) + 1
            minutes = max(1, round(retry_after / 60))
            raise HTTPException(
                status_code=429,
                detail=(
                    f"You've reached the limit of {limit} {noun}. "
                    f"Please try again in about {minutes} "
                    f"minute{'s' if minutes != 1 else ''}."
                ),
                headers={"Retry-After": str(retry_after)},
            )

        log.append(now)


def check_search_limit(request: Request):
    enforce_limit(request, _search_log, SEARCH_LIMIT, SEARCH_WINDOW_SECONDS, "searches")


# --------------------------------------------------
# 10. Search online products using an image
# --------------------------------------------------


MAX_QUERY_LENGTH = 100


def clean_query(query: str | None) -> str | None:
    """Normalise an optional user-typed product query."""
    if not query:
        return None

    query = " ".join(query.split())[:MAX_QUERY_LENGTH]
    return query or None


def search_cache_key(image: Image.Image, query: str | None) -> str:
    # The same photo searched with different words is a different search.
    key = image_fingerprint(image)
    return f"{key}:{query.lower()}" if query else key


def run_search(image: Image.Image, on_event=None, query=None) -> dict:
    """Run the full online search for an image (blocking)."""
    with lens_ready_image(image) as image_path:
        return search_online_products(
            image_path=image_path,
            max_results=10,
            on_event=on_event,
            query=query,
        )


def build_search_response(online_results: dict) -> dict:
    """Shape the service result into the API response."""
    best_matches = online_results.get("best_matches", [])
    cheapest_alternatives = online_results.get("cheapest_alternatives", [])
    query = online_results.get("online_search_query", "")

    # Defensive validation in case the service returns unexpected data.
    if not isinstance(best_matches, list):
        best_matches = []

    if not isinstance(cheapest_alternatives, list):
        cheapest_alternatives = []

    return {
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


def cache_if_useful(cache_key, response):
    # Only cache searches that found something, so a temporary Lens
    # failure is retried next time.
    if response["best_matches"] or response["cheapest_alternatives"]:
        store_cached_search(cache_key, response)


@app.post("/api/v1/products/search-by-image")
async def search_products_by_image(
    request: Request,
    file: UploadFile = File(...),
    query: str | None = Form(None),
):
    # Step 1: Validate and read the uploaded image.
    image = await read_uploaded_image(file)
    query = clean_query(query)

    cache_key = await run_in_threadpool(search_cache_key, image, query)
    cached = get_cached_search(cache_key)

    if cached is not None:
        print("Search served from cache.")
        return {**cached, "cached": True}

    check_search_limit(request)

    # Step 2: Search online. Google Lens identifies the product itself,
    # and the search query is derived from its results.
    try:
        # Run the blocking work off the event loop so other requests
        # are still served while a search is in progress.
        online_results = await run_in_threadpool(run_search, image, None, query)

    except Exception as exc:
        print(f"Online product search failed: {exc}")
        raise HTTPException(
            status_code=502,
            detail=ONLINE_SEARCH_ERROR,
        )

    # Step 3: Return both online sections.
    response = build_search_response(online_results)
    cache_if_useful(cache_key, response)

    return {**response, "cached": False}


# --------------------------------------------------
# 11. Streamed search: show results as they become ready
# --------------------------------------------------


@app.post("/api/v1/products/search-by-image/stream")
async def search_products_by_image_stream(
    request: Request,
    file: UploadFile = File(...),
    query: str | None = Form(None),
):
    """
    Same search, streamed as newline-delimited JSON events:

        {"type": "stage", "stage": "identifying"}   search started
        {"type": "identified", "online_search_query": ...}
        {"type": "preview", "best_matches": [...], "cheapest_alternatives": [...],
         "online_search_query": ...}                 ranked, prices from Lens
        {"type": "final", ...same body as /search-by-image...}
        {"type": "error", "detail": ...}

    Preview listings with "pending": true are still having their price or
    stock checked; the final event replaces them.
    """
    # Validation errors are returned as normal HTTP errors before streaming.
    image = await read_uploaded_image(file)
    query = clean_query(query)

    cache_key = await run_in_threadpool(search_cache_key, image, query)
    cached = get_cached_search(cache_key)

    # Over-limit errors are also returned before streaming starts.
    if cached is None:
        check_search_limit(request)

    return stream_search_response(
        cache_key,
        cached,
        first_stage="identifying",
        run=lambda emit: run_search(image, on_event=emit, query=query),
    )


def stream_search_response(cache_key, cached, first_stage, run):
    """
    Stream a search as newline-delimited JSON events.

    run(emit) performs the blocking search in a worker thread and returns the
    service result; emit(event_type, payload) sends progress events.
    """
    loop = asyncio.get_running_loop()
    queue = asyncio.Queue()
    done = object()

    def emit(event_type, payload=None):
        # Called from the worker thread; hand events to the event loop.
        event = {"type": event_type, **(payload or {})}
        loop.call_soon_threadsafe(queue.put_nowait, event)

    def worker():
        try:
            emit("stage", {"stage": first_stage})
            response = build_search_response(run(emit))
            cache_if_useful(cache_key, response)
            emit("final", {**response, "cached": False})
        except Exception as exc:
            print(f"Online product search failed: {exc}")
            emit("error", {"detail": ONLINE_SEARCH_ERROR})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, done)

    async def events():
        if cached is not None:
            print("Search served from cache.")
            yield json.dumps({"type": "final", **cached, "cached": True}) + "\n"
            return

        task = loop.run_in_executor(None, worker)

        while True:
            event = await queue.get()
            if event is done:
                break
            yield json.dumps(event) + "\n"

        await task

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store"},
    )


# --------------------------------------------------
# 12. Search by typed text (Google Shopping)
# --------------------------------------------------


class TextSearchRequest(BaseModel):
    query: str


def text_query_or_400(body: TextSearchRequest) -> str:
    query = clean_query(body.query)
    if not query or len(query) < 2:
        raise HTTPException(
            status_code=400,
            detail="Type at least 2 characters to search.",
        )
    return query


def text_cache_key(query: str) -> str:
    return f"text:{query.lower()}"


@app.post("/api/v1/products/search-by-text")
async def search_products_by_text(request: Request, body: TextSearchRequest):
    query = text_query_or_400(body)
    cache_key = text_cache_key(query)

    cached = get_cached_search(cache_key)
    if cached is not None:
        print("Search served from cache.")
        return {**cached, "cached": True}

    check_search_limit(request)

    try:
        online_results = await run_in_threadpool(search_shopping_text, query, 10)
    except Exception as exc:
        print(f"Text search failed: {exc}")
        raise HTTPException(status_code=502, detail=ONLINE_SEARCH_ERROR)

    response = build_search_response(online_results)
    cache_if_useful(cache_key, response)
    return {**response, "cached": False}


@app.post("/api/v1/products/search-by-text/stream")
async def search_products_by_text_stream(request: Request, body: TextSearchRequest):
    """Same as /search-by-text, streamed like the photo search (stage, final, error)."""
    query = text_query_or_400(body)
    cache_key = text_cache_key(query)

    cached = get_cached_search(cache_key)
    if cached is None:
        check_search_limit(request)

    return stream_search_response(
        cache_key,
        cached,
        first_stage="searching",
        run=lambda emit: search_shopping_text(query, 10),
    )


# --------------------------------------------------
# 13. Virtual try-on
# --------------------------------------------------

# Try-ons use the free Hugging Face GPU quota, so they have their own,
# stricter limit. Repeating the same photo and garment is cached and free.
TRYON_LIMIT = int(os.getenv("TRYON_LIMIT", "5"))
TRYON_WINDOW_SECONDS = int(os.getenv("TRYON_WINDOW_SECONDS", "600"))
_tryon_log = {}


@app.post("/api/v1/tryon")
async def virtual_try_on(
    request: Request,
    person: UploadFile = File(...),
    garment_url: str = Form(...),
    category: str = Form(...),
    garment_name: str = Form(""),
):
    """
    Render the uploaded person photo wearing a product's garment.

    category is "upper_body", "lower_body" or "dresses" (the product's
    tryon_category). Returns a JPEG image.
    """
    if category not in GARMENT_WORDS:
        raise HTTPException(status_code=400, detail="This item can't be tried on.")

    person_image = await read_uploaded_image(person)

    fingerprint = await run_in_threadpool(image_fingerprint, person_image)
    cache_key = f"tryon:{fingerprint}:{category}:{garment_url}"
    cached = get_cached_search(cache_key)

    if cached is None:
        enforce_limit(request, _tryon_log, TRYON_LIMIT, TRYON_WINDOW_SECONDS, "try-ons")
        try:
            cached = await run_in_threadpool(
                try_on, person_image, garment_url, category, garment_name[:200]
            )
        except TryOnError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception as exc:
            print(f"Try-on failed: {exc}")
            raise HTTPException(
                status_code=503,
                detail="The try-on service is busy right now. Please try again in a minute.",
            )
        store_cached_search(cache_key, cached)
        was_cached = "false"
    else:
        was_cached = "true"

    return Response(
        content=cached,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Tryon-Cached": was_cached},
    )


# Live try-on (sunglasses, watches) runs in the browser; it only needs the
# product photo without its background. The web app checks every glasses and
# watch listing in the results this way, so the limit is generous; it exists
# because each check fetches a remote image. Results have their own cache so
# they don't push searches out of the search cache.
OVERLAY_LIMIT = int(os.getenv("OVERLAY_LIMIT", "150"))
OVERLAY_CACHE_ENTRIES = 500
_overlay_log = {}
_overlay_cache = OrderedDict()
_overlay_cache_lock = threading.Lock()


@app.get("/api/v1/tryon/overlay")
async def try_on_overlay(request: Request, url: str, category: str):
    """
    Return a product photo (category "glasses" or "watch", the product's
    ar_category) as a PNG with its background removed.
    """
    if category not in ("glasses", "watch"):
        raise HTTPException(status_code=400, detail="This item can't be tried on live.")
    if len(url) > 2048:
        raise HTTPException(status_code=400, detail="This product image can't be used.")

    cache_key = (category, url)
    with _overlay_cache_lock:
        cached = _overlay_cache.get(cache_key)
        if cached is not None:
            _overlay_cache.move_to_end(cache_key)

    if cached is None:
        enforce_limit(request, _overlay_log, OVERLAY_LIMIT, TRYON_WINDOW_SECONDS, "live try-ons")
        try:
            cached = await run_in_threadpool(product_overlay, url, category)
        except TryOnError as exc:
            cached = str(exc)
        except Exception as exc:
            print(f"Overlay failed: {exc}")
            raise HTTPException(
                status_code=422,
                detail="Couldn't prepare this product's photo. Try another listing.",
            )
        # Unusable photos are cached too, so they aren't fetched again.
        with _overlay_cache_lock:
            _overlay_cache[cache_key] = cached
            while len(_overlay_cache) > OVERLAY_CACHE_ENTRIES:
                _overlay_cache.popitem(last=False)

    if isinstance(cached, str):
        raise HTTPException(status_code=422, detail=cached)

    png, centres = cached
    headers = {"Cache-Control": "public, max-age=86400"}
    if centres:
        headers["X-Lens-Centres"] = ",".join(f"{value:.4f}" for value in centres)
    return Response(content=png, media_type="image/png", headers=headers)
