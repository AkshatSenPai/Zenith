# Background Watcher + Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Rust-host background thread polls the existing `/proactive` and fires native Windows toasts for new nudges when alerts are on and the HUD isn't focused, with a default-on "Background alerts" mute toggle whose state lives in the backend.

**Architecture:** Backend gains a persisted `alerts_enabled` flag on the existing proactivity state, surfaced by `GET /proactive` and set by `POST /proactive/alerts`. The Tauri host adds `tauri-plugin-notification` + a `watcher.rs` thread that polls `/proactive` (`ureq`), dedups by nudge id, and toasts new ones when `alerts_enabled && !window.is_focused()`. A Tauri-only Settings toggle drives the backend flag. Zero change to nudge computation or the proactivity invariants. Spec: `docs/superpowers/specs/2026-07-15-background-watcher-design.md`.

**Tech Stack:** Python FastAPI + pytest; Tauri v2 Rust (`tauri-plugin-notification` "2", `ureq` "2"); Next.js/React.

## Global Constraints

- **Invariants (do NOT touch):** the commitment-extraction call binds no tools; a nudge action is an inert prefill. This feature only *reads* `/proactive` and shows a toast.
- Backend venv is Python 3.11: `cd backend && ./.venv/Scripts/python.exe -m pytest <file> -q`.
- Tauri gates: `cargo build` + `cargo test` in `frontend/src-tauri`. Frontend gates: `tsc --noEmit` + `next build`.
- **No new npm dependency.** `apiFetch(path, init)` sets the token header; JSON POST uses `headers: { "Content-Type": "application/json" }, body: JSON.stringify(...)` (mirror `/proactive/dismiss` in `page.tsx`).
- Watcher: poll `http://127.0.0.1:8000/proactive` every 120s after a 60s warmup; send `X-Zenith-Token` only if configured; toast only when `alerts_enabled && !focused`; dedup via an in-memory `HashSet` of nudge ids (set `seen = current ids` every tick).
- **Windows toast caveat:** notifications only fire in the BUILT app (`npm run tauri build`), not `tauri dev` — this shapes owner acceptance, not the automated gates.

---

### Task 1: Backend — `alerts_enabled` flag + routes (TDD)

**Files:**
- Modify: `backend/proactivity_service.py` (blank state + `_load` + `get/set_alerts_enabled`)
- Modify: `backend/main.py` (`/proactive` field + `AlertsRequest` + `POST /proactive/alerts`)
- Test: `backend/test_proactivity.py` (append)

**Interfaces:**
- Produces: `proactivity_service.get_alerts_enabled() -> bool` (default True), `set_alerts_enabled(bool)`; `GET /proactive` → `{nudges, alerts_enabled}`; `POST /proactive/alerts {enabled}` → sets it.

- [ ] **Step 1: Write failing tests**

Append to `backend/test_proactivity.py` (mirror the existing `_STORE` monkeypatch/tmp pattern used by the dismiss/snooze tests in that file — point `proactivity_service._STORE` at a `tmp_path` file):

```python
def test_alerts_enabled_defaults_true(tmp_path, monkeypatch):
    monkeypatch.setattr(proactivity_service, "_STORE", tmp_path / "proactive.json")
    assert proactivity_service.get_alerts_enabled() is True


def test_set_alerts_enabled_persists(tmp_path, monkeypatch):
    monkeypatch.setattr(proactivity_service, "_STORE", tmp_path / "proactive.json")
    proactivity_service.set_alerts_enabled(False)
    assert proactivity_service.get_alerts_enabled() is False
    proactivity_service.set_alerts_enabled(True)
    assert proactivity_service.get_alerts_enabled() is True


def test_alerts_flag_survives_dismiss(tmp_path, monkeypatch):
    # dismiss() does _load()->mutate->_save(); the alerts flag must be preserved through it.
    monkeypatch.setattr(proactivity_service, "_STORE", tmp_path / "proactive.json")
    proactivity_service.set_alerts_enabled(False)
    proactivity_service.dismiss("commitment:x:abc123")
    assert proactivity_service.get_alerts_enabled() is False
```

(Match the import name the file already uses — likely `import proactivity_service`. If the file lacks a `tmp_path`+`_STORE` pattern, copy it from the nearest existing persistence test in the same file.)

- [ ] **Step 2: Run — expect fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: FAIL — `AttributeError: module 'proactivity_service' has no attribute 'get_alerts_enabled'`.

- [ ] **Step 3: Implement in `proactivity_service.py`**

