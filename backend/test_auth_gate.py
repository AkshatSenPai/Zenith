"""M5 — the backend API-token gate (``auth.require_token``).

Posture: **fail-open** when ``ZENITH_API_TOKEN`` is unset (localhost-only; existing tests stay green),
**strictly enforced** the moment it is set — a missing or wrong ``X-Zenith-Token`` header → 401.
``GET /`` and ``GET /health`` are always exempt (liveness probes). TestClient is built WITHOUT a
``with`` block so the heavy startup warmups never run (same pattern as test_health_route).
"""

from fastapi.testclient import TestClient

import main

TOKEN = "test-secret-123"


def test_protected_route_401_without_header(monkeypatch):
    monkeypatch.setenv("ZENITH_API_TOKEN", TOKEN)
    res = TestClient(main.app).get("/usage")
    assert res.status_code == 401


def test_protected_route_401_with_wrong_header(monkeypatch):
    monkeypatch.setenv("ZENITH_API_TOKEN", TOKEN)
    res = TestClient(main.app).get("/usage", headers={"X-Zenith-Token": "wrong"})
    assert res.status_code == 401


def test_protected_route_ok_with_correct_header(monkeypatch):
    monkeypatch.setenv("ZENITH_API_TOKEN", TOKEN)
    res = TestClient(main.app).get("/usage", headers={"X-Zenith-Token": TOKEN})
    assert res.status_code == 200


def test_health_and_root_exempt_even_when_enforced(monkeypatch):
    monkeypatch.setenv("ZENITH_API_TOKEN", TOKEN)
    monkeypatch.setattr(main, "active_config", lambda: {"device": "cpu"})
    monkeypatch.setattr(main, "active_tts_config", lambda: {"engine": "edge"})
    client = TestClient(main.app)
    assert client.get("/health").status_code == 200   # exempt
    assert client.get("/").status_code == 200          # exempt


def test_fail_open_when_token_unset(monkeypatch):
    monkeypatch.delenv("ZENITH_API_TOKEN", raising=False)  # explicit; autouse already clears it
    res = TestClient(main.app).get("/usage")               # no header
    assert res.status_code == 200                           # localhost-only, allowed
