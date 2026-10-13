---
title: SnapBuy AI API
emoji: 🛍️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
short_description: Visual product search API (Google Lens + CLIP)
---

# SnapBuy AI — backend

FastAPI service behind [SnapBuy AI](https://github.com/itskunalkanaujiya/SnapBuyAI):
upload a product photo and get matching listings from online stores in India,
ranked by visual similarity, with prices and stock.

The header above configures the Hugging Face Space this folder is deployed
to. See the [main README](https://github.com/itskunalkanaujiya/SnapBuyAI#readme)
for the full project, API and local setup.

## Configuration (Space settings → Variables and secrets)

| Name | Type | Purpose |
|---|---|---|
| `SERPAPI_API_KEY` | **Secret** | Required. SerpApi key for Google Lens |
| `ALLOWED_ORIGINS` | Variable | The frontend's address, e.g. `https://snapbuy-ai.vercel.app` |
| `ALLOWED_ORIGIN_REGEX` | Variable | Optional, to allow Vercel preview URLs |
| `SEARCH_LIMIT` / `SEARCH_WINDOW_SECONDS` | Variable | Optional. Defaults: 10 searches per 600 s per visitor |
