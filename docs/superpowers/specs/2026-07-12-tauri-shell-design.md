# Zenith — Tauri Desktop Shell (Phase 1, minimal shell) — Design

**Date:** 2026-07-12
**Status:** Approved (design); implementation plan to follow.
**Milestone:** Closes the last unchecked piece of **Milestone 2** (the Tauri desktop shell).

---

## 1. Goal & non-goals

**Goal.** Run the *existing* Zenith HUD as a native Windows desktop app via Tauri v2. Launching
the app spawns the local Python backend; closing it frees all RAM and VRAM. The push-to-talk voice
loop (hold-Space) must work inside the desktop WebView. This is the smallest testable slice that
makes Zenith a real desktop daily-driver.

**Explicit non-goals (deferred follow-ups):**
- Wake word ("Zenith") — a later add; this shell is its prerequisite, not its delivery.
- System tray / minimize-to-tray.
- Global push-to-talk hotkey (works when window unfocused).
- Autostart on login; remembered window size/position.
- Bundling Python as a sidecar (PyInstaller) — Phase-2 distribution work.
- A low-footprint "light mode" resource profile — the current fast GPU config is kept as-is.
- macOS/Linux packaging — Windows 11 only for Phase 1 (design leaves hooks where cheap).

---

## 2. Key decisions (locked in brainstorming)

| Decision | Choice | Why |
|---|---|---|
| **Backend launch** | **Option B** — Tauri auto-spawns the venv uvicorn, kills it on exit | One-click daily driver; closing the window frees RAM+VRAM (lightest *net* footprint). No Python bundling. |
| **Resource profile** | Keep the current fast GPU config (Whisper `medium`/cuda + Kokoro/cuda + warmups) | Already tuned in v1.7 (~1s round-trips). Heavy only while open; freed on close. |
| **Scope** | Minimal shell first | Smallest slice that's daily-drivable; de-risks the mic gotcha early. |
| **Tauri version** | v2 | Current stable; better permission model; actively developed. |
| **`src-tauri/` location** | `frontend/src-tauri/` | Sits next to the web project's `package.json`; `frontendDist: "../out"` and `beforeDevCommand`/`beforeBuildCommand` resolve naturally. |

**Consequence — single-instance is mandatory (not optional).** Because launch auto-spawns a
backend, a second launch would spawn a *second* uvicorn fighting for port 8000. The
single-instance plugin makes a second launch focus the existing window instead.

---

## 3. Current-state facts this design relies on (verified)

- **Frontend is a pure client SPA.** Only `app/page.tsx` + `app/layout.tsx` + `globals.css`; no
  `app/api` routes, no SSR data fetching, no `next/image`. → Next.js static export (`output:
  "export"`) is viable with no loss.
- **Backend URL already externalized.** `lib/api.ts`: `API_URL = process.env.NEXT_PUBLIC_API_URL
  ?? "http://localhost:8000"`, with the `X-Zenith-Token` header attached by `apiFetch`. The
  WebView calls the local backend exactly as the browser does today; the HUD already degrades to an
  offline state when the backend is unreachable.
- **`BootScreen` already pings `/health`** and races it against a **1.2s timeout → "offline"**,
  then dissolves. Correct for the browser (backend usually already up); wrong for auto-spawn, where
  the backend needs ~30–45s of GPU warmup.
- **Backend CORS** (`main.py`): `_DEFAULT_ORIGINS` allows `localhost`/`127.0.0.1` on :3000/:3001
  only, overridable via `ZENITH_ALLOWED_ORIGINS`. A disallowed origin fails the CORS preflight and
  surfaces as a blanket "backend offline".
- **Toolchain:** Node 24 / npm 11 present; Next 14.2.35 / React 18.3.1. **Rust/Cargo NOT installed**
  (a prerequisite — see §9).

---

## 4. Architecture

