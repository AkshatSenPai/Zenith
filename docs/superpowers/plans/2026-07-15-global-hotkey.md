# Global Push-to-Talk Hotkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native global shortcut `Ctrl+Alt+Z` that brings Zenith to the front and toggles voice recording (press-to-toggle) from any app, driving the existing `startListening()`/`stopListening()` path.

**Architecture:** The Tauri Rust host owns the OS-global shortcut (`tauri-plugin-global-shortcut`); on key-down it shows/focuses the window and emits a `voice-hotkey` event. A small frontend listener toggles recording based on `recordingRef.current`. Zero changes to the voice endpoints, chat loop, or confirm gate.

**Tech Stack:** Tauri v2 (Rust), `tauri-plugin-global-shortcut` "2", Next.js/React frontend, `withGlobalTauri` global (no new npm dep). Spec: `docs/superpowers/specs/2026-07-15-global-hotkey-design.md`.

## Global Constraints

- **No JS test runner** for this surface — the frontend gate is `tsc --noEmit`; the Rust gate is `cargo build` (+ the existing 4 `cargo test`). The real test is owner manual acceptance.
- **No new npm dependency** — use the already-enabled `withGlobalTauri` global (`window.__TAURI__.event.listen`).
- Event name is exactly **`voice-hotkey`** on both sides.
- Register the plugin (`app.handle().plugin(...)`) **before** calling `app.global_shortcut()`.
- `Manager` is already imported at the top of `lib.rs` — do **not** re-import it in the new block (unused-import warning). Import only `tauri::Emitter` there.
- Keybinding is the constant `Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyZ)`.
- Commands run from repo root unless noted. Tauri crate dir is `frontend/src-tauri`; frontend dir is `frontend`.

---

### Task 1: Rust host — register the global hotkey

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` (add the plugin)
- Modify: `frontend/src-tauri/src/lib.rs` (register + handler, inside the existing `.setup()`)
- Modify: `frontend/src-tauri/capabilities/default.json` (plugin permissions)

**Interfaces:**
- Produces: an OS-global `Ctrl+Alt+Z` that, on press, shows+focuses window `main` and emits the Tauri event `voice-hotkey` (payload `()`), consumed by Task 2.

- [ ] **Step 1: Add the plugin dependency**

In `frontend/src-tauri/Cargo.toml`, after the existing `[target.'cfg(windows)'.dependencies]` block, add:

```toml
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 2: Register the hotkey in `lib.rs`**

In `frontend/src-tauri/src/lib.rs`, inside the `.setup(|app| { ... })` closure, immediately after `grant_microphone(app);` and before `Ok(())`, insert:

```rust
      #[cfg(desktop)]
      {
        use tauri::Emitter;  // Manager is already imported at the top of this file
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

        // Ctrl+Alt+Z — summon Zenith and toggle voice from any app.
        let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyZ);

        app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, _shortcut, event| {
              // Press-to-toggle: act on key-DOWN only; ignore the release.
              if event.state() == ShortcutState::Pressed {
                if let Some(w) = app.get_webview_window("main") {
                  let _ = w.show();
                  let _ = w.unminimize();
                  let _ = w.set_focus();
                }
                let _ = app.emit("voice-hotkey", ());
              }
            })
            .build(),
        )?;

        match app.global_shortcut().register(hotkey) {
          Ok(_) => {}
          Err(e) => eprintln!(
            "[zenith] could not register the Ctrl+Alt+Z global hotkey (already in use?): {e}"
          ),
        }
      }
```

- [ ] **Step 3: Grant the plugin permissions**

In `frontend/src-tauri/capabilities/default.json`, change the `permissions` array to:

```json
  "permissions": [
    "core:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister"
  ]
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend/src-tauri && cargo build`
Expected: builds successfully (the plugin downloads + compiles; first build adds a few crates). No errors. Warnings-only is acceptable but aim for none.

- [ ] **Step 5: Verify existing Rust tests still pass**

Run: `cd frontend/src-tauri && cargo test`
Expected: the existing 4 backend-path tests pass; no new failures.

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/Cargo.lock frontend/src-tauri/src/lib.rs frontend/src-tauri/capabilities/default.json
git commit -m "feat(hotkey): register Ctrl+Alt+Z global shortcut in the Tauri host"
```

---

### Task 2: Frontend — toggle voice on the `voice-hotkey` event

**Files:**
- Modify: `frontend/lib/tauri.ts` (add `onVoiceHotkey`)
- Modify: `frontend/app/page.tsx` (subscribe + toggle)

**Interfaces:**
- Consumes: the `voice-hotkey` Tauri event from Task 1; the existing `startListening`, `stopListening`, `recordingRef` in `page.tsx`.
- Produces: pressing the hotkey toggles recording (start if idle, stop+send if live).

- [ ] **Step 1: Add `onVoiceHotkey` to `lib/tauri.ts`**

Append to `frontend/lib/tauri.ts` (below the existing `isTauri`):

```ts
type UnlistenFn = () => void;

/** Subscribe to the Rust-side global-hotkey event (Ctrl+Alt+Z). No-op outside Tauri.
 *  Uses window.__TAURI__ (withGlobalTauri) so there's no extra npm dependency.
 *  Returns a cleanup function. */
