# Zenith — TODO (next session)

**Status (2026-07-14):** Everything through **M7 is shipped to `origin/main`** (App Launcher,
proactivity, Gmail triage). **M2 — the Tauri desktop shell — is CODE COMPLETE and live-acceptance
PASSED**, and now **merged to `main` + pushed to `origin`** (`feat/tauri-shell`, ff-merge, 2026-07-14). **All of M1–M7 are done.**
All automated gates green: backend 260 pytest · Rust `cargo test` 4 · `tsc` clean · `next` static
export · full `cargo build`. Owner verified the desktop app by hand — window, boot health-gate,
**hold-Space voice loop (mic works in WebView2)**, VRAM freed on close, single-instance.

**We are NOT starting Phase 2.** The list below is Phase-1 only. Pick up top-down tomorrow.

---

## A. Close out M2 (Tauri shell) — ✅ DONE 2026-07-14
- [x] **M2-complete doc commit** on `feat/tauri-shell` — flipped Milestone 2 → done in `CLAUDE.md`
      + PRD sync line (v2.8). (Plan Task 8 Step 4; was held on purpose until acceptance passed.)
- [x] **Merge** `feat/tauri-shell` → `main` (fast-forward).
- [x] **Push** `main` to `origin`.

## B. Tauri shell — polish (optional, low effort)
- [ ] **Boot warmup feedback** — in Tauri the boot log's `"starting"` line only types once `/health`
      resolves, so the 30–45s backend warmup looks quiet. Show a spinner / live "STARTING BACKEND…"
      during the wait. (Reveal gating itself is correct.)
- [ ] **Confirm the production bundle** — `npm run tauri build` → installer under
      `target/release/bundle/`; check the installed app behaves like `tauri dev` (only if not
      already covered in acceptance).

## C. Next Phase-1 features — now UNBLOCKED by the desktop shell (the main build work)
- [ ] **Wake word "Zenith"** — always-listening activation (Porcupine / openWakeWord trained on
      "Zenith"; `"Hey Zenith"` fallback). The marquee Phase-1 capability — was gated on having a
      desktop host, which now exists. **Highest value; likely the next milestone.**
- [ ] **Background proactivity watcher + native notifications** — proactivity is currently on-demand
      (60s poll + window focus) because the browser had no push channel. Tauri has system
      notifications → a real background watcher that toasts when something slips. (Keep the two
      proactivity invariants: extraction binds no tools; a nudge action is an inert prefill.)
- [ ] **System tray** — minimize-to-tray, keep running in the background, quick actions. Pairs with
      the wake word + proactivity watcher (an assistant that's "always there").
- [ ] **Global push-to-talk hotkey** — trigger voice from anywhere, not just when the window is
      focused.
- [ ] **Autostart on login** — Zenith launches with Windows.

## D. Other Phase-1 leftovers (not Tauri)
- [x] **Triage Part-3.1 — Claude-classification pass ✅ (SHIPPED 2026-07-14, `feat/triage-noise-classifier`).**
      COO-aware `triage_classifier.py` re-buckets residual transactional noise (bank alerts / receipts
      with no `List-Unsubscribe`, "thanks"/FYI) into a recoverable "no reply needed" drawer — free
      `Auto-Submitted`/`Feedback-ID` pre-pass + a batched, no-tools, cached Claude call; +19 tests.
      Still open from M7: **Discord/WhatsApp triage, multi-account.**
- [ ] **Bundled Python** — ship so a fresh machine runs the shell without the dev venv (distribution
      readiness; only matters once it leaves the owner's machine).

---

## Older open backlog (still valid — carried forward)

### TTS latency — pre-fetch / stream  ⬜ OPEN
Kokoro generates faster than realtime, so streaming the first chunk while the rest synthesizes would
make even long replies start in ~1s. Now the main voice-latency lever (GPU already killed the big lag).

### Discord voice — join a call, listen, brief it (Hindi)  ⬜ FUTURE (to discuss/scope)
Doable but milestone-sized. Per-user audio streams give speaker labels for free; we already have
faster-whisper (Hindi STT) + Claude (brief). Catches: `discord.py` can't RECEIVE voice → need Pycord
or `discord-ext-voice-recv` (possible bot rewrite, biggest risk); Hindi wants a bigger Whisper model
on the GPU → run transcription as a batch job after the call; batch-first (live is much harder);
consent (announce on join). Open Qs: lib choice · batch vs live · GPU/model plan · where the brief
lands (DM / channel / Activity Log / vault note) · Hindi output format. Likely a dedicated milestone.

---

## Context / reminders
- **Tauri shell** lives in `frontend/src-tauri/` (Tauri v2, id `com.zenith.desktop`, dev port 1420).
  Backend is Option B: auto-spawned venv uvicorn, killed on exit. Setup + acceptance checklist in
  `SETUP-TAURI.md`. Rust host: `src/lib.rs` (spawn/kill + mic grant + single-instance),
  `src/backend.rs` (path resolution + spawn, 4 cargo tests).
- **Don't `npm run build` while `npm run dev` is live** (desyncs `.next`).
- STT: `backend/stt_service.py`; TTS: `backend/tts_service.py`; routes: `backend/main.py`; env:
  `backend/.env` / `.env.example`.

---

## Shipped history (condensed — full detail in CLAUDE.md / PRD)
- **v1.5–v1.8 (voice + orb + skins):** English-default STT on GPU + dormant Hinglish; 2D-canvas HUD
  orb (per-skin sphere/mesh/nebula, R3F removed); Command Center minimize/restore; Kokoro local TTS
  default (edge-tts fallback); three skins (Arc/Ghost/Amethyst).
- **M3–M5:** Google (Calendar/Gmail/weather/briefing), Discord + Telegram, security hardening +
  usage/cost dashboard + Settings.
- **M6:** memory vault + Copy Factory + to-dos. **Notion** (18 tools). **App Launcher.**
- **M7:** proactivity nudges + Gmail message triage.
