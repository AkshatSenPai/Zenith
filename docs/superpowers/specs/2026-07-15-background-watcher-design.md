# Background proactivity watcher + native notifications — design spec

**Date:** 2026-07-15
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Context:** Third and final Tauri-unblocked "always-there" feature (order: hotkey ✅ → tray+autostart ✅ →
**background watcher**). Proactivity (M7 Part 2) computes ≤3 nudges but only *on demand* — a 60s in-tab
poll that shows cards when the HUD is open. Now that Zenith stays alive in the tray, a background watcher
can **fire native OS toasts when something slips even while the window is hidden**. This is the payoff of
features #1 and #2: the always-running app finally *does* something while hidden.

---

## 1. What this is

A **background thread in the Tauri Rust host** (the one process always running while hidden to the tray)
that polls the existing `GET /proactive` on an interval and fires a **native Windows toast** for each new
nudge — but only when **background alerts are on** and the **HUD window isn't focused**. A default-on
**"Background alerts"** mute toggle lives in Settings, its state persisted in the backend so the Rust
watcher respects it via the poll response.

**Invariants preserved (do not touch):** this feature only *surfaces* nudges that `proactivity_service`
already produces. The no-tools commitment-extraction call and the inert-prefill nudge actions are
**unchanged**. Nothing here computes or acts — it reads `/proactive` and shows a toast.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Where the watcher runs** | **Rust host background thread.** | The only process guaranteed alive when the window is hidden to the tray. A hidden WebView2 throttles/suspends JS timers → unreliable. |
| **How it gets nudges** | Poll `GET http://127.0.0.1:8000/proactive` (`ureq`), every **120s** after a **60s** warmup delay. | Reuses the existing endpoint (nudge logic, no-tools extraction, cache, kill-switch all unchanged). Cheap — mostly cache hits. |
| **When it notifies** | Only when `alerts_enabled` **and** the HUD window **isn't focused**. | If you're looking at the HUD you already see the card; a toast would be redundant noise. |
| **Dedup** | In-memory `HashSet<String>` of nudge ids already surfaced; mark current ids seen every tick (even when muted/focused). | Each nudge toasts **once**; a muted/seen backlog isn't dumped on unmute or on look-away; a re-surfaced id can toast again. |
| **Mute toggle** | **Settings "Background alerts", default ON.** State in the backend (`.zenith/proactive.json`), returned by `/proactive`. | The Rust watcher reads `alerts_enabled` from the poll — **no custom Tauri command/capability**. Anti-nag escape hatch (a core proactivity goal). |
| **Auth** | Watcher sends `X-Zenith-Token` if configured — read from env, else parsed from `backend/.env`. | Works whether or not the owner enforces the token (fail-open localhost is the common case). |

## 3. Architecture

```
Rust host (always alive, even hidden to tray)
  └─ watcher::spawn(app_handle)  [std::thread]
       loop every 120s (after 60s warmup):
         GET 127.0.0.1:8000/proactive  (+ X-Zenith-Token if set)   ── ureq
           → { nudges:[{id,title,body,...}], alerts_enabled }
         focused = window("main").is_focused()
         if alerts_enabled && !focused:
             for n in nudges where n.id ∉ seen:
                 app.notification().builder().title("Zenith · "+n.title).body(n.body).show()
         seen = { n.id for n in nudges }        # dedup + prune gone ids

Backend (unchanged nudge logic)
  GET  /proactive          → { nudges, alerts_enabled }   (added the flag)
  POST /proactive/alerts   → set alerts_enabled            (new)
  proactivity_service.get_alerts_enabled()/set_alerts_enabled()  → .zenith/proactive.json

Frontend (desktop only)
  Settings ▸ Notifications ▸ "Background alerts"  → POST /proactive/alerts
  (the in-HUD NudgeStack 60s poll is UNCHANGED — cards still render when the window is open)
```

## 4. Backend — `proactivity_service.py` + `main.py`

**`proactivity_service.py`** — add the persisted flag to the existing state store:
```python
def _blank_state() -> dict:
    return {"ledger": {"dismissed": {}, "snoozed": {}},
            "cache": {"signature": "", "commitments": []},
            "alerts_enabled": True}
# in _load(), after merging ledger + cache:
    base["alerts_enabled"] = bool(data.get("alerts_enabled", True))

def get_alerts_enabled() -> bool:
    return bool(_load().get("alerts_enabled", True))

def set_alerts_enabled(on: bool) -> None:
    st = _load()
    st["alerts_enabled"] = bool(on)
    _save(st)
```
(The existing `dismiss`/`snooze`/`set_cache` already do `_load()`→mutate→`_save()`, and `_save` writes the
whole dict, so `alerts_enabled` is preserved through those. A pre-existing file without the key defaults
to `True`.)

