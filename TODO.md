# Zenith — TODO

**Status (2026-07-16):** **Phase 1 is essentially COMPLETE and running as an installed Windows desktop app.**
All of **M1–M7** + web search + read-a-URL + the full **Tauri cluster** (global hotkey · tray + close-to-tray ·
autostart · background watcher/notifications) are shipped to `origin/main`. Backend moved to **:8010** (was
colliding with the owner's *Budgetting* project on :8000). App **built (MSI + NSIS), installed, and working**.
Owner is **soak-testing it in daily use.**

## THE PLAN (owner's call 2026-07-16)
1. **Use it as the daily driver for ~a week** — let real friction surface priorities.
2. **Then iterate** — start with **TTS streaming (+ app-icon swap)**, then pull from the ROADMAP below.

**Priority legend:** ★★★ = reach for first · ★★ = strong · ★ = nice-to-have.

---

## PHASE 1 — what's left (committed)

### Next up (right after the soak week)
- **TTS streaming ★★★** — Kokoro generates faster than real-time; stream the *first* audio chunk while the
  rest synthesizes so even long replies start speaking in ~1s. Main remaining voice-latency lever.
  Self-contained: `backend/tts_service.py` + `/speak` + frontend audio playback.
- **App-icon swap ★★** — one square PNG (≥1024, transparent) → `cd frontend && npm run tauri icon <png>`
  (regenerates .ico/.icns/all PNGs + the tray icon) → `npm run tauri build` → reinstall. (Windows caches
  icons → sign-out/in to refresh.) Bundle with the TTS build, per owner.

### Blocked
- **Wake word "Zenith" 🚧** — the last Phase-1 feature. Spec + `SETUP-WAKEWORD.md` on `feat/wake-word`
  (pushed; no code). Locked: **Porcupine Web** (WASM in-webview) + energy-silence endpointing + on-by-default
  real-mute + barge-in; plan the `"Hey Zenith"` fallback. **BLOCKER:** Picovoice signup wants a work-domain
  email the owner lacks. **Resume when:** owner gets a domain email (Cloudflare/Zoho forward on
  shapeodyssey.com) OR pivot to **openWakeWord** (no account/email; spec §11). Ctrl+Alt+Z is the stand-in.

---

## ROADMAP — post-soak build candidates (by category)
Not committed yet — pick based on real friction after the soak week. Overall theme: today Zenith is mostly
**reactive** (ask → it does). These add the other axes of a complete personal-COO tool: **act on a schedule**,
**understand more input**, **produce finished deliverables**, **remember deeply**.

### A. Act on a schedule / proactively — *the biggest completeness gap*  ★★★
Turn Zenith from "answers when asked" into "runs your day." The tray + notification infra already exists.
- **Scheduler & routines ★★★** — "brief me every morning at 9", "every Friday draft the weekly client
  report", recurring "remind me at 3pm to call Rahul". A lightweight backend scheduler runs a prompt on a
  cadence and surfaces it (spoken / toast). The morning briefing exists only as a button today — this
  automates it. Keep proactivity's invariants (no tools bound to auto-runs; anything that sends/creates
  still hits the confirm gate).
- **Daily focus digest ★★★** — one prioritized "here's your day" that *synthesizes existing data* —
  calendar + to-dos + waiting replies (triage) + unkept commitments. Cheap: the data's already there.
- **More proactivity gatherers / anti-nag tuning ★** — as daily use reveals gaps.

### B. Content ingestion — "attach anything → understand → act"  ★★★
One **"Attach / drop it here" surface** in the Command Center: takes a file OR a link → routes to the right
extractor → fences content as `<external-content>` → hands it to the loop → then a consistent **"extract
action items → to-dos" / "build a Copy Factory brief → draft copy"** step (the owner's *"…what can be done
from it"*).
- **PDF (+ DOCX/PPTX/XLSX/TXT/CSV) ★★★** — Claude reads it (native document blocks or `pypdf`). Contracts,
  proposals, briefs. Watch the token budget on big files.
- **Images & screenshots (Claude vision) ★★★** — describe / critique / extract. *Standout for the ads work:*
  critique a competitor's creative, read a dashboard screenshot, pull text from a photo/receipt.
- **Audio / voice-note upload → transcribe + summarize ★★** — reuses the **faster-whisper already running**.
  Client-call recordings, voice memos → notes/tasks. Nearly free.
- **YouTube + podcast / any audio-video URL ★★** — `read_youtube(url)`: transcript-first
  (`youtube-transcript-api`), **whisper fallback** (`yt-dlp` audio) when no captions.
- **Social post / thread reader ★** — X / LinkedIn / Reddit link → summarize or draft a reply in voice.
- **Instagram Reels ★** — ⚠️ no public API; scraping is ToS-risky + fragile + Reels are *visual*. **Do NOT
  build a scraper.** Realistic path: owner saves / screen-records the Reel → drops the **video / audio /
  screenshots** into the attach surface → vision + whisper analyze it. Own-Reels *metrics* via the official
  **Meta Graph API** (see E).

