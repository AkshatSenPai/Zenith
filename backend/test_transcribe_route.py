from fastapi.testclient import TestClient

import main


def test_transcribe_route_returns_text(monkeypatch):
    monkeypatch.setattr(main, "transcribe_audio", lambda data: "kal ka schedule batao")
    client = TestClient(main.app)  # plain instance: lifespan/startup warm not triggered
    res = client.post("/transcribe", files={"audio": ("clip.webm", b"xxxx", "audio/webm")})
    assert res.status_code == 200
    assert res.json() == {"text": "kal ka schedule batao"}


def test_transcribe_route_handles_failure(monkeypatch):
    def boom(data):
        raise RuntimeError("decode error")

    monkeypatch.setattr(main, "transcribe_audio", boom)
    client = TestClient(main.app)
    res = client.post("/transcribe", files={"audio": ("clip.webm", b"xxxx", "audio/webm")})
    assert res.status_code == 500
    assert "Transcription failed" in res.json()["detail"]
