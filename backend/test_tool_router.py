"""M5 Part 2 — tool router: run_tool dispatch + unknown-tool handling + ACTION_TOOLS invariants,
plus the run_loop confirm gate (action tools return a pending action and are NOT executed; read
tools run inline). Offline — the single Claude call inside run_loop is mocked."""

import datetime as dt
import types

import claude_service
from rate_limiter import RateLimiter
from tools import ACTION_TOOLS, _EXECUTORS, run_tool


# ---------- run_tool dispatch ----------

def test_dispatch_runs_the_named_executor():
    out = run_tool("get_current_time", {})
    assert not out.startswith("Error")
    assert str(dt.datetime.now().year) in out      # _get_current_time formats the current date


def test_dispatch_passes_input_to_executor():
    out = run_tool("send_message", {"to": "Rahul", "body": "on my way"})
    assert "Rahul" in out and "stub" in out         # reached _send_message with the input


def test_unknown_tool_returns_error_string_not_raise():
    out = run_tool("no_such_tool", {"x": 1})
    assert out.startswith("Error: unknown tool") and "no_such_tool" in out


def test_none_input_is_tolerated():
    assert not run_tool("get_current_time", None).startswith("Error")


# ---------- ACTION_TOOLS invariants ----------

def test_action_tools_are_the_state_changing_ones():
    for t in ("send_message", "send_email", "create_event", "update_event", "delete_event", "send_discord_message"):
        assert t in ACTION_TOOLS
    for t in ("get_current_time", "get_calendar_events", "get_emails", "get_weather", "get_news", "list_discord_channels"):
        assert t not in ACTION_TOOLS


def test_every_action_tool_has_an_executor():
    # nothing may be gated that can't actually be run on approval
    assert ACTION_TOOLS <= set(_EXECUTORS)


# ---------- run_loop confirm gate (mock the Claude call) ----------

class _Usage:
    input_tokens = 10
    output_tokens = 5


def _block(**kw):
    return types.SimpleNamespace(**kw)


def _tool_use_resp(name, inp, bid="tu_1"):
    return types.SimpleNamespace(
        stop_reason="tool_use", usage=_Usage(),
        content=[_block(type="tool_use", name=name, input=inp, id=bid)],
    )


def _text_resp(text):
    return types.SimpleNamespace(
        stop_reason="end_turn", usage=_Usage(),
        content=[_block(type="text", text=text)],
    )


def test_action_tool_returns_pending_and_is_not_executed(monkeypatch):
    ran = []
    monkeypatch.setattr(claude_service, "run_tool", lambda n, i: ran.append(n) or "RAN")
    monkeypatch.setattr(claude_service, "_create", lambda messages: _tool_use_resp("send_email", {"to": "a@b.com"}))
    out = claude_service.run_loop([{"role": "user", "content": "email a@b.com"}], RateLimiter())
    assert out["tool"] == "send_email" and "pending" in out
    assert out["untrusted"] is False
    assert ran == []                                 # gated — the executor never ran


def test_read_tool_runs_inline_then_replies(monkeypatch):
    ran = []
    monkeypatch.setattr(claude_service, "run_tool", lambda n, i: ran.append(n) or "Friday, 26 June")
    responses = iter([_tool_use_resp("get_current_time", {}), _text_resp("It's Friday, Boss.")])
    monkeypatch.setattr(claude_service, "_create", lambda messages: next(responses))
    out = claude_service.run_loop([{"role": "user", "content": "time?"}], RateLimiter())
    assert ran == ["get_current_time"]               # ran inline (read tools are not gated)
    assert out["reply"] == "It's Friday, Boss."
