# SnapBuy AI

Upload a photo of a product — or type what you're looking for — and SnapBuy
AI finds matching listings across online stores in India, with prices and
stock availability.

- **Best matches**: listings that look most like your photo
- **Lowest prices**: the cheapest listings, in-stock items first
- **Saved items**: keep listings in your browser to compare later

## How it works

**Virtual try-on** shows the user wearing a garment from the results. Clothing
listings (tops, kurtis, shirts, bottoms, dresses) get a "Try on" button; the
user adds a photo and the backend sends it with the product image to free
try-on models on Hugging Face: [Leffa](https://huggingface.co/spaces/franciszzj/Leffa)
(MIT) first, then [IDM-VTON](https://huggingface.co/spaces/yisol/IDM-VTON)
(non-commercial) as a fallback for tops. A try-on takes about 20–40 seconds
on Hugging Face's free GPU quota.

**Live try-on** works for sunglasses, glasses and watches ("Try live"). The
browser opens the camera and tracks the face or hand with
[MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
(face and hand landmarks), and draws the product photo on top as you move:
frames on the eyes, the watch on the wrist along the arm. The backend only
removes the product photo's background (`/api/v1/tryon/overlay`); the camera
feed never leaves the device. The default **3D view** (Three.js) builds a
small model per product: the product photo as a curved front frame, 3D temple
arms in the frame's colour, and an invisible head shape that hides whatever
goes behind the head, posed from the tracked head; watches wrap around the
wrist and tilt with it. A **Flat** view draws the photo in 2D. Glasses are placed by matching the lens
centres in the product photo to the pupils (iris tracking). The web app checks
each listing's photo in the background and shows "Try live" only when it is
usable: a plain background and, for glasses, a front view (both lenses found
and alike, as clear-lens holes or tinted areas), so the frame on the face is
always the real product photo. Users can also use a photo, adjust size and
position, and save a picture.

**Search providers.** Each search uses the provider that did best in our
side-by-side tests: photo search uses Google Lens through **SearchApi.io**
first (5–9 s where SerpApi took 9–41 s, same matches) while its credits last.
SearchApi only reads images from a public link, so the photo is put on a
public **Vercel Blob** store under an unguessable name and deleted as soon as
the search returns. Otherwise photo search uses **SerpApi** (prices and
Indian stores), text search uses Google Shopping through **Serper.dev**
(faster and more relevant), falling back to SerpApi if Serper isn't set up,
fails or runs out. After Lens identifies a photo's product, a background
Serper Shopping lookup fills prices Lens left out, from the same store's
matching listing. The home screen shows the searches left on each.

**Text search understands sentences.** "a laptop of 8gb ram with 500gb
storage and company hp under 50k" is read (`backend/query_understanding.py`)
as brand HP, product laptop, 8 GB RAM, ~500 GB storage and a ₹50,000 budget:
Google Shopping is searched for "hp laptop 8GB RAM 500GB", the budget is a
hard limit, and listings are ranked by how many requirements their titles
meet (512 GB counts as ~500 GB). The results page shows what was understood.
Plain keyword searches work as before. With `GROQ_API_KEY` set, sentence-style
requests are also read by a language model (Groq free tier: Qwen3.8 27B, GPT-OSS 20B as backup;
`backend/llm_query_parser.py`), which understands looser phrasing ("a phone
good for gaming that lasts all day", "something to keep my tea hot") and
suggests the search query. Numbers and budgets written in the request always
come from the rule-based reader, and any model error or delay over 4 s falls
back to it.

**Text search** sends the typed query to Google Shopping:
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
  main.py                    API endpoints, upload validation, cache, rate limits
  image_shopping_service.py  Google Lens search, CLIP ranking, price and stock extraction
  text_shopping_service.py   Google Shopping search and relevance scoring
  tryon_service.py           Clothing try-on (Hugging Face) and product cut-outs
  tests/                     Offline tests
  requirements.txt
  .env.example               Copy to .env and add your SerpApi key
frontend/                    React 19 + Vite app
  src/App.jsx                App state and page layout
  src/components/            Search panels, results, product cards, try-on dialogs
  src/lib/products.js        Price, filter and formatting helpers
  src/lib/tryon.js           Clothing try-on requests
  src/lib/liveTryOn.js       Face/hand tracking and product placement
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
| `POST` | `/api/v1/products/search-by-image` | Upload an image (`file`, JPEG/PNG/WebP, max 8 MB) and optionally a `query` (up to 150 characters, e.g. a brand or model) to narrow the Lens search; returns `best_matches` and `cheapest_alternatives` |
| `POST` | `/api/v1/products/search-by-image/stream` | Same search as newline-delimited JSON events: `stage`, `identified`, `preview` (ranked listings with Google Lens prices; `pending: true` while a seller page is still being checked), then `final` (same body as above) or `error`. Used by the web app. |
| `POST` | `/api/v1/products/search-by-text` | JSON body `{"query": "..."}` (2–150 characters, keywords or a sentence like "hp laptop with 8gb ram under 50k"); searches Google Shopping and returns the same sections as the photo search, plus `understood` (what a sentence was read as) |
| `POST` | `/api/v1/products/search-by-text/stream` | Same, streamed as `stage` then `final` (or `error`) events |
| `POST` | `/api/v1/products/recognize-image` | Identify the product only; returns the derived query and top Lens titles |
| `POST` | `/api/v1/tryon` | Multipart: `person` (photo), `garment_url` (product image), `category` (`upper_body`, `lower_body` or `dresses`, from the product's `tryon_category`), optional `garment_name`; returns a JPEG |
| `GET` | `/api/v1/tryon/overlay` | Query `url` (product image) and `category` (`glasses` or `watch`, from the product's `ar_category`); returns the photo as a PNG with its background removed, for the live try-on |
| `GET` | `/api/v1/usage` | Searches left: SerpApi plan, Serper credits (`text`, when `SERPER_API_KEY` is set) and SearchApi credits (`fast_photo`, when `SEARCHAPI_API_KEY` and `BLOB_READ_WRITE_TOKEN` are set) |
| `GET` | `/health` | Health check |

## Notes

- Each search uses one SerpApi search (two if Google Lens returns nothing and
  SnapBuy retries). Identical photos are served from a one-hour cache.
- To protect your SerpApi quota, each client (IP address) can run 10 uncached
  searches per 10 minutes; further searches get HTTP 429 with a `Retry-After`
  header. Change this with `SEARCH_LIMIT` and `SEARCH_WINDOW_SECONDS` in
  `backend/.env` (`SEARCH_LIMIT=0` turns it off).
- Try-ons use Hugging Face's free ZeroGPU quota for the `HF_TOKEN` account
  (locally, your `hf auth login`), limited to 5 per visitor per 10 minutes
  (`TRYON_LIMIT` / `TRYON_WINDOW_SECONDS`). The public Spaces can be busy or
  down; IDM-VTON is non-commercial, so use only Leffa for commercial use.
- Match labels come from CLIP similarity: **Very close** (≥ 0.88, usually the
  same item), **Similar** (≥ 0.78) and **Related** (same kind of product).
  These thresholds were calibrated on real searches and live in
  `frontend/src/lib/products.js`.
- Prices and stock are read at search time and may change. Some stores block
  automated price checks, so a few listings show "Price on store".
- On Windows, run uvicorn **without** `--reload`; the auto-reloader can stall
  and keep serving old code.
