"""Zenith — Milestone 1 backend wiring (thin routes; logic in the service modules)."""

import asyncio
import os

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import activity_log
import auth
import chat_core
import discord_service
import google_auth
import google_service
import notion_service
import proactivity_service
import secure_files
import telegram_service
import todo_service
import triage_service
import vault_service
from stt_service import active_config, transcribe_audio, warm as warm_stt
from tts_service import active_tts_config, synthesize

ZENITH_VERSION = "0.5.0"  # Milestone 5 (hardening + polish)

# Same truthy parsing tools.py uses for ZENITH_DEBUG_LOGS, so /health reports the real state.
_TRUTHY = {"1", "true", "yes", "on"}


def _debug_logs_on() -> bool:
    return os.getenv("ZENITH_DEBUG_LOGS", "").strip().lower() in _TRUTHY


app = FastAPI(
    title="Zenith — Milestone 1 (The Brain)",
    dependencies=[Depends(auth.require_token)],  # shared-secret gate on every route (see auth.py)
)
# CORS allowlist. The HUD's Next dev server normally runs on :3000, but it falls back to :3001
# (or higher) when another local project already holds :3000 — e.g. the owner runs Arkquen's
# desktop app on :3000 alongside Zenith. So the default allows both common dev ports; override
# via ZENITH_ALLOWED_ORIGINS (comma-separated) for anything else. A disallowed origin makes the
# CORS preflight return "400 Bad Request", which surfaces in the HUD as a blanket "backend offline".
_DEFAULT_ORIGINS = "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ZENITH_ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _harden_secrets() -> None:
    """Tighten file permissions on .env + tokens/ at boot (chmod 600 / icacls). Best-effort."""
    secure_files.harden()


@app.on_event("startup")
def _log_auth() -> None:
    """Make the API-token posture loud at boot: enforced when set, localhost-only when not."""
    if auth.enforcement_enabled():
        print("[auth] X-Zenith-Token enforced on all routes (except GET / and GET /health).", flush=True)
    else:
        print(
            "⚠️  [auth] ZENITH_API_TOKEN not set — backend protected ONLY by localhost binding. "
            "Set ZENITH_API_TOKEN in backend/.env to require the X-Zenith-Token header.",
            flush=True,
        )


@app.on_event("startup")
def _warm_stt() -> None:
    """Load AND warm the whisper model at boot (one tiny inference) so the first real
    /transcribe is fast instead of paying ~15s of one-time cuDNN init on the GPU."""
    warm_stt()


@app.on_event("startup")
async def _warm_tts() -> None:
    """Warm the TTS engine at boot. Kokoro on the GPU pays a one-time ~30s CUDA-init +
    model-load + first-inference cost; doing it here means the user's first /speak is fast
    instead of stalling the first reply of the session."""
    try:
        await synthesize("Zenith online.")
        print("[tts] warmup complete", flush=True)
    except Exception as exc:  # noqa: BLE001 — warmup is best-effort, never block boot
        print(f"[tts] warmup skipped: {exc}", flush=True)


@app.on_event("startup")
async def _start_discord() -> None:
    """Launch the Discord bot as a background task on THIS event loop (no-op without a token).
    The sync tool executors reach it via run_coroutine_threadsafe — see discord_service."""
    discord_service.start(asyncio.get_running_loop())


@app.on_event("shutdown")
async def _stop_discord() -> None:
    await discord_service.close()


@app.on_event("startup")
async def _start_telegram() -> None:
    """Launch the Telegram remote bot (long-polling) on THIS event loop (no-op without a token)."""
    await telegram_service.start()


@app.on_event("shutdown")
async def _stop_telegram() -> None:
    await telegram_service.close()


class ChatRequest(BaseModel):
    message: str
    fresh: bool = False  # briefing: ignore prior chat history for this turn (always-fresh)


class ConfirmRequest(BaseModel):
    id: str
    approved: bool


class SpeakRequest(BaseModel):
    text: str


class DisconnectRequest(BaseModel):
    email: str | None = None


class TodoAdd(BaseModel):
    text: str


class TodoSet(BaseModel):
    done: bool


class ChatResponse(BaseModel):
    reply: str | None = None
    warning: str | None = None
    pending: dict | None = None
    tool: str | None = None
    id: str | None = None
    untrusted: bool | None = None  # action may have been triggered by untrusted read-content


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "zenith-m2"}


@app.get("/health")
def health_detail() -> dict:
    """Diagnostics: which device/model whisper ACTUALLY loaded on (catches the silent
    CUDA->CPU fallback) + the active STT language, plus the active TTS engine/voice,
    the backend version, and the security posture (auth + debug-logs flag).
    Open in the browser to verify the GPU and which voice is serving."""
    return {
        "status": "ok",
        "version": ZENITH_VERSION,
        "whisper": active_config(),
        "tts": active_tts_config(),
        "config": {
            "debug_logs": _debug_logs_on(),
            "auth_enforced": auth.enforcement_enabled(),
        },
    }


@app.get("/usage")
def usage() -> dict:
    """Live usage snapshot for the HUD gauges (does not consume a request slot)."""
    return chat_core.limiter.stats()


@app.get("/activity")
def activity() -> dict:
    """Recent tool activity for the HUD Activity Log (newest first; in-memory, resets on restart)."""
    return {"entries": activity_log.entries()}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    """Local STT: audio blob -> {text}. Not rate-limited (the /chat it triggers is)."""
    try:
        data = await audio.read()
        return {"text": transcribe_audio(data)}
    except Exception as exc:  # noqa: BLE001 — surface any decode/transcribe error
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc


