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


# --- tool registration ---

import activity_log
import tools


def test_web_search_gate_membership():
    assert "web_search" in tools.UNTRUSTED_TOOLS        # results are third-party web content → fenced
    assert "web_search" not in tools.ACTION_TOOLS        # a search has no side effects
    assert "web_search" in activity_log._MAP             # or it wouldn't show in the feed


def test_web_search_schema_requires_query():
    schema = next(t for t in tools.TOOLS if t["name"] == "web_search")
    assert schema["input_schema"]["required"] == ["query"]


def test_web_search_executor_needs_query():
    assert tools.run_tool("web_search", {}) == "web_search needs a 'query'."


def test_web_search_result_is_fenced(monkeypatch):
    monkeypatch.setattr(tools.web_search_service, "search", lambda q: f"RESULTS for {q}")
    out = tools.run_tool("web_search", {"query": "pizza"})
    assert "RESULTS for pizza" in out
    assert "<external-content" in out                    # injection guard applied


def test_web_search_unconfigured_is_graceful(monkeypatch):
    def raise_unavail(q):
        raise tools.web_search_service.SearchUnavailable(
            "Web search isn't configured — add TAVILY_API_KEY to backend/.env.")
    monkeypatch.setattr(tools.web_search_service, "search", raise_unavail)
    out = tools.run_tool("web_search", {"query": "x"})
    assert "isn't configured" in out
    assert "<external-content" not in out                # a config error is not fenced content
