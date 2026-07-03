# Notion Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Zenith read + create access to the owner's Notion workspace as 7 Claude tools on the EXISTING chat loop + confirm gate (the M3/M4 pattern), via the direct Notion REST API.

**Architecture:** A new `backend/notion_service.py` (thin synchronous `requests` client, like `weather_service`) exposes `configured()`, `status()`, and one function per tool. `tools.py` adds 7 schemas + executors; the 2 create tools join `ACTION_TOOLS` (gated), the 5 reads join `UNTRUSTED_TOOLS` (fenced). `main.py` adds `GET /notion/status`; the HUD shows a Connections row (no orb node). Zero changes to the chat route or confirm gate.

**Tech Stack:** Python 3.11 FastAPI backend (run tests from `backend/.venv`), `requests` (already a dependency — no new pip package), Next.js 14 frontend.

## Global Constraints

- Direct Notion REST API, **NOT MCP** (MCP is reserved for WhatsApp-personal per CLAUDE.md).
- `Notion-Version` header default `2022-06-28`, overridable via `NOTION_VERSION` in `.env`.
- Secrets only in gitignored `backend/.env` (`NOTION_API_KEY`); never hardcoded.
- All 5 read tools go in `UNTRUSTED_TOOLS` (fenced `<external-content>`); the 2 create tools go in `ACTION_TOOLS` (confirm gate). The gate/route are unchanged.
- **No 5th orb node** — Notion is a Connections-panel row only (the orb keeps its 4 cardinal nodes).
- Writes are **text/simple content only** (paragraph blocks); no tables/embeds. `update_page` is out of scope.
- Backend tests mock `requests` — **no live network in tests**. No frontend test runner (project rule): the HUD is verified with `tsc --noEmit` + live Playwright.
- Run the fast suite from the venv: `cd backend && ./.venv/Scripts/python.exe -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py`.

---

### Task 1: `notion_service.py` — HTTP client, exceptions, status

**Files:**
- Create: `backend/notion_service.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Produces: `configured() -> bool`; `NotionNotConnected`, `NotionError` (Exceptions); `_request(method, path, *, json=None, params=None) -> dict`; `_rich_text_to_plain(list) -> str`; `_title_of(dict) -> str`; `status() -> dict` with keys `configured, connected, workspace, last_error`.

- [ ] **Step 1: Write the failing tests** — create `backend/test_notion.py`:

```python
"""Notion integration — requests is mocked, no live network (mirrors test_weather.py)."""

import notion_service


class _Resp:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code
        self.text = str(data)

    def json(self):
        return self._data


def _mock_request(monkeypatch, handler):
    """Patch notion_service.requests.request with a handler(method, url, **kw) -> _Resp."""
    def fake(method, url, **kw):
        return handler(method, url, **kw)
    monkeypatch.setattr(notion_service.requests, "request", fake)


def test_configured(monkeypatch):
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    assert notion_service.configured() is False
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    assert notion_service.configured() is True


def test_status_not_configured(monkeypatch):
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    notion_service._status_cache["value"] = None
    s = notion_service.status()
    assert s == {"configured": False, "connected": False, "workspace": None, "last_error": None}


