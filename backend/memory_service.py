"""Zenith — in-memory conversation history (last 20 messages, tool turns included)."""

MAX_HISTORY_MESSAGES = 20

_history: list = []


def snapshot() -> list:
    """Shallow copy of committed history to start a working turn from."""
    return list(_history)


def commit(working: list) -> None:
    """Replace history with the resolved working turn, trimmed to the last 20 messages."""
    global _history
    _history = _trim(working)


def _is_user_text(message: dict) -> bool:
    return message.get("role") == "user" and isinstance(message.get("content"), str)


def _trim(messages: list) -> list:
    """Keep the last 20 messages, then drop leading partial-tool turns so the window
    always begins on a real user-text message (a dangling assistant / tool_result at
    the front would be rejected by the API)."""
    trimmed = messages[-MAX_HISTORY_MESSAGES:]
    while trimmed and not _is_user_text(trimmed[0]):
        trimmed = trimmed[1:]
    return trimmed
