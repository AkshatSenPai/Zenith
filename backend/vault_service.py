"""Zenith — local Markdown memory vault (Obsidian-style). All filesystem access lives here; the
tools + HUD routes are thin wrappers.

PATH SAFETY: a folder/title can NEVER escape the vault root — any ``..`` component, absolute path,
or drive letter is rejected, and the final resolved path is verified to live under the root.
"""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path

DEFAULT_VAULT = Path(__file__).resolve().parent / "vault"   # backend/vault (gitignored)
VALID_MODES = {"new", "append"}


def vault_root() -> Path:
    """The vault directory from ZENITH_VAULT_PATH (surrounding quotes stripped, ~ expanded),
    else backend/vault. Always returned resolved/absolute."""
    raw = os.getenv("ZENITH_VAULT_PATH", "").strip().strip('"').strip("'")
    root = Path(raw).expanduser() if raw else DEFAULT_VAULT
    return root.resolve()


def _safe_path(folder: str, title: str) -> Path:
    """Resolve <vault>/<folder>/<title>.md and GUARANTEE it stays under the vault root.
    Rejects ``..``/``.`` components, absolute paths (leading slash), and drive letters (raises ValueError)."""
    title = (title or "").strip()
    folder = (folder or "").strip()
    if not title:
        raise ValueError("A note title is required.")
    rel = f"{folder}/{title}".strip("/")
    if rel.lower().endswith(".md"):
        rel = rel[:-3]
    parts = rel.replace("\\", "/").split("/")
    if any(p in ("", "..", ".") for p in parts):     # empty = leading slash (absolute); .. = traversal
        raise ValueError(f"Unsafe note path: {folder}/{title}")
    if any(":" in p for p in parts):                  # drive letters / NTFS alt-streams
        raise ValueError(f"Unsafe note path: {folder}/{title}")
    root = vault_root()
    candidate = root.joinpath(*parts)
    candidate = candidate.with_name(candidate.name + ".md")
    resolved = candidate.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Refusing to escape the vault: {folder}/{title}")
    return resolved


def save_note(folder: str, title: str, content: str, mode: str = "new") -> str:
    """Create or append a note. Daily logs: folder='daily' with an empty/'today' title → today's
    YYYY-MM-DD.md, appended with a timestamped bullet so manual + Zenith entries share the file."""
    mode = (mode or "new").strip().lower()
    if mode not in VALID_MODES:
        mode = "new"
    folder = (folder or "notes").strip().strip("/")
    title = (title or "").strip()
    daily = folder == "daily"
    if daily and (not title or title.lower() in {"today", "now"}):
        title = dt.date.today().isoformat()           # YYYY-MM-DD, matching Obsidian Daily Notes
    path = _safe_path(folder, title)
    path.parent.mkdir(parents=True, exist_ok=True)
    if mode == "append" or daily:
        line = (content or "").strip()
        if daily:
            line = f"- {dt.datetime.now().strftime('%H:%M')} {line}"
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        sep = "" if (not existing or existing.endswith("\n")) else "\n"
        path.write_text(existing + sep + line + "\n", encoding="utf-8")
    else:
        path.write_text((content or "").rstrip() + "\n", encoding="utf-8")
    return f"Saved to {path.relative_to(vault_root()).as_posix()}."


def read(path_or_title: str) -> str | None:
    """Full content of one note by relative path (clients/Rahul.md) OR by title (Rahul). None if absent."""
    root = vault_root()
    if not root.exists():
        return None
    q = (path_or_title or "").strip().strip("/")
    if q.lower().endswith(".md"):
        q = q[:-3]
    parts = q.replace("\\", "/").split("/")
    if q and not any(p in ("", "..", ".") or ":" in p for p in parts):
        direct = root.joinpath(*parts)
        direct = direct.with_name(direct.name + ".md").resolve()
        if (direct == root or root in direct.parents) and direct.exists():
            return direct.read_text(encoding="utf-8")
    # fall back to a filename (title) match anywhere in the vault
    target = f"{Path(q).name.lower()}.md"
    for p in root.rglob("*.md"):
        if p.name.lower() == target:
            return p.read_text(encoding="utf-8")
    return None


def _title_of(path: Path) -> str:
    return path.stem


def list_notes(folder: str | None = None, recent: int | None = None) -> list[dict]:
    """Index of notes. folder= limits to one subfolder; recent=N returns the N newest by mtime.
    Each entry: {path, title, folder, modified}."""
    root = vault_root()
    if not root.exists():
        return []
    base = root / folder.strip().strip("/") if folder else root
    if not base.exists():
        return []
    out: list[dict] = []
    for p in base.rglob("*.md"):
        rel = p.relative_to(root)
        parent = rel.parent.as_posix()
        out.append({
            "path": rel.as_posix(),
            "title": _title_of(p),
            "folder": "" if parent == "." else parent,
            "modified": p.stat().st_mtime,
        })
    out.sort(key=lambda n: n["modified"], reverse=True)
    return out[:recent] if recent else out


def search(query: str, limit: int = 20) -> list[dict]:
    """Case-insensitive scan of filenames + content. Returns {path, title, snippet} per match."""
    q = (query or "").strip().lower()
    if not q:
        return []
    root = vault_root()
    if not root.exists():
        return []
    hits: list[dict] = []
    for p in root.rglob("*.md"):
        rel = p.relative_to(root).as_posix()
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        low = text.lower()
        if q in p.name.lower() or q in low:
            idx = low.find(q)
            snippet = (
                text[max(0, idx - 60): idx + 80].replace("\n", " ").strip()
                if idx >= 0 else _title_of(p)
            )
            hits.append({"path": rel, "title": _title_of(p), "snippet": snippet})
        if len(hits) >= limit:
            break
    return hits
