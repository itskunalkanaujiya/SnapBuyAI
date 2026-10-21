import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import gift_service as g
import list_service as l
import llm_query_parser as q
import main
import outfit_service as o
import price_watch_service as w
from conftest import FakeResponse


def reply(data):
    return FakeResponse(data={"choices": [{"message": {"content": json.dumps(data)}}]})


def listing(name, price, store="Amazon.in"):
    return {"name": name, "price": price, "marketplace": store, "product_url": f"https://shop/{name}"}


@pytest.fixture
def model(monkeypatch):
    """Fake Groq; `answers` are used in order, the last one repeats."""
    state = {"answers": [{}], "sent": []}

    def post(url, headers, json, timeout):
        state["sent"].append(json)
        answer = state["answers"][0] if len(state["answers"]) == 1 else state["answers"].pop(0)
        return reply(answer)

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(q.requests, "post", post)
    return state


# ---------- Gift finder ----------

GIFTS = {
    "title": "Gym gifts for your brother",
    "recipient": "brother",
    "gender": "men",
    "ideas": [
        {"type": "resistance bands", "description": "latex resistance loop bands set", "reason": "Home workouts", "price": 500},
        {"type": "massage gun", "description": "mini percussion massage gun", "reason": "Recovery", "price": "₹2,500"},
        {"type": "gym towel", "description": "microfiber quick dry gym towel", "reason": "Sweat"},
        {"type": "gym towel", "description": "cotton towel"},
    ],
}


def test_gift_ideas_are_read_within_budget():
    gifts = g.read_ideas(GIFTS, 2000)

    assert [item["type"] for item in gifts["items"]] == ["resistance bands", "massage gun", "gym towel"]
    assert gifts["items"][0]["price_range"] == [150, 2000]
    assert gifts["items"][1]["price_range"] == [600, 2000]  # 2,500 capped at the budget
    assert gifts["recipient"] == "brother" and gifts["gender"] == "men"


def test_gift_budget_from_hinglish():
    assert g.read_budget("bhai ke liye, gym ka shauk hai, 2000 tak") == 2000
    assert g.read_budget("gift for mom") is None


def test_find_gifts_drops_listings_over_budget(model, monkeypatch):
    model["answers"] = [GIFTS]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(f"{q} pro", 9000), listing(f"{q} basic", 900)], "cheapest_alternatives": []})
    events = []

    gifts = g.find_gifts("bhai ke liye gym gift 2000 tak", on_event=lambda kind, data: events.append(kind))

    assert events[0] == "gifts"
    assert all(p["price"] <= 2200 for item in gifts["items"] for p in item["best_matches"])
    assert gifts["budget"] == 2000


def test_gifts_need_a_recipient():
    with pytest.raises(g.GiftError, match="who the gift is for"):
        g.find_gifts("hi")


def test_gift_endpoint(model, monkeypatch):
    model["answers"] = [GIFTS]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(q, 400)], "cheapest_alternatives": []})
    response = TestClient(main.app).post("/api/v1/gifts/stream", json={"request": "gift for my brother", "budget": 2000})
    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert [e["type"] for e in events][:2] == ["stage", "gifts"] and events[-1]["type"] == "final"
    assert events[-1]["title"] == "Gym gifts for your brother"


# ---------- Snap your shopping list ----------

DIWALI = {
    "title": "Diwali list",
    "items": [
        {"line": "kurta for papa", "type": "kurta", "description": "men cotton kurta", "quantity": 1},
        {"line": "2 diya sets", "type": "diya set", "description": "clay diya set", "quantity": "2"},
        {"line": "saree for mummy 3000 tak", "type": "saree", "description": "women silk saree", "budget": "3000"},
        {"line": "heading", "type": "", "description": ""},
    ],
}


def test_list_lines_keep_quantity_and_budget():
    shopping_list = l.read_list(DIWALI)

    assert [item["type"] for item in shopping_list["items"]] == ["kurta", "diya set", "saree"]
    assert [item["quantity"] for item in shopping_list["items"]] == [1, 2, 1]
    assert shopping_list["items"][2]["budget"] == 3000
    assert shopping_list["items"][2]["price_range"] == [900, 3450]


def test_typed_list_is_shopped_and_totalled(model, monkeypatch):
    model["answers"] = [DIWALI]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(f"{q} pure silver", 12000), listing(f"{q} classic", 600), listing(f"{q} basic", 400)],
        "cheapest_alternatives": []})

    cart = l.shop_list(text="Diwali list: kurta for papa, 2 diya sets, saree for mummy 3000 tak")

    # Lines without a budget take the best listing around the typical (median) price, not the
    # ₹12,000 one; the saree's 3,000 budget rules that one out too.
    assert all(key.endswith("classic") for key in cart["picks"].values())
    assert cart["total"] == 600 + 2 * 600 + 600
    assert cart["items"][0]["budget"] is None and cart["items"][2]["budget"] == 3000
    assert model["sent"][0]["messages"][0]["content"].startswith("Read this shopping list:\n\nDiwali list")


