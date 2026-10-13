import pytest
import requests
from bs4 import BeautifulSoup

import image_shopping_service as s
from conftest import FakeResponse


@pytest.mark.parametrize(
    "value, expected",
    [
        ("₹1,599", 1599.0),
        ("Rs. 2,499.50", 2499.5),
        (999, 999.0),
        ("₹1,000 - ₹2,000", None),  # ranges are ambiguous
        ("free", None),
        (None, None),
        (True, None),
    ],
)
def test_parse_numeric_price(value, expected):
    assert s.parse_numeric_price(value) == expected


def test_extract_price_from_lens_result():
    item = {"price": {"value": "₹1,599*", "extracted_value": 1599, "currency": "₹"}}
    assert s.extract_price(item) == {
        "price": 1599.0,
        "price_text": "₹1,599*",
        "currency": "INR",
    }


def test_make_price_result_requires_a_currency():
    assert s.make_price_result("2499", "INR")["price_text"] == "₹2,499"
    assert s.make_price_result("2499", None) is None


@pytest.mark.parametrize(
    "value, expected",
    [
        (True, s.IN_STOCK),
        (False, s.OUT_OF_STOCK),
        ("https://schema.org/InStock", s.IN_STOCK),
        ("http://schema.org/OutOfStock", s.OUT_OF_STOCK),
        ("Currently unavailable.", s.OUT_OF_STOCK),
        ("Only 3 left in stock", s.IN_STOCK),
        ("PreOrder", None),
        ("", None),
    ],
)
def test_classify_availability(value, expected):
    assert s.classify_availability(value) == expected


PAGES = {
    "https://shop.in/aggregate": """<script type="application/ld+json">
        {"@type": "Product", "offers": {"@type": "AggregateOffer", "lowPrice": "1,299",
         "priceCurrency": "INR",
         "offers": [{"@type": "Offer", "availability": "https://schema.org/InStock"}]}}
        </script>""",
    "https://shop.in/graph": """<script type="application/ld+json">
        {"@graph": [{"@type": "Product", "offers": [{"@type": "Offer",
         "priceSpecification": {"price": 2499}, "priceCurrency": "INR",
         "availability": "http://schema.org/OutOfStock"}]}]}</script>""",
    "https://www.amazon.in/dp/X": """<span class="a-price"><span class="a-offscreen">₹3,499</span></span>
        <div id="availability"><span>Currently unavailable.</span></div>""",
    "https://shop.in/meta": """<meta property="product:price:amount" content="799">
        <meta property="product:availability" content="in stock">""",
    "https://shop.cz/meta": """<meta property="product:price:amount" content="799">""",
    "https://shop.in/blog": "<html><body>An article about watches</body></html>",
}


@pytest.fixture
def fake_pages(monkeypatch):
    def fake_get(url, **kwargs):
        if url not in PAGES:
            raise requests.RequestException("403 Forbidden")
        return FakeResponse(PAGES[url])

    monkeypatch.setattr(s.requests, "get", fake_get)


@pytest.mark.parametrize(
    "url, price, availability, is_product",
    [
        ("https://shop.in/aggregate", 1299.0, s.IN_STOCK, True),
        ("https://shop.in/graph", 2499.0, s.OUT_OF_STOCK, True),
        ("https://www.amazon.in/dp/X", 3499.0, s.OUT_OF_STOCK, True),
        ("https://shop.in/meta", 799.0, s.IN_STOCK, True),
        # Foreign page without a stated currency: price is not guessed.
        ("https://shop.cz/meta", None, None, False),
        ("https://shop.in/blog", None, None, False),
    ],
)
def test_fetch_page_details(fake_pages, url, price, availability, is_product):
    details = s.fetch_page_details(url)
    assert details["fetched"] is True
    assert details["price"] == price
    assert details["availability"] == availability
    assert details["is_product_page"] is is_product


def test_fetch_page_details_when_blocked(fake_pages):
    details = s.fetch_page_details("https://blocked.example/x")
    assert details["fetched"] is False
    assert details["price"] is None


def test_fast_and_full_parse_agree():
    """The structured-tag fast path must match a full parse."""
    for url, html in PAGES.items():
        fragment = "".join(s.STRUCTURED_TAG_PATTERN.findall(html))
        fast = s.read_page_details(BeautifulSoup(fragment, "html.parser"), fragment, url)
        full = s.read_page_details(BeautifulSoup(html, "html.parser"), html, url)
        if fast[0] is not None:  # the fast path is only used when it finds a price
            assert fast == full, url