export function onVoiceHotkey(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const listen = (window as unknown as {
    __TAURI__?: { event?: { listen?: (e: string, h: () => void) => Promise<UnlistenFn> } };
  }).__TAURI__?.event?.listen;
  if (typeof listen !== "function") return () => {};
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  listen("voice-hotkey", () => cb())
    .then((un) => { if (cancelled) un(); else unlisten = un; })
    .catch(() => {});
  return () => { cancelled = true; if (unlisten) unlisten(); };
}
```

- [ ] **Step 2: Import it in `page.tsx`**

In `frontend/app/page.tsx`, add `onVoiceHotkey` to the existing import from `../lib/tauri`. If there is no existing import from `../lib/tauri`, add:

```tsx
import { onVoiceHotkey } from "../lib/tauri";
```

(Verify whether `page.tsx` already imports from `../lib/tauri`; `BootScreen.tsx` imports `isTauri` from it, but `page.tsx` may not. Add or extend accordingly.)

- [ ] **Step 3: Subscribe + toggle**

In `frontend/app/page.tsx`, immediately AFTER the existing push-to-talk `useEffect` (the one with `onKeyDown`/`onKeyUp` for Space, ends around the `stopListening()` keyup handler), add:

```tsx
  // Global push-to-talk: Ctrl+Alt+Z (registered natively by the Tauri host) toggles voice from any app.
  // A ref keeps the toggle logic fresh so the one-time subscription never calls a stale startListening.
  const toggleVoiceRef = useRef<() => void>(() => {});
  toggleVoiceRef.current = () => {
    if (recordingRef.current) void stopListening();
    else void startListening();
  };
  useEffect(() => {
    const unlisten = onVoiceHotkey(() => toggleVoiceRef.current());
    return unlisten;
  }, []);
```

(`useRef`/`useEffect` are already imported in `page.tsx` — confirm and don't duplicate. Place this at the component's top level alongside the other hooks, not nested.)

- [ ] **Step 4: Verify the frontend typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the static export still builds**

Run: `cd frontend && npm run build`
Expected: `next build` completes the static export to `out/` with no errors. (Do NOT run this while `npm run dev` is live — it desyncs `.next`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/tauri.ts frontend/app/page.tsx
git commit -m "feat(hotkey): toggle voice on the voice-hotkey event from the Tauri host"
```

---

### Task 3: Docs

**Files:**
- Modify: `SETUP-TAURI.md` (acceptance line), `TODO.md` (tick), `CLAUDE.md` (footer version line)

- [ ] **Step 1: Add an acceptance line to `SETUP-TAURI.md`**

In the acceptance checklist section, add a bullet:

```markdown
- [ ] **Global hotkey:** focus another app, press **Ctrl+Alt+Z** → Zenith comes to front and the orb
      goes to LISTENING; speak; press **Ctrl+Alt+Z** again → it transcribes and replies. (Hold-Space
      still works in-window.) If nothing happens, check the backend log for a "could not register" warning.
```

- [ ] **Step 2: Tick `TODO.md`**

Under section C, change the global-hotkey line from a future item to shipped (see the existing checkbox style), noting `Ctrl+Alt+Z`, press-to-toggle, spec+plan paths, and that manual acceptance is owner-pending.

- [ ] **Step 3: Add the `CLAUDE.md` footer version line**

Prepend a `v3.2 (global push-to-talk hotkey — ...)` entry to the footer version history, matching the house style of the v3.1/v3.0 entries: what it is (Ctrl+Alt+Z, press-to-toggle, Rust host owns the shortcut + emits `voice-hotkey`, frontend toggles, zero voice-path change), files touched, gates (tsc + cargo build + owner acceptance), and that it's the first Tauri-unblocked feature.

- [ ] **Step 4: Commit**

```bash
git add SETUP-TAURI.md TODO.md CLAUDE.md
git commit -m "docs(hotkey): SETUP-TAURI acceptance + TODO + CLAUDE.md v3.2"
```

---

## Self-Review

**Spec coverage:** plugin dep + register + handler + window-focus + emit (Task 1 §4); capabilities (Task 1 Step 3); `onVoiceHotkey` via `withGlobalTauri` (Task 2 §5); toggle-with-fresh-ref (Task 2 Step 3); verification gates (Task 1 Steps 4-5, Task 2 Steps 4-5); docs incl. SETUP acceptance (Task 3). All spec sections mapped.

**Placeholders:** none — every code step shows the exact code. Task 2 Step 2 and Task 3 Steps 2-3 include a "verify the existing shape first" instruction with a concrete default, not a TODO.

**Type/name consistency:** event name `voice-hotkey` identical in Task 1 (`app.emit`) and Task 2 (`listen`). `onVoiceHotkey` defined in Task 2 Step 1, imported/used in Steps 2-3. `toggleVoiceRef`, `recordingRef`, `startListening`, `stopListening` names match `page.tsx`. Rust: `hotkey`, `ShortcutState::Pressed`, `GlobalShortcutExt` (for `global_shortcut()`), `Emitter` (for `emit`) all imported in the block.
