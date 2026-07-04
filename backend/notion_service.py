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
                if len(lines) >= max_blocks:
                    break
        if len(lines) >= max_blocks or not data.get("has_more"):
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
        return (val or {}).get("start", "")
    if ptype == "checkbox":
        return "yes" if val else "no"
    if ptype in ("url", "email", "phone_number"):
        return val or ""
    if ptype == "people":
        return ", ".join(p.get("name", "") for p in (val or []))
    return ""


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


def query_database(database_id: str, filter: dict | None = None, limit: int = 25) -> list[dict]:
    body: dict = {"page_size": min(limit, 100)}
    if filter:
        body["filter"] = filter
    data = _db_query(database_id, body)
    rows = []
    for r in data.get("results", []):
        props = {name: _prop_to_text(p) for name, p in r.get("properties", {}).items()}
        rows.append({"id": r["id"], "title": _title_of(r), "properties": props})
    return rows


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


def create_page(parent: str, title: str, content: str = "", blocks: list | None = None) -> str:
    page_id = _resolve_page_id(parent)
    if not page_id:
        return (f"Couldn't find a shared page named {parent!r}. Share it with the Zenith integration "
                f"in Notion (page -> ... -> Connections), then try again.")
    body: dict = {
        "parent": {"page_id": page_id},
        "properties": {"title": {"title": [{"type": "text", "text": {"content": title}}]}},
    }
    children = _blocks_from_spec(blocks) if blocks else _paragraphs(content)
    if children:
        body["children"] = children
    page = _request("POST", "/pages", json=body)
    return f"Created Notion page {title!r} ({page.get('url', page.get('id', ''))})."


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
    schema = _db_schema(db_id)
    payload, skipped = _coerce_properties(schema, properties or {})
    if not payload:
        return "No matching properties for that database — check the field names against its columns."
    page = _request("POST", "/pages", json={"parent": _db_parent(db_id), "properties": payload})
    note = f" (skipped: {', '.join(skipped)})" if skipped else ""
    return f"Added a row to the database ({page.get('url', page.get('id', ''))}).{note}"


# ---------- edit / archive (gated upstream) ----------

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
