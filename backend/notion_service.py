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
