# Read-a-URL Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one read-only `read_url(url)` Claude tool that fetches a specific web page's content via Tavily Extract, so Zenith can read/summarize a link.

**Architecture:** Extend the existing `web_search_service.py` (same Tavily key + Bearer auth + `SearchUnavailable`) with an `extract(url)` function, then register `read_url` in `tools.py` exactly like `web_search` — fenced as `<external-content>` (`UNTRUSTED_TOOLS`), not gated, logged. Zero changes to the chat loop, routes, or confirm gate.

**Tech Stack:** Python 3.11 backend, `requests`, pytest. Spec: `docs/superpowers/specs/2026-07-15-read-url-tool-design.md`.

## Global Constraints

- Backend venv is **Python 3.11**: run tests with `cd backend && ./.venv/Scripts/python.exe -m pytest <file> -q`.
- **No new dependency** — reuse `requests`. **No new config** — reuse `TAVILY_API_KEY`.
- `read_url` goes in **`UNTRUSTED_TOOLS`**, NOT `ACTION_TOOLS` (read-only, runs immediately, content fenced).
- Tavily Extract wire format (confirmed against current docs): `POST https://api.tavily.com/extract`, header `Authorization: Bearer <key>`, body `{"urls": <url string>, "extract_depth": "basic", "format": "markdown"}`; response `{"results": [{"url", "raw_content"}], "failed_results": [...]}`.
- Truncate page content to `_MAX_CHARS = 8000`.
- `run_tool` already: catches `web_search_service.SearchUnavailable` (tools.py:1173), treats a leading `"{name} needs"` string as a non-fenced/non-logged validation failure (tools.py:1165), and fences any tool in `UNTRUSTED_TOOLS` (tools.py:1185). Reuse all three — do not modify `run_tool`.

---

### Task 1: `extract()` in `web_search_service.py`

**Files:**
- Modify: `backend/web_search_service.py` (add `EXTRACT_URL`, `_MAX_CHARS`, `extract()`, `_format_extract()`)
- Test: `backend/test_read_url.py` (new)

**Interfaces:**
- Consumes: existing `web_search_service._api_key()`, `SearchUnavailable`, `requests`, `_TIMEOUT`.
- Produces: `web_search_service.extract(url: str) -> str` — returns formatted page content, or a plain "Couldn't read…" string; raises `SearchUnavailable` when `TAVILY_API_KEY` is unset or the HTTP call fails.

- [ ] **Step 1: Write the failing tests**

Create `backend/test_read_url.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_read_url.py -q`
Expected: FAIL — `AttributeError: module 'web_search_service' has no attribute 'extract'` (and `EXTRACT_URL`).

- [ ] **Step 3: Implement `extract()` + `_format_extract()`**

Append to `backend/web_search_service.py` (after `_format`):

```python
EXTRACT_URL = "https://api.tavily.com/extract"
_MAX_CHARS = 8000


def extract(url: str) -> str:
    key = _api_key()
    if not key:
        raise SearchUnavailable("Web search isn't configured — add TAVILY_API_KEY to backend/.env.")
    try:
        resp = requests.post(EXTRACT_URL, timeout=_TIMEOUT,
            headers={"Authorization": f"Bearer {key}"},
            json={"urls": url, "extract_depth": "basic", "format": "markdown"})
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        raise SearchUnavailable(f"Reading the page failed: {exc}") from exc
    return _format_extract(url, data)


def _format_extract(url: str, data: dict) -> str:
    results = data.get("results") or []
    content = ""
    if results:
        content = " ".join((results[0].get("raw_content") or "").split())
    if not content:
        return f"Couldn't read the page at {url} (it may be blocked, empty, or not extractable)."
    if len(content) > _MAX_CHARS:
        content = content[:_MAX_CHARS] + " …[truncated]"
    return f"Content of {url}:\n\n{content}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_read_url.py -q`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/web_search_service.py backend/test_read_url.py
git commit -m "feat(read-url): Tavily Extract extract() in web_search_service + tests"
```

---

### Task 2: Register the `read_url` tool in `tools.py`

**Files:**
- Modify: `backend/tools.py` (schema in `TOOLS`, `_read_url`, `_EXECUTORS`, `UNTRUSTED_TOOLS`, `_activity_target`)
- Modify: `backend/activity_log.py` (`_MAP` entry)
- Test: `backend/test_read_url.py` (append registration tests)

**Interfaces:**
- Consumes: `web_search_service.extract` (Task 1), existing `run_tool`, `UNTRUSTED_TOOLS`, `ACTION_TOOLS`, `activity_log._MAP`, `_activity_target`, `_wrap_untrusted`.
- Produces: a working `run_tool("read_url", {"url": ...})` path — fenced result on success, plain validation string on missing url.

- [ ] **Step 1: Write the failing registration tests**

Append to `backend/test_read_url.py`:

```python
# --- tool registration ---

