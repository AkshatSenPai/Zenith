# Message Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer "who is waiting on a reply from me?" over Gmail — a deterministic, zero-token Triage view plus a chat tool, with a confirm-gated in-thread `reply_email` whose recipient the model can never choose.

**Architecture:** A new `backend/triage_service.py` finds waiting threads deterministically (Gmail query → per-thread "is the last message mine?" test) using four thin new `google_service` helpers. Two tools ride the EXISTING loop + confirm gate: `list_waiting_replies` (read-only, fenced as untrusted) and `reply_email` (in `ACTION_TOOLS`, always gated; To/Subject/In-Reply-To derived server-side from the thread). `GET /triage` feeds a new `TriageView` whose **Draft reply** button prefills the Command Center — an inert string that never runs a tool.

**Tech Stack:** Python 3.11 / FastAPI backend (pytest, all Google seams mocked), Next.js 14 / React / Tailwind frontend (no unit harness → `tsc --noEmit` + live screenshots), Gmail REST v1 via `google_auth`.

**Spec:** `docs/superpowers/specs/2026-07-10-message-triage-design.md`

## Global Constraints

- **Backend venv is Python 3.11.** Always run tests as `cd backend && ./.venv/Scripts/python.exe -m pytest ...`.
- **No new OAuth scope.** `gmail.readonly` + `gmail.send` are already granted (`google_auth.SCOPES`). Do not touch `SCOPES` — changing it forces every account to re-consent.
- **`reply_email` exposes NO `to` parameter.** The recipient is derived from the thread's last message. This is a security invariant, not a convenience; a test asserts the JSON schema has no `to` property.
- **`list_waiting_replies` MUST be in `UNTRUSTED_TOOLS`.** Its result carries third-party subjects and snippets. Omitting it silently disables the prompt-injection fence.
- **Both new tools MUST be registered in `activity_log._MAP`.** `activity_log.record()` does `_MAP.get(tool)` and returns early on `None` — an unregistered tool sends mail that never appears in the Activity Log.
- **The candidate query must NOT contain `-from:me`.** `threads.list` matches a thread if ANY message matches, so that operator filters nothing while looking correct. The authoritative test is the last-message check in `_is_waiting`.
- **Best-effort:** one bad thread is skipped and logged, never fatal. No connected account → `NotConnected` (never a silent empty list).
- **Formatting:** no emojis in any tool output or UI copy (matches the ZENITH_PROMPT house style).
- **Triage is pull-only.** Do not add it to the proactivity `NudgeStack`.

---

### Task 1: `google_service` read helpers

**Files:**
- Modify: `backend/google_service.py` (append at end of file, after `account_label`)
- Test: `backend/test_triage.py` (create)

**Interfaces:**
- Consumes: existing `_gmail(email)`, `account_label(email)`, `NotConnected`.
- Produces:
  - `me_address(email: str | None = None) -> str | None` — lowercased connected address, `None` when unlinked.
  - `list_thread_ids(query: str, max_results: int = 25, email: str | None = None) -> list[str]`
  - `thread_summary(thread_id: str, email: str | None = None) -> dict` → `{thread_id, from, subject, date, message_id, references, snippet, message_count}` describing the thread's **last** message.

- [ ] **Step 1: Write the failing test**

```python
# backend/test_triage.py
"""M7 Part 3 — message triage. All Google seams mocked → offline, cross-platform, no network."""

import google_service


class _Exec:
    def __init__(self, data):
        self._d = data

    def execute(self):
        return self._d


class _Threads:
    """Stands in for svc.users().threads(). Records the kwargs it was called with."""

    def __init__(self, listing=None, thread=None):
        self.listing, self.thread, self.seen = listing or {}, thread or {}, {}

    def list(self, **kw):
        self.seen["list"] = kw
        return _Exec(self.listing)

    def get(self, **kw):
        self.seen["get"] = kw
        return _Exec(self.thread)


class _Users:
    def __init__(self, threads):
        self._t = threads

    def threads(self):
        return self._t


class _Svc:
    def __init__(self, threads):
        self._u = _Users(threads)

    def users(self):
        return self._u


def _hdrs(**kw):
    """Gmail returns headers as [{'name':..,'value':..}] with original casing."""
    return [{"name": k.replace("_", "-").title(), "value": v} for k, v in kw.items()]


def test_me_address_lowercases_and_handles_no_account(monkeypatch):
    monkeypatch.setattr(google_service, "account_label", lambda email=None: "Owner@Gmail.com")
    assert google_service.me_address() == "owner@gmail.com"
    monkeypatch.setattr(google_service, "account_label", lambda email=None: None)
    assert google_service.me_address() is None


def test_list_thread_ids_passes_query(monkeypatch):
    threads = _Threads(listing={"threads": [{"id": "t1"}, {"id": "t2"}]})
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _Svc(threads))
    assert google_service.list_thread_ids("in:inbox", max_results=25) == ["t1", "t2"]
    assert threads.seen["list"]["q"] == "in:inbox"
    assert threads.seen["list"]["maxResults"] == 25


def test_thread_summary_reads_the_LAST_message(monkeypatch):
    thread = {"messages": [
        {"snippet": "first", "payload": {"headers": _hdrs(From="a@x.com", Subject="Hi", Date="Mon, 6 Jul 2026 10:00:00 +0530", Message_ID="<m1>")}},
        {"snippet": "second", "payload": {"headers": _hdrs(From="b@y.com", Subject="Re: Hi", Date="Tue, 7 Jul 2026 10:00:00 +0530", Message_ID="<m2>", References="<m1>")}},
    ]}
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _Svc(_Threads(thread=thread)))
    s = google_service.thread_summary("t1")
    assert s["from"] == "b@y.com"          # the LAST message, not the first
    assert s["subject"] == "Re: Hi"
    assert s["message_id"] == "<m2>"
    assert s["references"] == "<m1>"
    assert s["snippet"] == "second"
    assert s["message_count"] == 2


def test_thread_summary_empty_thread_raises(monkeypatch):
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _Svc(_Threads(thread={"messages": []})))
    try:
        google_service.thread_summary("t1")
    except ValueError:
        return
    raise AssertionError("expected ValueError on a thread with no messages")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: FAIL — `AttributeError: module 'google_service' has no attribute 'me_address'`.

- [ ] **Step 3: Write minimal implementation**

Append to the end of `backend/google_service.py`:

```python
# ---------- triage helpers (M7 Part 3) ----------
# Metadata headers needed to (a) decide whether a thread awaits a reply and (b) build a threaded
# reply envelope. `format="metadata"` keeps the payload small — bodies are never fetched here.
_THREAD_HEADERS = ["From", "Subject", "Date", "Message-ID", "References"]


