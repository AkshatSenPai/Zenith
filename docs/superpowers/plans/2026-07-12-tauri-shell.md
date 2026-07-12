# Zenith Tauri Desktop Shell (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Zenith HUD as a native Windows desktop app (Tauri v2) that auto-spawns the local FastAPI backend on launch, frees it on close, and supports the hold-Space voice loop.

**Architecture:** Tauri v2 Rust host wraps the Next.js HUD as a **static export** rendered in Win11's WebView2. On launch the Rust host spawns the owner's venv uvicorn (Option B) and kills it on exit; a single-instance guard prevents a second backend. The `BootScreen` health-gates the reveal to cover the backend's ~30–45s GPU warmup. The WebView calls `http://localhost:8000` exactly as the browser does today.

**Tech Stack:** Tauri v2 (Rust, `@tauri-apps/cli`), Next.js 14 static export, WebView2, existing Python 3.11 FastAPI backend.

**Design spec:** `docs/superpowers/specs/2026-07-12-tauri-shell-design.md`

## Global Constraints

- **Tauri v2** only (`@tauri-apps/cli@^2`, `tauri = "2"`). Not v1.
- **`src-tauri/` lives in `frontend/src-tauri/`** (next to the web project's `package.json`).
- **Tauri dev port = 1420** (`next dev -p 1420`), `devUrl = http://localhost:1420`. Avoids the owner's :3000/:3001 (Arkquen) collision.
- **Frontend dist = `../out`** (Next static export dir), `beforeBuildCommand = "npm run build"`, `beforeDevCommand = "npm run dev:tauri"`.
- **Backend spawn command (exact):** `<python> -m uvicorn main:app --host 127.0.0.1 --port 8000`, cwd = backend dir, **no `--reload`**, Windows `CREATE_NO_WINDOW` (`0x08000000`).
- **Backend paths from env:** `ZENITH_BACKEND_DIR` (default `<CARGO_MANIFEST_DIR>/../../backend`), `ZENITH_PYTHON` (default `<backend dir>/.venv/Scripts/python.exe`).
- **Only kill a backend this app spawned** — probe `127.0.0.1:8000` first; if already listening, don't spawn and don't kill.
- **CORS origins to add:** `http://tauri.localhost`, `https://tauri.localhost`, `tauri://localhost`, `http://localhost:1420`, `http://127.0.0.1:1420`.
- **Tauri detection:** `withGlobalTauri: true` in `tauri.conf.json`; frontend checks `"__TAURI__" in window`.
- **bundle identifier:** `com.zenith.desktop` (not the scaffold default `com.tauri.dev`).
- **Backend health poll (Tauri boot):** every 1000ms, up to 90000ms, resolve on `/health` 200.
- The backend, chat loop, confirm gate, and voice endpoints are **unchanged**. Only `main.py` CORS defaults change server-side.
- **Frontend has no unit-test runner** (repo convention): frontend tasks verify via `npx tsc --noEmit` + manual acceptance. Backend uses `pytest`; Rust uses `cargo test`.

## Prerequisites (already satisfied on this machine — verified 2026-07-12)

- Rust 1.97.0 (`x86_64-pc-windows-msvc`) installed to the user profile; `%USERPROFILE%\.cargo\bin` on PATH.
- MSVC C++ Build Tools 2026 + VC.Tools workload + Windows 11 SDK 10.0.26100 present; hello-world links green.
- WebView2 runtime present (150.x).
- A fresh machine would need `rustup` + MSVC Build Tools first (see `SETUP-TAURI.md`, Task 8).

## File Structure

- `backend/main.py` — MODIFY: extract `allowed_origins()`, add Tauri/1420 origins to the default.
- `backend/test_cors.py` — CREATE: unit test for `allowed_origins()`.
- `frontend/next.config.mjs` — MODIFY: `output: "export"`.
- `frontend/package.json` — MODIFY: add `@tauri-apps/cli` dev dep + `dev:tauri`/`tauri` scripts.
- `frontend/src-tauri/` — CREATE (via `tauri init`, then edited): `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `src/lib.rs`, `src/backend.rs`, `capabilities/default.json`, `icons/`.
- `frontend/lib/tauri.ts` — CREATE: `isTauri()` helper.
- `frontend/components/BootScreen.tsx` — MODIFY: Tauri-aware `/health` poll.
- `.gitignore` — MODIFY: ignore `frontend/src-tauri/target/`.
- `SETUP-TAURI.md` — CREATE: prerequisites + run/build instructions.

---

### Task 1: Backend CORS — allow the Tauri WebView + 1420 dev origin

**Files:**
- Modify: `backend/main.py:40-52`
- Test: `backend/test_cors.py` (create)

**Interfaces:**
- Produces: `allowed_origins(env_value: str | None) -> list[str]` in `backend/main.py` — returns the effective CORS allowlist; when `env_value` is `None`/empty, returns the default list (which now includes the Tauri + 1420 origins).

- [ ] **Step 1: Write the failing test**

Create `backend/test_cors.py`:

```python
from main import allowed_origins

TAURI = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}
DEV1420 = {"http://localhost:1420", "http://127.0.0.1:1420"}


