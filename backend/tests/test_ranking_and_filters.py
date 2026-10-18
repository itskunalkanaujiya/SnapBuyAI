import pytest

import image_shopping_service as s


def test_title_keywords_keep_brand_names():
    words = s.title_keywords({"title": "Men's G Shock Watch, G-SHOCK GA-2100 a Watch"})
    assert words == ["men", "g-shock", "watch", "g-shock", "ga-2100", "watch"]


def test_derive_product_query_finds_consensus():
    titles = [
        "Nike Air Zoom Pegasus 41 Men's Road Running Shoes - Black",
        "Buy Nike Pegasus 41 Running Shoes for Men Online at Best Price",
        "NIKE Air Zoom Pegasus 41 Running Shoes For Men (Black)",
        "Pegasus 41 Black White Men's Running Shoe",
        "Nike Pegasus 41 review",
    ]
    query = s.derive_product_query([{"title": t} for t in titles])
    assert query.split()[:3] == ["nike", "pegasus", "41"]
    assert "buy" not in query and "price" not in query


def test_derive_product_query_without_titles():
    assert s.derive_product_query([]) == ""


@pytest.mark.parametrize(
    "url, kind",
    [
        ("https://www.amazon.in/Some-Watch/dp/B0H7NB27B6", "product"),
        ("https://www.flipkart.com/watch/p/itm69d03b648e996", "product"),
        ("https://www.myntra.com/watches/otage/otage-men/123456/buy", "product"),
        ("https://www.tatacliq.com/casio-g-shock/p-mp000000012345", "product"),
        ("https://www.etsy.com/in-en/listing/1868522296/foxbox", "product"),
        ("https://finebuy.co.in/ts_mega_menu/accessories-menu-wide/", "listing"),
        ("https://www.shutterstock.com/search/g-shock-brand", "listing"),
        ("https://casiofanmag.com/news/g-shock-review/", "listing"),
        ("https://example-shop.com/", "listing"),
        ("https://www.swisstimehouse.com/casio-g1705", None),
    ],
)
def test_classify_listing_url(url, kind):
    assert s.classify_listing_url(url) == kind


@pytest.mark.parametrize(
    "url, indian",
    [
        ("https://finebuy.co.in/product/x", True),
        ("https://www.flipkart.com/x/p/itm1", True),
        ("https://www.lifestylestores.com/in/en/x/p/1", True),
        ("https://www.casio.com/us/watches/", False),
        ("https://www.strobl.cz/el/watch_p1", False),
    ],
)
def test_is_indian_store(url, indian):
    assert s.is_indian_store(url) is indian


def listing(title, link, lens_price=None, page=None):
    item = {"title": title, "link": link, "source": "store"}
    if lens_price:
        item["price"] = lens_price
    if page is not None:
        item["_page_details"] = page
    item["_offer"] = s.resolve_offer(item)
    return item


RUPEES = {"value": "₹999", "extracted_value": 999, "currency": "₹"}
EUROS = {"value": "€25", "extracted_value": 25, "currency": "€"}
CHECKED_NOTHING = {"fetched": True, "is_product_page": False}
BLOCKED = {"fetched": False}


@pytest.mark.parametrize(
    "item, keep",
    [
        (listing("Watch", "https://www.amazon.in/x/dp/A", RUPEES), True),
        (listing("Accessories – Menu Wide", "https://finebuy.co.in/menu/", page=CHECKED_NOTHING), False),
        (listing("G-Shock review", "https://blog.example/news/x/", page=CHECKED_NOTHING), False),
        (listing("Watch", "https://www.strobl.cz/el/watch_p1", EUROS), False),
        (listing("Watch", "https://jiji.co.ke/watch.html", page=BLOCKED), False),
        (listing("Watch", "https://www.aliexpress.com/item/1.html", RUPEES), True),
        (listing("Watch", "https://www.etsy.com/in-en/listing/1/watch", page=BLOCKED), True),
    ],
)
def test_listing_filters(item, keep):
    assert (s.looks_like_product_page(item) and s.is_available_in_india(item)) is keep


def test_select_sections_marks_pending_in_preview():
    candidates = [
        listing("Priced and stocked", "https://www.amazon.in/a/dp/A",
                {**RUPEES, "extracted_value": 500}),
        listing("No price yet", "https://www.flipkart.com/b/p/itm1"),
    ]
    candidates[0]["in_stock"] = True

    preview = s.select_sections(candidates, max_results=10, preview=True)
    pending = {p["name"]: p["pending"] for p in preview["best_matches"]}
    assert pending == {"Priced and stocked": False, "No price yet": True}

    final = s.select_sections(candidates, max_results=10)
    assert all(p["pending"] is False for p in final["best_matches"])


def test_missing_prices_are_filled_from_the_same_store_on_google_shopping():
    from concurrent.futures import Future
    import time

    candidates = [
        {"title": "Buy Soch Women Floral Printed Kurta - Kurtas for Women", "source": "Myntra",
         "link": "https://www.myntra.com/kurtas/soch/123"},
        {"title": "Soch Women Floral Kurta", "source": "Ajio", "link": "https://www.ajio.com/p/9"},
        {"title": "Unrelated Blue Jeans", "source": "Myntra", "link": "https://www.myntra.com/jeans/1"},
        {"title": "Soch Floral Kurta", "source": "Flipkart", "link": "https://www.flipkart.com/p/1",
         "price": {"value": "₹999", "extracted_value": 999, "currency": "₹"}},
    ]
    job = Future()
    job.set_result([
        {"title": "Soch Women Floral Printed Kurta", "source": "Myntra", "price": "₹1,403"},
        {"title": "Soch Women Floral Printed Kurta", "source": "Amazon.in", "price": "₹1,200"},
        {"title": "Soch Floral Kurta", "source": "Flipkart", "price": "₹1,500"},
    ])

    filled = s.apply_shopping_prices(candidates, job, time.monotonic() + 1)

    assert filled == 1
    assert candidates[0]["_shopping_price"]["price"] == 1403  # same store, same product
    assert "_shopping_price" not in candidates[1]  # Ajio isn't in the Shopping results
    assert "_shopping_price" not in candidates[2]  # same store, different product
    assert "_shopping_price" not in candidates[3]  # already had a Lens price
    assert s.resolve_offer(candidates[0])["price"] == 1403


def test_no_shopping_lookup_without_serper():
    assert s.start_shopping_prices("soch kurta") is None
