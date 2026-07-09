# Proactivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface "what slipped on your side" — approaching meetings and unkept commitments — as ≤3 dismissable/snoozable nudge cards in the HUD, computed on-demand from Calendar + the vault daily notes.

**Architecture:** A backend `proactivity_service.py` gathers nudges from two sources (deterministic Calendar reads; Claude commitment-extraction over daily notes, cached and re-run only when a note changes), filters them through a persisted dismiss/snooze ledger (`.zenith/proactive.json`), ranks, and returns the top 3 from `GET /proactive`. The HUD polls that endpoint (60s + on focus) and renders a `NudgeStack` of `NudgeCard`s above the Command Center; Dismiss/Snooze POST back, and the action button prefills the Command Center.

**Tech Stack:** Python 3.11 / FastAPI backend (pytest, all seams mocked), Next.js 14 / React / Tailwind frontend (no unit harness → tsc + live screenshots), Anthropic SDK (`claude-sonnet-4-6`).

**Spec:** `docs/superpowers/specs/2026-07-09-proactivity-design.md`

## Global Constraints

- **Whitelist/trust:** proactivity reads only trusted owner data (Calendar, vault daily notes). Inbound-message reading is NOT in scope (that's M7 Part 3, triage).
- **No autonomous actions:** a nudge's action is a **prefill string only**; it never runs a tool. Anything that sends/creates still routes through the existing confirm gate.
- **Commitment extraction binds NO tools** on the Claude call — it can only return JSON, never act.
- **Budget:** extraction calls `chat_core.limiter.ensure_budget()` first and is skipped when the kill-switch is tripped; it records usage via `chat_core.limiter.record_usage(in, out)`. It is NOT subject to the 5/min request limit (never calls `check_request`).
- **Cap:** at most **3** nudges returned, ranked by `urgency` (0–100) descending.
- **Best-effort everywhere:** any gatherer or the store failing must degrade to "no nudges" / "fresh state", never a 500.
- **Model / client:** reuse `claude_service.client` and `claude_service.MODEL`. No new dependency.
- **Formatting:** no emojis in any nudge text (matches the ZENITH_PROMPT house style).
- **Persistence:** `.zenith/proactive.json`, same dir/pattern as `memory_service` (atomic tmp→`os.replace`, best-effort try/except, JSON). `.zenith/` is already gitignored.

---

### Task 1: Nudge builder + stable id

**Files:**
- Create: `backend/proactivity_service.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Produces: `make_nudge(kind: str, subject: str, tone: str, title: str, body: str, action: dict | None, urgency: int) -> dict` returning `{id, kind, tone, title, body, action, urgency}`; `_stable_id(kind: str, subject: str) -> str` → `"{kind}:{slug}:{shorthash}"`.

- [ ] **Step 1: Write the failing test**

```python
# backend/test_proactivity.py
"""M7 Part 2 — proactivity. All Claude/Google/filesystem seams mocked → offline, cross-platform."""

import proactivity_service as ps


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: FAIL — `AttributeError: module 'proactivity_service' has no attribute '_stable_id'` (or ModuleNotFound until the file exists).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/proactivity_service.py
"""Zenith — Proactivity (M7 Part 2). Surfaces "what slipped on your side" (approaching meetings,
unkept commitments) as ≤3 nudge cards, computed on demand. WHITELIST-OF-SOURCES: reads only the
owner's own trusted data (Calendar, vault daily notes). A nudge's action is a PREFILL string, never
an executed tool — nothing acts without the owner. Inbound-message triage is a separate feature."""

from __future__ import annotations

import hashlib
import re


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:40] or "x"


def _stable_id(kind: str, subject: str) -> str:
    """kind:slug:shorthash — dismiss/snooze remember THIS item across recomputes; a materially
    changed subject yields a new id, so a genuinely-new state can re-surface."""
    h = hashlib.sha1((kind + "|" + (subject or "")).encode("utf-8")).hexdigest()[:6]
    return f"{kind}:{_slug(subject)}:{h}"


