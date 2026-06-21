"""TTS engine dispatcher — verifies synthesize() routes to the right backend and reports
the matching media type, without needing torch/kokoro installed (the backends are
monkeypatched)."""

import asyncio

import tts_service


def test_synthesize_dispatches_to_edge_as_mp3(monkeypatch):
    monkeypatch.setattr(tts_service, "ENGINE", "edge")

    async def fake_edge(text):
        return b"mp3-bytes"

    monkeypatch.setattr(tts_service, "_edge_synthesize", fake_edge)
    audio, media = asyncio.run(tts_service.synthesize("hi"))
    assert audio == b"mp3-bytes"
    assert media == "audio/mpeg"


def test_synthesize_dispatches_to_kokoro_as_wav(monkeypatch):
    monkeypatch.setattr(tts_service, "ENGINE", "kokoro")
    monkeypatch.setattr(tts_service, "_kokoro_synthesize", lambda text: b"wav-bytes")
    audio, media = asyncio.run(tts_service.synthesize("hi"))
    assert audio == b"wav-bytes"
    assert media == "audio/wav"


def test_active_tts_config_reports_kokoro(monkeypatch):
    monkeypatch.setattr(tts_service, "ENGINE", "kokoro")
    monkeypatch.setattr(tts_service, "KOKORO_VOICE", "af_heart")
    cfg = tts_service.active_tts_config()
    assert cfg["engine"] == "kokoro"
    assert cfg["voice"] == "af_heart"
    assert cfg["device"] == tts_service.KOKORO_DEVICE


def test_active_tts_config_reports_edge(monkeypatch):
    monkeypatch.setattr(tts_service, "ENGINE", "edge")
    monkeypatch.setattr(tts_service, "EDGE_VOICE", "en-IN-NeerjaNeural")
    cfg = tts_service.active_tts_config()
    assert cfg["engine"] == "edge"
    assert cfg["voice"] == "en-IN-NeerjaNeural"
    assert cfg["device"] == "cloud"
