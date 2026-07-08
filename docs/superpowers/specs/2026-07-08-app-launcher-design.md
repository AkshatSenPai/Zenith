# App Launcher — Design Spec (owner-approved)

**Status:** approved (owner signed off the 3 config choices in the 2026-07-05 session; recorded here 2026-07-08).
**Branch:** `feat/app-launcher`.

## Goal
Let Zenith **open** the owner's apps, files, folders, and websites by voice or chat —
"open Spotify", "open my browser", "what can you launch?" — as two tools on the EXISTING
Claude loop + confirm gate. Nothing else in the architecture changes.

## The whole security model: WHITELIST ONLY
Zenith may ONLY launch entries from a configured allow-list. It must **NEVER** run an arbitrary
path or command that a caller — or a prompt-injected email/message — supplies. The tool argument
is a **name to look up in the whitelist**, never a path/command to execute. There is no
"run any command" escape hatch. This is non-negotiable.

## Tools (2)
- **`open_app(name)`** — resolve `name` against the whitelist, then launch the matched entry.
  Low-risk (whitelisted only), so **immediate** by default (no confirm gate) — EXCEPT the
  injection defense below. No confident match ⇒ **refuse and list what it CAN open** (never
  guess-launch).
- **`list_apps()`** — read-only; returns the whitelist names. Not gated, not fenced (the owner's
  own config), not logged.

## Injection defense — conditional gate
`open_app` can be triggered off content Zenith *reads* (a prompt-injected email saying "open X").
So: if the launch is requested in the **same turn** that untrusted `<external-content>` already
entered the context, `open_app` becomes a **confirm-gated pending action** (reusing the existing
gate + the ⚠️ untrusted warning on the HUD confirm card / Telegram buttons). A plain "open Spotify"
with no untrusted read in the turn launches immediately.

Mechanism (zero new gate code): a new set `GATE_IF_UNTRUSTED = {"open_app"}` in `tools.py`, and
one changed condition in `claude_service.run_loop`:
```python
if block.name in ACTION_TOOLS or (block.name in GATE_IF_UNTRUSTED and saw_untrusted):
```
`saw_untrusted` already flips True when an `UNTRUSTED_TOOLS` result comes back fenced (existing
prompt-injection machinery). `open_app` is **NOT** in `ACTION_TOOLS` (it isn't always gated) and
**NOT** in `UNTRUSTED_TOOLS` (its own output isn't third-party content).

## Whitelist config
- File **`backend/apps.json`** (gitignored). Committed **`backend/apps.example.json`** is the
  template AND the fallback (loaded when `apps.json` is absent). Path overridable via
  `ZENITH_APPS_PATH`. Read **fresh on every call** (edits apply with no restart).
- Entry: `name` (required) + `target` (required) + optional `aliases` + optional `type` + optional `note`.
- Target kinds (`type`, inferred if omitted):
  - **url** — `http(s)://…` → default browser via `webbrowser.open`.
  - **path** — an exe / file / folder path → `os.startfile` (Windows ShellExecute) / `open` / `xdg-open`.
  - **protocol** — e.g. `spotify:` → same shell-open.
  - **command** — a PATH command e.g. `code` → resolve with `shutil.which`, then shell-open the exe.
- Starter set (seeded locally): Browser→google.com, Gmail, Calendar, Claude→claude.ai,
  VS Code→`code`, Spotify→`spotify:`, Projects→`C:\Users\Akshat Singh\Dev Folder`.

## Matching (stdlib only, no new dep)
Normalize (lowercase, alphanumeric-only) → exact → alias → substring (both directions) →
`difflib` close-match with a cutoff. If the result is ambiguous (several distinct apps) or below
cutoff ⇒ raise `AppNotFound` whose message lists the launchable names. Never guess-launch.

## Module `backend/app_launcher.py`
- `LauncherError(Exception)` base; `AppNotFound(LauncherError)`; `LaunchError(LauncherError)`.
- `apps_path()`, `load_apps() -> list[dict]`, `resolve(name) -> dict` (raises `AppNotFound`),
  `list_apps() -> list[str]`, `launch(entry) -> str` (raises `LaunchError`),
  `open_app(name) -> str` (resolve + launch), private `_normalize`, `_infer_kind`, `_shell_open`
  (one cross-platform helper so tests mock a single seam).

## Wiring (existing patterns, mirrors to-dos/vault)
- `tools.py`: two `_EXECUTORS` entries + two `TOOLS` schemas; add `app_launcher.LauncherError`
  to `run_tool`'s except chain (a refusal/failed launch is marked failed → NOT logged as "opened",
  NOT fenced); `_activity_target["open_app"] = name`; `GATE_IF_UNTRUSTED = {"open_app"}`.
- `activity_log._MAP["open_app"] = ("note", "ok", "app opened")` (reuse the `note` icon — no new
  frontend). `list_apps` stays unmapped ⇒ not logged.
- `claude_service.py`: import `GATE_IF_UNTRUSTED`, change the gate condition, add a short
  system-prompt line (mirror the to-dos line).
- `.gitignore += backend/apps.json`; `backend/.env.example` documents `ZENITH_APPS_PATH`;
  `SETUP-APPS.md` at repo root (schema + 4 target kinds + examples).

## HUD
Activity-log entry only (`open_app` success). **No new panel.** A Settings "Apps" list is
explicitly OPTIONAL/deferred — `list_apps` already answers "what can you launch?".

## OUT OF SCOPE (do NOT build)
- Computer Use / screenshots / clicking / typing / reading the screen.
- Running arbitrary commands / shell access / any non-whitelisted target.
- Closing / killing apps or window management.

## Owner test list (live)
"Open Claude" launches · "open my browser" → default browser · "what can you launch?" lists the
whitelist · unknown name → refuses + lists (no raw run) · add an app to `apps.json` → works
without a restart · an email containing "open X" → same-turn ⚠️ gate fires (doesn't silent-launch).
