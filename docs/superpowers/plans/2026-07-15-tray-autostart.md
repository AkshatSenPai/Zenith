# System Tray + Autostart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Zenith a tray-resident daemon — the window X hides to a system tray (backend stays warm), Quit is the only real exit, and an opt-in Settings toggle launches Zenith with Windows (hidden in the tray).

**Architecture:** Pure Tauri-host changes (tray icon + `on_window_event` close-to-tray + `tauri-plugin-autostart`) plus a dependency-free Settings toggle via the `withGlobalTauri` `core.invoke`. The existing backend spawn + `RunEvent::Exit` kill are unchanged. Spec: `docs/superpowers/specs/2026-07-15-tray-autostart-design.md`.

**Tech Stack:** Tauri v2 (`tray-icon` feature + `tauri-plugin-autostart` "2"), Next.js/React frontend.

## Global Constraints

- **No JS test runner** — gates are `cargo build` + `cargo test` (4 existing) + `tsc --noEmit` + `next build`; the real test is owner manual acceptance.
- **No new npm dependency** — autostart is driven via `window.__TAURI__.core.invoke("plugin:autostart|…")`.
- Closing the window must **hide, not exit**; the backend keeps running; **only tray Quit (`app.exit(0)`) exits**, routing through the existing `RunEvent::Exit` backend-kill (do not touch that handler).
- Autostart registers with the `--hidden` launch arg; `setup()` detects `--hidden` in `std::env::args()` and hides the window (start in tray). Default OFF.
- `Manager` and `RunEvent` are already imported at the top of `lib.rs`. Add new imports **inside** the new `#[cfg(desktop)]` block (tray/autostart types) and reference `tauri::WindowEvent` fully-qualified in `on_window_event`.
- Commands run from repo root; Tauri crate dir is `frontend/src-tauri`, frontend dir is `frontend`.

---

### Task 1: Rust host — tray, close-to-tray, autostart

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` (tray feature + autostart dep)
- Modify: `frontend/src-tauri/src/lib.rs` (single-instance `show()`, `on_window_event`, autostart+tray+`--hidden` block)
- Modify: `frontend/src-tauri/capabilities/default.json` (autostart permissions)

**Interfaces:**
- Produces: a tray icon with Show/Quit; window-X hides to tray; login `--hidden` starts hidden; the `plugin:autostart|enable|disable|is_enabled` commands available to the frontend (Task 2).

- [ ] **Step 1: Enable the tray feature + add the autostart dep in `Cargo.toml`**

Change the `tauri` dependency line to enable `tray-icon`:
```toml
tauri = { version = "2.11.3", features = ["tray-icon"] }
```
Add `tauri-plugin-autostart` to the existing desktop-target block (the one with `tauri-plugin-global-shortcut`):
```toml
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-global-shortcut = "2"
tauri-plugin-autostart = "2"
```

- [ ] **Step 2: Un-hide on second launch (single-instance callback)**

In `frontend/src-tauri/src/lib.rs`, in the `tauri_plugin_single_instance::init(...)` callback, add `w.show()`:
```rust
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
      }
    }))
```

- [ ] **Step 3: Close-to-tray via `on_window_event`**

Add this builder method immediately before `.build(tauri::generate_context!())`:
```rust
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();          // hide instead of exit — Zenith lives in the tray
        let _ = window.hide();
      }
    })
```

- [ ] **Step 4: Autostart + tray + `--hidden` block in `setup()`**

In the existing `.setup(|app| { ... })`, AFTER the `#[cfg(desktop)]` global-hotkey block and BEFORE `Ok(())`, add:
```rust
      #[cfg(desktop)]
      {
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        use tauri_plugin_autostart::MacosLauncher;

        // Autostart (opt-in via Settings). Registered with --hidden so a login launch starts in the tray.
        app.handle().plugin(tauri_plugin_autostart::init(
          MacosLauncher::LaunchAgent,
          Some(vec!["--hidden"]),
        ))?;

        // Tray icon + menu.
        let show_i = MenuItem::with_id(app, "show", "Show Zenith", true, None::<&str>)?;
        let quit_i = MenuItem::with_id(app, "quit", "Quit Zenith", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
        let _tray = TrayIconBuilder::new()
          .icon(app.default_window_icon().unwrap().clone())
          .tooltip("Zenith")
          .menu(&menu)
          .show_menu_on_left_click(false)   // left-click summons; right-click opens the menu
          .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => {
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
              }
            }
            _ => {}
          })
          .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
              button: MouseButton::Left, button_state: MouseButtonState::Up, ..
            } = event {
              let app = tray.app_handle();
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
              }
            }
          })
          .build(app)?;

        // Launched at login via autostart → start hidden in the tray.
        if std::env::args().any(|a| a == "--hidden") {
          if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
          }
        }
      }
```

- [ ] **Step 5: Grant autostart permissions**

In `frontend/src-tauri/capabilities/default.json`, set `permissions` to:
```json
  "permissions": [
    "core:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
  ]
```

- [ ] **Step 6: Compile**

Run: `cd frontend/src-tauri && cargo build`
Expected: builds cleanly. If it errors on `show_menu_on_left_click`, rename to `menu_on_left_click(false)` (older 2.x name) and rebuild. If it errors on `default_window_icon().unwrap()` being None at build time — it won't (that's runtime); acceptance step catches a missing icon.

- [ ] **Step 7: Existing Rust tests still pass**

