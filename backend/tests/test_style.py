import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import outfit_service as o
import style_service as st
from conftest import FakeResponse

RATING = {
    "gender": "women",
    "score": 8.46,
    "wearing": ["maroon heart print shirt", "red leather skirt"],
    "verdict": "A bold, playful look.",
    "occasion": "casual day out",
    "strengths": ["bold print", "bold print", "great colours", "good fit", "extra"],
    "fixes": [
        {"type": "boots", "advice": "Add red ankle boots to match the skirt.", "description": "red leather ankle boots"},
        {"type": "boots", "advice": "Or black boots.", "description": "black ankle boots"},
        {"type": "scarf", "advice": "A black silk scarf ties it together.", "description": "black silk square scarf"},
        {"type": "", "description": "nothing"},
    ],
}

PALETTE = {
    "undertone": "Warm",
    "season": "Deep Autumn",
    "summary": "Rich, earthy colours match your contrast.",
    "best": [
        {"name": "Maroon", "hex": "#800000"},
        {"name": "olive", "hex": "#556B2F"},
        {"name": "olive", "hex": "#556b2f"},
        {"name": "mustard", "hex": "ffdb58"},
        {"name": "rust", "hex": "#b7410e"},
    ],
    "avoid": [{"name": "neon pink", "hex": "#ff10f0"}],
}


def reply(data):
    return FakeResponse(data={"choices": [{"message": {"content": json.dumps(data)}}]})


@pytest.fixture
def model(monkeypatch):
    state = {"answer": RATING, "sent": []}

    def post(url, headers, json, timeout):
        state["sent"].append(json)
        return reply(state["answer"])

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(o.requests, "post", post)
    monkeypatch.setattr(o, "search_products_by_text", lambda q, n, understand, min_relevance=None: {
        "best_matches": [{"name": f"{q} listing", "price": 999}], "cheapest_alternatives": []})
    return state


def test_rating_is_read_and_fixes_are_shopped(model):
    events = []
    result = st.rate_outfit(Image.new("RGB", (600, 800)), on_event=lambda kind, data: events.append((kind, data)))

    assert events[0] == ("rating", {"rating": {
        "score": 8.5,  # no rubric scores: the overall score is used
        "scores": {},
        "wearing": ["maroon heart print shirt", "red leather skirt"],
        "verdict": "A bold, playful look.",
        "occasion": "casual day out",
        "strengths": ["bold print", "great colours", "good fit"],
        "personalised": False,
    }})
    assert [kind for kind, _ in events[1:]] == ["items", "item", "item"]
    assert [item["type"] for item in result["items"]] == ["boots", "scarf"]  # one per type
    assert result["items"][0]["reason"] == "Add red ankle boots to match the skirt."
    assert result["items"][0]["query"] == "women red leather ankle boots"
    assert result["rating"]["score"] == 8.5
    prompt = model["sent"][0]["messages"][0]["content"][0]["text"]
    assert "Never comment on the person's body" in prompt


def test_no_outfit_to_rate(model):
    model["answer"] = {"score": 0, "fixes": []}
    with pytest.raises(o.OutfitError, match="Couldn't see an outfit"):
        st.rate_outfit(Image.new("RGB", (100, 100)))


def test_a_rating_without_fixes_still_returns(model):
    model["answer"] = {**RATING, "fixes": []}
    result = st.rate_outfit(Image.new("RGB", (100, 100)))
    assert result["items"] == [] and result["rating"]["score"] == 8.5


def test_colour_palette_is_cleaned(model):
    model["answer"] = PALETTE
    palette = st.analyse_colours(Image.new("RGB", (400, 400)))

    assert palette["undertone"] == "warm" and palette["season"] == "Deep Autumn"
    # Repeats and invalid hex codes are dropped; names are lower case.
    assert palette["best"] == [
        {"name": "maroon", "hex": "#800000"},
        {"name": "olive", "hex": "#556b2f"},
        {"name": "rust", "hex": "#b7410e"},
    ]
    assert palette["avoid"] == [{"name": "neon pink", "hex": "#ff10f0"}]
    prompt = model["sent"][0]["messages"][0]["content"][0]["text"]
    assert "never suggest changing skin colour" in prompt