```
┌─────────────────────────── Tauri v2 process ───────────────────────────┐
│  Rust host (src-tauri/)                                                 │
│   • single-instance plugin (focus existing window on 2nd launch)       │
│   • setup(): spawn backend child → uvicorn (venv python), CREATE_NO_WINDOW
│   • WebView2 PermissionRequested hook → grant microphone               │
│   • RunEvent::Exit / window close → kill backend child (free RAM+VRAM)  │
│                                                                        │
│  WebView2 (Win11 built-in) renders the static Next export (out/)       │
│   • BootScreen: Tauri-aware /health poll (up to ~90s) → reveal HUD     │
│   • getUserMedia (hold-Space) → voice loop, unchanged                  │
└────────────────────────────────────────────────────────────────────────┘
                    │  HTTP (http://localhost:8000, X-Zenith-Token)
                    ▼
        Python FastAPI backend (spawned child; the owner's venv)
         • CORS allowlist now includes http(s)://tauri.localhost
```

Units, each with one purpose:
- **Rust host (`src-tauri/src/main.rs` + a small `backend.rs`)** — process lifecycle, single
  instance, mic permission. Owns *no* app logic.
- **Tauri config (`tauri.conf.json`)** — window, build/dev commands, `frontendDist`, capabilities.
- **`BootScreen` (frontend)** — the only frontend change: health-gate the reveal when in Tauri.
- **Backend** — one-line CORS default extension; otherwise untouched (it already runs standalone).

---

## 5. Component detail

### 5.1 Frontend delivery (static export)
- Add to `frontend/next.config.mjs`: `output: "export"` (and `trailingSlash: true` only if asset
  loading under the Tauri protocol requires it — decide during implementation; default first).
- `next build` emits `frontend/out/`. Tauri bundles it (`frontendDist: "../out"`).
- **Dev:** `beforeDevCommand: "npm run dev"`, `devUrl: "http://localhost:3000"`. If :3000 is taken
  (owner sometimes runs Arkquen there), pin Zenith's dev to a fixed free port and match `devUrl`.
- The bundle bakes in `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`, unchanged) and, if the
  backend enforces a token, `NEXT_PUBLIC_ZENITH_API_TOKEN` at build time.

### 5.2 Backend lifecycle (Option B)
- **Spawn** in Tauri `setup()`:
  `<python> -m uvicorn main:app --host 127.0.0.1 --port 8000` with `cwd = <backend dir>`,
  **no `--reload`** (single clean process to kill), Windows `CREATE_NO_WINDOW` flag (no stray
  console window).
- **Path resolution (env, with dev defaults):**
  - `ZENITH_PYTHON` → default `<backend dir>/.venv/Scripts/python.exe`.
  - `ZENITH_BACKEND_DIR` → default resolved relative to the app/repo location.
  - Documented in `SETUP-TAURI.md`; keeps the app off a hardcoded absolute path while not bundling
    Python.
- **Store** the `Child` handle in Tauri managed state.
- **Kill** on `RunEvent::Exit` (and on main-window close) so RAM + VRAM are freed. Since uvicorn runs
  without `--reload`, it's a single process — a direct kill is clean.
- **Idempotence:** if `/health` is already answering on :8000 (owner started it manually), do **not**
  spawn a second one — probe first, spawn only if absent, and only kill a backend this app started.

### 5.3 Single instance
- `tauri-plugin-single-instance`: second launch → focus/raise the existing window, no second backend.

### 5.4 Boot / health-gate (the one frontend change)
- Detect Tauri at runtime via `window.__TAURI__` (present only inside the shell).
- **In Tauri:** replace the 1.2s give-up with a **poll of `/health` every ~1s for up to ~90s**,
  showing a "STARTING BACKEND…" status line; dissolve to the HUD as soon as `/health` returns 200.
  On timeout, fall through to the existing "offline" degrade (HUD still usable, shows offline states).