Run: `cd frontend/src-tauri && cargo test`
Expected: 4 passed, 0 failed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/Cargo.lock frontend/src-tauri/src/lib.rs frontend/src-tauri/capabilities/default.json
git commit -m "feat(tray): tray icon + close-to-tray + autostart in the Tauri host"
```

---

### Task 2: Frontend — autostart helpers + Settings toggle

**Files:**
- Modify: `frontend/lib/tauri.ts` (`getAutostartEnabled`, `setAutostartEnabled`)
- Modify: `frontend/components/SettingsView.tsx` (Startup section, Tauri-only)

**Interfaces:**
- Consumes: the `plugin:autostart|*` commands from Task 1; the existing `Section` + `ToggleRow` components in `SettingsView.tsx`.
- Produces: a working "Launch on login" toggle shown only inside the desktop app.

- [ ] **Step 1: Add autostart helpers to `lib/tauri.ts`**

Append to `frontend/lib/tauri.ts`:
```ts
function tauriInvoke<T>(cmd: string): Promise<T> | null {
  const invoke = (window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string) => Promise<unknown> } };
  }).__TAURI__?.core?.invoke;
  return typeof invoke === "function" ? (invoke(cmd) as Promise<T>) : null;
}

/** Whether "launch on login" is currently registered. False outside Tauri / on any error. */
export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  try { return (await tauriInvoke<boolean>("plugin:autostart|is_enabled")) ?? false; }
  catch { return false; }
}

/** Enable/disable launch-on-login. No-op outside Tauri; swallows errors. */
export async function setAutostartEnabled(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try { await tauriInvoke<void>(on ? "plugin:autostart|enable" : "plugin:autostart|disable"); }
  catch { /* ignore */ }
}
```

- [ ] **Step 2: Import in `SettingsView.tsx`**

Add to the imports:
```tsx
import { isTauri, getAutostartEnabled, setAutostartEnabled } from "../lib/tauri";
```

- [ ] **Step 3: State + toggle handler**

Inside the `SettingsView` component (near the existing `reduce` state/`toggleReduce`), add:
```tsx
  const [isDesktop, setIsDesktop] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  useEffect(() => {
    setIsDesktop(isTauri());
    getAutostartEnabled().then(setAutostartOn);
  }, []);
  const toggleAutostart = async () => {
    const next = !autostartOn;
    setAutostartOn(next);                          // optimistic
    await setAutostartEnabled(next);
    setAutostartOn(await getAutostartEnabled());   // reconcile with the OS
  };
```

- [ ] **Step 4: Render the Startup section**

Immediately after the `Motion` `<Section>...</Section>` block, add:
```tsx
          {isDesktop && (
            <Section title="Startup" caption="Desktop app">
              <ToggleRow
                label="Launch on login"
                desc="Start Zenith with Windows, hidden in the tray. Summon it with the tray icon or Ctrl+Alt+Z."
                on={autostartOn}
                onChange={toggleAutostart}
              />
            </Section>
          )}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Static export builds**

Run: `cd frontend && npm run build`
Expected: `next build` completes with no errors. (Not while `npm run dev` is live.)

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/tauri.ts frontend/components/SettingsView.tsx
git commit -m "feat(tray): Settings 'Launch on login' toggle (dependency-free autostart)"
```

---

### Task 3: Docs

**Files:**
- Modify: `SETUP-TAURI.md` (acceptance), `TODO.md` (tick), `CLAUDE.md` (footer v3.3)

- [ ] **Step 1: SETUP-TAURI acceptance**

Add tray/autostart acceptance bullets to the checklist (X hides to tray + backend alive; tray left-click restores; Ctrl+Alt+Z restores; Quit frees VRAM; Startup toggle → reboot → starts hidden), and renumber the `tauri build` line to last. Use the spec §6 wording.

- [ ] **Step 2: TODO.md**

Under section C, flip the "System tray" and "Autostart on login" lines to shipped (checkbox), noting close-to-tray, opt-in default-off toggle, spec+plan paths, and owner-acceptance-pending.

- [ ] **Step 3: CLAUDE.md footer**

Prepend a `v3.3 (system tray + autostart — ...)` entry matching the v3.2/v3.1 house style: close-to-tray daemon (X hides, backend stays warm, Quit is the only real exit → existing RunEvent::Exit), tray Show/Quit + left-click summon, Ctrl+Alt+Z synergy, opt-in default-off "Launch on login" (starts hidden via `--hidden`), dependency-free via `core.invoke`, files, gates (cargo build + cargo test + tsc + next export + owner acceptance pending), and that it's the foundation for the background watcher (#3).

- [ ] **Step 4: Commit + push**

```bash
git add SETUP-TAURI.md TODO.md CLAUDE.md
git commit -m "docs(tray): SETUP-TAURI acceptance + TODO + CLAUDE.md v3.3"
git push origin main
```

---

## Self-Review

**Spec coverage:** tray feature + autostart dep (T1 S1); single-instance show (T1 S2); close-to-tray (T1 S3); autostart register + tray build + `--hidden` (T1 S4); capabilities (T1 S5); autostart JS helpers (T2 S1); Settings Startup toggle Tauri-only (T2 S2-4); gates (T1 S6-7, T2 S5-6); docs incl. acceptance (T3). All spec §4-6 mapped.

**Placeholders:** none — every code step shows exact code. The `show_menu_on_left_click`→`menu_on_left_click` note is a concrete fallback, not a TODO.

**Type/name consistency:** menu ids `"show"`/`"quit"` match between `MenuItem::with_id` and `on_menu_event`. `getAutostartEnabled`/`setAutostartEnabled` defined in T2 S1, imported/used in S2-4. `autostartOn`/`setAutostartOn`/`isDesktop`/`toggleAutostart` consistent within SettingsView. `--hidden` identical in the autostart `init` args and the `std::env::args()` check. Rust imports (`Menu`, `MenuItem`, `TrayIconBuilder`, `TrayIconEvent`, `MouseButton`, `MouseButtonState`, `MacosLauncher`) all referenced in-block; `tauri::WindowEvent` fully-qualified in `on_window_event`.