def me_address(email: str | None = None) -> str | None:
    """The connected address, lowercased — used to test 'did I send the last message?'.
    None when no account is linked; callers raise NotConnected rather than compare against None."""
    addr = account_label(email)
    return addr.lower() if addr else None


def list_thread_ids(query: str, max_results: int = 25, email: str | None = None) -> list[str]:
    svc = _gmail(email)
    resp = svc.users().threads().list(userId="me", q=query, maxResults=max_results).execute()
    return [t["id"] for t in resp.get("threads", [])]


def thread_summary(thread_id: str, email: str | None = None) -> dict:
    """Describe a thread by its LAST message — the one a reply would answer."""
    svc = _gmail(email)
    th = (
        svc.users()
        .threads()
        .get(userId="me", id=thread_id, format="metadata", metadataHeaders=_THREAD_HEADERS)
        .execute()
    )
    msgs = th.get("messages", [])
    if not msgs:
        raise ValueError(f"thread {thread_id} has no messages")
    last = msgs[-1]
    h = {x["name"].lower(): x["value"] for x in last.get("payload", {}).get("headers", [])}
    return {
        "thread_id": thread_id,
        "from": h.get("from", ""),
        "subject": h.get("subject", "(no subject)"),
        "date": h.get("date", ""),
        "message_id": h.get("message-id", ""),
        "references": h.get("references", ""),
        "snippet": last.get("snippet", ""),
        "message_count": len(msgs),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/google_service.py backend/test_triage.py
git commit -m "feat(triage): gmail thread read helpers (me_address, list_thread_ids, thread_summary)"
```

---

### Task 2: `google_service` threaded reply

**Files:**
- Modify: `backend/google_service.py` (append after `thread_summary`)
- Test: `backend/test_triage.py`

**Interfaces:**
- Consumes: `thread_summary` (Task 1), existing `_gmail`, `MIMEText`, `base64`.
- Produces:
  - `_reply_headers(last: dict) -> dict` → `{to, subject, in_reply_to, references}` (pure).
  - `reply_to_thread(thread_id: str, body: str, email: str | None = None) -> dict` → `{id, to, subject, thread_id}`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_triage.py
import base64


class _Messages:
    def __init__(self):
        self.sent = None

    def send(self, **kw):
        self.sent = kw
        return _Exec({"id": "sent1"})


class _UsersWithMessages:
    def __init__(self, threads, messages):
        self._t, self._m = threads, messages

    def threads(self):
        return self._t

    def messages(self):
        return self._m


class _SvcFull:
    def __init__(self, threads, messages):
        self._u = _UsersWithMessages(threads, messages)

    def users(self):
        return self._u


def test_reply_headers_derive_envelope_from_last_message():
    h = google_service._reply_headers(
        {"from": "Rahul <rahul@acme.com>", "subject": "Proposal", "message_id": "<m2>", "references": "<m1>"}
    )
    assert h["to"] == "Rahul <rahul@acme.com>"     # recipient is DERIVED, never model-supplied
    assert h["subject"] == "Re: Proposal"
    assert h["in_reply_to"] == "<m2>"
    assert h["references"] == "<m1> <m2>"           # prior refs + this message id


def test_reply_headers_do_not_double_the_re_prefix():
    h = google_service._reply_headers({"from": "a@x.com", "subject": "RE: Proposal", "message_id": "<m>", "references": ""})
    assert h["subject"] == "RE: Proposal"           # already a reply — left alone
    assert h["references"] == "<m>"


def test_reply_to_thread_sends_in_thread(monkeypatch):
    messages = _Messages()
    thread = {"messages": [{"snippet": "s", "payload": {"headers": _hdrs(
        From="rahul@acme.com", Subject="Proposal", Date="Tue, 7 Jul 2026 10:00:00 +0530", Message_ID="<m2>")}}]}
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _SvcFull(_Threads(thread=thread), messages))

    out = google_service.reply_to_thread("t9", "Sending it today.")

    assert out == {"id": "sent1", "to": "rahul@acme.com", "subject": "Re: Proposal", "thread_id": "t9"}
    assert messages.sent["body"]["threadId"] == "t9"          # Gmail files it in-thread
    raw = base64.urlsafe_b64decode(messages.sent["body"]["raw"]).decode("utf-8")
    assert "To: rahul@acme.com" in raw
    assert "Subject: Re: Proposal" in raw
    assert "In-Reply-To: <m2>" in raw
    assert "Sending it today." in raw
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -k reply -q`
Expected: FAIL — `AttributeError: module 'google_service' has no attribute '_reply_headers'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/google_service.py`:

```python
def _reply_headers(last: dict) -> dict:
    """Derive the reply envelope from a thread's last message.

    SECURITY: the model supplies only the body. `To` comes from the message being answered, so a
    prompt-injected email can never redirect a reply to an attacker-chosen address."""
    subject = (last.get("subject") or "").strip()
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}" if subject else "Re:"
    prior = (last.get("references") or "").strip()
    mid = (last.get("message_id") or "").strip()
    return {
        "to": last.get("from", ""),
        "subject": subject,
        "in_reply_to": mid,
        "references": " ".join(x for x in (prior, mid) if x),
    }


def reply_to_thread(thread_id: str, body: str, email: str | None = None) -> dict:
    """Send `body` as an in-thread reply to `thread_id`. Envelope is derived, never passed in."""
    svc = _gmail(email)
    hdr = _reply_headers(thread_summary(thread_id, email=email))
    mime = MIMEText(body)
    mime["To"] = hdr["to"]
    mime["Subject"] = hdr["subject"]
    if hdr["in_reply_to"]:
        mime["In-Reply-To"] = hdr["in_reply_to"]
    if hdr["references"]:
        mime["References"] = hdr["references"]
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("utf-8")
    sent = svc.users().messages().send(userId="me", body={"raw": raw, "threadId": thread_id}).execute()
    return {"id": sent.get("id"), "to": hdr["to"], "subject": hdr["subject"], "thread_id": thread_id}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/google_service.py backend/test_triage.py
git commit -m "feat(triage): threaded reply_to_thread with derived envelope"
```

---

### Task 3: `triage_service` — deterministic detection

**Files:**
- Create: `backend/triage_service.py`
- Test: `backend/test_triage.py`

**Interfaces:**
- Consumes: `google_service.me_address`, `list_thread_ids`, `thread_summary`, `NotConnected` (Task 1).
- Produces:
  - `CANDIDATE_QUERY: str`
  - `_is_waiting(summary: dict, me: str, now: datetime, min_age_hours: float) -> bool` (pure)
  - `waiting_threads(now: datetime | None = None, max_results: int | None = None) -> list[dict]` → rows `{thread_id, from_name, from_email, subject, snippet, last_at, age_hours, source}`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_triage.py
import datetime as dt

import pytest

import triage_service as ts

NOW = dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc)


