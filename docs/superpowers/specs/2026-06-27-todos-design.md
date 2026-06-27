# Vault-backed To-dos + M6 Quick-Action fix — Design

**Date:** 2026-06-27
**Status:** approved (pending spec review)

## Goal

Two HUD changes:
1. **Part A — QuickActions fix.** "Draft proposal" and "Log note" are tagged `M6` and still render `M6`/`soon` even though M6 shipped. Wire them up so they read **`ready`** and prefill the Command Center.
2. **Part B — "Today's Focus" becomes a real, editable to-do list** backed by the Obsidian vault, that **Zenith can also manage by voice/chat** ("add X to my to-do", "what's on my list", "mark X done").

Non-goals (YAGNI): removing to-dos by voice, reordering, due dates, multiple lists, a dedicated Todos rail tab.

---

## Part A — QuickActions (trivial)

`frontend/components/QuickActions.tsx` already prefills the Command Center for actions present in its `PREFILL` map (`email`, `event`) and shows `ready` for them. Add the two M6 actions:

```ts
const PREFILL = {
  email: "Draft an email to ",
  event: "Add to my calendar: ",
  proposal: "Draft a proposal for ",
  note: "Note that ",
};
```

Result: all four quick actions show `ready` and prefill. `"Note that …"` naturally drives the vault daily-log via the existing `save_note`. The `milestone` field stays as the fallback label for any future not-yet-live action.

---

## Part B — Vault-backed to-dos

### Storage format

A single Markdown file at the **vault root: `Todos.md`**, using standard Obsidian checklist syntax so it reads/edits naturally in Obsidian:

```markdown
- [ ] Send Shadnagar Heights the revised proposal
- [ ] Review Nivaan ad set
- [x] Call Venkata
```

- A **to-do** is any line matching `^\s*-\s\[( |x|X)\]\s?(.*)$`; `x`/`X` = done.
- Non-checklist lines (headings, blank lines, notes the owner adds in Obsidian) are **preserved** on every write.
- A to-do is identified by its **0-based index among checklist lines, in file order**.

### Backend — `backend/todo_service.py` (new; the only new backend module)

Filesystem lives here; the HTTP routes and the Claude tools are thin wrappers (same shape as `vault_service` → `/vault/*` + the vault tools). The file path is the fixed constant `vault_root()/"Todos.md"` (not user input → no traversal surface; still uses `vault_service.vault_root()` so it follows `ZENITH_VAULT_PATH`).

```
list_todos() -> list[dict]            # [{"index": int, "text": str, "done": bool}, ...]; [] if absent
add_todo(text) -> list[dict]          # append "- [ ] text"; create file if needed; returns the full list
set_done(index, done) -> list[dict]   # flip the Nth checklist line's checkbox; IndexError if out of range
remove(index) -> list[dict]           # drop the Nth checklist line; IndexError if out of range
complete_by_text(query) -> dict|None  # first OPEN todo whose text contains query (case-insensitive) -> mark done
```

- Every mutation **re-reads → edits → writes** (fresh read minimizes races), preserving non-checklist lines and a trailing newline.
- `add_todo` rejects empty/whitespace text (raises `ValueError`).

### Backend — HTTP routes (`main.py`, behind the existing `X-Zenith-Token` gate)

RESTful, sharing `todo_service` (mirrors the `/vault/*` routes; mutations echo the updated list):

```
GET    /todos              -> {"todos": [...]}
POST   /todos              {text}        -> {"todos": [...]}      400 on empty text
PATCH  /todos/{index}      {done}        -> {"todos": [...]}      404 on bad index
DELETE /todos/{index}                    -> {"todos": [...]}      404 on bad index
```

Pydantic request models: `TodoAdd{text:str}`, `TodoSet{done:bool}`.

### Backend — Claude tools (`tools.py`, on the EXISTING loop)

So Zenith can manage to-dos in chat/voice. All three share `todo_service`. **NOT in `ACTION_TOOLS`** (local writes, same class as `save_note` — run inline, no confirm) and **NOT in `UNTRUSTED_TOOLS`** (the owner's own to-dos are trusted):

- `add_todo(text)` → `todo_service.add_todo` → `"Added to your to-do list: <text>."`
- `list_todos()` → formats `todo_service.list_todos()` → `"Your to-dos:\n- [ ] …\n- [x] …"` / `"Your to-do list is empty."`
- `complete_todo(task)` → `todo_service.complete_by_text(task)` → `"Marked done: <text>."` / `"Couldn't find an open to-do matching '<task>'."`

`_activity_target`: `add_todo`→text, `complete_todo`→task, `list_todos`→"". One `ZENITH_PROMPT` Tools line tells Zenith to use these for "add X to my to-do / what's on my list / mark X done".

### Frontend

- **`lib/api.ts`** — add `Todo = {index, text, done}` + fail-soft clients: `getTodos()`, `addTodo(text)`, `setTodoDone(index, done)`, `removeTodo(index)` (mutations return the updated `Todo[]` or `null` on failure), all via the existing `apiFetch`.
- **`components/FocusCard.tsx`** — rewrite the "Today's Focus" card into an editable list:
  - fetch `/todos` on mount; render each as a checkbox row (click toggles done; done = struck-through/dimmed) with a remove (×) on hover; an "add a task…" input (Enter or +) appends.
  - footer shows **"N pending"** (open count).
  - loading / empty ("No to-dos yet") / "can't reach backend" + Retry states, matching `VaultView`/`UsagePanel`.
  - **re-fetch on `window` focus** so a to-do Zenith added by voice shows up when you return to the HUD.
  - keep the "Today's Focus" heading + `CardBrackets` styling; fully themed via `zenith-*` tokens (works across Arc/Ghost/Amethyst).
- **`lib/mock.ts`** — remove the now-dead `focus` export (only `FocusCard` imported it).

---

## Testing (TDD)

- **`backend/test_todos.py`** (new):
  - service: add→list round-trip; `set_done` toggles; `remove` drops; `complete_by_text` matches the first open item, is case-insensitive, returns `None` on a miss; **non-checklist lines preserved**; empty/missing file → `[]`; `add_todo("")` raises; bad index raises.
  - tools: `add_todo`/`list_todos`/`complete_todo` registered, **not** in `ACTION_TOOLS`/`UNTRUSTED_TOOLS`; `run_tool` returns the expected strings.
  - HTTP routes via `TestClient` (with the `monkeypatch.delenv("ZENITH_API_TOKEN")`-after-`import main` gotcha from `test_vault_routes`): GET/POST/PATCH/DELETE round-trip.
- **Frontend:** `tsc` clean (no JS test runner in the repo).
- **Live verification** against the real vault: a `/todos` REST round-trip (add → list → complete → remove, confirm `Todos.md`) **and** a chat round-trip (`process_chat("add 'call Rahul' to my to-do")` → `Todos.md` gains the line; `"what's on my to-do list"` reads it back), then confirm the card renders + edits.

## Known limitation

Editing the same list simultaneously in Obsidian and the HUD can race on the line index. Acceptable for a single-user tool; each mutation re-reads first to keep the window small.

## Workflow

Build on `feat/hud-todos` (TDD, atomic commits), then merge to `main` + push, like M6.
