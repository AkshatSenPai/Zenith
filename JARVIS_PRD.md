# ZENITH — Product Requirements Document (PRD)
## Version 1.2 | June 2026
### Product: Zenith  ·  Wake word: "Zenith"  ·  Repo codename: JARVIS

> **What changed in v1.2 (Milestone 2 voice pass, from live testing):** TTS switched from browser SpeechSynthesis to **edge-tts neural voices** served by the backend at `POST /speak` (MP3, browser-independent); STT now **romanises Hindi to Latin script** (auto-detect, re-force Hindi off Urdu drift, VAD + beam tuning, CUDA→CPU fallback); replies render as markdown with **emojis stripped** and a no-emoji/Latin-script system prompt; build-order status markers added; system prompt (§9), env vars (§11), and folder structure (§8) reconciled with the actual code. Milestone 1 ("The Brain") and the voice in/out half of Milestone 2 are now built.

> **What changed in v1.1:** product name set to Zenith; architecture switched to Claude tool-use (not MCP-on-everything); delivery defined (Tauri desktop in Phase 1, PWA + optional desktop in Phase 2); speech-to-text moved from Web Speech API to local faster-whisper; added the confirm-gate pattern, the voice round-trip, a weather API for the briefing, a hardened rate-limit kill-switch, and a re-sequenced build order. New sections: Architecture (3) and Key Decisions & Gotchas (15).

---

## 1. PRODUCT VISION

Zenith is a full-stack personal AI assistant for desktop — inspired by Iron Man's JARVIS (which stays the internal repo codename).
Built for freelancers and agency owners who want to automate daily tasks via voice and chat.

- **Wake word:** "Zenith" (simple, one word). Phase-1 activation is push-to-talk (hold space); always-listening wake-word detection is a later add.
- **Phase 1:** Personal daily driver (current goal)
- **Phase 2:** SaaS product for Indian freelancers/agency owners (₹999-2999/month)

