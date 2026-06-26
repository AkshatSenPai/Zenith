"""M5 Part 2 — confirm gate: process_confirm runs the tool only on approval, records a cancel on
decline, raises on an unknown id, and honours the daily token budget. Offline — run_loop and
run_tool are mocked so no Claude call or real side effect happens."""

import memory_service
import pytest
from rate_limiter import DAILY_TOKEN_BUDGET, RateLimiter

import chat_core


class _Block:
    """Stand-in for an Anthropic tool_use content block (the bits process_confirm reads)."""

    def __init__(self, name, inp, bid="tu_1"):
        self.type = "tool_use"
        self.name = name
        self.input = inp
        self.id = bid


def _stage_pending(monkeypatch, name="send_message", inp=None, channel="hud", aid="act_1"):
    """Seed chat_core.PENDING the way the real loop does: a user-text turn, then the assistant
    tool_use turn awaiting confirmation (working[-1]). Fresh full-budget limiter."""
    block = _Block(name, inp if inp is not None else {"to": "Rahul", "body": "hi"})
    working = [
        {"role": "user", "content": "text Rahul that I'm on my way"},
        {"role": "assistant", "content": [block]},
    ]
    chat_core.PENDING[aid] = {"working": working, "channel": channel}
    monkeypatch.setattr(chat_core, "limiter", RateLimiter())
    return aid, working, block


def test_approve_runs_the_tool_and_commits(monkeypatch):
    ran = []
    monkeypatch.setattr(chat_core, "run_tool", lambda n, i: ran.append((n, i)) or "sent")
    monkeypatch.setattr(chat_core, "run_loop", lambda working, limiter: {"reply": "Done, Boss."})
    aid, working, _ = _stage_pending(monkeypatch)

    out = chat_core.process_confirm(aid, True)

    assert ran == [("send_message", {"to": "Rahul", "body": "hi"})]   # executed on approval
    assert out["reply"] == "Done, Boss."
    tr = working[-1]["content"][0]                                     # tool_result fed back before resuming
    assert tr["type"] == "tool_result" and tr["content"] == "sent"
    assert memory_service.snapshot("hud")                             # history committed to the channel
    assert aid not in chat_core.PENDING                               # consumed


def test_decline_does_not_run_tool_and_records_cancel(monkeypatch):
    ran = []
    recorded = []
    monkeypatch.setattr(chat_core, "run_tool", lambda n, i: ran.append(n) or "SHOULD NOT RUN")
    monkeypatch.setattr(chat_core, "run_loop", lambda working, limiter: {"reply": "Okay, cancelled."})
    monkeypatch.setattr(chat_core.activity_log, "record", lambda name, target="", ok=True: recorded.append((name, ok)))
    aid, working, _ = _stage_pending(monkeypatch)

    out = chat_core.process_confirm(aid, False)

    assert ran == []                                   # the action never executed
    assert ("send_message", False) in recorded         # logged as a user cancel
    assert "cancel" in working[-1]["content"][0]["content"].lower()
    assert out["reply"] == "Okay, cancelled."


def test_unknown_id_raises_keyerror():
    with pytest.raises(KeyError):
        chat_core.process_confirm("does-not-exist", True)


def test_budget_killswitch_blocks_confirm(monkeypatch):
    def _boom(_n, _i):
        raise AssertionError("tool ran despite the budget kill-switch")

    monkeypatch.setattr(chat_core, "run_tool", _boom)
    aid, _, _ = _stage_pending(monkeypatch)
    chat_core.limiter._day_tokens = DAILY_TOKEN_BUDGET   # kill-switch tripped

    with pytest.raises(chat_core.RateLimited):
        chat_core.process_confirm(aid, True)
