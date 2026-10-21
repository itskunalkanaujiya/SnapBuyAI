import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import assistant_service as a
import llm_query_parser as q
import main
import outfit_service as o
import planner_service as p
import room_service as r
from conftest import FakeResponse


def reply(data):
    return FakeResponse(data={"choices": [{"message": {"content": json.dumps(data)}}]})


@pytest.fixture
def model(monkeypatch):
    """Fake Groq for every model call; `answers` is used in order, the last one repeats."""
    state = {"answers": [{}], "sent": []}

    def post(url, headers, json, timeout):
        state["sent"].append(json)
        answer = state["answers"][0] if len(state["answers"]) == 1 else state["answers"].pop(0)
        return reply(answer)

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(q.requests, "post", post)
    monkeypatch.setattr(o, "load_clip_model", lambda: (None, None))
    monkeypatch.setattr(r, "load_clip_model", lambda: (None, None))
    monkeypatch.setattr(o, "download_thumbnails", lambda candidates, deadline=None: [None] * len(candidates))
    monkeypatch.setattr(o, "compute_visual_similarity_scores", lambda image, candidates, thumbnails=None: {})
    return state


def listing(name, price):
    return {"name": name, "price": price, "product_url": f"https://shop/{name}"}


# ---------- Shop this room ----------

ROOM = {
    "style": "modern rustic living room",
    "items": [
        {"type": "sofa", "description": "tan suede two seater sofa", "box": [0, 470, 370, 980]},
        {"type": "rug", "description": "grey textured area rug", "box": [230, 600, 900, 980]},
    ],
}


def test_room_pieces_are_found_and_searched(model, monkeypatch):
    model["answers"] = [ROOM]
    searched = []

    def search(query, max_results, understand, min_relevance=None):
        searched.append(query)
        return {"best_matches": [listing(query, 5000)], "cheapest_alternatives": []}

    monkeypatch.setattr(o, "search_products_by_text", search)
    events = []

    room = r.find_room(Image.new("RGB", (1000, 1000)), on_event=lambda kind, data: events.append(kind))

    assert room["style"] == "modern rustic living room"
    assert [item["id"] for item in room["items"]] == ["piece-1", "piece-2"]
    # Rooms aren't for a gender: the description is the search.
    assert sorted(searched) == ["grey textured area rug", "tan suede two seater sofa"]
    assert events == ["items", "item", "item"]
    prompt = model["sent"][0]["messages"][0]["content"][0]["text"]
    assert "interior stylist" in prompt and "car pillows" in prompt


def test_not_a_room(model):
    model["answers"] = [{"style": "", "items": []}]
    with pytest.raises(o.OutfitError, match="furniture or decor"):
        r.find_room(Image.new("RGB", (100, 100)))


def test_room_endpoint_streams(model, monkeypatch, png_bytes):
    model["answers"] = [ROOM]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(q, 1000)], "cheapest_alternatives": []})

    response = TestClient(main.app).post("/api/v1/room/stream", files={"file": ("room.png", png_bytes("grey"), "image/png")})

    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert [e["type"] for e in events] == ["stage", "items", "item", "item", "final"]
    assert events[-1]["style"] == "modern rustic living room"


# ---------- Budget look planner ----------

PLAN = {
    "title": "Classic navy wedding guest look",
    "gender": "men",
    "items": [
        {"type": "kurta set", "description": "navy silk kurta pyjama set", "reason": "Festive and smart", "budget": 4000},
        {"type": "mojaris", "description": "black leather mojaris", "reason": "Traditional", "budget": "₹2,000"},
        {"type": "stole", "description": "silver zari stole", "reason": "Adds shine"},
        {"type": "mojaris", "description": "tan mojaris", "budget": 900},
    ],
}


@pytest.mark.parametrize("request_text, budget, expected", [
    ("wedding outfit for men under ₹5,000", None, 5000),
    ("college fest look 2k tak", None, 2000),
    ("office look", 3500, 3500),
])
def test_budget_is_read(request_text, budget, expected):
    assert p.read_budget(request_text, budget) == expected


@pytest.mark.parametrize("request_text, budget, message", [
    ("diwali kurta", None, "Add a budget"),
    ("party look", 100, "too small"),
])
def test_unusable_budgets(request_text, budget, message):
    with pytest.raises(p.PlanError, match=message):
        p.read_budget(request_text, budget)


def test_plan_shares_fit_the_budget():
    plan = p.read_plan(PLAN, 5000)

    assert [item["type"] for item in plan["items"]] == ["kurta set", "mojaris", "stole"]  # repeat dropped
    shares = [item["budget"] for item in plan["items"]]
    assert sum(shares) <= 5000
    # 4000 + 2000 planned, the stole gets the spare (at least 10% of the budget), then all scaled to fit.
    assert shares[0] > shares[1] > 0 and shares[2] > 0
    assert plan["items"][0]["price_range"] == [round(shares[0] * 0.3), round(shares[0] * 1.15)]
    assert plan["gender"] == "men" and plan["title"] == "Classic navy wedding guest look"