def test_status_connected(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    notion_service._status_cache["value"] = None
    _mock_request(monkeypatch, lambda m, u, **k: _Resp({"name": "Zenith", "bot": {"workspace_name": "Akshat's Notion"}}))
    s = notion_service.status()
    assert s["configured"] and s["connected"]
    assert s["workspace"] == "Akshat's Notion"


def test_title_of_page_and_database():
    page = {"object": "page", "properties": {"Name": {"type": "title", "title": [{"plain_text": "Hello"}]}}}
    db = {"object": "database", "title": [{"plain_text": "Tasks DB"}]}
    assert notion_service._title_of(page) == "Hello"
    assert notion_service._title_of(db) == "Tasks DB"


def test_request_raises_on_error(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    _mock_request(monkeypatch, lambda m, u, **k: _Resp({"message": "Unauthorized"}, status_code=401))
    try:
        notion_service._request("GET", "/users/me")
        assert False, "expected NotionError"
    except notion_service.NotionError as exc:
        assert "401" in str(exc)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL / import error (`notion_service` has no `status`, etc.)

- [ ] **Step 3: Write the implementation** — create `backend/notion_service.py`:

```python
"""Zenith — Notion integration (direct REST, NOT MCP).

A thin synchronous client over the Notion API used by the tool executors in tools.py, mirroring
weather_service / google_service. Reads are fenced untrusted upstream; the two create helpers run
behind the existing confirm gate. Auth = an internal integration secret (NOTION_API_KEY); it only
sees pages/databases explicitly shared with the integration inside Notion (see SETUP-NOTION.md).
"""

from __future__ import annotations

import os
import time

import requests

_API = "https://api.notion.com/v1"
_DEFAULT_VERSION = "2022-06-28"
_TIMEOUT = 10

# status() connectivity cache — the HUD polls every 4s; only re-check Notion every _STATUS_TTL.
_STATUS_TTL = 60.0
_status_cache: dict = {"at": 0.0, "value": None}


class NotionNotConnected(Exception):
    """NOTION_API_KEY is not set."""


class NotionError(Exception):
    """Notion returned a non-2xx response."""


def configured() -> bool:
    return bool(os.getenv("NOTION_API_KEY"))


def _headers() -> dict:
    key = os.getenv("NOTION_API_KEY")
    if not key:
        raise NotionNotConnected("Notion not connected — set NOTION_API_KEY in backend/.env.")
    return {
        "Authorization": f"Bearer {key}",
        "Notion-Version": os.getenv("NOTION_VERSION") or _DEFAULT_VERSION,
        "Content-Type": "application/json",
    }


def _request(method: str, path: str, *, json: dict | None = None, params: dict | None = None) -> dict:
    resp = requests.request(method, f"{_API}{path}", headers=_headers(), json=json, params=params, timeout=_TIMEOUT)
    if resp.status_code >= 300:
        try:
            msg = resp.json().get("message", resp.text)
        except Exception:  # noqa: BLE001
            msg = resp.text
        raise NotionError(f"Notion API {resp.status_code}: {msg}")
    return resp.json()


def _rich_text_to_plain(rich: list | None) -> str:
    return "".join(r.get("plain_text", "") for r in (rich or []))


def _title_of(obj: dict) -> str:
    """Best-effort title for a page or database object."""
    if obj.get("object") == "database":
        return _rich_text_to_plain(obj.get("title", [])) or "(untitled database)"
    for prop in obj.get("properties", {}).values():
        if prop.get("type") == "title":
            return _rich_text_to_plain(prop.get("title", [])) or "(untitled)"
    return "(untitled)"


def status() -> dict:
    if not configured():
        return {"configured": False, "connected": False, "workspace": None, "last_error": None}
    now = time.time()
    cached = _status_cache["value"]
    if cached is not None and now - _status_cache["at"] < _STATUS_TTL:
        return cached
    try:
        me = _request("GET", "/users/me")
        workspace = me.get("bot", {}).get("workspace_name") or me.get("name")
        value = {"configured": True, "connected": True, "workspace": workspace, "last_error": None}
    except Exception as exc:  # noqa: BLE001
        value = {"configured": True, "connected": False, "workspace": None, "last_error": str(exc)}
    _status_cache["at"] = now
    _status_cache["value"] = value
    return value
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/notion_service.py backend/test_notion.py
git commit -m "feat(notion): REST client + status (M-Notion task 1)"
```

---

### Task 2: `notion_service.py` — read helpers

**Files:**
- Modify: `backend/notion_service.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Consumes: `_request`, `_rich_text_to_plain`, `_title_of` (Task 1).
- Produces: `list_pages(limit=25) -> list[dict]` (`{id,title,last_edited}`); `list_databases(limit=25) -> list[dict]`; `search(query, limit=25) -> list[dict]` (`{id,object,title}`); `read_page(page_id, max_blocks=300) -> str`; `query_database(database_id, filter=None, limit=25) -> list[dict]` (`{id,title,properties}`); internal `_search`, `_block_text`, `_prop_to_text`.

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def test_list_pages_parses(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    results = {"results": [
        {"object": "page", "id": "p1", "last_edited_time": "2026-07-03T00:00:00Z",
         "properties": {"Name": {"type": "title", "title": [{"plain_text": "My Page"}]}}},
    ]}
    _mock_request(monkeypatch, lambda m, u, **k: _Resp(results))
    pages = notion_service.list_pages()
    assert pages == [{"id": "p1", "title": "My Page", "last_edited": "2026-07-03T00:00:00Z"}]


def test_read_page_extracts_text(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")

    def handler(method, url, **kw):
        if url.endswith("/pages/pg"):
            return _Resp({"object": "page", "properties": {"Name": {"type": "title", "title": [{"plain_text": "Notes"}]}}})
        if "/blocks/pg/children" in url:
            return _Resp({"results": [
                {"type": "heading_1", "heading_1": {"rich_text": [{"plain_text": "Heading"}]}},
                {"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "Body line."}]}},
                {"type": "to_do", "to_do": {"rich_text": [{"plain_text": "task"}], "checked": True}},
                {"type": "unsupported_widget", "unsupported_widget": {}},
            ], "has_more": False})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    text = notion_service.read_page("pg")
    assert "# Notes" in text and "Heading" in text and "Body line." in text and "[x] task" in text
    assert "unsupported" not in text


def test_query_database_flattens(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    rows = {"results": [
        {"id": "r1", "properties": {
            "Name": {"type": "title", "title": [{"plain_text": "Row one"}]},
            "Status": {"type": "select", "select": {"name": "Done"}},
            "Count": {"type": "number", "number": 3},
        }},
    ]}
    _mock_request(monkeypatch, lambda m, u, **k: _Resp(rows))
    out = notion_service.query_database("db")
    assert out[0]["id"] == "r1" and out[0]["title"] == "Row one"
    assert out[0]["properties"]["Status"] == "Done" and out[0]["properties"]["Count"] == "3"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`AttributeError: module 'notion_service' has no attribute 'list_pages'`)

- [ ] **Step 3: Write the implementation** — append to `backend/notion_service.py`:

```python
# ---------- read helpers ----------

def _search(query: str, obj_filter: str | None, limit: int) -> list[dict]:
    body: dict = {"page_size": min(limit, 100)}
    if query:
        body["query"] = query
    if obj_filter:
        body["filter"] = {"property": "object", "value": obj_filter}
    return _request("POST", "/search", json=body).get("results", [])


def list_pages(limit: int = 25) -> list[dict]:
    return [{"id": r["id"], "title": _title_of(r), "last_edited": r.get("last_edited_time", "")}
            for r in _search("", "page", limit)]


def list_databases(limit: int = 25) -> list[dict]:
    return [{"id": r["id"], "title": _title_of(r), "last_edited": r.get("last_edited_time", "")}
            for r in _search("", "database", limit)]


def search(query: str, limit: int = 25) -> list[dict]:
    return [{"id": r["id"], "object": r.get("object", ""), "title": _title_of(r)}
            for r in _search(query, None, limit)]


_TEXT_BLOCKS = {
    "paragraph", "heading_1", "heading_2", "heading_3",
    "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout", "code",
}


def _block_text(block: dict) -> str:
    btype = block.get("type", "")
    if btype not in _TEXT_BLOCKS:
        return ""
    payload = block.get(btype, {})
    text = _rich_text_to_plain(payload.get("rich_text", []))
    if btype == "to_do":
        return f"[{'x' if payload.get('checked') else ' '}] {text}"
    if btype in ("bulleted_list_item", "numbered_list_item"):
        return f"- {text}"
    return text


def read_page(page_id: str, max_blocks: int = 300) -> str:
    page = _request("GET", f"/pages/{page_id}")
    title = _title_of(page)
    lines: list[str] = []
    cursor: str | None = None
    while len(lines) < max_blocks:
        params: dict = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        data = _request("GET", f"/blocks/{page_id}/children", params=params)
        for b in data.get("results", []):
            t = _block_text(b)
            if t:
                lines.append(t)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    body = "\n".join(lines) if lines else "(no readable text content)"
    return f"# {title}\n\n{body}"


def _prop_to_text(prop: dict) -> str:
    ptype = prop.get("type", "")
    val = prop.get(ptype)
    if ptype in ("title", "rich_text"):
        return _rich_text_to_plain(val)
    if ptype == "number":
        return "" if val is None else str(val)
    if ptype in ("select", "status"):
        return val.get("name", "") if val else ""
    if ptype == "multi_select":
        return ", ".join(o.get("name", "") for o in (val or []))
    if ptype == "date":
        return (val or {}).get("start", "") if val else ""
    if ptype == "checkbox":
        return "yes" if val else "no"
    if ptype in ("url", "email", "phone_number"):
        return val or ""
    if ptype == "people":
        return ", ".join(p.get("name", "") for p in (val or []))
    return ""


def query_database(database_id: str, filter: dict | None = None, limit: int = 25) -> list[dict]:
    body: dict = {"page_size": min(limit, 100)}
    if filter:
        body["filter"] = filter
    data = _request("POST", f"/databases/{database_id}/query", json=body)
    rows = []
    for r in data.get("results", []):
        props = {name: _prop_to_text(p) for name, p in r.get("properties", {}).items()}
        rows.append({"id": r["id"], "title": _title_of(r), "properties": props})
    return rows
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/notion_service.py backend/test_notion.py
git commit -m "feat(notion): read helpers — list/search/read_page/query_database (task 2)"
```

---

### Task 3: `notion_service.py` — action helpers + property coercion

**Files:**
- Modify: `backend/notion_service.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Consumes: `_request`, `_search` (Tasks 1–2).
- Produces: `create_page(parent, title, content="") -> str`; `create_database_item(database_id, properties) -> str`; internal `_looks_like_id`, `_resolve_page_id`, `_resolve_database_id`, `_paragraphs`, `_coerce_value`, `_coerce_properties(schema, props) -> (dict, list[str])`.

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def test_coerce_properties_types():
    schema = {"properties": {
        "Name": {"type": "title"}, "Notes": {"type": "rich_text"}, "Count": {"type": "number"},
        "Status": {"type": "select"}, "Due": {"type": "date"}, "Done": {"type": "checkbox"},
    }}
    payload, skipped = notion_service._coerce_properties(schema, {
        "name": "Task", "Count": 5, "Status": "Open", "Due": "2026-07-10", "Done": "yes", "Ghost": "x",
    })
    assert payload["Name"]["title"][0]["text"]["content"] == "Task"   # case-insensitive name match
    assert payload["Count"]["number"] == 5.0
    assert payload["Status"]["select"]["name"] == "Open"
    assert payload["Due"]["date"]["start"] == "2026-07-10"
    assert payload["Done"]["checkbox"] is True
    assert "Ghost" in skipped


def test_create_page_builds_body(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}

    def handler(method, url, **kw):
        if url.endswith("/pages") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "new1", "url": "http://n/new1"})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    msg = notion_service.create_page("11111111111111111111111111111111", "Title", "Line 1\n\nLine 2")
    assert "new1" in msg
    assert seen["body"]["parent"] == {"page_id": "11111111111111111111111111111111"}
    assert seen["body"]["properties"]["title"]["title"][0]["text"]["content"] == "Title"
    assert len(seen["body"]["children"]) == 2


