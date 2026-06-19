# ZENITH — Product Requirements Document (PRD)
## Version 1.4 | June 2026
### Product: Zenith  ·  Wake word: "Zenith"  ·  Repo codename: JARVIS

> **What changed in v1.4 (HUD build pass — implements the v1.3 direction):** The app-style HUD is now **built** in the frontend. The orb became a **reactive connection-mesh** (a glowing core + a mesh of nodes that react to live audio; 4 states). The chat input + mic + send were **merged into one Command Center** (`CommandCenter.tsx`), and the side rails/panels were filled in — `ContextRail`, `LeftRailExtras`, `QuickActions`, `FocusCard`, `ConnectionsPanel`, `ActivityLog`, `PlaceholderView`. Since v1.2, the single `CommsPanel` was split into `ConnectionsPanel` + `ActivityLog`, and the standalone `WaveformBar` was removed (the orb is now the voice visualizer). Backend got a voice-robustness fix: empty/undecodable mic clips are treated as **no-speech** (no more 500s). Panels still render `lib/mock.ts`; **no Tauri shell yet**. An orb/HUD **visual redesign is queued** (`TODO.md`): calmer mesh, core-breathing + inward edge-flow reaction, drop the concentric/orbital rings, stay cyan, and a Command-Center minimize/restore control.

> **What changed in v1.3 (this session — UI rethink, business context, scope):** UI art direction switched from film stills to clean **app-style dashboards** — the center orb becomes a **live connection-map**, plus a paginated monospace chat surface with a left context-rail, a **Connections list**, an **Activity log**, a **first-class confirm card**, fake telemetry **cut** (only the real `/usage` gauge kept), and the whole UI **de-Marvel'd** (Zenith's own naming; JARVIS internal only). Added the owner's **business context** (Arkquen — out of scope; ShapeOdyssey — agency) and a **Copy Factory / Template Studio** capability. **Pulled the personally-useful "future" features into Phase 1** (Copy Factory, Memory vault, Proactivity + WhatsApp triage); true SaaS machinery stays Phase 2. Added a Differentiation / moat + "don't build" section. Memory layer is now a **Markdown vault**, not Postgres.

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

**The owner's businesses (what Zenith is built around):**
- **Arkquen** (arkquen.com) — a real-estate-focused funnel / CRM / WhatsApp+email automation platform. Currently a **white-labeled subscription the owner resells**, on the way to **building their own**. It runs the *client-facing machine* (funnels, CRM, automated sequences). **Zenith does NOT integrate with Arkquen** — it's a moving target and out of scope.
- **ShapeOdyssey** (shapeodyssey.com) — a digital agency that builds **customer-acquisition systems**: Meta/Google ads + funnels (built in Arkquen) + websites + automation. Team-based.
- **Division of labour:** Arkquen runs the client machine → **Zenith runs *you***: proposals, agreements, ad copy, creative briefs, campaign reporting, website/funnel copy, ad-hoc client comms, and the Copy Factory (§4.9). None of it overlaps Arkquen.
- **Long-game (Phase 2):** the owner works in a team, so Zenith eventually trends toward a *founder's command center over a team*. Phase 1 stays the personal driver.

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

### 4.9 Copy Factory / Template Studio  *(pulled into Phase 1 — the owner's highest-value daily job)*
Input = the owner's **existing client intake form** (it already *is* the brief: niche, offer, audience, price, funnel type, merge variables). From one brief, Zenith generates **in the owner's voice**:
- Multi-stage **email sequences** (welcome → nurture → booking → reminder → no-show → re-engage)
- **WhatsApp (WABA) templates** in Meta's `{{1}}` positional format, **tagged by category** (Marketing / Utility / Authentication) to reduce approval rejections
- **Ad copy + creative briefs** (Meta/Google) and **landing-page / funnel copy**
- Output in **English, Hindi, or Hinglish** (Telugu on request), with A/B subject-line + hook variants

Zenith writes the **copy only — the owner pastes it into Arkquen. Nothing is wired to Arkquen.** Tools: `draft_sequence`, `draft_ad_copy`, `draft_landing_copy` (output-only; no send). The same client brief also feeds proposals and pre-call briefs → one input, many outputs ("client copy factory"). (Validated this session against a real client, Shadnagar Heights.)