**`main.py`** — return the flag + add the setter route (mirrors `DismissRequest`/`/proactive/dismiss`):
```python
class AlertsRequest(BaseModel):
    enabled: bool

@app.get("/proactive")
def proactive() -> dict:
    try:
        return {"nudges": proactivity_service.get_nudges(),
                "alerts_enabled": proactivity_service.get_alerts_enabled()}
    except Exception as exc:  # noqa: BLE001
        print(f"[proactive] endpoint error: {exc}", flush=True)
        return {"nudges": [], "alerts_enabled": True}

@app.post("/proactive/alerts")
def proactive_alerts(req: AlertsRequest) -> dict:
    proactivity_service.set_alerts_enabled(req.enabled)
    return {"ok": True, "alerts_enabled": proactivity_service.get_alerts_enabled()}
```

## 5. Rust host — `frontend/src-tauri/`

**`Cargo.toml`:**
```toml
# desktop-target block (with global-shortcut + autostart):
tauri-plugin-notification = "2"
ureq = { version = "2", default-features = false }   # http-only (localhost) → no TLS deps
```

**`src/backend.rs`** — add a token resolver (reuse the existing backend-dir resolution):
```rust
/// The API token the watcher must send to reach /proactive when auth is enforced.
/// Env first (ZENITH_API_TOKEN), else parsed from <backend_dir>/.env. None → no header (fail-open).
pub fn api_token() -> Option<String> {
    if let Ok(t) = std::env::var("ZENITH_API_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() { return Some(t); }
    }
    let text = std::fs::read_to_string(backend_dir().join(".env")).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("ZENITH_API_TOKEN=") {
            let v = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !v.is_empty() { return Some(v); }
        }
    }
    None
}
```
(`backend_dir()` already exists in `backend.rs`. Add a cargo test for the `.env` parse via a temp dir.)

**`src/watcher.rs` (new module):**
```rust
use std::collections::HashSet;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

const POLL_URL: &str = "http://127.0.0.1:8000/proactive";
const INITIAL_DELAY_SECS: u64 = 60;
const INTERVAL_SECS: u64 = 120;

#[derive(serde::Deserialize)]
struct Nudge { id: String, title: String, body: String }

/// Poll /proactive and toast new nudges when alerts are on and the HUD isn't focused.
pub fn spawn(app: tauri::AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(INITIAL_DELAY_SECS));
        let token = crate::backend::api_token();
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(5))
            .timeout_read(Duration::from_secs(10))
            .build();
        let mut seen: HashSet<String> = HashSet::new();
        loop {
            if let Some((nudges, alerts_enabled)) = poll(&agent, &token) {
                let focused = app.get_webview_window("main")
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false);
                if alerts_enabled && !focused {
                    for n in &nudges {
                        if !seen.contains(&n.id) {
                            let _ = app.notification().builder()
                                .title(format!("Zenith · {}", n.title))
                                .body(n.body.clone())
                                .show();
                        }
                    }
                }
                seen = nudges.into_iter().map(|n| n.id).collect();
            }
            thread::sleep(Duration::from_secs(INTERVAL_SECS));
        }
    });
}

fn poll(agent: &ureq::Agent, token: &Option<String>) -> Option<(Vec<Nudge>, bool)> {
    let mut req = agent.get(POLL_URL);
    if let Some(t) = token { req = req.set("X-Zenith-Token", t); }
    let body = req.call().ok()?.into_string().ok()?;
    let val: serde_json::Value = serde_json::from_str(&body).ok()?;
    let alerts = val.get("alerts_enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let nudges: Vec<Nudge> = serde_json::from_value(val.get("nudges")?.clone()).ok()?;
    Some((nudges, alerts))
}
```

**`src/lib.rs`:**
- Add `mod watcher;` at the top.
- Register the plugin in the builder chain (after single-instance): `.plugin(tauri_plugin_notification::init())`.
- In the `#[cfg(desktop)]` setup block (after the tray), spawn the watcher: `watcher::spawn(app.handle().clone());`.

**`capabilities/default.json`** — add `notification:default`.

