"""Zenith — Copy Factory (M6 Part 2). OUTPUT-ONLY draft builders. Each tool resolves a brief from the
vault (or inline text), pulls the owner's writing voice from the vault, and returns a structured
DIRECTIVE (brief + voice + exact output format). Claude writes the finished copy in the loop — these
functions never call Claude and never send anything."""

from __future__ import annotations

import vault_service


def resolve_brief(client_or_brief: str) -> tuple[str, str | None]:
    """If the arg matches a clients/<name>.md note, return (its content, name); else (inline text, None)."""
    s = (client_or_brief or "").strip()
    if not s:
        return "", None
    # try the clients/ folder first (exact note), then a title match anywhere
    note = vault_service.read(f"clients/{s}") or vault_service.read(s)
    if note is not None and len(s) < 80 and "\n" not in s:   # a name, not a pasted brief
        return note, s
    return s, None


def voice_context() -> str:
    """The owner's writing style: notes/voice.md plus up to 2 recent client notes as samples. Pragmatic
    — returns '' when there's nothing to learn from (Claude then writes clean professional copy)."""
    parts: list[str] = []
    voice = vault_service.read("notes/voice")
    if voice:
        parts.append(voice.strip())
    for n in vault_service.list_notes("clients", recent=2):
        body = vault_service.read(n["path"])
        if body:
            parts.append(f"[sample: {n['title']}]\n{body.strip()[:600]}")
    return "\n\n".join(parts).strip()
