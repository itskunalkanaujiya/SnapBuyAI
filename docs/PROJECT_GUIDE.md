# SnapBuy AI — Project Guide

Oct 19, 2026 · Live version of this guide: [Claude Docs](https://claude.ai/code/artifact/dd30c605-4259-430e-ad88-27b811220527)

## What SnapBuy AI is

SnapBuy AI is a free AI shopping assistant for India: show it a photo or describe a product in your own words, and it finds where to buy it online and where it is cheapest. It is a web app (React frontend + Python FastAPI backend), deployed on Vercel, and runs on free tiers of search and AI services.

- **Live app:** [snapbuy-ai.vercel.app](https://snapbuy-ai.vercel.app)
- **Backend API:** [snapbuy-ai-api.vercel.app](https://snapbuy-ai-api.vercel.app) (interactive docs at `/docs`)
- **Code:** [github.com/itskunalkanaujiya/SnapBuyAI](https://github.com/itskunalkanaujiya/SnapBuyAI)

What a shopper can do:

| Feature | In one line |
| --- | --- |
| Photo search | Upload or paste a product photo; Google Lens finds listings, CLIP ranks them by how alike they look |
| Describe it | Type or speak a sentence in English, Hindi or Hinglish ("50k ke andar 8GB RAM wala HP laptop"); AI reads budget, specs and audience |
| Deals | Every result gets a deal score; cheaper lookalikes (dupes) and fake "70% off" discounts are flagged |
| Find the outfit | One photo of a person → every item they wear, each with shopping options and an Exact match search |
| Rate my outfit | A style score with four sub-scores and 2–3 shoppable tips to improve the look |
| Colours that suit you | A selfie gives a colour palette; results in your colours get "Suits you" |
| Complete the look | On any product: AI suggests what goes with it, with listings |
| Plan on a budget | "Wedding guest outfit, men, ₹5,000" → a whole look, one pick per piece, total within budget |
| Shop this room | One room photo → every piece of furniture and decor, each with listings |
| Compare | Tick 2–3 products for a side-by-side table, features read by AI, and a verdict |
| Ask AI | A chat that compares the listings on screen and recommends one |
| Try on | Clothes on your photo (AI, Hugging Face); glasses and watches placed on your face or wrist photo |
| Saved and recent | Wishlist and recent searches, kept in the browser |

No sign-up is needed. Saved items, recent searches, try-on photos and the colour palette stay in the user's browser.

## How it works

The React app in the browser sends every request to the FastAPI backend, which calls the search providers, store pages and AI models and streams results back. Keys and heavy work stay on the server; MediaPipe and saved data stay in the browser.

![SnapBuy AI architecture: browser, backend, external services](architecture.png)

Arrows show who calls whom: the search services reach the search APIs and store pages, and the AI services reach Groq or Gemini and Hugging Face.

A photo search, start to finish:

1. The browser shrinks the photo and posts it to `/api/v1/products/search-by-image/stream`.
2. The backend checks the cache and the visitor's limit, then uploads the photo to Vercel Blob for a public URL.
3. Google Lens (SearchApi, or SerpApi as fallback) returns visually similar listings; the photo is deleted from Blob.
4. A first preview streams back; CLIP scores each listing's photo against yours while store pages are read for price, stock and MRP.
5. The final event carries Best matches, Cheaper lookalikes and Lowest prices; the browser adds deal scores and saves the search to Recent.

The outfit, look and rating features follow the same pattern: an AI step first (vision or language model), then parallel Google Shopping searches, each result streamed as it finishes.

## Tech stack

The app is two parts: a React single-page app and a Python FastAPI service, both hosted on Vercel. Heavy lifting is done by free external services (search APIs and AI models), so the code itself stays small.

| Layer | Technology | What it does here |
| --- | --- | --- |
| Frontend framework | React 19 + Vite 8 | The whole web app: search panels, results, outfit views, dialogs |
| Frontend styling | Plain CSS (`App.css`) with design tokens | Light and dark themes, responsive layout; no CSS framework |
| In-browser vision | MediaPipe Tasks Vision 1.0.1 | Finds eyes and wrists in a photo for glasses and watch try-on |
| Voice input | Browser SpeechRecognition API | Voice search in English (en-IN) or Hindi (hi-IN) |
| Backend framework | Python 3.13, FastAPI, Uvicorn | REST and streaming (NDJSON) API |
| Image handling | Pillow, NumPy | Resizing, cropping, background removal for try-on cut-outs |
| Visual similarity | CLIP ViT-B/32 image encoder (PyTorch + Transformers) | Ranks listings by how much their photo looks like yours |
| Web pages | Requests + BeautifulSoup | Reads price, stock and MRP from store product pages |
| Language and vision AI | Groq API: Qwen3.8 27B, GPT-OSS 120B / 20B | Query understanding, outfit detection, rating, colours, chat, listing checks |
| Optional vision AI | Google Gemini Flash | Better outfit detection when a key is set (falls back to Groq) |
| Clothes try-on AI | Hugging Face Spaces (Leffa, IDM-VTON) via `gradio_client` | Puts a garment on the user's photo |
| Search providers | Serper.dev, SerpApi, SearchApi.io | Google Shopping and Google Lens results |
| Temporary image hosting | Vercel Blob | Gives Google Lens a public URL for the uploaded photo |
| Hosting | Vercel (two projects) | Static frontend + Python serverless backend |
| Quality | pytest, ESLint, GitHub Actions | 264 backend tests, linting, CI on every backend push |

## Project structure

The repository has two independent apps, `frontend/` and `backend/`, each deployed as its own Vercel project. Backend services are plain Python modules named by job; frontend code is split into `components/` (what you see) and `lib/` (logic and API calls).

```
SnapBuyAI/
├── README.md                      Full technical notes
├── docs/PROJECT_GUIDE.md          This guide (+ architecture.png)
├── .github/workflows/backend.yml  CI: runs backend tests on every push
│
├── backend/                       Python FastAPI service (Vercel project: snapbuy-ai-api)
│   ├── main.py                    All API routes, caching, rate limits, streaming
│   ├── image_shopping_service.py  Photo search: Google Lens, CLIP ranking, prices, stock, MRP, dupes
│   ├── text_shopping_service.py   Text search: Google Shopping (Serper / SerpApi), relevance ranking
│   ├── query_understanding.py     Rule-based reader: budgets, specs, brands, Hinglish
│   ├── llm_query_parser.py        Groq language model for sentence-style queries; shared chat_json helper
│   ├── outfit_service.py          Find the outfit + Complete the look; shared vision call (Gemini/Groq)
│   ├── style_service.py           Rate my outfit + Colours that suit you
│   ├── room_service.py            Shop this room
│   ├── planner_service.py         Budget look planner: plan, budget split, picks
│   ├── listing_judge.py           AI check that a suggestion's listings are the right item
│   ├── assistant_service.py       "Ask AI" chat about the listings on screen
│   ├── tryon_service.py           Clothes try-on (Hugging Face) + glasses/watch cut-outs
│   ├── tests/                     264 pytest tests (no network: providers are faked)
│   ├── requirements.txt           Python dependencies (pyproject.toml for Vercel's build)
│   ├── vercel.json, .vercelignore Serverless settings; keeps .env and tests out of deploys
│   └── .env.example               Names of every setting (copy to .env and fill in)
│
└── frontend/                      React + Vite app (Vercel project: snapbuy-ai)
    ├── index.html, vite.config.js
    └── src/
        ├── App.jsx                The app shell: state, search flows, which view is shown
        ├── App.css, index.css     All styles, light and dark themes
        ├── components/
        │   ├── UploadPanel.jsx         Photo upload, crop, Find the outfit, Rate my outfit buttons
        │   ├── TextSearchPanel.jsx     Typed and voice search, English/Hindi toggle
        │   ├── ResultsView.jsx         Results page: sections, filters, deals, dupes
        │   ├── ProductCard.jsx         One listing: price, deal line, badges, Try on, Complete the look
        │   ├── OutfitView.jsx          Outfit, look and rating screens
        │   ├── AssistantChat.jsx       "Ask AI about these" chat panel
        │   ├── PlanPanel.jsx           Budget look planner form (the "Plan" tab)
        │   ├── CompareDialog.jsx       Compare bar and side-by-side dialog
        │   ├── ColoursDialog.jsx       Colours that suit you
        │   ├── TryOnDialog.jsx         Clothes try-on (before/after)
        │   ├── AccessoryTryOnDialog.jsx Glasses and watch try-on on a photo
        │   ├── CropDialog.jsx          Crop a photo before searching
        │   ├── Landing.jsx, Showcase.jsx, HeroHeadline.jsx  Home page sections
        │   ├── SearchQuota.jsx         Searches left this month
        │   ├── RecentSearches.jsx      Recent searches strip
        │   └── Icon.jsx                Inline SVG icon set and logo
        └── lib/
            ├── searchStream.js         Calls the streaming endpoints and reads NDJSON events
            ├── products.js             API URL, price formatting, filters, match levels
            ├── deals.js                Deal score and fake-discount detection
            ├── palette.js              Saved colour palette and "Suits you" matching
            ├── assistant.js            Chat API call
            ├── accessoryTryOn.js       MediaPipe detection and product placement
            ├── tryon.js                Clothes try-on API call, saved photo
            ├── voice.js                Speech recognition hook
            ├── history.js              Recent searches in localStorage
            └── resizeImage.js          Shrink photos before upload; crop an item
```

## Features in detail

Each feature below says what the user sees, then how it works and where the code lives.

### Photo search

The user uploads, pastes or crops a product photo and gets Best matches, Cheaper lookalikes and Lowest prices.

1. The photo is shrunk in the browser (max 1600 px) and streamed to the backend.
2. Google Lens runs on it: SearchApi.io first (fast; needs the photo at a public Vercel Blob URL), SerpApi as the fallback.
3. Each listing's thumbnail is compared with the photo using CLIP; scores become "Very close" (0.88+), "Similar" (0.78+) or "Related".
4. Store pages are opened in parallel to read price, stock and the MRP; missing prices are filled from Google Shopping (Serper).
5. Preview results stream in first; the final, fully priced list follows. Code: `image_shopping_service.py`.

### Describe it (text search)

The user types or speaks a request such as "a laptop of 8gb ram with 500gb storage and company hp under 50k".

1. A rule-based reader pulls out budgets, numbers and units, brands and audience, including Hinglish ("ke andar", "se kam", "ladkon ke liye").
2. Sentence-style or Hindi requests also go to a Groq language model; rules win for numbers and budgets.
3. Google Shopping is searched (Serper, SerpApi as fallback) and listings are ranked by how many requirements they meet. Budgets are hard limits.
4. "Understood as" chips show what was read. Voice search uses the browser's speech recognition. Code: `query_understanding.py`, `llm_query_parser.py`, `text_shopping_service.py`, `voice.js`.

### Deals, dupes and fake discounts

- **Deal score:** each price is compared with the median of the results (at least 5 prices): "Great deal" at 75% or less, "Good price" at 90% or less, "Above typical" at 135% or more.
- **Cheaper lookalikes:** listings at least "Similar" to the photo costing at most 70% of the closest matches, with the saving shown.
- **Fake discount detector:** a claimed discount of 40%+ on a price no lower than similar listings is flagged "Discount looks inflated"; a real one says "Real discount". It needs a "was" price, from SerpApi or the MRP on the store page. Code: `deals.js`.

### Find the outfit

One photo of a person returns every item they wear, numbered on the photo, each with shopping options and the price of the whole look.

1. The photo is padded to a square and sent to a vision model (Gemini if configured, else Qwen on Groq) with a head-to-toe checklist; it returns up to 8 items with a description and a box.
2. Each item is searched on Google Shopping in parallel.
3. Listings are re-ranked by CLIP similarity to that item's crop from the photo; clear mismatches and prices over 4× typical are dropped.
4. **Exact match** runs a full photo search (Lens) on one item's crop. Code: `outfit_service.py`, `OutfitView.jsx`.

### Rate my outfit

A score out of 10 with four sub-scores (colours, fit, styling, occasion), what works, and 2–3 tips with listings.

1. The vision model lists what is worn, scores the rubric, and suggests new items with a price range; the overall score is the mean of the sub-scores.
2. Each tip is searched, then **listing judge** (GPT-OSS 120B on Groq) reads the titles and keeps only the right item, colour and material in the price range.
3. If the user saved a palette, tips prefer those colours. It judges clothes only, never the person. Code: `style_service.py`, `listing_judge.py`.

### Colours that suit you

A selfie returns a seasonal colour type (for example "Deep Autumn, warm"), best colours and less flattering ones. The palette is kept in the browser, never the selfie. Listings whose names mention a palette colour or synonym (burgundy for maroon) get "Suits you", and a "My colours" filter shows only those. Code: `style_service.py`, `palette.js`.

### Complete the look

On any product card: a Groq model suggests 3–4 items that go with it at the same price level, each with a reason; listings are checked by the listing judge.

### Plan on a budget

The "Plan" tab takes an occasion, who it's for and a total budget (or a budget in the sentence, such as "2k tak").

1. A Groq model plans 3–5 wearable pieces and splits the budget between them.
2. Each piece is searched; the listing judge keeps the right items within that piece's share.
3. One listing is picked per piece; while the total is over budget, the piece with the most to save steps down to a cheaper option.
4. The user can swap any piece ("Use in my look"); the total and the budget bar update. Code: `planner_service.py`, `PlanPanel.jsx`.

### Shop this room

Like Find the outfit, for a room photo: the vision model lists up to 8 pieces of furniture, lighting and decor with boxes; each is searched and re-ranked against its crop, with the price of the whole room. Code: `room_service.py`.

### Compare

Every card has a Compare checkbox. With 2 or 3 picked, the compare bar opens a side-by-side table: price, store and rating, the features a Groq model reads from the names (RAM, material, display…), each product's strong points, a best pick and a short verdict. Code: `compare_products` in `assistant_service.py`, `CompareDialog.jsx`.

### Ask AI (shopping assistant)

A chat panel over the results. The model sees only the listings on screen (name, price, store, rating, reviews), answers in English, Hindi or Hinglish, links its picks and can suggest a new search. Code: `assistant_service.py`, `AssistantChat.jsx`.

### Try on

- **Clothes:** the user's photo and the garment go to free Hugging Face try-on models (Leffa, IDM-VTON); about 20–40 s. Code: `tryon_service.py`, `TryOnDialog.jsx`.
- **Glasses and watches:** the backend cuts the product photo out of its background; in the browser MediaPipe finds the eyes or wrist on the user's photo and the real product is placed there, with size and position sliders. Only front-view product photos qualify. Code: `accessoryTryOn.js`, `AccessoryTryOnDialog.jsx`.

## External services and limits

Everything runs on free tiers, so the monthly search allowances and Groq's per-minute token limit are the real capacity limits. Keys live only in `backend/.env` locally and as encrypted environment variables on Vercel; they are never committed.

| Service | Used for | Key (env variable) | Free allowance |
| --- | --- | --- | --- |
| Serper.dev | Google Shopping for text search, outfit items, price fill | `SERPER_API_KEY` | 2,500 searches (one-time credit) |
| SerpApi | Google Lens fallback, Google Shopping fallback | `SERPAPI_API_KEY` | 250 searches a month |
| SearchApi.io | Fast Google Lens | `SEARCHAPI_API_KEY` | 100 searches a month |
| Vercel Blob | Public URL for the photo during a Lens search, deleted after | `BLOB_READ_WRITE_TOKEN` | Free with Vercel |
| Groq | All language and vision AI (Qwen3.8 27B, GPT-OSS 120B/20B) | `GROQ_API_KEY` | About 8,000 tokens a minute per model |
| Google Gemini (optional) | Better outfit, rating and colour vision | `GEMINI_API_KEY` | Google AI Studio free tier |
| Hugging Face | Clothes try-on Spaces (ZeroGPU) | `HF_TOKEN` (read-only) | A few GPU minutes a day |
| Google Lens / Shopping | The underlying search, reached through the three providers above | — | — |

The home page shows the searches left (`/api/v1/usage`).

**Built-in limits per visitor** (all configurable as env variables):

| Limit | Default | Applies to |
| --- | --- | --- |
| `SEARCH_LIMIT` / `SEARCH_WINDOW_SECONDS` | 10 per 600 s | Every uncached search, outfit, look and rating |
| `TRYON_LIMIT` / `TRYON_WINDOW_SECONDS` | 5 per 600 s | Clothes try-ons |
| `ASSISTANT_LIMIT` | 30 per 600 s | Ask AI questions |
| `STYLE_LIMIT` | 10 per 600 s | Colour checks |

Repeated searches are served from an in-memory cache and cost nothing.

## Backend API reference

All routes are under the backend URL (`http://127.0.0.1:8000` locally). Interactive docs with every field are at `/docs`. Routes ending in `/stream` reply with **NDJSON**: one JSON event per line (`stage`, progress events, then `final` or `error`), so the page can show results as they arrive.

| Method | Path | Input | Returns |
| --- | --- | --- | --- |
| GET | `/health` | — | Server status |
| GET | `/api/v1/usage` | — | Searches left per provider |
| POST | `/api/v1/products/search-by-image` | `file` (image), optional `query` | Best matches, lowest prices, dupes |
| POST | `/api/v1/products/search-by-image/stream` | Same | Streams `stage`, `identified`, `preview`, `final` |
| POST | `/api/v1/products/recognize-image` | `file` | What the photo shows (search query) |
| POST | `/api/v1/products/search-by-text` | JSON `{query}` | Results + `understood` chips |
| POST | `/api/v1/products/search-by-text/stream` | JSON `{query}` | Streams `stage`, `final` |
| POST | `/api/v1/outfit/stream` | `file` (photo of a person) | Streams `items` (with boxes), one `item` per item, `final` |
| POST | `/api/v1/look/stream` | JSON `{name, price?}` | Complete the look, streamed like the outfit |
| POST | `/api/v1/style/rate/stream` | `file`, optional `colours` (comma list) | Streams `rating`, `items`, `item`, `final` |
| POST | `/api/v1/style/colours` | `file` (selfie) | `{undertone, season, summary, best, avoid}` |
| POST | `/api/v1/assistant` | JSON `{messages, products, query}` | `{reply, picks, search}` |
| POST | `/api/v1/compare` | JSON `{products (2–3), query}` | `{attributes, pros, best, verdict}` |
| POST | `/api/v1/room/stream` | `file` (room photo) | Streams `items`, one `item` per piece, `final` with `style` |
| POST | `/api/v1/plan/stream` | JSON `{request, budget?, gender?}` | Streams `plan`, `items`, `item`, `final` with `picks` and `total` |
| POST | `/api/v1/tryon` | Person photo + garment | Try-on image (JPEG) |
| GET | `/api/v1/tryon/overlay` | `url`, `category` (`glasses`/`watch`) | Cut-out PNG; lens centres in `X-Lens-Centres` |

Errors return a JSON `detail` message safe to show users; 429 means a per-visitor limit was reached (with `Retry-After`).

## Running it locally

You need Python 3.13, Node.js 20 or newer, and at least one search key (Serper or SerpApi). Two terminals: one for the backend on port 8000, one for the frontend on port 5173.

**1. Backend** (from the repo root):

```bash
cd backend
python -m venv ../myvenv
../myvenv/Scripts/activate        # macOS/Linux: source ../myvenv/bin/activate
pip install -r requirements.txt   # includes PyTorch for CLIP (large download)
cp .env.example .env              # then fill in your own keys
uvicorn main:app --host 127.0.0.1 --port 8000
```

**2. Frontend** (second terminal):

```bash
cd frontend
npm install
npm run dev                       # opens http://127.0.0.1:5173
```

The frontend calls `http://127.0.0.1:8000` by default; set `VITE_API_URL` in `frontend/.env.local` to point it elsewhere.

**Which keys enable what** (all in `backend/.env`; see the services table above):

- Minimum: `SERPER_API_KEY` or `SERPAPI_API_KEY` → text and photo search.
- `SEARCHAPI_API_KEY` + `BLOB_READ_WRITE_TOKEN` → faster photo search.
- `GROQ_API_KEY` → sentence understanding, Find the outfit, Rate my outfit, Colours, Complete the look, Ask AI.
- `GEMINI_API_KEY` (optional) → better outfit, rating and colour vision.
- `HF_TOKEN` (read-only) → clothes try-on.

On Windows, start uvicorn without `--reload`; the reloader can stall. After changing backend code, restart the server.

## Testing and quality checks

Run all three checks before every push; they take under a minute together.

| Check | Command | What it covers |
| --- | --- | --- |
| Backend tests | `cd backend && pip install -r requirements-dev.txt && pytest -q` | 264 tests: ranking, prices, Hinglish parsing, outfit, rating, colours, judge, API routes |
| Lint | `cd frontend && npx eslint src` | React and hooks rules |
| Build | `cd frontend && npx vite build` | The production bundle compiles |

The tests never call real services: search providers, Groq and CLIP are replaced with fakes, and a fixture removes all API keys so nothing is spent. GitHub Actions (`.github/workflows/backend.yml`) runs the backend tests on every push that touches `backend/`.

New features were also checked end to end in Chrome with headless browser scripts (upload a photo, click through, screenshot), against the real services.

## Deployment on Vercel

A push to the `main` branch on GitHub deploys both projects automatically; no manual step is needed.

| Vercel project | Root folder | URL | Notes |
| --- | --- | --- | --- |
| `snapbuy-ai` | `frontend` | [snapbuy-ai.vercel.app](https://snapbuy-ai.vercel.app) | Static build; `VITE_API_URL` points at the backend |
| `snapbuy-ai-api` | `backend` | [snapbuy-ai-api.vercel.app](https://snapbuy-ai-api.vercel.app) | Python serverless function (`main.py`), up to 300 s per request |

How a release goes:

1. Run the checks in the Testing section.
2. `git push origin main`.
3. Watch both builds turn **Ready** (`vercel ls snapbuy-ai` and `vercel ls snapbuy-ai-api`, or the Vercel dashboard).
4. Hard-refresh the site (Ctrl + Shift + R) and try the changed feature.

**Secrets:** API keys are stored on Vercel as encrypted (sensitive) environment variables, added with `vercel env add NAME production --sensitive`. `.env` files are git-ignored and excluded by `.vercelignore`. Never paste a key into code, chat or a commit.

**Serverless notes:** the backend uses a slimmed CLIP image encoder (fp16, 176 MB) that fits Vercel's limits and caches in `/tmp`. The first search after a quiet period is slower while it loads (a cold start).

## Troubleshooting, limits and glossary

| Problem | Likely cause | Fix |
| --- | --- | --- |
| "Can't reach the SnapBuy server" | Backend not running, or wrong `VITE_API_URL` | Start uvicorn on port 8000; check the URL |
| "The outfit AI is busy right now" | Groq's per-minute token limit (shared by outfit, rating, colours) | Wait a minute; add `GEMINI_API_KEY` to spread the load |
| "Try-on is busy" on clothes | Hugging Face free GPU quota used up for the day | Try later; it refills daily |
| No "Try on" on glasses or watches | The product photo is angled or has a busy background | Expected: only front-view, plain photos can be placed realistically |
| Search says the limit is reached | Per-visitor limit (10 searches per 10 minutes) | Wait, or raise `SEARCH_LIMIT` |
| First search very slow on the live site | Serverless cold start loading CLIP | Normal; later searches are fast |
| No fake-discount labels on a text search | Serper results carry no "was" price | Expected; photo searches read the MRP from store pages |
| Changes not visible after deploy | Browser cached the old bundle | Hard-refresh (Ctrl + Shift + R) |

**Known limits:** search capacity depends on free monthly allowances; Rate my outfit tips can show only 2–3 listings when the AI check is strict; colour matching relies on colour words in listing titles.

**Glossary**

| Term | Meaning |
| --- | --- |
| Google Lens | Google's search-by-image; finds web pages and shops showing a similar product |
| Google Shopping | Google's product listings with prices from many stores |
| CLIP | An AI model that turns images into numbers so two photos can be compared for likeness (0 to 1) |
| Groq | A fast AI inference service with a free tier; hosts the language and vision models used here |
| Vision model | An AI that reads images and answers in text (here: lists outfit items, scores outfits, reads colouring) |
| Listing judge | A second AI pass that keeps only listings that are really the suggested item |
| MediaPipe | Google's on-device vision library; finds face and hand points in the browser |
| ZeroGPU | Hugging Face's shared free GPUs for Spaces; used by the clothes try-on |
| NDJSON / streaming | Newline-delimited JSON: the server sends events one per line so results appear as they arrive |
| MRP | Maximum Retail Price printed on Indian store pages; used as the "was" price |
| Dupe | A cheaper listing that looks like the product you searched for |
| Cold start | The delay when a serverless function starts after being idle |
