import json

import pytest
from fastapi.testclient import TestClient

import image_shopping_service as s
import main

SEARCH = "/api/v1/products/search-by-image"
STREAM = "/api/v1/products/search-by-image/stream"


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def fake_search(monkeypatch):
    """Replace the online search; records how often it really runs."""
    calls = []

    def search(image_path, max_results, on_event=None):
        calls.append(image_path)
        if on_event:
            on_event("identified", {"online_search_query": "watch"})
            on_event("preview", {
                "best_matches": [{"name": "Watch", "price": None, "pending": True}],
                "cheapest_alternatives": [],
                "online_search_query": "watch",
            })
        return {
            "best_matches": [{"name": "Watch", "price": 999.0, "pending": False}],
            "cheapest_alternatives": [],
            "online_search_query": "watch",
        }

    monkeypatch.setattr(main, "search_online_products", search)
    return calls


def upload(client, path, data):
    return client.post(path, files={"file": ("photo.png", data, "image/png")})


def test_health(client):
    assert client.get("/health").json() == {"status": "healthy"}


def test_rejects_empty_and_non_image_uploads(client):
    assert upload(client, SEARCH, b"").status_code == 400
    response = client.post(SEARCH, files={"file": ("a.txt", b"hello", "text/plain")})
    assert response.status_code == 415


def test_repeat_search_is_served_from_cache(client, fake_search, png_bytes):
    first = upload(client, SEARCH, png_bytes("red")).json()
    second = upload(client, SEARCH, png_bytes("red")).json()
    other = upload(client, SEARCH, png_bytes("blue")).json()

    assert (first["cached"], second["cached"], other["cached"]) == (False, True, False)
    assert len(fake_search) == 2


def test_stream_sends_events_in_order(client, fake_search, png_bytes):
    with client.stream("POST", STREAM, files={"file": ("p.png", png_bytes("green"), "image/png")}) as r:
        assert r.headers["content-type"].startswith("application/x-ndjson")
        events = [json.loads(line) for line in r.iter_lines() if line]

    assert [e["type"] for e in events] == ["stage", "identified", "preview", "final"]
    assert events[2]["best_matches"][0]["pending"] is True
    assert events[3]["best_matches"][0]["price"] == 999.0


def test_stream_reports_search_failures(client, monkeypatch, png_bytes):
    def failing(*args, **kwargs):
        raise RuntimeError("SerpApi down")

    monkeypatch.setattr(main, "search_online_products", failing)
    with client.stream("POST", STREAM, files={"file": ("p.png", png_bytes("teal"), "image/png")}) as r:
        events = [json.loads(line) for line in r.iter_lines() if line]

    assert [e["type"] for e in events] == ["stage", "error"]


def test_search_limit(client, fake_search, png_bytes, monkeypatch):
    monkeypatch.setattr(main, "SEARCH_LIMIT", 2)

    assert upload(client, SEARCH, png_bytes("red")).status_code == 200
    assert upload(client, SEARCH, png_bytes("green")).status_code == 200

    blocked = upload(client, STREAM, png_bytes("blue"))
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers

    # Cached results are free even when over the limit.
    assert upload(client, SEARCH, png_bytes("red")).json()["cached"] is True


def test_lens_retries_once_when_empty(monkeypatch, tmp_path):
    image = tmp_path / "photo.jpg"
    image.write_bytes(b"\xff\xd8 fake jpeg")
    monkeypatch.setenv("SERPAPI_API_KEY", "test")
    monkeypatch.setattr(s.requests, "post", lambda *a, **k: _Json({"image_id": "img"}))

    no_cache_flags = []
    matches = [
        {"title": "G Shock watch", "source": "finebuy", "link": "https://finebuy.co.in/product/a/"},
        {"title": "G Shock watch", "source": "finebuy", "link": "https://finebuy.co.in/product/b/"},
        {"title": "Other watch", "source": "Flipkart", "link": "https://www.flipkart.com/x/p/itm1"},
    ]

    def fake_get(url, params, timeout):
        no_cache_flags.append(params.get("no_cache"))
        return _Json({"search_metadata": {}} if len(no_cache_flags) == 1 else {"visual_matches": matches})

    monkeypatch.setattr(s.requests, "get", fake_get)

    candidates = s.run_google_lens(image)
    assert no_cache_flags == [None, "true"]
    # The same listing under two URLs is kept once.
    assert [c["link"] for c in candidates] == [
        "https://finebuy.co.in/product/a/",
        "https://www.flipkart.com/x/p/itm1",
    ]


class _Json:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data
