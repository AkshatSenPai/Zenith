"""Zenith — neural text-to-speech via edge-tts (Milestone 2, Pass B).

Uses Microsoft's free neural voices (no API key) so the spoken voice sounds natural in
ANY browser. (Browser SpeechSynthesis was robotic in some Chromium builds and silent in
others — this is browser-independent: the backend returns MP3 audio the frontend plays.)
"""

import os

import edge_tts
from dotenv import load_dotenv

load_dotenv()

# en-IN reads Roman Hinglish naturally (Indian English + Hindi words). Override via .env.
# Other good picks: hi-IN-SwaraNeural, en-IN-PrabhatNeural, hi-IN-MadhurNeural.
TTS_VOICE = os.getenv("ZENITH_TTS_VOICE", "en-IN-NeerjaNeural")


async def synthesize(text: str) -> bytes:
    """Render `text` to MP3 audio bytes using a Microsoft neural voice."""
    communicate = edge_tts.Communicate(text, TTS_VOICE)
    buf = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.extend(chunk["data"])
    return bytes(buf)
