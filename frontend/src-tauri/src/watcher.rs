//! Background proactivity watcher: polls the backend's /proactive and fires native OS toasts for new
//! nudges while Zenith is hidden in the tray. It only *surfaces* nudges the backend already produced —
//! it computes nothing and acts on nothing (the proactivity invariants live in the backend).

use std::collections::HashSet;
use std::thread;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

const POLL_URL: &str = "http://127.0.0.1:8000/proactive";
const INITIAL_DELAY_SECS: u64 = 60; // let the backend finish its GPU warmup first
const INTERVAL_SECS: u64 = 120;

#[derive(serde::Deserialize)]
struct Nudge {
    id: String,
    title: String,
    body: String,
}

/// Spawn the watcher thread. Toasts a new nudge once, only when background alerts are on AND the HUD
/// window isn't focused (if you're looking at it, the nudge is already a card on screen).
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
                // Mark every current id seen (dedup) and drop ids that are gone (so a genuinely
                // re-surfaced nudge can toast again). Done even when muted/focused, so unmuting or
                // looking away doesn't dump a backlog.
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
    let alerts = val
        .get("alerts_enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let nudges: Vec<Nudge> = serde_json::from_value(val.get("nudges")?.clone()).ok()?;
    Some((nudges, alerts))
}