def test_no_face_for_colours(model):
    model["answer"] = {"best": []}
    with pytest.raises(o.OutfitError, match="selfie"):
        st.analyse_colours(Image.new("RGB", (100, 100)))


def test_rate_endpoint_streams_rating_then_items(model, png_bytes):
    response = TestClient(main.app).post(
        "/api/v1/style/rate/stream", files={"file": ("me.png", png_bytes("blue"), "image/png")}
    )
    events = [json.loads(line) for line in response.text.splitlines() if line]
    assert [e["type"] for e in events] == ["stage", "rating", "items", "item", "item", "final"]
    assert events[-1]["rating"]["score"] == 8.5 and len(events[-1]["items"]) == 2


def test_colours_endpoint(model, png_bytes):
    model["answer"] = PALETTE
    client = TestClient(main.app)

    response = client.post("/api/v1/style/colours", files={"file": ("me.png", png_bytes("tan"), "image/png")})
    assert response.status_code == 200 and response.json()["season"] == "Deep Autumn"

    model["answer"] = {"best": []}
    failed = client.post("/api/v1/style/colours", files={"file": ("me.png", png_bytes("tan"), "image/png")})
    assert failed.status_code == 422 and "selfie" in failed.json()["detail"]


def test_colours_without_a_key(png_bytes):
    response = TestClient(main.app).post(
        "/api/v1/style/colours", files={"file": ("me.png", png_bytes("tan"), "image/png")}
    )
    assert response.status_code == 422 and "isn't set up" in response.json()["detail"]


def test_score_is_the_mean_of_the_rubric(model):
    model["answer"] = {**RATING, "scores": {"colours": 8, "fit": 7, "styling": 5.5, "occasion": 7.5, "vibe": 10}}
    result = st.rate_outfit(Image.new("RGB", (100, 100)))
    assert result["rating"]["score"] == 7.0
    assert result["rating"]["scores"] == {"colours": 8.0, "fit": 7.0, "styling": 5.5, "occasion": 7.5}


def test_fixes_keep_their_price_range(model):
    model["answer"] = {**RATING, "fixes": [
        {"type": "belt", "advice": "Add a belt.", "description": "black leather belt", "price_range": [1500, 400]},
        {"type": "watch", "advice": "Add a watch.", "description": "silver watch", "price_range": "cheap"},
    ]}
    result = st.rate_outfit(Image.new("RGB", (100, 100)))
    assert [item["price_range"] for item in result["items"]] == [[400, 1500], None]


def test_best_colours_go_into_the_prompt(model):
    st.rate_outfit(Image.new("RGB", (100, 100)), colours=["Maroon", "olive", ""])
    prompt = model["sent"][0]["messages"][0]["content"][0]["text"]
    assert "Their best colours are maroon, olive" in prompt
    assert "PALETTE_RULE" not in prompt

    model["sent"].clear()
    st.rate_outfit(Image.new("RGB", (100, 100)))
    assert "best colours" not in model["sent"][0]["messages"][0]["content"][0]["text"]


def test_rate_endpoint_passes_colours(model, png_bytes, monkeypatch):
    seen = []
    monkeypatch.setattr(main, "rate_outfit", lambda image, on_event, colours: seen.append(colours) or {
        "rating": {"score": 7}, "gender": "women", "items": []})
    TestClient(main.app).post(
        "/api/v1/style/rate/stream",
        files={"file": ("me.png", png_bytes("blue"), "image/png")},
        data={"colours": "maroon, olive ,"},
    )
    assert seen == [["maroon", "olive"]]
