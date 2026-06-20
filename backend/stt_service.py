"""Zenith - local speech-to-text via faster-whisper.

Language (v1.5): DEFAULTS TO ENGLISH for speed + accuracy. With WHISPER_LANGUAGE=en (the
default) we force one English decode pass and skip transliteration entirely. The Hinglish
path is kept but DORMANT behind the flag (a Phase-2 differentiator, not deleted):
- WHISPER_LANGUAGE=en (or unset) -> English; single pass; no transliteration, no re-force.
- WHISPER_LANGUAGE= (explicit blank) -> auto-detect: English stays English; Hindi is
  transcribed in its real words then romanised to Latin (never Devanagari/Urdu), re-forcing
  to Hindi if detection drifts to Urdu/Arabic script.
- WHISPER_LANGUAGE=hi -> forced Hindi (romanised to Latin).
beam search + no prev-text conditioning + VAD curb hallucinations and skip silence.

Speed: the model loads ONCE at startup (get_model + main._warm_stt). The big win is the
GPU - large-v3 / cuda / float16 does a 12s clip in ~2-3s vs ~20s on small/CPU. The "safe"
CUDA->CPU fallback below is now LOUD (startup WARNING + GET /health); it silently running
on CPU was the real cause of the lag.

GPU setup (faster-whisper / CTranslate2 on Windows, NVIDIA only):
  1. NVIDIA GPU + recent driver. (CUDA needs NVIDIA; AMD/Intel fall back to CPU.)
  2. CTranslate2 needs the CUDA 12 + cuDNN 9 runtime. Easiest is pip wheels, pinned to
     match the installed ctranslate2:
         pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
     (If the load still fails, match the cuDNN major to your ctranslate2 build.)
  3. .env:  WHISPER_DEVICE=cuda  WHISPER_MODEL=large-v3  WHISPER_COMPUTE=float16
  4. Verify it ACTUALLY loaded on the GPU: open http://localhost:8000/health and check
     whisper.device == "cuda" and whisper.fallback == false (or read the startup log).
  No NVIDIA GPU? Use WHISPER_DEVICE=cpu + WHISPER_MODEL=medium (English) - still far
  faster than Hinglish small/CPU.
"""

import io
import os
import re
from functools import lru_cache

from av.error import FFmpegError
from dotenv import load_dotenv
from faster_whisper import WhisperModel
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

load_dotenv()

# `base` is too weak; `small` is the safe CPU default. For real accuracy + speed on the
# 32GB GPU desktop: WHISPER_MODEL=large-v3, WHISPER_DEVICE=cuda, WHISPER_COMPUTE=float16
# (set in .env; the code default stays small/cpu so CPU-only machines still boot).
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")


def _resolve_language(raw: str | None) -> str | None:
    """English by default (fast: no transliteration, no Urdu re-force). An explicit blank
    (WHISPER_LANGUAGE=) means auto-detect - the dormant Hinglish path. 'en'/'hi' pass
    through, trimmed + lowercased."""
    if raw is None:
        return "en"
    return raw.strip().lower() or None


# Unset/"en" -> English (default). Blank -> auto-detect (dormant Hinglish). "hi" -> Hindi.
WHISPER_LANGUAGE = _resolve_language(os.getenv("WHISPER_LANGUAGE"))

# What the model ACTUALLY loaded on (vs requested) - populated by get_model() so the
# silent CUDA->CPU fallback is visible at startup and via GET /health.
ACTIVE: dict = {
    "model": None,
    "device": None,
    "compute": None,
    "requested_device": None,
    "fallback": False,
    "error": None,
}

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    """Load the model once and cache it (warmed at app startup).

    Falls back to CPU if a GPU was requested but CUDA/cuDNN isn't available, so opting
    into WHISPER_DEVICE=cuda can't brick startup. The fallback is now LOUD (see
    _warn_cuda_fallback) and recorded on ACTIVE - silently running on CPU was the lag."""
    ACTIVE.update(model=WHISPER_MODEL, requested_device=WHISPER_DEVICE)
    try:
        model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
        ACTIVE.update(device=WHISPER_DEVICE, compute=WHISPER_COMPUTE, fallback=False, error=None)
        print(f"[stt] whisper loaded: model={WHISPER_MODEL} device={WHISPER_DEVICE} "
              f"compute={WHISPER_COMPUTE} language={WHISPER_LANGUAGE or 'auto'}", flush=True)
        return model
    except Exception as exc:
        if WHISPER_DEVICE == "cpu":
            raise  # CPU was explicitly requested and still failed -- a real error
        model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        ACTIVE.update(device="cpu", compute="int8", fallback=True,
                      error=f"{type(exc).__name__}: {exc}")
        _warn_cuda_fallback(exc)
        return model


