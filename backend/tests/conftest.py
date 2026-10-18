import io
import sys
from pathlib import Path

import pytest
from PIL import Image

# Make the backend modules importable from the tests folder.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402


@pytest.fixture(autouse=True)
def reset_server_state():
    """Each test starts with an empty cache and no recorded searches."""
    main._search_cache.clear()
    main._search_log.clear()
    main._tryon_log.clear()
    main._overlay_log.clear()
    main._overlay_cache.clear()
    yield
    main._search_cache.clear()
    main._search_log.clear()
    main._tryon_log.clear()
    main._overlay_log.clear()
    main._overlay_cache.clear()


@pytest.fixture(autouse=True)
def no_serper(monkeypatch):
    """Tests never call Serper.dev; tests that need it set a fake key."""
    monkeypatch.delenv("SERPER_API_KEY", raising=False)


@pytest.fixture
def png_bytes():
    """Return PNG bytes for a solid-colour image."""

    def make(color="red", size=(120, 120)):
        buffer = io.BytesIO()
        Image.new("RGB", size, color).save(buffer, format="PNG")
        return buffer.getvalue()

    return make


class FakeResponse:
    """Minimal stand-in for requests.Response."""

    def __init__(self, text="", data=None, status_code=200):
        self.text = text
        self._data = data
        self.status_code = status_code

    def raise_for_status(self):
        pass

    def json(self):
        return self._data
