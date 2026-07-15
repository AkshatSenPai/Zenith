# Read-a-URL tool — design spec

**Date:** 2026-07-15
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Context:** The documented fast-follow to web search ([[2026-07-14-web-search-design]]). `web_search`
finds pages; it does not read one. When the user says "read this link" / "summarize this article" /
pastes a URL, Zenith needs to fetch that specific page's content. This adds one read-only tool for that.

---

## 1. What this is

A single **`read_url(url)`** Claude tool on the EXISTING loop, backed by **Tavily Extract** (`POST
https://api.tavily.com/extract`) — the same provider, key, and Bearer auth as `web_search`. It fetches
one page and returns its cleaned content (markdown) so the loop's Claude can read/summarize it.
Read-only, no side effects. The content is third-party web data, so it is **fenced as
`<external-content>`** exactly like `web_search` / `get_news` / `read_email`. Same "one more tool"
pattern as every prior integration — **no changes to the chat loop, routes, or the confirm gate.**

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Backend** | **Tavily Extract** (`POST https://api.tavily.com/extract`), reusing `web_search_service`. | Same key (`TAVILY_API_KEY`), same `Authorization: Bearer` auth, same `SearchUnavailable` exception, same graceful-unconfigured path as `web_search`. Handles messy/JS-lite pages and returns clean markdown. One Tavily client module, no duplicated auth/error handling. |
| **Tool shape** | `read_url(url: str)`, read-only. | In **`UNTRUSTED_TOOLS`** (fetched page content is attacker-controllable → fenced); **not** in `ACTION_TOOLS` (reading a page has no side effects → runs immediately). Mirrors `web_search`. |
| **Request** | `{"urls": url, "extract_depth": "basic", "format": "markdown"}`. | Single URL (v1). `basic` depth is cheaper; `advanced` is for hard pages — revisit only if needed. Markdown is the cleanest for Claude to summarize. |
| **Result** | `results[0].raw_content`, whitespace-collapsed, **truncated to ~8000 chars** (`_MAX_CHARS`). | Page content balloons the token budget fast (a project cost rule). ~8000 chars ≈ 2k tokens — enough to summarize, bounded. Tunable constant. |
| **Scope** | **One URL, extract only.** | No batch (`urls` array), no crawl, no `query`-reranking. YAGNI. |
| **Unconfigured / unreadable** | Graceful. No key → `SearchUnavailable` (same as search). Empty `results` / URL in `failed_results` → a plain "couldn't read that page" string. | No key → Zenith says web search isn't set up. A page that won't extract → Zenith says so; nothing crashes. |

## 3. Architecture

```
Claude decides to read a page ──▶ tool read_url(url)
                                     └─ _read_url(i)  → web_search_service.extract(url)
                                            └─ requests.post https://api.tavily.com/extract
                                                 headers: Authorization: Bearer <key>
                                                 { urls: url, extract_depth:"basic", format:"markdown" }
                                            └─ format: results[0].raw_content, collapsed, ≤8000 chars
                                  run_tool: name ∈ UNTRUSTED_TOOLS → _wrap_untrusted → <external-content>
                                  activity_log.record("read_url", url)
```

Everything rides the existing `run_tool` machinery. `extract` raises the **same** `SearchUnavailable`
type `search` already raises, so `run_tool`'s existing `except web_search_service.SearchUnavailable`
clause covers it with **no change**. The only new surface is the `extract` function + the tool
registration.

## 4. The tool

- **Schema** (in `tools.TOOLS`):
  ```json
  {
    "name": "read_url",
    "description": "Fetch and read the full content of a specific web page or article by its URL. Use when the user pastes a link or asks to 'read', 'open', 'summarize', or 'what does this say' about a specific URL. For finding pages by topic, use web_search instead. Returns the page's cleaned text.",
    "input_schema": { "type": "object",
      "properties": { "url": { "type": "string", "description": "The full URL of the page to read (including https://)" } },
      "required": ["url"] }
  }
  ```
