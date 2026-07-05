# Notion Tools Phase 2 (edit / delete / structure / comments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Zenith's Notion integration from read+create to the full surface Notion's API allows — edit rows/pages, archive (delete), append + edit + delete page content, richer block formatting on create, create/alter databases, comments, and multi-data-source (2025-09-03) support — as gated, tested tools on the EXISTING chat loop + confirm gate.

**Architecture:** All new capabilities are functions added to the existing `backend/notion_service.py` and wired as tools in `backend/tools.py` (schemas + executors + gate/untrusted/activity), exactly like the 7 Phase-1 tools. Writes/edits/deletes join `ACTION_TOOLS` (confirm gate); reads join `UNTRUSTED_TOOLS` (fenced). Database access is routed through three indirection helpers (`_db_schema` / `_db_query` / `_db_parent`) introduced in Task 1 so the risky 2025-09-03 data-source migration (Task 7) only swaps those three, not every tool. No new routes, no frontend changes (except `activity_log._MAP` entries).

**Tech Stack:** Python 3.11 FastAPI backend (run tests from `backend/.venv`), `requests` (already a dependency), Next.js 14 frontend (unchanged — `tsc` gate only).

## Global Constraints

- Direct Notion REST API, **NOT MCP**.
- Secrets only in gitignored `backend/.env` (`NOTION_API_KEY`); `Notion-Version` overridable via `NOTION_VERSION`.
- **Every new write/edit/delete/create tool goes in `ACTION_TOOLS`** (confirm gate) — `append_to_notion_page`, `update_notion_page`, `archive_notion_page`, `update_notion_block`, `delete_notion_block`, `create_notion_database`, `update_notion_database`, `add_notion_comment`. **Every new read goes in `UNTRUSTED_TOOLS`** (fenced) — `describe_notion_database`, `get_notion_comments`.
- "Delete" = **archive** (`archived: true`) — Notion soft-deletes to trash; there is no hard-delete API. Block delete (`DELETE /blocks/{id}`) also moves to trash.
- Notion **`status` property type cannot be created via the API** → `_column_defs` maps `status` → `select`.
- Comments require the token's **Read comments / Insert comments** capabilities (left OFF at setup) — the tools ship regardless; a 403 surfaces as a friendly `NotionError`. Documented in `SETUP-NOTION.md` (Task 8).
- Backend tests mock `requests` — **no live network in tests**. Run the fast suite: `cd backend && ./.venv/Scripts/python.exe -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py`.
- Build on branch `feat/notion-integration` (continues Phase-1 work; not yet merged). Do NOT merge until Task 8's live QA passes.

---

### Task 1: DB access indirection (behavior-preserving refactor)

Introduce `_db_schema` / `_db_query` / `_db_parent` and route the existing `query_database` + `create_database_item` through them. Behaviour is identical on the current `2022-06-28` version; this is the single seam the Task 7 data-source migration swaps.

