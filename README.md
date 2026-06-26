# Zenith

A full-stack **personal AI assistant** you actually talk to. Hold a key, speak, and Zenith
listens, thinks, and answers back in a natural voice — on a glowing HUD built to feel like
something out of Iron Man. Codename **JARVIS**; she answers to the wake word **"Zenith."**

Zenith is a personal daily-driver, not a chatbot demo: **Claude is the brain**, a Python backend
gives her **tools** to do real work, and every action that sends or changes something passes
through a **confirm gate** you can see. The interface is a custom WebGL HUD with a reactive
particle-sphere orb and three switchable **skins**.

> **Status — Phase 1 (personal use).** The brain, the voice loop (speech in + out), and the full
> HUD with skins are **live and working locally**. **Google Calendar + Gmail** (Milestone 3) and
> **Discord + a Telegram phone-remote** (Milestone 4) are wired and live-verified. **Milestone 5
> (hardening)** is underway: a backend API-token gate + prompt-injection guard shipped
> ([SECURITY.md](SECURITY.md)), and the real **usage/cost dashboard** + **Settings page** are in.
> Every integration is just new entries in the tool list — **the chat route never changes**.

---

## What Zenith does

- **Talk to her by voice** — hold **Space** (push-to-talk), speak, release. Or just type.
- **She talks back** — replies are spoken with a natural neural voice, fully offline-capable.
- **She uses tools, not just words** — Claude decides when to call a tool; the backend runs it
  and feeds the result back. Read-only tools (e.g. "what time is it?") run instantly; **action**
  tools (send a message, create/delete an event) **pause and ask you to confirm first**.
- **You can see what she did** — a first-class confirm card + an activity log are the trust layer.
- **She stays within budget** — a hard rate-limit / token kill-switch protects your API spend.
- **She runs your Google** *(M3)* — "what's on my calendar today?", "any unread email?", "schedule a
  call tomorrow 4pm" (confirm), "email Rahul I'm running late" (confirm), and "good morning" for a
  spoken briefing (events + unread + weather). One-time [setup](SETUP-GOOGLE.md).
- **She's on Discord** *(M4)* — "latest messages in #general?", "send 'on my way' to #team"
  (confirm). Server channels only — never your DMs. One-time [setup](SETUP-DISCORD.md).
- **She's on your phone via Telegram** *(M4)* — text the *same* brain remotely; the confirm gate
  comes back as inline buttons. Locked to an allow-list of user IDs. One-time [setup](SETUP-TELEGRAM.md).

**Coming next**: WhatsApp (personal + business), a local Markdown **memory vault**, and a
**Copy Factory** that drafts email sequences / ad copy / proposals in your own voice. See `JARVIS_PRD.md`.

---

## How it works

**Claude is the brain. The backend gives it hands.** FastAPI defines the tools; Claude decides
which to call; FastAPI executes them against the real world and returns the results. Every new
capability is **one more entry in the tool list** — the chat route never changes.

The voice round-trip:

```
  🎤 hold Space ──▶  POST /transcribe   (Whisper STT, local, English default)
                          │  text
                          ▼
                     POST /chat          (Claude + last-20 history + rate limit + tools)
                          │
            ┌─────────────┴──────────────┐
       read-only tool                action tool
        runs now                  ⏸ returns a "pending action"
            │                          │  → HUD shows a confirm card
            │                          ▼
            │                     POST /chat/confirm  {approved}
            │                          │
            └─────────────┬────────────┘
                          ▼  reply text
                     POST /speak         (Kokoro TTS → WAV, or edge-tts → MP3)
                          │
                          ▼
                  🔊 the HUD plays the audio + renders the reply as markdown
```

**The confirm gate** is the whole trust model: anything that *sends* or *changes* state
(`send_message`, and later `send_email` / `create_event` / `delete_*`) never fires on its own — it
returns a pending action, the HUD shows a confirm card, and only `POST /chat/confirm` runs it.

---

## The HUD & skins

The frontend is a custom **app-style HUD** (not a chat window): a centre **particle-sphere orb**
(react-three-fiber / WebGL, ~28k particles, additive bloom, a bright breathing core) that's
**audio-reactive** to both your mic and Zenith's voice, surrounded by labelled connection nodes
(Gmail / Calendar / WhatsApp / Discord), a merged **Command Center** (chat + push-to-talk + send),
a calendar panel, a connections list, an activity log, and a real API-usage gauge.

