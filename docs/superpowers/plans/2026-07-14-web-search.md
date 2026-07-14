# Web Search (Tavily) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Zenith a `web_search(query)` Claude tool backed by Tavily, so she can look things up on the live web.

**Architecture:** One read-only tool on the EXISTING loop — a thin `web_search_service.py` (Tavily REST via `requests`) + tool registration in `tools.py`. Results are fenced as `<external-content>` (in `UNTRUSTED_TOOLS`), the tool is not gated (not in `ACTION_TOOLS`), and it degrades gracefully when unconfigured. Zero changes to the chat loop, routes, or confirm gate.

**Tech Stack:** Python 3.11 FastAPI backend, `requests`, pytest.

**Design spec:** `docs/superpowers/specs/2026-07-14-web-search-design.md`

## Global Constraints

- **Read-only + untrusted:** `web_search` goes in `UNTRUSTED_TOOLS` (fenced), NOT in `ACTION_TOOLS`.
- **No new dependency** — reuse `requests` (already used by `news_service`/`weather_service`).
- **Graceful unconfigured:** no `TAVILY_API_KEY` → raise `SearchUnavailable`; `run_tool` reports it as a failed (unlogged, unfenced) run. Mirror `news_service.NewsUnavailable`.
- **`backend/.env.example` is OWNER-EDITED** — a `.env*` write rule blocks the agent. The plan's env line is added by the owner (Task 3); tests set the env var via `monkeypatch`, so they don't need the file.
- **Tests:** `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py` (Python 3.11 venv; baseline 279 green).

## File Structure

- `backend/web_search_service.py` — CREATE: Tavily client (`search()`, `SearchUnavailable`).
- `backend/test_web_search.py` — CREATE: service + tool tests.
- `backend/tools.py` — MODIFY: import, `_web_search`, `_EXECUTORS`, `UNTRUSTED_TOOLS`, `run_tool` except, `_activity_target`, the `TOOLS` schema.
- `backend/activity_log.py` — MODIFY: one `_MAP` entry.
- `SETUP-WEBSEARCH.md` — CREATE (Task 3).

---

### Task 1: `web_search_service.py` — the Tavily client

**Files:**
- Create: `backend/web_search_service.py`
- Test: `backend/test_web_search.py` (create)

**Interfaces:**
- Produces: `search(query: str) -> str` (formatted results) and `SearchUnavailable(Exception)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test_web_search.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_web_search.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'web_search_service'`.

- [ ] **Step 3: Write `web_search_service.py`**

Create `backend/web_search_service.py`:

```python
"""Zenith — web search via Tavily (an LLM-agent search API). Read-only; results are third-party web
content, fenced as <external-content> by run_tool. Mirrors news_service: module-level requests + a
custom exception. Graceful when TAVILY_API_KEY is unset."""

from __future__ import annotations

import os

import requests

API_URL = "https://api.tavily.com/search"
_TIMEOUT = 12
_MAX_RESULTS = 5


class SearchUnavailable(Exception):
    """Web search is not configured or the provider failed."""


def _api_key() -> str:
    return (os.getenv("TAVILY_API_KEY") or "").strip()


def search(query: str) -> str:
    key = _api_key()
    if not key:
        raise SearchUnavailable("Web search isn't configured — add TAVILY_API_KEY to backend/.env.")
    try:
        resp = requests.post(API_URL, timeout=_TIMEOUT, json={
            "api_key": key, "query": query, "max_results": _MAX_RESULTS,
            "include_answer": True, "search_depth": "basic",
        })
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        raise SearchUnavailable(f"Web search failed: {exc}") from exc
    return _format(query, data)


def _format(query: str, data: dict) -> str:
    answer = (data.get("answer") or "").strip()
    results = data.get("results") or []
    if not answer and not results:
        return f"No web results for '{query}'."
    lines = [f"Web results for '{query}':"]
    if answer:
        lines.append(f"\nSummary: {answer}")
    for r in results[:_MAX_RESULTS]:
        title = (r.get("title") or "").strip() or "(untitled)"
        url = (r.get("url") or "").strip()
        snippet = " ".join((r.get("content") or "").split())[:300]
        lines.append(f"\n- {title}\n  {url}\n  {snippet}")
    return "\n".join(lines)
```

> The Tavily wire format (JSON `api_key` field, response `answer`/`results`) follows current Tavily
> docs; confirm against them if the live call fails once the owner adds a real key. Tests mock
> `requests.post`, so they are independent of the wire format.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_web_search.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/web_search_service.py backend/test_web_search.py
git commit -m "feat(web-search): Tavily client (web_search_service) + tests"
```

---

### Task 2: register the `web_search` tool

**Files:**
- Modify: `backend/tools.py`, `backend/activity_log.py`
- Test: `backend/test_web_search.py`

**Interfaces:**
- Consumes: `web_search_service.search`.
- Produces: a `web_search` Claude tool wired through `run_tool` (fenced, not gated, logged).

- [ ] **Step 1: Write the failing tests**

Append to `backend/test_web_search.py`:

```python
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
        raise tools.web_search_service.SearchUnavailable("Web search isn't configured — add TAVILY_API_KEY to backend/.env.")
    monkeypatch.setattr(tools.web_search_service, "search", raise_unavail)
    out = tools.run_tool("web_search", {"query": "x"})
    assert "isn't configured" in out
    assert "<external-content" not in out                # a config error is not fenced content
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_web_search.py -q -k "web_search_gate or schema or executor_needs or fenced or unconfigured_is"`
Expected: FAIL (`AttributeError: module 'tools' has no attribute 'web_search_service'` / `web_search` not registered).

- [ ] **Step 3: Wire the tool into `tools.py`**

1. Add the import beside the other service imports near the top of `backend/tools.py`:

```python
import web_search_service
```

2. Add the executor next to `_get_news` (after the news section, ~line 236):

```python
# ---------- web search ----------

