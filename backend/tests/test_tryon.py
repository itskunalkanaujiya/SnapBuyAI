import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import tryon_service as t

TRYON = "/api/v1/tryon"
GARMENT_URL = "https://encrypted-tbn0.gstatic.com/images?q=kurti"


@pytest.mark.parametrize(
    "name, category",
    [
        ("Anouk Printed Pure Cotton Kurti", "upper_body"),
        ("Libas Women Kurta with Palazzo", "upper_body"),
        ("Women Short Kurti", "upper_body"),
        ("Men Cotton T-Shirt", "upper_body"),
        ("Levi's 511 Slim Fit Jeans", "lower_body"),
        ("High Waist Pleated Skirt", "lower_body"),
        ("Floral Maxi Dress", "dresses"),
        ("Nike Men Running Shoes", None),
        ("Casio G-Shock Watch", None),
        ("boAt Airdopes 141", None),
        ("Kurta Pattern Fabric", None),
        ("", None),
    ],
)
def test_garment_category(name, category):
    assert t.garment_category(name) == category


def test_photos_are_fitted_without_stretching():
    wide_person = Image.new("RGB", (1600, 900), "red")
    tall_garment = Image.new("RGB", (300, 900), "blue")

    person = t.fit_person(wide_person)
    garment = t.fit_garment(tall_garment)

    assert person.size == garment.size == t.TRYON_SIZE
    # The garment is padded on white, never cropped.
    assert garment.getpixel((0, 512)) == (255, 255, 255)
    assert garment.getpixel((384, 512)) == (0, 0, 255)


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1/admin", "http://localhost:8000/health", "http://10.0.0.5/x",
     "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://example.com/a.jpg"],
)
def test_internal_or_non_http_urls_are_refused(url):
    with pytest.raises(t.TryOnError):
        t.download_garment(url)


@pytest.fixture
def fake_models(monkeypatch, tmp_path):
    """Fake garment download and models; records which models ran."""
    calls = []
    result = tmp_path / "result.png"
    Image.new("RGB", t.TRYON_SIZE, "green").save(result)

    monkeypatch.setattr(t, "download_garment", lambda url: Image.new("RGB", (300, 400), "blue"))

    def make(name, fails=False):
        def run(*args):
            calls.append(name)
            if fails:
                raise TimeoutError("queue full")
            return str(result)
        return run

    return calls, make


def test_leffa_is_used_first(monkeypatch, fake_models):
    calls, make = fake_models
    monkeypatch.setattr(t, "run_leffa", make("leffa"))
    monkeypatch.setattr(t, "run_idm_vton", make("idm"))

    jpeg = t.try_on(Image.new("RGB", (900, 1200), "red"), GARMENT_URL, "upper_body", "kurti")

    assert calls == ["leffa"]
    assert Image.open(io.BytesIO(jpeg)).format == "JPEG"


def test_falls_back_to_idm_vton_for_tops(monkeypatch, fake_models):
    calls, make = fake_models
    monkeypatch.setattr(t, "run_leffa", make("leffa", fails=True))
    monkeypatch.setattr(t, "run_idm_vton", make("idm"))

    t.try_on(Image.new("RGB", (900, 1200), "red"), GARMENT_URL, "upper_body")
    assert calls == ["leffa", "idm"]


def test_no_fallback_for_bottoms_and_clear_error(monkeypatch, fake_models):
    calls, make = fake_models
    monkeypatch.setattr(t, "run_leffa", make("leffa", fails=True))
    monkeypatch.setattr(t, "run_idm_vton", make("idm"))

    with pytest.raises(t.TryOnError, match="busy"):
        t.try_on(Image.new("RGB", (900, 1200), "red"), GARMENT_URL, "lower_body")
    assert calls == ["leffa"]


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def fake_try_on(monkeypatch):
    calls = []

    def run(person_image, garment_url, category, garment_name):
        calls.append((garment_url, category))
        output = io.BytesIO()
        Image.new("RGB", (60, 80), "purple").save(output, format="JPEG")
        return output.getvalue()

    monkeypatch.setattr(main, "try_on", run)
    return calls


def post_tryon(client, person_bytes, category="upper_body", url=GARMENT_URL):
    return client.post(
        TRYON,
        files={"person": ("me.png", person_bytes, "image/png")},
        data={"garment_url": url, "category": category, "garment_name": "Cotton Kurti"},
    )


def test_tryon_endpoint_returns_a_jpeg_and_caches(client, fake_try_on, png_bytes):
    photo = png_bytes("red", (300, 400))
    first = post_tryon(client, photo)
    second = post_tryon(client, photo)

    assert first.status_code == 200
    assert first.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(first.content)).format == "JPEG"
    assert (first.headers["x-tryon-cached"], second.headers["x-tryon-cached"]) == ("false", "true")
    assert fake_try_on == [(GARMENT_URL, "upper_body")]


def test_tryon_rejects_bad_category_and_images(client, fake_try_on, png_bytes):
    assert post_tryon(client, png_bytes(), category="shoes").status_code == 400
    assert post_tryon(client, b"").status_code == 400
    assert fake_try_on == []


def test_tryon_has_its_own_limit(client, fake_try_on, png_bytes, monkeypatch):
    monkeypatch.setattr(main, "TRYON_LIMIT", 1)
    assert post_tryon(client, png_bytes("red")).status_code == 200
    blocked = post_tryon(client, png_bytes("blue"))
    assert blocked.status_code == 429
    assert "try-ons" in blocked.json()["detail"]


def test_tryon_service_errors_are_reported(client, monkeypatch, png_bytes):
    def busy(*args):
        raise t.TryOnError("The try-on service is busy right now. Please try again in a minute.")

    monkeypatch.setattr(main, "try_on", busy)
    response = post_tryon(client, png_bytes("teal"))
    assert response.status_code == 503
    assert "busy" in response.json()["detail"]