### C. Produce deliverables (not just draft text)  ★★
- **Generate finished files ★★** — turn Copy Factory output into a **sendable PDF/DOCX** — proposal,
  one-pager, invoice draft. Brief in → finished document out.

### D. Memory & recall  ★★
- **Semantic search over the vault + past conversations ★★** — "what did I tell Acme about pricing last
  month?" Today vault search is keyword-only; semantic recall makes it feel like it truly remembers.

### E. Integrations (each ≈ "one more tool" on the existing loop)
- **Multi-Google-account — FINISH wiring ★★** — today Zenith only acts on the **primary** account. The
  service layer is already multi-account (`google_service` fns take `email=`, per-email tokens in
  `backend/tokens/`, `list_accounts()`) and OAuth can connect several — but the **tools never pass `email`**
  (so Claude always uses account #0) and the **UI only shows `accounts[0]`**. To finish: add an optional
  `account` arg to the Gmail/Calendar tool schemas + thread it through, and let Connections/Settings
  connect/list/pick accounts. Hard part (per-account tokens) is done.
- **Google Drive / Docs ★★** — read/search/draft documents (proposals live here; Copy Factory could write
  into a Doc).
- **Google Sheets ★★** — read/update client & project trackers; pull numbers for reporting.
- **Meta / Google Ads reporting ★★** — campaign reporting is in Zenith's lane; pull ad metrics by voice.
  (Heavier API work; also serves own-Reels/IG metrics.)
- **Slack ★★** — the team's main comms channel; probably the biggest missing one.
- **SMS reminders (Twilio) ★** — a phone-side push/reminder fallback.
- **Deeper triage ★** — extend beyond Gmail (Discord / WhatsApp triage).

### F. Business-ops lite (lightweight; full versions stay Phase 2)  ★
- **Time logging ★** — "log 2 hours on Acme" → vault-backed.
- **Invoice draft ★** — assemble an invoice (the *billing/payments* side stays Phase 2).
- **Receipt capture ★** — drop a receipt photo (vision) → logged. Rides the ingestion work.

### G. Robustness  ★
- **Bundled Python ★** — ship so the app isn't tied to the dev venv (resilience if the folder moves / venv
  is rebuilt).

### H. Big swing — its own milestone
- **Discord voice** — join a call, listen, brief it back in Hindi. Doable but risky (needs a Pycord /
  `discord-ext-voice-recv` bot rewrite; batch-first; consent-on-join). Scope separately.

---

## PHASE 2 — true SaaS-only (deliberately deferred; the big pivot, not urgent)
- **Multi-user auth** (Clerk) + per-user **encrypted key storage**.
- **Razorpay billing** (₹999–2999/mo tiers).
- **Hosted backend + PWA** (the no-download path) — one codebase already serves desktop + web + PWA.
- **Full business-data dashboard** — clients / projects / invoices / time as a real DB module (the M6 vault
  + the Phase-1 business-ops-lite items are the lightweight version).
- **WhatsApp Business** (Cloud API, multi-number) — customer comms at scale.
- **Computer Use + Higgsfield** (AI image/video creative) — optional / experimental.
- **Trademark sign-off + domain lock** before any paid launch (see the naming note in `CLAUDE.md`).

---

## DON'T BUILD (saturated / non-differentiating — deliberately out of scope)
PC/system telemetry (CPU/GPU/disk/reactor/battery cosplay) · calendar auto-scheduling à la Motion ·
WhatsApp Business customer-chatbots / lead-gen · smart-home/IoT · more 3D holographic eye-candy ·
a public Instagram/social scraper.

---

## Context / reminders
- **Desktop app:** installed from `frontend/src-tauri/target/release/bundle/nsis/Zenith_..._setup.exe`.
  It spawns the backend from the **repo's `backend\.venv`** (path baked in at build) → **keep the `Zenith`
  project folder where it is** or the installed app won't find its backend.
- **Backend runs on `:8010`** (moved off 8000). If the frontend can't reach it, check `frontend/.env.local`
  has `NEXT_PUBLIC_API_URL=http://localhost:8010` (the `.env*` files are owner-edited — agent-blocked).
- **Tauri shell** in `frontend/src-tauri/` (v2, id `com.zenith.desktop`, dev port 1420). Rust host:
  `src/lib.rs` (spawn/kill · mic · single-instance · Ctrl+Alt+Z hotkey · tray · autostart),
  `src/backend.rs` (path + API-token resolution), `src/watcher.rs` (proactive notifications). Run/build +
  acceptance in `SETUP-TAURI.md`.
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
- **v3.0–v3.4 / M2 close-out:** web search + read-a-URL (Tavily); **Tauri desktop shell** + global hotkey +
  tray/autostart + background watcher/notifications. Backend port 8000→8010. Built + installed.