def test_create_page_unresolved_name(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    _mock_request(monkeypatch, lambda m, u, **k: _Resp({"results": []}))  # search finds nothing
    msg = notion_service.create_page("Nonexistent Page", "T", "")
    assert "Couldn't find" in msg and "share it" in msg.lower()


def test_create_database_item_coerces(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}

    def handler(method, url, **kw):
        if "/databases/db1" in url and method == "GET":
            return _Resp({"properties": {"Name": {"type": "title"}, "Count": {"type": "number"}}})
        if url.endswith("/pages") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "row1", "url": "http://n/row1"})
        raise AssertionError(url)

    _mock_request(monkeypatch, handler)
    msg = notion_service.create_database_item("db1", {"Name": "Widget", "Count": 7})
    assert "row1" in msg
    assert seen["body"]["parent"] == {"database_id": "db1"}
    assert seen["body"]["properties"]["Name"]["title"][0]["text"]["content"] == "Widget"
    assert seen["body"]["properties"]["Count"]["number"] == 7.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`no attribute '_coerce_properties'` / `create_page`)

- [ ] **Step 3: Write the implementation** — append to `backend/notion_service.py`:

```python
# ---------- action helpers (gated upstream) ----------

def _looks_like_id(s: str) -> bool:
    t = str(s).replace("-", "")
    return len(t) == 32 and all(c in "0123456789abcdefABCDEF" for c in t)


def _resolve_page_id(parent: str) -> str | None:
    if _looks_like_id(parent):
        return parent
    hits = _search(parent, "page", 1)
    return hits[0]["id"] if hits else None


def _resolve_database_id(database: str) -> str | None:
    if _looks_like_id(database):
        return database
    hits = _search(database, "database", 1)
    return hits[0]["id"] if hits else None


def _paragraphs(content: str) -> list[dict]:
    blocks = []
    for para in (content or "").split("\n\n"):
        para = para.strip()
        if para:
            blocks.append({
                "object": "block", "type": "paragraph",
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": para}}]},
            })
    return blocks


def create_page(parent: str, title: str, content: str = "") -> str:
    page_id = _resolve_page_id(parent)
    if not page_id:
        return (f"Couldn't find a shared page named {parent!r}. Share it with the Zenith integration "
                f"in Notion (page -> ... -> Connections), then try again.")
    body: dict = {
        "parent": {"page_id": page_id},
        "properties": {"title": {"title": [{"type": "text", "text": {"content": title}}]}},
    }
    blocks = _paragraphs(content)
    if blocks:
        body["children"] = blocks
    page = _request("POST", "/pages", json=body)
    return f"Created Notion page {title!r} ({page.get('url', page.get('id', ''))})."


def _coerce_value(ptype: str, value):
    """Coerce a plain value into a Notion property payload for the schema type. None = skip."""
    if value is None:
        return None
    if ptype == "title":
        return {"title": [{"type": "text", "text": {"content": str(value)}}]}
    if ptype == "rich_text":
        return {"rich_text": [{"type": "text", "text": {"content": str(value)}}]}
    if ptype == "number":
        try:
            return {"number": float(value)}
        except (TypeError, ValueError):
            return None
    if ptype == "select":
        return {"select": {"name": str(value)}}
    if ptype == "status":
        return {"status": {"name": str(value)}}
    if ptype == "multi_select":
        names = value if isinstance(value, list) else [v.strip() for v in str(value).split(",")]
        return {"multi_select": [{"name": str(n)} for n in names if str(n).strip()]}
    if ptype == "date":
        return {"date": {"start": str(value)}}
    if ptype == "checkbox":
        checked = value if isinstance(value, bool) else str(value).strip().lower() in {"true", "yes", "1", "done", "checked"}
        return {"checkbox": checked}
    if ptype in ("url", "email", "phone_number"):
        return {ptype: str(value)}
    return None


def _coerce_properties(schema: dict, props: dict) -> tuple[dict, list[str]]:
    schema_props = schema.get("properties", {})
    by_lower = {name.lower(): name for name in schema_props}
    payload: dict = {}
    skipped: list[str] = []
    for raw_name, value in (props or {}).items():
        actual = raw_name if raw_name in schema_props else by_lower.get(str(raw_name).lower())
        if not actual:
            skipped.append(str(raw_name))
            continue
        coerced = _coerce_value(schema_props[actual].get("type", ""), value)
        if coerced is None:
            skipped.append(f"{raw_name} ({schema_props[actual].get('type', 'unknown')})")
        else:
            payload[actual] = coerced
    return payload, skipped


def create_database_item(database_id: str, properties: dict) -> str:
    db_id = _resolve_database_id(database_id)
    if not db_id:
        return (f"Couldn't find a shared database named {database_id!r}. Share it with the Zenith "
                f"integration in Notion, then try again.")
    schema = _request("GET", f"/databases/{db_id}")
    payload, skipped = _coerce_properties(schema, properties or {})
    if not payload:
        return "No matching properties for that database — check the field names against its columns."
    page = _request("POST", "/pages", json={"parent": {"database_id": db_id}, "properties": payload})
    note = f" (skipped: {', '.join(skipped)})" if skipped else ""
    return f"Added a row to the database ({page.get('url', page.get('id', ''))}).{note}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/notion_service.py backend/test_notion.py
git commit -m "feat(notion): create_page + create_database_item with property coercion (task 3)"
```

