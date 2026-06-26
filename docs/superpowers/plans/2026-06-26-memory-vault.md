# Memory Vault (M6 Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Zenith a local Markdown "memory vault" (Obsidian-style) it can search, read, list, and write — as 4 new tools on the EXISTING Claude loop, plus a read-only HUD browser on the existing rail.

**Architecture:** A new `vault_service.py` owns all filesystem work (path-safety, search, read, list, save/append, daily-log). Four tools in `tools.py` wrap it on the existing loop — `save_note` is a SAFE local write that runs **immediately (NOT gated)**; the three readers run inline. The HUD's existing Drafts/Clients rail tabs get a read-only `VaultView` fed by two new non-tool routes that share `vault_service` (same pattern as `/calendar/events` sharing `google_service`). Zero changes to `/chat`, `run_loop`, or the confirm gate.

**Tech Stack:** Python stdlib only (`pathlib`, `os`, `datetime`) — no new backend deps, no ripgrep dependency (pure-Python scan; the vault is small). Next.js/React + the existing `zenith-*` themed classes for the HUD.

## Global Constraints

- **Same architecture, zero route/gate changes.** New tools = `TOOLS` schema + executor + `_EXECUTORS` entry. Nothing else changes. (verbatim: "new tools in TOOLS on the EXISTING loop, zero route/gate changes")
- **`save_note` is NOT gated.** Local, reversible writes run immediately — the confirm gate is for external/destructive actions only. (verbatim: "run it IMMEDIATELY, NOT through the confirm gate")
- **Path from `.env` (`ZENITH_VAULT_PATH`, default `backend/vault`), GITIGNORED.** Must work pointed at an existing Obsidian vault. (owner's real vault: `C:\Users\Akshat Singh\ZenithVault` — note the SPACE.)
- **Use the EXISTING folders, don't invent:** `daily/` (`YYYY-MM-DD.md`, Obsidian Daily Notes format), `clients/`, `notes/`.
- **PATH SAFETY is non-negotiable:** a note can NEVER be written or read outside the vault dir — no `..`, no absolute paths, no drive letters. Every resolved path is verified to live under the vault root.
- **Daily log** appends to `daily/<today YYYY-MM-DD>.md` so manual + Zenith entries share one file.
- **Do NOT build a note editor** (Obsidian is the editor). HUD is read-only browse + read.
- **Vault reads are TRUSTED** (owner's own notes) → NOT fenced as `<external-content>`. The confirm gate still backstops any send/delete an injected note might attempt. *(The one design decision — see "Open decision" at the bottom; flip to fenced if the owner prefers.)*
- **OUT OF SCOPE (do NOT build):** Copy Factory tools, voice-matched drafting, any DB, a HUD note editor, `delete_note` (when added later, THAT one is gated).

---

## File Structure

- **Create `backend/vault_service.py`** — the only module that touches the vault filesystem. Public API: `vault_root()`, `search(query)`, `read(path_or_title)`, `list_notes(folder=None, recent=None)`, `save_note(folder, title, content, mode)`. Plus the private `_safe_path(folder, title)` guard.
- **Modify `backend/tools.py`** — add 4 tool schemas to `TOOLS`, 4 executors, 4 `_EXECUTORS` entries; add the activity-log target hints. NOT added to `ACTION_TOOLS` or `UNTRUSTED_TOOLS`.
- **Modify `backend/main.py`** — add `GET /vault/notes` and `GET /vault/note` (non-tool HUD routes sharing `vault_service`).
- **Create `backend/test_vault.py`** — the full test matrix.
- **Modify `frontend/lib/api.ts`** — `VaultNote` type + `getVaultNotes()` + `getVaultNote()`.
- **Create `frontend/components/VaultView.tsx`** — read-only list + reader (loading/empty/error states).
- **Modify `frontend/app/page.tsx`** — route `view==="clients"` and `view==="drafts"` to `<VaultView>` instead of `<PlaceholderView>`.
- **Modify `backend/.env.example`** (via PowerShell — guarded) — add `ZENITH_VAULT_PATH`.
- **Modify `.gitignore`** — ignore `backend/vault/`.
- **Modify `README.md`** — one line on the vault + the env var.

---

## Task 1: vault_service core — root resolution, path safety, save/read (new)

**Files:**
- Create: `backend/vault_service.py`
- Test: `backend/test_vault.py`

**Interfaces:**
- Produces: `vault_root() -> pathlib.Path`; `save_note(folder: str, title: str, content: str, mode: str = "new") -> str`; `read(path_or_title: str) -> str | None`; `_safe_path(folder: str, title: str) -> pathlib.Path` (raises `ValueError` on escape).

- [ ] **Step 1: Write failing tests** (`backend/test_vault.py`)

```python
"""M6 Part 1 — memory vault: save/read/search/list round-trips, append accumulation, dated
daily logs, and path-safety (a title/folder can NEVER escape the vault). Filesystem only — no Claude."""

import os
import datetime as dt
from pathlib import Path

import pytest

import vault_service


@pytest.fixture(autouse=True)
def _vault(tmp_path, monkeypatch):
    # a path WITH A SPACE, like the real Obsidian vault
    root = tmp_path / "Zenith Vault"
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(root))
    return root


def test_save_new_then_read_roundtrip(_vault):
    vault_service.save_note("clients", "Rahul", "Owes a proposal by Friday.", "new")
    assert (_vault / "clients" / "Rahul.md").exists()
    assert "proposal" in vault_service.read("clients/Rahul.md")
    assert "proposal" in vault_service.read("Rahul")        # resolve by title too


def test_spaced_path_is_handled(_vault):
    vault_service.save_note("notes", "Idea", "x", "new")
    assert (_vault / "notes" / "Idea.md").exists()           # root has a space; still works


def test_quoted_env_path_is_stripped(tmp_path, monkeypatch):
    root = tmp_path / "v"
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", f'"{root}"')     # surrounding quotes
    assert vault_service.vault_root() == root.resolve()


@pytest.mark.parametrize("folder,title", [
    ("../../etc", "passwd"),
    ("clients", "../../escape"),
    ("clients", "../escape"),
    ("C:\\\\Windows", "system"),
    ("notes", "/abs"),
])
def test_path_safety_cannot_escape(_vault, folder, title):
    with pytest.raises(ValueError):
        vault_service._safe_path(folder, title)
    # and nothing was written outside the vault
    assert not (_vault.parent / "escape.md").exists()
    assert not (_vault.parent / "passwd.md").exists()
```

- [ ] **Step 2: Run to verify they fail** — `./.venv/Scripts/python.exe -m pytest test_vault.py -q` → FAIL (no module `vault_service`).

- [ ] **Step 3: Implement `backend/vault_service.py` (core)**

```python
"""Zenith — local Markdown memory vault (Obsidian-style). All filesystem access is here; the
tools + HUD routes are thin wrappers. PATH SAFETY: every resolved path is verified to live under
the vault root, so a folder/title can never escape (no ``..``, absolute paths, or drive letters)."""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path

DEFAULT_VAULT = Path(__file__).resolve().parent / "vault"   # backend/vault (gitignored)
VALID_MODES = {"new", "append"}


def vault_root() -> Path:
    """The vault directory from ZENITH_VAULT_PATH (quotes stripped, ~ expanded), else backend/vault."""
    raw = os.getenv("ZENITH_VAULT_PATH", "").strip().strip('"').strip("'")
    root = Path(raw).expanduser() if raw else DEFAULT_VAULT
    return root.resolve()


def _safe_path(folder: str, title: str) -> Path:
    """Resolve <vault>/<folder>/<title>.md and GUARANTEE it stays under the vault root.
    Rejects absolute paths, drive letters, and any ``..`` traversal (raises ValueError)."""
    root = vault_root()
    rel = f"{(folder or '').strip()}/{(title or '').strip()}".strip("/")
    if not (title or "").strip():
        raise ValueError("A note title is required.")
    # strip a trailing .md so callers may pass either form
    if rel.lower().endswith(".md"):
        rel = rel[:-3]
    candidate = (root / f"{rel}.md")
    resolved = candidate.resolve()
    # the resolved path MUST be inside the vault root
    if root not in resolved.parents and resolved != root:
        raise ValueError(f"Refusing to write outside the vault: {folder}/{title}")
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
        title = dt.date.today().isoformat()                 # YYYY-MM-DD
    path = _safe_path(folder, title)
    path.parent.mkdir(parents=True, exist_ok=True)
    if mode == "append" or daily:
        line = content.strip()
        if daily:
            line = f"- {dt.datetime.now().strftime('%H:%M')} {line}"
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        sep = "" if (not existing or existing.endswith("\n")) else "\n"
        path.write_text(existing + sep + line + "\n", encoding="utf-8")
    else:
        path.write_text(content.rstrip() + "\n", encoding="utf-8")
    rel = path.relative_to(vault_root())
    return f"Saved to {rel.as_posix()}."


def read(path_or_title: str) -> str | None:
    """Full content of one note by relative path (clients/Rahul.md) OR by title (Rahul). None if absent."""
    root = vault_root()
    if not root.exists():
        return None
    q = (path_or_title or "").strip().strip("/")
    if q.lower().endswith(".md"):
        q = q[:-3]
    direct = (root / f"{q}.md").resolve()
    if (root in direct.parents) and direct.exists():
        return direct.read_text(encoding="utf-8")
    # fall back to a filename (title) match anywhere in the vault
    target = f"{Path(q).name.lower()}.md"
    for p in root.rglob("*.md"):
        if p.name.lower() == target:
            return p.read_text(encoding="utf-8")
    return None
```

- [ ] **Step 4: Run tests** — `pytest test_vault.py -q` → the Task-1 tests PASS (search/list/append tests still fail — added in Task 2).

- [ ] **Step 5: Commit** — `git add backend/vault_service.py backend/test_vault.py && git commit -m "feat(vault): core save/read + path safety"`

---

## Task 2: vault_service — search, list, append accumulation, daily logs

**Files:**
- Modify: `backend/vault_service.py`
- Test: `backend/test_vault.py`

**Interfaces:**
- Produces: `search(query: str) -> list[dict]` (each `{path, title, snippet}`); `list_notes(folder: str | None = None, recent: int | None = None) -> list[dict]` (each `{path, title, folder, modified}`).

- [ ] **Step 1: Add failing tests** (append to `backend/test_vault.py`)

```python
def test_append_accumulates(_vault):
    vault_service.save_note("notes", "Log", "first", "append")
    vault_service.save_note("notes", "Log", "second", "append")
    body = vault_service.read("notes/Log")
    assert "first" in body and "second" in body


def test_daily_log_writes_to_dated_file(_vault):
    vault_service.save_note("daily", "", "promised Rahul the proposal by Friday", "append")
    today = dt.date.today().isoformat()
    f = _vault / "daily" / f"{today}.md"
    assert f.exists() and "Rahul" in f.read_text(encoding="utf-8")


def test_search_matches_filename_and_content(_vault):
    vault_service.save_note("clients", "Rahul", "Wants the funnel revised.", "new")
    vault_service.save_note("notes", "Pricing", "Rahul asked about pricing.", "new")
    hits = {h["path"] for h in vault_service.search("rahul")}
    assert "clients/Rahul.md" in hits and "notes/Pricing.md" in hits


def test_list_notes_by_folder_and_recent(_vault):
    vault_service.save_note("clients", "A", "x", "new")
    vault_service.save_note("notes", "B", "y", "new")
    assert [n["title"] for n in vault_service.list_notes("clients")] == ["A"]
    assert len(vault_service.list_notes(recent=10)) == 2


def test_empty_vault_and_missing_note(tmp_path, monkeypatch):
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(tmp_path / "empty"))
    assert vault_service.search("anything") == []
    assert vault_service.list_notes() == []
    assert vault_service.read("nope") is None
```

- [ ] **Step 2: Run** → the 5 new tests FAIL (`search`/`list_notes` not defined).

- [ ] **Step 3: Implement** (append to `backend/vault_service.py`)

```python
def _title_of(path: Path) -> str:
    return path.stem


def list_notes(folder: str | None = None, recent: int | None = None) -> list[dict]:
    """Index of notes. folder= limits to one subfolder; recent=N returns the N newest by mtime."""
    root = vault_root()
    if not root.exists():
        return []
    base = root / folder.strip().strip("/") if folder else root
    if not base.exists():
        return []
    out: list[dict] = []
    for p in base.rglob("*.md"):
        rel = p.relative_to(root)
        out.append({
            "path": rel.as_posix(),
            "title": _title_of(p),
            "folder": rel.parent.as_posix() if rel.parent.as_posix() != "." else "",
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
            snippet = text[max(0, idx - 60): idx + 80].replace("\n", " ").strip() if idx >= 0 else _title_of(p)
            hits.append({"path": rel, "title": _title_of(p), "snippet": snippet})
        if len(hits) >= limit:
            break
    return hits
```

- [ ] **Step 4: Run** — `pytest test_vault.py -q` → all vault tests PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(vault): search + list + daily-log accumulation"`

---

## Task 3: the 4 tools on the existing loop

**Files:**
- Modify: `backend/tools.py` (TOOLS list, executors, `_EXECUTORS`, `_activity_target`)
- Test: `backend/test_tool_router.py` (extend) or `backend/test_vault.py`

**Interfaces:**
- Consumes: `vault_service.{search,read,list_notes,save_note}`.
- Produces: tool names `search_notes`, `read_note`, `list_notes`, `save_note` in `_EXECUTORS`; none in `ACTION_TOOLS` or `UNTRUSTED_TOOLS`.

- [ ] **Step 1: Add failing tests** (append to `backend/test_vault.py`)

```python
import tools


def test_tools_registered_and_not_gated():
    for t in ("search_notes", "read_note", "list_notes", "save_note"):
        assert t in tools._EXECUTORS
        assert t not in tools.ACTION_TOOLS          # save_note is a SAFE local write — not gated
        assert t not in tools.UNTRUSTED_TOOLS       # owner's own notes are trusted


def test_save_note_tool_runs_inline(_vault):
    out = tools.run_tool("save_note", {"folder": "notes", "title": "T", "content": "hello"})
    assert "Saved to notes/T.md" in out
    assert tools.run_tool("read_note", {"path_or_title": "T"}).strip() == "hello"
```

- [ ] **Step 2: Run** → FAIL (tools not registered).

- [ ] **Step 3: Add executors** (in `backend/tools.py`, near the other executors; add `import vault_service` at top)

```python
def _search_notes(i: dict) -> str:
    hits = vault_service.search(i.get("query", ""))
    if not hits:
        return "No matching notes."
    return "\n".join(f"- {h['path']}: {h['snippet']}" for h in hits)


def _read_note(i: dict) -> str:
    body = vault_service.read(i.get("path_or_title", ""))
    return body if body is not None else "Note not found."


def _list_notes(i: dict) -> str:
    notes = vault_service.list_notes(i.get("folder"), recent=i.get("recent"))
    if not notes:
        return "No notes yet."
    return "\n".join(f"- {n['path']}" for n in notes)


def _save_note(i: dict) -> str:
    return vault_service.save_note(
        i.get("folder", "notes"), i.get("title", ""), i.get("content", ""), i.get("mode", "new"),
    )
```

- [ ] **Step 4: Register schemas + dispatch + activity hint**

Add to `TOOLS`:

```python
    {
        "name": "search_notes",
        "description": "Search the local Markdown vault (the owner's notes/briefs/daily logs) by text. Use for 'what did I note about X', 'what did I do last week'.",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    },
    {
        "name": "read_note",
        "description": "Read one vault note in full, by relative path (clients/Rahul.md) or title (Rahul).",
        "input_schema": {"type": "object", "properties": {"path_or_title": {"type": "string"}}, "required": ["path_or_title"]},
    },
    {
        "name": "list_notes",
        "description": "List vault notes to browse. Optional folder (daily/clients/notes) or recent=N newest.",
        "input_schema": {"type": "object", "properties": {"folder": {"type": "string"}, "recent": {"type": "integer"}}, "required": []},
    },
    {
        "name": "save_note",
        "description": "Save to the vault. folder=daily/clients/notes, title, content, mode=new|append. For a DAILY LOG use folder='daily' with an empty title (auto-dates to today, appends a timestamped line). Runs immediately — no confirmation needed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "folder": {"type": "string", "description": "daily, clients, or notes"},
                "title": {"type": "string", "description": "Note title / filename (leave empty for a daily log)"},
                "content": {"type": "string"},
                "mode": {"type": "string", "description": "new (default) or append"},
            },
            "required": ["folder", "content"],
        },
    },
```

Add to `_EXECUTORS`: `"search_notes": _search_notes, "read_note": _read_note, "list_notes": _list_notes, "save_note": _save_note`.

Add to `_activity_target`: `if name == "save_note": return i.get("title") or i.get("folder", "")` and `if name in ("search_notes",): return i.get("query", "")`.

- [ ] **Step 5: Run + commit** — `pytest test_vault.py -q` PASS → `git commit -am "feat(vault): search_notes/read_note/list_notes/save_note tools (not gated)"`

---

## Task 4: HUD read-only routes

**Files:**
- Modify: `backend/main.py`
- Test: `backend/test_vault.py` (via `fastapi.testclient`)

**Interfaces:**
- Produces: `GET /vault/notes?folder=&recent=` → `{notes: [...]}`; `GET /vault/note?path=` → `{found, path, title, content}`.

- [ ] **Step 1: Failing test**

```python
from fastapi.testclient import TestClient


def test_vault_routes(_vault, monkeypatch):
    monkeypatch.delenv("ZENITH_API_TOKEN", raising=False)
    import main
    vault_service.save_note("clients", "Acme", "Brief here.", "new")
    c = TestClient(main.app)
    notes = c.get("/vault/notes", params={"folder": "clients"}).json()["notes"]
    assert any(n["title"] == "Acme" for n in notes)
    got = c.get("/vault/note", params={"path": "clients/Acme.md"}).json()
    assert got["found"] and "Brief" in got["content"]
    assert c.get("/vault/note", params={"path": "nope.md"}).json()["found"] is False
```

- [ ] **Step 2: Run** → FAIL (404 / no route).

- [ ] **Step 3: Add routes** (in `backend/main.py`, near `/calendar/events`; add `import vault_service`)

```python
@app.get("/vault/notes")
def vault_notes(folder: str | None = None, recent: int | None = None) -> dict:
    """Read-only note index for the HUD Drafts/Clients tabs (shares vault_service; not a Claude tool)."""
    return {"notes": vault_service.list_notes(folder, recent=recent)}


@app.get("/vault/note")
def vault_note(path: str) -> dict:
    """Full content of one note for the HUD reader. found:false when absent."""
    body = vault_service.read(path)
    if body is None:
        return {"found": False, "path": path, "title": "", "content": ""}
    from pathlib import Path as _P
    return {"found": True, "path": path, "title": _P(path).stem, "content": body}
```

- [ ] **Step 4: Run + commit** — `pytest test_vault.py -q` PASS → `git commit -am "feat(vault): /vault/notes + /vault/note HUD routes"`

---

## Task 5: HUD VaultView (read-only) on the Drafts/Clients tabs

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/components/VaultView.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `GET /vault/notes`, `GET /vault/note`.
- Produces: `<VaultView mode="clients" | "recent" />`.

- [ ] **Step 1: api.ts — types + helpers**

```typescript
export type VaultNote = { path: string; title: string; folder: string; modified: number };

export async function getVaultNotes(folder?: string, recent?: number): Promise<VaultNote[] | null> {
  try {
    const qs = new URLSearchParams();
    if (folder) qs.set("folder", folder);
    if (recent) qs.set("recent", String(recent));
    const res = await apiFetch(`/vault/notes?${qs}`);
    if (!res.ok) return null;
    return ((await res.json()).notes ?? []) as VaultNote[];
  } catch { return null; }
}

export async function getVaultNote(path: string): Promise<{ found: boolean; title: string; content: string } | null> {
  try {
    const res = await apiFetch(`/vault/note?path=${encodeURIComponent(path)}`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
```

- [ ] **Step 2: Create `VaultView.tsx`** — a two-pane read-only browser: left = note list (from `getVaultNotes`), right = selected note content (from `getVaultNote`), rendered with the existing markdown renderer used for chat replies. States: skeleton while loading, "No notes yet" empty, "Can't reach the backend" + Retry on null. `mode="clients"` → `getVaultNotes("clients")`; `mode="recent"` → `getVaultNotes(undefined, 30)`. All `zenith-*` themed, no hardcoded colors. (Mirror the `UsagePanel`/`SettingsView` state pattern.)

- [ ] **Step 3: Wire into `page.tsx`** — replace the `PlaceholderView` fallback for these two views:

```tsx
) : view === "clients" ? (
  <VaultView mode="clients" title="Clients" />
) : view === "drafts" ? (
  <VaultView mode="recent" title="Notes" />
) : (
  <PlaceholderView view={view} />
)
```

(Import `VaultView`; keep `PlaceholderView` for any other view.)

- [ ] **Step 4: Verify** — `cd frontend && npx tsc --noEmit` → exit 0. Visual check in all 3 skins (browser): Clients lists `clients/` notes, Drafts lists recent, click loads content, backend-down shows Retry.

- [ ] **Step 5: Commit** — `git commit -am "feat(vault): read-only HUD browser on Drafts/Clients tabs"`

---

## Task 6: env, gitignore, README

**Files:**
- Modify: `backend/.env.example` (PowerShell — Read/Write guarded for `.env*`)
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: `.gitignore`** — add on their OWN lines (no inline comments — that bug was fixed in M5):

```
# local Markdown memory vault (personal notes + client data — never commit)
backend/vault/
```

- [ ] **Step 2: `.env.example`** — add under a new "Memory vault" group: `ZENITH_VAULT_PATH=` with a comment (default backend/vault; point at an Obsidian vault, e.g. `C:\Users\Akshat Singh\ZenithVault`). Re-add the full file via PowerShell `[System.IO.File]::WriteAllText(... UTF8 no-BOM)`.

- [ ] **Step 3: `README.md`** — one row in the config table (`ZENITH_VAULT_PATH` | local Markdown vault dir | `backend/vault`) + a sentence in "What Zenith does" ("keeps a local Markdown memory vault she can search + write — point it at your Obsidian vault").

- [ ] **Step 4: Commit** — `git commit -am "docs(vault): ZENITH_VAULT_PATH in .env.example, .gitignore, README"`

---

## Task 7: Live verification (point at the real Obsidian vault)

- [ ] **Step 1** — set `ZENITH_VAULT_PATH=C:\Users\Akshat Singh\ZenithVault` in `backend/.env`; restart uvicorn; confirm `/health` ok.
- [ ] **Step 2** — `/chat` "Note that I promised Rahul the proposal by Friday" → reply confirms saved; check `daily/<today>.md` got a timestamped line (and it opens in Obsidian).
- [ ] **Step 3** — `/chat` "What did I note about Rahul?" → `search_notes`/`read_note` find + read it.
- [ ] **Step 4** — HUD Clients tab shows a `clients/` note; Drafts shows recent.
- [ ] **Step 5** — adversarial: `/chat` "save a note titled ../escape with content x" → file stays inside the vault (no file created in the parent dir). Run `pytest --ignore=test_stt.py --ignore=test_transcribe_route.py` → all green.

---

## Self-review

- **Spec coverage:** vault dir from env + gitignored + Obsidian-compatible (T1/T6) ✓ · existing folders daily/clients/notes (T1/T2) ✓ · 4 tools, save_note not gated (T3) ✓ · daily-log dated append (T2) ✓ · path safety (T1) ✓ · spaced Windows path (T1) ✓ · search/read/list (T2) ✓ · HUD Drafts/Clients read-only + states + no editor (T5) ✓ · activity log (free via `run_tool`) ✓ · tests incl. empty/missing (T2) ✓ · live scenarios (T7) ✓. Out-of-scope items excluded.
- **Type consistency:** `save_note(folder,title,content,mode)`, `read(path_or_title)`, `list_notes(folder,recent)`, `search(query)` used identically in tools + routes + tests.
- **No placeholders:** every step has concrete code/commands.

## Open decision (confirm before Task 3)

**Vault reads = trusted or fenced?** Recommended **trusted** (not in `UNTRUSTED_TOOLS`): it's the owner's own vault and Part 2 (Copy Factory) needs Claude to actively use note content; the confirm gate still blocks any send/delete a malicious pasted note might try. Flip to fenced (add the 3 readers to `UNTRUSTED_TOOLS`) only if the owner pastes a lot of unverified third-party text into notes and wants belt-and-suspenders.