Change `_blank_state` to include the flag, add the merge line in `_load`, and add the two accessors:
```python
def _blank_state() -> dict:
    return {"ledger": {"dismissed": {}, "snoozed": {}},
            "cache": {"signature": "", "commitments": []},
            "alerts_enabled": True}
```
In `_load`, inside the `if isinstance(data, dict):` block (after the cache merge), add:
```python
        base["alerts_enabled"] = bool(data.get("alerts_enabled", True))
```
Add near the cache accessors:
```python
def get_alerts_enabled() -> bool:
    return bool(_load().get("alerts_enabled", True))


def set_alerts_enabled(on: bool) -> None:
    st = _load()
    st["alerts_enabled"] = bool(on)
    _save(st)
```

- [ ] **Step 4: Run — expect pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: PASS.

- [ ] **Step 5: Wire the routes in `main.py`**

Add the request model next to `DismissRequest` (~line 272):
```python
class AlertsRequest(BaseModel):
    enabled: bool
```
Change the `/proactive` handler to also return the flag:
```python
@app.get("/proactive")
def proactive() -> dict:
    try:
        return {"nudges": proactivity_service.get_nudges(),
                "alerts_enabled": proactivity_service.get_alerts_enabled()}
    except Exception as exc:  # noqa: BLE001 — a poll must never error the HUD
        print(f"[proactive] endpoint error: {exc}", flush=True)
        return {"nudges": [], "alerts_enabled": True}
```
Add the setter route after `/proactive/dismiss`:
```python
@app.post("/proactive/alerts")
def proactive_alerts(req: AlertsRequest) -> dict:
    proactivity_service.set_alerts_enabled(req.enabled)
    return {"ok": True, "alerts_enabled": proactivity_service.get_alerts_enabled()}
```

- [ ] **Step 6: Route tests**

Add tests where the other route tests live (find the file that uses FastAPI `TestClient` against `main.app` — e.g. `test_confirm_flow.py`/`test_tool_router.py`; if `/proactive` already has a route test, extend it). Point `proactivity_service._STORE` at a tmp path via monkeypatch, then:
```python
def test_proactive_reports_alerts_flag(client, tmp_path, monkeypatch):
    monkeypatch.setattr(proactivity_service, "_STORE", tmp_path / "p.json")
    r = client.get("/proactive")
    assert r.status_code == 200
    assert r.json()["alerts_enabled"] is True


def test_proactive_alerts_toggle(client, tmp_path, monkeypatch):
    monkeypatch.setattr(proactivity_service, "_STORE", tmp_path / "p.json")
    assert client.post("/proactive/alerts", json={"enabled": False}).status_code == 200
    assert client.get("/proactive").json()["alerts_enabled"] is False
```
(Use the same `client` fixture / construction the neighboring route tests use, incl. any auth header. If they build `TestClient(app)` inline, do the same.)

- [ ] **Step 7: Full fast backend suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: PASS (prior green + the new tests).

- [ ] **Step 8: Commit**

```bash
git add backend/proactivity_service.py backend/main.py backend/test_proactivity.py backend/<route_test_file>.py
git commit -m "feat(watcher): backend alerts_enabled flag + /proactive/alerts route + tests"
```

---

### Task 2: Rust host — notification plugin + watcher thread

**Files:**
- Modify: `frontend/src-tauri/Cargo.toml` (notification + ureq)
- Modify: `frontend/src-tauri/src/backend.rs` (`backend_dir()` helper + `api_token()`)
- Create: `frontend/src-tauri/src/watcher.rs`
- Modify: `frontend/src-tauri/src/lib.rs` (`mod watcher`, plugin register, spawn)
- Modify: `frontend/src-tauri/capabilities/default.json` (`notification:default`)

**Interfaces:**
- Consumes: `GET /proactive` (Task 1). Produces: native toasts for new nudges; `backend::api_token()`.

- [ ] **Step 1: Deps in `Cargo.toml`**

Add to the desktop-target dependency block (with global-shortcut + autostart):
```toml
tauri-plugin-notification = "2"
ureq = { version = "2", default-features = false }
```

- [ ] **Step 2: `backend_dir()` + `api_token()` in `backend.rs`**