---

### Task 4: `tools.py` + `activity_log.py` wiring

**Files:**
- Modify: `backend/tools.py` (import, 7 schemas in `TOOLS`, 7 executors, `_EXECUTORS`, `ACTION_TOOLS`, `UNTRUSTED_TOOLS`, `_activity_target`, `run_tool` catch)
- Modify: `backend/activity_log.py` (`_MAP`)
- Test: `backend/test_notion.py`

**Interfaces:**
- Consumes: all `notion_service` functions (Tasks 1–3).
- Produces: tool names `list_notion_pages`, `list_notion_databases`, `search_notion`, `read_notion_page`, `query_notion_database`, `create_notion_page`, `create_notion_database_item` runnable via `tools.run_tool`.

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
import tools


def test_gate_and_untrusted_membership():
    assert {"create_notion_page", "create_notion_database_item"} <= tools.ACTION_TOOLS
    reads = {"list_notion_pages", "list_notion_databases", "search_notion", "read_notion_page", "query_notion_database"}
    assert reads <= tools.UNTRUSTED_TOOLS


def test_all_notion_tools_registered():
    names = {t["name"] for t in tools.TOOLS}
    expected = {"list_notion_pages", "list_notion_databases", "search_notion", "read_notion_page",
                "query_notion_database", "create_notion_page", "create_notion_database_item"}
    assert expected <= names
    assert expected <= set(tools._EXECUTORS)