**Three skins**, switchable live from the **Settings** view (the whole palette is tokenized into
CSS variables keyed by `data-skin`, so every component — and the orb — re-themes instantly, with a
blur-mask crossfade and no flash on reload):

| Skin | Look | Layout | Orb |
|------|------|--------|-----|
| **Arc** *(default)* | Cyan-on-near-black HUD, notched corners, glow | Dense 4-column dashboard | Cyan particle sphere |
| **Ghost** | Light **paper + graphite ink**, matte, square corners | Centered focus (side columns hidden) | Ink-network web (no bloom) |
| **Amethyst** | Violet, **rounded frosted glass** | Bento grid (orb as a 2×2 hero tile) | Violet particle sphere |

---

## Tech stack

- **Frontend** — Next.js 14 + Tailwind CSS + TypeScript; **react-three-fiber / three.js / drei /
  postprocessing** for the WebGL orb; GSAP for the boot sequence.
- **Backend** — Python **FastAPI**.
- **Brain** — Claude (Anthropic API) via **tool use / function calling**.
- **Speech-in (STT)** — **faster-whisper**, local/offline. English by default for speed; a Hinglish
  (Hindi → Latin) path is kept dormant behind a flag. GPU-accelerated (CUDA) or CPU fallback.
- **Speech-out (TTS)** — **Kokoro** neural voices, local/offline (default); **edge-tts** (Microsoft
  neural, needs internet) as a one-flag fallback. Served from the backend at `/speak`.
- **Desktop shell** (Phase 1, planned) — **Tauri**.

---

## Run it locally