import activity_log
import tools


def test_read_url_gate_membership():
    assert "read_url" in tools.UNTRUSTED_TOOLS         # fetched page content is fenced
    assert "read_url" not in tools.ACTION_TOOLS         # reading has no side effects
    assert "read_url" in activity_log._MAP              # or it wouldn't show in the feed


def test_read_url_schema_requires_url():
    schema = next(t for t in tools.TOOLS if t["name"] == "read_url")
    assert schema["input_schema"]["required"] == ["url"]


def test_read_url_executor_needs_url():
    assert tools.run_tool("read_url", {}) == "read_url needs a 'url'."


def test_read_url_result_is_fenced(monkeypatch):
    monkeypatch.setattr(tools.web_search_service, "extract", lambda u: f"PAGE {u}")
    out = tools.run_tool("read_url", {"url": "https://x"})
    assert "PAGE https://x" in out
    assert "<external-content" in out                   # injection guard applied


def test_read_url_unconfigured_is_graceful(monkeypatch):
    def raise_unavail(u):
        raise tools.web_search_service.SearchUnavailable(
            "Web search isn't configured — add TAVILY_API_KEY to backend/.env.")
    monkeypatch.setattr(tools.web_search_service, "extract", raise_unavail)
    out = tools.run_tool("read_url", {"url": "https://x"})
    assert "isn't configured" in out
    assert "<external-content" not in out               # a config error is not fenced content
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_read_url.py -q`
Expected: FAIL — `read_url` not in `UNTRUSTED_TOOLS`/`_MAP`, no schema, `run_tool("read_url", {})` returns `"Error: unknown tool 'read_url'."`.

- [ ] **Step 3: Add the executor and schema in `tools.py`**

Add the executor next to `_web_search` (after tools.py:246):

```python
def _read_url(i: dict) -> str:
    url = (i.get("url") or "").strip()
    if not url:
        return "read_url needs a 'url'."
    return web_search_service.extract(url)   # raises SearchUnavailable on config/API failure
```

Add the schema to the `TOOLS` list, immediately after the `web_search` schema object (after tools.py:687's block — insert as a sibling dict):

```python
    {
        "name": "read_url",
        "description": "Fetch and read the full content of a specific web page or article by its URL. Use when the user pastes a link or asks to 'read', 'open', 'summarize', or 'what does this say' about a specific URL. For finding pages by topic, use web_search instead. Returns the page's cleaned text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The full URL of the page to read (including https://)"}
            },
            "required": ["url"],
        },
    },
```

Add to `_EXECUTORS` (next to the `"web_search": _web_search,` entry at tools.py:1048):

```python
    "read_url": _read_url,
```

Add `"read_url"` to the `UNTRUSTED_TOOLS` set (tools.py:1013-1016, alongside `"web_search"`):

```python
    "get_calendar_events", "search_calendar", "get_briefing", "get_news", "web_search", "read_url",
```

Add the `_activity_target` case (in `_activity_target`, near the `web_search` case at tools.py:1099):

```python
    if name == "read_url":
        return i.get("url", "")
```

- [ ] **Step 4: Add the activity-log entry in `activity_log.py`**

In `activity_log.py`, add to `_MAP` next to the `web_search` entry:

```python
    "read_url": ("note", "info", "read page"),
```

(Match the exact tuple shape used by the neighboring `web_search` entry; adjust field values to that shape if it differs.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_read_url.py -q`
Expected: PASS (10 passed).

- [ ] **Step 6: Run the full fast backend suite (no regressions)**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: PASS — the prior green count + 10.

- [ ] **Step 7: Commit**

```bash
git add backend/tools.py backend/activity_log.py backend/test_read_url.py
git commit -m "feat(read-url): register read_url tool (fenced, ungated, logged)"
```

---

## Self-Review

**Spec coverage:** service `extract()` + format/truncate (Task 1); schema, executor, `_EXECUTORS`, `UNTRUSTED_TOOLS`, `_activity_target`, `_MAP` (Task 2); graceful-unconfigured + fencing + validation-string behavior (reused from `run_tool`, asserted in Task 2 tests). No new config/dependency (Global Constraints). All spec §8 test cases mapped. No gaps.

**Placeholders:** none — every code step shows the actual code; the only conditional ("adjust to that shape if it differs") is a verify-against-neighbor instruction with a concrete default, not a TODO.

**Type consistency:** `extract(url: str) -> str` and `_format_extract(url, data)` names match between Task 1 impl and Task 2's monkeypatch of `tools.web_search_service.extract`. `EXTRACT_URL`/`_MAX_CHARS` referenced in Task 1 tests are defined in Task 1 impl. `read_url` string identical across schema, `_EXECUTORS`, `UNTRUSTED_TOOLS`, `_activity_target`, `_MAP`, and tests.