def test_read_notion_page_executor(monkeypatch):
    monkeypatch.setattr(tools.notion_service, "read_page", lambda pid: f"# Page {pid}")
    assert tools.run_tool("read_notion_page", {"page_id": "abc"}) == "# Page abc"


def test_notion_activity_mapped():
    import activity_log
    for name in ("read_notion_page", "create_notion_page", "create_notion_database_item"):
        assert name in activity_log._MAP
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`create_notion_page` not in `ACTION_TOOLS`, etc.)

- [ ] **Step 3a: Import the service** — in `backend/tools.py`, add to the import block (after `import news_service`):

```python
import notion_service
```

- [ ] **Step 3b: Add the executors** — in `backend/tools.py`, just before `# ---------- registry ----------`:

```python
# ---------- Notion executors (reads are UNTRUSTED; creates are GATED) ----------

def _list_notion_pages(_i: dict) -> str:
    pages = notion_service.list_pages()
    if not pages:
        return "No Notion pages are shared with the integration yet (see SETUP-NOTION.md)."
    return "Notion pages:\n" + "\n".join(f"- {p['title']} [id:{p['id']}]" for p in pages)


def _list_notion_databases(_i: dict) -> str:
    dbs = notion_service.list_databases()
    if not dbs:
        return "No Notion databases are shared with the integration yet (see SETUP-NOTION.md)."
    return "Notion databases:\n" + "\n".join(f"- {d['title']} [id:{d['id']}]" for d in dbs)


def _search_notion(i: dict) -> str:
    hits = notion_service.search(i.get("query", ""))
    if not hits:
        return "No Notion results (only pages/databases shared with the integration are searchable)."
    return "Notion results:\n" + "\n".join(f"- ({h['object']}) {h['title']} [id:{h['id']}]" for h in hits)


def _read_notion_page(i: dict) -> str:
    if not i.get("page_id"):
        return "read_notion_page needs a page_id."
    return notion_service.read_page(i["page_id"])


def _query_notion_database(i: dict) -> str:
    if not i.get("database_id"):
        return "query_notion_database needs a database_id."
    rows = notion_service.query_database(i["database_id"], i.get("filter"))
    if not rows:
        return "No rows."
    lines = []
    for r in rows:
        fields = "; ".join(f"{k}={v}" for k, v in r["properties"].items() if v)
        lines.append(f"- {r['title']} [id:{r['id']}] {fields}".rstrip())
    return "Notion rows:\n" + "\n".join(lines)


def _create_notion_page(i: dict) -> str:
    if not i.get("parent") or not i.get("title"):
        return "create_notion_page needs a parent and a title."
    return notion_service.create_page(i["parent"], i["title"], i.get("content", ""))


def _create_notion_database_item(i: dict) -> str:
    if not i.get("database_id") or not i.get("properties"):
        return "create_notion_database_item needs a database_id and properties."
    return notion_service.create_database_item(i["database_id"], i["properties"])
```

