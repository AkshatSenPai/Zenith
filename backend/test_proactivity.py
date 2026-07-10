"""M7 Part 2 — proactivity. All Claude/Google/filesystem seams mocked → offline, cross-platform."""

import datetime as dt
import types

import pytest
from fastapi.testclient import TestClient

# Imported at module scope, NOT inside the `client` fixture: `auth` calls load_dotenv() at import,
# which would re-set the real ZENITH_API_TOKEN *after* conftest's autouse delenv and 401 the first
# route test. Collection-time import lets that autouse fixture clear it. (Same as test_auth_gate.)
import main
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


def test_commitment_map_open_item_to_nudge():
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    items = [{"what": "send the proposal", "who": "Rahul", "by_when": "Fri", "done": False}]
    out = ps._commitment_nudges(now, items)
    assert len(out) == 1 and out[0]["kind"] == "commitment"
    assert out[0]["action"]["label"] == "Draft it"
    assert "Rahul" in out[0]["body"]


def test_commitment_done_item_auto_clears():
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    items = [{"what": "send invoice", "who": "Priya", "by_when": None, "done": True}]
    assert ps._commitment_nudges(now, items) == []


def test_commitment_cache_hit_skips_claude(store, monkeypatch, tmp_path):
    daily = tmp_path / "daily"
    daily.mkdir(parents=True)
    (daily / "2026-07-09.md").write_text("promised Rahul the proposal", encoding="utf-8")
    monkeypatch.setattr(ps.vault_service, "vault_root", lambda: tmp_path)
    calls = {"n": 0}

    def fake_extract(_text):
        calls["n"] += 1
        return [{"what": "send the proposal", "who": "Rahul", "by_when": None, "done": False}]

    monkeypatch.setattr(ps, "_extract_commitments", fake_extract)
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    ps.commitment_nudges(now)          # cache miss → extract once
    ps.commitment_nudges(now)          # unchanged signature → reuse cache
    assert calls["n"] == 1


def test_commitment_cache_reextracts_on_change(store, monkeypatch, tmp_path):
    daily = tmp_path / "daily"
    daily.mkdir(parents=True)
    f = daily / "2026-07-09.md"
    f.write_text("promised Rahul the proposal", encoding="utf-8")
    monkeypatch.setattr(ps.vault_service, "vault_root", lambda: tmp_path)
    calls = {"n": 0}
    monkeypatch.setattr(ps, "_extract_commitments",
                        lambda _t: calls.update(n=calls["n"] + 1) or [])
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    ps.commitment_nudges(now)
    f.write_text("promised Rahul the proposal AND the invoice", encoding="utf-8")   # signature changes
    ps.commitment_nudges(now)
    assert calls["n"] == 2


def test_get_nudges_ranks_and_caps(store, monkeypatch):
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    many = [ps.make_nudge("prep", f"m{i}", "info", "PREP", f"m{i}", None, i * 10) for i in range(5)]
    monkeypatch.setattr(ps, "calendar_nudges", lambda now: many)
    monkeypatch.setattr(ps, "commitment_nudges", lambda now: [])
    out = ps.get_nudges(now)
    assert len(out) == ps.MAX_NUDGES
    assert [n["urgency"] for n in out] == [40, 30, 20]      # top-3 by urgency desc


def test_get_nudges_drops_suppressed(store, monkeypatch):
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    n = ps.make_nudge("commitment", "hide me", "info", "C", "b", None, 90)
    monkeypatch.setattr(ps, "calendar_nudges", lambda now: [n])
    monkeypatch.setattr(ps, "commitment_nudges", lambda now: [])
    ps.dismiss(n["id"])
    assert ps.get_nudges(now) == []


def test_get_nudges_best_effort_when_a_gatherer_raises(store, monkeypatch):
    now = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    good = ps.make_nudge("commitment", "keep", "info", "C", "b", None, 50)
    monkeypatch.setattr(ps, "calendar_nudges", lambda now: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setattr(ps, "commitment_nudges", lambda now: [good])
    out = ps.get_nudges(now)
    assert len(out) == 1 and out[0]["id"] == good["id"]


def test_dismiss_nudge_with_snooze_preset(store):
    base = dt.datetime(2026, 7, 9, 12, 0, tzinfo=dt.timezone.utc)
    ps.dismiss_nudge("prep:x:1", snooze_preset="tomorrow")
    assert ps.is_suppressed("prep:x:1", base) is True


@pytest.fixture
def client():
    return TestClient(main.app)


def test_get_proactive_returns_nudges(client, monkeypatch):
    monkeypatch.setattr(main.proactivity_service, "get_nudges",
                        lambda: [ps.make_nudge("prep", "a", "info", "PREP", "b", None, 50)])
    r = client.get("/proactive")
    assert r.status_code == 200
    assert r.json()["nudges"][0]["kind"] == "prep"


def test_get_proactive_stays_200_when_service_raises(client, monkeypatch):
    monkeypatch.setattr(main.proactivity_service, "get_nudges",
                        lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    r = client.get("/proactive")
    assert r.status_code == 200 and r.json() == {"nudges": []}


def test_post_dismiss_calls_service(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(main.proactivity_service, "dismiss_nudge",
                        lambda nudge_id, snooze_preset=None: seen.update(id=nudge_id, s=snooze_preset))
    r = client.post("/proactive/dismiss", json={"id": "prep:x:1", "snooze": "tomorrow"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert seen == {"id": "prep:x:1", "s": "tomorrow"}