def _summary(tid, frm, hours_ago, subject="Question", snippet="hi"):
    sent = NOW - dt.timedelta(hours=hours_ago)
    return {"thread_id": tid, "from": frm, "subject": subject,
            "date": sent.strftime("%a, %d %b %Y %H:%M:%S +0000"),
            "message_id": f"<{tid}>", "references": "", "snippet": snippet, "message_count": 2}


@pytest.fixture
def gmail(monkeypatch):
    """Wire google_service so triage sees exactly the summaries a test declares."""
    state = {"summaries": {}}

    def setup(summaries):
        state["summaries"] = {s["thread_id"]: s for s in summaries}
        monkeypatch.setattr(ts.google_service, "me_address", lambda: "owner@gmail.com")
        monkeypatch.setattr(ts.google_service, "list_thread_ids", lambda q, n: list(state["summaries"]))
        monkeypatch.setattr(ts.google_service, "thread_summary", lambda tid: state["summaries"][tid])

    return setup


def test_candidate_query_has_no_from_me_operator():
    # threads.list matches a thread if ANY message matches, so "-from:me" would filter nothing.
    assert "-from:me" not in ts.CANDIDATE_QUERY
    assert "category:primary" in ts.CANDIDATE_QUERY


def test_thread_i_answered_last_is_not_waiting():
    s = _summary("t1", "Owner <OWNER@gmail.com>", hours_ago=30)
    assert ts._is_waiting(s, "owner@gmail.com", NOW, 4.0) is False


def test_inbound_and_old_enough_is_waiting():
    s = _summary("t2", "Rahul <rahul@acme.com>", hours_ago=6)
    assert ts._is_waiting(s, "owner@gmail.com", NOW, 4.0) is True


def test_too_fresh_is_not_waiting():
    s = _summary("t3", "Rahul <rahul@acme.com>", hours_ago=1)
    assert ts._is_waiting(s, "owner@gmail.com", NOW, 4.0) is False


def test_noreply_sender_is_not_waiting():
    for addr in ("no-reply@stripe.com", "noreply@x.com", "mailer-daemon@y.com", "DoNotReply@z.com"):
        s = _summary("t4", addr, hours_ago=30)
        assert ts._is_waiting(s, "owner@gmail.com", NOW, 4.0) is False, addr


def test_waiting_threads_ranks_oldest_first_and_caps(gmail):
    gmail([_summary(f"t{i}", "a@x.com", hours_ago=5 + i) for i in range(5)])
    rows = ts.waiting_threads(now=NOW, max_results=3)
    assert len(rows) == 3
    assert [r["age_hours"] for r in rows] == [9, 8, 7]      # oldest waiting first