- [ ] **Step 3c: Add the 7 schemas** — in `backend/tools.py`, inside the `TOOLS = [ ... ]` list, before the closing `]`:

```python
    {
        "name": "list_notion_pages",
        "description": "List the Notion pages shared with Zenith's integration. Use for 'what can you "
        "see in Notion', 'list my Notion pages'.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_notion_databases",
        "description": "List the Notion databases shared with Zenith's integration.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "search_notion",
        "description": "Search the owner's shared Notion pages and databases by keyword.",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string", "description": "Search text"}}, "required": ["query"]},
    },
    {
        "name": "read_notion_page",
        "description": "Read a Notion page's text content by id (get the id from list_notion_pages or search_notion first).",
        "input_schema": {"type": "object", "properties": {"page_id": {"type": "string", "description": "Notion page id"}}, "required": ["page_id"]},
    },
    {
        "name": "query_notion_database",
        "description": "List rows of a Notion database by id (get the id from list_notion_databases or "
        "search_notion first). Returns each row's title + fields.",
        "input_schema": {"type": "object", "properties": {
            "database_id": {"type": "string", "description": "Notion database id"},
            "filter": {"type": "object", "description": "Optional Notion filter object"},
        }, "required": ["database_id"]},
    },
    {
        "name": "create_notion_page",
        "description": "Create a new Notion page under a parent page, with a title and optional text "
        "content. parent is a page id OR the exact name of a shared page. Text content only.",
        "input_schema": {"type": "object", "properties": {
            "parent": {"type": "string", "description": "Parent page id or exact page name"},
            "title": {"type": "string", "description": "New page title"},
            "content": {"type": "string", "description": "Optional body text (paragraphs split on blank lines)"},
        }, "required": ["parent", "title"]},
    },
    {
        "name": "create_notion_database_item",
        "description": "Add a row to a Notion database. database_id is an id OR the exact name of a "
        "shared database. properties is a map of field name -> value (matched to the database's "
        "columns; include the title field).",
        "input_schema": {"type": "object", "properties": {
            "database_id": {"type": "string", "description": "Notion database id or exact name"},
            "properties": {"type": "object", "description": "Field name -> value map"},
        }, "required": ["database_id", "properties"]},
    },
```

- [ ] **Step 3d: Register executors** — in `backend/tools.py`, add to the `_EXECUTORS` dict:

```python
    "list_notion_pages": _list_notion_pages,
    "list_notion_databases": _list_notion_databases,
    "search_notion": _search_notion,
    "read_notion_page": _read_notion_page,
    "query_notion_database": _query_notion_database,
    "create_notion_page": _create_notion_page,
    "create_notion_database_item": _create_notion_database_item,
```

- [ ] **Step 3e: Gate + fence** — in `backend/tools.py`, extend the two sets:

```python
ACTION_TOOLS = {"send_message", "create_event", "update_event", "delete_event", "send_email",
                "send_discord_message", "create_notion_page", "create_notion_database_item"}
```

and add to `UNTRUSTED_TOOLS`:

```python
    "list_notion_pages", "list_notion_databases", "search_notion",
    "read_notion_page", "query_notion_database",
```

- [ ] **Step 3f: Activity target** — in `backend/tools.py` `_activity_target`, before the final `return ""`:

```python
    if name == "read_notion_page":
        return i.get("page_id", "")
    if name == "search_notion":
        return i.get("query", "")
    if name in ("query_notion_database", "create_notion_database_item"):
        return i.get("database_id", "")
    if name == "create_notion_page":
        return i.get("title", "")
```

- [ ] **Step 3g: Catch Notion errors** — in `backend/tools.py` `run_tool`, add a catch beside the discord one:

