# Zenith — TODO

**Status (2026-07-16):** **Phase 1 is essentially COMPLETE and running as an installed Windows desktop app.**
- All of **M1–M7** shipped to `origin/main`; **web search + read-a-URL** (Tavily) shipped; the full
  **Tauri-unblocked cluster** shipped — global hotkey (Ctrl+Alt+Z) · system tray + close-to-tray ·
  autostart · background watcher + native notifications.
- Backend **port moved 8000 → 8010** (it was colliding with the owner's *Budgetting* project on :8000).
  App **rebuilt, installed (MSI + NSIS), and running/working**; the `tauri build` production bundle is
  confirmed.
- Owner is now **soak-testing it in daily use.**

## THE PLAN (owner's call 2026-07-16)
1. **Use it as the daily driver for ~a week** — let real friction surface the next priorities.
2. **Then iterate** — start with **TTS streaming (+ the app-icon swap)**, then revisit the backlog below.

---

## PHASE 1 — what's left

### 1. TTS streaming  +  app-icon swap  ⬜ NEXT (do together, after the soak week)
- **TTS streaming** — Kokoro generates faster than real-time; stream the *first* audio chunk while the
  rest synthesizes so even long replies start speaking in ~1s. The main remaining voice-latency lever
  (the GPU already killed the big lag). Self-contained: `backend/tts_service.py` + `/speak` + the
  frontend audio playback.
- **App icon** — replace the placeholder: one square PNG (≥1024×1024, transparent bg) →
  `cd frontend && npm run tauri icon <path.png>` (regenerates .ico/.icns/all PNGs **and** the tray icon)
  → `npm run tauri build` → reinstall. (Windows caches icons → sign-out/in to force the refresh.)
  Bundled with the TTS-streaming build, per owner.

### 2. Wake word "Zenith"  🚧 DESIGNED, BLOCKED — the last Phase-1 feature
- Full design spec + `SETUP-WAKEWORD.md` on branch `feat/wake-word` (pushed to origin; **no code yet**).
  Locked: **Porcupine Web** (WASM in-webview) + energy-silence endpointing + on-by-default real-mute +
  barge-in; zero backend voice-path changes. Plan the **`"Hey Zenith"`** fallback from the start.
- **BLOCKER:** Picovoice signup rejects gmail and wants a work-domain email the owner doesn't have yet.
- **Resume when:** owner gets a domain email (free Cloudflare/Zoho forward on shapeodyssey.com) **OR** we
  pivot the engine to **openWakeWord** (Apache-2.0 — no account/key/email; spec §11). The global
  **Ctrl+Alt+Z** hotkey is the stand-in until then.

---

## BACKLOG — candidate improvements (revisit after the soak week; NOT committed yet)
"One more tool" / polish ideas that fit the daily-driver use. Pick based on real friction, not up front.

### ★ Owner-requested while using the app (2026-07-16) — top of the backlog
- **PDF input** — a way to hand Zenith a PDF (upload/drag-drop button in the Command Center) so it can
  read it — summarize, extract a brief, answer questions, feed the Copy Factory. Claude accepts PDFs
  natively (document blocks) or we extract text (`pypdf`); either way fence the content as
  `<external-content>` and watch the token budget. High fit for the agency (contracts/proposals/briefs).
- **YouTube (and other video) understanding** — paste a YouTube URL → a `read_youtube(url)` tool that
  pulls the transcript and lets Claude summarize / pull action items. **Transcript-first** via
  `youtube-transcript-api` (no download, fast, free); **fallback** = `yt-dlp` audio → the **faster-whisper
  we already run** when there are no captions. Same "read external content" family as web_search/read_url;
  fenced as untrusted.
- **Multi-Google-account — FINISH wiring it (foundation already exists).** Today Zenith only acts on the
  **primary** Google account. The service layer is already multi-account (every `google_service` fn takes
  `email=`, per-email tokens in `backend/tokens/`, `list_accounts()`), and OAuth can connect several — but
  the **tools don't expose an account param** (`_get_emails`/`_send_email`/`_get_events` never pass `email`,
  so Claude always uses account #0) and the **UI only surfaces `accounts[0]`**. To make it real: add an
  optional `account` arg to the Gmail/Calendar tool schemas + thread it through, and let the Connections/
  Settings UI connect/list/pick accounts. Medium effort; the hard part (per-account tokens) is done.
  (This also covers the "multi-account Gmail" deferred from triage.)

### Other ideas
- **Google Drive / Docs** — read/search/draft documents (proposals, agreements; the Copy Factory could
  write straight into a Doc). Highest fit for the agency work.
- **Google Sheets** — read/update client & project trackers; pull numbers for reporting.
- **Meta / Google Ads reporting** — campaign reporting is squarely in Zenith's lane; pull ad metrics by
  voice. (Heavier API work.)
- **Discord voice** — join a call, listen, brief it back in Hindi. Milestone-sized + risky (needs a
  Pycord / `discord-ext-voice-recv` bot rewrite; batch-first, consent-on-join). Its own project.
- **Deeper triage** — extend beyond Gmail (Discord/WhatsApp triage). (Multi-account Gmail is its own
  item above.)
- **Bundled Python** — ship so the app isn't tied to the dev venv (resilience even on this machine if the
  folder moves or the venv is rebuilt).
