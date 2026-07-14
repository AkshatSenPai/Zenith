"""Web search (Tavily) — requests.post mocked -> offline, deterministic."""

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
        return _Resp(payload)
    monkeypatch.setattr(wss.requests, "post", fake_post)
    return seen


def test_search_formats_answer_and_results(monkeypatch):
    seen = _wire(monkeypatch, {
        "answer": "Paris is the capital of France.",
        "results": [
            {"title": "France", "url": "https://ex.com/fr", "content": "France is a country ..."},
            {"title": "Paris", "url": "https://ex.com/paris", "content": "Paris is the capital ..."},
        ],
    })
    out = wss.search("capital of france")
    assert "Paris is the capital of France." in out
    assert "https://ex.com/fr" in out and "https://ex.com/paris" in out
    assert "France" in out and "Paris" in out
    assert seen["json"]["query"] == "capital of france"
    assert seen["json"]["api_key"] == "tvly-test"


def test_search_no_results(monkeypatch):
    _wire(monkeypatch, {})
    assert "No web results" in wss.search("asdfqwer")


def test_search_unconfigured_raises(monkeypatch):
    _wire(monkeypatch, {}, key=None)
    with pytest.raises(wss.SearchUnavailable):
        wss.search("anything")


def test_search_provider_error_raises(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    def boom(url, **kw):
        raise wss.requests.RequestException("timeout")
    monkeypatch.setattr(wss.requests, "post", boom)
    with pytest.raises(wss.SearchUnavailable):
        wss.search("anything")
