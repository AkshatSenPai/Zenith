from main import allowed_origins

TAURI = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}
DEV1420 = {"http://localhost:1420", "http://127.0.0.1:1420"}


def test_default_includes_tauri_and_1420_origins():
    origins = set(allowed_origins(None))
    assert TAURI <= origins, "Tauri WebView origins must be allowed by default"
    assert DEV1420 <= origins, "Tauri dev port 1420 must be allowed by default"
    # existing dev ports stay allowed
    assert "http://localhost:3000" in origins


def test_env_override_replaces_default():
    assert allowed_origins("http://example.com , http://foo") == ["http://example.com", "http://foo"]


def test_blank_env_falls_back_to_default():
    assert "http://tauri.localhost" in allowed_origins("")
