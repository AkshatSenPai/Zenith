# App Launcher setup

Zenith can open apps, files, folders, and websites you pre-approve — "open Spotify",
"open my browser", "what can you launch?". **Whitelist only:** it never runs an arbitrary
path or command, only entries in your list.

## The whitelist
- Edit **`backend/apps.json`** (gitignored — your personal list). `backend/apps.example.json`
  is the committed template and the fallback if `apps.json` is missing.
- Read fresh on every call — edits take effect with no restart.
- Point elsewhere with `ZENITH_APPS_PATH=/path/to/apps.json` in `backend/.env`.

## Entry schema
```json
{ "name": "VS Code", "aliases": ["code", "editor"], "target": "code", "type": "command", "note": "optional" }
```
- `name` (required) — what you say.
- `aliases` (optional) — other things you might say.
- `target` (required) — what to open.
- `type` (optional) — one of the four below; inferred from `target` if omitted.
- `note` (optional) — a reminder to yourself.

## Target kinds
| type | target example | how it opens |
|------|----------------|--------------|
| `url` | `https://claude.ai` | default browser |
| `path` | `C:\Users\You\Dev` or a `.lnk` | file/folder/exe/shortcut via the OS (Explorer/Finder) |
| `protocol` | `spotify:` | the app registered for that protocol |
| `command` | `code` | a CLI on your PATH (resolved with `which`) |
| `uwp` | `5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App` | a Windows Store app, by its AppUserModelID |

### Tips for installed desktop apps (Windows)
- **Easiest for any installed app:** point `target` at its **Start Menu shortcut** with `type: "path"`
  — e.g. `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk`. Shortcuts are
  version-independent and carry the app's own launch arguments.
- **Store / UWP apps** (WhatsApp, Apple Music, …) have no `.lnk` or exe path. Use `type: "uwp"` with
  the app's **AppUserModelID**. Find it in PowerShell: `Get-StartApps | Where Name -match 'whatsapp'`.

## Matching
Say the name, an alias, part of it, or a near-spelling — Zenith normalizes and fuzzy-matches.
If it isn't sure which app you mean, it refuses and lists what it CAN open (it never guesses).

## Security model
The tool argument is always a **name to look up in your whitelist**, never a path or command to
execute. A prompt-injected "open X" that arrives inside an email/message you read is caught by the
confirm gate: if `open_app` is triggered in the same turn as untrusted content, it becomes a
pending action with a ⚠️ warning instead of launching silently.
