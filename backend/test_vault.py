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
