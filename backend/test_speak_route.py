from fastapi.testclient import TestClient

import main


def test_speak_returns_mp3(monkeypatch):
    async def fake(text):
        return b"\xff\xf3fake-mp3", "audio/mpeg"

    monkeypatch.setattr(main, "synthesize", fake)
    client = TestClient(main.app)
    res = client.post("/speak", json={"text": "Boss, kaise ho?"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/")
    assert res.content == b"\xff\xf3fake-mp3"


def test_speak_serves_wav_media_type_from_synthesize(monkeypatch):
    # The route must honour whatever media type synthesize reports (Kokoro -> WAV),
    # not a hardcoded audio/mpeg.
    async def fake(text):
        return b"RIFFfake-wav", "audio/wav"

    monkeypatch.setattr(main, "synthesize", fake)
    client = TestClient(main.app)
    res = client.post("/speak", json={"text": "Hello, I am Zenith."})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/wav")
    assert res.content == b"RIFFfake-wav"


def test_speak_rejects_empty(monkeypatch):
    client = TestClient(main.app)
    res = client.post("/speak", json={"text": "   "})
    assert res.status_code == 400