@app.post("/speak")
async def speak(req: SpeakRequest) -> Response:
    """Neural TTS: text -> audio bytes (browser-independent). edge-tts returns MP3,
    Kokoro returns WAV; synthesize() reports the media type so we serve either. Not
    rate-limited."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text to speak.")
    try:
        audio, media_type = await synthesize(text)
    except Exception as exc:  # noqa: BLE001 — surface TTS/network errors
        raise HTTPException(status_code=502, detail=f"TTS failed: {exc}") from exc
    return Response(content=audio, media_type=media_type)


# ---------- Google connect + live panel data (NOT Claude tools; share the service layer) ----------

@app.get("/google/status")
def google_status() -> dict:
    """Connected-account snapshot for the Connections panel + orb nodes. Never rate-limited."""
    return google_auth.status()


@app.post("/google/connect")
def google_connect() -> dict:
    """Start the OAuth flow in a background thread (opens the system browser). Returns at once;
    the frontend polls /google/status until the account appears."""
    if not google_auth.status()["configured"]:
        raise HTTPException(
            status_code=400,
            detail="Google OAuth not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET "
            "in backend/.env (see SETUP-GOOGLE.md).",
        )
    return google_auth.connect()


@app.post("/google/disconnect")
def google_disconnect(req: DisconnectRequest) -> dict:
    return google_auth.disconnect(req.email)


@app.get("/calendar/events")
def calendar_events(when: str = "today") -> dict:
    """Real events for the CalendarPanel (same service the get_calendar_events tool uses).
    Returns connected:false instead of erroring when Google isn't linked."""
    try:
        return {"connected": True, "events": google_service.get_events(when=when)}
    except google_service.NotConnected:
        return {"connected": False, "events": []}


@app.get("/triage")
def triage() -> dict:
    """Gmail threads waiting on the owner's reply (same service the list_waiting_replies tool uses).
    Returns connected:false instead of erroring when Google isn't linked, so the view can offer
    'Connect Google' rather than a misleading 'Nothing waiting'."""
    try:
        return {"connected": True, "threads": triage_service.waiting_threads()}
    except google_service.NotConnected:
        return {"connected": False, "threads": []}


class DismissRequest(BaseModel):
    id: str
    snooze: str | None = None      # "evening" | "tomorrow" | None (None = dismiss permanently)


@app.get("/proactive")
def proactive() -> dict:
    """Proactive nudges (≤3, ranked). Best-effort — never 500s the HUD poll."""
    try:
        return {"nudges": proactivity_service.get_nudges()}
    except Exception as exc:  # noqa: BLE001 — a poll must never error the HUD
        print(f"[proactive] endpoint error: {exc}", flush=True)
        return {"nudges": []}


@app.post("/proactive/dismiss")
def proactive_dismiss(req: DismissRequest) -> dict:
    proactivity_service.dismiss_nudge(req.id, snooze_preset=req.snooze)
    return {"ok": True}


@app.get("/discord/status")
async def discord_status() -> dict:
    """Discord bot connection status for the orb node + Connections row (read on the event loop)."""
    return discord_service.status()


@app.get("/telegram/status")
def telegram_status() -> dict:
    """Telegram remote bot status for the orb Telegram node + Connections row."""
    return telegram_service.status()


@app.get("/notion/status")
def notion_status() -> dict:
    """Notion integration status for the Connections row (no orb node)."""
    return notion_service.status()


# ---------- vault: read-only note browsing for the HUD (shares vault_service; NOT Claude tools) ----------

@app.get("/vault/notes")
def vault_notes(folder: str | None = None, recent: int | None = None) -> dict:
    """Note index for the HUD Drafts/Clients tabs (read-only)."""
    return {"notes": vault_service.list_notes(folder, recent=recent)}


@app.get("/vault/note")
def vault_note(path: str) -> dict:
    """Full content of one note for the HUD reader. found:false when the note is absent."""
    body = vault_service.read(path)
    if body is None:
        return {"found": False, "path": path, "title": "", "content": ""}
    from pathlib import Path as _P
    return {"found": True, "path": path, "title": _P(path).stem, "content": body}


# ---------- to-dos: the HUD "Today's Focus" card (shares todo_service with the to-do tools) ----------

@app.get("/todos")
def todos_list() -> dict:
    """The owner's to-do list for the HUD 'Today's Focus' card."""
    return {"todos": todo_service.list_todos()}


@app.post("/todos")
def todos_add(req: TodoAdd) -> dict:
    try:
        return {"todos": todo_service.add_todo(req.text)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/todos/{index}")
def todos_set(index: int, req: TodoSet) -> dict:
    try:
        return {"todos": todo_service.set_done(index, req.done)}
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/todos/{index}")
def todos_remove(index: int) -> dict:
    try:
        return {"todos": todo_service.remove(index)}
    except IndexError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ---------- chat: the HUD route. The same chat_core is shared with the Telegram remote. ----------

@app.post("/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(req: ChatRequest) -> ChatResponse:
    try:
        return ChatResponse(**chat_core.process_chat(req.message, "hud", fresh=req.fresh))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except chat_core.RateLimited as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except chat_core.ClaudeUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/chat/confirm", response_model=ChatResponse, response_model_exclude_none=True)
def confirm(req: ConfirmRequest) -> ChatResponse:
    try:
        return ChatResponse(**chat_core.process_confirm(req.id, req.approved))
    except KeyError:
        raise HTTPException(status_code=404, detail="No pending action with that id.")
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except chat_core.RateLimited as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except chat_core.ClaudeUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
