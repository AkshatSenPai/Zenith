"""M5 — tool-call logs must not leak message bodies by default (only the tool name + outcome)."""

import tools


def test_default_log_omits_bodies(capsys, monkeypatch):
    monkeypatch.delenv("ZENITH_DEBUG_LOGS", raising=False)
    tools.run_tool("send_message", {"to": "rahul", "body": "secret payload text"})
    out = capsys.readouterr().out
    assert "secret payload text" not in out      # body never logged by default
    assert "send_message -> ok" in out


def test_debug_flag_includes_bodies(capsys, monkeypatch):
    monkeypatch.setenv("ZENITH_DEBUG_LOGS", "1")
    tools.run_tool("send_message", {"to": "rahul", "body": "secret payload text"})
    out = capsys.readouterr().out
    assert "secret payload text" in out          # opt-in verbose logging for debugging
