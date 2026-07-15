# Tauri desktop shell setup (Phase 1 — Milestone 2)

Run Zenith as a native Windows desktop app. The Tauri shell wraps the existing Next.js HUD
in Win11's WebView2 and **auto-spawns the local FastAPI backend on launch, killing it (and
freeing its VRAM) on close**. Everything else — the chat loop, confirm gate, voice endpoints —
is unchanged; the WebView calls `http://localhost:8010` exactly as the browser does.

## Prerequisites (one-time, per machine)
- **Rust** (stable, MSVC): install via [rustup](https://rustup.rs) → `rustup default stable-msvc`.
- **Visual Studio C++ Build Tools** (MSVC linker + Windows SDK). Tauri can't link without them.
- **WebView2 runtime** — ships with Windows 11 (already present). On older Windows, install the
  Evergreen runtime from Microsoft.
- **Microphone privacy setting ON:** Windows Settings → Privacy & security → Microphone →
  *"Let desktop apps access your microphone"* = **On**. Without this the voice loop's mic is blocked
  at the OS level (below the WebView), no matter what the app does.

The backend's Python 3.11 venv (`backend/.venv`) and its GPU setup are unchanged — see the main
`README.md`. The shell does **not** bundle Python; it launches the venv you already have.

## How it finds the backend (env vars, both optional)
| var | default | meaning |
|-----|---------|---------|
| `ZENITH_BACKEND_DIR` | `<repo>/backend` | folder containing `main.py` |
| `ZENITH_PYTHON` | `<backend>/.venv/Scripts/python.exe` | the interpreter that runs uvicorn |

Defaults work for a normal checkout. Set them (in your shell/OS env) only if your venv or backend
lives elsewhere.

## Run (dev)
```
cd frontend
npm install          # first time — installs @tauri-apps/cli
npm run tauri dev
```
First run compiles the Rust host (a few minutes). The window opens on a boot screen that holds
while the backend warms (~30–45s on GPU), then reveals the live HUD.

## Build (installer / exe)
```
cd frontend
npm run tauri build
```
Output lands under `frontend/src-tauri/target/release/bundle/` (MSI/NSIS installer + the exe).

## Behavior
- **Launch** auto-spawns the backend — **unless** something already answers on `127.0.0.1:8010`
  (e.g. you started uvicorn by hand). In that case the app uses the existing one and won't kill it.
- **Close** the window → the backend the app spawned is terminated, freeing RAM + VRAM.
- **Second launch** focuses the existing window instead of starting a second app/backend.

## Troubleshooting
- **Blank HUD / stuck "offline" past 90s** → the backend didn't come up. Check `ZENITH_PYTHON`
  points at a real interpreter and that `python -m uvicorn main:app` runs by hand from `backend/`.
- **Mic silent / recording no-ops** → the Windows mic privacy setting (above). The app auto-grants
  the *WebView's* mic permission, but it can't override the OS toggle.
- **"offline" even though the backend is up** → a CORS mismatch. The Tauri WebView origin
  (`http://tauri.localhost` / `tauri://localhost`) and `:1420` are in the backend's default
  allowlist; if you set `ZENITH_ALLOWED_ORIGINS`, that **replaces** the default, so include them.
- **Rust/link errors on a fresh machine** → the MSVC C++ Build Tools are missing (see Prerequisites).

## Acceptance checklist (run once on the owner's machine)
The desktop behaviors below are verified by hand (they need a real window, mic, and GPU):

1. `cd frontend && npm run tauri dev` → a native **"Zenith"** window renders the HUD.
2. Boot screen holds during the backend warmup, then reveals the live HUD once `/health` is green
   (no false "offline" flash).
3. **Hold-Space voice loop works end to end** on Arc: mic → `/transcribe` → `/chat` → `/speak`,
   and the reply audio plays. Spot-check that Ghost + Amethyst still render.
4. **Close-to-tray:** click the window **X** → the window disappears but a **Zenith tray icon** remains;
   the backend `python.exe` is **still alive** (Task Manager → Details) and **VRAM is NOT freed**
   (`nvidia-smi`) — Zenith is running in the tray.
5. **Tray restore:** **left-click** the tray icon → the window returns, HUD intact. **Right-click** → the
   Show / Quit menu. Pressing **Ctrl+Alt+Z** while hidden also restores + starts listening.
6. **Quit:** tray → **Quit Zenith** → the window closes, the backend `python.exe` disappears, and **VRAM
   is freed**. (This is the only real exit.)
7. Launch twice → the second launch focuses/un-hides the first; exactly **one** uvicorn `python.exe`.
8. **Global hotkey:** focus another app, press **Ctrl+Alt+Z** → Zenith comes to front and the orb goes
   to LISTENING; speak; press **Ctrl+Alt+Z** again → it transcribes and replies (spoken). Hold-Space
   still works in-window. If nothing happens, check the backend/console log for a "could not register"
   warning (another app already owns the combo).
9. **Autostart:** Settings → **Startup → Launch on login** ON → Zenith appears under Task Manager ▸
   Startup apps; **reboot** → Zenith is running in the tray with **no window shown**; click the tray →
   the HUD is already live. Toggle OFF → it's removed from startup.
10. **Background alerts — BUILT APP ONLY** (Windows toasts don't fire under `tauri dev` — they show the
    PowerShell name or nothing; test this from the `tauri build` app below): put a calendar event ~30 min
    out (or a commitment line in today's `daily/<today>.md`), **hide Zenith to the tray**, wait ≤2 min →
    a **"Zenith · …" Windows toast** appears once. Open the HUD → the same nudge is a card (no duplicate
    toast while focused). Settings → **Notifications → Background alerts OFF** → no more toasts.
11. `cd frontend && npm run tauri build` → the bundled app runs and repeats 1–10 (**required** for #10).