def test_default_includes_tauri_and_1420_origins():
    origins = set(allowed_origins(None))
    assert TAURI <= origins, "Tauri WebView origins must be allowed by default"
    assert DEV1420 <= origins, "Tauri dev port 1420 must be allowed by default"
    # existing dev ports stay allowed
    assert "http://localhost:3000" in origins


def test_env_override_replaces_default():
    assert allowed_origins("http://example.com , http://foo") == ["http://example.com", "http://foo"]


def test_blank_env_falls_back_to_default():
    assert "http://tauri.localhost" in allowed_origins("")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_cors.py -q`
Expected: FAIL with `ImportError: cannot import name 'allowed_origins'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/main.py`, replace the current default-origins block (around lines 45-46):

```python
_DEFAULT_ORIGINS = (
    "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001,"
    "http://localhost:1420,http://127.0.0.1:1420,"          # Tauri dev (next dev -p 1420)
    "http://tauri.localhost,https://tauri.localhost,tauri://localhost"  # Tauri bundled WebView origin
)


def allowed_origins(env_value: str | None) -> list[str]:
    """Effective CORS allowlist. A set ZENITH_ALLOWED_ORIGINS replaces the default entirely;
    unset/blank falls back to the default (which covers the browser dev ports AND the Tauri shell)."""
    raw = env_value if (env_value and env_value.strip()) else _DEFAULT_ORIGINS
    return [o.strip() for o in raw.split(",") if o.strip()]


_ALLOWED_ORIGINS = allowed_origins(os.getenv("ZENITH_ALLOWED_ORIGINS"))
```

Leave the existing `app.add_middleware(CORSMiddleware, allow_origins=_ALLOWED_ORIGINS, ...)` untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_cors.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: all pass (prior baseline 257 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_cors.py
git commit -m "feat(tauri): allow Tauri WebView + :1420 dev origins in backend CORS"
```

---

### Task 2: Next.js static export

**Files:**
- Modify: `frontend/next.config.mjs`

**Interfaces:**
- Produces: `frontend/out/` (static HTML/JS/CSS) from `npm run build` — consumed by Tauri's `frontendDist: "../out"` in Task 3.

- [ ] **Step 1: Edit next.config.mjs**

Replace the file contents with:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // static HTML/JS/CSS in ./out — Tauri bundles this (pure client SPA, no SSR/API routes)
};

export default nextConfig;
```

- [ ] **Step 2: Build and verify the export exists**

Run: `cd frontend && npm run build`
Expected: build succeeds; `frontend/out/index.html` is created.

Verify: `cd frontend && ls out/index.html` (or `test -f frontend/out/index.html && echo OK`)
Expected: the file exists / `OK`.

If the build errors on a page that can't be statically exported, note the offending route in the output and fix that page to be fully client-side (the app is expected to already be a pure client SPA — a failure here means an unexpected server dependency slipped in).

- [ ] **Step 3: Confirm tsc is still clean**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/next.config.mjs
git commit -m "feat(tauri): Next.js static export (output: export) for the desktop bundle"
```