- **Executor** `_read_url(i)`:
  ```python
  def _read_url(i: dict) -> str:
      url = (i.get("url") or "").strip()
      if not url:
          return "read_url needs a 'url'."
      return web_search_service.extract(url)       # raises SearchUnavailable on config/API failure
  ```
  (The `"read_url needs"` prefix rides `run_tool`'s existing validation-prefix check, so it is not
  fenced or logged as real work — same as `web_search`.)
- **Registration:** add to `_EXECUTORS`, add `"read_url"` to **`UNTRUSTED_TOOLS`** (NOT `ACTION_TOOLS`).
  No new `import`/`except` — it reuses `web_search_service` + its `SearchUnavailable`.

## 5. Backend service — extend `web_search_service.py`

Add alongside `search` (shares `_api_key`, the Bearer auth, `SearchUnavailable`, `requests`):

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

> Wire format (Bearer header, `urls` string, `results[].raw_content`, `failed_results`) is confirmed
> against current Tavily Extract docs. Tests mock `requests.post`, so they're independent of the wire
> format; the live call must match (owner live-verifies with a real key, same as `web_search`).

## 6. Config

- Reuses `TAVILY_API_KEY` — **no new config**. Unset → `SearchUnavailable` → graceful, same as search.
- No new dependency (`requests` already in use).

## 7. Activity log

Add to `activity_log._MAP`: `"read_url": ("note", "info", "read page")` (same shape as `web_search`).
Add a `read_url` case to `tools._activity_target` — `if name == "read_url": return i.get("url", "")` —
so the feed shows the URL that was read.

## 8. Testing — `backend/test_read_url.py`

All `requests.post` mocked → offline, deterministic (mirrors `test_web_search.py`):

- **Formats content:** mocked `{"results": [{"url": ..., "raw_content": "..."}]}` → output contains the
  raw content and the URL.
- **Sends the right wire format:** body has `urls == <url>`, header `Authorization == "Bearer <key>"`.
- **Truncation:** a `raw_content` longer than `_MAX_CHARS` → output is capped and ends with `…[truncated]`.
- **Unreadable:** empty `results` (or only `failed_results`) → `"Couldn't read the page at ..."`.
- **Unconfigured:** `TAVILY_API_KEY` unset → `extract()` raises `SearchUnavailable`; via `run_tool` the
  message comes back unfenced/unlogged.
- **Provider error:** `requests.post` raising / non-200 → `SearchUnavailable` (never crashes).
- **Executor validation:** `read_url` with a blank/missing url → `"read_url needs a 'url'."`.
- **Gate membership (regression guards):** `"read_url" in UNTRUSTED_TOOLS`,
  `"read_url" not in ACTION_TOOLS`, `"read_url" in activity_log._MAP`.
- **Schema:** the `read_url` schema requires `["url"]`.
- **Fencing:** `run_tool("read_url", {"url": "https://x"})` with a mocked successful extract → the result
  is wrapped in `<external-content` (the injection guard applies).
- **Unconfigured is graceful via run_tool:** a `SearchUnavailable` → message returned, NOT fenced.

## 9. Out of scope (v1) / future

- **Batch extract** (multiple URLs in one call), **crawl**, `query`-reranked chunks, `advanced` depth.
- **Self-fetch fallback** (requests + HTML strip) when Tavily is down or unconfigured.
- **Caching** repeated reads of the same URL.

## 10. Files

**New:** `backend/test_read_url.py`, this spec, the implementation plan.
**Touched:** `backend/web_search_service.py` (`extract` + `_format_extract` + `EXTRACT_URL`/`_MAX_CHARS`),
`backend/tools.py` (schema + `_read_url` + `_EXECUTORS` + `UNTRUSTED_TOOLS` + the `_activity_target`
case), `backend/activity_log.py` (`_MAP` entry).
**Reuses:** `web_search_service` (key/auth/`SearchUnavailable`), `run_tool`'s fencing + failed-detection,
`activity_log`, `requests`. No new config, no new dependency, no frontend change (it surfaces through the
normal chat reply + the Activity Log).
