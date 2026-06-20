from fastapi.testclient import TestClient

import main


def test_health_route_exposes_active_whisper_device(monkeypatch):
    # GET /health must surface what whisper ACTUALLY loaded on, so the silent
    # CUDA->CPU fallback is verifiable straight from the browser.
    monkeypatch.setattr(main, "active_config", lambda: {
        "language": "en",
        "model": "large-v3",
        "device": "cpu",
        "compute": "int8",
        "requested_device": "cuda",
        "fallback": True,
        "error": "RuntimeError: CUDA driver / cuDNN not available",
    })
    client = TestClient(main.app)  # plain instance: startup warm not triggered
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["whisper"]["device"] == "cpu"
    assert body["whisper"]["requested_device"] == "cuda"
    assert body["whisper"]["fallback"] is True
    assert body["whisper"]["language"] == "en"