def test_waiting_threads_row_shape(gmail):
    gmail([_summary("t1", "Rahul Sharma <rahul@acme.com>", hours_ago=51, subject="Proposal", snippet="any update?")])
    (row,) = ts.waiting_threads(now=NOW)
    assert row["thread_id"] == "t1"
    assert row["from_name"] == "Rahul Sharma"
    assert row["from_email"] == "rahul@acme.com"
    assert row["subject"] == "Proposal"
    assert row["snippet"] == "any update?"
    assert row["age_hours"] == 51
    assert row["source"] == "gmail"


def test_one_bad_thread_is_skipped_not_fatal(monkeypatch):
    good = _summary("ok", "a@x.com", hours_ago=9)
    monkeypatch.setattr(ts.google_service, "me_address", lambda: "owner@gmail.com")
    monkeypatch.setattr(ts.google_service, "list_thread_ids", lambda q, n: ["bad", "ok"])

    def summary(tid):
        if tid == "bad":
            raise RuntimeError("gmail hiccup")
        return good

    monkeypatch.setattr(ts.google_service, "thread_summary", summary)
    rows = ts.waiting_threads(now=NOW)
    assert [r["thread_id"] for r in rows] == ["ok"]


def test_no_connected_account_raises_not_connected(monkeypatch):
    # An empty list would be indistinguishable from "nothing waiting" — the HUD must show
    # "Connect Google", so this raises instead.
    monkeypatch.setattr(ts.google_service, "me_address", lambda: None)
    with pytest.raises(ts.google_service.NotConnected):
        ts.waiting_threads(now=NOW)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'triage_service'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/triage_service.py
"""Zenith — message triage (M7 Part 3). Answers "who is waiting on a reply from me?" over Gmail.

Detection is DETERMINISTIC and costs zero Claude tokens: a thread is waiting iff its LAST message is
not from the owner, is not machine mail, and is older than a freshness threshold. Claude is involved
only when the owner asks for a draft — and the send (`reply_email`) is confirm-gated with a recipient
derived from the thread, never from the model. This is the first Zenith feature whose input is fully
attacker-controlled, so `list_waiting_replies` is fenced as untrusted in `tools.py`.
"""

from __future__ import annotations

import datetime as dt
import os
import re
from email.utils import parseaddr, parsedate_to_datetime

import google_service

# `category:primary` is the highest-value noise filter (promotions/newsletters/bulk).
# DELIBERATELY no "-from:me": threads.list matches a thread if ANY message matches it, so that
# operator would match nearly every thread containing inbound mail and filter nothing. The
# authoritative "did I already reply?" test is the last-message check in _is_waiting.
CANDIDATE_QUERY = "in:inbox category:primary newer_than:14d"

_CANDIDATE_LIMIT = 25          # bounds Gmail API calls: 1 threads.list + <=25 threads.get
_NOREPLY = re.compile(r"no[-_.]?reply|donotreply|mailer-daemon", re.IGNORECASE)


def _min_age_hours() -> float:
    """A reply younger than this is too fresh to nag about."""
    try:
        return float(os.getenv("ZENITH_TRIAGE_MIN_AGE_HOURS", "4"))
    except ValueError:
        return 4.0


def _max_threads() -> int:
    try:
        return int(os.getenv("ZENITH_TRIAGE_MAX", "10"))
    except ValueError:
        return 10


def _parse_date(raw: str) -> dt.datetime | None:
    """RFC-2822 header date → aware datetime. A header without an offset is treated as UTC."""
    try:
        d = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def _is_waiting(summary: dict, me: str, now: dt.datetime, min_age_hours: float) -> bool:
    frm = summary.get("from", "")
    _name, addr = parseaddr(frm)
    if addr.lower() == me:
        return False                       # I sent the last message — the ball is in their court
    if _NOREPLY.search(frm):
        return False                       # machine mail never awaits a reply
    sent = _parse_date(summary.get("date", ""))
    if sent is None:
        return False                       # undatable → cannot age it, so don't surface it
    return (now - sent).total_seconds() / 3600 >= min_age_hours


def _to_row(summary: dict, now: dt.datetime) -> dict:
    name, addr = parseaddr(summary.get("from", ""))
    sent = _parse_date(summary["date"])
    return {
        "thread_id": summary["thread_id"],
        "from_name": name or addr,
        "from_email": addr,
        "subject": summary.get("subject") or "(no subject)",
        "snippet": (summary.get("snippet") or "").strip(),
        "last_at": sent.isoformat(),
        "age_hours": int((now - sent).total_seconds() / 3600),
        "source": "gmail",
    }