- **More proactivity gatherers / anti-nag tuning** — as daily use reveals gaps.

---

## PHASE 2 — true SaaS-only (deliberately deferred; the big pivot, not urgent)
- **Multi-user auth** (Clerk) + per-user **encrypted key storage**.
- **Razorpay billing** (₹999–2999/mo tiers).
- **Hosted backend + PWA** (the no-download path) — one codebase already serves desktop + web + PWA.
- **Full business-data dashboard** — clients / projects / invoices / time as a real DB module (the M6
  vault is the lightweight version).
- **WhatsApp Business** (Cloud API, multi-number) — customer comms at scale.
- **Computer Use + Higgsfield** — optional / experimental.
- **Trademark sign-off + domain lock** before any paid launch (see the naming note in `CLAUDE.md`).

---

## DON'T BUILD (saturated / non-differentiating — deliberately out of scope)
PC/system telemetry (CPU/GPU/disk/reactor/battery cosplay) · calendar auto-scheduling à la Motion ·
WhatsApp Business customer-chatbots / lead-gen · smart-home/IoT · more 3D holographic eye-candy.

---

## Context / reminders
- **Desktop app:** installed from `frontend/src-tauri/target/release/bundle/nsis/Zenith_..._setup.exe`.
  It spawns the backend from the **repo's `backend\.venv`** (path baked in at build) → **keep the
  `Zenith` project folder where it is** or the installed app won't find its backend.
- **Backend runs on `:8010`** (moved off 8000). If the frontend ever can't reach it, check
  `frontend/.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:8010` (the `.env*` files are
  owner-edited — agent-blocked).
- **Tauri shell** in `frontend/src-tauri/` (v2, id `com.zenith.desktop`, dev port 1420). Rust host:
  `src/lib.rs` (backend spawn/kill · mic grant · single-instance · Ctrl+Alt+Z hotkey · tray · autostart),
  `src/backend.rs` (path + API-token resolution), `src/watcher.rs` (proactive notifications). Run/build +
  acceptance checklist in `SETUP-TAURI.md`.
- **Windows toasts only fire in the BUILT/installed app**, not `tauri dev`.
- **Don't `npm run build` while `npm run dev` is live** (desyncs `.next`).
- STT `backend/stt_service.py` · TTS `backend/tts_service.py` · routes `backend/main.py`.

---

## Shipped history (condensed — full detail in CLAUDE.md / PRD)
- **v1.5–v1.8:** English-default STT on GPU + dormant Hinglish; 2D-canvas HUD orb (per-skin
  sphere/mesh/nebula); Kokoro local TTS (edge-tts fallback); three skins (Arc/Ghost/Amethyst).
- **M3–M5:** Google (Calendar/Gmail/weather/briefing); Discord + Telegram; security hardening +
  usage/cost dashboard + Settings.
- **M6:** memory vault + Copy Factory + to-dos. **Notion** (18 tools). **App Launcher.**
- **M7:** proactivity nudges + Gmail message triage (+ Part-3.1 noise classifier).
- **v3.0–v3.4 / M2 close-out:** web search + read-a-URL (Tavily); **Tauri desktop shell** + global
  hotkey + tray/autostart + background watcher/notifications. Backend port 8000→8010. Built + installed.