```python
        except (notion_service.NotionNotConnected, notion_service.NotionError) as exc:
            result, failed = str(exc), True
```

- [ ] **Step 3h: Activity map** — in `backend/activity_log.py`, add to `_MAP`:

```python
    "list_notion_pages": ("note", "info", "list Notion pages"),
    "list_notion_databases": ("note", "info", "list Notion databases"),
    "search_notion": ("note", "info", "searched Notion"),
    "read_notion_page": ("note", "info", "read Notion page"),
    "query_notion_database": ("note", "info", "queried Notion DB"),
    "create_notion_page": ("note", "ok", "Notion page created"),
    "create_notion_database_item": ("note", "ok", "Notion row added"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/tools.py backend/activity_log.py backend/test_notion.py
git commit -m "feat(notion): 7 tools on the loop — gated creates, fenced reads, activity log (task 4)"
```

---

### Task 5: `main.py` — `GET /notion/status`

**Files:**
- Modify: `backend/main.py` (import + route)
- Test: `backend/test_notion.py`

**Interfaces:**
- Consumes: `notion_service.status()`.
- Produces: `main.notion_status()` returning the status dict; route `GET /notion/status`.

- [ ] **Step 1: Write the failing test** — append to `backend/test_notion.py`:

```python
def test_notion_status_route(monkeypatch):
    import main
    monkeypatch.setattr(main.notion_service, "status", lambda: {"configured": True, "connected": True, "workspace": "W", "last_error": None})
    assert main.notion_status() == {"configured": True, "connected": True, "workspace": "W", "last_error": None}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py::test_notion_status_route -q`
Expected: FAIL (`module 'main' has no attribute 'notion_status'`)

- [ ] **Step 3a: Import** — in `backend/main.py`, add `import notion_service` beside the other service imports (near `import discord_service` / `import telegram_service`).

- [ ] **Step 3b: Add the route** — in `backend/main.py`, right after the `telegram_status` route:

```python
@app.get("/notion/status")
def notion_status() -> dict:
    """Notion integration status for the Connections row (no orb node)."""
    return notion_service.status()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py::test_notion_status_route -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_notion.py
git commit -m "feat(notion): GET /notion/status route (task 5)"
```

---

### Task 6: Frontend — Connections row (no orb node)

**Files:**
- Modify: `frontend/lib/api.ts` (`NotionStatus` + `getNotionStatus`)
- Modify: `frontend/lib/mock.ts` (`Channel` += `"Notion"`; add to `connections`)
- Modify: `frontend/app/page.tsx` (`nstatus` state + poll + `buildConnections` branch)

**Interfaces:**
- Consumes: `GET /notion/status` (Task 5).
- Produces: a Notion row in the Connections panel driven by live status. No orb node (`ZenithOrb` `NODES` unchanged).

- [ ] **Step 1: `api.ts`** — add after `getTelegramStatus`:

```typescript
export type NotionStatus = {
  connected: boolean;
  configured: boolean;
  workspace: string | null;
  last_error: string | null;
};

/** Notion integration status (internal-integration token; Connections row only, no orb node). */
export async function getNotionStatus(): Promise<NotionStatus | null> {
  try {
    const res = await apiFetch("/notion/status");
    return res.ok ? ((await res.json()) as NotionStatus) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: `mock.ts`** — extend the `Channel` type and the `connections` list:

```typescript
export type Channel = "Gmail" | "Calendar" | "Telegram" | "Discord" | "Notion";
```

and append to the `connections` array (after Discord — Notion has no orb node, so list position only affects the Connections panel order):

```typescript
  { channel: "Notion", account: "Not linked", connected: false },
