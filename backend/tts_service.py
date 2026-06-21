"""Zenith - text-to-speech. Two engines behind ONE /speak contract.

  ZENITH_TTS_ENGINE=edge    (default) Microsoft edge-tts neural voices. Cloud, free,
                            no key; returns MP3. Indian-English voices by default.
  ZENITH_TTS_ENGINE=kokoro  Local / OFFLINE Kokoro (hexgrad/Kokoro-82M). Runs on this
                            machine (CPU is plenty for an 82M model), no per-reply
                            network round-trip, neutral English voices; returns WAV.

`synthesize(text)` returns (audio_bytes, media_type) so the route serves either format
unchanged - the browser plays whatever blob it gets (MP3 or WAV). Kokoro's pipeline is
loaded ONCE (lru_cache) like the whisper model; the first call also downloads the ~330MB
model from Hugging Face. The heavy deps (torch / kokoro / soundfile) are imported LAZILY,
so an edge-only setup never needs them installed.

NOTE: Kokoro needs Python 3.11 - spacy/blis ship no wheels for 3.14, so the backend venv
is built on 3.11 (see backend/requirements.txt). The synth runs in a worker thread
(asyncio.to_thread) so the CPU-bound generate never blocks the event loop.
"""

import asyncio
import io
import os
from functools import lru_cache

import edge_tts
from dotenv import load_dotenv

load_dotenv()

ENGINE = os.getenv("ZENITH_TTS_ENGINE", "edge").strip().lower()

# edge-tts (cloud). en-IN reads Roman Hinglish naturally. Override via .env.
EDGE_VOICE = os.getenv("ZENITH_TTS_VOICE", "en-IN-NeerjaNeural")

# Kokoro (local). Grade-A voices: af_heart (US female), am_michael (US male).
# British / JARVIS-like: bm_george. Full list: hexgrad/Kokoro-82M VOICES.md.
KOKORO_VOICE = os.getenv("ZENITH_KOKORO_VOICE", "af_heart")
KOKORO_LANG = os.getenv("ZENITH_KOKORO_LANG", "a")        # a=American, b=British English
KOKORO_DEVICE = os.getenv("ZENITH_KOKORO_DEVICE", "cpu")  # cpu (default) or cuda
KOKORO_SR = 24000  # Kokoro outputs 24 kHz audio

# What TTS is actually serving - for GET /health (mirrors stt_service.active_config).
ACTIVE: dict = {"engine": ENGINE, "voice": None, "device": None, "error": None}


async def synthesize(text: str) -> tuple[bytes, str]:
    """Render `text` to (audio_bytes, media_type). edge -> MP3, kokoro -> WAV."""
    if ENGINE == "kokoro":
        audio = await asyncio.to_thread(_kokoro_synthesize, text)
        return audio, "audio/wav"
    audio = await _edge_synthesize(text)
    return audio, "audio/mpeg"


async def _edge_synthesize(text: str) -> bytes:
    """Microsoft neural voice -> MP3 bytes (the default, browser-independent)."""
    communicate = edge_tts.Communicate(text, EDGE_VOICE)
    buf = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    ACTIVE.update(engine="edge", voice=EDGE_VOICE, device="cloud", error=None)
    return bytes(buf)


@lru_cache(maxsize=1)
def _kokoro_pipeline():
    """Load the Kokoro pipeline once (downloads the model from HF on first call).

    Tries the richest constructor first and falls back as kwargs vary across kokoro
    versions, so a minor version bump can't brick startup."""
    from kokoro import KPipeline  # lazy: only needed when ENGINE=kokoro

    for kwargs in (
        {"lang_code": KOKORO_LANG, "repo_id": "hexgrad/Kokoro-82M", "device": KOKORO_DEVICE},
        {"lang_code": KOKORO_LANG, "device": KOKORO_DEVICE},
        {"lang_code": KOKORO_LANG},
    ):
        try:
            pipe = KPipeline(**kwargs)
            break
        except TypeError:
            continue
    else:  # pragma: no cover - all signatures rejected
        pipe = KPipeline(lang_code=KOKORO_LANG)

    print(f"[tts] kokoro loaded: voice={KOKORO_VOICE} lang={KOKORO_LANG} "
          f"device={KOKORO_DEVICE}", flush=True)
    return pipe


def _kokoro_synthesize(text: str) -> bytes:
    """Kokoro -> 16-bit WAV bytes (24 kHz). Runs in a worker thread (see synthesize)."""
    import numpy as np
    import soundfile as sf

    pipe = _kokoro_pipeline()
    # Kokoro yields (graphemes, phonemes, audio) per chunk; we want the audio tensors.
    chunks = [audio for _, _, audio in pipe(text, voice=KOKORO_VOICE)]
    if not chunks:
        return b""
    samples = np.concatenate([
        c.detach().cpu().numpy() if hasattr(c, "detach") else np.asarray(c)
        for c in chunks
    ])
    buf = io.BytesIO()
    sf.write(buf, samples, KOKORO_SR, format="WAV", subtype="PCM_16")
    ACTIVE.update(engine="kokoro", voice=KOKORO_VOICE, device=KOKORO_DEVICE, error=None)
    return buf.getvalue()


def active_tts_config() -> dict:
    """What TTS is configured to use - surfaced on GET /health for verification."""
    return {
        "engine": ENGINE,
        "voice": KOKORO_VOICE if ENGINE == "kokoro" else EDGE_VOICE,
        "lang": KOKORO_LANG if ENGINE == "kokoro" else None,
        "device": KOKORO_DEVICE if ENGINE == "kokoro" else "cloud",
    }
