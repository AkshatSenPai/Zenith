"""Zenith — local speech-to-text via faster-whisper (Milestone 2, Pass B).

Goal: faithful Roman/Latin transcripts for a code-switching (English + Hindi) user.
- Auto-detect the language per utterance: English stays English; Hindi is transcribed
  in its real words (Devanagari) then romanised to Latin — NOT translated to English.
- If auto-detect drifts to a non-English, non-Hindi language (e.g. Urdu/Arabic script),
  re-transcribe forced to Hindi so romanisation stays clean.
- `_romanize()` turns any Devanagari into Latin, so the transcript is always Roman.
- beam search + no prev-text conditioning + VAD curb hallucinations and skip silence.

Accuracy lever: `small`/CPU mishears real Hinglish. Set WHISPER_MODEL=large-v3 +
WHISPER_DEVICE=cuda in .env for far better results on a GPU (falls back to CPU if CUDA
is unavailable). Override detection with WHISPER_LANGUAGE=en or =hi.
"""

import io
import os
import re
from functools import lru_cache

from dotenv import load_dotenv
from faster_whisper import WhisperModel
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate

load_dotenv()

# `base` is too weak; `small` is the CPU sweet spot. For real accuracy on the 32GB GPU
# desktop: WHISPER_MODEL=large-v3, WHISPER_DEVICE=cuda, WHISPER_COMPUTE=float16.
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")
# Unset = auto-detect (English→English, Hindi→romanised). Force "en" or "hi" to override.
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE") or None

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    """Load the model once and cache it (warmed at app startup).

    Falls back to CPU if a GPU was requested but CUDA/cuDNN isn't available, so opting
    into WHISPER_DEVICE=cuda can't brick startup (e.g. the Blackwell/cuDNN gotcha)."""
    try:
        return WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    except Exception as exc:
        if WHISPER_DEVICE == "cpu":
            raise
        print(f"[stt] {WHISPER_DEVICE!r} unavailable ({exc}); falling back to CPU "
              f"(slow for big models — drop to a smaller WHISPER_MODEL on CPU).", flush=True)
        return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")


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

    Returns "" when there's no speech."""
    model = get_model()
    audio = io.BytesIO(data)
    segments, info = _decode(model, audio, WHISPER_LANGUAGE)
    # Auto-detect drifted to something other than English/Hindi (e.g. Urdu)? Force Hindi so
    # we get Devanagari we can romanise, instead of Arabic script we can't.
    if WHISPER_LANGUAGE is None and info.language not in ("en", "hi"):
        audio.seek(0)
        segments, info = _decode(model, audio, "hi")
    return _romanize("".join(segment.text for segment in segments).strip())
