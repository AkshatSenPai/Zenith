"""M7 Part 2 — proactivity. All Claude/Google/filesystem seams mocked → offline, cross-platform."""

import datetime as dt

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
