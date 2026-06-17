"""Zenith — local speech-to-text via faster-whisper (Milestone 2, Pass B)."""

import io
import os
from functools import lru_cache

from dotenv import load_dotenv
from faster_whisper import WhisperModel

load_dotenv()

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    """Load the model once and cache it (warmed at app startup)."""
    return WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)


def transcribe_audio(data: bytes) -> str:
    """Transcribe a recorded audio blob (webm/opus, wav, …) to text.

    Language is auto-detected (Hinglish-friendly). Returns "" when no speech."""
    segments, _info = get_model().transcribe(io.BytesIO(data), language=None, beam_size=1)
    return "".join(segment.text for segment in segments).strip()
