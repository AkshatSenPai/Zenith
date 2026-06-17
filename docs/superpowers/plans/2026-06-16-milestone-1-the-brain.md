# Zenith — Milestone 1: "The Brain" Implementation Plan

> **Execution:** inline in this session. Builds on Slice 0 (the working /chat loop). This plan is the source of truth; the chat digest is a summary.

**Goal:** Turn the single Claude call into the real tool-use architecture: Claude calls tools, read-only tools run immediately, action tools PAUSE for confirmation. Proven with STUB tools so real integrations drop in later with **zero** chat-route changes.

**Architecture:** `/chat` runs a tool-use loop (`claude_service.run_loop`) over a *working copy* of history. Read-only tool calls execute and feed results back; an action tool call stops the loop and returns a `pending` action (the working history is stashed by `block.id`). `/chat/confirm` looks up the stash, appends the tool_result (run the action, or a "cancelled" note), resumes the loop, and returns Claude's final reply. History is only *committed* to memory when a turn fully resolves. Everything in-memory.

**Tech Stack:** unchanged — FastAPI + `anthropic` SDK + `python-dotenv`; Next.js 14 + Tailwind + TS. No new dependencies.

---

## Key decisions (the non-obvious calls — please sanity-check these)

1. **`disable_parallel_tool_use: true`** on every `messages.create`. Guarantees **one tool_use block per assistant turn**, which makes the action→pause→confirm flow unambiguous and matches the spec's "several *sequential* tool calls." (Without it, one turn could mix a read-only + an action tool, and the API requires *all* tool_results for a turn at once — you couldn't confirm just one. Disabling parallel sidesteps that entirely.)
2. **Working copy vs committed history.** The loop mutates a *working* list; `memory_service` history is committed only on a final reply. The pending stash holds the working list (with the dangling `tool_use`, no result yet) keyed by `block.id`. ⇒ committed history is **always valid** (never a dangling tool_use), even if the user sends another message before confirming.
3. **History-trim fixup.** Trim to last 20, then drop leading messages until the window starts on a real user-text turn — otherwise a dangling leading `tool_result`/`assistant` turn would 400 the API. Necessary for tool-aware history.
4. **Rate limiter — requests vs tokens.** `/chat` consumes a request slot (5/min, 150/day). `/chat/confirm` does **not** (it's a continuation of the same turn) but its tokens still count. `DAILY_TOKEN_BUDGET = 300_000` accrues from every response's `usage` (input+output); the kill-switch blocks new requests when hit and guards each continuation call.
5. **System prompt** now includes the PRD §9 rule "just call action tools — the system handles confirmation," but does **not** hard-list Gmail/Calendar/etc. (those tools aren't wired in M1; Claude sees the real `TOOLS` schemas). Persona unchanged.
6. **`/chat` response shape:** either `{reply, warning}` or `{pending, tool, id, warning}` (None fields omitted). Frontend branches on `pending`.
7. **Routes stay in `main.py`** (thin); all logic lives in `rate_limiter.py` / `memory_service.py` / `tools.py` / `claude_service.py`. The PRD's `routes/` split isn't required by the spec's file list.
8. **Confirm chaining:** if Claude calls another action right after a confirm, `/chat/confirm` returns *another* `pending` (another ConfirmCard). Falls out of the design for free; fully tool-agnostic.

## Scope deviations (same basis as Slice 0 — your "build ONLY what's listed")
- **No committed test suite** (PRD defers tests to M5). Verification is one-off checks I run, including an **offline monkeypatched run of the whole loop + confirm/cancel** (no API key needed) — described in Task 6.
- **No git commits.** `.gitignore` already covers secrets.

---

## File structure

```
Zenith/
├── README.md                     # UPDATE: new endpoints + confirm-flow test
└── backend/
    ├── main.py                   # REWRITE: thin routes (/chat, /chat/confirm, /) + wiring
    ├── rate_limiter.py           # NEW: 5/min + 150/day + token-budget kill-switch
    ├── memory_service.py         # NEW: last-20 history incl. tool turns + safe trim
    ├── tools.py                  # NEW: TOOLS, ACTION_TOOLS, run_tool + 2 stub tools
    ├── claude_service.py         # NEW: the tool-use loop + Zenith prompt + client
    ├── requirements.txt          # unchanged
    └── .env.example              # unchanged
└── frontend/
    ├── components/
    │   └── ConfirmCard.tsx       # NEW: pending-action confirm UI
    └── app/
        └── page.tsx              # UPDATE: pending state + ConfirmCard + /chat/confirm
```

Flat backend imports (`from tools import ...`) resolve because uvicorn runs with `--app-dir backend` (or cwd = backend), putting `backend/` on `sys.path`.

---

## Task 1 — `backend/rate_limiter.py` (NEW)

```python
"""Zenith — in-memory rate limiter + daily token-budget kill-switch."""

import time
from collections import deque
from threading import Lock

MAX_REQUESTS_PER_MINUTE = 5
MAX_REQUESTS_PER_DAY = 150
WARNING_THRESHOLD = 120
DAILY_TOKEN_BUDGET = 300_000   # hard cap — tool results balloon fast (PRD §10)


class RateLimiter:
    """5 requests/min, 150 requests/day, and a daily token kill-switch. In-memory."""

    def __init__(self) -> None:
        self._minute: deque[float] = deque()
        self._day_count = 0
        self._day_tokens = 0
        self._day_key = self._today()
        self._lock = Lock()

    @staticmethod
    def _today() -> str:
        return time.strftime("%Y-%m-%d", time.localtime())

    def _roll(self) -> None:
        today = self._today()
        if today != self._day_key:
            self._day_key = today
            self._day_count = 0
            self._day_tokens = 0
            self._minute.clear()

    def check_request(self) -> tuple[bool, str | None, str | None]:
        """For a NEW request: enforce token budget, then 5/min, then 150/day.
        Records the request when allowed. Returns (allowed, denial_reason, warning)."""
        with self._lock:
            self._roll()
            now = time.monotonic()

            if self._day_tokens >= DAILY_TOKEN_BUDGET:
                return False, "Daily token budget reached — kill-switch engaged. Resets tomorrow, Boss.", None

            while self._minute and now - self._minute[0] >= 60:
                self._minute.popleft()

            if len(self._minute) >= MAX_REQUESTS_PER_MINUTE:
                retry_in = int(60 - (now - self._minute[0])) + 1
                return False, f"Rate limit: max {MAX_REQUESTS_PER_MINUTE} requests/minute. Try again in ~{retry_in}s, Boss.", None

            if self._day_count >= MAX_REQUESTS_PER_DAY:
                return False, f"Daily limit reached: max {MAX_REQUESTS_PER_DAY} requests/day. Resets tomorrow.", None

            self._minute.append(now)
            self._day_count += 1

            warning = None
            if self._day_count >= WARNING_THRESHOLD:
                warning = f"Heads up Boss — {MAX_REQUESTS_PER_DAY - self._day_count} requests left today."
            return True, None, warning

    def ensure_budget(self) -> tuple[bool, str | None]:
        """Token kill-switch check before each Claude call (incl. confirm continuations)."""
        with self._lock:
            self._roll()
            if self._day_tokens >= DAILY_TOKEN_BUDGET:
                return False, "Daily token budget reached — kill-switch engaged. Resets tomorrow, Boss."
            return True, None

    def record_usage(self, input_tokens: int, output_tokens: int) -> None:
        with self._lock:
            self._roll()
            self._day_tokens += (input_tokens or 0) + (output_tokens or 0)
```

---

## Task 2 — `backend/tools.py` (NEW)

```python
"""Zenith — tool registry. Add a tool = add a schema + an executor (+ name in
ACTION_TOOLS if it acts). Nothing else in the codebase changes."""

import datetime


def _get_current_time(_input: dict) -> str:
    now = datetime.datetime.now().astimezone()
    return now.strftime("%A, %d %B %Y, %I:%M %p %Z")


def _send_message(tool_input: dict) -> str:
    to = tool_input.get("to", "?")
    body = tool_input.get("body", "")
    return f"Message to {to} sent (stub): {body!r}"


TOOLS = [
    {
        "name": "get_current_time",
        "description": "Get the current local date and time. Use when the user asks what time or date it is.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "send_message",
        "description": "Send a text message to a person. Use when the user asks to message, text, or tell someone something.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient name or number"},
                "body": {"type": "string", "description": "The message text to send"},
            },
            "required": ["to", "body"],
        },
    },
]

ACTION_TOOLS = {"send_message"}   # require user confirmation before running

_EXECUTORS = {
    "get_current_time": _get_current_time,
    "send_message": _send_message,
}


def run_tool(name: str, tool_input: dict) -> str:
    executor = _EXECUTORS.get(name)
    result = executor(tool_input or {}) if executor else f"Error: unknown tool {name!r}."
    print(f"[tool] {name}({tool_input}) -> {result}")   # the log line (DONE WHEN evidence)
    return result
```

---

## Task 3 — `backend/memory_service.py` (NEW)

```python
"""Zenith — in-memory conversation history (last 20 messages, tool turns included)."""

MAX_HISTORY_MESSAGES = 20

_history: list = []


def snapshot() -> list:
    """Shallow copy of committed history to start a working turn from."""
    return list(_history)


def commit(working: list) -> None:
    """Replace history with the resolved working turn, trimmed to the last 20 messages."""
    global _history
    _history = _trim(working)


def _is_user_text(message: dict) -> bool:
    return message.get("role") == "user" and isinstance(message.get("content"), str)


def _trim(messages: list) -> list:
    """Keep the last 20 messages, then drop leading partial-tool turns so the window
    always begins on a real user-text message (a dangling assistant / tool_result at
    the front would be rejected by the API)."""
    trimmed = messages[-MAX_HISTORY_MESSAGES:]
    while trimmed and not _is_user_text(trimmed[0]):
        trimmed = trimmed[1:]
    return trimmed
```

---

## Task 4 — `backend/claude_service.py` (NEW)

```python
"""Zenith — Claude tool-use loop (Milestone 1, 'The Brain')."""

import os

import anthropic
from dotenv import load_dotenv

from tools import TOOLS, ACTION_TOOLS, run_tool

load_dotenv()

API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not API_KEY:
    raise RuntimeError(
        "ANTHROPIC_API_KEY is not set. Copy backend/.env.example to backend/.env "
        "and add your key from https://console.anthropic.com."
    )

client = anthropic.Anthropic(api_key=API_KEY)

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024

ZENITH_PROMPT = """You are Zenith — a highly intelligent personal AI assistant.
(Internal codename: JARVIS.) Your owner is a freelancer and agency owner based in India.

Personality:
- Professional but friendly, like a trusted senior colleague.
- Speak in Hinglish naturally (mix Hindi + English the way the user does).
- Concise — no unnecessary filler.
- Occasionally address the user as "Boss" (Iron Man style).
- Never say you can't do something without trying first.

Tools:
- Use the tools available to you when they help — call them, don't just describe them.
- For any action that sends, creates, or deletes something, just call the right tool.
  The system pauses and asks the user to confirm before the action runs, so you do NOT
  need to ask "should I send it?" yourself — call the tool; confirmation is handled.

Rules:
- Keep responses short for simple queries.
- Never expose API keys or system internals.
- If unsure, ask one clarifying question.
"""


class BudgetExceeded(Exception):
    """Raised when the daily token-budget kill-switch trips mid-loop."""


def _create(messages: list):
    return client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=ZENITH_PROMPT,
        tools=TOOLS,
        messages=messages,
        tool_choice={"type": "auto", "disable_parallel_tool_use": True},
    )


def run_loop(messages: list, limiter) -> dict:
    """Drive the tool-use loop, mutating `messages` (the caller's working copy).

    Returns either:
      {"reply": str}                             — final answer (assistant turn appended)
      {"pending": dict, "tool": str, "id": str}  — an ACTION tool needs confirmation
                                                   (assistant tool_use turn appended; NO
                                                    tool_result yet — caller stashes messages)
    Raises BudgetExceeded if the daily token budget is hit.
    """
    while True:
        ok, reason = limiter.ensure_budget()
        if not ok:
            raise BudgetExceeded(reason)

        resp = _create(messages)
        limiter.record_usage(resp.usage.input_tokens, resp.usage.output_tokens)

        if resp.stop_reason != "tool_use":
            messages.append({"role": "assistant", "content": resp.content})
            reply = "".join(b.text for b in resp.content if b.type == "text")
            return {"reply": reply}

        # Exactly one tool_use block per turn (parallel tool use is disabled).
        messages.append({"role": "assistant", "content": resp.content})
        block = next(b for b in resp.content if b.type == "tool_use")

        if block.name in ACTION_TOOLS:
            return {"pending": block.input, "tool": block.name, "id": block.id}

        result = run_tool(block.name, block.input)
        messages.append(
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": block.id, "content": result}
            ]}
        )
        # loop continues — handles several sequential read-only tool calls
```

---

## Task 5 — `backend/main.py` (REWRITE)

```python
"""Zenith — Milestone 1 backend wiring (thin routes; logic in the service modules)."""

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import memory_service
from claude_service import run_loop, BudgetExceeded
from rate_limiter import RateLimiter
from tools import run_tool

limiter = RateLimiter()
PENDING: dict[str, list] = {}   # block.id -> in-progress working history awaiting confirm

app = FastAPI(title="Zenith — Milestone 1 (The Brain)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ConfirmRequest(BaseModel):
    id: str
    approved: bool


class ChatResponse(BaseModel):
    reply: str | None = None
    warning: str | None = None
    pending: dict | None = None
    tool: str | None = None
    id: str | None = None


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "zenith-m1"}


def _finish(working: list, outcome: dict, warning: str | None = None) -> ChatResponse:
    """Commit history on a final reply, or stash the working history and surface pending."""
    if "reply" in outcome:
        memory_service.commit(working)
        return ChatResponse(reply=outcome["reply"], warning=warning)
    PENDING[outcome["id"]] = working
    return ChatResponse(pending=outcome["pending"], tool=outcome["tool"], id=outcome["id"], warning=warning)


@app.post("/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(req: ChatRequest) -> ChatResponse:
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is empty.")

    allowed, reason, warning = limiter.check_request()
    if not allowed:
        raise HTTPException(status_code=429, detail=reason)

    working = memory_service.snapshot() + [{"role": "user", "content": message}]
    try:
        outcome = run_loop(working, limiter)
    except BudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}") from exc

    return _finish(working, outcome, warning)


@app.post("/chat/confirm", response_model=ChatResponse, response_model_exclude_none=True)
def confirm(req: ConfirmRequest) -> ChatResponse:
    working = PENDING.pop(req.id, None)
    if working is None:
        raise HTTPException(status_code=404, detail="No pending action with that id.")

    block = next((b for b in working[-1]["content"] if getattr(b, "type", None) == "tool_use"), None)
    if block is None:
        raise HTTPException(status_code=500, detail="Pending action is malformed.")

    ok, reason = limiter.ensure_budget()
    if not ok:
        raise HTTPException(status_code=429, detail=reason)

    if req.approved:
        result = run_tool(block.name, block.input)
    else:
        result = "The user cancelled this action. Do not retry it; acknowledge briefly."

    working.append({"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": block.id, "content": result}
    ]})

    try:
        outcome = run_loop(working, limiter)
    except BudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"Claude API error: {exc}") from exc

    return _finish(working, outcome)
```

---

## Task 6 — Frontend

### `frontend/components/ConfirmCard.tsx` (NEW)

```tsx
type PendingAction = {
  id: string;
  tool: string;
  input: Record<string, unknown>;
};

export function ConfirmCard({
  pending,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: PendingAction;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const body =
    pending.tool === "send_message" ? (
      <>
        Zenith wants to <span className="text-zenith-cyan">send a message</span> to{" "}
        <span className="text-zenith-cyan">{String(pending.input.to ?? "?")}</span>:
        <span className="mt-2 block rounded bg-black/40 px-3 py-2 text-zenith-text">
          “{String(pending.input.body ?? "")}”
        </span>
      </>
    ) : (
      <>
        Zenith wants to run <span className="text-zenith-cyan">{pending.tool}</span>:
        <span className="mt-2 block rounded bg-black/40 px-3 py-2 text-zenith-text">
          {JSON.stringify(pending.input)}
        </span>
      </>
    );

  return (
    <div className="mt-2 rounded-lg border border-zenith-alert/50 bg-zenith-alert/5 px-4 py-3 text-sm text-zenith-text">
      <p className="mb-3">{body}</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="rounded-md bg-zenith-cyan px-4 py-2 text-xs font-semibold text-zenith-bg disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-zenith-red/50 px-4 py-2 text-xs font-semibold text-zenith-red disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export type { PendingAction };
```

### `frontend/app/page.tsx` (UPDATE — full file)

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmCard, type PendingAction } from "../components/ConfirmCard";

type Message = { role: "user" | "assistant"; content: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, pending]);

  function applyData(data: {
    reply?: string;
    warning?: string | null;
    pending?: Record<string, unknown>;
    tool?: string;
    id?: string;
  }) {
    if (data.warning !== undefined) setWarning(data.warning ?? null);
    if (data.pending && data.tool && data.id) {
      setPending({ id: data.id, tool: data.tool, input: data.pending });
    } else if (typeof data.reply === "string") {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setPending(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? "Rate limit reached. Thoda ruk ja, Boss.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? `Server error (${res.status}).`);
        return;
      }
      applyData(await res.json());
    } catch {
      setError("Can't reach Zenith's backend. Is it running on :8000?");
    } finally {
      setLoading(false);
    }
  }

  async function resolvePending(approved: boolean) {
    if (!pending || loading) return;
    const current = pending;
    setPending(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/chat/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, approved }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? `Server error (${res.status}).`);
        return;
      }
      applyData(await res.json());
    } catch {
      setError("Can't reach Zenith's backend. Is it running on :8000?");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-zenith-bg text-zenith-text">
      <header className="w-full border-b border-zenith-cyan/20 px-6 py-4 text-center">
        <h1 className="text-xl font-semibold tracking-[0.3em] text-zenith-cyan">ZENITH</h1>
        <p className="mt-1 text-xs uppercase tracking-widest text-zenith-text/50">
          Milestone 1 · The Brain
        </p>
      </header>

      <div className="flex flex-col items-center py-8">
        <div className="zenith-orb h-24 w-24 rounded-full bg-zenith-cyan" aria-hidden />
        <p className="mt-4 text-xs uppercase tracking-widest text-zenith-text/40">
          {loading ? "Thinking…" : "Idle"}
        </p>
      </div>

      <div ref={scrollRef} className="w-full max-w-2xl flex-1 space-y-4 overflow-y-auto px-6">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-zenith-text/40">Say something to Zenith…</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span
              className={
                "inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2 text-sm " +
                (m.role === "user"
                  ? "bg-zenith-cyan/10 text-zenith-text"
                  : "bg-zenith-blue/10 text-zenith-cyan")
              }
            >
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <div className="text-left">
            <span className="inline-block rounded-lg bg-zenith-blue/10 px-4 py-2 text-sm text-zenith-cyan/70">
              Zenith is thinking…
            </span>
          </div>
        )}
      </div>

      <div className="w-full max-w-2xl px-6">
        {pending && (
          <ConfirmCard
            pending={pending}
            busy={loading}
            onConfirm={() => resolvePending(true)}
            onCancel={() => resolvePending(false)}
          />
        )}
        {warning && <p className="mt-2 text-center text-xs text-zenith-alert">{warning}</p>}
        {error && <p className="mt-2 text-center text-xs text-zenith-red">{error}</p>}
      </div>

      <div className="w-full max-w-2xl px-6 py-6">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            className="flex-1 rounded-lg border border-zenith-cyan/30 bg-black/40 px-4 py-3 text-sm text-zenith-text outline-none placeholder:text-zenith-text/30 focus:border-zenith-cyan"
          />
          <button
            onClick={sendMessage}
            disabled={loading || input.trim() === ""}
            className="rounded-lg bg-zenith-cyan px-5 py-3 text-sm font-semibold text-zenith-bg transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
