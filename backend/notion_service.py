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
