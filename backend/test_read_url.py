"""Read-a-URL (Tavily Extract) — requests.post mocked -> offline, deterministic."""

import pytest

import web_search_service as wss


class _Resp:
    def __init__(self, payload): self._p = payload
    def raise_for_status(self): pass
    def json(self): return self._p


def _wire(monkeypatch, payload, key="tvly-test"):
    if key is None:
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    else:
        monkeypatch.setenv("TAVILY_API_KEY", key)
    seen = {}
    def fake_post(url, **kw):
        seen["url"] = url
        seen["json"] = kw.get("json")
        seen["headers"] = kw.get("headers") or {}
        return _Resp(payload)
    monkeypatch.setattr(wss.requests, "post", fake_post)
    return seen


def test_extract_formats_content_and_wire_format(monkeypatch):
    seen = _wire(monkeypatch, {
        "results": [{"url": "https://ex.com/a", "raw_content": "The full   article body here."}],
    })
    out = wss.extract("https://ex.com/a")
    assert "The full article body here." in out          # whitespace collapsed
    assert "https://ex.com/a" in out
    assert seen["url"] == wss.EXTRACT_URL
    assert seen["json"]["urls"] == "https://ex.com/a"
    assert seen["json"]["extract_depth"] == "basic"
    assert seen["json"]["format"] == "markdown"
    assert seen["headers"]["Authorization"] == "Bearer tvly-test"


def test_extract_truncates_long_content(monkeypatch):
    _wire(monkeypatch, {"results": [{"url": "https://ex.com/a", "raw_content": "x " * 9000}]})
    out = wss.extract("https://ex.com/a")
    assert out.endswith("…[truncated]")
    assert len(out) < 9000 * 2


def test_extract_unreadable_page(monkeypatch):
    _wire(monkeypatch, {"results": [], "failed_results": [{"url": "https://ex.com/a"}]})
    assert "Couldn't read the page" in wss.extract("https://ex.com/a")


def test_extract_unconfigured_raises(monkeypatch):
    _wire(monkeypatch, {}, key=None)
    with pytest.raises(wss.SearchUnavailable):
        wss.extract("https://ex.com/a")


def test_extract_provider_error_raises(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    def boom(url, **kw):
        raise wss.requests.RequestException("timeout")
    monkeypatch.setattr(wss.requests, "post", boom)
    with pytest.raises(wss.SearchUnavailable):
        wss.extract("https://ex.com/a")
