"""App Launcher — whitelist-only launch of the owner's apps/files/sites.
OS launch calls are mocked so this suite is green on any platform."""

import json

import pytest

import app_launcher


# A fixed whitelist used by the resolve/launch/tool tests (no filesystem needed).
FIXTURE = [
    {"name": "Browser", "aliases": ["web", "google"], "target": "https://www.google.com", "type": "url"},
    {"name": "VS Code", "aliases": ["code", "editor"], "target": "code", "type": "command"},
    {"name": "Spotify", "aliases": ["music"], "target": "spotify:", "type": "protocol"},
    {"name": "Projects", "aliases": ["dev folder"], "target": r"C:\Users\me\Dev", "type": "path"},
]


@pytest.fixture
def wl(monkeypatch):
    """Patch load_apps to the fixture so resolve/launch tests don't touch apps.json."""
    monkeypatch.setattr(app_launcher, "load_apps", lambda: [dict(a) for a in FIXTURE])


# ---------- load_apps (real filesystem) ----------

def test_load_apps_reads_env_path(tmp_path, monkeypatch):
    p = tmp_path / "apps.json"
    p.write_text(json.dumps({"apps": [{"name": "X", "target": "https://x.com"}]}), encoding="utf-8")
    monkeypatch.setenv("ZENITH_APPS_PATH", str(p))
    assert app_launcher.load_apps() == [{"name": "X", "target": "https://x.com"}]


def test_load_apps_falls_back_to_example(monkeypatch, tmp_path):
    monkeypatch.setenv("ZENITH_APPS_PATH", str(tmp_path / "nope.json"))
    apps = app_launcher.load_apps()
    assert isinstance(apps, list) and len(apps) >= 1
    assert all(a.get("name") and a.get("target") for a in apps)


def test_load_apps_bad_json_returns_empty(monkeypatch, tmp_path):
    p = tmp_path / "apps.json"
    p.write_text("{ not json", encoding="utf-8")
    monkeypatch.setenv("ZENITH_APPS_PATH", str(p))
    assert app_launcher.load_apps() == []


def test_load_apps_drops_entries_missing_name_or_target(monkeypatch, tmp_path):
    p = tmp_path / "apps.json"
    p.write_text(json.dumps({"apps": [
        {"name": "Ok", "target": "https://o.com"}, {"name": "NoTarget"}, {"target": "x"},
    ]}), encoding="utf-8")
    monkeypatch.setenv("ZENITH_APPS_PATH", str(p))
    assert app_launcher.load_apps() == [{"name": "Ok", "target": "https://o.com"}]


# ---------- resolve (matching) ----------

def test_resolve_exact_name(wl):
    assert app_launcher.resolve("Spotify")["name"] == "Spotify"


def test_resolve_is_case_insensitive(wl):
    assert app_launcher.resolve("spOTifY")["name"] == "Spotify"


def test_resolve_by_alias(wl):
    assert app_launcher.resolve("music")["name"] == "Spotify"


def test_resolve_by_substring(wl):
    assert app_launcher.resolve("proj")["name"] == "Projects"


def test_resolve_fuzzy_typo(wl):
    assert app_launcher.resolve("spotfy")["name"] == "Spotify"


def test_resolve_normalizes_punctuation_and_spaces(wl):
    assert app_launcher.resolve("vs-code")["name"] == "VS Code"
    assert app_launcher.resolve("vs code")["name"] == "VS Code"


def test_unknown_raises_appnotfound_listing_options(wl):
    with pytest.raises(app_launcher.AppNotFound) as e:
        app_launcher.resolve("photoshop")
    msg = str(e.value)
    assert "Browser" in msg and "Spotify" in msg


def test_ambiguous_substring_refuses(monkeypatch):
    monkeypatch.setattr(app_launcher, "load_apps", lambda: [
        {"name": "Calendar", "target": "https://cal.example"},
        {"name": "Calculator", "target": "calc.exe"},
    ])
    # "cal" is a substring of both names and an exact alias of neither -> refuse, don't guess.
    with pytest.raises(app_launcher.AppNotFound):
        app_launcher.resolve("cal")


def test_list_apps_returns_names(wl):
    assert app_launcher.list_apps() == ["Browser", "VS Code", "Spotify", "Projects"]