### 4.10 Memory — Markdown vault (Obsidian-style)  *(replaces Postgres-for-memory)*
A **local Markdown vault** Zenith reads/writes: daily logs, client notes/briefs, meeting notes, decisions. Tools: `search_notes` (read), `save_note` (action). Enables "what did I do last week?", "notes from the Acme call", and **voice-matched drafts** (Zenith learns the owner's writing style from the vault). The vault doubles as the Copy Factory's brief store. Local + private; matches the Phase-1 privacy stance.

### 4.11 Proactivity + message triage  *(pulled into Phase 1)*
Move from reactive (ask → answer) to proactive. A background watcher surfaces *what slipped* as floating HUD status cards: aging unanswered client messages (Gmail/WhatsApp), commitments made ("you said you'd send Rahul the proposal"), today's prep, approaching deadlines. **WhatsApp triage** of the owner's *own* personal + business messages: "who's waiting on a reply?" → drafts replies (confirm-gated). Builds on M3/M4 tools; respects the rate/token cap. (Background scheduler/poller, e.g. APScheduler.)

---

## 5. FUTURE FEATURES (Phase 2 — true SaaS / heavier)

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

### 5.4 Business-data module (the freelancer command center — heavy)
- A real data layer (DB) for clients, projects, invoices, hours
- Dashboards: revenue, profit, invoices pending, time tracking, upcoming deadlines, Quick Actions (Create Invoice / Send Proposal / Add Task)
- Killer feature: **talk to your business data** — "summarize my month, what should I focus on?" → structured answer
- Time tracking: **integrate** (Toggl/Clockify), don't rebuild. Trend indicators only once history is stored.
- (The lightweight Phase-1 version is just the Markdown vault, §4.10.)

### 5.5 Multi-User (SaaS)
- User authentication (Clerk)
- Each user brings their own API key (store **encrypted at rest**)
- Per-user rate limiting
- Razorpay payment integration
- Hosted backend + **PWA-installable** web app (no-download path) + optional desktop download

> **Note:** "Persistent memory" from earlier drafts is now a **Phase-1 Markdown vault** (§4.10), not a Phase-2 database.

### 5.6 Differentiation / moat & "DON'T BUILD"
**Positioning:** the field splits into pretty JARVIS clones (great UI, no real work) and serious assistants (powerful, no soul). Zenith's lane → *a proactive, Hinglish-speaking, WhatsApp-native assistant that handles the founder's work and acts with a visible trust layer (the confirm gate + activity log).* Aesthetics get attention; that sentence is the reason to pay. The two lead moats are **proactivity** and **WhatsApp triage of your own messages** (both §4.11).

**DON'T BUILD (saturated / non-differentiating — spend zero effort):**
- PC / system monitoring (CPU/GPU/disk/reactor/battery telemetry — cosplay)
- Calendar auto-scheduling à la Motion/Reclaim (just integrate Calendar, don't compete)
- WhatsApp Business customer-chatbots / lead-gen (a different product; saturated in India)
- Smart-home / IoT; more 3D holographic eye-candy

---

## 6. UI DESIGN SPECIFICATION

### Theme — clean app-style HUD (updated v1.3)
Modeled on **app-style HUD dashboards** (the dashboard mockups), NOT the dense film stills. Near-black canvas, one cyan, thin strokes, rounded **notched-corner cards**, generous spacing — **legibility over decoration**. **De-Marvel'd:** Zenith's own naming everywhere — "JARVIS / Stark / J.A.R.V.I.S. Cloud / Pepper" never appear in the UI; JARVIS is the internal codename only.

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

### Layout (Desktop)

```
+----------------------------------------------------------------+
|  ZENITH   Fri, 19 Jun 2026      * ONLINE      [usage] [gear]    |  top bar
+---------------+--------------------------+-----------------------+
|  CALENDAR     |                          |  CONNECTIONS          |
|  . 10:00 Mtg  |      ( ZENITH ORB )      |  Gmail      [*] on     |
|  . 14:00 Call |   connection-map core    |  Calendar   [*] on     |
|  . 17:00 Rev  |   nodes: Gmail Cal WA Dc  |  WhatsApp   [ ] off    |
|               |   (light up when linked) |  Discord    [ ] off    |
|  TOMORROW     |                          | --------------------- |
|  . 11:00 Demo |   state: listening...    |  ACTIVITY LOG         |
|               |                          |  create_event  OK     |
|  [left rail]  |  +--------------------+  |  email sent    OK     |
|   chat        |  | command center     |  |  rate warn 120/150    |
|   drafts      |  | paginated chat,    |  | --------------------- |
|   clients     |  | monospace, "1/6",  |  |  [ CONFIRM CARD ]     |
|   settings    |  | copy . save . share|  |  Send email to ...?   |
|               |  +--------------------+  |  [Confirm] [Cancel]   |
+---------------+--------------------------+-----------------------+
|  ~~ waveform (voice active) ~~    [ hold SPACE ] [ type... ] [>] |
+----------------------------------------------------------------+
```

### Orb — reactive connection-mesh  *(implemented; redesign queued — see note)*
The center orb is a glowing **core surrounded by a mesh of nodes** (Gmail / Calendar / WhatsApp / Discord) that light cyan when connected and **react to live audio** (mic + Zenith's voice) — it doubles as an at-a-glance "what can Zenith reach right now." Four states, **as currently implemented** in `ZenithOrb.tsx`:
- **Idle:** core bloom, calm mesh, slow drift
- **Listening:** brighter core, mesh reacts to mic level
- **Thinking:** core shifts blue (`#5aa0ff`) + a brief orbiting dot
- **Speaking:** core shifts orange (`#ff9a4d`), mesh reacts to TTS level

> **Redesign queued (`TODO.md`, mock/visual only):** the per-node scaling reads as "bleeding dots" while speaking. Plan: move the reaction to a breathing **core + inward-flowing edges** (calm mesh, no ballooning), drop the blue thinking-orbit and any concentric/orbital rings, and keep **all states cyan** (revisit the orange speaking accent). Plus a Command-Center minimize/restore control.

### HUD Elements
- **Command center (`CommandCenter.tsx`):** chat input + **mic (hold space) + send merged into one surface**, with a monospace response area (**copy / save / share** per answer), a **left context-rail** (`ContextRail` + `LeftRailExtras`: chat / drafts / clients / settings), a **QuickActions** strip and a **FocusCard**
- **Connections list (`ConnectionsPanel.tsx`):** connected accounts + status dots (multi-account Gmail, multiple WhatsApp numbers, Discord servers)
- **Activity log (`ActivityLog.tsx`):** timestamped feed of what Zenith did ("create_event → confirmed", "email sent", "rate-limit warning") — the audit trail that pairs with the confirm gate
- **Confirm / pending-action card — FIRST-CLASS:** a prominent `StatusCard` near the orb (this is the trust layer; never buried)
- **Real `/usage` gauge (`GaugeIndicator`):** API usage + daily cap + token budget (the ONE gauge kept)
- Top **timeline/status bar** (`TopBar`) · **hex corner accents** (`hud/primitives`, used sparingly). *(The standalone bottom waveform bar was dropped — voice activity now drives the reactive orb directly.)*
- **CUT — do NOT build:** fake telemetry (CPU/GPU/disk/reactor/battery), a standing weather/environment widget, the decorative data-feed line graph

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

> **Note (v1.4):** this is the **target** structure. The current backend is **flat** — `main.py`, `claude_service.py`, `memory_service.py`, `rate_limiter.py`, `stt_service.py`, `tts_service.py`, `tools.py`, plus tests (`test_stt.py`, `test_transcribe_route.py`, `test_speak_route.py`) live directly under `backend/` (no `routes/`/`services/`/`integrations/`/`database/` subdirs yet). Routes in `main.py`: `GET /`, `GET /usage`, `POST /transcribe`, `POST /speak`, `POST /chat`, `POST /chat/confirm` (no `/briefing` route yet). The frontend has `app/` (`page.tsx`, `layout.tsx`, `globals.css`) + `components/`: `ZenithOrb`, `CommandCenter` (chat input + mic + send merged), `ContextRail`, `LeftRailExtras`, `QuickActions`, `FocusCard`, `CalendarPanel`, `ConnectionsPanel`, `ActivityLog`, `PlaceholderView`, `GaugeIndicator`, `StatusCard`, `TopBar`, `Markdown`, `hud/primitives.tsx` + `lib/` (`voice.ts`, `format.ts`, `mock.ts`). Since v1.2, `CommsPanel` was split into `ConnectionsPanel` + `ActivityLog` and the standalone `WaveformBar` was removed (the orb is now the voice visualizer). No `calendar/`/`inbox/`/`settings/` pages and **no `src-tauri/` yet**. Refactor toward the tree below as integrations land.

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
- App-style HUD **built** per the v1.3 direction: reactive connection-mesh orb (4 states), merged **Command Center** (chat + mic + send), `ContextRail` + `LeftRailExtras`, `QuickActions`, `FocusCard`, `CalendarPanel`, `ConnectionsPanel`, `ActivityLog`, gauges, status cards, top bar — still rendering `lib/mock.ts` placeholder data
- Voice in (faster-whisper `/transcribe`) ✅ + out (edge-tts `/speak`) ✅; empty/undecodable mic clips handled as no-speech (no 500) ✅
- Markdown reply rendering + emoji-strip ✅
- **Remaining:** orb/HUD visual redesign (`TODO.md` — calmer mesh, core+edge reaction, drop rings, Command-Center minimize); wire panels to live data; scaffold the Tauri desktop shell (`src-tauri/`) + grant mic permission there

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

### Milestone 6 — Memory vault + Copy Factory  *(Phase 1)*
- **Memory = local Markdown vault** (Obsidian-style), tools `search_notes` + `save_note`; daily logs, client briefs, decisions; voice-matched drafts (§4.10)
- **Copy Factory / Template Studio:** intake-form-as-brief → email sequences, WABA templates (category-tagged), ad copy + creative briefs, landing/funnel copy, in EN/HI/Hinglish. Output-only; paste into Arkquen (§4.9)

### Milestone 7 — Proactivity + WhatsApp triage  *(Phase 1)*
- Background watcher (e.g. APScheduler) → "what slipped" as floating status cards
- WhatsApp triage of your OWN messages: "who's waiting on a reply?" → confirm-gated drafts (§4.11)

> **Phase 2 (after the personal driver is solid):** multi-user auth (Clerk), per-user encrypted keys, Razorpay billing, hosted backend + PWA, the full **business-data dashboard** (§5.4), and optional Computer Use / Higgsfield.

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
- **Arkquen = OUT of scope** (white-label subscription being rebuilt — a moving target). Arkquen runs the *client machine*; Zenith runs the *founder*. No integration. (§2, §4.9)
- **Memory = Markdown vault** (Obsidian-style), not Postgres — local, private, and it doubles as the Copy Factory's brief store. (§4.10)
- **UI direction (v1.3):** app-style dashboards, not film stills — connection-map orb, paginated chat + left rail, Connections list, Activity log, first-class confirm card, fake telemetry cut, de-Marvel'd. (§6)
- **Differentiation / DON'T BUILD:** see §5.6 — lead on proactivity + WhatsApp triage; skip system monitoring, Motion-style auto-scheduling, WABA customer-chatbots, smart-home, and 3D eye-candy.
- **Phasing call (this session):** the personally-useful "future" features (Copy Factory, memory vault, proactivity, WhatsApp triage) were pulled into **Phase 1** because it's a daily driver for the owner; only true SaaS machinery stays Phase 2.

---

## 16. FUTURE ROADMAP

### Phase 1 — later milestones (pulled in from "future" this session)
- [ ] M6: Memory vault (Markdown / Obsidian-style) + Copy Factory / Template Studio
- [ ] M7: Proactivity engine + WhatsApp triage of your own messages

### Phase 2 — Scale (Month 2-3)
- [ ] Host backend + PWA-installable web app + optional desktop download
- [ ] Multi-user auth (Clerk) + per-user encrypted keys + per-user rate limits
- [ ] Business-data dashboard (clients / projects / invoices / time; "talk to your business data")
- [ ] Cloud STT (Deepgram) for multi-user voice
- [ ] Optional / experimental: Anthropic Computer Use API · Higgsfield video/ad generation

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

*PRD Version 1.4 | Updated: June 2026 (from v1.3 · v1.2 · v1.1 · v1.0, June 15, 2026)*
*Next Step: finish Milestone 2 — orb/HUD visual redesign (`TODO.md`: calmer mesh, core+edge reaction, drop rings, Command-Center minimize), then wire HUD panels off `lib/mock.ts` to live data + scaffold the Tauri shell (`src-tauri/`) → then Milestone 3 (Google OAuth + Calendar/Gmail tools + morning briefing).*