**Files:**
- Modify: `backend/notion_service.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Produces: `_db_schema(database_id) -> dict`; `_db_query(database_id, body) -> dict`; `_db_parent(database_id) -> dict`.

- [ ] **Step 1: Write the failing test** — append to `backend/test_notion.py`:

```python
def test_db_indirection_shapes(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        seen["last"] = (method, url)
        if url.endswith("/databases/db/query"):
            return _Resp({"results": []})
        return _Resp({"properties": {}})
    _mock_request(monkeypatch, handler)
    assert notion_service._db_parent("db") == {"database_id": "db"}
    notion_service._db_query("db", {"page_size": 1})
    assert seen["last"] == ("POST", "https://api.notion.com/v1/databases/db/query")
    notion_service._db_schema("db")
    assert seen["last"] == ("GET", "https://api.notion.com/v1/databases/db")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py::test_db_indirection_shapes -q`
Expected: FAIL (`no attribute '_db_parent'`).

- [ ] **Step 3: Add the helpers** — in `backend/notion_service.py`, immediately BEFORE `def query_database(`:

```python
# ---------- database access indirection (the ONLY seam the 2025-09-03 data-source migration swaps) ----------

def _db_schema(database_id: str) -> dict:
    """The schema object ({'properties': {...}}) for a database — used to coerce writes and list columns."""
    return _request("GET", f"/databases/{database_id}")


def _db_query(database_id: str, body: dict) -> dict:
    """Run a rows query for a database and return the raw Notion response."""
    return _request("POST", f"/databases/{database_id}/query", json=body)


def _db_parent(database_id: str) -> dict:
    """The `parent` object for creating a row in this database."""
    return {"database_id": database_id}


```

- [ ] **Step 4: Route `query_database` through `_db_query`** — replace the one line in `query_database`:

```python
    data = _db_query(database_id, body)
```
(was `data = _request("POST", f"/databases/{database_id}/query", json=body)`)

- [ ] **Step 5: Route `create_database_item` through `_db_schema` + `_db_parent`** — in `create_database_item`, replace:

```python
    schema = _db_schema(db_id)
```
(was `schema = _request("GET", f"/databases/{db_id}")`) and

```python
    page = _request("POST", "/pages", json={"parent": _db_parent(db_id), "properties": payload})
```
(was `... json={"parent": {"database_id": db_id}, "properties": payload})`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS (all prior Notion tests + the new one; ~18).

- [ ] **Step 7: Commit**

```bash
git add backend/notion_service.py backend/test_notion.py
git commit -m "refactor(notion): route DB access through _db_schema/_db_query/_db_parent (phase2 task 1)"
```

---

### Task 2: Rich block builder + `create_page(blocks)` + `append_to_page`

**Files:**
- Modify: `backend/notion_service.py`, `backend/tools.py`, `backend/activity_log.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Produces: `_rich(text) -> list`; `_block_from_spec(item) -> dict`; `_blocks_from_spec(items) -> list[dict]`; `append_to_page(page, content="", blocks=None) -> str`; `create_page` gains a `blocks` param. Tool `create_notion_page` gains optional `blocks`; new tool `append_to_notion_page` (GATED).

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def test_blocks_from_spec_types():
    blocks = notion_service._blocks_from_spec([
        {"type": "heading_2", "text": "Plan"},
        {"type": "to_do", "text": "book flights", "checked": True},
        {"type": "bulleted_list_item", "text": "pack"},
        {"type": "divider"},
        {"type": "weird", "text": "fallback to paragraph"},
        {"type": "paragraph", "text": ""},  # empty -> dropped
    ])
    types = [b["type"] for b in blocks]
    assert types == ["heading_2", "to_do", "bulleted_list_item", "divider", "paragraph"]
    assert blocks[1]["to_do"]["checked"] is True
    assert blocks[0]["heading_2"]["rich_text"][0]["text"]["content"] == "Plan"


def test_append_to_page(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        if url.endswith("/search"):
            return _Resp({"results": [{"object": "page", "id": "pg"}]})
        if "/blocks/pg/children" in url and method == "PATCH":
            seen["body"] = kw.get("json")
            return _Resp({"results": []})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    msg = notion_service.append_to_page("My Page", content="line one\n\nline two")
    assert "2 block" in msg
    assert len(seen["body"]["children"]) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`no attribute '_blocks_from_spec'`).

- [ ] **Step 3: Add the block builder + append** — in `backend/notion_service.py`, add just AFTER `_paragraphs`:

```python
def _rich(text) -> list:
    return [{"type": "text", "text": {"content": str(text)}}]


_RICH_BLOCK_TYPES = {
    "paragraph", "heading_1", "heading_2", "heading_3",
    "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout", "code",
}


def _block_from_spec(item: dict) -> dict:
    """Build a Notion block from a simple spec {type, text, checked?, language?}. Unknown type -> paragraph."""
    btype = (item.get("type") or "paragraph").strip()
    if btype == "divider":
        return {"object": "block", "type": "divider", "divider": {}}
    if btype not in _RICH_BLOCK_TYPES:
        btype = "paragraph"
    payload: dict = {"rich_text": _rich(item.get("text", ""))}
    if btype == "to_do":
        payload["checked"] = bool(item.get("checked", False))
    if btype == "code":
        payload["language"] = item.get("language", "plain text")
    return {"object": "block", "type": btype, btype: payload}


def _blocks_from_spec(items: list | None) -> list[dict]:
    out = []
    for i in (items or []):
        if i.get("type") == "divider" or str(i.get("text", "")).strip():
            out.append(_block_from_spec(i))
    return out


def append_to_page(page: str, content: str = "", blocks: list | None = None) -> str:
    pid = _resolve_page_id(page)
    if not pid:
        return (f"Couldn't find a shared page named {page!r}. Share it with the Zenith integration, "
                f"then try again.")
    children = _blocks_from_spec(blocks) if blocks else _paragraphs(content)
    if not children:
        return "Nothing to append — give some text or blocks."
    _request("PATCH", f"/blocks/{pid}/children", json={"children": children})
    return f"Appended {len(children)} block(s) to {page!r}."
```

- [ ] **Step 4: Let `create_page` accept `blocks`** — change the `create_page` signature and body-building:

```python
def create_page(parent: str, title: str, content: str = "", blocks: list | None = None) -> str:
```
and replace the `blocks = _paragraphs(content)` / `if blocks:` lines with:

```python
    children = _blocks_from_spec(blocks) if blocks else _paragraphs(content)
    if children:
        body["children"] = children
```

- [ ] **Step 5: Wire the tools** — in `backend/tools.py`:

(a) In `_create_notion_page`, pass blocks through:

```python
def _create_notion_page(i: dict) -> str:
    if not i.get("parent") or not i.get("title"):
        return "create_notion_page needs a parent and a title."
    return notion_service.create_page(i["parent"], i["title"], i.get("content", ""), i.get("blocks"))
```

(b) Add the executor (next to `_create_notion_page`):

```python
def _append_to_notion_page(i: dict) -> str:
    if not i.get("page"):
        return "append_to_notion_page needs a page."
    return notion_service.append_to_page(i["page"], i.get("content", ""), i.get("blocks"))
```

(c) In the `create_notion_page` schema, add `blocks` to its `properties`:

```python
            "blocks": {"type": "array", "description": "Optional structured blocks instead of plain content: "
            "[{type:'heading_2'|'to_do'|'bulleted_list_item'|'numbered_list_item'|'paragraph'|'quote'|'callout'|'code'|'divider', text:'...', checked?:bool}]"},
```

(d) Add the new tool schema (in `TOOLS`, after the `create_notion_database_item` entry):

```python
    {
        "name": "append_to_notion_page",
        "description": "Add content to the END of an existing Notion page (page id or exact name). Use for "
        "'add a note to my X page', 'add these lines to X'. Pass plain content OR structured blocks.",
        "input_schema": {"type": "object", "properties": {
            "page": {"type": "string", "description": "Page id or exact page name"},
            "content": {"type": "string", "description": "Text to append (paragraphs split on blank lines)"},
            "blocks": {"type": "array", "description": "Optional structured blocks (see create_notion_page.blocks)"},
        }, "required": ["page"]},
    },
```

(e) Register the executor in `_EXECUTORS`:

```python
    "append_to_notion_page": _append_to_notion_page,
```

(f) Add to `ACTION_TOOLS`: `"append_to_notion_page"`.

(g) In `_activity_target`, before the final `return ""`:

```python
    if name == "append_to_notion_page":
        return i.get("page", "")
```

(h) In `backend/activity_log.py` `_MAP`, add:

```python
    "append_to_notion_page": ("note", "ok", "appended to Notion page"),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/notion_service.py backend/tools.py backend/activity_log.py backend/test_notion.py
git commit -m "feat(notion): rich blocks + append_to_page + create_page blocks (phase2 task 2)"
```

---

### Task 3: `update_notion_page` (title + row properties) + `archive_notion_page`

**Files:**
- Modify: `backend/notion_service.py`, `backend/tools.py`, `backend/activity_log.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Produces: `_title_prop_name(page) -> str`; `update_page(page_id, title=None, properties=None) -> str`; `archive_page(page_id) -> str`. Tools `update_notion_page`, `archive_notion_page` (both GATED).

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def test_update_page_row_properties(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        if url.endswith("/pages/row1") and method == "GET":
            return _Resp({"object": "page", "parent": {"database_id": "db1"},
                          "properties": {"Name": {"type": "title"}}})
        if url.endswith("/databases/db1") and method == "GET":
            return _Resp({"properties": {"Name": {"type": "title"}, "Status": {"type": "select"}}})
        if url.endswith("/pages/row1") and method == "PATCH":
            seen["body"] = kw.get("json")
            return _Resp({"id": "row1"})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    msg = notion_service.update_page("row1", title="Renamed", properties={"Status": "Done", "Ghost": "x"})
    assert "Updated" in msg and "Ghost" in msg  # skipped reported
    assert seen["body"]["properties"]["Name"]["title"][0]["text"]["content"] == "Renamed"
    assert seen["body"]["properties"]["Status"]["select"]["name"] == "Done"


def test_archive_page(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    _mock_request(monkeypatch, lambda m, u, **k: seen.setdefault("body", k.get("json")) or _Resp({"id": "p"}))
    msg = notion_service.archive_page("p")
    assert "Archived" in msg and seen["body"] == {"archived": True}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`no attribute 'update_page'`).

- [ ] **Step 3: Implement** — in `backend/notion_service.py`, add after `create_database_item`:

```python
def _title_prop_name(page: dict) -> str:
    for name, prop in page.get("properties", {}).items():
        if prop.get("type") == "title":
            return name
    return "title"


def update_page(page_id: str, title: str | None = None, properties: dict | None = None) -> str:
    page = _request("GET", f"/pages/{page_id}")
    payload: dict = {}
    skipped: list[str] = []
    if title is not None:
        payload[_title_prop_name(page)] = {"title": _rich(title)}
    if properties:
        db_id = page.get("parent", {}).get("database_id")
        if db_id:
            coerced, skipped = _coerce_properties(_db_schema(db_id), properties)
            payload.update(coerced)
        else:
            skipped = list(properties.keys())  # a plain page has no database columns to set
    if not payload:
        return "Nothing to update — give a new title and/or properties."
    _request("PATCH", f"/pages/{page_id}", json={"properties": payload})
    note = f" (skipped: {', '.join(skipped)})" if skipped else ""
    return f"Updated the page.{note}"


def archive_page(page_id: str) -> str:
    _request("PATCH", f"/pages/{page_id}", json={"archived": True})
    return "Archived (moved to Notion trash — recoverable)."
```

- [ ] **Step 4: Wire the tools** — in `backend/tools.py`:

(a) Executors (next to the other Notion executors):

```python
def _update_notion_page(i: dict) -> str:
    if not i.get("page_id"):
        return "update_notion_page needs a page_id."
    return notion_service.update_page(i["page_id"], i.get("title"), i.get("properties"))


def _archive_notion_page(i: dict) -> str:
    if not i.get("page_id"):
        return "archive_notion_page needs a page_id."
    return notion_service.archive_page(i["page_id"])
```

(b) Schemas (in `TOOLS`, after `append_to_notion_page`):

```python
    {
        "name": "update_notion_page",
        "description": "Update an existing Notion page or database row by id: change its title and/or its "
        "database field values. Get the id from query_notion_database / read results. Cannot create fields.",
        "input_schema": {"type": "object", "properties": {
            "page_id": {"type": "string", "description": "Page or row id"},
            "title": {"type": "string", "description": "New title (optional)"},
            "properties": {"type": "object", "description": "Field name -> new value map (rows only)"},
        }, "required": ["page_id"]},
    },
    {
        "name": "archive_notion_page",
        "description": "Archive (delete) a Notion page or database row by id — moves it to Notion's trash, "
        "recoverable. Use for 'delete/remove that page/row'. Confirm-gated.",
        "input_schema": {"type": "object", "properties": {
            "page_id": {"type": "string", "description": "Page or row id to archive"},
        }, "required": ["page_id"]},
    },
```

(c) `_EXECUTORS`: `"update_notion_page": _update_notion_page,` and `"archive_notion_page": _archive_notion_page,`.

(d) `ACTION_TOOLS` += `"update_notion_page", "archive_notion_page"`.

(e) `_activity_target` before final return:

```python
    if name in ("update_notion_page", "archive_notion_page"):
        return i.get("page_id", "")
```

(f) `activity_log._MAP`:

```python
    "update_notion_page": ("note", "ok", "Notion page updated"),
    "archive_notion_page": ("note", "warn", "Notion page archived"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/notion_service.py backend/tools.py backend/activity_log.py backend/test_notion.py
git commit -m "feat(notion): update_notion_page + archive_notion_page (phase2 task 3)"
```

---

### Task 4: `update_notion_block` + `delete_notion_block` (find a line by text)

**Files:**
- Modify: `backend/notion_service.py`, `backend/tools.py`, `backend/activity_log.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Consumes: `_block_text`, `_resolve_page_id` (Phase 1).
- Produces: `_iter_page_blocks(page_id, max_blocks=300)`; `_find_block(page_id, match) -> dict | None`; `update_block(page, match, new_text=None, checked=None) -> str`; `delete_block(page, match) -> str`. Tools `update_notion_block`, `delete_notion_block` (GATED).

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def _page_with_blocks(monkeypatch, blocks):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    calls = {}
    def handler(method, url, **kw):
        if url.endswith("/search"):
            return _Resp({"results": [{"object": "page", "id": "pg"}]})
        if "/blocks/pg/children" in url and method == "GET":
            return _Resp({"results": blocks, "has_more": False})
        calls["last"] = (method, url, kw.get("json"))
        return _Resp({"id": "b"})
    _mock_request(monkeypatch, handler)
    return calls


def test_update_block_matches_and_checks(monkeypatch):
    blocks = [{"id": "b1", "type": "to_do", "to_do": {"rich_text": [{"plain_text": "book flights"}], "checked": False}}]
    calls = _page_with_blocks(monkeypatch, blocks)
    msg = notion_service.update_block("Trip", "book flights", checked=True)
    assert "Updated" in msg
    assert calls["last"][0] == "PATCH" and calls["last"][1].endswith("/blocks/b1")
    assert calls["last"][2]["to_do"]["checked"] is True


def test_delete_block(monkeypatch):
    blocks = [{"id": "b9", "type": "paragraph", "paragraph": {"rich_text": [{"plain_text": "old note"}]}}]
    calls = _page_with_blocks(monkeypatch, blocks)
    msg = notion_service.delete_block("Notes", "old note")
    assert "Deleted" in msg and calls["last"][0] == "DELETE" and calls["last"][1].endswith("/blocks/b9")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`no attribute 'update_block'`).

- [ ] **Step 3: Implement** — in `backend/notion_service.py`, add after `archive_page`:

```python
def _iter_page_blocks(page_id: str, max_blocks: int = 300):
    cursor = None
    seen = 0
    while seen < max_blocks:
        params: dict = {"page_size": 100}
        if cursor:
            params["start_cursor"] = cursor
        data = _request("GET", f"/blocks/{page_id}/children", params=params)
        for b in data.get("results", []):
            yield b
            seen += 1
            if seen >= max_blocks:
                return
        if not data.get("has_more"):
            return
        cursor = data.get("next_cursor")


def _find_block(page_id: str, match: str) -> dict | None:
    m = str(match).strip().lower()
    for b in _iter_page_blocks(page_id):
        if m and m in _block_text(b).lower():
            return b
    return None


def update_block(page: str, match: str, new_text: str | None = None, checked: bool | None = None) -> str:
    pid = _resolve_page_id(page)
    if not pid:
        return f"Couldn't find a shared page named {page!r}."
    block = _find_block(pid, match)
    if not block:
        return f"No line matching {match!r} on that page."
    btype = block["type"]
    payload: dict = {}
    if new_text is not None:
        payload["rich_text"] = _rich(new_text)
    if checked is not None and btype == "to_do":
        payload["checked"] = bool(checked)
    if not payload:
        return "Nothing to change — give new_text and/or checked (checked only works on a to-do)."
    _request("PATCH", f"/blocks/{block['id']}", json={btype: payload})
    return "Updated the line."


def delete_block(page: str, match: str) -> str:
    pid = _resolve_page_id(page)
    if not pid:
        return f"Couldn't find a shared page named {page!r}."
    block = _find_block(pid, match)
    if not block:
        return f"No line matching {match!r} on that page."
    _request("DELETE", f"/blocks/{block['id']}")
    return "Deleted the line."
```

- [ ] **Step 4: Wire the tools** — in `backend/tools.py`:

(a) Executors:

```python
def _update_notion_block(i: dict) -> str:
    if not i.get("page") or not i.get("match"):
        return "update_notion_block needs a page and a match (text to find)."
    return notion_service.update_block(i["page"], i["match"], i.get("new_text"), i.get("checked"))


def _delete_notion_block(i: dict) -> str:
    if not i.get("page") or not i.get("match"):
        return "delete_notion_block needs a page and a match (text to find)."
    return notion_service.delete_block(i["page"], i["match"])
```

(b) Schemas (in `TOOLS`, after `archive_notion_page`):

```python
    {
        "name": "update_notion_block",
        "description": "Edit one line/block on a Notion page: find the line by a text snippet, then change its "
        "text and/or check/uncheck it (if it's a to-do). Use for 'tick off X', 'fix the line that says Y'.",
        "input_schema": {"type": "object", "properties": {
            "page": {"type": "string", "description": "Page id or exact name"},
            "match": {"type": "string", "description": "A snippet of the line's current text to find it by"},
            "new_text": {"type": "string", "description": "Replacement text (optional)"},
            "checked": {"type": "boolean", "description": "Check/uncheck a to-do line (optional)"},
        }, "required": ["page", "match"]},
    },
    {
        "name": "delete_notion_block",
        "description": "Delete one line/block from a Notion page, found by a text snippet (moves it to trash). "
        "Use for 'remove the line that says X'. Confirm-gated.",
        "input_schema": {"type": "object", "properties": {
            "page": {"type": "string", "description": "Page id or exact name"},
            "match": {"type": "string", "description": "A snippet of the line's text to find it by"},
        }, "required": ["page", "match"]},
    },
```

(c) `_EXECUTORS`: `"update_notion_block": _update_notion_block,` and `"delete_notion_block": _delete_notion_block,`.

(d) `ACTION_TOOLS` += `"update_notion_block", "delete_notion_block"`.

(e) `_activity_target` before final return:

```python
    if name in ("update_notion_block", "delete_notion_block"):
        return i.get("page", "")
```

(f) `activity_log._MAP`:

```python
    "update_notion_block": ("note", "ok", "Notion line updated"),
    "delete_notion_block": ("note", "warn", "Notion line deleted"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/notion_service.py backend/tools.py backend/activity_log.py backend/test_notion.py
git commit -m "feat(notion): update/delete a page block by text match (phase2 task 4)"
```

---

### Task 5: `describe_notion_database` + `create_notion_database` + `update_notion_database`

**Files:**
- Modify: `backend/notion_service.py`, `backend/tools.py`, `backend/activity_log.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Consumes: `_db_schema`, `_resolve_database_id`, `_resolve_page_id`, `_rich`.
- Produces: `_column_defs(columns) -> dict`; `describe_database(database) -> str`; `create_database(parent, title, columns) -> str`; `update_database(database, add_columns=None, rename=None, title=None) -> str`. Tools `describe_notion_database` (UNTRUSTED read), `create_notion_database` + `update_notion_database` (GATED).

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def test_column_defs_ensures_title_and_maps_status():
    defs = notion_service._column_defs({"Amount": "number", "Stage": "status"})
    assert defs["Name"] == {"title": {}}            # title injected
    assert defs["Amount"] == {"number": {"format": "number"}}
    assert defs["Stage"] == {"select": {}}          # status -> select (not API-creatable)


def test_create_database_body(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        if url.endswith("/search"):
            return _Resp({"results": [{"object": "page", "id": "par"}]})
        if url.endswith("/databases") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "newdb", "url": "http://n/newdb"})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    msg = notion_service.create_database("Home", "Expenses", {"Item": "title", "Amount": "number"})
    assert "newdb" in msg
    assert seen["body"]["parent"] == {"type": "page_id", "page_id": "par"}
    assert seen["body"]["properties"]["Item"] == {"title": {}}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`no attribute '_column_defs'`).

- [ ] **Step 3: Implement** — in `backend/notion_service.py`, add after `delete_block`:

```python
def _column_defs(columns: dict) -> dict:
    """Build a Notion property-schema dict from a simple {name: type} map. Ensures exactly one title
    column. 'status' is not API-creatable -> mapped to 'select'."""
    defs: dict = {}
    has_title = False
    for name, ctype in (columns or {}).items():
        c = str(ctype).strip().lower()
        if c == "title":
            defs[name] = {"title": {}}
            has_title = True
        elif c in ("text", "rich_text"):
            defs[name] = {"rich_text": {}}
        elif c == "number":
            defs[name] = {"number": {"format": "number"}}
        elif c in ("select", "status"):
            defs[name] = {"select": {}}
        elif c == "multi_select":
            defs[name] = {"multi_select": {}}
        elif c == "date":
            defs[name] = {"date": {}}
        elif c == "checkbox":
            defs[name] = {"checkbox": {}}
        elif c in ("url", "email"):
            defs[name] = {c: {}}
        elif c in ("phone", "phone_number"):
            defs[name] = {"phone_number": {}}
        else:
            defs[name] = {"rich_text": {}}
    if not has_title:
        defs = {"Name": {"title": {}}, **defs}
    return defs


def describe_database(database: str) -> str:
    db_id = _resolve_database_id(database)
    if not db_id:
        return f"Couldn't find a shared database named {database!r}."
    cols = {name: p.get("type", "") for name, p in _db_schema(db_id).get("properties", {}).items()}
    if not cols:
        return "That database has no columns."
    return "Columns:\n" + "\n".join(f"- {name} ({t})" for name, t in cols.items())


def create_database(parent: str, title: str, columns: dict) -> str:
    pid = _resolve_page_id(parent)
    if not pid:
        return f"Couldn't find a shared parent page named {parent!r}."
    body = {"parent": {"type": "page_id", "page_id": pid},
            "title": _rich(title),
            "properties": _column_defs(columns)}
    db = _request("POST", "/databases", json=body)
    return f"Created database {title!r} ({db.get('url', db.get('id', ''))})."


def update_database(database: str, add_columns: dict | None = None, rename: dict | None = None,
                    title: str | None = None) -> str:
    db_id = _resolve_database_id(database)
    if not db_id:
        return f"Couldn't find a shared database named {database!r}."
    body: dict = {}
    if title is not None:
        body["title"] = _rich(title)
    props: dict = {}
    if add_columns:
        props.update(_column_defs(add_columns))
        props.pop("Name", None)  # never inject a title column on update
    if rename:
        for old, new in rename.items():
            props[old] = {"name": str(new)}
    if props:
        body["properties"] = props
    if not body:
        return "Nothing to change — give add_columns, rename, and/or title."
    _request("PATCH", f"/databases/{db_id}", json=body)
    return f"Updated the database {database!r}."
```

- [ ] **Step 4: Wire the tools** — in `backend/tools.py`:

(a) Executors:

```python
def _describe_notion_database(i: dict) -> str:
    if not i.get("database"):
        return "describe_notion_database needs a database (id or name)."
    return notion_service.describe_database(i["database"])


def _create_notion_database(i: dict) -> str:
    if not i.get("parent") or not i.get("title") or not i.get("columns"):
        return "create_notion_database needs a parent page, a title, and columns."
    return notion_service.create_database(i["parent"], i["title"], i["columns"])


def _update_notion_database(i: dict) -> str:
    if not i.get("database"):
        return "update_notion_database needs a database (id or name)."
    return notion_service.update_database(i["database"], i.get("add_columns"), i.get("rename"), i.get("title"))
```

(b) Schemas (in `TOOLS`, after `delete_notion_block`):

```python
    {
        "name": "describe_notion_database",
        "description": "List a Notion database's columns and their types (id or exact name). Use before adding "
        "or updating a row so field names + types are correct.",
        "input_schema": {"type": "object", "properties": {
            "database": {"type": "string", "description": "Database id or exact name"},
        }, "required": ["database"]},
    },
    {
        "name": "create_notion_database",
        "description": "Create a new Notion database (table) under a shared parent page. columns is a map of "
        "column name -> type (title, text, number, select, multi_select, date, checkbox, url, email, phone). "
        "Exactly one title column is ensured. Confirm-gated.",
        "input_schema": {"type": "object", "properties": {
            "parent": {"type": "string", "description": "Parent page id or exact name"},
            "title": {"type": "string", "description": "Database name"},
            "columns": {"type": "object", "description": "Column name -> type map"},
        }, "required": ["parent", "title", "columns"]},
    },
    {
        "name": "update_notion_database",
        "description": "Change a Notion database's structure: add columns (add_columns: name->type), rename "
        "columns (rename: old->new), and/or rename the database (title). Confirm-gated.",
        "input_schema": {"type": "object", "properties": {
            "database": {"type": "string", "description": "Database id or exact name"},
            "add_columns": {"type": "object", "description": "New columns: name -> type"},
            "rename": {"type": "object", "description": "Rename columns: old name -> new name"},
            "title": {"type": "string", "description": "New database name"},
        }, "required": ["database"]},
    },
```

(c) `_EXECUTORS`: add the three (`describe_notion_database`, `create_notion_database`, `update_notion_database`).

(d) `ACTION_TOOLS` += `"create_notion_database", "update_notion_database"` (NOT `describe`).

(e) `UNTRUSTED_TOOLS` += `"describe_notion_database"`.

(f) `_activity_target` before final return:

```python
    if name in ("describe_notion_database", "update_notion_database"):
        return i.get("database", "")
    if name == "create_notion_database":
        return i.get("title", "")
```

(g) `activity_log._MAP`:

```python
    "describe_notion_database": ("note", "info", "described Notion DB"),
    "create_notion_database": ("note", "ok", "Notion database created"),
    "update_notion_database": ("note", "ok", "Notion database updated"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/notion_service.py backend/tools.py backend/activity_log.py backend/test_notion.py
git commit -m "feat(notion): describe/create/update database structure (phase2 task 5)"
```

---

### Task 6: Comments — `get_notion_comments` + `add_notion_comment`

**Files:**
- Modify: `backend/notion_service.py`, `backend/tools.py`, `backend/activity_log.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Produces: `get_comments(page_id) -> list[dict]` (`{id,text}`); `add_comment(page_id, text) -> str`. Tools `get_notion_comments` (UNTRUSTED read), `add_notion_comment` (GATED). Requires the token's comment capabilities (documented Task 8); a disabled capability returns a 403 → `NotionError`.

- [ ] **Step 1: Write the failing tests** — append to `backend/test_notion.py`:

```python
def test_get_and_add_comments(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    seen = {}
    def handler(method, url, **kw):
        if url.endswith("/comments") and method == "GET":
            return _Resp({"results": [{"id": "c1", "rich_text": [{"plain_text": "looks good"}]}]})
        if url.endswith("/comments") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "c2"})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    assert notion_service.get_comments("pg") == [{"id": "c1", "text": "looks good"}]
    msg = notion_service.add_comment("pg", "nice")
    assert "added" in msg.lower()
    assert seen["body"]["parent"] == {"page_id": "pg"}
    assert seen["body"]["rich_text"][0]["text"]["content"] == "nice"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: FAIL (`no attribute 'get_comments'`).

- [ ] **Step 3: Implement** — in `backend/notion_service.py`, add after `update_database`:

```python
def get_comments(page_id: str) -> list[dict]:
    data = _request("GET", "/comments", params={"block_id": page_id})
    return [{"id": c.get("id", ""), "text": _rich_text_to_plain(c.get("rich_text", []))}
            for c in data.get("results", [])]


def add_comment(page_id: str, text: str) -> str:
    _request("POST", "/comments", json={"parent": {"page_id": page_id}, "rich_text": _rich(text)})
    return "Comment added."
```

- [ ] **Step 4: Wire the tools** — in `backend/tools.py`:

(a) Executors:

```python
def _get_notion_comments(i: dict) -> str:
    if not i.get("page_id"):
        return "get_notion_comments needs a page_id."
    comments = notion_service.get_comments(i["page_id"])
    if not comments:
        return "No comments on that page."
    return "Comments:\n" + "\n".join(f"- {c['text']}" for c in comments)


def _add_notion_comment(i: dict) -> str:
    if not i.get("page_id") or not i.get("text"):
        return "add_notion_comment needs a page_id and text."
    return notion_service.add_comment(i["page_id"], i["text"])
```

(b) Schemas (in `TOOLS`, after `update_notion_database`):

```python
    {
        "name": "get_notion_comments",
        "description": "Read the comments on a Notion page by id. (Needs the Notion token's 'Read comments' "
        "capability enabled.)",
        "input_schema": {"type": "object", "properties": {
            "page_id": {"type": "string", "description": "Page id"},
        }, "required": ["page_id"]},
    },
    {
        "name": "add_notion_comment",
        "description": "Add a comment to a Notion page by id. Confirm-gated. (Needs the token's 'Insert "
        "comments' capability enabled.)",
        "input_schema": {"type": "object", "properties": {
            "page_id": {"type": "string", "description": "Page id"},
            "text": {"type": "string", "description": "Comment text"},
        }, "required": ["page_id", "text"]},
    },
```

(c) `_EXECUTORS`: `"get_notion_comments": _get_notion_comments,` and `"add_notion_comment": _add_notion_comment,`.

(d) `ACTION_TOOLS` += `"add_notion_comment"`.

(e) `UNTRUSTED_TOOLS` += `"get_notion_comments"`.

(f) `_activity_target` before final return:

```python
    if name in ("get_notion_comments", "add_notion_comment"):
        return i.get("page_id", "")
```

(g) `activity_log._MAP`:

```python
    "get_notion_comments": ("note", "info", "read Notion comments"),
    "add_notion_comment": ("note", "ok", "Notion comment added"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/notion_service.py backend/tools.py backend/activity_log.py backend/test_notion.py
git commit -m "feat(notion): read + add page comments (phase2 task 6)"
```

---

### Task 7: Multi-data-source support (Notion API `2025-09-03`) — ISOLATED, LIVE-VALIDATE

Swap the three indirection helpers (and `create_database`'s body) to the data-source model so multi-source databases work. This is the ONE task that changes already-verified behaviour, so it is isolated here and MUST be live-validated in Task 8 before merge. **At execution time, confirm two API details against https://developers.notion.com/reference (they were unavailable when this plan was written): (a) the data-source query is `POST /v1/data_sources/{id}/query`; (b) database create uses `initial_data_source.properties`.**

**Files:**
- Modify: `backend/notion_service.py`
- Test: `backend/test_notion.py`

**Interfaces:**
- Produces: `_data_source_id(database_id) -> str | None`. Rewrites the internals of `_db_schema` / `_db_query` / `_db_parent` and `create_database` (public signatures unchanged, so Tasks 1–6 tools/tests that mock at the `requests` layer need their handlers updated only where they asserted a `/databases/{id}/query` or `/databases` POST path — see Step 4).

- [ ] **Step 1: Write the failing test** — append to `backend/test_notion.py`:

```python
def test_data_source_query_path(monkeypatch):
    monkeypatch.setenv("NOTION_API_KEY", "secret")
    notion_service._ds_cache.clear()
    seen = {}
    def handler(method, url, **kw):
        if url.endswith("/databases/db") and method == "GET":
            return _Resp({"data_sources": [{"id": "ds1", "name": "Main"}]})
        if "/data_sources/ds1/query" in url:
            seen["queried"] = (method, url)
            return _Resp({"results": []})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    assert notion_service._data_source_id("db") == "ds1"
    assert notion_service._db_parent("db") == {"type": "data_source_id", "data_source_id": "ds1"}
    notion_service._db_query("db", {"page_size": 1})
    assert seen["queried"][0] == "POST" and seen["queried"][1].endswith("/data_sources/ds1/query")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py::test_data_source_query_path -q`
Expected: FAIL (`no attribute '_data_source_id'`).

- [ ] **Step 3: Migrate** — in `backend/notion_service.py`:

(a) Bump the default version:

```python
_DEFAULT_VERSION = "2025-09-03"
```

(b) Add a data-source resolver + cache, immediately BEFORE `_db_schema`:

```python
_ds_cache: dict = {}


def _data_source_id(database_id: str) -> str | None:
    """The primary data source id for a database (2025-09-03 model). Cached per database id."""
    if database_id in _ds_cache:
        return _ds_cache[database_id]
    db = _request("GET", f"/databases/{database_id}")
    sources = db.get("data_sources", [])
    dsid = sources[0]["id"] if sources else None
    if dsid:
        _ds_cache[database_id] = dsid
    return dsid
```

(c) Replace the bodies of the three indirection helpers:

```python
def _db_schema(database_id: str) -> dict:
    dsid = _data_source_id(database_id)
    if not dsid:
        return {"properties": {}}
    return _request("GET", f"/data_sources/{dsid}")


def _db_query(database_id: str, body: dict) -> dict:
    dsid = _data_source_id(database_id)
    if not dsid:
        raise NotionError("Notion API: that database has no data source to query.")
    return _request("POST", f"/data_sources/{dsid}/query", json=body)


def _db_parent(database_id: str) -> dict:
    dsid = _data_source_id(database_id)
    return {"type": "data_source_id", "data_source_id": dsid}
```

(d) In `create_database`, wrap the schema under `initial_data_source`:

```python
    body = {"parent": {"type": "page_id", "page_id": pid},
            "title": _rich(title),
            "initial_data_source": {"properties": _column_defs(columns)}}
```

- [ ] **Step 4: Update the earlier mocks that asserted old paths** — in `backend/test_notion.py`, the handlers in `test_query_database_flattens`, `test_create_database_item_coerces`, `test_update_page_row_properties`, and `test_create_database_body` mock `/databases/{id}/query`, `/databases/{id}` GET (for schema), and `/databases` POST. Update each to the data-source model by adding a `data_sources` lookup + data-source paths. Minimal edits:

For `test_query_database_flattens` — replace the single-lambda mock with:

```python
    def handler(method, url, **k):
        if url.endswith("/databases/db") and method == "GET":
            return _Resp({"data_sources": [{"id": "ds", "name": "Main"}]})
        if "/data_sources/ds/query" in url:
            return _Resp(rows)
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
```

For `test_create_database_item_coerces` — the `/databases/db1` GET now returns data sources, and schema/create route through the data source:

```python
    def handler(method, url, **kw):
        if url.endswith("/search") and method == "POST":
            return _Resp({"results": [{"object": "database", "id": "db1"}]})
        if url.endswith("/databases/db1") and method == "GET":
            return _Resp({"data_sources": [{"id": "ds1", "name": "Main"}]})
        if url.endswith("/data_sources/ds1") and method == "GET":
            return _Resp({"properties": {"Name": {"type": "title"}, "Count": {"type": "number"}}})
        if url.endswith("/pages") and method == "POST":
            seen["body"] = kw.get("json")
            return _Resp({"id": "row1", "url": "http://n/row1"})
        raise AssertionError((method, url))
    _mock_request(monkeypatch, handler)
    ...
    assert seen["body"]["parent"] == {"type": "data_source_id", "data_source_id": "ds1"}
```

For `test_update_page_row_properties` — the row's schema now comes from the data source; add a `data_sources` lookup on `/databases/db1` and a `/data_sources/{id}` GET returning the properties (keep `parent.database_id` on the page — the 2025-09-03 row parent retains it).

For `test_create_database_body` — assert `seen["body"]["initial_data_source"]["properties"]["Item"] == {"title": {}}` instead of `seen["body"]["properties"]...`, and clear `notion_service._ds_cache` at the top.

Also add `notion_service._ds_cache.clear()` at the top of any DB-touching test that reuses an id, to avoid cache bleed across tests.

- [ ] **Step 5: Run the full Notion suite to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_notion.py -q`
Expected: PASS (all tests green under the data-source model).

- [ ] **Step 6: Commit**

```bash
git add backend/notion_service.py backend/test_notion.py
git commit -m "feat(notion): 2025-09-03 data-source model — multi-source DB support (phase2 task 7)"
```

---

### Task 8: Full suite + tsc + docs + live QA + finish

**Files:**
- Modify: `SETUP-NOTION.md`

- [ ] **Step 1: Backend fast suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py`
Expected: all green (~148 + the new Phase-2 tests).

- [ ] **Step 2: Frontend type-check** (no frontend code changed, but confirm nothing regressed)

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Docs** — in `SETUP-NOTION.md`, under "Notes", add:

```markdown
- Comments: to let Zenith read/add comments, open the Zenith connection → Capabilities → enable
  **Read comments** + **Insert comments** → Save.
- Databases now use Notion's 2025-09-03 data-source model, so multi-data-source databases work too.
- Zenith can edit + archive (soft-delete, recoverable) pages/rows and create/alter databases — all
  the write/edit/delete tools go through the confirm card.
```

Commit: `git add SETUP-NOTION.md && git commit -m "docs(notion): phase2 capabilities + comments capability note (task 8)"`

- [ ] **Step 4: Owner live QA gate** (real `NOTION_API_KEY`, backend restarted so the version bump loads):
  1. Restart the backend (the `2025-09-03` version bump only loads on restart).
  2. Re-run the Phase-1 reads/creates (list/search/read/query/create page/add row) against the real workspace — confirm nothing regressed under the data-source model.
  3. `describe_notion_database "Clients"` → lists columns.
  4. "Add a row… then change its status" → confirm card → `update_notion_page` updates it.
  5. "Append a line to Zenith Sandbox" → confirm → `append_to_notion_page`.
  6. "Tick off / delete a line" → confirm → `update_notion_block` / `delete_notion_block`.
  7. "Create an Expenses database under Zenith Sandbox with Item, Amount, Date" → confirm → appears in Notion.
  8. "Archive that test row" → confirm → moves to trash.
  9. (If comment capability enabled) read + add a comment.

- [ ] **Step 5: Finish the branch** — REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` (merge `feat/notion-integration` → main after the owner's live QA passes — Phase 1 + Phase 2 together).

---

## Self-review

- **Spec coverage:** edit-row/page → Task 3; archive/delete → Task 3 (+ block delete Task 4); append/edit/delete blocks → Tasks 2+4; richer create formatting → Task 2; create/alter database → Task 5; describe DB → Task 5; comments → Task 6; multi-data-source → Task 7. All of the "un-built" menu covered (file uploads + list-users intentionally out of scope).
- **Placeholder scan:** every code step is complete; the only deferred items are the two flagged API-detail confirmations in Task 7 (query method, create-db nesting), which are explicit verification steps, not placeholders.
- **Type consistency:** `_db_schema`/`_db_query`/`_db_parent` signatures are stable across Tasks 1 and 7 (only bodies change). `_rich`, `_blocks_from_spec`, `_column_defs`, `_coerce_properties` reused consistently. Tool input keys match executor reads (`page`/`page_id`/`database`/`match`/`columns`/`add_columns`/`rename`/`blocks`). Gate/untrusted/activity lists updated in every wiring task.