def test_a_plan_needs_two_pieces():
    with pytest.raises(p.PlanError, match="Couldn't plan"):
        p.read_plan({"items": [{"type": "kurta", "description": "white kurta", "budget": 900}]}, 1000)


def test_picks_stay_within_budget():
    items = [
        {"id": "a", "budget": 3000, "best_matches": [listing("kurta-best", 2900), listing("kurta-cheap", 1200)], "cheapest_alternatives": []},
        {"id": "b", "budget": 1500, "best_matches": [listing("shoes-best", 1500), listing("shoes-mid", 900)], "cheapest_alternatives": [listing("shoes-cheap", 400)]},
        {"id": "c", "budget": 500, "best_matches": [], "cheapest_alternatives": []},
    ]

    picks, total = p.choose_picks(items, 3500)

    # The best within each share (2900 + 1500) is over budget, so the piece with the most to
    # save steps down first: the kurta to 1200, then the total (2700) fits.
    assert picks == {"a": "https://shop/kurta-cheap", "b": "https://shop/shoes-best"}
    assert total == 2700


def test_picks_when_even_the_cheapest_is_over_budget():
    items = [{"id": "a", "budget": 500, "best_matches": [listing("x", 900), listing("y", 700)], "cheapest_alternatives": []}]
    picks, total = p.choose_picks(items, 500)
    assert picks == {"a": "https://shop/y"} and total == 700


def test_plan_look_end_to_end(model, monkeypatch):
    model["answers"] = [PLAN]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(f"{q} premium", 6000), listing(f"{q} classic", 800)], "cheapest_alternatives": []})
    events = []

    plan = p.plan_look("wedding guest outfit for men under 5000", on_event=lambda kind, data: events.append((kind, data)))

    assert events[0] == ("plan", {"title": "Classic navy wedding guest look", "budget": 5000.0, "gender": "men"})
    assert plan["total"] <= 5000 and len(plan["picks"]) == 3
    assert all(key.endswith("classic") for key in plan["picks"].values())


def test_plan_endpoint(model, monkeypatch):
    model["answers"] = [PLAN]
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [listing(q, 700)], "cheapest_alternatives": []})
    client = TestClient(main.app)

    response = client.post("/api/v1/plan/stream", json={"request": "wedding guest look", "budget": 5000, "gender": "men"})
    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert [e["type"] for e in events][:2] == ["stage", "plan"] and events[-1]["type"] == "final"
    assert events[-1]["total"] == 2100

    missing = client.post("/api/v1/plan/stream", json={"request": "wedding guest look"})
    assert missing.status_code == 400 and "budget" in missing.json()["detail"]


# ---------- Compare ----------

PRODUCTS = [
    {"name": "HP 15s Laptop 8GB RAM 512GB SSD", "price": 42990, "marketplace": "Amazon.in", "rating": 4.2, "reviews": 3100},
    {"name": "Lenovo IdeaPad 16GB RAM 512GB SSD", "price": 51990, "marketplace": "Flipkart", "rating": 4.4, "reviews": 870},
]


def test_compare_reads_attributes_pros_and_verdict(model):
    model["answers"] = [{
        "attributes": [
            {"name": "RAM", "values": ["8 GB", "16 GB"]},
            {"name": "Storage", "values": ["512 GB SSD", "512 GB SSD"]},
            {"name": "Colour", "values": ["not listed", "not listed"]},
            {"name": "Broken", "values": ["only one"]},
        ],
        "pros": [["Cheaper", "Most reviews"], "Double the RAM"],
        "best": 2,
        "verdict": "Buy the Lenovo for multitasking; the HP if budget matters most.",
    }]

    result = a.compare_products(PRODUCTS, "laptop")

    assert [attr["name"] for attr in result["attributes"]] == ["RAM", "Storage"]
    assert result["pros"] == [["Cheaper", "Most reviews"], ["Double the RAM"]]
    assert result["best"] == 1
    assert "Lenovo" in result["verdict"]
    prompt = model["sent"][0]["messages"][0]["content"]
    assert "1. HP 15s Laptop" in prompt and 'They searched for "laptop"' in prompt


def test_compare_needs_two_or_three(model):
    with pytest.raises(a.AssistantInputError):
        a.compare_products(PRODUCTS[:1])
    with pytest.raises(a.AssistantInputError):
        a.compare_products(PRODUCTS * 2)


def test_compare_endpoint(model):
    model["answers"] = [{"attributes": [], "pros": [], "best": None, "verdict": "Too close to call."}]
    client = TestClient(main.app)

    response = client.post("/api/v1/compare", json={"products": PRODUCTS})
    assert response.status_code == 200
    assert response.json() == {"attributes": [], "pros": [[], []], "best": None, "verdict": "Too close to call."}

    assert client.post("/api/v1/compare", json={"products": PRODUCTS[:1]}).status_code == 400
