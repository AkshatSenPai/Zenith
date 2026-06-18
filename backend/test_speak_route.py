from fastapi.testclient import TestClient

import main


def test_speak_returns_audio(monkeypatch):
    async def fake(text):
        return b"\xff\xf3fake-mp3"

    monkeypatch.setattr(main, "synthesize", fake)
    client = TestClient(main.app)
    res = client.post("/speak", json={"text": "Boss, kaise ho?"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/")
    assert res.content == b"\xff\xf3fake-mp3"


def test_speak_rejects_empty(monkeypatch):
    client = TestClient(main.app)
    res = client.post("/speak", json={"text": "   "})
    assert res.status_code == 400