def make_nudge(kind: str, subject: str, tone: str, title: str,
               body: str, action: dict | None, urgency: int) -> dict:
    return {
        "id": _stable_id(kind, subject),
        "kind": kind,
        "tone": tone,
        "title": title,
        "body": body,
        "action": action,
        "urgency": int(urgency),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/proactivity_service.py backend/test_proactivity.py
git commit -m "feat(proactivity): nudge model + stable id"
```

---

### Task 2: State store — dismiss/snooze ledger + extraction cache

**Files:**
- Modify: `backend/proactivity_service.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Consumes: nothing from Task 1 directly (parallel concern).
- Produces:
  - `dismiss(nudge_id: str) -> None`
  - `snooze(nudge_id: str, preset: str, now: datetime | None = None) -> None` (preset `"evening"`→today 20:00, `"tomorrow"`→tomorrow 09:00)
  - `is_suppressed(nudge_id: str, now: datetime) -> bool`
  - `prune(live_ids: set[str], now: datetime) -> None`
  - `get_cache() -> dict` → `{"signature": str, "commitments": list}`; `set_cache(signature: str, commitments: list) -> None`
  - module global `_STORE: Path`

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_proactivity.py
import datetime as dt


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ps, "_STORE", tmp_path / ".zenith" / "proactive.json")


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: FAIL — `AttributeError: module 'proactivity_service' has no attribute 'dismiss'`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/proactivity_service.py` (imports at top, rest below `make_nudge`):

```python
# --- add to the import block ---
import datetime as dt
import json
import os
from pathlib import Path

# --- state store (mirrors memory_service persistence) ---
_STORE = Path(__file__).resolve().parent / ".zenith" / "proactive.json"


def _blank_state() -> dict:
    return {"ledger": {"dismissed": {}, "snoozed": {}}, "cache": {"signature": "", "commitments": []}}


