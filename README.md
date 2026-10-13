# SnapBuy AI

Upload a photo of a product — or type what you're looking for — and SnapBuy
AI finds matching listings across online stores in India, with prices and
stock availability.

- **Best matches**: listings that look most like your photo
- **Lowest prices**: the cheapest listings, in-stock items first
- **Saved items**: keep listings in your browser to compare later

## How it works

**Text search** sends the typed query to Google Shopping (through SerpApi):
top results keep Google's relevance order, and Lowest Prices are the
cheapest listings that still contain most of the query's words. Listings
show ratings and original prices where stores provide them, and link to
Google Shopping's page comparing the stores that sell the item.

**Photo search:**

1. The photo is sent to **Google Lens** (through [SerpApi](https://serpapi.com/google-lens-api)).
   No search text is needed — Lens identifies the product, and SnapBuy builds
   a short product query from the titles of the matching listings.
2. Non-shopping and non-product pages are filtered out, and duplicates removed.
3. **CLIP** (the ViT-B/32 image encoder, from
   [kunalkanaujiya/clip-vit-base-patch32-vision](https://huggingface.co/kunalkanaujiya/clip-vit-base-patch32-vision))
   re-ranks listings by visual similarity to your photo.
4. Missing prices and stock status are read from seller pages (structured
   product data, page metadata, and Amazon/Flipkart-specific markup).

## Project structure

```
backend/                     FastAPI server
  main.py                    API endpoints, upload validation, result cache
  image_shopping_service.py  Google Lens search, ranking, price and stock extraction
  text_shopping_service.py   Google Shopping search for typed queries
  requirements.txt
  .env.example               Copy to .env and add your SerpApi key
frontend/                    React 19 + Vite app
  src/App.jsx                App state and page layout
  src/components/            Upload panel, results, product cards, landing sections
  src/lib/products.js        Price, filter and formatting helpers
```

## Setup

Requirements: Python 3.13, Node.js 20+, and a [SerpApi](https://serpapi.com) API key.

### Backend

```bash
cd backend
python -m venv ../myvenv
../myvenv/Scripts/activate        # macOS/Linux: source ../myvenv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then put your SerpApi key in .env
uvicorn main:app --host 127.0.0.1 --port 8000
```

The first start downloads the CLIP image encoder (about 176 MB). API docs are at
http://127.0.0.1:8000/docs.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173. To point the app at a different backend, set
`VITE_API_URL` (for example in `frontend/.env.local`).

### Tests

The backend tests run offline: Google Lens, CLIP and seller pages are
replaced with fakes, so no SerpApi credit is used.

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

## Deployment

Both parts run on Vercel as two projects connected to this repository; every
push to `main` redeploys them.

| Project | Root directory | Address | Settings |
|---|---|---|---|
| `snapbuy-ai` (frontend) | `frontend` | https://snapbuy-ai.vercel.app | `VITE_API_URL=https://snapbuy-ai-api.vercel.app` |
| `snapbuy-ai-api` (backend) | `backend` | https://snapbuy-ai-api.vercel.app | `SERPAPI_API_KEY` (encrypted), `TRUST_PROXY_HEADERS`, `ALLOWED_ORIGIN_REGEX`, `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` |

The backend bundle includes CPU-only PyTorch (about 1 GB), so it uses Vercel's
large functions. On a cold start it loads PyTorch and downloads the CLIP image
encoder to `/tmp`, so the first search after an idle period is slower. The
result cache and search limit are kept per server instance.

The `backend/Dockerfile` builds the same backend as a container for any Docker
host.

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/products/search-by-image` | Upload an image (`file`, JPEG/PNG/WebP, max 8 MB) and optionally a `query` (up to 100 characters, e.g. a brand or model) to narrow the Lens search; returns `best_matches` and `cheapest_alternatives` |
| `POST` | `/api/v1/products/search-by-image/stream` | Same search as newline-delimited JSON events: `stage`, `identified`, `preview` (ranked listings with Google Lens prices; `pending: true` while a seller page is still being checked), then `final` (same body as above) or `error`. Used by the web app. |
| `POST` | `/api/v1/products/search-by-text` | JSON body `{"query": "..."}` (2–100 characters); searches Google Shopping and returns the same sections as the photo search |
| `POST` | `/api/v1/products/search-by-text/stream` | Same, streamed as `stage` then `final` (or `error`) events |
| `POST` | `/api/v1/products/recognize-image` | Identify the product only; returns the derived query and top Lens titles |
| `GET` | `/health` | Health check |

## Notes

- Each search uses one SerpApi search (two if Google Lens returns nothing and
  SnapBuy retries). Identical photos are served from a one-hour cache.
- To protect your SerpApi quota, each client (IP address) can run 10 uncached
  searches per 10 minutes; further searches get HTTP 429 with a `Retry-After`
  header. Change this with `SEARCH_LIMIT` and `SEARCH_WINDOW_SECONDS` in
  `backend/.env` (`SEARCH_LIMIT=0` turns it off).
- Match labels come from CLIP similarity: **Very close** (≥ 0.88, usually the
  same item), **Similar** (≥ 0.78) and **Related** (same kind of product).
  These thresholds were calibrated on real searches and live in
  `frontend/src/lib/products.js`.
- Prices and stock are read at search time and may change. Some stores block
  automated price checks, so a few listings show "Price on store".
- On Windows, run uvicorn **without** `--reload`; the auto-reloader can stall
  and keep serving old code.
