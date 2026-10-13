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


def test_keeps_only_relevant_priced_listings(fake_shopping):
    result = t.search_products_by_text(QUERY, max_results=10)
    products = result["best_matches"] + result["cheapest_alternatives"]
    names = [p["name"] for p in products]

    assert result["online_search_query"] == QUERY
    assert all(p["price"] and p["product_url"] and p["currency"] == "INR" for p in products)
    assert all(p["text_relevance_score"] >= t.MIN_RELEVANCE for p in products)
    # G-Shock listings are kept, including ones that don't say "watch"...
    assert "Casio G-Shock Men's Mudmaster GWG-1000-1A3ER" in names
    # ...but a different Casio line, and entries without a price, are not.
    assert "Casio Men EDIFICE" not in names
    assert not any(n.startswith("GA-B010-3A |") for n in names)


def test_best_matches_keep_google_order(fake_shopping):
    best = t.search_products_by_text(QUERY, max_results=3)["best_matches"]
    assert [p["marketplace"] for p in best] == ["clesso.co.in", "FancyAdda", "ubuy.co.in"][:2] + [best[2]["marketplace"]]
    order = [item.get("title") for item in SAMPLE["shopping_results"]]
    positions = [order.index(p["name"]) for p in best]
    assert positions == sorted(positions)


def test_cheapest_are_sorted_and_relevant(fake_shopping):
    result = t.search_products_by_text(QUERY, max_results=3)
    cheapest = result["cheapest_alternatives"]
    prices = [p["price"] for p in cheapest]

    assert prices == sorted(prices)
    assert all(p["text_relevance_score"] >= t.MIN_RELEVANCE for p in cheapest)
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


@pytest.mark.parametrize(
    "item, condition",
    [
        ({"title": "Refurbished Apple iPhone 15 Yellow by Cashify"}, "refurbished"),
        ({"title": "Apple iPhone 15 128GB Blue Fair - Renewed"}, "refurbished"),
        ({"title": "Used Apple iPhone 15 5G 128GB Black"}, "used"),
        ({"title": "Apple iPhone 15", "second_hand_condition": "Pre-owned"}, "used"),
        ({"title": "Apple iPhone 15 (128 GB) - Black"}, None),
    ],
)
def test_item_condition(item, condition):
    assert t.item_condition(item) == condition


def test_old_price_ignored_unless_higher():
    item = {"title": "x", "price": "₹500", "extracted_price": 500, "extracted_old_price": 400,
            "product_link": "https://www.google.com/x"}
    assert t.build_shopping_product(item, "x")["original_price"] is None


def test_relevance_basics():
    assert t.relevance("Casio G-Shock GA-2100 Green Watch", "casio green watch") == 1.0
    assert t.relevance("Silicone strap", "casio green watch") == 0.0


@pytest.mark.parametrize(
    "title, query, relevant",
    [
        # Plurals and possessives match.
        ("Women's Pure Cotton Kurtis", "cotton kurti for women", True),
        ("Nike Men Quest 6 Running Shoe", "Nike running shoes for men", True),
        # Synonyms for the product type.
        ("boAt Airdopes 71 Gen 2 TWS 45h Battery", "boAt wireless earbuds", True),
        ("Max Women Solid Straight Kurta", "cotton kurti for women", True),
        # The product type itself must match.
        ("Nike Pegasus Premium", "Nike running shoes for men", False),
        ("boAt Rockerz 450 Headphones", "boAt wireless earbuds", False),
        # Accessories for the product, unless asked for.
        ("Silicone Strap for Casio G-Shock Watch", "casio g-shock watch", False),
        ("Clear Case Cover for iPhone 15", "iphone 15", False),
        ("Silicone Strap for Casio G-Shock Watch", "casio g-shock watch strap for", True),
        # A transparent charging case is part of the product, not an accessory.
        ("boAt Nirvana Crystl, Transparent Case, Spatial Audio TWS", "boAt wireless earbuds", True),
        # Model words (hyphenated names, numbers) must match.
        ("Casio Enticer Men Green Stainless Steel Watch", "casio g-shock green watch", False),
        ("Casio G-Shock Men's Mudmaster GWG-1000", "casio g-shock green watch", True),
        ("G SHOCK GA2100 METAL MENS WATCH", "casio g-shock watch", True),
        ("Apple iPhone 14 128GB Midnight", "iphone 15", False),
        ("Apple iPhone 15 (128 GB) - Black", "iphone 15", True),
        # Sets and combos, unless asked for.
        ("Women's Cotton Kurta Set with Palazzo & Dupatta", "cotton kurti for women", False),
        ("Women's Cotton Kurta Set with Palazzo & Dupatta", "cotton kurta set", True),
    ],
)
def test_relevance_rules(title, query, relevant):
    assert (t.relevance(title, query) >= t.MIN_RELEVANCE) is relevant


def shopping_item(title, price, source="Store", link=None):
    return {
        "title": title,
        "source": source,
        "price": f"₹{price}",
        "extracted_price": price,
        "product_link": link or f"https://www.google.com/shopping/{abs(hash((title, source, price)))}",
    }


def test_duplicates_imports_and_price_outliers(monkeypatch):
    items = [
        shopping_item("boAt Airdopes 141 Wireless Earbuds", 1099, "Flipkart"),
        shopping_item("boAt Airdopes 141 Wireless Earbuds (Black)", 1099, "Flipkart"),  # duplicate
        shopping_item("boAt Airdopes 311 Pro Wireless Earbuds", 17753, "desertcart.in"),  # import
        shopping_item("boAt Airdopes 161 Wireless Earbuds", 899, "Amazon.in"),
        shopping_item("boAt Airdopes 181 Pro Wireless Earbuds", 1399, "Myntra"),
        shopping_item("boAt Airdopes 131 Wireless Earbuds", 999, "AJIO"),
        shopping_item("boAt Airdopes 91 Wireless Earbuds", 129, "Shady Store"),  # too cheap
        shopping_item("boAt Airdopes 213 Wireless Earbuds", 4599, "Overpriced"),  # too pricey
        shopping_item("Silicone Case for boAt Wireless Earbuds", 199, "Accessories"),  # accessory
    ]
    monkeypatch.setattr(t, "run_google_shopping", lambda query: items)

    result = t.search_products_by_text("boAt wireless earbuds", max_results=3)
    names = lambda section: [p["name"] for p in result[section]]

    all_names = names("best_matches") + names("cheapest_alternatives")
    assert "boAt Airdopes 141 Wireless Earbuds (Black)" not in all_names
    assert "Silicone Case for boAt Wireless Earbuds" not in all_names
    assert names("best_matches") == [
        "boAt Airdopes 141 Wireless Earbuds",
        "boAt Airdopes 161 Wireless Earbuds",
        "boAt Airdopes 181 Pro Wireless Earbuds",
    ]
    # Lowest prices: no import, nothing absurdly cheap or far above typical.
    assert names("cheapest_alternatives") == ["boAt Airdopes 131 Wireless Earbuds"]


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