---

### Task 3: Scaffold `src-tauri` and load the HUD in a desktop window

**Files:**
- Create: `frontend/src-tauri/**` (via `tauri init`, then edited)
- Modify: `frontend/package.json`, `.gitignore`

**Interfaces:**
- Consumes: `frontend/out/` (Task 2) as `frontendDist`.
- Produces: a runnable `npm run tauri dev` that opens a native window; `frontend/src-tauri/src/lib.rs` exposing `pub fn run()` (Tauri v2 default), extended in Tasks 4/5/7.

- [ ] **Step 1: Add the Tauri CLI + scripts to package.json**

Run: `cd frontend && npm install -D @tauri-apps/cli@^2`

Then add to `frontend/package.json` `"scripts"`:

```json
    "dev:tauri": "next dev -p 1420",
    "tauri": "tauri"
```

- [ ] **Step 2: Scaffold src-tauri (non-interactive)**

Run from `frontend/`:

```bash
npx tauri init --ci \
  --app-name Zenith \
  --window-title Zenith \
  --frontend-dist ../out \
  --dev-url http://localhost:1420 \
  --before-dev-command "npm run dev:tauri" \
  --before-build-command "npm run build"
```

Expected: `frontend/src-tauri/` created with `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json`, `icons/`.
(If a flag name is rejected, run `npx tauri init --help` and map to the current name; the intent of each flag is fixed by the Global Constraints.)

- [ ] **Step 3: Edit `frontend/src-tauri/tauri.conf.json`**

Set these keys (merge into the generated file, keep the rest):

```json
{
  "productName": "Zenith",
  "identifier": "com.zenith.desktop",
  "app": {
    "withGlobalTauri": true,
    "windows": [
      { "title": "Zenith", "width": 1440, "height": 900, "minWidth": 1024, "minHeight": 700, "resizable": true }
    ]
  }
}
```

- [ ] **Step 4: Ignore the Rust build dir**

Add to `.gitignore`:

```
# Tauri Rust build artifacts
frontend/src-tauri/target/
```

- [ ] **Step 5: Compile the Rust host**

Run: `cd frontend/src-tauri && cargo build`
Expected: compiles (first build downloads crates — may take a few minutes). No errors.

- [ ] **Step 6: Manual — window renders the HUD**