```

- [ ] **Step 3: `page.tsx`** — four edits:

(a) import — add `getNotionStatus, type NotionStatus` to the existing `../lib/api` import.

(b) `buildConnections` — add the `n` parameter and a Notion branch:

```typescript
function buildConnections(g: GoogleStatus | null, d: DiscordStatus | null, t: TelegramStatus | null, n: NotionStatus | null): Connection[] {
```

add before the final `return c;`:

```typescript
    if (c.channel === "Notion")
      return { ...c, connected: !!n?.connected, account: n?.connected ? (n.workspace ?? "Connected") : n?.configured ? "Auth error" : "Not linked" };
```

(c) state + memo — add `const [nstatus, setNstatus] = useState<NotionStatus | null>(null);` beside `tstatus`, and update the memo:

```typescript
  const connections = useMemo(() => buildConnections(gstatus, dstatus, tstatus, nstatus), [gstatus, dstatus, tstatus, nstatus]);
```

(d) poll — add beside the Telegram poll block:

```typescript
  const refreshNotion = useCallback(async () => {
    setNstatus(await getNotionStatus());
  }, []);
  useEffect(() => {
    refreshNotion();
  }, [refreshNotion]);
  useEffect(() => {
    if (nstatus && (nstatus.connected || !nstatus.configured)) return;
    const id = setInterval(refreshNotion, 4000);
    return () => clearInterval(id);
  }, [nstatus, refreshNotion]);
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0 (no errors)

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/lib/mock.ts frontend/app/page.tsx
git commit -m "feat(notion): Connections row from /notion/status (no orb node) (task 6)"
```

---

### Task 7: `SETUP-NOTION.md` + `.env.example`

**Files:**
- Create: `SETUP-NOTION.md`
- Modify: `backend/.env.example`

- [ ] **Step 1: Write `SETUP-NOTION.md`** at the repo root:

```markdown
# Zenith — Notion setup

Zenith talks to Notion through an **internal integration** (a personal API token). Direct Notion
REST API — no MCP.

## 1. Create the integration
1. Go to https://www.notion.so/my-integrations → **New integration**.
2. Name it "Zenith", pick your workspace, keep the default capabilities (Read/Insert/Update content).
3. Copy the **Internal Integration Secret** (starts with `ntn_` / `secret_`).

## 2. Add the key
In `backend/.env`:
```
NOTION_API_KEY=ntn_your_secret_here
# NOTION_VERSION=2022-06-28   # optional
```
Restart the backend.

## 3. ⚠️ SHARE pages/databases with the integration (the #1 gotcha)
An internal integration sees **NOTHING by default** — only what you explicitly share with it.
For every page or database Zenith should see:
1. Open it in Notion.
2. Click the **⋯** menu (top-right) → **Connections** → **Connect to** → pick **Zenith**.
3. Sharing a page shares its child pages; sharing a database shares its rows.

If Zenith says "no pages are shared" or "couldn't find that page", this step is why.

## 4. Verify
- Connections panel shows a **Notion** row = **On** (workspace name).
- "What can you see in Notion?" → lists the shared page(s) + database(s).
- "Add a row to <database> …" → confirm card → Confirm → the row appears in Notion.
- "Create a page called X …" → confirm card → Confirm → the page appears in Notion.

## Notes
- Writes are text/simple content only (no tables-in-pages/embeds yet).
- Database rows: give field names that match the database's columns (case-insensitive); unmatched
  fields are skipped and named back to you.
```

- [ ] **Step 2: `.env.example`** — add a Notion block near the other integration tokens (Discord/Telegram):

```env
# Notion — internal integration (notion.so/my-integrations). SHARE pages/DBs WITH the integration
# inside Notion (page -> ... -> Connections), or Zenith sees nothing. See SETUP-NOTION.md.
NOTION_API_KEY=
NOTION_VERSION=2022-06-28
```

> If the file tooling blocks `.env.example` (it matches the `.env*` deny rule), add these two keys by hand or have the owner paste them — the values are non-secret placeholders.

- [ ] **Step 3: Commit**

```bash
git add SETUP-NOTION.md backend/.env.example
git commit -m "docs(notion): SETUP-NOTION.md + .env.example keys (task 7)"
```

---

### Task 8: Full suite + live QA handoff

**Files:** none (verification only).

- [ ] **Step 1: Backend fast suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py`
Expected: all green (was 130; now ~146 with the Notion tests).

- [ ] **Step 2: Frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Owner live QA gate** (needs the real `NOTION_API_KEY` + shared content):
  1. Owner creates the integration, sets `NOTION_API_KEY`, restarts the backend, and **shares ONE page + ONE database** with the integration.
  2. Connections panel shows **Notion — On** (workspace name).
  3. "What can you see in Notion?" → lists the shared page + database.
  4. "Add a row to `<database>` with these fields …" → ConfirmCard → Confirm → the row exists in Notion + an entry appears in the Activity Log.
  5. "Create a page called X with this content …" → ConfirmCard → Confirm → the page exists in Notion.

- [ ] **Step 4: Finish the branch** — REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` (merge `feat/notion-integration` → main after the owner's live QA passes).

---

## Self-review

- **Spec coverage:** auth model → Task 7 (SETUP); client/status → Task 1; 5 reads → Task 2; 2 creates + coercion → Task 3; tools/gate/untrusted/activity → Task 4; `/notion/status` → Task 5; Connections row / no orb node → Task 6; env → Task 7; unit tests → Tasks 1–5; live QA → Task 8. All covered.
- **Placeholder scan:** every code step contains complete code; no TBD/TODO.
- **Type consistency:** `notion_service` function names + return shapes (`list_pages`/`read_page`/`query_database`/`create_page`/`create_database_item`) match between the service (Tasks 1–3), the executors (Task 4), and the tests. `NotionStatus` fields (`connected/configured/workspace/last_error`) match `status()` and the frontend. `buildConnections` gains its 4th param `n` in the definition, the memo call, and the Notion branch consistently.
