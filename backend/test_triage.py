"""M7 Part 3 — message triage. All Google seams mocked -> offline, cross-platform, no network."""

import base64

import pytest

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
    threads = _Threads(thread=thread)
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _Svc(threads))
    s = google_service.thread_summary("t1")
    assert s["from"] == "b@y.com"          # the LAST message, not the first
    assert s["subject"] == "Re: Hi"
    assert s["message_id"] == "<m2>"
    assert s["references"] == "<m1>"
    assert s["snippet"] == "second"
    assert s["message_count"] == 2
    assert threads.seen["get"]["format"] == "metadata"
    assert threads.seen["get"]["metadataHeaders"] == google_service._THREAD_HEADERS


def test_thread_summary_empty_thread_raises(monkeypatch):
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _Svc(_Threads(thread={"messages": []})))
    with pytest.raises(ValueError):
        google_service.thread_summary("t1")


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


def test_reply_headers_empty_subject_becomes_re():
    h = google_service._reply_headers(
        {"from": "a@x.com", "subject": "", "message_id": "<m>", "references": ""}
    )
    assert h["subject"] == "Re:"


def test_reply_headers_without_message_id():
    h = google_service._reply_headers(
        {"from": "a@x.com", "subject": "Hi", "message_id": "", "references": ""}
    )
    assert h["in_reply_to"] == ""
    assert h["references"] == ""


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
    assert "References: <m2>" in raw
    assert "Sending it today." in raw


def test_reply_to_thread_omits_in_reply_to_when_no_message_id(monkeypatch):
    messages = _Messages()
    thread = {"messages": [{"snippet": "s", "payload": {"headers": _hdrs(
        From="rahul@acme.com", Subject="Proposal", Date="Tue, 7 Jul 2026 10:00:00 +0530")}}]}
    monkeypatch.setattr(google_service, "_gmail", lambda email=None: _SvcFull(_Threads(thread=thread), messages))

    out = google_service.reply_to_thread("t9", "Sending it today.")

    assert out == {"id": "sent1", "to": "rahul@acme.com", "subject": "Re: Proposal", "thread_id": "t9"}
    raw = base64.urlsafe_b64decode(messages.sent["body"]["raw"]).decode("utf-8")
    assert "In-Reply-To:" not in raw


# Task 3: triage_service tests

import datetime as dt

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
