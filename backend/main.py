"""Zenith — Milestone 1 backend wiring (thin routes; logic in the service modules)."""

import anthropic
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import memory_service
from claude_service import run_loop, BudgetExceeded
from rate_limiter import RateLimiter
from stt_service import active_config, get_model, transcribe_audio
from tools import run_tool
from tts_service import active_tts_config, synthesize

limiter = RateLimiter()
PENDING: dict[str, list] = {}   # block.id -> in-progress working history awaiting confirm

app = FastAPI(title="Zenith — Milestone 1 (The Brain)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _warm_stt() -> None:
    """Load the whisper model once at boot so the first /transcribe is fast."""
    get_model()


class ChatRequest(BaseModel):
    message: str


class ConfirmRequest(BaseModel):
    id: str
    approved: bool


class SpeakRequest(BaseModel):
    text: str


class ChatResponse(BaseModel):
    reply: str | None = None
    warning: str | None = None
    pending: dict | None = None
    tool: str | None = None
    id: str | None = None


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "zenith-m2"}


@app.get("/health")
def health_detail() -> dict:
    """Diagnostics: which device/model whisper ACTUALLY loaded on (catches the silent
    CUDA->CPU fallback) + the active STT language, plus the active TTS engine/voice.
    Open in the browser to verify the GPU and which voice is serving."""
    return {"status": "ok", "whisper": active_config(), "tts": active_tts_config()}


@app.get("/usage")
def usage() -> dict:
    """Live usage snapshot for the HUD gauges (does not consume a request slot)."""
    return limiter.stats()


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