## 6. Frontend — `frontend/lib/api.ts` + `components/SettingsView.tsx`

**`lib/api.ts`** (mirror the existing `/proactive` fetch + dismiss POST):
```ts
export async function getProactiveAlerts(): Promise<boolean> {
  try { const r = await apiFetch("/proactive"); const d = await r.json(); return d.alerts_enabled !== false; }
  catch { return true; }
}
export async function setProactiveAlerts(enabled: boolean): Promise<void> {
  try { await apiFetch("/proactive/alerts", { method: "POST", body: JSON.stringify({ enabled }) }); }
  catch { /* ignore */ }
}
```
(Match `apiFetch`'s actual call convention — verify against the existing dismiss call and add headers/JSON
exactly as that does.)

**`components/SettingsView.tsx`** — a **Tauri-only "Notifications"** section, seeded from the backend and
reconciled after a write (same pattern as the autostart toggle):
```tsx
const [alertsOn, setAlertsOn] = useState(true);
useEffect(() => { if (isTauri()) getProactiveAlerts().then(setAlertsOn); }, []);
const toggleAlerts = async () => {
  const next = !alertsOn;
  setAlertsOn(next);
  await setProactiveAlerts(next);
};
// rendered (only inside Tauri), after the Startup section:
{isDesktop && (
  <Section title="Notifications" caption="Desktop app">
    <ToggleRow
      label="Background alerts"
      desc="Toast me when something slips (an approaching meeting, an unkept commitment) while Zenith is hidden in the tray."
      on={alertsOn}
      onChange={toggleAlerts}
    />
  </Section>
)}
```

## 7. Testing & verification

- **Backend (pytest — testable):** `get_alerts_enabled` defaults True; `set_alerts_enabled(False)` persists
  (via a monkeypatched `_STORE` tmp path, as the existing proactivity tests do); `set` survives a `dismiss`
  (state co-persistence); `GET /proactive` includes `alerts_enabled`; `POST /proactive/alerts {enabled:false}`
  → subsequent `GET` reports `false`.
- **Rust:** cargo test for `backend::api_token()` parsing a temp `.env` (env-set wins; `.env` fallback; none).
  `cargo build` compiles the watcher + plugins.
- **Frontend:** `tsc --noEmit` + `next build`.
- **Owner acceptance — MUST use the BUILT app** (`npm run tauri build`), NOT `tauri dev`: Windows toasts
  only fire for an installed app (dev shows the PowerShell name or nothing). Steps: put a calendar event
  ~30 min out (or a commitment line in today's `daily/<today>.md`), hide Zenith to the tray, wait ≤2 min →
  a **"Zenith · …" Windows toast** appears once. Open the HUD → the same nudge is a card (no duplicate toast
  while focused). Settings → **Notifications → Background alerts OFF** → no more toasts.

## 8. Out of scope (v1) / future

- **Toast click → open the specific nudge** — Tauri's notification action support is limited; v1 click just
  activates the app. The nudge is still on the HUD when opened.
- **Configurable interval** — 120s constant (could become an env var later).
- **Persistent seen-set** — in-memory; an app restart may re-toast still-open nudges (acceptable; restarts
  are rare for a daemon).
- **Notifications for inbound triage** — triage is pull-only by design (attacker-controlled content); it is
  deliberately never a nudge/toast. Unchanged.

## 9. Files

**New:** `frontend/src-tauri/src/watcher.rs`, this spec, the implementation plan.
**Modified:** `backend/proactivity_service.py` (alerts flag), `backend/main.py` (`/proactive` field +
`/proactive/alerts`), `backend/test_proactivity.py` (+ a route test file if that's where routes are tested),
`frontend/src-tauri/Cargo.toml` (notification + ureq deps), `frontend/src-tauri/src/lib.rs` (`mod watcher`,
plugin register, spawn), `frontend/src-tauri/src/backend.rs` (`api_token`), `frontend/src-tauri/capabilities/default.json`
(`notification:default`), `frontend/lib/api.ts` (alerts get/set), `frontend/components/SettingsView.tsx`
(Notifications section), `SETUP-TAURI.md`, `TODO.md`, `CLAUDE.md`.
**Reuses:** the existing `/proactive` + `proactivity_service` (nudges, extraction, cache, ledger), the
backend-dir resolution, the Settings `Section`/`ToggleRow`, `apiFetch`, `withGlobalTauri`. No frontend npm
dependency; no change to the chat loop, confirm gate, or the proactivity invariants.