Run: `cd frontend && npm run tauri dev`
Expected: a native "Zenith" window opens and renders the HUD (the boot screen will show "offline" since no backend yet — that's expected until Task 5). Close the window.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src-tauri .gitignore
git commit -m "feat(tauri): scaffold src-tauri (v2) — HUD renders in a desktop window"
```

---

### Task 4: Microphone permission — de-risk `getUserMedia` in the WebView

**Files:**
- Modify (conditionally): `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: the window from Task 3.
- Produces: a WebView in which `getUserMedia({audio:true})` resolves (the voice loop's precondition).

> This is the spec's #1 risk, front-loaded. **Probe first; add the Rust hook only if the probe fails.** getUserMedia needs no backend, so this is testable now.

- [ ] **Step 1: Ensure the OS mic setting is on**

Manual: Windows Settings → Privacy & security → Microphone → "Let desktop apps access your microphone" = **On**. (Document this in Task 8.)

- [ ] **Step 2: Probe getUserMedia in the dev WebView**

Run `cd frontend && npm run tauri dev`. In the running window, hold **Space** to start a recording, release, and speak — OR temporarily paste this in the app (e.g. via a devtools console if enabled, or a throwaway button):

```js
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(() => console.log("MIC OK"))
  .catch((e) => console.log("MIC FAIL", e.name, e.message));
```

Expected (success path): "MIC OK" / recording starts with no silent failure → **skip to Step 5 (no hook needed)**.
Expected (failure path): "MIC FAIL" / recording silently no-ops → continue to Step 3.

- [ ] **Step 3: (Only if the probe failed) Add the WebView2 permission-grant hook**

Add to `frontend/src-tauri/Cargo.toml` `[target.'cfg(windows)'.dependencies]`:

```toml
webview2-com = "0.34"
windows = { version = "0.61", features = ["Win32_Foundation"] }
```

(Match the versions Tauri v2 already resolves — check `cargo tree -p webview2-com` after Task 3 and pin to that to avoid a duplicate.)

In `frontend/src-tauri/src/lib.rs`, inside `.setup(|app| { ... })`, add:

```rust
#[cfg(windows)]
{
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        window.with_webview(|webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                ICoreWebView2, ICoreWebView2PermissionRequestedEventHandler,
            };
            use webview2_com::PermissionRequestedEventHandler;
            use windows::core::Interface;
            unsafe {
                let core: ICoreWebView2 = webview.controller().CoreWebView2().unwrap();
                let mut token = Default::default();
                let handler = PermissionRequestedEventHandler::create(Box::new(move |_sender, args| {
                    if let Some(args) = args {
                        let mut kind = Default::default();
                        args.PermissionKind(&mut kind).ok();
                        if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW).ok();
                        }
                    }
                    Ok(())
                }));
                core.add_PermissionRequested(&handler, &mut token).ok();
            }
        })?;
    }
}
```

> Exact type paths depend on the resolved `webview2-com` version — this is the spec's flagged spike. If the API differs, consult `webview2-com` docs for `add_PermissionRequested` and grant `COREWEBVIEW2_PERMISSION_KIND_MICROPHONE`.

- [ ] **Step 4: (Only if hook added) Rebuild and re-probe**

Run: `cd frontend && npm run tauri dev`, repeat Step 2's probe.
Expected: "MIC OK".

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri
git commit -m "feat(tauri): microphone works in the WebView (getUserMedia verified)"
```

(If no hook was needed, the commit records only the verification note / no Rust change — in that case commit a one-line comment in `lib.rs` documenting that WebView2 grants mic via its own prompt, so the finding isn't lost.)

---

### Task 5: Auto-spawn the backend on launch, kill it on exit

**Files:**
- Create: `frontend/src-tauri/src/backend.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: the Tauri app from Task 3.
- Produces (pure, tested): `resolve_backend_dir_from(env: Option<String>, base: &Path) -> PathBuf`, `resolve_python_from(env: Option<String>, backend_dir: &Path) -> PathBuf`, `port_in_use(addr: &str) -> bool`, `spawn_backend() -> Option<Child>`.

- [ ] **Step 1: Write `backend.rs` with failing cargo tests**

Create `frontend/src-tauri/src/backend.rs`:

```rust
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::Duration;

pub const BACKEND_ADDR: &str = "127.0.0.1:8000";

/// Backend dir: explicit ZENITH_BACKEND_DIR wins; else `<base>/../../backend` (base = CARGO_MANIFEST_DIR).
pub fn resolve_backend_dir_from(env: Option<String>, base: &Path) -> PathBuf {
    match env {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => base.join("..").join("..").join("backend"),
    }
}

/// Python: explicit ZENITH_PYTHON wins; else `<backend_dir>/.venv/Scripts/python.exe`.
pub fn resolve_python_from(env: Option<String>, backend_dir: &Path) -> PathBuf {
    match env {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => backend_dir.join(".venv").join("Scripts").join("python.exe"),
    }
}

pub fn port_in_use(addr: &str) -> bool {
    match addr.parse::<SocketAddr>() {
        Ok(sa) => TcpStream::connect_timeout(&sa, Duration::from_millis(300)).is_ok(),
        Err(_) => false,
    }
}

/// Spawn uvicorn from the venv. Returns None if the port is already served (owner started it) or spawn fails.
pub fn spawn_backend() -> Option<Child> {
    if port_in_use(BACKEND_ADDR) {
        eprintln!("[zenith] backend already on {BACKEND_ADDR}; not spawning.");
        return None;
    }
    let backend_dir = resolve_backend_dir_from(
        std::env::var("ZENITH_BACKEND_DIR").ok(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    );
    let python = resolve_python_from(std::env::var("ZENITH_PYTHON").ok(), &backend_dir);
    let mut cmd = Command::new(&python);
    cmd.args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"])
        .current_dir(&backend_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[zenith] spawned backend (pid {}) from {:?}", child.id(), python);
            Some(child)
        }
        Err(e) => {
            eprintln!("[zenith] failed to spawn backend ({python:?}): {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_dir_prefers_env() {
        let base = Path::new("C:/app/frontend/src-tauri");
        assert_eq!(
            resolve_backend_dir_from(Some("D:/custom/backend".into()), base),
            PathBuf::from("D:/custom/backend")
        );
    }

    #[test]
    fn backend_dir_default_is_repo_backend() {
        let base = Path::new("C:/app/frontend/src-tauri");
        assert_eq!(
            resolve_backend_dir_from(None, base),
            base.join("..").join("..").join("backend")
        );
    }

    #[test]
    fn python_default_is_venv() {
        let dir = Path::new("C:/app/backend");
        assert_eq!(
            resolve_python_from(None, dir),
            dir.join(".venv").join("Scripts").join("python.exe")
        );
    }

    #[test]
    fn python_prefers_env() {
        let dir = Path::new("C:/app/backend");
        assert_eq!(
            resolve_python_from(Some("py".into()), dir),
            PathBuf::from("py")
        );
    }
}
```

- [ ] **Step 2: Declare the module and run the tests (verify they pass)**

Add `mod backend;` near the top of `frontend/src-tauri/src/lib.rs`.

Run: `cd frontend/src-tauri && cargo test`
Expected: the 4 `backend::tests` pass.

- [ ] **Step 3: Wire spawn + kill-on-exit into `lib.rs`**

In `frontend/src-tauri/src/lib.rs`, add the managed child + spawn in `run()` and kill on `RunEvent::Exit`:

```rust
mod backend;

use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct BackendProc(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let child = backend::spawn_backend();

    tauri::Builder::default()
        .manage(BackendProc(Mutex::new(child)))
        .setup(|_app| {
            // (mic hook from Task 4 lives here if it was added)
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Zenith")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendProc>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            eprintln!("[zenith] backend terminated on exit.");
                        }
                    }
                }
            }
        });
}
```

> Merge with whatever `tauri init` generated (keep any existing plugins/handlers; fold the mic `setup` block in). If Task 4 added the mic hook, move it into this `.setup(|app| { ... })`.

- [ ] **Step 4: Compile**

Run: `cd frontend/src-tauri && cargo build`
Expected: compiles, no errors.

- [ ] **Step 5: Manual — spawn + free**

Run: `cd frontend && npm run tauri dev`. Then:
- In Task Manager (Details) confirm a `python.exe` (uvicorn) appears while the app is open.
- Note GPU/VRAM use once the backend finishes warming.
- Close the Zenith window → the `python.exe` disappears and VRAM is freed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/src/backend.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(tauri): auto-spawn venv backend on launch, kill on exit (Option B)"
```

---

### Task 6: Boot screen health-gates the reveal in Tauri

**Files:**
- Create: `frontend/lib/tauri.ts`
- Modify: `frontend/components/BootScreen.tsx`

**Interfaces:**
- Consumes: `isTauri()` from `frontend/lib/tauri.ts`; the existing `apiFetch("/health")`.
- Produces: in Tauri, the boot overlay waits (polling `/health` up to 90s, "STARTING BACKEND…") and reveals the HUD on 200; in the browser, unchanged.

- [ ] **Step 1: Add the Tauri detector**

Create `frontend/lib/tauri.ts`:

```typescript
/** True only inside the Tauri desktop shell. Relies on withGlobalTauri:true in tauri.conf.json,
 *  which injects window.__TAURI__ before app JS runs. Safe (false) in a normal browser + SSR. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}
```

- [ ] **Step 2: Health-gate the boot effect**

In `frontend/components/BootScreen.tsx`:

1. Add the import: `import { isTauri } from "../lib/tauri";`
2. Add a state line under the existing `health`/`linked` state:

```tsx
  // In Tauri, the boot screen shows "STARTING BACKEND…" while the auto-spawned backend warms up.
  const [starting, setStarting] = useState(false);
```

3. Replace the existing "Real backend + connection check" `useEffect` (the one with the 1200ms timeout) with:

```tsx
  useEffect(() => {
    let settled = false;
    const finishOk = (h: "online" | "offline", n: number) => {
      if (settled) return;
      settled = true;
      setStarting(false);
      setLinked(n);
      setHealth(h);
    };

    const linkedCount = async () => {
      const [g, d, tg] = await Promise.all([getGoogleStatus(), getDiscordStatus(), getTelegramStatus()]);
      return [g?.gmail_connected, g?.calendar_connected, tg?.connected, d?.connected].filter(Boolean).length;
    };

    if (isTauri()) {
      // Auto-spawned backend takes ~30-45s to warm. Poll /health up to 90s before giving up.
      setStarting(true);
      const deadline = Date.now() + 90_000;
      let timer: ReturnType<typeof setTimeout>;
      const poll = async () => {
        const ok = await apiFetch("/health").then((r) => r.ok).catch(() => false);
        if (ok) return finishOk("online", await linkedCount());
        if (Date.now() >= deadline) return finishOk("offline", 0);
        timer = setTimeout(poll, 1000);
      };
      poll();
      return () => { settled = true; clearTimeout(timer!); };
    }

    // Browser: fast check, raced against a 1.2s timeout so a dead backend can't hang the boot.
    const t = setTimeout(() => finishOk("offline", 0), 1200);
    Promise.all([
      apiFetch("/health").then((r) => r.ok).catch(() => false),
      getGoogleStatus(), getDiscordStatus(), getTelegramStatus(),
    ]).then(([ok, g, d, tg]) => {
      const n = [g?.gmail_connected, g?.calendar_connected, tg?.connected, d?.connected].filter(Boolean).length;
      finishOk(ok ? "online" : "offline", n);
    });
    return () => { settled = true; clearTimeout(t); };
  }, []);
```

4. Update the `BACKEND :8000` boot log line to reflect the starting state — change the `lines` array entry:

```tsx
    `BACKEND :8000 ...... ${starting ? "starting" : (health ?? "....")}`,
```

- [ ] **Step 3: tsc**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual — the gate works**

Run: `cd frontend && npm run tauri dev`.
Expected: the boot screen holds with "BACKEND :8000 ...... starting" while uvicorn warms, then reveals the live HUD once `/health` is green (no false "offline" flash). In a plain browser (`npm run dev`) the boot is unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/tauri.ts frontend/components/BootScreen.tsx
git commit -m "feat(tauri): boot screen health-gates the reveal over the backend warmup"
```

---

### Task 7: Single-instance guard

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: the `run()` builder from Task 5.
- Produces: a second launch focuses the existing window instead of spawning a second backend.

- [ ] **Step 1: Add the plugin dependency**

Run: `cd frontend/src-tauri && cargo add tauri-plugin-single-instance`
(Confirm it resolves a v2-compatible version; it must match `tauri = "2"`.)

- [ ] **Step 2: Register it FIRST in the builder**

In `frontend/src-tauri/src/lib.rs`, add as the **first** `.plugin(...)` on the builder (single-instance must be registered before others):

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
        }))
        .manage(BackendProc(Mutex::new(child)))
        // ...rest unchanged
```

- [ ] **Step 3: Compile**

Run: `cd frontend/src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 4: Manual — no double-spawn**

Run `cd frontend && npm run tauri dev`; once open, launch the built app / `tauri dev` a second time.
Expected: the existing window focuses; Task Manager shows exactly one uvicorn `python.exe`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/Cargo.lock frontend/src-tauri/src/lib.rs
git commit -m "feat(tauri): single-instance guard (focus window, no second backend)"
```

---

### Task 8: Setup docs + full acceptance run

**Files:**
- Create: `SETUP-TAURI.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `SETUP-TAURI.md`**

Create `SETUP-TAURI.md` covering:
- **Prerequisites:** Rust via `rustup` (stable-msvc), Visual Studio C++ Build Tools (MSVC), WebView2 (ships with Win11). Windows mic privacy setting ON.
- **Env vars:** `ZENITH_BACKEND_DIR` (default repo `backend/`), `ZENITH_PYTHON` (default `<backend>/.venv/Scripts/python.exe`), and that these let the app find the backend without bundling Python.
- **Run (dev):** `cd frontend && npm run tauri dev`.
- **Build (bundle):** `cd frontend && npm run tauri build` → installer/exe under `frontend/src-tauri/target/release/bundle/`.
- **Behavior:** launch auto-spawns the backend (unless one is already on :8000); closing the window frees it; second launch focuses the first.
- **Troubleshooting:** blank HUD / "offline" past 90s → check `ZENITH_PYTHON`; mic silent → Windows privacy setting; CORS "offline" → the Tauri origin must be in the allowlist (it is by default).

- [ ] **Step 2: Full acceptance run (the real gate)**

Perform and confirm each (from the spec §7):
1. `cd frontend && npm run tauri dev` → native window renders the HUD.
2. Boot screen shows "starting" then reveals the live HUD once `/health` is green.
3. **Hold-Space voice loop works end to end** (mic → `/transcribe` → `/chat` → `/speak`, audio plays) on Arc; spot-check Ghost + Amethyst render.
4. Close the window → backend `python.exe` gone; **VRAM freed** (Task Manager / `nvidia-smi`).
5. Launch twice → second focuses; exactly one uvicorn.
6. `cd frontend && npm run tauri build` → the bundle runs and repeats 1–5.

- [ ] **Step 3: Commit**

```bash
git add SETUP-TAURI.md
git commit -m "docs(tauri): SETUP-TAURI.md + Phase-1 shell acceptance verified"
```

- [ ] **Step 4: Update project docs**

Update `CLAUDE.md` (Milestone 2 → done; note the Tauri shell) and the PRD sync line. Commit:

```bash
git add CLAUDE.md JARVIS_PRD.md
git commit -m "docs: M2 complete — Tauri desktop shell shipped (Phase 1)"
```

---

## Self-Review

**Spec coverage:**
- §5.1 static export → Task 2. §5.2 backend lifecycle → Task 5. §5.3 single-instance → Task 7. §5.4 boot health-gate → Task 6. §5.5 mic → Task 4. §5.6 CORS → Task 1. §9 prereqs → Task 8 docs (+ already satisfied). §7 testing → per-task + Task 8 acceptance. All covered.
- §10 open items are handled where they land: mic API (Task 4 spike), static-export tweaks (Task 2 note), `ZENITH_BACKEND_DIR` bundled-default (Task 5 env + Task 8 docs).

**Placeholder scan:** No "TBD"/"add error handling"-style gaps. The only conditional content (Task 4's hook) is explicitly branch-gated with full code for both paths.

**Type consistency:** `allowed_origins` (Task 1) used only in Task 1. Rust fns `resolve_backend_dir_from`/`resolve_python_from`/`port_in_use`/`spawn_backend` defined and consumed in Task 5; `BackendProc`/`run()` consistent across Tasks 5 & 7. `isTauri()` defined in Task 6 lib and consumed in the same task's BootScreen edit. `dev:tauri`/`frontendDist ../out`/port 1420 consistent across Tasks 2, 3, 6.

**Note on verification realism:** desktop-shell behavior (window, spawn, mic, single-instance) is verified manually — the plan front-loads the mic risk (Task 4) and keeps unit tests where they're meaningful (CORS pytest, Rust path-resolution cargo tests).
