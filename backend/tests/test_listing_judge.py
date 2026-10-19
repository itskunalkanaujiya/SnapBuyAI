import json

import pytest

import listing_judge as j
import llm_query_parser as q
from conftest import FakeResponse

ITEM = {
    "type": "jhumka earrings",
    "description": "small gold jhumka earrings",
    "reason": "Frames the face.",
    "price_range": [200, 1200],
}
LISTINGS = [
    {"name": "Multi-Color Jhumka Earrings", "price": 419},
    {"name": "Gold Plated Mini Jhumka Earrings", "price": 125},
    {"name": "22 KT Yellow Gold Jhumka", "price": 84003},
    {"name": "Small Gold Jhumki Earrings", "price": 232},
    {"name": "Kids Hair Clips", "price": 99},
    {"name": "Oxidised Silver Jhumka", "price": 300},
]


@pytest.fixture
def judge(monkeypatch):
    state = {"reply": {"matches": []}, "sent": []}

    def post(url, headers, json, timeout):
        state["sent"].append(json)
        return FakeResponse(data={"choices": [{"message": {"content": __import__("json").dumps(state["reply"])}}]})

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(q.requests, "post", post)
    return state


def test_judge_keeps_the_listings_it_picks_in_its_order(judge):
    # After the budget cut the ₹84,003 piece is gone, so numbers shift.
    judge["reply"] = {"matches": [3, "2", 2, 99]}

    picked = j.judge_listings(ITEM, LISTINGS, "women")

    assert [p["name"] for p in picked] == ["Small Gold Jhumki Earrings", "Gold Plated Mini Jhumka Earrings"]
    body = judge["sent"][0]
    assert body["model"] == j.JUDGE_MODELS[0]
    prompt = body["messages"][0]["content"]
    assert "22 KT" not in prompt  # far above the price range
    assert "Price range: about ₹200 to ₹1,200" in prompt and "For: women" in prompt


def test_judge_falls_back_to_word_match(judge, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(j, "chat_json", broken)
    picked = j.judge_listings(ITEM, LISTINGS)
    assert picked[0]["name"] in {"Small Gold Jhumki Earrings", "Gold Plated Mini Jhumka Earrings"}
    assert picked[-1]["name"] == "Kids Hair Clips"


def test_no_match_shows_a_few_closest(judge):
    judge["reply"] = {"matches": []}
    assert len(j.judge_listings(ITEM, LISTINGS)) == j.MIN_LEFT


def test_budget_keeps_enough_listings():
    pricey = [{"name": str(i), "price": 5000 + i} for i in range(6)]
    assert j.within_budget(pricey, [100, 500]) == pricey  # nothing affordable: keep all
    assert j.within_budget(LISTINGS, None) == LISTINGS