def test_photo_list_uses_the_vision_model(model, monkeypatch):
    model["answers"] = [DIWALI]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(q, 100)], "cheapest_alternatives": []})

    cart = l.shop_list(image=Image.new("RGB", (400, 600), "white"))

    content = model["sent"][0]["messages"][0]["content"]
    assert content[0]["text"].startswith("Read the shopping list in this photo")
    assert content[1]["type"] == "image_url"
    assert cart["total"] == 100 + 200 + 100


def test_unreadable_list(model):
    model["answers"] = [{"title": "", "items": []}]
    with pytest.raises(l.ListError, match="Couldn't read"):
        l.shop_list(text="hello there")


def test_list_endpoint_text_and_errors(model, monkeypatch):
    model["answers"] = [DIWALI]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(q, 100)], "cheapest_alternatives": []})
    client = TestClient(main.app)

    response = client.post("/api/v1/list/stream", data={"text": "kurta for papa, 2 diya sets"})
    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert [e["type"] for e in events][:2] == ["stage", "list"] and events[-1]["total"] == 400

    assert client.post("/api/v1/list/stream", data={"text": "a"}).status_code == 400


# ---------- Price watch ----------


def test_store_pages_and_google_links():
    assert w.is_store_page("https://www.myntra.com/shirts/123")
    assert not w.is_store_page("https://www.google.com/search?ibp=oshop&q=towel")
    assert not w.is_store_page("")


def test_price_from_the_store_page(monkeypatch):
    monkeypatch.setattr(w, "fetch_page_details", lambda url: {"price": 799.0, "original_price": 1999.0, "availability": "in_stock"})
    result = w.check_item({"id": "a", "name": "Kurta", "product_url": "https://www.myntra.com/k/1", "marketplace": "Myntra", "price": 999})
    assert result == {"id": "a", "price": 799.0, "original_price": 1999.0, "availability": "in_stock", "source": "store page", "status": "down"}


def test_google_shopping_match_picks_the_closest_listing(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "s")
    offers = [
        {"title": "Boldfit Microfiber Gym Towel Quick Dry Blue", "source": "Amazon.in", "price": "₹549"},
        {"title": "Boldfit Microfiber Gym Towel Quick Dry Blue", "source": "Amazon.in", "price": "₹379"},
        {"title": "Boldfit Microfiber Gym Towel Quick Dry Blue", "source": "Flipkart", "price": "₹199"},
        {"title": "Cotton bath towel set", "source": "Amazon.in", "price": "₹99"},
    ]
    import text_shopping_service

    monkeypatch.setattr(text_shopping_service, "run_serper_shopping", lambda query: offers)
    item = {"id": "t", "name": "Boldfit Microfiber Gym Towel Quick Dry Blue", "product_url": "https://www.google.com/x",
            "marketplace": "amazon.in", "price": 399}

    result = w.check_item(item)

    # Same store only, the near-identical listing nearest the last price (379, not 549).
    assert (result["price"], result["status"], result["source"]) == (379, "down", "Google Shopping")


def test_a_wild_jump_is_not_an_alert(monkeypatch):
    monkeypatch.setattr(w, "fetch_page_details", lambda url: {"price": 99.0})
    result = w.check_item({"id": "a", "name": "Watch", "product_url": "https://shop.in/w", "marketplace": "Shop", "price": 4999})
    assert result["status"] == "unknown" and result["price"] is None


def test_unknown_when_nothing_found(monkeypatch):
    monkeypatch.setattr(w, "fetch_page_details", lambda url: {"price": None})
    result = w.check_item({"id": "a", "name": "Thing", "product_url": "https://shop.in/t", "marketplace": "Shop", "price": 100})
    assert result["status"] == "unknown"


def test_price_check_endpoint(monkeypatch):
    monkeypatch.setattr(w, "fetch_page_details", lambda url: {"price": 450.0})
    client = TestClient(main.app)
    body = {"items": [{"id": "1", "name": "Towel", "product_url": "https://shop.in/1", "marketplace": "Shop", "price": 500}]}

    response = client.post("/api/v1/prices/check", json=body)
    assert response.status_code == 200
    assert response.json()["results"][0]["status"] == "down"

    assert client.post("/api/v1/prices/check", json={"items": []}).status_code == 400
    for _ in range(main.WATCH_LIMIT):
        client.post("/api/v1/prices/check", json=body)
    assert client.post("/api/v1/prices/check", json=body).status_code == 429
