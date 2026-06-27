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


# ---------- Task 2: the three directive builders ----------

def test_sequence_directive_has_brief_voice_format_and_language(_vault):
    vault_service.save_note("clients", "Shadnagar Heights", "Villa plots at Rs 21000/sq yd.", "new")
    d = copy_factory.build_sequence_brief("Shadnagar Heights", channel="both", language="hinglish")
    assert "21000" in d                       # real specifics
    assert "WABA" in d and "{{1}}" in d        # WhatsApp template format
    assert "Marketing" in d                    # category tagging
    assert "{{first_name}}" in d               # email merge var
    assert "hinglish" in d.lower() and "Latin" in d
    assert "Enquiry" in d and "No-show" in d   # the journey stages


def test_sequence_channel_filter(_vault):
    email_only = copy_factory.build_sequence_brief("Gym, Rs 1500/mo", channel="email")
    assert "{{first_name}}" in email_only and "WABA" not in email_only
    wa_only = copy_factory.build_sequence_brief("Gym, Rs 1500/mo", channel="whatsapp")
    assert "WABA" in wa_only and "Subject" not in wa_only


def test_ad_directive_meta_vs_google(_vault):
    meta = copy_factory.build_ad_brief("Gym, Rs 1500/mo", platform="meta")
    assert "PRIMARY TEXT" in meta and "CREATIVE BRIEF" in meta
    google = copy_factory.build_ad_brief("Gym, Rs 1500/mo", platform="google")
    assert "HEADLINES" in google and "30 char" in google and "KEYWORD THEMES" in google


def test_landing_directive_sections(_vault):
    d = copy_factory.build_landing_brief("Gym, Rs 1500/mo")
    for section in ("HERO", "TRUST", "BENEFITS", "FAQ", "FINAL CTA"):
        assert section in d


# ---------- Task 3: the three tools (output-only, not gated) ----------

import tools  # noqa: E402


def test_copy_tools_registered_output_only():
    for t in ("draft_sequence", "draft_ad_copy", "draft_landing_copy"):
        assert t in tools._EXECUTORS
        assert t not in tools.ACTION_TOOLS      # output-only — never gated
        assert t not in tools.UNTRUSTED_TOOLS


def test_draft_sequence_tool_returns_directive(_vault):
    out = tools.run_tool("draft_sequence", {"client_or_brief": "Gym, Rs 1500/mo", "channel": "both", "language": "en"})
    assert "COPY FACTORY" in out and "WABA" in out
