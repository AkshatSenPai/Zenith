"""M7 Part-3.1 — triage noise classifier. Claude + budget seams mocked -> offline, deterministic."""

import datetime as dt
import json

import pytest

import triage_classifier as tc

NOW = dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc)


def _cand(tid, subject="Question", snippet="hi", auto="", fid="", age=10):
    return {"thread_id": tid, "from_name": "Rahul", "from_email": "r@a.com", "subject": subject,
            "snippet": snippet, "last_at": "2026-07-08T00:00:00+00:00", "age_hours": age,
            "source": "gmail", "last_message_id": f"<{tid}>", "auto_submitted": auto, "feedback_id": fid}


class _Block:
    type = "text"
    def __init__(self, text): self.text = text


class _Usage:
    input_tokens = 10
    output_tokens = 5


class _Resp:
    def __init__(self, text): self.content = [_Block(text)]; self.usage = _Usage()


class _FakeMessages:
    def __init__(self, reply): self.reply, self.calls = reply, []
    def create(self, **kw): self.calls.append(kw); return _Resp(self.reply)


class _FakeClient:
    def __init__(self, reply): self.messages = _FakeMessages(reply)


class _FakeLimiter:
    def __init__(self, ok=True): self._ok, self.usage = ok, []
    def ensure_budget(self): return (self._ok, "" if self._ok else "kill-switch")
    def record_usage(self, i, o): self.usage.append((i, o))


@pytest.fixture
def wired(monkeypatch, tmp_path):
    """Point the module at a temp cache + fake Claude/limiter. Returns a setup(reply, ok=True)."""
    def setup(reply, ok=True):
        client = _FakeClient(reply)
        limiter = _FakeLimiter(ok)
        monkeypatch.setattr(tc, "_CACHE", tmp_path / "triage_cache.json", raising=False)
        monkeypatch.setattr(tc.claude_service, "client", client)
        monkeypatch.setattr(tc.claude_service, "MODEL", "test-model")
        monkeypatch.setattr(tc.chat_core, "limiter", limiter)
        return client, limiter
    return setup


def test_prepass_auto_submitted_filtered_without_claude(wired):
    client, _ = wired(json.dumps([]))
    out = tc.classify([_cand("t1", auto="auto-generated")], now=NOW)
    assert out["waiting"] == []
    assert out["filtered"][0]["thread_id"] == "t1"
    assert out["filtered"][0]["reason"] == "automated notification"
    assert client.messages.calls == []          # zero tokens on the pre-pass path


def test_prepass_feedback_id_filtered(wired):
    wired(json.dumps([]))
    out = tc.classify([_cand("t1", fid="mc:123")], now=NOW)
    assert out["filtered"][0]["thread_id"] == "t1"


def test_client_question_waiting_and_receipt_filtered(wired):
    wired(json.dumps([{"id": "t1", "needs_reply": True, "reason": "client asks"},
                      {"id": "t2", "needs_reply": False, "reason": "receipt"}]))
    out = tc.classify([_cand("t1"), _cand("t2")], now=NOW)
    assert [r["thread_id"] for r in out["waiting"]] == ["t1"]
    assert out["filtered"][0]["thread_id"] == "t2"
    assert out["filtered"][0]["reason"] == "receipt"


def test_classify_call_binds_no_tools(wired):
    client, limiter = wired(json.dumps([{"id": "t1", "needs_reply": False, "reason": "fyi"}]))
    tc.classify([_cand("t1")], now=NOW)
    assert client.messages.calls, "Claude should have been called"
    assert "tools" not in client.messages.calls[0]     # THE core safety invariant
    assert limiter.usage == [(10, 5)]                   # usage recorded


def test_malformed_json_fails_open(wired):
    wired("not json at all")
    out = tc.classify([_cand("t1"), _cand("t2")], now=NOW)
    assert {r["thread_id"] for r in out["waiting"]} == {"t1", "t2"}
    assert out["filtered"] == []


def test_missing_id_in_response_fails_open(wired):
    wired(json.dumps([{"id": "t1", "needs_reply": False, "reason": "spam"}]))  # t2 omitted
    out = tc.classify([_cand("t1"), _cand("t2")], now=NOW)
    assert "t2" in {r["thread_id"] for r in out["waiting"]}     # unjudged -> kept


def test_kill_switch_skips_claude(wired):
    client, _ = wired(json.dumps([{"id": "t1", "needs_reply": False, "reason": "x"}]), ok=False)
    out = tc.classify([_cand("t1")], now=NOW)
    assert [r["thread_id"] for r in out["waiting"]] == ["t1"]   # budget blocked -> all waiting
    assert out["filtered"] == []
    assert client.messages.calls == []


def test_reason_is_clamped(wired):
    wired(json.dumps([{"id": "t1", "needs_reply": False, "reason": "x" * 200}]))
    out = tc.classify([_cand("t1")], now=NOW)
    assert len(out["filtered"][0]["reason"]) <= 80


def test_public_rows_strip_internal_keys(wired):
    wired(json.dumps([{"id": "t1", "needs_reply": True, "reason": ""}]))
    row = tc.classify([_cand("t1")], now=NOW)["waiting"][0]
    for k in ("last_message_id", "auto_submitted", "feedback_id"):
        assert k not in row