- **In the browser:** unchanged (fast 1.2s check → offline-degrade).
- Keep the existing click/any-key **skip** (reveals the HUD immediately; offline states apply if the
  backend isn't up yet). Fix the stale "WebGL orb" comment while here (R3F was removed).

### 5.5 Microphone permission (the #1 risk — front-loaded)
- **Problem:** WebView2 raises a `PermissionRequested` event when `getUserMedia` is called. Tauri
  does not auto-grant it, so the mic request is **denied silently** and the voice loop dies with no
  error — the documented #1 gotcha.
- **Fix:** in the Rust host, attach a WebView2 permission handler that **grants the microphone**
  permission kind (auto-allow for this trusted local app). Verify the exact Tauri v2 API/hook during
  implementation (candidates: `WebviewWindow` platform-webview access to add the
  `PermissionRequested` handler, or a config capability).
- **OS gate:** Windows Settings → Privacy & security → Microphone → "Let desktop apps access your
  microphone" must be ON. Documented in `SETUP-TAURI.md`.
- **First checkpoint after the window renders:** confirm `getUserMedia({audio:true})` resolves in
  the WebView (a tiny probe) **before** building the rest — if this can't be made to work, the whole
  shell is not viable and we want to know on day one.

### 5.6 Backend CORS
- Extend `_DEFAULT_ORIGINS` in `main.py` to include the Tauri WebView origins:
  `http://tauri.localhost`, `https://tauri.localhost` (Windows/WebView2), and `tauri://localhost`
  (future macOS). One-line change; keeps the desktop app working out of the box without the owner
  having to set `ZENITH_ALLOWED_ORIGINS`.

---

## 6. Error handling

- **Backend spawn fails** (bad python path, venv missing): log loudly to a Tauri log; the HUD boot
  screen times out (~90s) → offline degrade with a clear "couldn't start the backend — check
  `ZENITH_PYTHON`/`ZENITH_BACKEND_DIR`" message path. App still opens (doesn't hard-crash).
- **Backend already running** on :8000: detected via `/health` probe → skip spawn; on exit, don't
  kill a process this app didn't start.
- **Mic denied** (OS setting off, or hook not applied): the existing voice-error UI shows; docs point
  at the Windows privacy setting.
- **Second launch:** single-instance focuses the existing window; the second process exits without
  side effects.
- **CORS misconfig:** symptom is a blanket "backend offline" in the HUD; §5.6 default prevents it.

---

## 7. Testing / verification

Automated coverage is thin for a desktop shell (mostly native + manual), so verification is a
**scripted manual acceptance run** plus the cheap unit-testable pieces:

- **Unit (backend):** a test asserting the Tauri origins are in the effective CORS allowlist default.
- **Unit (frontend):** the BootScreen Tauri-branch health-poll logic (mock `window.__TAURI__` +
  `/health`) — resolves-to-reveal on 200, falls through to offline on timeout.
- **Manual acceptance (the real gate):**
  1. `tauri dev` opens a native window rendering the HUD.
  2. Backend auto-spawns; boot screen shows "STARTING BACKEND…" then reveals the live HUD once
     `/health` is green.
  3. **Hold-Space voice loop works end to end** (mic → `/transcribe` → `/chat` → `/speak`, audio
     plays) on Arc (spot-check Ghost/Amethyst render).
  4. Close the window → backend process gone; **VRAM freed** (verify in Task Manager / `nvidia-smi`).
  5. Launch twice → the second focuses the existing window; only one uvicorn in Task Manager.
  6. `tauri build` produces a runnable Windows bundle that repeats 1–5.

---

## 8. Files touched (anticipated)

- **New:** `frontend/src-tauri/` (`tauri.conf.json`, `Cargo.toml`, `src/main.rs`, `src/backend.rs`,
  icons, capabilities), `SETUP-TAURI.md`.
- **Edited (small):** `frontend/next.config.mjs` (`output: "export"`), `frontend/package.json`
  (Tauri dev/build scripts + `@tauri-apps/cli`), `frontend/components/BootScreen.tsx` (Tauri health
  poll), `backend/main.py` (CORS default origins), `.gitignore` (`frontend/src-tauri/target/`).
- **Docs:** update `CLAUDE.md` / PRD when shipped (M2 complete).

---

## 9. Prerequisites (owner, one-time)

- Install **Rust** via `rustup` (stable-msvc) and **Visual Studio C++ Build Tools** (MSVC linker).
  WebView2 already ships with Windows 11 — no action.
- Ensure the Windows microphone privacy setting allows desktop apps (§5.5).
- These block `tauri dev`/`tauri build` from running until installed; the plan will front-load a
  "verify toolchain" step.

---

## 10. Open items to resolve during implementation (not blockers)

- Exact Tauri v2 API for the WebView2 mic-permission grant (spike in the first mic checkpoint).
- Whether static export needs `trailingSlash`/`assetPrefix` tweaks under the Tauri asset protocol
  (try the default first; adjust only if assets 404).
- The default derivation of `ZENITH_BACKEND_DIR` for a *bundled* exe placed outside the repo (dev
  default is repo-relative; a bundled run may require the env var — documented either way).
