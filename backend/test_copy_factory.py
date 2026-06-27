"""M6 Part 2 — Copy Factory: brief resolution (vault note vs inline), voice context, and the three
output-only directive builders. The tools return a DIRECTIVE (brief + voice + format) — Claude writes
the actual copy in the loop, so these tests assert the directive content, not generated copy."""

import pytest
import copy_factory
import vault_service


@pytest.fixture(autouse=True)
def _vault(tmp_path, monkeypatch):
    root = tmp_path / "Zenith Vault"
    root.mkdir()
    monkeypatch.setenv("ZENITH_VAULT_PATH", str(root))
    return root


def test_resolve_brief_from_vault_client_note(_vault):
    vault_service.save_note("clients", "Shadnagar Heights", "Villa plots, 166 sq yd, Rs 21000/sq yd.", "new")
    brief, name = copy_factory.resolve_brief("Shadnagar Heights")
    assert "21000" in brief and name == "Shadnagar Heights"


def test_resolve_brief_falls_back_to_inline(_vault):
    brief, name = copy_factory.resolve_brief("Brand new gym in Pune, Rs 1500/month, first class free.")
    assert "Pune" in brief and name is None


def test_voice_context_reads_voice_note_else_empty(_vault):
    assert copy_factory.voice_context() == ""           # nothing to learn from yet
    vault_service.save_note("notes", "voice", "Warm, direct, no fluff. Short sentences.", "new")
    assert "no fluff" in copy_factory.voice_context()
