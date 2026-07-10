"""M7 Part 2 — proactivity. All Claude/Google/filesystem seams mocked → offline, cross-platform."""

import datetime as dt
import types

import pytest

import proactivity_service as ps


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ps, "_STORE", tmp_path / ".zenith" / "proactive.json")


def test_stable_id_is_deterministic_and_change_sensitive():
    a = ps._stable_id("commitment", "send Rahul the proposal")
    b = ps._stable_id("commitment", "send Rahul the proposal")
    c = ps._stable_id("commitment", "send Rahul the invoice")
    assert a == b                 # same subject → same id (survives recompute)
    assert a != c                 # materially different subject → different id
    assert a.startswith("commitment:")


def test_make_nudge_shape():
    n = ps.make_nudge("prep", "Call with Rahul", "info", "PREP",
                      "Call with Rahul at 3:00 (in 40 min).",
                      {"label": "Brief me", "prefill": "brief me on my meeting with Rahul"}, 55)
    assert set(n) == {"id", "kind", "tone", "title", "body", "action", "urgency"}
    assert n["kind"] == "prep" and n["urgency"] == 55
    assert n["action"]["label"] == "Brief me"
    assert n["id"].startswith("prep:")


def test_dismiss_suppresses_only_that_id(store):
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    ps.dismiss("commitment:a:111")
    assert ps.is_suppressed("commitment:a:111", now) is True
    assert ps.is_suppressed("commitment:b:222", now) is False


def test_snooze_hides_until_then_reappears(store):
    base = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    ps.snooze("prep:x:1", "tomorrow", now=base)
    assert ps.is_suppressed("prep:x:1", base) is True                       # still snoozed
    later = base + dt.timedelta(days=1, hours=6)                            # past tomorrow 09:00
    assert ps.is_suppressed("prep:x:1", later) is False                     # snooze expired


def test_prune_drops_orphaned_and_expired(store):
    base = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    ps.dismiss("commitment:gone:9")
    ps.snooze("prep:old:1", "evening", now=base)
    future = base + dt.timedelta(days=2)                                    # both should prune
    ps.prune(live_ids=set(), now=future)
    assert ps.is_suppressed("commitment:gone:9", future) is False
    assert ps.is_suppressed("prep:old:1", future) is False


def test_cache_roundtrip_and_corrupt_store_is_fresh(store, monkeypatch):
    assert ps.get_cache() == {"signature": "", "commitments": []}          # empty default
    ps.set_cache("sig1", [{"what": "x", "done": False}])
    assert ps.get_cache()["signature"] == "sig1"
    ps._STORE.write_text("{ broken", encoding="utf-8")                     # corrupt → fresh
    assert ps.get_cache() == {"signature": "", "commitments": []}


def _dtstr(y, mo, d, h, mi):
    return dt.datetime(y, mo, d, h, mi, tzinfo=dt.timezone.utc).isoformat()


def test_calendar_prep_for_soon_meeting():
    now = dt.datetime(2026, 7, 9, 14, 20, tzinfo=dt.timezone.utc)
    events = [{"id": "e1", "title": "Call with Rahul", "start": _dtstr(2026, 7, 9, 15, 0),
               "all_day": False, "attendees": ["rahul@acme.com"]}]
    out = ps._calendar_nudges(now, events)
    assert len(out) == 1 and out[0]["kind"] == "prep"
    assert "Rahul" in out[0]["body"]
    assert out[0]["action"]["prefill"].startswith("brief me")


def test_calendar_deadline_for_all_day_today():
    now = dt.datetime(2026, 7, 9, 9, 0, tzinfo=dt.timezone.utc)
    events = [{"id": "e2", "title": "Invoice due", "start": "2026-07-09", "all_day": True}]
    out = ps._calendar_nudges(now, events)
    assert len(out) == 1 and out[0]["kind"] == "deadline" and out[0]["tone"] == "alert"


def test_calendar_ignores_far_and_past_events():
    now = dt.datetime(2026, 7, 9, 14, 20, tzinfo=dt.timezone.utc)
    events = [
        {"id": "far", "title": "Later", "start": _dtstr(2026, 7, 9, 18, 0), "all_day": False},
        {"id": "past", "title": "Done", "start": _dtstr(2026, 7, 9, 13, 0), "all_day": False},
    ]
    assert ps._calendar_nudges(now, events) == []


def test_calendar_nudges_wrapper_swallows_errors(monkeypatch):
    def boom(**_k):
        raise RuntimeError("google not connected")
    monkeypatch.setattr(ps.google_service, "get_events", boom)
    assert ps.calendar_nudges(dt.datetime.now(dt.timezone.utc)) == []


class _Usage:
    input_tokens = 12
    output_tokens = 8


class _Resp:
    def __init__(self, text):
        self.content = [types.SimpleNamespace(type="text", text=text)]
        self.usage = _Usage()


def test_extract_parses_json_and_binds_no_tools(monkeypatch):
    seen = {}

    def fake_create(**kw):
        seen.update(kw)
        return _Resp('[{"what":"send proposal","who":"Rahul","by_when":"Fri","done":false}]')

    monkeypatch.setattr(ps.claude_service.client.messages, "create", fake_create)
    monkeypatch.setattr(ps.chat_core.limiter, "ensure_budget", lambda: (True, None))
    rec = {}
    monkeypatch.setattr(ps.chat_core.limiter, "record_usage", lambda i, o: rec.update(i=i, o=o))

    items = ps._extract_commitments("14:00 promised Rahul the proposal by Fri")
    assert items == [{"what": "send proposal", "who": "Rahul", "by_when": "Fri", "done": False}]
    assert "tools" not in seen               # SAFETY: the extraction call can never act
    assert rec == {"i": 12, "o": 8}          # usage counted against the daily budget


def test_extract_skipped_when_killswitch_tripped(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(ps.claude_service.client.messages, "create",
                        lambda **k: called.update(n=called["n"] + 1))
    monkeypatch.setattr(ps.chat_core.limiter, "ensure_budget", lambda: (False, "tripped"))
    assert ps._extract_commitments("anything") == []
    assert called["n"] == 0                   # no Claude call when the budget is blown


def test_extract_bad_json_returns_empty(monkeypatch):
    monkeypatch.setattr(ps.claude_service.client.messages, "create",
                        lambda **k: _Resp("sorry, no JSON here"))
    monkeypatch.setattr(ps.chat_core.limiter, "ensure_budget", lambda: (True, None))
    monkeypatch.setattr(ps.chat_core.limiter, "record_usage", lambda i, o: None)
    assert ps._extract_commitments("x") == []
