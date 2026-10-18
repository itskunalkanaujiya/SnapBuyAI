import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import outfit_service as o
from conftest import FakeResponse

OUTFIT = {
    "gender": "men",
    "items": [
        {"type": "t-shirt", "description": "yellow blue striped t-shirt", "box": [375, 0, 680, 245]},
        {"type": "jeans", "description": "dark blue slim fit denim jeans", "box": [435, 225, 635, 640]},
        {"type": "watch", "description": "silver metal band wristwatch", "box": [615, 165, 616, 200]},
        {"type": "", "description": "nothing"},
    ],
}


def vision_reply(data, status=200):
    return FakeResponse(data={"choices": [{"message": {"content": json.dumps(data)}}]}, status_code=status)


@pytest.fixture
def vision(monkeypatch):
    sent = []

    def post(url, headers, json, timeout):
        sent.append(json)
        return vision_reply(OUTFIT)

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(o.requests, "post", post)
    return sent


def test_identify_outfit_reads_items_and_boxes(vision):
    outfit = o.identify_outfit(Image.new("RGB", (1200, 1600), "white"))

    image_part = vision[0]["messages"][0]["content"][1]["image_url"]["url"]
    assert image_part.startswith("data:image/jpeg;base64,")
    assert outfit["gender"] == "men"
    assert [item["type"] for item in outfit["items"]] == ["t-shirt", "jeans", "watch"]
    assert outfit["items"][0]["box"] == [0.375, 0.0, 0.68, 0.245]
    assert outfit["items"][2]["box"] is None  # too thin to be a real box


def test_find_outfit_searches_each_item_with_gender(vision, monkeypatch):
    searched = []

    def search(query, max_results, understand):
        searched.append((query, understand))
        return {"best_matches": [{"name": f"{query} listing"}], "cheapest_alternatives": []}

    monkeypatch.setattr(o, "search_products_by_text", search)
    events = []
    outfit = o.find_outfit(Image.new("RGB", (600, 800)), on_event=lambda kind, data: events.append(kind))

    assert sorted(searched) == sorted([
        ("men yellow blue striped t-shirt", False),
        ("men dark blue slim fit denim jeans", False),
        ("men silver metal band wristwatch", False),
    ])
    assert events == ["items", "item", "item", "item"]
    assert all(item["best_matches"] for item in outfit["items"])


def test_busy_model_gives_a_clear_message(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(o.requests, "post", lambda *a, **k: FakeResponse(data={}, status_code=429))
    with pytest.raises(o.OutfitError, match="busy"):
        o.identify_outfit(Image.new("RGB", (100, 100)))


def test_no_person_found(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(o.requests, "post", lambda *a, **k: vision_reply({"gender": "unisex", "items": []}))
    with pytest.raises(o.OutfitError, match="Couldn't find"):
        o.find_outfit(Image.new("RGB", (100, 100)))


def test_outfit_endpoint_streams_items_then_final(vision, monkeypatch, png_bytes):
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand: {
        "best_matches": [{"name": q}], "cheapest_alternatives": []})
    client = TestClient(main.app)

    def stream():
        response = client.post("/api/v1/outfit/stream", files={"file": ("me.png", png_bytes("blue"), "image/png")})
        return [json.loads(line) for line in response.text.splitlines() if line]

    events = stream()
    assert [e["type"] for e in events] == ["stage", "items", "item", "item", "item", "final"]
    assert len(events[-1]["items"]) == 3

    again = stream()  # the same photo is served from the cache
    assert [e["type"] for e in again] == ["final"] and again[0]["cached"] is True


def test_outfit_endpoint_reports_model_errors(monkeypatch, png_bytes):
    events = TestClient(main.app).post(
        "/api/v1/outfit/stream", files={"file": ("me.png", png_bytes("red"), "image/png")}
    ).text.splitlines()
    error = json.loads(events[-1])
    assert error["type"] == "error" and "isn't set up" in error["detail"]  # no GROQ_API_KEY in tests
