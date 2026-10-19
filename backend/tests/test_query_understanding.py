import pytest

import query_understanding as q
import text_shopping_service as t


def test_reads_the_laptop_request():
    parsed = q.parse_query("a laptop of 8gb ram with 500gb storage and company hp")

    assert parsed.product == "laptop"
    assert parsed.brand == "hp"
    assert [(s.kind, s.value) for s in parsed.specs] == [("ram", 8), ("storage", 500)]
    assert parsed.search_query == "hp laptop 8GB RAM 500GB"
    assert parsed.summary() == ["HP", "Laptop", "8 GB RAM", "500 GB storage"]


@pytest.mark.parametrize(
    "text, low, high",
    [
        ("phone under 20k", None, 20000),
        ("tv below ₹45,000", None, 45000),
        ("laptop between 50k and 70k", 50000, 70000),
        ("fridge around 25000", 20000, 30000),
        ("sofa above 1.5 lakh", 150000, None),
    ],
)
def test_budgets(text, low, high):
    parsed = q.parse_query(text)
    assert (parsed.min_price, parsed.max_price) == (low, high)


def test_bare_sizes_small_is_ram_large_is_storage():
    parsed = q.parse_query("samsung phone 8gb 128gb")
    assert {s.kind: s.value for s in parsed.specs} == {"ram": 8, "storage": 128}
    assert parsed.brand == "samsung" and parsed.product == "phone"


def test_other_specs_and_features():
    parsed = q.parse_query("6000mah 5g phone with 50mp camera and 6.7 inch screen")
    assert {s.kind: s.value for s in parsed.specs} == {"battery": 6000, "camera": 50, "screen": 6.7}
    assert parsed.features == ["5g"]


def test_plain_keyword_searches_stay_unstructured():
    for text in ("cotton kurti for women", "casio g-shock watch", "boat airdopes 141"):
        assert not q.parse_query(text).is_structured


@pytest.mark.parametrize(
    "title, ram, storage",
    [
        ("HP 15s Intel Core i3 13th Gen (8GB RAM, 512GB SSD) Laptop", 1.0, 1.0),
        ("HP Victus Gaming Laptop 16GB RAM 1TB SSD", 0.5, 0.5),
        ("HP Laptop 4 GB/256 GB SSD/Windows 11", 0.0, 0.0),
    ],
)
def test_specs_are_matched_in_titles(title, ram, storage):
    parsed = q.parse_query("hp laptop 8gb ram 500gb storage")
    ram_spec, storage_spec = parsed.specs
    assert q.spec_match(ram_spec, title) == ram
    assert q.spec_match(storage_spec, title) == storage


def test_text_search_ranks_by_requirements_and_keeps_the_budget(monkeypatch):
    sent = []
    items = [
        {"title": "HP Laptop 4GB RAM 256GB SSD", "source": "Amazon.in", "product_link": "https://g.co/1", "price": "₹25,999"},
        {"title": "Dell Inspiron 8GB RAM 512GB SSD Laptop", "source": "Flipkart", "product_link": "https://g.co/2", "price": "₹41,990"},
        {"title": "HP 15s Laptop (8GB RAM, 512GB SSD)", "source": "Croma", "product_link": "https://g.co/3", "price": "₹38,990"},
        {"title": "HP Pavilion Laptop 16GB RAM 1TB SSD", "source": "HP Store", "product_link": "https://g.co/4", "price": "₹72,000"},
        {"title": "HP 255 G10 Laptop 8GB RAM 512GB", "source": "Reliance Digital", "product_link": "https://g.co/5", "price": "₹35,500"},
    ]

    def search(query):
        sent.append(query)
        return items

    monkeypatch.setattr(t, "run_google_shopping", search)
    result = t.search_products_by_text("a laptop of 8gb ram with 500gb storage and company hp under 50k")

    assert sent == ["hp laptop 8GB RAM 500GB"]
    names = [p["name"] for p in result["best_matches"]]
    assert names[:2] == ["HP 15s Laptop (8GB RAM, 512GB SSD)", "HP 255 G10 Laptop 8GB RAM 512GB"]
    assert "HP Pavilion Laptop 16GB RAM 1TB SSD" not in names  # over budget
    assert result["understood"] == ["HP", "Laptop", "8 GB RAM", "500 GB storage", "Under ₹50,000"]


@pytest.mark.parametrize(
    "text, low, high, audience",
    [
        ("mujhe ek 8gb ram wala hp laptop chahiye 50k ke andar", None, 50000, None),
        ("20000 se kam samsung phone", None, 20000, None),
        ("10k se upar wali watch", 10000, None, None),
        ("ladkon ke liye running shoes 2000 tak", None, 2000, "boys"),
        ("mummy ke liye cotton saree", None, None, "women"),
    ],
)
def test_hinglish_requests(text, low, high, audience):
    parsed = q.parse_query(text)
    assert (parsed.min_price, parsed.max_price) == (low, high)
    assert parsed.audience == audience
    for filler in ("mujhe", "wala", "chahiye", "ke", "liye"):
        assert filler not in parsed.product.split()


def test_hinglish_laptop_keeps_specs_and_brand():
    parsed = q.parse_query("mujhe ek 8gb ram wala hp laptop chahiye 50k ke andar")
    assert parsed.brand == "hp" and parsed.product == "laptop"
    assert {spec.kind: spec.value for spec in parsed.specs} == {"ram": 8}
