"""Zenith — in-memory conversation history (last 20 messages, tool turns included), PER CHANNEL.

Each front-end gets its own thread so they don't bleed together: the HUD uses channel "hud", the
Telegram remote uses "telegram". Same trim rules; same in-memory model (resets on restart)."""

MAX_HISTORY_MESSAGES = 20

_history: dict[str, list] = {}


def snapshot(channel: str = "hud") -> list:
    """Shallow copy of a channel's committed history to start a working turn from."""
    return list(_history.get(channel, []))


def commit(channel: str, working: list) -> None:
    """Replace a channel's history with the resolved working turn, trimmed to the last 20 messages."""
    _history[channel] = _trim(working)


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