**Naming note:** "Zenith" is also used by major brands (LG's Zenith Electronics, Zenith watches/LVMH) and Indian software cos (Zenith Software, Bengaluru; Zenithra Tech, Delhi). Fine for the personal Phase-1 tool — but get a trademark lawyer's sign-off before launching the paid Phase-2 product, and lock a domain (non-.com; verify on porkbun, then trademark-check).

---

## 2. TARGET USER

**Primary User (Phase 1):** The builder himself
- Freelancer + agency owner
- Manages websites, SaaS projects
- Uses VS Code, Claude Code daily
- Needs: schedule management, email, WhatsApp, ad creation, coding help

**Target Market (Phase 2):** Indian freelancers and agency owners
- Age 22-35
- Tools they already use: Gmail, WhatsApp, Google Calendar, Discord
- Pain point: Too many tabs, too much context switching
- Willingness to pay: ₹999-2999/month

---

## 3. ARCHITECTURE — HOW IT WIRES

**Claude is the brain.** The FastAPI backend defines a set of tools; Claude (Sonnet 4.6) decides which to call; FastAPI executes them against the real APIs and returns results. Every new integration is just one more entry in `TOOLS` — the chat route never changes. This replaces the original "Gmail MCP / Calendar MCP / Discord MCP" plan.

- **Tool use, not MCP-everywhere:** use direct API client libraries where an official API is easy (Google Calendar/Gmail, Discord). Use an MCP/bridge only for **personal WhatsApp**, where no official API exists.
- **Confirm gate:** read-only tools (read calendar, read mail) run immediately; action tools (`send_email`, `send_whatsapp`, `create_event`, `delete_*`) return a "pending action" → frontend shows a confirm card → `/chat/confirm` runs it. This is how "confirm before sending/creating" is enforced.
- **Voice round-trip:** mic (MediaRecorder, hold space) → `POST /transcribe` (faster-whisper, local, romanised Hinglish) → `POST /chat` (Claude + last-20 history + rate limit + Hinglish prompt + tools + confirm gate) → reply text (markdown-rendered, emojis stripped) → `POST /speak` (edge-tts neural → MP3) → frontend plays the audio.
- **Delivery:**
  - Phase 1 = Tauri **desktop app**, backend runs locally. No PWA.
  - Phase 2 = host the backend + ship a **PWA-installable** web app (the no-download path) + keep the Tauri desktop app as an optional download. One codebase serves all three.

```
[ User mic ] → Frontend (Tauri + Next.js)
                   │  audio
                   ▼
              FastAPI  /transcribe  → faster-whisper (local, romanised Hinglish)
                   │  transcript
                   ▼
              FastAPI  /chat  → Claude (history · tools · confirm gate)
                   │  reply text (markdown, emoji-stripped)
                   ▼
              FastAPI  /speak  → edge-tts neural → MP3
                   │  audio
                   ▼
              Frontend plays MP3 → [ Speaker ]
```

---

## 4. CORE FEATURES — MVP (Phase 1)

### 4.1 AI Brain
- Model: Claude Sonnet 4.6 API, via **tool use (function calling)**
- Conversation history: last 20 messages maintained (+ a token budget — tool results balloon)
- Language: Hinglish (Hindi + English mixed) support
- Personality: Professional, concise, calls user "Boss" occasionally
- Rate limiting: 5 req/min, 150 msg/day, warn at 120 — enforce a **hard daily kill-switch**, not just a warning

### 4.2 Voice Interface
- Input (STT): **faster-whisper**, local/offline (replaces Web Speech API, which breaks inside the desktop shell). Auto-detects language and **romanises Hindi to Latin script** (transcribes real words, doesn't translate); re-forces Hindi if detection drifts to Urdu. VAD + `beam_size=5` to curb mishears/silent-decode. Configurable via `.env` (`WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE`, `WHISPER_LANGUAGE`) with a safe CUDA→CPU fallback.
- Output (TTS): **edge-tts** neural voices (Microsoft, free / no key), rendered by the backend at `POST /speak` and returned as MP3 the frontend plays — browser-independent. Replaced browser SpeechSynthesis (robotic in some Chromium builds, silent in others). Voice via `ZENITH_TTS_VOICE` (default `en-IN-NeerjaNeural`). Piper (local) remains an option if a fully-offline voice is needed.
- Replies: rendered as markdown (bold/lists/code), with **emojis stripped** before display and before TTS.
- Activation: push-to-talk (hold space). Wake word "Zenith" via a detection engine is a later add.
- Languages: Hindi + English. Note: true code-mixing is imperfect in every STT engine — test on your own voice.

### 4.3 Google Calendar Integration
- Read today's and tomorrow's events
- Add new events via natural language (→ `create_event` tool, behind the confirm gate)
- "Kal 3 baje client call add kar" → creates event
- Multiple Google accounts supported

### 4.4 Gmail Integration
- Multiple Gmail accounts (personal + business both)
- Read last 10 unread emails with AI summary
- Draft emails via Zenith command
- Send emails behind the confirm gate

### 4.5 WhatsApp Integration
**Personal WhatsApp:**
- 1 personal number via whatsapp-mcp (open source, local bridge)
- Read messages, send messages, group messaging
- "Bhai ko bol do 8 baje aa raha hoon"
- ⚠️ Unofficial protocol → ToS / ban risk. Don't use a number you can't afford to lose.

**Business WhatsApp (multiple numbers):**
- Multiple business numbers via WhatsApp Cloud API
- Manage all client conversations from one place
- "Client X ke pending messages dikhao"
- New inquiry alerts (polling-based for v1)
- ⚠️ Each number needs WABA registration + verification. Verify Meta's current per-conversation pricing; ship with ONE business number first.

### 4.6 Discord Integration
- Multiple servers supported (via discord.py, direct)
- Read messages, send messages
- Server management basics

### 4.7 Morning Briefing
- Trigger: "Good morning" or "Briefing do"
- Output (voice + text):
  - Today's date, day, weather (needs a Weather API key)
  - All meetings/events today
  - Unread email count + top 3 summaries
  - Pending WhatsApp messages count
  - Top priority reminder
- Delivered on trigger

### 4.8 Settings Panel
- Anthropic API key input (Phase 2 BYO-key needs encryption at rest)
- Google OAuth connect/disconnect (multiple accounts)
- WhatsApp number connect
- Discord server connect
- Voice speed + language preference
- Daily usage + cost dashboard, with the kill-switch cap

---

## 5. FUTURE FEATURES (Phase 2)

### 5.1 Computer Use (Desktop Control)
- Anthropic Computer Use API (experimental — slow/expensive, treat carefully)
- "Claude Code kholo aur naya chat start karo"
- "Ye PDF kholo aur edit karo"

### 5.2 Higgsfield Integration (Ad/Video Creation)
- YouTube Shorts generation for Papa's channel
- Facebook/Instagram ad videos
- "Mere SaaS ka 30 second ad banao"
- URL-to-video feature

### 5.3 Coding Assistant Mode
- Generate prompts for Claude Code
- SaaS/website task prompts ready-made
- "Ek landing page ka prompt banao with pricing table"

### 5.4 Persistent Memory
- PostgreSQL database
- Conversations saved across sessions
- User preferences remembered
- "Last week maine kya kiya tha" → Zenith batayega

### 5.5 Multi-User (SaaS)
- User authentication (Clerk)
- Each user brings their own API key (store encrypted)
- Per-user rate limiting
- Razorpay payment integration

---

## 6. UI DESIGN SPECIFICATION

### Theme — Iron Man HUD
Based on Pinterest reference images provided:

**Colors:**
- Background: Pure black #000008
- Primary glow: Cyan #00FFE5
- Secondary: Electric blue #0066FF
- Alert/Warning: Orange #FF6B00
- Critical: Red #FF2020
- Text: Cool white #E0F7F7

**Fonts:**
- Display: Space Grotesk
- Body: Inter
- Terminal/Code: JetBrains Mono

### Layout (Desktop 1440px)

```
┌─────────────────────────────────────────────────────────┐
│  ZENITH v1.0    Mon, 16 June 2026    [●] ONLINE  [⚙️]   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
├──────────────┬──────────────────────┬───────────────────┤
│  CALENDAR    │                      │   COMMUNICATIONS  │
│  ────────    │    [ ZENITH ORB ]    │   ─────────────   │
│  ◉ 10am Meet │   Animated glowing   │   Gmail: 3 new    │
│  ◉ 2pm Call  │   sphere with rings  │   WhatsApp: 5     │
│  ◉ 5pm Review│   Pulse on voice     │   Discord: 2      │
│              │                      │                   │
│  TOMORROW    │   Status: LISTENING  │   [Recent msgs]   │
│  ◉ 11am Demo │                      │                   │
│              │  [Chat/Response area]│                   │
├──────────────┴──────────────────────┴───────────────────┤
│  [Waveform animation when voice active]                  │
│  [🎤 Hold SPACE to speak]  [Type here...]      [Send ▶] │
└─────────────────────────────────────────────────────────┘
```

### Orb States
- **Idle:** Slow cyan pulse, dim glow, slow orbital rings
- **Listening:** Fast pulse, bright cyan, ripple animation, waveform
- **Thinking:** Rotating arc, blue glow, processing animation
- **Speaking:** Wave animation, full brightness, orange accent

### HUD Elements (from reference images)
- Circular gauge indicators — API usage, daily limit
- Floating status cards — event alerts, message notifications
- Terminal-style chat display — monospace font, cyan text
- Bottom waveform bar — voice activity visualizer
- Top timeline bar — date, time, day progress
- Warning alerts — orange pop-ups for important notifications
- Hexagonal accent elements — corners

---

## 7. TECH STACK

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | Best React framework, scalable |
| Styling | Tailwind CSS | Fast HUD styling |
| Desktop shell | Tauri (Phase 1) | Real app window, no browser tab; lighter than Electron |
| Backend | Python FastAPI | Fast, async; orchestrates Claude tool-use |
| AI Brain | Claude Sonnet 4.6 API (tool use) | Best quality/cost ratio; tools = clean routing |
| Voice In | faster-whisper (local/offline, romanised Hinglish) | Free, private, no Chrome/Google dependency |
| Voice Out | edge-tts neural (backend `/speak` → MP3) | Free, no key, natural Hinglish voice, browser-independent |
| Wake word (later) | Porcupine / openWakeWord | Detects "Zenith" for always-listening mode |
| Calendar | Google Calendar API (direct client lib) | Multi-account, robust |
| Email | Gmail API (direct, multi-account) | Multi-account |
| WhatsApp Personal | whatsapp-mcp bridge | Only MCP use; no official API (ToS risk) |
| WhatsApp Business | WhatsApp Cloud API | Multiple numbers |
| Discord | discord.py (direct) | Multi-server support |
| Database | PostgreSQL | Conversation history, user prefs |
| Weather | Weather API (e.g. OpenWeather) | Morning briefing |
| Delivery | Phase 1 Tauri desktop · Phase 2 PWA + optional desktop | One codebase |
| Future | Anthropic Computer Use API | Desktop control |
| Future | Higgsfield API | Video/ad generation |

---

## 8. FOLDER STRUCTURE

> **Note (v1.2):** this is the **target** structure. The current backend is **flat** — `main.py`, `claude_service.py`, `memory_service.py`, `rate_limiter.py`, `stt_service.py`, `tts_service.py`, `tools.py`, and tests all live directly under `backend/` (no `routes/`/`services/`/`integrations/`/`database/` subdirs yet). `/transcribe`, `/speak`, `/chat`, `/chat/confirm`, `/usage` are all routes in `main.py`. The frontend has `app/page.tsx` + `components/` (`ZenithOrb`, `WaveformBar`, `GaugeIndicator`, `StatusCard`, `CalendarPanel`, `CommsPanel`, `TopBar`, `Markdown`, `hud/primitives.tsx`) + `lib/` (`voice.ts`, `format.ts`, `mock.ts`) — no `calendar/`/`inbox/`/`settings/` pages and **no `src-tauri/` yet**. Refactor toward the tree below as integrations land.

```
jarvis/                             # repo codename; brand = Zenith
├── CLAUDE.md                       # Project context for Claude sessions
├── JARVIS_PRD.md                   # This file
├── .env                            # All secrets (never commit)
├── .env.example                    # Template
├── .gitignore
├── README.md                       # Setup instructions
│
├── src-tauri/                      # Tauri desktop shell (Phase 1)
│   ├── tauri.conf.json             # ← grant mic permission here
│   └── src/main.rs
│
├── frontend/                       # Next.js App
│   ├── app/
│   │   ├── page.tsx                # Main HUD dashboard
│   │   ├── layout.tsx
│   │   ├── calendar/page.tsx       # Full calendar view
│   │   ├── inbox/page.tsx          # Gmail + WhatsApp + Discord
│   │   └── settings/page.tsx       # API keys, connections, usage/cost
│   ├── components/
│   │   ├── ZenithOrb.tsx           # Animated center orb
│   │   ├── VoiceInput.tsx          # MediaRecorder, hold-space capture
│   │   ├── ConfirmCard.tsx         # Pending-action confirm gate UI
│   │   ├── ChatDisplay.tsx         # Terminal-style chat
│   │   ├── CalendarPanel.tsx       # Left panel
│   │   ├── CommsPanel.tsx          # Right panel (Gmail+WA+Discord)
│   │   ├── WaveformBar.tsx         # Bottom voice visualizer
│   │   ├── StatusCard.tsx          # Floating HUD alerts
│   │   └── GaugeIndicator.tsx      # Circular progress gauges
│   ├── lib/
│   │   ├── api.ts                  # Backend calls
│   │   └── voice.ts                # MediaRecorder + TTS utilities
│   └── styles/
│       └── globals.css             # HUD theme + animations
│
├── backend/                        # Python FastAPI
│   ├── main.py                     # Entry point (loads whisper model once)
│   ├── routes/
│   │   ├── chat.py                 # Claude + tool loop + confirm gate
│   │   ├── confirm.py              # Runs a pending action on user yes
│   │   ├── transcribe.py           # faster-whisper STT endpoint
│   │   ├── speak.py                # edge-tts neural TTS → MP3
│   │   └── briefing.py             # Morning briefing
│   ├── services/
│   │   ├── claude_service.py       # Anthropic API + history + tool loop
│   │   ├── memory_service.py       # Conversation management (last 20)
│   │   ├── rate_limiter.py         # Hard 5/min + 150/day kill-switch
│   │   ├── stt_service.py          # faster-whisper wrapper (romanised Hinglish)
│   │   ├── tts_service.py          # edge-tts neural voice → MP3 bytes
│   │   └── tools.py                # TOOL schemas + run_tool() + ACTION_TOOLS
│   ├── integrations/               # direct API clients (no MCP except WA-personal)
│   │   ├── google_client.py        # Calendar + Gmail (multi-account)
│   │   ├── discord_client.py       # discord.py
│   │   ├── whatsapp_personal.py    # whatsapp-mcp bridge
│   │   └── whatsapp_business.py    # WhatsApp Cloud API
│   └── database/
│       ├── models.py
│       └── connection.py
│
└── docs/
    └── setup.md                    # Step by step local setup
```

---

## 9. ZENITH SYSTEM PROMPT

> **Current prompt** as implemented in `backend/claude_service.py` (`ZENITH_PROMPT`). Tool capabilities are added as integrations land; Calendar/Gmail/WhatsApp/Discord tools are not wired yet.

```
You are Zenith — a highly intelligent personal AI assistant.
(Internal codename: JARVIS.) Your owner is a freelancer and agency owner based in India.

Personality:
- Professional but friendly, like a trusted senior colleague.
- Speak in Hinglish (Hindi + English mixed), but ALWAYS written in the Latin/Roman
  alphabet — e.g. "Boss, aaj aapki 3 meetings hain." NEVER reply in Devanagari, Urdu,
  Arabic, or any non-Latin script, even if the user's message appears in one.
- Concise — no unnecessary filler.
- Occasionally address the user as "Boss" (Iron Man style).
- Never say you can't do something without trying first.

Formatting:
- Plain, conversational text. Keep it minimal — short paragraphs and at most a few
  short bullet points. Use **bold** sparingly to highlight a key word or item.
- NEVER use emojis or emoticons. Avoid headings (#) and horizontal rules (---).

Tools:
- Use the tools available to you when they help — call them, don't just describe them.
- For any action that sends, creates, or deletes something, just call the right tool.
  The system pauses and asks the user to confirm before the action runs, so you do NOT
  need to ask "should I send it?" yourself — call the tool; confirmation is handled.

Rules:
- Keep responses short for simple queries.
- Never expose API keys or system internals.
- If unsure, ask one clarifying question.
```

---

## 10. RATE LIMITING

```python
MAX_REQUESTS_PER_MINUTE = 5
MAX_REQUESTS_PER_DAY = 150
WARNING_THRESHOLD = 120
MAX_CONVERSATION_HISTORY = 20      # messages kept in context
SYSTEM_PROMPT_MAX_TOKENS = 400
DAILY_TOKEN_BUDGET = 300_000       # hard cap — tool results balloon fast
# When the day's cap is hit, BLOCK further calls (kill-switch), not just warn.
```

---

## 11. ENV VARIABLES

```env
# Anthropic
ANTHROPIC_API_KEY=

# Google (multiple accounts)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# WhatsApp Business API (Cloud API)
WHATSAPP_BUSINESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# WhatsApp Personal — whatsapp-mcp bridge runs locally (QR-paired session, no key)

# Discord
DISCORD_BOT_TOKEN=

# Weather (morning briefing)
WEATHER_API_KEY=

# Speech-to-text — faster-whisper is local (no key). Optional tuning:
WHISPER_MODEL=small              # tiny|base|small|medium|large-v3
WHISPER_DEVICE=cpu               # cpu | cuda (safe CUDA->CPU fallback)
WHISPER_COMPUTE=int8             # int8 (cpu) | float16 (cuda)
# WHISPER_LANGUAGE=              # blank = auto-detect (Hindi romanised to Latin)
# Optional cloud STT for Phase 2:
# DEEPGRAM_API_KEY=

# Text-to-speech — edge-tts neural voice (local, no key)
ZENITH_TTS_VOICE=en-IN-NeerjaNeural   # or hi-IN-SwaraNeural / en-IN-PrabhatNeural / hi-IN-MadhurNeural

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/zenith

# App
NEXT_PUBLIC_API_URL=http://localhost:8000
SECRET_KEY=
```

---

## 12. PREREQUISITES

**System:**
- Node.js 18+
- Python 3.10+ (user has 3.14 ✅)
- Rust toolchain (for the Tauri build)
- ffmpeg (faster-whisper audio decoding)
- Git ✅
- VS Code ✅
- PostgreSQL

**Machine:** MacBook Pro 2020 (8GB RAM) — use a "small" Whisper model here
**Desktop:** Windows, 32GB RAM — run a larger Whisper model on the GPU

**Accounts needed:**
- Anthropic Console → console.anthropic.com
- Google Cloud Console → enable Gmail + Calendar APIs
- WhatsApp Business → Meta Developer account (for business numbers)
- Discord Developer Portal → for bot token
- Weather API provider (e.g. OpenWeather)

**Payment:**
- Anthropic API: Start with $10 credit (~₹840)
- Wise card recommended if Indian Visa debit doesn't work

---

## 13. COST STRUCTURE

| Service | Monthly Cost |
|---------|-------------|
| Claude Pro (for building) | $20 (~₹1,680) |
| Anthropic API - Sonnet 4.6 | ~$5 (~₹420) |
| faster-whisper STT | Free (runs locally) |
| Google APIs | Free |
| WhatsApp Personal bridge | Free (open source) |
| WhatsApp Business API | Per-conversation pricing — verify Meta's current rates; start with 1 number |
| Discord | Free |
| Higgsfield (future) | $15 (~₹1,260) |
| **Total MVP** | **~₹2,100/month** |

---

## 14. BUILD ORDER

### Slice 0 — Vertical slice ✅ DONE
- Chat box + static orb + FastAPI `/chat` + one real Claude round-trip + rate-limiter stub
- Goal: prove the loop end to end before building HUD chrome

### Milestone 1 — The Brain ✅ DONE
- FastAPI + Claude tool-use scaffolding
- Last-20 history (+ token budget), enforced rate limit / kill-switch
- Hinglish system prompt
- Confirm gate, built once and reused
- **Do this BEFORE integrations** — every integration then plugs in as a tool

### Milestone 2 — HUD UI 🔄 IN PROGRESS
- Orb states, panels (calendar/comms), waveform, gauges, status cards, top bar — **built** (still rendering `lib/mock.ts` placeholder data)
- Voice in (faster-whisper `/transcribe`) ✅ + out (edge-tts `/speak`) ✅
- Markdown reply rendering + emoji-strip ✅
- **Remaining:** wire panels to live data; scaffold the Tauri desktop shell (`src-tauri/`) + grant mic permission there

### Milestone 3 — Google ⬜ NEXT
- OAuth (single account first → then multi-account)
- Calendar + Gmail as tools
- Morning briefing (+ weather)

### Milestone 4 — Messaging
- WhatsApp personal (bridge) → Discord → WhatsApp Business (last; most onboarding friction)
- Polling-based alerts for v1

### Milestone 5 — Hardening
- Settings page, usage/cost dashboard, kill-switch cap
- README + .env.example
- Tests: rate limiter, tool router, confirm flow
- Fold error/empty/loading states in throughout — don't save them for the end

---

## 15. KEY DECISIONS & GOTCHAS

- **STT:** Web Speech API dropped — recognition breaks inside the desktop shell (it depends on Chrome → Google's servers). Use faster-whisper locally.
- **STT Hinglish (decided in Pass B live testing):** auto-detect language; English stays English, Hindi is transcribed in its **real words and romanised to Latin** (not translated), and re-forced to Hindi if detection drifts to Urdu — so the transcript is always Roman, never Arabic/Devanagari. `beam_size=5` + `condition_on_previous_text=False` curb mishears/hallucinations; `vad_filter` skips silence (fixed a ~58s silent-decode pathology). Deps added: `indic-transliteration`.
- **TTS (decided in Pass B):** browser SpeechSynthesis was robotic in some Chromium builds and silent in others → replaced with **edge-tts** neural voices (free, no key). Backend renders MP3 at `POST /speak`; frontend plays it. Browser-independent and not rate-limited. Dep added: `edge-tts`.
- **Replies:** rendered as markdown (bold/lists/code) with **emojis stripped** before display and before TTS; the system prompt forbids emojis + heavy formatting and forces Latin-script Hinglish.
- **faster-whisper:** load the model ONCE at startup, not per request. Bigger model on the 32GB desktop GPU (`WHISPER_DEVICE=cuda` + `large-v3`); "small" on the 8GB MacBook. Safe CUDA→CPU fallback so a bad GPU config can't brick startup. Push-to-talk masks latency.
- **Tauri:** grant mic permission in `tauri.conf.json` + the OS-level usage string, or `getUserMedia` fails silently.
- **MCP vs tool use:** only personal WhatsApp uses MCP (no official API). Everything else is a direct API call exposed to Claude as a tool.
- **WhatsApp personal:** unofficial protocol → ToS / ban risk. Don't use a number you can't lose.
- **WhatsApp Business "1000 free msgs":** outdated — verify Meta's current per-conversation pricing; ship with one number first.
- **Domain & trademark:** "Zenith" is a contested mark; lock a non-.com domain (porkbun) and get a trademark sign-off before the paid launch.

---

## 16. FUTURE ROADMAP

### Phase 2 — Scale (Month 2-3)
- [ ] Host backend + PWA-installable web app + optional desktop download
- [ ] Anthropic Computer Use API
- [ ] Higgsfield video/ad generation
- [ ] Persistent memory (database)
- [ ] Cloud STT (Deepgram) for multi-user voice

### Phase 3 — Product (Month 4)
- [ ] Trademark clearance + final domain for "Zenith"
- [ ] User auth (Clerk)
- [ ] Multi-user support
- [ ] Razorpay payment (₹999/month)
- [ ] Landing page with TNC, Privacy Policy, Refund Policy
- [ ] Razorpay merchant account setup

### Phase 4 — Marketing (Month 4-5)
- [ ] Build in public — Twitter/X
- [ ] LinkedIn posts
- [ ] YouTube Shorts demos (via Higgsfield)
- [ ] Beta users (20-30 free)
- [ ] Facebook/Instagram ads — ₹5,000/month budget
- [ ] Target: 100 paying users = ₹1 lakh/month

---

## 17. MASTER PROMPT FOR OPUS 4.8

> Attach HUD reference images before sending this prompt.

```
Build Zenith — a full-stack personal AI desktop assistant
(wake word "Zenith", repo codename JARVIS).

Goal: My daily desktop tool — voice, calendar, email,
WhatsApp (personal + multiple business numbers), Discord, AI chat.

Stack: Next.js frontend wrapped in a Tauri desktop shell,
Python FastAPI backend, Claude Sonnet 4.6 API (tool use),
faster-whisper (local STT, romanised Hinglish) + edge-tts neural TTS
(backend /speak → MP3),
Google Calendar + Gmail API (direct, multi-account),
whatsapp-mcp bridge (personal) + WhatsApp Cloud API (multiple numbers),
discord.py, PostgreSQL.

Architecture: Claude calls tools, FastAPI executes them. Read-only
tools run immediately; action tools (send/create/delete) go through
a confirm gate — return a pending action, user confirms, then run.
Voice loop: mic (MediaRecorder, hold space) → /transcribe (whisper)
→ /chat (Claude + last-20 history + rate limit + Hinglish prompt
+ tools + confirm) → /speak (edge-tts neural → MP3).

UI: Match the HUD reference images attached exactly.
Dark theme (#000008 background, #00FFE5 cyan accent),
animated center orb with orbital rings,
circular gauge indicators, floating status cards,
terminal-style chat, bottom waveform visualizer.

Constraints:
- Rate limit: 5 req/min, 150 msg/day — hard kill-switch, not just a warning
- Conversation history: last 20 messages only
- Hinglish support (Hindi + English mixed)
- All API keys via .env — never hardcoded
- Multi-account: multiple Gmail + multiple WhatsApp business numbers
- Confirmation before sending any message/email or creating/deleting events
- Production quality — complete code, no placeholders

Deliverable: Complete working codebase with folder structure,
all files, README setup guide, and .env.example
```

---

*PRD Version 1.2 | Updated: June 2026 (from v1.1, June 2026 · v1.0, June 15, 2026)*
*Next Step: finish Milestone 2 — wire HUD panels to live data + scaffold the Tauri shell (`src-tauri/`) → then Milestone 3 (Google OAuth + Calendar/Gmail tools + morning briefing).*
