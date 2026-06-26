"""M6 Part 1 — memory vault: save/read/search/list round-trips, append accumulation, dated daily
logs, and path-safety (a title/folder can NEVER escape the vault). Filesystem only — no Claude."""

import datetime as dt

import pytest

import vault_service


@pytest.fixture(autouse=True)
def _vault(tmp_path, monkeypatch):
    # a path WITH A SPACE, like the real Obsidian vault
    root = tmp_path / "Zenith Vault"
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(root))
    return root


# ---------- Task 1: core save/read + path safety ----------

def test_save_new_then_read_roundtrip(_vault):
    vault_service.save_note("clients", "Rahul", "Owes a proposal by Friday.", "new")
    assert (_vault / "clients" / "Rahul.md").exists()
    assert "proposal" in vault_service.read("clients/Rahul.md")
    assert "proposal" in vault_service.read("Rahul")        # resolve by title too


def test_spaced_path_is_handled(_vault):
    vault_service.save_note("notes", "Idea", "x", "new")
    assert (_vault / "notes" / "Idea.md").exists()           # root has a space; still works


def test_quoted_env_path_is_stripped(tmp_path, monkeypatch):
    root = tmp_path / "v"
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", f'"{root}"')     # surrounding quotes
    assert vault_service.vault_root() == root.resolve()


@pytest.mark.parametrize("folder,title", [
    ("../../etc", "passwd"),
    ("clients", "../../escape"),
    ("clients", "../escape"),
    ("C:\\Windows", "system"),
    ("notes", "/abs"),
])
def test_path_safety_cannot_escape(_vault, folder, title):
    with pytest.raises(ValueError):
        vault_service._safe_path(folder, title)
    assert not (_vault.parent / "escape.md").exists()
    assert not (_vault.parent / "passwd.md").exists()


# ---------- Task 2: search / list / append / daily-log ----------

def test_append_accumulates(_vault):
    vault_service.save_note("notes", "Log", "first", "append")
    vault_service.save_note("notes", "Log", "second", "append")
    body = vault_service.read("notes/Log")
    assert "first" in body and "second" in body


def test_daily_log_writes_to_dated_file(_vault):
    vault_service.save_note("daily", "", "promised Rahul the proposal by Friday", "append")
    today = dt.date.today().isoformat()
    f = _vault / "daily" / f"{today}.md"
    assert f.exists() and "Rahul" in f.read_text(encoding="utf-8")


def test_search_matches_filename_and_content(_vault):
    vault_service.save_note("clients", "Rahul", "Wants the funnel revised.", "new")
    vault_service.save_note("notes", "Pricing", "Rahul asked about pricing.", "new")
    hits = {h["path"] for h in vault_service.search("rahul")}
    assert "clients/Rahul.md" in hits and "notes/Pricing.md" in hits


def test_list_notes_by_folder_and_recent(_vault):
    vault_service.save_note("clients", "A", "x", "new")
    vault_service.save_note("notes", "B", "y", "new")
    assert [n["title"] for n in vault_service.list_notes("clients")] == ["A"]
    assert len(vault_service.list_notes(recent=10)) == 2


def test_empty_vault_and_missing_note(tmp_path, monkeypatch):
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(tmp_path / "empty"))
    assert vault_service.search("anything") == []
    assert vault_service.list_notes() == []
    assert vault_service.read("nope") is None
