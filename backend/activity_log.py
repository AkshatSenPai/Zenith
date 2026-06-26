"""Zenith — in-memory activity log (the audit trail paired with the confirm gate).

Records the tools Zenith actually runs this session so the HUD's Activity Log reflects real
work (event created, mail sent, calendar read…), not mock data. In-memory + capped, resets on
restart — same model as the rate limiter. Newest entries first.
"""

from __future__ import annotations

import datetime as dt
from collections import deque

_MAX = 40
_entries: "deque[dict]" = deque(maxlen=_MAX)

# tool name -> (type, tone, success label). Reads = info, actions = ok. Unmapped tools are skipped
# (e.g. get_current_time is noise). type/tone match the frontend ActivityLog icons + colors.
_MAP: dict[str, tuple[str, str, str]] = {
    "get_calendar_events": ("calendar", "info", "read calendar"),
    "search_calendar": ("calendar", "info", "searched calendar"),
    "create_event": ("calendar", "ok", "create_event"),
    "update_event": ("calendar", "ok", "update_event"),
    "delete_event": ("calendar", "warn", "delete_event"),
    "get_emails": ("email", "info", "read mail"),
    "search_emails": ("email", "info", "searched mail"),
    "read_email": ("email", "info", "read email"),
    "send_email": ("email", "ok", "email sent"),
    "send_message": ("message", "ok", "message sent"),
    "get_weather": ("note", "info", "weather"),
    "get_briefing": ("note", "info", "briefing"),
    "get_news": ("note", "info", "headlines"),
    "list_discord_channels": ("message", "info", "list Discord channels"),
    "get_discord_messages": ("message", "info", "read Discord"),
    "search_discord_messages": ("message", "info", "searched Discord"),
    "send_discord_message": ("message", "ok", "Discord message sent"),
}


def record(tool: str, target: str = "", *, ok: bool = True) -> None:
    """Append an entry for a tool run. ok=False marks a cancelled/failed action (warn)."""
    meta = _MAP.get(tool)
    if meta is None:
        return
    type_, tone, label = meta
    if not ok:
        tone, label = "warn", f"{tool} cancelled"
    _entries.appendleft({
        "time": dt.datetime.now().astimezone().strftime("%H:%M"),
        "action": label,
        "target": target,
        "tone": tone,
        "type": type_,
    })


def entries() -> list[dict]:
    return list(_entries)
