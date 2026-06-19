# ZENITH — Project Context for Claude Sessions
## Always read this file before starting any work

---

## WHAT IS THIS PROJECT
Full-stack personal AI assistant.
- Product name: **Zenith**
- Wake word: **"Zenith"** (simple, one word). Phase 1 activation = push-to-talk (hold space); always-listening wake-word detection is a later add. `"Hey Zenith"` is the fallback if a single word false-triggers.
- Internal codename: JARVIS (Iron Man inspired).
- Owner: freelancer + agency owner, India.
- Phase 1: personal daily driver on desktop (current goal).
- Phase 2: SaaS for Indian freelancers @ ₹999–2999/month.

Full details in JARVIS_PRD.md.

**Naming note:** "Zenith" is also used by major brands (LG's Zenith Electronics, Zenith watches/LVMH) and Indian software cos (Zenith Software, Bengaluru; Zenithra Tech, Delhi). Fine for the personal Phase-1 tool. Get a trademark lawyer's sign-off before launching the paid Phase-2 product.

**Domain (still to lock):** not zenith.com (premium ~₹1 cr). Bare "zenith" is taken/premium on most TLDs → use a compound or treatment. Leading TLD: `.app` (signals "download", free forced HTTPS) or `.in` / `.co` / `.io`. Verify live on porkbun, then trademark-check before paying.

---

## TECH STACK
- Frontend: Next.js 14 + Tailwind CSS
- Desktop shell: **Tauri** (Phase 1 — lighter than Electron)
- Backend: Python FastAPI
- AI brain: Claude Sonnet 4.6 API, via **tool use (function calling)** — NOT MCP-on-everything
- Voice in (STT): **faster-whisper**, local/offline (Phase 1). Auto-detects language; Hindi is transcribed in its real words and **romanised to Latin script** (never Devanagari/Urdu). Tunable via `.env`: `WHISPER_MODEL` (default `small`), `WHISPER_DEVICE` (`cpu`/`cuda`, safe CUDA→CPU fallback), `WHISPER_COMPUTE`, `WHISPER_LANGUAGE`. Cloud option for Phase 2: Deepgram (streaming) or OpenAI transcribe
- Voice out (TTS): **edge-tts** neural voices (Microsoft, free / no key), served from the backend at `POST /speak` as MP3 the frontend plays — browser-independent. Replaced browser SpeechSynthesis (robotic in some Chromium builds, silent in others). Voice set via `ZENITH_TTS_VOICE` (default `en-IN-NeerjaNeural`). Piper (local) still an option if a fully-offline voice is needed
- Wake-word engine (later): Porcupine / openWakeWord, trained on "Zenith"
- Database: PostgreSQL
- Weather API (for morning briefing) — add a key, was missing from env
- Future: Anthropic Computer Use API, Higgsfield API

**Integrations are Claude tools** (not standalone MCP servers):
- Google Calendar + Gmail (multi-account) → direct Google API client libs
- Discord (multi-server) → discord.py, direct
- WhatsApp Personal → whatsapp-mcp bridge (the ONLY place MCP is used — no official API exists)
- WhatsApp Business (multi-number) → WhatsApp Cloud API

---

## ARCHITECTURE — how it wires
- **Claude is the brain.** FastAPI defines tools; Claude decides which to call; FastAPI executes them against the real APIs and returns results. Every new integration = one more entry in `TOOLS`. The route never changes.
- **Confirm gate:** read-only tools (read calendar, read mail) run immediately; action tools (`send_email`, `send_whatsapp`, `create_event`, `delete_*`) return a "pending action" → frontend shows a confirm card → `/chat/confirm` runs it. This is how "confirm before sending/creating" is enforced.
- **Voice round-trip:** mic (MediaRecorder, hold space) → `POST /transcribe` (faster-whisper, romanised Hinglish) → `POST /chat` (Claude + last-20 history + rate limit + Hinglish prompt + tools + confirm gate) → reply text → `POST /speak` (edge-tts → MP3) → frontend plays the audio. Reply text is rendered as markdown (emojis stripped) before display and before TTS.
- **Delivery:**
  - Phase 1 = Tauri **desktop app** (backend runs locally). No PWA.
  - Phase 2 = host the backend + ship a **PWA-installable** web app (the no-download path) + keep the Tauri desktop app as an optional download. One codebase serves all three.

---

## KEY CONSTRAINTS
- Rate limit: 5 req/min, 150 msg/day, warn at 120 — enforce a **hard daily kill-switch / budget cap**, not just a warning. Budget by tokens too (email/WhatsApp tool results balloon fast).
- Conversation history: last 20 messages.
- Hinglish (Hindi + English mixed) support — note: code-mixing is imperfect in every STT engine; test on your own voice.
- All keys in `.env` — never hardcoded.
- Multi-account Gmail; multi-number WhatsApp Business.
- Always confirm before sending a message/email or creating/deleting events (via the confirm gate).

---

## UI STYLE
**Art direction (updated this session):** modeled on clean **app-style HUD dashboards**, NOT the dense film stills. Near-black canvas, one cyan, thin strokes, rounded "notched-corner" cards, generous spacing — legibility over decoration.
- Background #000008 · Primary #00FFE5 · Secondary #0066FF · Alert #FF6B00 · Critical #FF2020 · Text #E0F7F7
- Fonts: Space Grotesk (display) + Inter (body) + JetBrains Mono (chat/terminal)
- **Center orb = reactive connection-mesh:** glowing core + a mesh of nodes (Gmail / Calendar / WhatsApp / Discord) that light cyan when connected and **react to live audio** (mic + Zenith's voice). 4 states: idle / listening / thinking / speaking. **Redesign queued** (`TODO.md`): per-node scaling looks like "bleeding dots" — move to core-breathing + inward edge-flow, drop concentric/orbital rings, stay cyan (revisit the orange speaking accent).
- **Command center (chat):** chat input + **mic (hold space) + send merged** into one surface (`CommandCenter.tsx`) with a monospace response area (copy / save / share per answer), a **left context-rail** (chat / drafts / clients / settings), a QuickActions strip + FocusCard.
- **Panels:** left CALENDAR (`CalendarPanel`) · center orb + command center · right **Connections list** (`ConnectionsPanel` — accounts + status dots) + **Activity log** (`ActivityLog` — timestamped feed: "create_event → confirmed", "email sent", "rate-limit warning"). The old single COMMUNICATIONS panel was split into these two.
- **Confirm/pending-action card is FIRST-CLASS** — a prominent StatusCard near the orb. It's the trust layer; don't bury it.
- **CUT (do not build):** fake telemetry (CPU/GPU/disk/reactor/battery), standing weather/environment widget, decorative data-feed graph. Keep only the **real `/usage` gauge** (API usage + daily cap + token budget).
- **De-Marvel:** Zenith's own naming everywhere (your connections, your log, "Zenith" title). "JARVIS / Stark / J.A.R.V.I.S. Cloud / Pepper" never appear in the UI — JARVIS is the internal codename only.
- Top timeline/status bar · hex corner accents (kept, used sparingly). The standalone bottom waveform bar was dropped — voice activity now drives the reactive orb.

---

## BUILD ORDER (refined)
- [x] **Slice 0 — Vertical slice:** chat box + static orb + FastAPI `/chat` + one real Claude round-trip + rate-limiter stub. Prove the loop end to end before building HUD chrome.
- [x] **Milestone 1 — The Brain:** FastAPI + Claude tool-use scaffolding, last-20 history (+ token budget), enforced rate limit / kill-switch, Hinglish system prompt, confirm gate (built once, reused). Do this BEFORE integrations.
- [~] **Milestone 2 — HUD UI (mostly done):** voice in (faster-whisper `/transcribe`) ✅ + out (edge-tts `/speak`) ✅; empty/undecodable mic clips → no-speech (no 500) ✅. App-style HUD built per the v1.3 direction: reactive connection-mesh orb (4 states), merged **Command Center** (chat + mic + send), context rail + left-rail extras, QuickActions, FocusCard, Calendar/Connections/Activity panels, gauges, top bar (`frontend/components/`). Markdown reply rendering + emoji-strip ✅. **Remaining:** orb/HUD visual redesign (`TODO.md`), wire panels to live data (still on `lib/mock.ts`), Tauri desktop shell — `src-tauri/` not yet scaffolded (mic permission must be granted there).
- [ ] **Milestone 3 — Google:** OAuth (single account first → then multi-account), Calendar + Gmail as tools, morning briefing (+ weather).
- [ ] **Milestone 4 — Messaging:** WhatsApp personal (bridge) → Discord → WhatsApp Business (last; most onboarding friction). Polling-based alerts for v1.
- [ ] **Milestone 5 — Hardening:** settings page, usage/cost dashboard, kill-switch cap, README + `.env.example`, tests (rate limiter, tool router, confirm flow). Fold error/empty/loading states in throughout — don't save them for the end.

### Phase-1 capabilities pulled in from "future" (this session's call: it's a daily driver for ME, so the things I'd actually use live in Phase 1, not parked as Phase-2 product ambition)
- [ ] **Milestone 6 — Memory vault + Copy Factory:**
  - **Memory = local Markdown vault** (Obsidian-style), NOT Postgres. Tools `search_notes` (read) + `save_note` (action). Daily logs, client notes/briefs, decisions; enables "what did I do last week" + **voice-matched drafts** (learns my writing style from the vault).
  - **Copy Factory / Template Studio:** input = my existing client **intake form** (it already IS the brief). From one brief Zenith drafts — in my voice — email sequences, **WhatsApp WABA templates** (Meta `{{1}}` format, category-tagged), ad copy + creative briefs, and landing/funnel copy, in English/Hindi/Hinglish. **Copy only — I paste into Arkquen; nothing wired.** Tools: `draft_sequence`, `draft_ad_copy`, `draft_landing_copy` (output-only, no send).
- [ ] **Milestone 7 — Proactivity + message triage:** background watcher surfaces *what slipped* as floating status cards (aging unanswered client msgs, commitments made, today's prep, deadlines). **WhatsApp triage** of my OWN personal + business messages: "who's waiting on a reply?" → drafts replies (confirm-gated). Builds on M3/M4; respects the rate/token cap.

> **Stays in Phase 2 (true SaaS-only):** multi-user auth (Clerk), per-user encrypted keys, Razorpay billing, hosted backend + PWA, the full **business-data dashboard** (clients/projects/invoices/time as a DB module — the lightweight version is just the vault in M6). Computer Use + Higgsfield remain optional/experimental.

---

## KEY DECISIONS & GOTCHAS
- **STT:** Web Speech API dropped — recognition breaks inside the desktop shell (it depends on Chrome → Google's servers). Use faster-whisper locally instead.
- **STT Hinglish (decided Pass B):** auto-detect language — English stays English; Hindi is transcribed in its **real words and romanised to Latin** (not translated), and re-forced to Hindi if detection drifts to Urdu, so the transcript is always Roman, never Arabic/Devanagari script. `beam_size=5` + `condition_on_previous_text=False` curb mishears/hallucinations; `vad_filter` skips silence (fixed a ~58s silent-decode pathology).
- **faster-whisper:** load the model ONCE at startup, not per request. Bigger model on the 32GB Windows desktop GPU (`WHISPER_DEVICE=cuda` + `large-v3` via `.env`); "small" on the 8GB MacBook. Safe CUDA→CPU fallback so a bad GPU config can't brick startup. Push-to-talk masks latency.
- **TTS (decided Pass B):** browser SpeechSynthesis replaced with **edge-tts** neural voices (free, no key) — backend renders MP3 at `POST /speak`, frontend plays it. Browser-independent; not rate-limited. New deps: `edge-tts`, `indic-transliteration`.
- **Replies:** rendered as markdown (bold/lists/code), **emojis stripped** on display and before TTS. The system prompt forbids emojis + heavy formatting and forces Latin-script Hinglish (never Devanagari/Urdu).
- **Tauri:** grant mic permission in the Tauri config + OS-level usage string, or `getUserMedia` fails silently.
- **WhatsApp personal (bridge):** unofficial → ToS/ban risk. Don't point it at a number you can't afford to lose.
- **WhatsApp Business "1000 free msgs":** outdated — verify Meta's current per-conversation pricing; ship with ONE business number first.
- **Domain:** still to lock (non-.com). Verify on porkbun, then trademark-check before paying.
- **Differentiation / moat:** the field splits into pretty JARVIS clones (great UI, no real work) and serious assistants (powerful, no soul). Zenith's lane → *a proactive, Hinglish-speaking, WhatsApp-native assistant that handles the founder's work and acts with a visible trust layer (confirm gate + activity log).* Aesthetics get attention; that sentence is the reason to pay.
- **DON'T BUILD (saturated / non-differentiating — zero effort):** PC/system monitoring (CPU/GPU/disk/reactor/battery telemetry — cosplay); calendar auto-scheduling à la Motion (just integrate Calendar); WhatsApp Business customer-chatbots / lead-gen (different product, saturated in India); smart-home/IoT; more 3D holographic eye-candy.
- **Arkquen = OUT of Zenith's scope.** It's a white-label subscription being rebuilt — a moving target. Arkquen runs the *client machine* (funnels/CRM/automated sequences); Zenith runs the *founder* (proposals, ad copy, briefs, reporting, comms, Copy Factory). No integration.
- **Memory = Markdown vault** (Obsidian-style), not Postgres — local, private, and it doubles as the Copy Factory's brief store (one client brief → sequences + ad copy + proposals + pre-call briefs).

---

## BUSINESS CONTEXT (the owner's world — what Zenith is built around)
- **Arkquen** (arkquen.com) — real-estate-focused funnel / CRM / WhatsApp+email automation platform. Currently a **white-labeled subscription the owner resells**, on the way to **building their own**. Runs the *client-facing machine*. **Zenith does NOT integrate with it.**
- **ShapeOdyssey** (shapeodyssey.com) — digital agency that builds **customer-acquisition systems**: Meta/Google ads + funnels (in Arkquen) + websites + automation. Team-based.
- **Division of labour:** Arkquen runs the client machine → **Zenith runs *you***: proposals, agreements, ad copy, creative briefs, campaign reporting, website/funnel copy, ad-hoc client comms, and the Copy Factory. None of it overlaps Arkquen.
- **Long-game (Phase 2):** the owner works in a team, so Zenith eventually trends toward a *founder's command center over a team* (delegation, "what's pending across everyone"). Phase 1 stays the personal driver.

---

## COST STRUCTURE (Phase 1, updated)
| Service | Monthly Cost |
|---|---|
| Claude Pro (for building) | ~₹1,680 |
| Anthropic API — Sonnet 4.6 | ~₹420 |
| faster-whisper STT | Free (runs locally) |
| Google / Discord / WhatsApp personal | Free |
| **Total MVP** | **~₹2,100/month** |

---

## MASTER PROMPT (updated short version)
Build **Zenith** — a full-stack personal AI desktop assistant (wake word "Zenith", codename JARVIS).
Stack: Next.js + Tauri desktop shell + Python FastAPI + Claude Sonnet 4.6 (tool use) + faster-whisper (local STT, romanised Hinglish) + edge-tts neural TTS (backend `/speak` → MP3) + PostgreSQL.
Integrations as Claude tools: Google Calendar/Gmail (multi-account, direct API), Discord (discord.py), WhatsApp personal (whatsapp-mcp bridge), WhatsApp Business (Cloud API, multi-number).
Architecture: Claude calls tools, FastAPI executes them; read-only tools run immediately, action tools (send/create/delete) go through a confirm gate. Voice loop: mic → /transcribe (whisper) → /chat (Claude + last-20 history + rate limit + Hinglish prompt + tools + confirm) → /speak (edge-tts → MP3).
UI: HUD — #000008 bg, #00FFE5 cyan, animated orb, circular gauges, terminal chat, waveform bar.
Constraints: hard 5/min + 150/day cap, last 20 msgs, Hinglish, .env keys only, confirm before actions.
Production quality, complete code, no placeholders. Deliver: full codebase + README + .env.example.

---

*Synced with JARVIS_PRD.md v1.4. v1.4 (HUD build pass): the v1.3 app-style HUD is now implemented — reactive connection-mesh orb, merged Command Center, ConnectionsPanel + ActivityLog (split from CommsPanel), QuickActions, FocusCard, ContextRail; standalone WaveformBar removed; empty-mic-clip voice fix. Orb/HUD visual redesign queued in TODO.md. v1.3 adds (prior session): app-style UI direction (connection-map orb, paginated chat + left rail, connections list, activity log, first-class confirm card, fake telemetry cut, de-Marvel'd); business context (Arkquen out / ShapeOdyssey); and the personally-useful "future" features pulled into Phase 1 — Copy Factory (M6), Memory vault (M6), Proactivity + WhatsApp triage (M7). True SaaS machinery (multi-user, billing, hosting/PWA, full business dashboard) stays Phase 2.*
