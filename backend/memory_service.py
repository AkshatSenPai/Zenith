"""Zenith — conversation history (last 20 messages, tool turns included), PER CHANNEL, persisted.

Each front-end gets its own thread so they don't bleed together: the HUD uses channel "hud", the
Telegram remote uses "telegram". Same trim rules. History is mirrored to a JSON file
(`.zenith/history.json`) and reloaded on boot, so a backend **restart no longer wipes the
conversation**. Assistant turns carry Anthropic SDK content blocks (TextBlock / ToolUseBlock); these
are normalised to plain dicts on save — which the Messages API still accepts when the history is
replayed — while tool_result blocks are already dicts.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

MAX_HISTORY_MESSAGES = 20

# Per-channel history lives next to the backend in a gitignored dir; secure_files.harden() restricts it.
_STORE = Path(__file__).resolve().parent / ".zenith" / "history.json"

_history: dict[str, list] = {}


def snapshot(channel: str = "hud") -> list:
    """Shallow copy of a channel's committed history to start a working turn from."""
    return list(_history.get(channel, []))


def commit(channel: str, working: list) -> None:
    """Replace a channel's history with the resolved working turn (trimmed to the last 20), then
    persist to disk so the conversation survives a restart."""
    _history[channel] = _trim(working)
    _save()


# ---------- persistence ----------

def _block_to_dict(block) -> dict:
    """Normalise one content block to a JSON-serialisable dict the Messages API still accepts.
    Assistant turns carry SDK objects (TextBlock / ToolUseBlock); tool_result blocks are already dicts."""
    if isinstance(block, dict):
        return block
    t = getattr(block, "type", None)
    if t == "text":
        return {"type": "text", "text": block.text}
    if t == "tool_use":
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    if hasattr(block, "model_dump"):        # unknown SDK block — best-effort
        return block.model_dump()
    return {"type": t or "unknown"}


def _serialize_message(message: dict) -> dict:
    content = message.get("content")
    if isinstance(content, list):
        content = [_block_to_dict(b) for b in content]
    return {"role": message.get("role"), "content": content}


def _save() -> None:
    """Atomically mirror the whole history to JSON. Best-effort — a disk error never breaks the chat."""
    try:
        _STORE.parent.mkdir(parents=True, exist_ok=True)
        data = {ch: [_serialize_message(m) for m in msgs] for ch, msgs in _history.items()}
        tmp = _STORE.parent / (_STORE.name + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, _STORE)             # atomic on the same filesystem
    except Exception as exc:  # noqa: BLE001 — persistence must never crash the loop
        print(f"[memory] could not persist history: {exc}", flush=True)


def load() -> None:
    """Restore history from disk at boot. A missing file is a no-op; a corrupt one starts fresh (logged)."""
    global _history
    try:
        if _STORE.exists():
            _history = json.loads(_STORE.read_text(encoding="utf-8"))
            print(f"[memory] restored history for channels {list(_history)} from {_STORE.name}", flush=True)
    except Exception as exc:  # noqa: BLE001 — a corrupt store shouldn't block boot
        print(f"[memory] could not load history (starting fresh): {exc}", flush=True)
        _history = {}


# ---------- trim ----------

def _is_user_text(message: dict) -> bool:
    return message.get("role") == "user" and isinstance(message.get("content"), str)


def _trim(messages: list) -> list:
    """Keep the last 20 messages, then drop leading partial-tool turns so the window always begins
    on a real user-text message (a dangling assistant / tool_result at the front would be rejected
    by the API)."""
    trimmed = messages[-MAX_HISTORY_MESSAGES:]
    while trimmed and not _is_user_text(trimmed[0]):
        trimmed = trimmed[1:]
    return trimmed


# Restore any prior session's history as soon as the module is imported (i.e. at backend boot).
load()
