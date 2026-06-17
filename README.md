# Zenith — Milestone 1 (The Brain)

Claude runs the real **tool-use loop**: it can call tools, read-only tools run immediately, and action tools pause for your confirmation — proven with stub tools so real integrations drop in later with **no chat-route changes**. Built on Slice 0. No voice, full HUD, or real integrations yet (later milestones — see `JARVIS_PRD.md`).

## Prerequisites
- Python 3.10+ (3.11–3.13 recommended for prebuilt wheels)
- Node.js 18+
- An Anthropic API key — https://console.anthropic.com

## 1. Backend — FastAPI on :8000

```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                  # then edit .env and paste your ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```

**Voice (Pass B):** the server loads the faster-whisper model at startup
(~140MB for `base`, downloaded once to the Hugging Face cache). No ffmpeg
needed — faster-whisper bundles audio decoding. Tune via the `WHISPER_*`
vars in `backend/.env` (`base`/`cpu`/`int8` suits an 8GB Mac; a GPU rig can
use `small`/`cuda`/`float16`).

## 2. Frontend — Next.js on :3000

In a second terminal:

```bash
cd frontend
npm install
cp .env.local.example .env.local      # optional; defaults to http://localhost:8000
npm run dev
```

Open http://localhost:3000.

## What Zenith can do now (Milestone 1)
Claude runs a tool-use loop. Read-only tools run immediately; action tools pause for your confirmation.

**Endpoints**
- `POST /chat` `{message}` → `{reply, warning}` **or** `{pending, tool, id, warning}` (an action needs confirmation)
- `POST /chat/confirm` `{id, approved}` → resumes the turn → `{reply}` (or another `pending`)

**Stub tools** (real integrations replace these later with no route changes):
- `get_current_time` — read-only
- `send_message(to, body)` — action → requires confirmation (logs "sent (stub)")

### Try it (browser)
- Plain: "kaise ho?" → a normal reply, no tools.
- Read-only tool: "what time is it?" → Claude calls `get_current_time` (see the `[tool] ...` server log) and answers.
- Action + confirm: "send a message to Rahul saying I'm running late" → a ConfirmCard appears.
  - **Confirm** → the stub runs (server logs `[tool] send_message(...)`) and Zenith confirms.
  - **Cancel** → nothing runs; Zenith acknowledges ("Theek hai Boss, nahi bhej raha.").

### Try it (curl)
```bash
# read-only tool
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"message":"what time is it?"}'

# action → returns a pending action with an id
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" \
  -d '{"message":"send a message to Rahul saying I am running late"}'

# confirm it (use the id from the response above)
curl -X POST http://localhost:8000/chat/confirm -H "Content-Type: application/json" \
  -d '{"id":"<id-from-pending>","approved":true}'
```

## Rate limits & budget (in-memory, reset on restart)
- 5 requests / minute — the 6th within a minute returns HTTP 429.
- 150 requests / day — blocked after that.
- Warning in the reply payload from 120/day.
- 300,000 tokens / day — hard kill-switch (blocks further requests).

## Architecture (tool-agnostic)
`backend/`: `main.py` (routes) · `claude_service.py` (the loop + Zenith prompt) · `tools.py` (`TOOLS`, `ACTION_TOOLS`, `run_tool`) · `memory_service.py` (last-20 history, tool turns included) · `rate_limiter.py`.

Adding a real tool later = add a schema to `TOOLS` + an executor in `run_tool` + (if it acts) its name in `ACTION_TOOLS`. The chat route never changes.

## What's NOT here yet (later milestones)
Real integrations (Gmail / Calendar / WhatsApp / Discord), voice (faster-whisper + TTS), the full Iron-Man HUD, the Tauri desktop shell, PostgreSQL / persistence, auth, and settings. See `JARVIS_PRD.md` → Build Order.
