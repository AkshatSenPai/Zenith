"""Zenith — local to-do list, stored as an Obsidian-style Markdown checklist in the vault.

One file at the vault root, Todos.md. A to-do is a line `- [ ] text` (open) or `- [x] text` (done);
any other line (headings, blanks, notes the owner adds in Obsidian) is preserved on every write.
To-dos are addressed by 0-based index among the checklist lines, in file order. Shares vault_root()
with vault_service so it follows ZENITH_VAULT_PATH."""

from __future__ import annotations

import re

import vault_service

TODO_FILE = "Todos.md"
_LINE = re.compile(r"^(\s*)-\s\[([ xX])\]\s?(.*)$")   # groups: indent, box char, text


def _path():
    return vault_service.vault_root() / TODO_FILE


def _read_lines() -> list[str]:
    p = _path()
    return p.read_text(encoding="utf-8").splitlines() if p.exists() else []


def _write_lines(lines: list[str]) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(lines)
    if text and not text.endswith("\n"):
        text += "\n"
    p.write_text(text, encoding="utf-8")


def _checklist_indices(lines: list[str]) -> list[int]:
    """File-line indices (in order) of the lines that are checklist items."""
    return [i for i, ln in enumerate(lines) if _LINE.match(ln)]


def list_todos() -> list[dict]:
    lines = _read_lines()
    out: list[dict] = []
    for idx, i in enumerate(_checklist_indices(lines)):
        m = _LINE.match(lines[i])
        out.append({"index": idx, "text": m.group(3).strip(), "done": m.group(2).lower() == "x"})
    return out


def add_todo(text: str) -> list[dict]:
    text = (text or "").strip()
    if not text:
        raise ValueError("A to-do needs some text.")
    lines = _read_lines()
    lines.append(f"- [ ] {text}")
    _write_lines(lines)
    return list_todos()


def _nth_checklist_line(lines: list[str], index: int) -> int:
    cl = _checklist_indices(lines)
    if index < 0 or index >= len(cl):
        raise IndexError(f"No to-do at index {index}.")
    return cl[index]


def set_done(index: int, done: bool) -> list[dict]:
    lines = _read_lines()
    i = _nth_checklist_line(lines, index)
    m = _LINE.match(lines[i])
    lines[i] = f"{m.group(1)}- [{'x' if done else ' '}] {m.group(3).strip()}"
    _write_lines(lines)
    return list_todos()


def remove(index: int) -> list[dict]:
    lines = _read_lines()
    i = _nth_checklist_line(lines, index)
    del lines[i]
    _write_lines(lines)
    return list_todos()


def complete_by_text(query: str) -> dict | None:
    q = (query or "").strip().lower()
    if not q:
        return None
    for t in list_todos():
        if not t["done"] and q in t["text"].lower():
            set_done(t["index"], True)
            return {**t, "done": True}
    return None