```

---

## Task 7 — `README.md` (UPDATE)

Change the title to "Zenith — Milestone 1 (The Brain)", keep the run steps, and add:

```markdown
## What Zenith can do now (Milestone 1)
Claude runs a **tool-use loop**. Read-only tools run immediately; action tools pause for your confirmation.

Endpoints:
- `POST /chat` `{message}` → `{reply, warning}` OR `{pending, tool, id, warning}` (an action needs confirmation)
- `POST /chat/confirm` `{id, approved}` → resumes the turn → `{reply}` (or another `pending`)

Stub tools (real integrations replace these later with no route changes):
- `get_current_time` — read-only
- `send_message(to, body)` — action → requires confirmation (logs "sent (stub)")

### Try it
- Plain: "kaise ho?" → a normal reply, no tools.
- Read-only tool: "what time is it?" → Claude calls `get_current_time` (see the `[tool] ...` log) and answers.
- Action + confirm: "send a message to Rahul saying I'm running late" → a ConfirmCard appears.
  - **Confirm** → the stub runs (server logs `[tool] send_message(...)`) and Zenith confirms.
  - **Cancel** → nothing runs; Zenith acknowledges ("Theek hai Boss, nahi bhej raha.").

Limits: 5 req/min (6th → 429), 150/day, warning from 120/day, and a 300k-token/day kill-switch. All in-memory; resets on restart.
```

---

## Task 8 — Verification (maps to DONE WHEN)

**Offline (no API key):**
- Import all modules (`rate_limiter`, `memory_service`, `tools`, `claude_service`, `main`) with a dummy key.
- `rate_limiter`: `check_request()` 6× → `[T,T,T,T,T,F]`; warning at 120/day; set `_day_tokens = 300_000` → `check_request`/`ensure_budget` blocked (kill-switch).
- `tools`: `run_tool("get_current_time", {})` returns a real timestamp + logs; `run_tool("send_message", {...})` returns the stub string + logs.
- `memory_service._trim`: feed a synthetic list with tool turns > 20 long → result is ≤ 20 and starts on a user-text turn.
- **Whole loop + confirm/cancel, offline**, by monkeypatching `claude_service.client.messages.create` with a queue of fake responses (SimpleNamespace blocks), then calling the **real** `main.chat` / `main.confirm`:
  1. plain text → `{reply}`, history committed.
  2. fake `get_current_time` tool_use → loop runs the real tool, feeds the result, second fake call returns text → `{reply}`; assert the `[tool]` log fired and history contains tool_use + tool_result turns.
  3. fake `send_message` tool_use → `main.chat` returns `pending`; `main.confirm(approved=True)` → `run_tool` executes (stub log) → `{reply}`.
  4. cancel path: `main.confirm(approved=False)` → `send_message` does **not** execute → `{reply}` (graceful).

**Server + HTTP (dummy key):** `uvicorn` boots; `GET /` → 200; `POST /chat` → 502 (reaches Claude, auth-fails on dummy key = wiring proven); 6th `POST /chat` in a minute → 429.

**Frontend:** `npm run build` exits 0 (ConfirmCard + page compile under TS).

**Live (your real key, your side):** the three README scenarios — plain reply, time tool, and send→confirm/cancel.

---

## Self-review against the spec
- rate_limiter ENFORCES (not stub): 5/min + 150/day → 429 ✓; DAILY_TOKEN_BUDGET accrues from `usage`, kill-switch blocks ✓; warning at 120/day ✓.
- memory: last-20 history including tool_use + tool_result turns ✓ (+ safe trim).
- tools: TOOLS / ACTION_TOOLS / run_tool ✓; two stubs (`get_current_time` read-only, `send_message` action) ✓.
- claude_service loop: model/max_tokens/system/tools/messages ✓; non-tool_use → reply ✓; tool_use → append assistant content, per-block: action → stop+stash+return pending, read-only → run_tool + tool_result + continue ✓; handles sequential calls ✓.
- /chat/confirm: `{id, approved}`; approved → run + resume; cancelled → cancel tool_result + resume → graceful ✓.
- tool-agnostic loop + routes ✓ (new tool = schema + executor + maybe ACTION_TOOLS).
- frontend: ConfirmCard, Confirm/Cancel → `/chat/confirm`, shows reply; existing chat/orb/loading/429 kept ✓.
- OUT OF SCOPE: no real integrations, no voice, no full HUD, no Tauri, no DB (all in-memory), no auth/settings ✓.
