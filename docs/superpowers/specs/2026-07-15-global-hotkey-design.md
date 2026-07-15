# Global push-to-talk hotkey — design spec

**Date:** 2026-07-15
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Context:** First of the Tauri-unblocked "always-there assistant" features (order: hotkey → tray+autostart
→ background watcher). Today voice only starts from **hold-Space while the HUD window is focused**. This
adds a **global** hotkey so Zenith can be summoned to talk from any app — most of the wake word's
"summon from anywhere" value, with no Picovoice/account/email dependency (the wake word itself is parked
on that blocker, [[2026-07-14-wake-word-design]]).

---

## 1. What this is

A native **global shortcut, `Ctrl+Alt+Z`**, registered by the Tauri Rust host. Pressing it from anywhere
brings the Zenith window to the front and **toggles voice recording** (tap to start, tap again to stop &
send), driving the *exact same* `startListening()` / `stopListening()` path as hold-Space. The Rust host
owns the OS-level shortcut and, on press, **emits a `voice-hotkey` event** to the webview; a small
frontend listener toggles recording. **Zero changes to the voice endpoints, the chat loop, or the confirm
gate** — this only adds an input trigger.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Activation** | **Press-to-toggle** — tap to start, tap again to stop & send. | Ergonomic for a 3-key chord (you're not holding it while talking); robust — needs only the key-DOWN event, not a reliable global key-release. |
| **Keybinding** | **`Ctrl+Alt+Z`** (a named constant in Rust). | "Z" for Zenith, mnemonic, rarely bound globally on Windows. Rebindable = future. |
| **Window on activate** | **Show + unminimize + focus** the `main` window, then toggle. | You invoked it deliberately → bring it forward so you see the orb/reply. Pairs with the upcoming tray (summon from tray/background). |
| **Where it's registered** | **Rust host** (`tauri-plugin-global-shortcut`), not the JS API. | The mic/recording already live in the webview; the Rust host is the one process that can grab an OS-global key. The frontend only *listens* for the emitted event. |
| **JS transport** | The already-enabled **`withGlobalTauri`** global (`window.__TAURI__.event.listen`). | **No new npm dependency** — the global bundle is already on (used by `isTauri()`). |
| **Registration failure** | **Log a loud warning**, keep running. | If `Ctrl+Alt+Z` is already taken by another app, `register()` errors; the project's rule is never fail silently (cf. the STT CUDA-fallback logging). |
| **Toggle logic lives in** | The **frontend** (checks `recordingRef.current`). | Rust just says "hotkey pressed"; the frontend already owns recording state, so start-vs-stop stays in one place and interoperates with hold-Space. |

## 3. Architecture

```
[any app] user taps Ctrl+Alt+Z
      │
      ▼  (OS global shortcut, owned by the Tauri host)
Rust: tauri-plugin-global-shortcut handler, event.state()==Pressed
      ├─ window "main": show() + unminimize() + set_focus()
      └─ app.emit("voice-hotkey", ())
      │
      ▼  (Tauri event → webview)
Frontend: onVoiceHotkey listener (lib/tauri.ts)
      └─ recordingRef.current ? stopListening() : startListening()
             └─ (existing) startRecording → /transcribe → /chat → /speak
```

The bottom half (`startListening`/`stopListening` → the voice round-trip) is **unchanged existing code**.
Hold-Space still works and shares `recordingRef`, so the two triggers can't fight (a Space-started
recording is stopped by a hotkey tap and vice-versa).

## 4. Rust — `frontend/src-tauri/`

**`Cargo.toml`** — add the plugin (desktop platforms):

```toml
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-global-shortcut = "2"
```

**`src/lib.rs`** — register inside the existing `.setup()` (after `grant_microphone(app)`), desktop-gated:

```rust
#[cfg(desktop)]
{
    use tauri::Emitter;  // Manager is already imported at the top of lib.rs
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
        Err(e) => eprintln!("[zenith] could not register the Ctrl+Alt+Z global hotkey \
            (already in use by another app?): {e}"),
    }
}
```

Notes: the plugin must be registered (`app.handle().plugin(...)`) **before** `app.global_shortcut()` is
called — done in that order above. `Emitter` is the v2 trait for `app.emit` (imported in-block);
`Manager` (already imported at the top of `lib.rs`) provides `get_webview_window` — do NOT re-import it
in the block or it warns as unused.

**`capabilities/default.json`** — add the plugin permissions (belt-and-suspenders: the docs list them for
registration; harmless for a single-user local app that loads only its own frontend):

```json
"permissions": [
    "core:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister"
]
```

## 5. Frontend — `frontend/lib/tauri.ts` + `app/page.tsx`

**`lib/tauri.ts`** — a tiny, dependency-free subscriber via the `withGlobalTauri` global:

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

**`app/page.tsx`** — subscribe once; a ref keeps the toggle logic fresh (avoids a stale `startListening`
closure, which depends on `loading`):

```tsx
// Global push-to-talk: Ctrl+Alt+Z (registered natively by the Tauri host) toggles voice from any app.
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

(`onVoiceHotkey` is imported from `../lib/tauri`. In a plain browser it's a no-op, so dev at `:3000` is
unaffected.)

## 6. Testing & verification

This surface has no JS test runner (the frontend gate is `tsc`), and the Rust addition is glue with no
pure logic to unit-test — same shape as the Tauri shell itself. Gates:

- **`tsc --noEmit`** clean (frontend).
- **`cargo build`** (and existing `cargo test`, the 4 backend-path tests) green in `frontend/src-tauri/`.
- **`next build`** static export still succeeds.
- **Owner manual acceptance** (the real test): with `tauri dev` (or the built app) running, focus another
  app, press `Ctrl+Alt+Z` → Zenith comes to front + orb → LISTENING; speak; press `Ctrl+Alt+Z` again →
  it stops, transcribes, replies (spoken). Hold-Space still works in-window. If the hotkey does nothing,
  check the backend log for the "could not register" warning (another app owns the combo).

## 7. Out of scope (v1) / future

- **Rebindable key** + a Settings control (hardcoded `Ctrl+Alt+Z` for now).
- **Hold-to-talk** mode (press-to-toggle only).
- **Auto-stop on silence** (energy-silence endpointing) — arrives with the wake word, which reuses it.
- **System tray / autostart** — the next feature; this one just brings the existing window forward.

## 8. Files

**New:** this spec, the implementation plan.
**Modified:** `frontend/src-tauri/Cargo.toml` (plugin dep), `frontend/src-tauri/src/lib.rs` (register +
handler), `frontend/src-tauri/capabilities/default.json` (permissions), `frontend/lib/tauri.ts`
(`onVoiceHotkey`), `frontend/app/page.tsx` (the toggle listener), `SETUP-TAURI.md` (one acceptance line).
**Reuses:** `startListening`/`stopListening` + the whole voice round-trip, `isTauri()`, `recordingRef`,
`withGlobalTauri`. No new npm dependency; no backend change.
