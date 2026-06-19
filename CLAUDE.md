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
- Background: #000008 (pure black)
- Primary: #00FFE5 (cyan glow)
- Secondary: #0066FF (electric blue)
- Alert: #FF6B00 (orange) · Critical: #FF2020 (red)
- Text: #E0F7F7 (cool white)
- Font: Space Grotesk + Inter + JetBrains Mono
- Iron Man HUD — center orb (idle/listening/thinking/speaking states), circular gauges, floating status cards, terminal chat, bottom waveform bar, top timeline bar, hexagonal corner accents.

---

## BUILD ORDER (refined)
- [x] **Slice 0 — Vertical slice:** chat box + static orb + FastAPI `/chat` + one real Claude round-trip + rate-limiter stub. Prove the loop end to end before building HUD chrome.
- [x] **Milestone 1 — The Brain:** FastAPI + Claude tool-use scaffolding, last-20 history (+ token budget), enforced rate limit / kill-switch, Hinglish system prompt, confirm gate (built once, reused). Do this BEFORE integrations.
- [~] **Milestone 2 — HUD UI (mostly done):** voice in (faster-whisper `/transcribe`) ✅ + out (edge-tts `/speak`) ✅; orb states, waveform, gauges, status/calendar/comms panels + top bar built (`frontend/components/`, `hud/`). Markdown reply rendering + emoji-strip ✅. **Remaining:** wire panels to live data (still on `lib/mock.ts`), Tauri desktop shell — `src-tauri/` not yet scaffolded (mic permission must be granted there).
- [ ] **Milestone 3 — Google:** OAuth (single account first → then multi-account), Calendar + Gmail as tools, morning briefing (+ weather).
- [ ] **Milestone 4 — Messaging:** WhatsApp personal (bridge) → Discord → WhatsApp Business (last; most onboarding friction). Polling-based alerts for v1.
- [ ] **Milestone 5 — Hardening:** settings page, usage/cost dashboard, kill-switch cap, README + `.env.example`, tests (rate limiter, tool router, confirm flow). Fold error/empty/loading states in throughout — don't save them for the end.

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

*Plan updated to reflect decisions on: name (Zenith), wake word, tool-use architecture, Tauri desktop / PWA delivery, faster-whisper STT, confirm gate, and refined build order. Synced with JARVIS_PRD.md v1.2 (Milestone 2 voice pass): edge-tts neural TTS via `/speak`, romanised-Hinglish STT, markdown/no-emoji replies.*
