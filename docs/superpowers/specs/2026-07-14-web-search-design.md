# Web search — design spec

**Date:** 2026-07-14
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Context:** Owner asked for it directly ("we really need it"). Zenith has no web-search tool today, so
she correctly refuses when asked to search the net. This adds one.

---

## 1. What this is

A single **`web_search(query)`** Claude tool on the EXISTING loop, backed by **Tavily** (a search API
built for LLM agents — clean, ranked, summarized results). Read-only, no side effects. The result is
third-party web content, so it is **fenced as `<external-content>`** exactly like `get_news` /
`read_email`. This is the same "one more tool" pattern as every prior integration — **no changes to the
chat loop, routes, or the confirm gate.**

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Backend** | **Tavily** (`POST https://api.tavily.com/search`). | Purpose-built for LLM agents: returns a short synthesized answer + ranked results with content, ideal as a tool result. Free tier; painless signup (any email). |
| **Tool shape** | `web_search(query: str)`, read-only. | In **`UNTRUSTED_TOOLS`** (fenced); **not** in `ACTION_TOOLS` (a search has no side effects → runs immediately). Mirrors `get_news`. |
| **Result** | Tavily's `answer` (when present) + the top **5** results (`title · url · snippet`). | Gives Claude a synthesized starting point AND the sources to cite. `include_answer: true`, `max_results: 5`, `search_depth: "basic"`. |
| **Scope** | **Search only.** | A separate "read/summarize this exact URL" tool (Tavily Extract) is an easy fast-follow, not v1. |
| **Unconfigured** | Graceful — raises `SearchUnavailable`, `run_tool` reports it as a failed (unlogged, unfenced) tool run. | No key → Zenith says web search isn't set up; nothing else breaks. Same shape as `news_service.NewsUnavailable`. |

## 3. Architecture

```
Claude decides to search ──▶ tool web_search(query)
                                 └─ _web_search(i)  → web_search_service.search(query)
                                        └─ requests.post https://api.tavily.com/search
                                             { api_key, query, max_results:5, include_answer:true, search_depth:"basic" }
                                        └─ format: answer + top-5 (title · url · snippet)
                              run_tool: name ∈ UNTRUSTED_TOOLS → _wrap_untrusted → <external-content>
                              activity_log.record("web_search", query)
```

Everything rides the existing `run_tool` machinery. The only new backend surface is a thin service
module + the tool registration + one `except` clause in `run_tool` (exactly how weather/news/discord/
notion each registered their exception).

## 4. The tool

- **Schema** (in `tools.TOOLS`):
  ```json
  {
    "name": "web_search",
    "description": "Search the live web for current information, facts, news, prices, docs, people, or anything not in Zenith's other tools. Use when the user asks to 'search', 'look up', 'google', 'find online', or asks about recent/real-time info. Returns a summary + sources.",
    "input_schema": { "type": "object",
      "properties": { "query": { "type": "string", "description": "The search query" } },
      "required": ["query"] }
  }
  ```
- **Executor** `_web_search(i)`:
  ```python
  def _web_search(i: dict) -> str:
      q = (i.get("query") or "").strip()
      if not q:
          return "web_search needs a 'query'."
      return web_search_service.search(q)          # raises SearchUnavailable on config/API failure
  ```
  (The `"web_search needs"` prefix is caught by `run_tool`'s existing validation-prefix check, so it is
  not fenced or logged as real work.)
- **Registration:** add to `_EXECUTORS`, add `"web_search"` to **`UNTRUSTED_TOOLS`** (NOT `ACTION_TOOLS`),
  and add the `except web_search_service.SearchUnavailable` clause + the `import web_search_service` in
  `tools.py`.

## 5. Backend service — `web_search_service.py`

Mirrors `news_service` (module-level `requests`, a timeout, a custom exception):

```python
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

> Tavily's exact auth (JSON `api_key` field vs an `Authorization: Bearer` header) and field names are
> confirmed against current Tavily docs during the build; the tests mock `requests.post`, so they're
> independent of the wire format, but the live call must match (owner live-verifies with a real key).

## 6. Config

- `TAVILY_API_KEY` in `backend/.env` (+ documented in `backend/.env.example`). Owner fills it (the
  `.env*` write rule blocks the agent, as with every key). Unset → `SearchUnavailable` → graceful.
- No new dependency — `requests` is already used by `news_service`/`weather_service`.

## 7. Activity log

Add to `activity_log._MAP`: `"web_search": ("note", "info", "web search")` (matches the
`get_news`/`get_weather` shape) so a search shows in the feed. Also add a `web_search` case to
`tools._activity_target` — `if name == "web_search": return i.get("query", "")` — so the log entry
shows the query (unlisted tools fall through to the default otherwise).

## 8. Testing — `backend/test_web_search.py`

All `requests.post` mocked → offline, deterministic:

- **Formats results:** a mocked Tavily payload (answer + 3 results) → the output contains the answer,
  the titles, and the URLs.
- **No results:** empty payload → `"No web results for ..."`.
- **Unconfigured:** `TAVILY_API_KEY` unset → `search()` raises `SearchUnavailable` (and via
  `run_tool("web_search", …)` the message comes back, unfenced/unlogged).
- **Provider error:** `requests.post` raising / a non-200 → `SearchUnavailable` (never crashes).
- **Executor validation:** `web_search` with a blank/missing query → `"web_search needs a 'query'."`.
- **Gate membership (regression guards):** `"web_search" in UNTRUSTED_TOOLS`,
  `"web_search" not in ACTION_TOOLS`, `"web_search" in activity_log._MAP`.
- **Fencing:** `run_tool("web_search", {"query": "x"})` with a mocked successful search →
  the result is wrapped in `<external-content` (the injection guard applies).

## 9. Out of scope (v1) / future

- **Read/summarize a specific URL** (Tavily Extract / a `read_url` tool) — the obvious fast-follow.
- **News-topic / recency parameters** (`topic: "news"`, `time_range`) — general search only for now.
- **Result caching**, multi-engine fallback (e.g. DuckDuckGo when Tavily is down), image search.

## 10. Files

**New:** `backend/web_search_service.py`, `backend/test_web_search.py`, `SETUP-WEBSEARCH.md`, this spec,
the implementation plan.
**Touched:** `backend/tools.py` (schema + `_web_search` + `_EXECUTORS` + `UNTRUSTED_TOOLS` + the
`import`/`except` + the `_activity_target` case), `backend/activity_log.py` (`_MAP` entry),
`backend/.env.example` (`TAVILY_API_KEY`).
**Reuses:** `run_tool`'s fencing + failed-detection, `activity_log`, `requests`. No frontend change (it
surfaces through the normal chat reply + the Activity Log).
