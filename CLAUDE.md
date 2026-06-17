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
- Voice in (STT): **faster-whisper**, local/offline (Phase 1). Cloud option for Phase 2: Deepgram (streaming) or OpenAI transcribe
- Voice out (TTS): browser SpeechSynthesis to start; swap to Piper (local) or cloud TTS if Hinglish voice is weak
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
- **Voice round-trip:** mic (MediaRecorder, hold space) → `POST /transcribe` (faster-whisper) → `POST /chat` (Claude + last-20 history + rate limit + Hinglish prompt + tools + confirm gate) → reply text → TTS speak.
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
- [ ] **Milestone 2 — HUD UI:** orb states, all panels, waveform, gauges, status cards; voice in (faster-whisper) + out (TTS).
- [ ] **Milestone 3 — Google:** OAuth (single account first → then multi-account), Calendar + Gmail as tools, morning briefing (+ weather).
- [ ] **Milestone 4 — Messaging:** WhatsApp personal (bridge) → Discord → WhatsApp Business (last; most onboarding friction). Polling-based alerts for v1.
- [ ] **Milestone 5 — Hardening:** settings page, usage/cost dashboard, kill-switch cap, README + `.env.example`, tests (rate limiter, tool router, confirm flow). Fold error/empty/loading states in throughout — don't save them for the end.

---

## KEY DECISIONS & GOTCHAS
- **STT:** Web Speech API dropped — recognition breaks inside the desktop shell (it depends on Chrome → Google's servers). Use faster-whisper locally instead.
- **faster-whisper:** load the model ONCE at startup, not per request. Bigger model on the 32GB Windows desktop GPU; "small" on the 8GB MacBook. Push-to-talk masks latency.
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
Stack: Next.js + Tauri desktop shell + Python FastAPI + Claude Sonnet 4.6 (tool use) + faster-whisper (local STT) + browser TTS + PostgreSQL.
Integrations as Claude tools: Google Calendar/Gmail (multi-account, direct API), Discord (discord.py), WhatsApp personal (whatsapp-mcp bridge), WhatsApp Business (Cloud API, multi-number).
Architecture: Claude calls tools, FastAPI executes them; read-only tools run immediately, action tools (send/create/delete) go through a confirm gate. Voice loop: mic → /transcribe (whisper) → /chat (Claude + last-20 history + rate limit + Hinglish prompt + tools + confirm) → TTS.
UI: HUD — #000008 bg, #00FFE5 cyan, animated orb, circular gauges, terminal chat, waveform bar.
Constraints: hard 5/min + 150/day cap, last 20 msgs, Hinglish, .env keys only, confirm before actions.
Production quality, complete code, no placeholders. Deliver: full codebase + README + .env.example.

---

*Plan updated to reflect decisions on: name (Zenith), wake word, tool-use architecture, Tauri desktop / PWA delivery, faster-whisper STT, confirm gate, and refined build order. JARVIS_PRD.md should be updated to match.*
