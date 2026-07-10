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