Add a dir helper (reuse it in `spawn_backend` too, replacing the inline `resolve_backend_dir_from(...)` there) and the token resolver:
```rust
/// The resolved backend directory (ZENITH_BACKEND_DIR or <manifest>/../../backend).
pub fn backend_dir() -> PathBuf {
    resolve_backend_dir_from(
        std::env::var("ZENITH_BACKEND_DIR").ok(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
}

/// API token for the watcher: env ZENITH_API_TOKEN first, else parsed from <backend_dir>/.env.
/// None → send no header (backend is fail-open when the token is unset).
pub fn api_token_from(env: Option<String>, backend_dir: &Path) -> Option<String> {
    if let Some(t) = env {
        let t = t.trim().to_string();
        if !t.is_empty() { return Some(t); }
    }
    let text = std::fs::read_to_string(backend_dir.join(".env")).ok()?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("ZENITH_API_TOKEN=") {
            let v = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !v.is_empty() { return Some(v); }
        }
    }
    None
}

pub fn api_token() -> Option<String> {
    api_token_from(std::env::var("ZENITH_API_TOKEN").ok(), &backend_dir())
}
```
In `spawn_backend`, replace the inline `let backend_dir = resolve_backend_dir_from(...);` with `let backend_dir = backend_dir();`.

Add cargo tests (in the existing `mod tests`):
```rust
    #[test]
    fn api_token_prefers_env() {
        let dir = Path::new("C:/nonexistent");
        assert_eq!(api_token_from(Some("  tok  ".into()), dir), Some("tok".into()));
    }

    #[test]
    fn api_token_reads_dotenv() {
        let d = std::env::temp_dir().join(format!("ztok{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(".env"), "FOO=1\nZENITH_API_TOKEN=\"abc\"\n").unwrap();
        assert_eq!(api_token_from(None, &d), Some("abc".into()));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn api_token_none_when_absent() {
        assert_eq!(api_token_from(None, Path::new("C:/nonexistent")), None);
    }
```