def _warn_cuda_fallback(exc: Exception) -> None:
    """Loud, can't-miss warning that the GPU was requested but we are actually on CPU.
    ASCII only - Windows consoles choke on fancy dashes (cp1252)."""
    bar = "=" * 64
    print(
        "\n[stt] " + bar + "\n"
        f"[stt] WARNING: WHISPER_DEVICE={WHISPER_DEVICE!r} requested but UNAVAILABLE -- running on CPU.\n"
        f"[stt]   requested: device={WHISPER_DEVICE} model={WHISPER_MODEL} compute={WHISPER_COMPUTE}\n"
        f"[stt]   actual:    device=cpu  model={WHISPER_MODEL} compute=int8\n"
        f"[stt]   reason: {type(exc).__name__}: {exc}\n"
        "[stt]   likely cause: missing CUDA 12 / cuDNN runtime for CTranslate2.\n"
        "[stt]   fix: pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 (matched to ctranslate2),\n"
        "[stt]        or set WHISPER_DEVICE=cpu + a smaller WHISPER_MODEL (e.g. medium).\n"
        "[stt]   NOTE: a large model on CPU is very slow -- THIS is the latency you are seeing.\n"
        "[stt] " + bar + "\n",
        flush=True,
    )


def active_config() -> dict:
    """What STT is actually running - for GET /health and startup verification."""
    return {
        "language": WHISPER_LANGUAGE or "auto",
        "model": ACTIVE["model"],
        "device": ACTIVE["device"],
        "compute": ACTIVE["compute"],
        "requested_device": ACTIVE["requested_device"],
        "fallback": ACTIVE["fallback"],
        "error": ACTIVE["error"],
    }


def _romanize(text: str) -> str:
    """Guarantee Latin output. No-op for Latin; transliterates any Devanagari to Latin
    (lowercased) otherwise — faithful words, Roman script."""
    if _DEVANAGARI.search(text):
        text = transliterate(text, sanscript.DEVANAGARI, sanscript.ITRANS).lower()
    return text


def _decode(model: WhisperModel, audio: io.BytesIO, language):
    """Transcribe with accuracy/anti-hallucination settings shared by both passes."""
    return model.transcribe(
        audio,
        language=language,
        beam_size=5,                        # beam search — more accurate than greedy
        vad_filter=True,                    # skip silence: avoids slow loops + trims latency
        condition_on_previous_text=False,   # curb hallucinated / looping output
    )


def transcribe_audio(data: bytes) -> str:
    """Transcribe a recorded audio blob (webm/opus, wav, …) to Roman/Latin text.

    Returns "" when there's no speech, or when the clip is too short/empty to decode —
    e.g. an accidental mic tap produces a header-only webm and PyAV raises EOFError.
    Callers treat "" as "nothing was said", so a stray tap is a clean no-op, not a 500.
    (Model/CUDA load errors come from get_model() above and still surface.)"""
    model = get_model()
    audio = io.BytesIO(data)
    try:
        segments, info = _decode(model, audio, WHISPER_LANGUAGE)
        # Auto-detect drifted to something other than English/Hindi (e.g. Urdu)? Force Hindi
        # so we get Devanagari we can romanise, instead of Arabic script we can't.
        if WHISPER_LANGUAGE is None and info.language not in ("en", "hi"):
            audio.seek(0)
            segments, info = _decode(model, audio, "hi")
        text = "".join(segment.text for segment in segments).strip()
    except (FFmpegError, EOFError) as exc:  # undecodable/empty clip = no speech, not a crash
        print(f"[stt] undecodable clip ({len(data)} bytes) -- treating as no speech: "
              f"{type(exc).__name__}: {exc}", flush=True)
        return ""
    # English mode: skip transliteration entirely (the Hinglish romanisation is dormant).
    if WHISPER_LANGUAGE == "en":
        return text
    return _romanize(text)