def _web_search(i: dict) -> str:
    q = (i.get("query") or "").strip()
    if not q:
        return "web_search needs a 'query'."
    return web_search_service.search(q)     # raises SearchUnavailable on config/API failure
```

3. Add the tool schema to the `TOOLS` list, right after the `get_news` entry (~line 675):

```python
    {
        "name": "web_search",
        "description": "Search the live web for current information, facts, news, prices, docs, "
        "people, or anything not covered by Zenith's other tools. Use when the user says 'search', "
        "'look up', 'google', 'find online', or asks about recent / real-time info. Returns a short "
        "summary plus source links.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "The search query"}},
            "required": ["query"],
        },
    },
```

4. Register the executor in `_EXECUTORS` (next to `"get_news": _get_news`):

```python
    "web_search": _web_search,
```

5. Add `"web_search"` to the `UNTRUSTED_TOOLS` set (next to `"get_news"`):

```python
    "get_calendar_events", "search_calendar", "get_briefing", "get_news", "web_search",
```

6. Add the exception clause in `run_tool`, next to the `news_service.NewsUnavailable` clause:

```python
        except news_service.NewsUnavailable as exc:
            result, failed = str(exc), True
        except web_search_service.SearchUnavailable as exc:
            result, failed = str(exc), True
```

7. Add the `_activity_target` case (next to the `search_calendar`/`search_emails` case):

```python
    if name == "web_search":
        return i.get("query", "")
```

- [ ] **Step 4: Add the activity-log entry**

In `backend/activity_log.py`, add to `_MAP` next to the `get_news` entry:

```python
    "web_search": ("note", "info", "web search"),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_web_search.py -q`
Expected: PASS (9 passed — Task 1's 4 + these 5).

- [ ] **Step 6: Commit**

```bash
git add backend/tools.py backend/activity_log.py backend/test_web_search.py
git commit -m "feat(web-search): register web_search tool (fenced, ungated, logged)"
```

---

### Task 3: setup doc, env, docs + full verification

**Files:**
- Create: `SETUP-WEBSEARCH.md`
- Modify: `CLAUDE.md`, `JARVIS_PRD.md`, `TODO.md`

- [ ] **Step 1: Full backend suite (no regressions)**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: all pass (baseline 279 + 9 new = 288). If anything unrelated fails, stop and investigate.

- [ ] **Step 2: Write `SETUP-WEBSEARCH.md`**

Cover: get a free Tavily API key at `https://app.tavily.com/` (any email), add `TAVILY_API_KEY=tvly-…`
to `backend/.env`, restart the backend; note the free-tier query limit; note that without the key
Zenith says web search isn't configured and everything else still works; usage: "search the web for …",
"look up …", "google …".

- [ ] **Step 3: Owner action — env line (agent is blocked from `.env*`)**

Tell the owner to add to `backend/.env` (and `backend/.env.example` for documentation):

```
TAVILY_API_KEY=
```

(No code change; the tests set the env var directly, so this is not needed for green tests — only for
the feature to work live.)

- [ ] **Step 4: Update project docs**

`CLAUDE.md`: add a `v3.0` line to the bottom `*Synced with JARVIS_PRD.md*` changelog (web search: one
Tavily-backed `web_search` tool, fenced/ungated, graceful-unconfigured) and bump the sync version.
`JARVIS_PRD.md`: bump the header + add a top "What changed" block + footer entry.
`TODO.md`: tick the "Web search — WANTED" item in §D.

- [ ] **Step 5: Commit**

```bash
git add SETUP-WEBSEARCH.md CLAUDE.md JARVIS_PRD.md TODO.md
git commit -m "docs(web-search): SETUP-WEBSEARCH.md + web search shipped (v3.0)"
```

---

## Self-Review

**Spec coverage:** §4 tool (schema/executor/registration) → Task 2. §5 service → Task 1. §6 config →
Task 3 (owner env) + graceful path tested in Tasks 1–2. §7 activity log → Task 2 (`_MAP` +
`_activity_target`). §8 testing → Tasks 1–2 (all eight listed cases: formats, no-results, unconfigured,
provider-error, executor-validation, gate-membership, fencing). §9 out-of-scope respected (search only).
§10 files all covered.

**Placeholder scan:** No "TBD"/"add error handling". Every code step shows complete code. Task 3
Steps 2/4 are prose (doc wording is judgment, not code) — acceptable.

**Type consistency:** `search(query) -> str` / `SearchUnavailable` defined in Task 1, consumed in Task 2
(`tools.web_search_service.search`, the `except` clause) and the tests. `_web_search` returns the
`"web_search needs a 'query'."` prefix that `run_tool`'s existing validation-prefix check recognizes.
`UNTRUSTED_TOOLS` / `ACTION_TOOLS` / `_MAP` / `_activity_target` names match the real definitions read
from `tools.py` / `activity_log.py`.
