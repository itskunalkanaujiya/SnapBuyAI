import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
import text_shopping_service as t

# Trimmed real Google Shopping response for "casio g-shock green watch" (gl=in).
SAMPLE = json.loads(
    (Path(__file__).parent / "fixtures" / "google_shopping_sample.json").read_text(encoding="utf-8")
)
QUERY = "casio g-shock green watch"

TEXT = "/api/v1/products/search-by-text"
TEXT_STREAM = "/api/v1/products/search-by-text/stream"


@pytest.fixture
def fake_shopping(monkeypatch):
    calls = []

    def run(query):
        calls.append(query)
        return SAMPLE["shopping_results"]

    monkeypatch.setattr(t, "run_google_shopping", run)
    return calls


def test_keeps_only_priced_listings_with_links(fake_shopping):
    result = t.search_products_by_text(QUERY, max_results=10)
    products = result["best_matches"] + result["cheapest_alternatives"]

    assert result["online_search_query"] == QUERY
    assert len(result["best_matches"]) == 10
    assert all(p["price"] and p["product_url"] and p["currency"] == "INR" for p in products)
    # The two sample entries without a price or link are dropped.
    assert not any(p["name"].startswith("GA-B010-3A") for p in products)


def test_best_matches_keep_google_order(fake_shopping):
    best = t.search_products_by_text(QUERY, max_results=3)["best_matches"]
    assert [p["marketplace"] for p in best] == ["clesso.co.in", "BlackTree", "FancyAdda"]


def test_cheapest_are_sorted_and_relevant(fake_shopping):
    result = t.search_products_by_text(QUERY, max_results=3)
    cheapest = result["cheapest_alternatives"]
    prices = [p["price"] for p in cheapest]

    assert prices == sorted(prices)
    assert all(p["text_relevance_score"] >= t.MIN_QUERY_OVERLAP for p in cheapest)
    best_urls = {p["product_url"] for p in result["best_matches"]}
    assert not best_urls & {p["product_url"] for p in cheapest}


def test_shopping_product_fields():
    item = {
        "title": "Casio G-Shock GA-2100 Green",
        "source": "AJIO",
        "price": "₹7,995",
        "extracted_price": 7995,
        "old_price": "₹9,995",
        "extracted_old_price": 9995,
        "product_link": "https://www.google.com/search?ibp=oshop&prds=productid:1",
        "rating": 4.5,
        "reviews": 120,
        "multiple_sources": True,
    }
    product = t.build_shopping_product(item, QUERY)

    assert product["result_type"] == "shopping"
    assert product["price_text"] == "₹7,995"
    assert product["original_price_text"] == "₹9,995"
    assert (product["rating"], product["reviews"]) == (4.5, 120)
    assert product["multiple_sources"] is True
    assert product["visual_similarity_score"] is None


def test_old_price_ignored_unless_higher():
    item = {"title": "x", "price": "₹500", "extracted_price": 500, "extracted_old_price": 400,
            "product_link": "https://www.google.com/x"}
    assert t.build_shopping_product(item, "x")["original_price"] is None


def test_query_overlap():
    assert t.query_overlap("Casio G-Shock GA-2100 Green Watch", "casio green watch") == 1.0
    assert t.query_overlap("Silicone strap", "casio green watch") == 0.0


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def fake_text_search(monkeypatch):
    calls = []

    def search(query, max_results):
        calls.append(query)
        return {
            "best_matches": [{"name": "Watch", "price": 999.0, "result_type": "shopping"}],
            "cheapest_alternatives": [],
            "online_search_query": query,
        }

    monkeypatch.setattr(main, "search_shopping_text", search)
    return calls


def test_text_search_endpoint_and_cache(client, fake_text_search):
    first = client.post(TEXT, json={"query": "  Casio  G-Shock "}).json()
    second = client.post(TEXT, json={"query": "casio g-shock"}).json()

    assert first["online_search_query"] == "Casio G-Shock"
    assert (first["cached"], second["cached"]) == (False, True)
    assert fake_text_search == ["Casio G-Shock"]


def test_text_search_rejects_short_queries(client, fake_text_search):
    response = client.post(TEXT, json={"query": " a "})
    assert response.status_code == 400
    assert client.post(TEXT, json={}).status_code == 422
    assert fake_text_search == []


def test_text_search_stream(client, fake_text_search):
    with client.stream("POST", TEXT_STREAM, json={"query": "boat earbuds"}) as r:
        events = [json.loads(line) for line in r.iter_lines() if line]

    assert [e["type"] for e in events] == ["stage", "final"]
    assert events[0]["stage"] == "searching"
    assert events[1]["online_search_query"] == "boat earbuds"


def test_text_and_photo_searches_share_the_limit(client, fake_text_search, monkeypatch):
    monkeypatch.setattr(main, "SEARCH_LIMIT", 1)
    assert client.post(TEXT, json={"query": "first"}).status_code == 200
    assert client.post(TEXT_STREAM, json={"query": "second"}).status_code == 429