def _load() -> dict:
    """Read the whole state. A missing or corrupt file → a blank state (never raises)."""
    try:
        data = json.loads(_STORE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _blank_state()
    base = _blank_state()
    if isinstance(data, dict):
        base["ledger"]["dismissed"].update((data.get("ledger", {}) or {}).get("dismissed", {}) or {})
        base["ledger"]["snoozed"].update((data.get("ledger", {}) or {}).get("snoozed", {}) or {})
        cache = data.get("cache") or {}
        if isinstance(cache, dict):
            base["cache"]["signature"] = cache.get("signature", "") or ""
            base["cache"]["commitments"] = cache.get("commitments", []) or []
    return base


def _save(state: dict) -> None:
    """Atomically mirror state to disk. Best-effort — a disk error never breaks a poll."""
    try:
        _STORE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _STORE.parent / (_STORE.name + ".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, _STORE)
    except Exception as exc:  # noqa: BLE001 — persistence must never crash proactivity
        print(f"[proactive] could not persist state: {exc}", flush=True)


def _snooze_until(preset: str, now: dt.datetime) -> dt.datetime:
    """evening → today 20:00 (or tomorrow 20:00 if already past); tomorrow → tomorrow 09:00."""
    if preset == "tomorrow":
        d = (now + dt.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    else:  # "evening" and any unknown preset default to tonight
        d = now.replace(hour=20, minute=0, second=0, microsecond=0)
        if d <= now:
            d += dt.timedelta(days=1)
    return d


def dismiss(nudge_id: str) -> None:
    st = _load()
    st["ledger"]["dismissed"][nudge_id] = dt.datetime.now(dt.timezone.utc).isoformat()
    _save(st)


def snooze(nudge_id: str, preset: str, now: dt.datetime | None = None) -> None:
    now = now or dt.datetime.now(dt.timezone.utc)
    st = _load()
    st["ledger"]["snoozed"][nudge_id] = _snooze_until(preset, now).isoformat()
    _save(st)


def is_suppressed(nudge_id: str, now: dt.datetime) -> bool:
    st = _load()
    if nudge_id in st["ledger"]["dismissed"]:
        return True
    until = st["ledger"]["snoozed"].get(nudge_id)
    if until:
        try:
            return now < dt.datetime.fromisoformat(until)
        except ValueError:
            return False
    return False


def prune(live_ids: set[str], now: dt.datetime) -> None:
    """Drop dismissed entries whose nudge is no longer live, and expired snoozes."""
    st = _load()
    st["ledger"]["dismissed"] = {k: v for k, v in st["ledger"]["dismissed"].items() if k in live_ids}
    kept = {}
    for k, until in st["ledger"]["snoozed"].items():
        try:
            if now < dt.datetime.fromisoformat(until) and k in live_ids:
                kept[k] = until
        except ValueError:
            pass
    st["ledger"]["snoozed"] = kept
    _save(st)


def get_cache() -> dict:
    return _load()["cache"]


def set_cache(signature: str, commitments: list) -> None:
    st = _load()
    st["cache"] = {"signature": signature, "commitments": commitments}
    _save(st)
```

Also add `import pytest` to the top of `backend/test_proactivity.py` if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/proactivity_service.py backend/test_proactivity.py
git commit -m "feat(proactivity): dismiss/snooze ledger + extraction cache store"
```

---

### Task 3: Calendar gatherer

**Files:**
- Modify: `backend/proactivity_service.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Consumes: `make_nudge` (Task 1); `google_service.get_events(when="today")` returning `[{id, title, start, end, all_day, location, attendees, html_link}]`.
- Produces: `_calendar_nudges(now: datetime, events: list[dict]) -> list[dict]` (pure); `calendar_nudges(now: datetime) -> list[dict]` (IO wrapper, best-effort).

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_proactivity.py
import proactivity_service as ps  # already imported; shown for clarity


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k calendar -q`
Expected: FAIL — `AttributeError: ... has no attribute '_calendar_nudges'`.

- [ ] **Step 3: Write minimal implementation**

Add `import google_service` to the top import block, then append:

```python
# --- calendar gatherer (deterministic, no Claude) ---
PREP_WINDOW_MIN = 45          # a meeting within this many minutes → a prep nudge
_PREP_GRACE_MIN = 5           # ignore events that already started more than this many minutes ago


def _parse_start(ev: dict) -> dt.datetime | None:
    raw = ev.get("start")
    if not raw:
        return None
    try:
        if ev.get("all_day"):
            d = dt.date.fromisoformat(raw)
            return dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc)
        return dt.datetime.fromisoformat(raw)
    except ValueError:
        return None


def _first_name(ev: dict) -> str:
    """A human-ish label for the meeting subject: the event title, trimmed."""
    return (ev.get("title") or "your meeting").strip()


def _calendar_nudges(now: dt.datetime, events: list[dict]) -> list[dict]:
    out: list[dict] = []
    today = now.date()
    for ev in events:
        start = _parse_start(ev)
        if start is None:
            continue
        title = _first_name(ev)
        if ev.get("all_day"):
            days = (start.date() - today).days
            if days in (0, 1):
                when = "today" if days == 0 else "tomorrow"
                out.append(make_nudge(
                    "deadline", f"{ev.get('id')}-{title}", "alert" if days == 0 else "info",
                    "DEADLINE", f"{title} — due {when}.", None, 60 if days == 0 else 45))
            continue
        mins = (start - now).total_seconds() / 60
        if -_PREP_GRACE_MIN <= mins <= PREP_WINDOW_MIN:
            hhmm = start.strftime("%H:%M")
            urgency = max(40, min(95, int(90 - mins)))
            tone = "alert" if mins <= 10 else "info"
            out.append(make_nudge(
                "prep", f"{ev.get('id')}-{title}", tone, "PREP",
                f"{title} at {hhmm} (in {int(max(0, mins))} min).",
                {"label": "Brief me", "prefill": f"brief me on {title}"}, urgency))
    return out


def calendar_nudges(now: dt.datetime) -> list[dict]:
    """IO wrapper — best-effort; no Google connection / any error → no calendar nudges."""
    try:
        events = google_service.get_events(when="today")
    except Exception as exc:  # noqa: BLE001 — best-effort gatherer
        print(f"[proactive] calendar gather skipped: {exc}", flush=True)
        return []
    return _calendar_nudges(now, events)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k calendar -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/proactivity_service.py backend/test_proactivity.py
git commit -m "feat(proactivity): calendar gatherer (prep + deadline nudges)"
```

---

### Task 4: Commitment extractor (Claude, no tools, budget-aware)

**Files:**
- Modify: `backend/proactivity_service.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Consumes: `claude_service.client`, `claude_service.MODEL`; `chat_core.limiter` (`.ensure_budget()`, `.record_usage(in, out)`).
- Produces: `_extract_commitments(notes_text: str) -> list[dict]` → items `{what, who, by_when, done}`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_proactivity.py
import types


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k extract -q`
Expected: FAIL — `AttributeError: ... has no attribute '_extract_commitments'`.

- [ ] **Step 3: Write minimal implementation**

Add `import chat_core` and `import claude_service` to the import block, then append:

```python
# --- commitment extraction (Claude, NO tools bound → can only return JSON, never act) ---
_EXTRACT_MAX_TOKENS = 1024
_EXTRACT_SYSTEM = (
    "You extract COMMITMENTS the owner made, from their personal daily notes. A commitment is "
    "something the owner said they would do or send FOR someone — e.g. 'promised Rahul the proposal', "
    "'told Priya I'd send the invoice', 'need to follow up with Acme'.\n"
    "Return ONLY a JSON array, no prose, no code fences. Each item: "
    '{"what": short action phrase, "who": person/org or null, "by_when": deadline phrase or null, '
    '"done": true if the notes indicate it is already handled else false}.\n'
    "Ignore anything that is not a commitment BY the owner (general notes, meeting minutes, ideas, "
    "other people's requests). If there are no commitments, return []."
)


def _extract_commitments(notes_text: str) -> list[dict]:
    ok, _reason = chat_core.limiter.ensure_budget()
    if not ok:
        print("[proactive] commitment extraction skipped — token budget kill-switch engaged.", flush=True)
        return []
    try:
        resp = claude_service.client.messages.create(
            model=claude_service.MODEL,
            max_tokens=_EXTRACT_MAX_TOKENS,
            system=_EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": notes_text[:12000]}],
        )  # NOTE: no `tools=` — this call is structurally incapable of acting.
        chat_core.limiter.record_usage(resp.usage.input_tokens, resp.usage.output_tokens)
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        text = re.sub(r"^```(?:json)?|```$", "", text).strip()   # tolerate accidental fences
        data = json.loads(text)
        return [d for d in data if isinstance(d, dict) and d.get("what")]
    except Exception as exc:  # noqa: BLE001 — extraction is best-effort
        print(f"[proactive] commitment extraction failed: {exc}", flush=True)
        return []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k extract -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/proactivity_service.py backend/test_proactivity.py
git commit -m "feat(proactivity): Claude commitment extractor (no tools, budget-aware)"
```

---

### Task 5: Commitments gatherer + cache-on-change

**Files:**
- Modify: `backend/proactivity_service.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Consumes: `_extract_commitments` (Task 4); `get_cache`/`set_cache` (Task 2); `make_nudge` (Task 1); `vault_service.vault_root()`.
- Produces: `_commitment_nudges(now: datetime, items: list[dict]) -> list[dict]` (pure); `commitment_nudges(now: datetime) -> list[dict]` (IO wrapper w/ cache).

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_proactivity.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k commitment -q`
Expected: FAIL — `AttributeError: ... has no attribute '_commitment_nudges'`.

- [ ] **Step 3: Write minimal implementation**

Add `import vault_service` to the import block, then append:

```python
# --- commitments gatherer (Claude extraction, cached & keyed on the daily-note window changing) ---
_DAILY_WINDOW_DAYS = 7


def _daily_window(now: dt.datetime, days: int = _DAILY_WINDOW_DAYS) -> tuple[str, str]:
    """Return (signature, combined_text) over the last `days` daily notes. Signature = names+mtimes+
    sizes, so any edit invalidates the cache. Missing vault/daily dir → ('', '')."""
    try:
        daily = vault_service.vault_root() / "daily"
        files = []
        for i in range(days):
            f = daily / f"{(now - dt.timedelta(days=i)).strftime('%Y-%m-%d')}.md"
            if f.exists():
                files.append(f)
    except Exception:  # noqa: BLE001
        return "", ""
    parts, sig = [], []
    for f in sorted(files):
        try:
            stat = f.stat()
            sig.append(f"{f.name}:{int(stat.st_mtime)}:{stat.st_size}")
            parts.append(f"# {f.name}\n{f.read_text(encoding='utf-8')}")
        except OSError:
            continue
    return "|".join(sig), "\n\n".join(parts)


def _commitment_nudges(now: dt.datetime, items: list[dict]) -> list[dict]:
    out: list[dict] = []
    for it in items:
        if it.get("done") or not it.get("what"):
            continue
        what = str(it["what"]).strip()
        who = (it.get("who") or "").strip()
        by = (it.get("by_when") or "").strip()
        subject = f"{what} {who}".strip()
        body = f"You committed to {what}"
        if who:
            body += f" for {who}"
        body += f" (by {by})." if by else "."
        urgency = 70 if by else 55                       # a stated deadline bumps it up
        prefill = f"draft {what}" + (f" for {who}" if who else "")
        out.append(make_nudge("commitment", subject, "info", "COMMITMENT", body,
                               {"label": "Draft it", "prefill": prefill}, urgency))
    return out


def commitment_nudges(now: dt.datetime) -> list[dict]:
    """IO wrapper — extract only when the daily-note window changed, else reuse the cache."""
    signature, text = _daily_window(now)
    if not text:
        return []
    cache = get_cache()
    if signature and signature == cache.get("signature"):
        items = cache.get("commitments", [])
    else:
        items = _extract_commitments(text)
        set_cache(signature, items)
    return _commitment_nudges(now, items)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k commitment -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/proactivity_service.py backend/test_proactivity.py
git commit -m "feat(proactivity): commitments gatherer with change-keyed cache"
```

---

### Task 6: Compose — gather, filter, rank, dismiss

**Files:**
- Modify: `backend/proactivity_service.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Consumes: `calendar_nudges`, `commitment_nudges`, `is_suppressed`, `prune`, `dismiss`, `snooze`.
- Produces: `get_nudges(now: datetime | None = None) -> list[dict]` (≤3, ranked); `dismiss_nudge(nudge_id: str, snooze_preset: str | None = None) -> None`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_proactivity.py
MAX_NUDGES = 3


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k "get_nudges or dismiss_nudge" -q`
Expected: FAIL — `AttributeError: ... has no attribute 'get_nudges'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/proactivity_service.py`:

```python
# --- compose: gather → filter → prune → rank → top N ---
MAX_NUDGES = 3


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).astimezone()


def _safe(fn, now: dt.datetime) -> list[dict]:
    try:
        return fn(now)
    except Exception as exc:  # noqa: BLE001 — one gatherer failing never sinks the endpoint
        print(f"[proactive] gatherer {getattr(fn, '__name__', '?')} failed: {exc}", flush=True)
        return []


def get_nudges(now: dt.datetime | None = None) -> list[dict]:
    now = now or _now()
    gathered = _safe(calendar_nudges, now) + _safe(commitment_nudges, now)
    prune(live_ids={n["id"] for n in gathered}, now=now)
    visible = [n for n in gathered if not is_suppressed(n["id"], now)]
    visible.sort(key=lambda n: n["urgency"], reverse=True)
    return visible[:MAX_NUDGES]


def dismiss_nudge(nudge_id: str, snooze_preset: str | None = None) -> None:
    if snooze_preset:
        snooze(nudge_id, snooze_preset)
    else:
        dismiss(nudge_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -q`
Expected: PASS (whole file green — ~20 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/proactivity_service.py backend/test_proactivity.py
git commit -m "feat(proactivity): compose gather/filter/rank + dismiss_nudge"
```

---

### Task 7: FastAPI routes

**Files:**
- Modify: `backend/main.py`
- Test: `backend/test_proactivity.py`

**Interfaces:**
- Consumes: `proactivity_service.get_nudges`, `proactivity_service.dismiss_nudge`.
- Produces: `GET /proactive` → `{"nudges": [...]}`; `POST /proactive/dismiss` body `{id, snooze?}` → `{"ok": true}`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_proactivity.py
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    import main
    return TestClient(main.app)


def test_get_proactive_returns_nudges(client, monkeypatch):
    import main
    monkeypatch.setattr(main.proactivity_service, "get_nudges",
                        lambda: [ps.make_nudge("prep", "a", "info", "PREP", "b", None, 50)])
    r = client.get("/proactive")
    assert r.status_code == 200
    assert r.json()["nudges"][0]["kind"] == "prep"


def test_get_proactive_stays_200_when_service_raises(client, monkeypatch):
    import main
    monkeypatch.setattr(main.proactivity_service, "get_nudges",
                        lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    r = client.get("/proactive")
    assert r.status_code == 200 and r.json() == {"nudges": []}


def test_post_dismiss_calls_service(client, monkeypatch):
    import main
    seen = {}
    monkeypatch.setattr(main.proactivity_service, "dismiss_nudge",
                        lambda nudge_id, snooze_preset=None: seen.update(id=nudge_id, s=snooze_preset))
    r = client.post("/proactive/dismiss", json={"id": "prep:x:1", "snooze": "tomorrow"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert seen == {"id": "prep:x:1", "s": "tomorrow"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k proactive -q`
Expected: FAIL — 404 on `/proactive` (route not defined yet).

- [ ] **Step 3: Write minimal implementation**

Add `import proactivity_service` to the top imports of `backend/main.py` (alongside the other service imports, ~line 16). Then add near the other GET routes (e.g. after the `calendar_events` route ~line 236):

```python
class DismissRequest(BaseModel):
    id: str
    snooze: str | None = None      # "evening" | "tomorrow" | None (None = dismiss permanently)


@app.get("/proactive")
def proactive() -> dict:
    """Proactive nudges (≤3, ranked). Best-effort — never 500s the HUD poll."""
    try:
        return {"nudges": proactivity_service.get_nudges()}
    except Exception as exc:  # noqa: BLE001 — a poll must never error the HUD
        print(f"[proactive] endpoint error: {exc}", flush=True)
        return {"nudges": []}


@app.post("/proactive/dismiss")
def proactive_dismiss(req: DismissRequest) -> dict:
    proactivity_service.dismiss_nudge(req.id, snooze_preset=req.snooze)
    return {"ok": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_proactivity.py -k proactive -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the full fast suite + commit**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: PASS (~220 passed).

```bash
git add backend/main.py backend/test_proactivity.py
git commit -m "feat(proactivity): GET /proactive + POST /proactive/dismiss routes"
```

---

### Task 8: Shared card shell + NudgeCard component

> **Pre-flight decision (2026-07-09):** to avoid duplicating StatusCard's `Corner` + tone map, extract them into a shared `cardShell` module that BOTH StatusCard and NudgeCard import. StatusCard's rendered output is unchanged (identical classes).

**Files:**
- Create: `frontend/components/cardShell.tsx`
- Modify: `frontend/components/StatusCard.tsx`
- Create: `frontend/components/NudgeCard.tsx`

**Interfaces:**
- Produces: `cardShell` exports `Corner`, `TONES`, `type Tone` (`"info"|"alert"|"critical"`); `type Nudge = { id: string; kind: string; tone: Tone; title: string; body: string; action: { label: string; prefill: string } | null; urgency: number }`; `NudgeCard({ nudge, onAction, onDismiss, onSnooze })`.

- [ ] **Step 1: Create the shared shell module**

```tsx
// frontend/components/cardShell.tsx
export type Tone = "info" | "alert" | "critical";

export const TONES: Record<Tone, { border: string; text: string; corner: string }> = {
  info: { border: "border-zenith-cyan/40", text: "text-zenith-cyan", corner: "border-zenith-cyan" },
  alert: { border: "border-zenith-alert/55", text: "text-zenith-alert", corner: "border-zenith-alert" },
  critical: { border: "border-zenith-red/60", text: "text-zenith-red", corner: "border-zenith-red" },
};

/** The notched-corner accent shared by the confirm card and proactive nudge cards. */
export function Corner({ pos, cls }: { pos: "tl" | "tr" | "bl" | "br"; cls: string }) {
  const m: Record<string, string> = {
    tl: "left-0 top-0 border-l border-t",
    tr: "right-0 top-0 border-r border-t",
    bl: "bottom-0 left-0 border-b border-l",
    br: "bottom-0 right-0 border-b border-r",
  };
  return <span className={`pointer-events-none absolute h-2.5 w-2.5 ${m[pos]} ${cls}`} />;
}
```

- [ ] **Step 2: Refactor StatusCard to use the shared shell (rendered output unchanged)**

In `frontend/components/StatusCard.tsx`: delete the inline `type Tone`, the `const tones` map, and the `function Corner` (lines 1–17); import them from `cardShell` instead; and rename the local lookup `tones[tone]` → `TONES[tone]`.

Add at the top:
```tsx
import { Corner, TONES, type Tone } from "./cardShell";
```
Then, in the `StatusCard` body, change:
```tsx
  const t = tones[tone];
```
to:
```tsx
  const t = TONES[tone];
```
Everything else in StatusCard stays exactly as-is (the class strings are identical, so the confirm card renders the same).

- [ ] **Step 3: Verify StatusCard still compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Create NudgeCard using the shared shell**

```tsx
// frontend/components/NudgeCard.tsx
import { Corner, TONES, type Tone } from "./cardShell";

export type Nudge = {
  id: string;
  kind: string;
  tone: Tone;
  title: string;
  body: string;
  action: { label: string; prefill: string } | null;
  urgency: number;
};

/** A single proactive nudge. Same notched shell as StatusCard (shared cardShell), but its own
 *  footer: primary action (prefills the Command Center) + Snooze (Tonight/Tomorrow) + Dismiss. */
export function NudgeCard({
  nudge, onAction, onDismiss, onSnooze,
}: {
  nudge: Nudge;
  onAction: (n: Nudge) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, preset: "evening" | "tomorrow") => void;
}) {
  const t = TONES[nudge.tone] ?? TONES.info;
  return (
    <div className={`status-surface relative border ${t.border} px-4 py-3`}>
      <Corner pos="tl" cls={t.corner} /><Corner pos="tr" cls={t.corner} />
      <Corner pos="bl" cls={t.corner} /><Corner pos="br" cls={t.corner} />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${t.text}`}>{nudge.title}</span>
        <button
          onClick={() => onDismiss(nudge.id)}
          aria-label="Dismiss"
          className="press font-mono text-[11px] text-zenith-lo transition hover:text-zenith-alert"
        >✕</button>
      </div>
      <div className="text-sm leading-relaxed text-zenith-mid">{nudge.body}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {nudge.action && (
          <button
            onClick={() => onAction(nudge)}
            className="press rounded-md bg-zenith-cyan px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zenith-bg transition hover:opacity-90"
          >{nudge.action.label}</button>
        )}
        <button
          onClick={() => onSnooze(nudge.id, "evening")}
          className="press rounded-md border border-zenith-line2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo transition hover:text-zenith-mid"
        >Tonight</button>
        <button
          onClick={() => onSnooze(nudge.id, "tomorrow")}
          className="press rounded-md border border-zenith-line2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo transition hover:text-zenith-mid"
        >Tomorrow</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/cardShell.tsx frontend/components/StatusCard.tsx frontend/components/NudgeCard.tsx
git commit -m "feat(proactivity): shared card shell + NudgeCard component"
```

---

### Task 9: NudgeStack component

**Files:**
- Create: `frontend/components/NudgeStack.tsx`

**Interfaces:**
- Consumes: `NudgeCard`, `Nudge` (Task 8).
- Produces: `NudgeStack({ nudges, onAction, onDismiss, onSnooze })` — renders nothing when empty; a capped, scroll-safe vertical stack otherwise.

- [ ] **Step 1: Create the component**

```tsx
// frontend/components/NudgeStack.tsx
import { NudgeCard, type Nudge } from "./NudgeCard";

/** The proactive nudge stack, pinned above the Command Center. Renders nothing when empty so it
 *  takes no space; caps its own height and scrolls internally so it never pushes the CC off-screen. */
export function NudgeStack({
  nudges, onAction, onDismiss, onSnooze,
}: {
  nudges: Nudge[];
  onAction: (n: Nudge) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, preset: "evening" | "tomorrow") => void;
}) {
  if (!nudges.length) return null;
  return (
    <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
      {nudges.map((n) => (
        <NudgeCard key={n.id} nudge={n} onAction={onAction} onDismiss={onDismiss} onSnooze={onSnooze} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/NudgeStack.tsx
git commit -m "feat(proactivity): NudgeStack component"
```

---

### Task 10: Wire proactivity into the HUD

**Files:**
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `NudgeStack`, `Nudge` (Tasks 8–9); `apiFetch` (existing); `GET /proactive`, `POST /proactive/dismiss` (Task 7); the existing Command-Center prefill setter and the `pending` StatusCard render block.

- [ ] **Step 1: Add imports + state + polling**

Near the other component imports at the top of `frontend/app/page.tsx`:

```tsx
import { NudgeStack } from "../components/NudgeStack";
import type { Nudge } from "../components/NudgeCard";
```

Near the other `useState` hooks (by `const [pending, setPending] = useState<PendingAction | null>(null);`):

```tsx
const [nudges, setNudges] = useState<Nudge[]>([]);
```

Add a polling effect alongside the existing `refreshDiscord`/`refreshUsage` effects (mirror their shape — `apiFetch`, 60s interval, plus a window-focus refetch like the FocusCard uses):

```tsx
useEffect(() => {
  let alive = true;
  async function refreshProactive() {
    try {
      const r = await apiFetch("/proactive");
      const data = await r.json();
      if (alive && Array.isArray(data.nudges)) setNudges(data.nudges as Nudge[]);
    } catch {
      /* best-effort: keep last state, same as the other panels */
    }
  }
  refreshProactive();
  const id = setInterval(refreshProactive, 60000);
  window.addEventListener("focus", refreshProactive);
  return () => { alive = false; clearInterval(id); window.removeEventListener("focus", refreshProactive); };
}, []);
```

- [ ] **Step 2: Add the action / dismiss / snooze handlers**

Near `resolvePending`, add. The Command-Center prefill setter already exists in this file: `prefillInput(text)` (it calls `setInput(text)`; `QuickActions` uses it via `onPrefill={prefillInput}`). Reuse it:

```tsx
function onNudgeAction(n: Nudge) {
  if (n.action) prefillInput(n.action.prefill);  // existing CC prefill setter (page.tsx ~line 265)
  dismissNudge(n.id);                            // acting on it clears the card
}
async function dismissNudge(id: string, snooze?: "evening" | "tomorrow") {
  setNudges((cur) => cur.filter((n) => n.id !== id));   // optimistic remove
  try {
    await apiFetch("/proactive/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, snooze: snooze ?? null }),
    });
  } catch { /* best-effort; next poll reconciles */ }
}
```

- [ ] **Step 3: Render the stack above the Command Center, below any confirm card**

Find the `{pending && ( ... <StatusCard ... /> ... )}` block (around the Command Center render). Immediately AFTER that block (so an active confirm card sits on top), add:

```tsx
<NudgeStack
  nudges={nudges}
  onAction={onNudgeAction}
  onDismiss={(id) => dismissNudge(id)}
  onSnooze={(id, preset) => dismissNudge(id, preset)}
/>
```

- [ ] **Step 4: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(proactivity): poll + render nudge stack in the HUD"
```

---

### Task 11: Live verification across skins

**Files:** none (verification + evidence)

- [ ] **Step 1: Confirm the full backend suite is green**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: ~220 passed.

- [ ] **Step 2: Start both servers**

```bash
cd backend && ./.venv/Scripts/python.exe -m uvicorn main:app --port 8000   # background
cd frontend && npm run dev                                                 # background
```

- [ ] **Step 3: Seed a nudge and verify end-to-end**

Add a commitment to today's daily note (via the HUD: "note that I promised Rahul the proposal by Friday") and put a test event ~30 min out on your calendar. Then, on the main dashboard at http://localhost:3000, verify a nudge stack appears above the Command Center. Screenshot on all three skins (Arc / Ghost / Amethyst — switch via Settings).

- [ ] **Step 4: Verify the interactions**

Confirm: an active confirm card renders **above** the nudge stack; **Dismiss** (✕) removes a card and it doesn't return on the next poll; **Snooze → Tonight/Tomorrow** hides it; the action button (**Draft it / Brief me**) prefills the Command Center; a reduced-motion pass shows no entrance animation.

- [ ] **Step 5: Commit any screenshot evidence (optional) and report**

Report results (pass/fail per skin + interaction). Docs (`CLAUDE.md` build order + Key Decisions, `JARVIS_PRD.md`) are updated at branch-finish, per project convention.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- §4 nudge model → Task 1. §5.1 calendar → Task 3. §5.2 commitments + cache → Tasks 4–5. §5.3 to-dos excluded → honored (no to-do gatherer). §6 state/filter/prune/rank → Tasks 2, 6. §7 endpoints → Task 7. §8 injection (no-tools assert) / budget (kill-switch skip) / errors (best-effort) → Tasks 4, 6, 7. §9 HUD placement/components/polling → Tasks 8–10. §11 tests → each task's tests + Task 11 live QA.
- **Deferred correctly:** background loop, dated to-dos, full-history commitments, triage (all §10).

**Placeholder scan** — none. Task 10 uses the real, verified setter `prefillInput` (page.tsx ~line 265, the same one `QuickActions` uses via `onPrefill`). Every code step is complete and runnable.

**Type consistency** — `Nudge` shape identical across backend `make_nudge` (Task 1), the TS `Nudge` type (Task 8), and the endpoint (Task 7). `dismiss_nudge(nudge_id, snooze_preset=None)` (Task 6) matches the route call in Task 7 and the `{id, snooze}` body in Task 10. `get_nudges` / `calendar_nudges` / `commitment_nudges` / `is_suppressed` / `prune` names consistent across Tasks 2–7.
