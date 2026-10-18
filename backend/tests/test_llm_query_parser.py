import json

import pytest

import llm_query_parser as llm
import text_shopping_service as t
from conftest import FakeResponse


@pytest.fixture(autouse=True)
def empty_cache():
    llm._cache.clear()
    yield
    llm._cache.clear()


def model_reply(data):
    return FakeResponse(data={"choices": [{"message": {"content": json.dumps(data)}}]})


def test_keywords_skip_the_model(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: pytest.fail("model should not run"))
    assert llm.understand_query("boat airdopes 141").product == "airdopes 141"


def test_sentences_use_the_model_and_rules_keep_written_numbers(monkeypatch):
    sent = []

    def post(url, headers, json, timeout):
        sent.append(json)
        return model_reply({
            "product": "smartphone", "brand": None,
            "specs": {"ram_gb": 6, "battery_mah": 6000},
            "features": ["gaming", "long battery"], "colour": None, "audience": None,
            "min_price": None, "max_price": 25000,
            "search_query": "gaming smartphone 6000mah",
        })

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", post)

    parsed = llm.understand_query("a phone that is good for gaming with 8gb ram and lasts all day under 20k")

    assert sent[0]["response_format"] == {"type": "json_object"}
    assert parsed.read_by_model and parsed.product == "smartphone"
    specs = {spec.kind: spec.value for spec in parsed.specs}
    assert specs == {"ram": 8, "battery": 6000}  # the written 8gb wins over the model's 6
    assert parsed.max_price == 20000  # the written budget wins
    assert parsed.wishes == ["gaming", "long battery"]
    # A spec was typed (8gb), so the query is built from the parts.
    assert parsed.search_query == "smartphone gaming long battery 8GB RAM 6000mAh"
    assert "Gaming" in parsed.summary()


def test_model_failure_falls_back_to_rules(monkeypatch):
    def broken(*args, **kwargs):
        raise TimeoutError("slow")

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", broken)
    parsed = llm.understand_query("a laptop of 8gb ram with 500gb storage and company hp")
    assert not parsed.read_by_model
    assert parsed.search_query == "hp laptop 8GB RAM 500GB"


def test_bad_model_values_are_ignored(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: model_reply({
        "product": "flask", "specs": {"ram_gb": "lots", "capacity_litres": -1},
        "colour": "sparkly", "audience": "aliens", "max_price": "cheap",
        "search_query": "insulated tea flask",
    }))
    parsed = llm.understand_query("something to keep my tea hot at work all day")
    assert parsed.product == "flask"
    assert parsed.specs == [] and parsed.colour is None and parsed.audience is None
    assert parsed.max_price is None
    assert parsed.search_query == "insulated tea flask"


def test_model_reading_drives_text_search(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: model_reply({
        "product": "insulated flask", "specs": {}, "features": [], "search_query": "insulated tea flask 500ml",
    }))
    sent = []
    monkeypatch.setattr(t, "run_google_shopping", lambda query: sent.append(query) or [
        {"title": "Milton Thermosteel Insulated Flask 500ml", "source": "Amazon.in", "product_link": "https://g.co/1", "price": "₹699"},
    ])

    result = t.search_products_by_text("something to keep my tea hot at work all day")

    assert sent == ["insulated tea flask 500ml"]
    assert result["best_matches"][0]["name"].startswith("Milton")
    assert result["understood"][0] == "Insulated flask"


def test_a_retired_model_is_skipped(monkeypatch):
    tried = []

    def post(url, headers, json, timeout):
        tried.append(json["model"])
        if len(tried) == 1:
            return FakeResponse(data={"error": {"code": "model_not_found"}}, status_code=404)
        return model_reply({"product": "flask", "search_query": "insulated flask"})

    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm, "_retired_models", set())
    monkeypatch.setattr(llm.requests, "post", post)
    assert llm.understand_query("something to keep my tea hot at work").search_query == "insulated flask"
    assert tried == llm.GROQ_MODELS[:2]


def test_titles_without_the_product_word_are_kept(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: model_reply({
        "product": "phone", "features": ["gaming"], "max_price": 20000, "search_query": "gaming phone",
    }))
    titles = ["Poco X7 5G", "iQOO Z10 Lite 5G", "Motorola G86 Power 5G", "Realme P4 5G",
              "Infinix Note 50x 5G", "Tempered Glass Screen Guard for Poco X7"]
    monkeypatch.setattr(t, "run_google_shopping", lambda query: [
        {"title": title, "source": "Flipkart", "product_link": f"https://g.co/{i}", "price": "₹15,999"}
        for i, title in enumerate(titles)
    ])

    names = [p["name"] for p in t.search_products_by_text("a phone that is good for gaming under 20k")["best_matches"]]
    assert names == titles[:5]  # the screen guard is left out


def test_written_specs_keep_the_precise_query(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: model_reply({
        "product": "laptop", "brand": "hp", "specs": {"ram_gb": 8, "storage_gb": 500},
        "search_query": "hp laptop 8gb ram 500gb storage",
    }))
    parsed = llm.understand_query("a laptop of 8gb ram with 500gb storage and company hp")
    assert parsed.read_by_model
    assert parsed.search_query == "hp laptop 8GB RAM 500GB"


def test_spec_words_are_not_wishes(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: model_reply({
        "product": "laptop", "brand": "hp", "features": ["ssd", "8gb ram", "thin and light"],
    }))
    parsed = llm.understand_query("an hp laptop with 8gb ram and 512gb ssd under 50k")
    assert parsed.wishes == ["thin and light"]