**Prerequisites:** Python **3.11** (Kokoro's deps have no 3.12+ wheels), Node.js 18+, and an
Anthropic API key — <https://console.anthropic.com>.

### 1. Backend — FastAPI on `:8000`

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # then edit .env and paste your ANTHROPIC_API_KEY
uvicorn main:app --port 8000         # no --reload — the reloader double-loads the voice models
```

On boot the server loads the Whisper STT model and warms both voice engines (so the first call
isn't a slow cold-start) — expect **~30–45s** to "ready" the first time, longer if model weights
are still downloading. Watch the log for the active STT/TTS device.

### 2. Frontend — Next.js on `:3000`

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. (The backend's CORS allows `:3000` by default.) Press **Space** to
talk, or type in the Command Center. Switch skins from **Settings**.

> **Lock it down (recommended).** Set `ZENITH_API_TOKEN` in `backend/.env` to a random string and
> the **same** value as `NEXT_PUBLIC_ZENITH_API_TOKEN` in `frontend/.env.local`. The backend then
> requires the `X-Zenith-Token` header on every route (401 without it) and the HUD sends it
> automatically. Left unset, Zenith runs localhost-only with a loud startup warning. Full details in
> **[SECURITY.md](SECURITY.md)**. Generate a token with
> `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

### 3. Connect Google *(optional, Milestone 3)*

Calendar + Gmail tools need a one-time Google Cloud OAuth client. Follow
**[SETUP-GOOGLE.md](SETUP-GOOGLE.md)** (~10 min), paste the keys into `backend/.env`, then click
**Connect Google** in the HUD's Connections panel. Until you do, those tools just report "not
connected" and the panels show a Connect button — nothing breaks.

---

## Configuration (`backend/.env`)

| Variable | What it does | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key (**required**) | — |
| `ZENITH_API_TOKEN` | Shared secret for the `X-Zenith-Token` header; must match the frontend's `NEXT_PUBLIC_ZENITH_API_TOKEN` ([SECURITY.md](SECURITY.md)) | — *(localhost-only)* |
| `WHISPER_MODEL` | STT model (`small` / `medium` / `large-v3`) | `small` |
| `WHISPER_DEVICE` | `cpu` or `cuda` | `cpu` |
| `WHISPER_COMPUTE` | e.g. `int8`, `float16` | `int8` |
| `WHISPER_LANGUAGE` | `en` (default), or blank/`hi` to re-enable the Hinglish path | `en` |
| `ZENITH_TTS_ENGINE` | `kokoro` (local) or `edge` (online fallback) | `kokoro` |
| `ZENITH_TTS_VOICE` | edge-tts voice (e.g. `en-IN-NeerjaNeural`) | `en-IN-NeerjaNeural` |
| `ZENITH_KOKORO_VOICE` | Kokoro voice (`af_heart`, `am_michael`, `bm_george`…) | `af_heart` |
| `ZENITH_KOKORO_DEVICE` | `cpu` or `cuda` for local TTS | `cpu` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (Calendar + Gmail) — see [SETUP-GOOGLE.md](SETUP-GOOGLE.md) | — |
| `WEATHER_API_KEY` / `WEATHER_DEFAULT_LOCATION` | OpenWeatherMap key + default city for the briefing | — |
| `DISCORD_BOT_TOKEN` | Discord bot token (Message Content intent) — see [SETUP-DISCORD.md](SETUP-DISCORD.md) | — |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USER_IDS` | Telegram remote + its numeric allow-list (fail-closed) — see [SETUP-TELEGRAM.md](SETUP-TELEGRAM.md) | — |
| `ZENITH_DEBUG_LOGS` | `1`/`true` to log full tool inputs + results while debugging (default scrubs bodies) | — |
| `NEWS_FEEDS` | Comma-separated `Label\|RSS-url` briefing feeds | world + India |

> **GPU note:** the code defaults to CPU so a fresh clone just works. On an NVIDIA box, set
> `WHISPER_DEVICE=cuda` + `ZENITH_KOKORO_DEVICE=cuda` (with a CUDA-matched torch build) to cut a
> paragraph of speech from ~17s to ~1s and free the CPU. The CUDA→CPU fallback is safe and logged.

---

## API endpoints

| Method & path | Purpose |
|---|---|
| `GET /` | Liveness ping |
| `GET /health` | Version + active STT/TTS engine/device/fallback + security posture (auth, debug-logs) |
| `GET /usage` | Request/token counters, estimated ₹/$ cost, and kill-switch vs. the daily caps |
| `POST /transcribe` | Audio clip → transcript (Whisper) |
| `POST /speak` | Text → spoken audio (Kokoro WAV / edge-tts MP3) |
| `POST /chat` `{message}` | → `{reply, warning}` **or** `{pending, tool, id}` (action needs confirming) |
| `POST /chat/confirm` `{id, approved}` | Resume a pending action → `{reply}` |
| `GET /google/status` | Connected Google accounts (drives the Connections panel + orb nodes) |
| `POST /google/connect` · `/google/disconnect` | Start / clear the Google OAuth flow |
| `GET /calendar/events?when=` | Live events for the calendar panel (today / tomorrow / date / range) |
| `GET /discord/status` | Discord bot connection (lights the orb Discord node + Connections row) |
| `GET /telegram/status` | Telegram remote connection + allow-list size |
| `GET /activity` | Recent successful tool runs (drives the HUD Activity Log) |

Every route **except `GET /` and `GET /health`** requires the `X-Zenith-Token` header once
`ZENITH_API_TOKEN` is set (401 otherwise); unset = localhost-only with a startup warning ([SECURITY.md](SECURITY.md)).

**Rate limits / budget** (in-memory, reset on restart): **5 req/min** (6th → HTTP 429),
**150 req/day**, a warning in the reply from **120/day**, and a hard **300k-token/day** kill-switch.

---

## Troubleshooting

- **Slow replies / "the PC lags when she speaks"** — the voice models are on CPU. Open
  `GET /health`: `whisper.device` / `tts.device` should read `cuda` on a GPU box. If
  `whisper.fallback` is `true`, CUDA was requested but **silently fell back to CPU** — install a
  CUDA-matched torch + `nvidia-cudnn`/`nvidia-cublas`, then re-check `/health`.
- **HUD shows "Can't reach the backend"** — is `uvicorn` up on `:8000`? And if `ZENITH_API_TOKEN`
  is set, the frontend's `NEXT_PUBLIC_ZENITH_API_TOKEN` must match it exactly, or every call 401s.
- **First reply of the session is slow** — the boot warmups (~30–45s) front-load model init so the
  *first* real call isn't a cold-start. Wait for the `Application startup complete` log line.
- **Settings / panels look stuck "loading"** — that's the backend being unreachable; the Usage and
  Settings panels expose a **Retry**. Confirm the token pairing above.

---

## Project layout

```
backend/                FastAPI app
  main.py               routes (/chat, /transcribe, /speak, /usage, /health, …)
  chat_core.py          the shared chat loop (used by /chat AND the Telegram bot)
  claude_service.py     the tool-use loop + Zenith's system prompt
  tools.py              TOOLS, ACTION_TOOLS, run_tool  ← add real integrations here
  auth.py               X-Zenith-Token gate (M5) · secure_files.py  .env/token perms (M5)
  google_auth.py        Google OAuth + per-account token storage (M3)
  google_service.py     Calendar + Gmail wrappers (M3)
  weather_service.py    OpenWeatherMap · news_service.py  RSS headlines (briefing)
  discord_service.py    discord.py bot on the event loop + sync bridge (M4)
  telegram_service.py   python-telegram-bot remote, allow-list locked (M4)
  memory_service.py     per-channel last-20 history · activity_log.py  tool-run feed
  rate_limiter.py       per-minute / per-day / token caps + ₹/$ cost estimate
  stt_service.py        faster-whisper (speech in)
  tts_service.py        Kokoro / edge-tts (speech out)
frontend/               Next.js HUD
  app/                  page.tsx (layout per skin), globals.css (skin tokens)
  components/           ZenithOrb, CommandCenter, SkinPicker, UsagePanel, SettingsView, panels…
  lib/skins.ts          skin registry · lib/api.ts  typed fetch helpers + apiFetch (token)
docs/                   design specs + implementation plans (incl. the skin system)
SETUP-GOOGLE.md         one-time Google Cloud OAuth walkthrough (M3)
SETUP-DISCORD.md        one-time Discord bot walkthrough (M4)
SETUP-TELEGRAM.md       one-time Telegram bot walkthrough (M4)
SECURITY.md             the API-token gate, prompt-injection guard, secrets-at-rest (M5)
JARVIS_PRD.md           full product requirements & roadmap
CLAUDE.md               engineering context / decisions log
```

**Adding a real tool** = add a schema to `TOOLS`, an executor branch in `run_tool`, and (if it
acts) its name in `ACTION_TOOLS`. The chat route and confirm gate handle the rest unchanged.

---

## Roadmap

- [x] **Slice 0 / Milestone 1 — The Brain:** Claude tool-use loop, history, rate-limit kill-switch, confirm gate.
- [~] **Milestone 2 — HUD + Voice:** WebGL particle-sphere orb, Command Center, panels, voice in/out, **skins (Arc / Ghost / Amethyst) shipped**. *Remaining: wire panels to live data, Tauri desktop shell.*
- [x] **Milestone 3 — Google:** Calendar + Gmail as tools (OAuth, least-privilege), weather + spoken morning briefing, live Connections/Calendar/Activity panels. *Shipped + live-verified. One-time [Google setup](SETUP-GOOGLE.md).*
- [x] **Milestone 4 — Messaging:** **Discord** — 4 tools (list / read / search / send-gated) via a discord.py bot, **server channels only (no DMs)**; orb node + Connections + Activity Log go live. Plus a **Telegram remote** — a phone front-end into the *same* brain (not a tool; allow-list-locked; the confirm gate comes back as inline buttons). The orb's WhatsApp node became **Telegram** ([setup](SETUP-TELEGRAM.md)). *Both Discord + Telegram are live-verified + shipped.* **WhatsApp-personal is parked** (ban-risk bridge).
- [~] **Milestone 5 — Hardening:** **part 1 shipped** — backend `X-Zenith-Token` gate, prompt-injection guard, secrets-at-rest, log scrubbing ([SECURITY.md](SECURITY.md)). **Part 2 (this pass):** real usage/cost dashboard + Settings page + README/`.env` + error/empty/loading audit + tests.
- [ ] **Milestone 6 — Memory vault + Copy Factory.**
- [ ] **Milestone 7 — Proactivity + message triage.**

Full detail and the reasoning behind each decision live in `JARVIS_PRD.md` and `CLAUDE.md`.
