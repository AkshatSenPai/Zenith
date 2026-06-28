"""Fix: the morning-briefing button must ALWAYS run fresh.

Bug: the "Good morning" button sent the literal text through the normal loop WITH the last-20 chat
history. A prior briefing in that history made Claude refuse to re-brief ("already said good morning,
Boss — scroll up"), and the history persists across restarts, so it bled between sessions.

Fix: process_chat(fresh=True) hides prior history from Claude for that one turn (so a briefing is
never deduplicated against earlier turns) but still PRESERVES prior history and APPENDS the fresh
turn, so repeated briefings always work and follow-up questions keep their context. run_loop and the
limiter are mocked — no Claude call."""

import memory_service
from rate_limiter import RateLimiter

import chat_core


def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_service, "_STORE", tmp_path / "history.json")
    memory_service._history.clear()
    monkeypatch.setattr(chat_core, "limiter", RateLimiter())


def _fake_loop(seen):
    """Mimic run_loop: snapshot what Claude was given, then append the assistant reply in place."""
    def loop(working, limiter):
        seen["claude_saw"] = [m["content"] for m in working]
        working.append({"role": "assistant", "content": "Fresh briefing."})
        return {"reply": "Fresh briefing."}
    return loop


def test_fresh_hides_prior_history_from_claude(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    memory_service.commit("hud", [
        {"role": "user", "content": "good morning"},
        {"role": "assistant", "content": "Here's your briefing, Boss."},
    ])
    seen = {}
    monkeypatch.setattr(chat_core, "run_loop", _fake_loop(seen))

    out = chat_core.process_chat("good evening", channel="hud", fresh=True)

    assert seen["claude_saw"] == ["good evening"]   # no prior 'good morning'/briefing to dedup against
    assert out["reply"] == "Fresh briefing."


def test_fresh_preserves_and_appends_history(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    memory_service.commit("hud", [{"role": "user", "content": "earlier note"}])
    monkeypatch.setattr(chat_core, "run_loop", _fake_loop({}))

    chat_core.process_chat("good evening", channel="hud", fresh=True)

    contents = [m["content"] for m in memory_service.snapshot("hud")]
    assert "earlier note" in contents       # prior context kept (follow-ups still work)
    assert "good evening" in contents        # the fresh turn appended
    assert "Fresh briefing." in contents     # ...with its reply


def test_non_fresh_still_sees_history(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    memory_service.commit("hud", [{"role": "user", "content": "prior turn"}])
    seen = {}
    monkeypatch.setattr(chat_core, "run_loop", _fake_loop(seen))

    chat_core.process_chat("normal message", channel="hud")  # fresh defaults to False

    assert "prior turn" in seen["claude_saw"] and "normal message" in seen["claude_saw"]