def waiting_threads(now: dt.datetime | None = None, max_results: int | None = None) -> list[dict]:
    """Threads awaiting the owner's reply, oldest first. Raises NotConnected when Google is unlinked
    (an empty list would be indistinguishable from 'nothing waiting')."""
    now = now or dt.datetime.now(dt.timezone.utc)
    me = google_service.me_address()
    if not me:
        raise google_service.NotConnected(
            "Not connected to Google. Connect it in the Connections panel."
        )
    min_age = _min_age_hours()
    rows: list[dict] = []
    for tid in google_service.list_thread_ids(CANDIDATE_QUERY, _CANDIDATE_LIMIT):
        try:
            summary = google_service.thread_summary(tid)
        except Exception as exc:  # noqa: BLE001 — one bad thread never sinks the list
            print(f"[triage] skipped thread {tid}: {exc}", flush=True)
            continue
        if _is_waiting(summary, me, now, min_age):
            rows.append(_to_row(summary, now))
    rows.sort(key=lambda r: r["age_hours"], reverse=True)
    return rows[: (max_results or _max_threads())]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: PASS (16 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/triage_service.py backend/test_triage.py
git commit -m "feat(triage): deterministic waiting-thread detection"
```

---

### Task 4: Tools — `list_waiting_replies` + `reply_email`

**Files:**
- Modify: `backend/tools.py` (2 schemas into `TOOLS`, 2 executors, `_EXECUTORS`, `ACTION_TOOLS`, `UNTRUSTED_TOOLS`)
- Modify: `backend/activity_log.py` (2 `_MAP` entries)
- Test: `backend/test_triage.py`

**Interfaces:**
- Consumes: `triage_service.waiting_threads` (Task 3), `google_service.reply_to_thread` (Task 2).
- Produces: tools `list_waiting_replies(max?)` and `reply_email(thread_id, body)`; executors `_list_waiting_replies`, `_reply_email`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_triage.py
import activity_log
import tools


def _schema(name):
    return next(t for t in tools.TOOLS if t["name"] == name)


def test_reply_email_schema_exposes_no_recipient():
    # SECURITY: the model must never choose who a reply goes to.
    props = _schema("reply_email")["input_schema"]["properties"]
    assert set(props) == {"thread_id", "body"}
    assert "to" not in props


def test_gate_memberships():
    assert "reply_email" in tools.ACTION_TOOLS              # always confirm-gated
    assert "list_waiting_replies" in tools.UNTRUSTED_TOOLS  # third-party subjects/snippets → fenced
    assert "reply_email" not in tools.UNTRUSTED_TOOLS


def test_both_tools_are_logged():
    # activity_log.record() silently no-ops for tools missing from _MAP.
    assert "reply_email" in activity_log._MAP
    assert "list_waiting_replies" in activity_log._MAP


def test_list_waiting_replies_executor_formats_rows(monkeypatch):
    monkeypatch.setattr(tools.triage_service, "waiting_threads", lambda max_results: [
        {"thread_id": "t1", "from_name": "Rahul", "from_email": "rahul@acme.com", "subject": "Proposal",
         "snippet": "any update?", "last_at": "2026-07-08T11:04:00+00:00", "age_hours": 51, "source": "gmail"},
    ])
    out = tools.run_tool("list_waiting_replies", {})
    assert "Rahul" in out and "Proposal" in out and "thread:t1" in out
    assert "<external-content" in out          # fenced: it carries third-party text


def test_list_waiting_replies_empty(monkeypatch):
    monkeypatch.setattr(tools.triage_service, "waiting_threads", lambda max_results: [])
    assert "Nobody is waiting" in tools.run_tool("list_waiting_replies", {})


def test_reply_email_executor_passes_only_thread_and_body(monkeypatch):
    seen = {}
    monkeypatch.setattr(tools.google_service, "reply_to_thread",
                        lambda **kw: seen.update(kw) or {"id": "s1", "to": "rahul@acme.com",
                                                         "subject": "Re: Proposal", "thread_id": "t1"})
    out = tools.run_tool("reply_email", {"thread_id": "t1", "body": "On it."})
    assert seen == {"thread_id": "t1", "body": "On it."}
    assert "Reply sent to rahul@acme.com" in out


def test_reply_email_validates_input():
    assert tools.run_tool("reply_email", {"thread_id": "t1"}) == "reply_email needs 'thread_id' and 'body'."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -k "schema or gate or logged or executor or validates or empty" -q`
Expected: FAIL — `StopIteration` from `_schema("reply_email")` (the tool is not in `TOOLS`).

- [ ] **Step 3: Write minimal implementation**

**3a.** Add `import triage_service` to the import block at the top of `backend/tools.py` (alongside `import google_service`).

**3b.** Add both schemas to the `TOOLS` list, immediately after the `send_email` entry (which ends `"required": ["to", "subject", "body"]},\n    },`):

```python
    {
        "name": "list_waiting_replies",
        "description": (
            "List Gmail threads waiting on a reply from the user — threads whose last message is "
            "not from them, older than a few hours. Read-only. Use before drafting a reply."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"max": {"type": "integer", "description": "Max threads to return (default 10)"}},
            "required": [],
        },
    },
    {
        "name": "reply_email",
        "description": (
            "Reply in-thread to a Gmail conversation. Provide ONLY the reply body — the recipient "
            "and subject are taken from the thread being answered. The user confirms before it sends."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "thread_id": {"type": "string", "description": "Gmail thread id, from list_waiting_replies"},
                "body": {"type": "string", "description": "The reply body text"},
            },
            "required": ["thread_id", "body"],
        },
    },
```

**3c.** Add the executors immediately after `_send_email` (before the `# ---------- weather + briefing ----------` comment):

```python
def _waiting_line(r: dict) -> str:
    hours = r["age_hours"]
    age = f"{hours}h" if hours < 48 else f"{hours // 24}d"
    snippet = (r.get("snippet") or "")[:90]
    return (f"{r['from_name']} <{r['from_email']}> — {r['subject']} :: {snippet} "
            f"(waiting {age}) [thread:{r['thread_id']}]")


def _list_waiting_replies(i: dict) -> str:
    rows = triage_service.waiting_threads(max_results=int(i.get("max", 10)))
    if not rows:
        return "Nobody is waiting on a reply."
    return "Waiting on your reply:\n" + "\n".join(_waiting_line(r) for r in rows)


def _reply_email(i: dict) -> str:
    if not i.get("thread_id") or not i.get("body"):
        return "reply_email needs 'thread_id' and 'body'."
    s = google_service.reply_to_thread(thread_id=i["thread_id"], body=i["body"])
    return f"Reply sent to {s['to']} (subject: {s['subject']})."
```

**3d.** Register both in `_EXECUTORS`, right after `"send_email": _send_email,`:

```python
    "list_waiting_replies": _list_waiting_replies,
    "reply_email": _reply_email,
```

**3e.** Add `reply_email` to `ACTION_TOOLS` — change the first line of the set literal from:

```python
ACTION_TOOLS = {"send_message", "create_event", "update_event", "delete_event", "send_email",
```

to:

```python
ACTION_TOOLS = {"send_message", "create_event", "update_event", "delete_event", "send_email",
                "reply_email",
```

**3f.** Add `list_waiting_replies` to `UNTRUSTED_TOOLS` — change:

```python
    "get_emails", "read_email", "search_emails",
```

to:

```python
    "get_emails", "read_email", "search_emails", "list_waiting_replies",
```

**3g.** In `backend/activity_log.py`, add two entries to `_MAP` directly after the `"send_email"` line:

```python
    "list_waiting_replies": ("email", "info", "checked who's waiting"),
    "reply_email": ("email", "ok", "reply sent"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: PASS (23 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/tools.py backend/activity_log.py backend/test_triage.py
git commit -m "feat(triage): list_waiting_replies (fenced) + gated reply_email tools"
```

---

### Task 5: `GET /triage` route

**Files:**
- Modify: `backend/main.py`
- Test: `backend/test_triage.py`

**Interfaces:**
- Consumes: `triage_service.waiting_threads` (Task 3), `google_service.NotConnected`.
- Produces: `GET /triage` → `{"connected": bool, "threads": [...]}`.

- [ ] **Step 1: Write the failing test**

```python
# add to backend/test_triage.py
from fastapi.testclient import TestClient

# Imported at module scope, NOT inside a fixture: `auth` calls load_dotenv() at import, which would
# re-set the real ZENITH_API_TOKEN *after* conftest's autouse delenv and 401 the first route test.
import main


@pytest.fixture
def client():
    return TestClient(main.app)


def test_get_triage_returns_threads(client, monkeypatch):
    monkeypatch.setattr(main.triage_service, "waiting_threads",
                        lambda: [{"thread_id": "t1", "from_name": "Rahul", "from_email": "r@a.com",
                                  "subject": "Proposal", "snippet": "?", "last_at": "2026-07-08T11:04:00+00:00",
                                  "age_hours": 51, "source": "gmail"}])
    r = client.get("/triage")
    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is True
    assert body["threads"][0]["thread_id"] == "t1"


def test_get_triage_reports_disconnected_not_500(client, monkeypatch):
    def boom():
        raise main.google_service.NotConnected("Not connected to Google.")
    monkeypatch.setattr(main.triage_service, "waiting_threads", boom)
    r = client.get("/triage")
    assert r.status_code == 200
    assert r.json() == {"connected": False, "threads": []}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -k triage_ -q`
Expected: FAIL — `AttributeError: module 'main' has no attribute 'triage_service'`.

- [ ] **Step 3: Write minimal implementation**

Add `import triage_service` to the top imports of `backend/main.py` (after `import telegram_service`, keeping alphabetical order relative to `todo_service`).

Then add the route immediately after the `calendar_events` route (which ends with `return {"connected": False, "events": []}`):

```python
@app.get("/triage")
def triage() -> dict:
    """Gmail threads waiting on the owner's reply (same service the list_waiting_replies tool uses).
    Returns connected:false instead of erroring when Google isn't linked, so the view can offer
    'Connect Google' rather than a misleading 'Nothing waiting'."""
    try:
        return {"connected": True, "threads": triage_service.waiting_threads()}
    except google_service.NotConnected:
        return {"connected": False, "threads": []}
```

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest test_triage.py -q`
Expected: PASS (25 passed).

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: PASS (~246 passed — 221 existing + 25 new; the count shifts only if other suites changed).

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_triage.py
git commit -m "feat(triage): GET /triage route"
```

---

### Task 6: `getTriage` client + `TriageView` component

**Files:**
- Modify: `frontend/lib/api.ts` (append)
- Create: `frontend/components/TriageView.tsx`

**Interfaces:**
- Consumes: `apiFetch` (existing), `GET /triage` (Task 5).
- Produces: `type WaitingThread`; `getTriage(): Promise<{connected: boolean; threads: WaitingThread[]} | null>`; `TriageView({ onDraft }: { onDraft: (t: WaitingThread) => void })`.

- [ ] **Step 1: Add the typed client**

Append to `frontend/lib/api.ts`:

```ts
export type WaitingThread = {
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  last_at: string;
  age_hours: number;
  source: string;
};

/** Threads waiting on a reply. null = backend unreachable (distinct from connected:false). */
export async function getTriage(): Promise<{ connected: boolean; threads: WaitingThread[] } | null> {
  try {
    const res = await apiFetch("/triage");
    if (!res.ok) return null;
    const d = (await res.json()) as { connected?: boolean; threads?: WaitingThread[] };
    return { connected: d.connected ?? false, threads: d.threads ?? [] };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create the view**

```tsx
// frontend/components/TriageView.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { getTriage, type WaitingThread } from "../lib/api";

function ageLabel(hours: number): string {
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** Who's waiting on a reply (Gmail). Pull-only: this list is never rendered unprompted, because its
 *  text comes from third parties. "Draft reply" prefills the Command Center — an inert string that
 *  never runs a tool; the send still rides the confirm gate. */
export function TriageView({ onDraft }: { onDraft: (t: WaitingThread) => void }) {
  const [threads, setThreads] = useState<WaitingThread[]>([]);
  const [connected, setConnected] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const d = await getTriage();
    if (d === null) setError(true);
    else {
      setThreads(d.threads);
      setConnected(d.connected);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  return (
    <div className="hud-scroll flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-zenith-cyan">
          Waiting on your reply
        </h2>
        {loaded && !error && connected && (
          <span className="font-mono text-[10px] text-zenith-lo">{threads.length}</span>
        )}
      </div>

      {!loaded && <p className="font-mono text-[11px] text-zenith-lo">Loading…</p>}

      {loaded && error && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-zenith-lo">Can’t reach Zenith’s backend.</p>
          <button
            onClick={() => void load()}
            className="press rounded-md border border-zenith-line2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo transition hover:text-zenith-mid"
          >
            Retry
          </button>
        </div>
      )}

      {loaded && !error && !connected && (
        <p className="text-sm text-zenith-lo">Google isn’t connected. Link it in the Connections panel.</p>
      )}

      {loaded && !error && connected && threads.length === 0 && (
        <p className="text-sm text-zenith-lo">Nothing waiting.</p>
      )}

      {loaded && !error && connected && threads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {threads.map((t) => (
            <li key={t.thread_id} className="status-surface border border-zenith-line2 px-4 py-3">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold text-zenith-mid">{t.from_name}</span>
                <span className="flex-none font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo">
                  {ageLabel(t.age_hours)} · {t.source}
                </span>
              </div>
              <div className="truncate text-sm text-zenith-mid">{t.subject}</div>
              <div className="mt-0.5 truncate text-[12px] text-zenith-lo">{t.snippet}</div>
              <div className="mt-3">
                <button
                  onClick={() => onDraft(t)}
                  className="press rounded-md bg-zenith-cyan px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zenith-bg transition hover:opacity-90"
                >
                  Draft reply
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (`TriageView` is unused until Task 7 — that is fine, `tsc` does not error on unused exports.)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/api.ts frontend/components/TriageView.tsx
git commit -m "feat(triage): getTriage client + TriageView component"
```

---

### Task 7: Wire Triage into the HUD nav

**Files:**
- Modify: `frontend/lib/nav.ts`
- Modify: `frontend/components/IconNav.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `TriageView`, `WaitingThread` (Task 6); existing `prefillInput` (page.tsx ~line 286) and `setView` (page.tsx line 68).
- Produces: a `"triage"` `View`. `NAV_ITEMS` feeds both `IconNav` and `CommandPalette`, so ⌘K picks it up automatically — no palette change needed.

- [ ] **Step 1: Add the view id**

In `frontend/lib/nav.ts`, change the type and the items list:

```ts
export type View = "chat" | "triage" | "memory" | "clients" | "notes" | "settings";

export const NAV_ITEMS: { id: View; label: string }[] = [
  { id: "chat", label: "CHAT" },
  { id: "triage", label: "TRIAGE" },
  { id: "memory", label: "MEMORY" },
  { id: "clients", label: "CLIENTS" },
  { id: "notes", label: "NOTES" },
  { id: "settings", label: "SETTINGS" },
];
```

- [ ] **Step 2: Add the icon**

In `frontend/components/IconNav.tsx`, add a `triage` entry to `ICONS` between `chat` and `memory` (an inbox glyph, matching the existing lucide-style stroke set):

```tsx
  triage: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
```

`ICONS` is typed `Record<View, ReactNode>`, so omitting this entry is a compile error — which is the point.

- [ ] **Step 3: Render the view and handle Draft reply**

In `frontend/app/page.tsx`:

**3a.** Add imports beside the other component imports:

```tsx
import { TriageView } from "../components/TriageView";
import type { WaitingThread } from "../lib/api";
```

**3b.** Add the handler immediately after `prefillInput` (which ends `inputRef.current?.focus();\n  }`):

```tsx
  function onTriageDraft(t: WaitingThread) {
    // An inert prefill — same law as the nudge cards. It never runs a tool; the reply itself is
    // drafted by the normal loop and sent only through the confirm gate. The thread_id rides along
    // so Claude can call reply_email without a lookup round-trip.
    prefillInput(`draft a reply to ${t.from_name} on the thread "${t.subject}" (thread_id: ${t.thread_id})`);
    setView("chat");
  }
```

**3c.** Add the render branch. Find the router chain and change:

```tsx
          ) : view === "memory" ? (
            <MemoryView />
```

to:

```tsx
          ) : view === "triage" ? (
            <TriageView onDraft={onTriageDraft} />
          ) : view === "memory" ? (
            <MemoryView />
```

- [ ] **Step 4: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/nav.ts frontend/components/IconNav.tsx frontend/app/page.tsx
git commit -m "feat(triage): TRIAGE view in IconNav + draft-reply prefill"
```

---

### Task 8: Live verification

**Files:** none (verification + evidence)

- [ ] **Step 1: Confirm the full backend suite is green**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest . -q --ignore=test_stt.py`
Expected: ~246 passed.

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Add the two env vars to the example file**

Append to `backend/.env.example`:

```
# -- Message triage --------------------------------------------------------------
# A thread younger than this many hours is too fresh to nag about (default 4).
ZENITH_TRIAGE_MIN_AGE_HOURS=
# Max threads shown in the Triage view / returned by list_waiting_replies (default 10).
ZENITH_TRIAGE_MAX=
```

- [ ] **Step 3: Start both servers**

```bash
cd backend && ./.venv/Scripts/python.exe -m uvicorn main:app --port 8000   # background
cd frontend && npm run dev                                                 # background
```

Wait for `GET /health` to answer before driving the UI (boot runs the STT/TTS warmups, ~30–45s).

- [ ] **Step 4: Verify the view end to end**

Open http://localhost:3000, click **TRIAGE** in the icon strip. Verify against the real inbox:
- rows show sender / age / subject / snippet, oldest first;
- a thread you have already answered does **not** appear;
- a newsletter or `no-reply@` sender does **not** appear;
- ⌘K → "TRIAGE" navigates to the view (it rides `NAV_ITEMS` for free).

Screenshot on all three skins (Arc / Ghost / Amethyst — switch via Settings).

- [ ] **Step 5: Verify the draft → confirm → cancel path**

Click **Draft reply** on a row. Confirm: the Command Center is prefilled with `draft a reply to … (thread_id: …)`, the view switches to chat, and **nothing is sent**. Press Enter; when Claude calls `reply_email`, the confirm card must show the ⚠ untrusted warning, the derived `To`, the `Re:` subject, and the **full body**. Press **Cancel**. Verify the Activity Log records `reply_email cancelled by user` and that no mail left the account.

> Do **not** live-test an actual send against a real contact. If you want to prove the send path, reply to a thread from an address you control.

- [ ] **Step 6: Verify the disconnected state**

Disconnect Google in the Connections panel, reload, open TRIAGE. Expected: "Google isn't connected. Link it in the Connections panel." — **not** "Nothing waiting." Reconnect afterwards.

- [ ] **Step 7: Report**

Report results (pass/fail per skin + per interaction). Docs (`CLAUDE.md` build order + Key Decisions, `JARVIS_PRD.md`) are updated at branch-finish, per project convention.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- §3 architecture → Tasks 3–7. §4 detection rules + `newer_than:14d` + no-`-from:me` → Task 3 (asserted by `test_candidate_query_has_no_from_me_operator`). §5 four `google_service` helpers → Tasks 1–2. §6 `reply_email` envelope + `_MAP` entries → Tasks 2, 4. §7 injection safety (fencing, no `to` param, gated send, pull-only) → Task 4 tests + Task 8 Step 5; token budget → no Claude call in Tasks 1–5; error handling → Task 3 (`test_one_bad_thread_is_skipped_not_fatal`) + Task 5 (`connected:false`). §8 HUD placement/states/prefill → Tasks 6–7. §9 tests → each task's tests + Task 8 live QA. §10 out-of-scope honored (no Discord, no ledger, no nudge integration, single account). §11 files → exactly the files touched here, plus `backend/.env.example` (Task 8 Step 2).
- **Deferred correctly:** Discord, WhatsApp, multi-account, Claude classification, snooze ledger.

**Placeholder scan** — none. Every code step is complete and runnable. Anchors verified against the live tree: `prefillInput` (`page.tsx:286`), `setView` (`page.tsx:68`), `ICONS: Record<View, ReactNode>` (`IconNav.tsx:9`), `_MAP` (`activity_log.py:18`), `_EXECUTORS` (`tools.py:953`), `ACTION_TOOLS` (`tools.py:922`), `UNTRUSTED_TOOLS` (`tools.py:935`), `send_email` schema (`tools.py:578`), `calendar_events` route (`main.py:237`). `run_tool` (`tools.py:1098-1101`) records to the Activity Log and applies `_wrap_untrusted` only when `not failed`, which is what Task 4's fencing assertion relies on.

**Type consistency** — the row shape `{thread_id, from_name, from_email, subject, snippet, last_at, age_hours, source}` is identical in `triage_service._to_row` (Task 3), the `_waiting_line` formatter (Task 4), the `/triage` payload (Task 5), and the TS `WaitingThread` (Task 6). `waiting_threads(now=None, max_results=None)` is called as `waiting_threads(max_results=...)` in Task 4 and bare in Task 5 — both valid. `reply_to_thread(thread_id, body, email=None)` (Task 2) is called with exactly `thread_id=`/`body=` in Task 4, which `test_reply_email_executor_passes_only_thread_and_body` asserts. `getTriage()` returns `{connected, threads}` matching the route; `onDraft: (t: WaitingThread) => void` matches `onTriageDraft` (Task 7).

**One deliberate test-file note:** `import main` sits at module scope in `test_triage.py` (Task 5). `auth.py` calls `load_dotenv()` at import, which re-sets the real `ZENITH_API_TOKEN` *after* `conftest`'s autouse `delenv` if the import happens inside a fixture — 401ing the first route test. This bit the proactivity build; the comment in the test preserves the reason.