- [ ] **Step 3: Create `frontend/src-tauri/src/watcher.rs`**

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
struct Nudge {
    id: String,
    title: String,
    body: String,
}

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
                let focused = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false);
                if alerts_enabled && !focused {
                    for n in &nudges {
                        if !seen.contains(&n.id) {
                            let _ = app
                                .notification()
                                .builder()
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
    if let Some(t) = token {
        req = req.set("X-Zenith-Token", t);
    }
    let body = req.call().ok()?.into_string().ok()?;
    let val: serde_json::Value = serde_json::from_str(&body).ok()?;
    let alerts = val.get("alerts_enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let nudges: Vec<Nudge> = serde_json::from_value(val.get("nudges")?.clone()).ok()?;
    Some((nudges, alerts))
}
```

- [ ] **Step 4: Wire into `lib.rs`**

At the top, add `mod watcher;` (next to `mod backend;`). Register the plugin in the builder chain right after the single-instance plugin:
```rust
    .plugin(tauri_plugin_notification::init())
```
In the `#[cfg(desktop)]` setup block, AFTER the tray `.build(app)?;` (and the `--hidden` check), add:
```rust
        // Background proactivity watcher — toasts new nudges while hidden to the tray.
        watcher::spawn(app.handle().clone());
```

- [ ] **Step 5: Grant the notification permission**

In `frontend/src-tauri/capabilities/default.json`, add `"notification:default"` to the `permissions` array.

- [ ] **Step 6: Build**

Run: `cd frontend/src-tauri && cargo build`
Expected: compiles. If `ureq` `AgentBuilder`/`timeout_*` or `into_string` don't resolve, it means `default-features = false` dropped a needed feature — add `features = ["gzip"]` is NOT needed; `into_string` is core. If `timeout_connect` is missing, use `.timeout(Duration::from_secs(10))` instead. If `is_focused()` is missing, it lives on `WebviewWindow` (it does in 2.11).

- [ ] **Step 7: Rust tests**

Run: `cd frontend/src-tauri && cargo test`
Expected: the existing 4 + the 3 new `api_token*` tests pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/Cargo.lock frontend/src-tauri/src/backend.rs frontend/src-tauri/src/watcher.rs frontend/src-tauri/src/lib.rs frontend/src-tauri/capabilities/default.json
git commit -m "feat(watcher): notification plugin + background /proactive watcher thread"
```

---

### Task 3: Frontend — alerts API + Settings toggle

**Files:**
- Modify: `frontend/lib/api.ts` (`getProactiveAlerts`, `setProactiveAlerts`)
- Modify: `frontend/components/SettingsView.tsx` (Notifications section, Tauri-only)

**Interfaces:**
- Consumes: `GET /proactive` (`alerts_enabled`) + `POST /proactive/alerts` (Task 1). Produces: a working desktop-only "Background alerts" toggle.

- [ ] **Step 1: Add helpers to `lib/api.ts`**

Append (mirrors the existing `/proactive` GET + `/proactive/dismiss` POST convention):
```ts
export async function getProactiveAlerts(): Promise<boolean> {
  try {
    const r = await apiFetch("/proactive");
    const d = await r.json();
    return d.alerts_enabled !== false;
  } catch {
    return true;
  }
}

export async function setProactiveAlerts(enabled: boolean): Promise<void> {
  try {
    await apiFetch("/proactive/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Import in `SettingsView.tsx`**

Extend the existing `../lib/api` import (or add one) with `getProactiveAlerts, setProactiveAlerts`. `isTauri` is already imported (Task from tray feature) — reuse it; if not present, add it from `../lib/tauri`.

- [ ] **Step 3: State + handler (reuse the `isDesktop` state added by the autostart feature)**

Near the autostart state, add:
```tsx
  const [alertsOn, setAlertsOn] = useState(true);
  useEffect(() => { if (isTauri()) getProactiveAlerts().then(setAlertsOn); }, []);
  const toggleAlerts = async () => {
    const next = !alertsOn;
    setAlertsOn(next);
    await setProactiveAlerts(next);
  };
```

- [ ] **Step 4: Render the Notifications section**

After the `Startup` section block, add:
```tsx
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

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Static export**

Run: `cd frontend && npm run build`
Expected: `next build` completes. (Not while `npm run dev` is live.)

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api.ts frontend/components/SettingsView.tsx
git commit -m "feat(watcher): Settings 'Background alerts' toggle (backend-backed)"
```

---

### Task 4: Docs

**Files:** `SETUP-TAURI.md`, `TODO.md`, `CLAUDE.md`

- [ ] **Step 1: SETUP-TAURI acceptance** — add a bullet: BUILT app only (dev toasts don't work on Windows); a meeting ~30 min out or a commitment in today's daily note → hide to tray → within ~2 min a "Zenith · …" toast; open HUD → same nudge is a card, no dup toast; Settings → Notifications → Background alerts OFF → silence. Use spec §7 wording.
- [ ] **Step 2: TODO.md** — flip the "Background proactivity watcher + native notifications" line (section C) to shipped; note the mute toggle, the Windows built-app caveat, spec+plan paths, owner-acceptance-pending.
- [ ] **Step 3: CLAUDE.md footer** — prepend a `v3.4 (background proactivity watcher + notifications — ...)` entry in house style: Rust-host thread polls /proactive (ureq, token from env/.env), toasts new nudges only when alerts_enabled && !focused, in-memory dedup; backend alerts_enabled flag on .zenith/proactive.json + /proactive/alerts; default-on Settings toggle; invariants preserved; Windows built-app caveat; gates (backend pytest + cargo build/test + tsc + next export; owner acceptance pending). Note this **completes the Tauri-unblocked cluster** — only the wake word (blocked on Picovoice) remains to finish Phase 1.
- [ ] **Step 4: Commit + push**

```bash
git add SETUP-TAURI.md TODO.md CLAUDE.md
git commit -m "docs(watcher): SETUP-TAURI acceptance + TODO + CLAUDE.md v3.4"
git push origin main
```

---

## Self-Review

**Spec coverage:** alerts flag + accessors (T1 S3); routes (T1 S5); backend tests (T1 S1,S6); ureq+notification deps (T2 S1); api_token env/.env (T2 S2 + tests); watcher thread poll/dedup/focus/notify (T2 S3); lib.rs wiring + plugin + capability (T2 S4-5); frontend helpers (T3 S1); Tauri-only toggle reusing `isDesktop` (T3 S2-4); all gates; docs incl. Windows caveat (T4). All spec §4-7 mapped.

**Placeholders:** none — every code step is concrete. The "find the route-test file / match the client fixture" and "match apiFetch convention" notes are verify-against-existing instructions with concrete defaults, not TODOs.

**Type/name consistency:** `alerts_enabled` identical across `proactivity_service`, `/proactive` JSON, the Rust `poll` parse, and the frontend `d.alerts_enabled`. `get/set_alerts_enabled` (py), `api_token`/`api_token_from`/`backend_dir` (rust), `getProactiveAlerts`/`setProactiveAlerts` (ts) consistent between definition and use. Nudge struct fields `id/title/body` are a subset of the `/proactive` nudge shape (serde ignores the rest). `isDesktop`/`alertsOn`/`toggleAlerts` reuse/extend the autostart-feature state in SettingsView.
