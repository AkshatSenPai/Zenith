# System tray + autostart — design spec

**Date:** 2026-07-15
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Context:** Second of the Tauri-unblocked "always-there assistant" features (order: hotkey ✅ →
**tray+autostart** → background watcher). Today closing the window exits the app and pays the ~30-45s GPU
warmup again on next launch. This makes Zenith a **tray-resident daemon**: closing hides it (backend stays
warm), it's summonable from the tray or the Ctrl+Alt+Z hotkey, and it can optionally launch with Windows.
This is the foundation the background proactivity watcher (feature #3) and eventually the wake word need.

---

## 1. What this is

Two Tauri-host capabilities, no backend/loop/gate change:
1. **System tray** — a persistent tray icon (menu: Show · Quit; left-click summons). **Closing the window
   hides it to the tray instead of exiting**; the app + uvicorn backend keep running (GPU warm). Real exit
   is only tray **Quit** → the existing `RunEvent::Exit` frees the backend/VRAM.
2. **Autostart** — an opt-in **"Launch on login"** toggle in Settings (default **off**). When enabled,
   Zenith registers to start with Windows **hidden in the tray** (a `--hidden` launch arg), so login isn't
   interrupted and the backend warms in the background.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Close (X) button** | **Hide to tray, keep running.** | The point of an always-there assistant — backend/GPU stay warm, re-show + hotkey are instant. |
| **Quit** | Tray menu **"Quit Zenith"** → `app.exit(0)`. | The only real exit; routes through the existing `RunEvent::Exit` backend-kill (unchanged). |
| **Tray left-click** | Unhide + focus the window. | Summon by clicking the icon; menu on right-click (`show_menu_on_left_click(false)`). |
| **Autostart** | **Settings toggle, default OFF.** | Least intrusive — nothing changes until the owner opts in. |
| **Autostart launch mode** | **Hidden to tray** (`--hidden` arg detected in `setup()`). | Login isn't interrupted by a window; the backend warms silently, summon when needed. |
| **Autostart JS transport** | `plugin:autostart|enable/disable/is_enabled` via the `withGlobalTauri` `core.invoke`. | **No new npm dependency** (same dependency-free approach as the hotkey). |

## 3. Architecture

```
Window X ──▶ on_window_event: CloseRequested → api.prevent_close() + window.hide()   (app stays alive)
Tray left-click ──▶ show() + unminimize() + set_focus()
Tray menu "Show" ──▶ show() + set_focus()
Tray menu "Quit" ──▶ app.exit(0) ──▶ RunEvent::Exit ──▶ (existing) kill spawned backend, free VRAM
Ctrl+Alt+Z (feature #1) ──▶ already show()+focus()+listen  → also un-hides from the tray

Login (if autostart enabled) ──▶ process launched with "--hidden"
   setup(): std::env::args() contains "--hidden" ──▶ window.hide()  (starts in tray; backend warms)

Settings "Launch on login" toggle ──▶ core.invoke("plugin:autostart|enable"|"disable")
   seeded from core.invoke("plugin:autostart|is_enabled")
```

The backend spawn (before the window) and the `RunEvent::Exit` kill are **unchanged**. Because
`CloseRequested` is prevented (hide, not destroy), the window is never destroyed while running, so the app
does not auto-exit when "closed" — no `prevent_exit` handling needed.

## 4. Rust — `frontend/src-tauri/`

**`Cargo.toml`:**
```toml
tauri = { version = "2.11.3", features = ["tray-icon"] }
```
and add to the existing desktop-target dependency block (next to `tauri-plugin-global-shortcut`):
```toml
tauri-plugin-autostart = "2"
```

**`src/lib.rs`:**

- Single-instance callback also un-hides — add `let _ = w.show();`:
  ```rust
  .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
    if let Some(w) = app.get_webview_window("main") {
      let _ = w.show();
      let _ = w.unminimize();
      let _ = w.set_focus();
    }
  }))
  ```

- Close-to-tray — add before `.build()`:
  ```rust
  .on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
      api.prevent_close();          // hide instead of exit — Zenith lives in the tray
      let _ = window.hide();
    }
  })
  ```

- Inside the existing `.setup(|app| { ... })`, after the `#[cfg(desktop)]` global-hotkey block, add a
  second `#[cfg(desktop)]` block for autostart + tray + the `--hidden` handling:
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

> `show_menu_on_left_click` is the tauri 2.11 method name (renamed from `menu_on_left_click` in earlier
> 2.x); if the build errors on it, use `menu_on_left_click(false)`.

**`capabilities/default.json`** — add autostart permissions (tray needs none — it's Rust-side):
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

## 5. Frontend — `frontend/lib/tauri.ts` + `components/SettingsView.tsx`

**`lib/tauri.ts`** — dependency-free autostart helpers via the global `core.invoke`:
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

**`components/SettingsView.tsx`** — a new **"Startup"** section, rendered **only inside Tauri** (the toggle
is meaningless in a browser). Seed from the actual OS state, and re-read after a write so the UI reflects
what actually happened:
```tsx
import { isTauri, getAutostartEnabled, setAutostartEnabled } from "../lib/tauri";
// ...
const [isDesktop, setIsDesktop] = useState(false);
const [autostartOn, setAutostartOn] = useState(false);
useEffect(() => {
  setIsDesktop(isTauri());
  getAutostartEnabled().then(setAutostartOn);
}, []);
const toggleAutostart = async () => {
  const next = !autostartOn;
  setAutostartOn(next);                       // optimistic
  await setAutostartEnabled(next);
  setAutostartOn(await getAutostartEnabled()); // reconcile with the OS
};
// ...rendered after the Motion section:
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

## 6. Testing & verification

Same shape as the hotkey — no JS test runner for this surface; the gates are builds + owner acceptance:
- **`cargo build`** + existing **`cargo test`** (4) green in `frontend/src-tauri/`.
- **`tsc --noEmit`** + **`next build`** static export clean.
- **Owner manual acceptance:**
  1. Click the window **X** → it disappears but a **Zenith tray icon** remains; the backend `python.exe`
     is still alive (Task Manager) and VRAM is **not** freed.
  2. **Left-click** the tray icon → the window returns, HUD intact. **Right-click** → Show / Quit menu.
  3. Press **Ctrl+Alt+Z** while hidden → the window returns and starts listening.
  4. Tray **Quit Zenith** → the window closes, `python.exe` disappears, **VRAM freed**.
  5. Settings → **Startup → Launch on login** ON → it appears under Task Manager ▸ Startup apps; **reboot**
     → Zenith is running in the tray with **no window shown**; click the tray → HUD is already live. Toggle
     OFF → removed from startup.

## 7. Out of scope (v1) / future

- **Richer tray menu** (quick actions, recent nudges, status) — minimal Show/Quit for now.
- **Background proactivity watcher + native notifications** — feature #3; this one only keeps the app
  alive + reachable, it doesn't yet *do* anything while hidden.
- **macOS/Linux specifics** — the plugin is cross-platform, but Zenith targets Windows; not exercised.
- **"Minimize to tray"** (the − button) — only the X hides to tray in v1; minimize still goes to the
  taskbar (standard, unsurprising).

## 8. Files

**New:** this spec, the implementation plan.
**Modified:** `frontend/src-tauri/Cargo.toml` (tray feature + autostart dep), `frontend/src-tauri/src/lib.rs`
(tray + close-to-tray + autostart register + `--hidden` + single-instance `show()`),
`frontend/src-tauri/capabilities/default.json` (autostart perms), `frontend/lib/tauri.ts` (autostart
helpers), `frontend/components/SettingsView.tsx` (Startup section), `SETUP-TAURI.md` (acceptance),
`TODO.md`, `CLAUDE.md` (footer).
**Reuses:** the existing backend spawn/`RunEvent::Exit` kill, `get_webview_window`, the app icon, the
Settings `Section`/`ToggleRow` components, `withGlobalTauri` `core.invoke`. No new npm dependency; no
backend change.
