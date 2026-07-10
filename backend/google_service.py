"""Zenith — Google Calendar + Gmail service layer (Milestone 3).

Thin wrappers over the API clients built by `google_auth`. These return plain Python
structures: the tool executors (`tools.py`) format them into short strings for Claude, and the
REST endpoints (`main.py`) serialize them for the HUD panels — one source of truth for both.

Raises `NotConnected` when no usable Google account is linked; callers turn that into a friendly
"connect Google" message instead of a 500.
"""

from __future__ import annotations

import base64
import datetime as dt
import re
from email.mime.text import MIMEText

import google_auth


class NotConnected(Exception):
    """No usable Google account (not linked, or its token needs reconnect)."""


def _calendar(email: str | None = None):
    svc = google_auth.get_service("calendar", "v3", email)
    if svc is None:
        raise NotConnected("Not connected to Google. Connect it in the Connections panel.")
    return svc


def _gmail(email: str | None = None):
    svc = google_auth.get_service("gmail", "v1", email)
    if svc is None:
        raise NotConnected("Not connected to Google. Connect it in the Connections panel.")
    return svc


# ---------- time helpers ----------

def _local_tz():
    return dt.datetime.now().astimezone().tzinfo


def _day_bounds(date: dt.date) -> tuple[dt.datetime, dt.datetime]:
    tz = _local_tz()
    return (
        dt.datetime.combine(date, dt.time.min, tz),
        dt.datetime.combine(date, dt.time.max, tz),
    )


def _parse_when(when: str | None) -> tuple[dt.datetime, dt.datetime]:
    """`today` (default) / `tomorrow` / `YYYY-MM-DD` / `YYYY-MM-DD..YYYY-MM-DD` -> (timeMin, timeMax)."""
    text = (when or "today").strip().lower()
    today = dt.datetime.now(_local_tz()).date()
    if text in ("", "today"):
        return _day_bounds(today)
    if text == "tomorrow":
        return _day_bounds(today + dt.timedelta(days=1))
    if ".." in text:
        a, b = (part.strip() for part in text.split("..", 1))
        return _day_bounds(dt.date.fromisoformat(a))[0], _day_bounds(dt.date.fromisoformat(b))[1]
    return _day_bounds(dt.date.fromisoformat(text))


def _ensure_dt(value: str) -> dt.datetime:
    """Parse an ISO-ish datetime; attach the local timezone when none is given."""
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_local_tz())
    return parsed


# ---------- calendar ----------

def _event_summary(e: dict) -> dict:
    start, end = e.get("start", {}), e.get("end", {})
    return {
        "id": e.get("id"),
        "title": e.get("summary", "(no title)"),
        "start": start.get("dateTime") or start.get("date"),
        "end": end.get("dateTime") or end.get("date"),
        "all_day": "date" in start,
        "location": e.get("location"),
        "attendees": [a.get("email") for a in e.get("attendees", []) if a.get("email")],
        "html_link": e.get("htmlLink"),
    }


def get_events(when: str = "today", max_results: int = 25, email: str | None = None) -> list[dict]:
    svc = _calendar(email)
    start, end = _parse_when(when)
    resp = (
        svc.events()
        .list(
            calendarId="primary",
            timeMin=start.isoformat(),
            timeMax=end.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=max_results,
        )
        .execute()
    )
    return [_event_summary(e) for e in resp.get("items", [])]


def search_calendar(query: str, max_results: int = 10, email: str | None = None) -> list[dict]:
    svc = _calendar(email)
    now = dt.datetime.now(_local_tz())
    resp = (
        svc.events()
        .list(
            calendarId="primary",
            q=query,
            timeMin=now.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=max_results,
        )
        .execute()
    )
    return [_event_summary(e) for e in resp.get("items", [])]


def create_event(
    summary: str,
    start: str,
    end: str | None = None,
    duration_min: int = 60,
    location: str | None = None,
    description: str | None = None,
    attendees: list[str] | None = None,
    email: str | None = None,
) -> dict:
    svc = _calendar(email)
    s = _ensure_dt(start)
    e = _ensure_dt(end) if end else s + dt.timedelta(minutes=int(duration_min or 60))
    body: dict = {
        "summary": summary,
        "start": {"dateTime": s.isoformat()},
        "end": {"dateTime": e.isoformat()},
    }
    if location:
        body["location"] = location
    if description:
        body["description"] = description
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees]
    created = (
        svc.events()
        .insert(calendarId="primary", body=body, sendUpdates="all" if attendees else "none")
        .execute()
    )
    return _event_summary(created)


def update_event(
    event_id: str,
    summary: str | None = None,
    start: str | None = None,
    end: str | None = None,
    location: str | None = None,
    description: str | None = None,
    attendees: list[str] | None = None,
    email: str | None = None,
) -> dict:
    svc = _calendar(email)
    body: dict = {}
    if summary is not None:
        body["summary"] = summary
    if start is not None:
        body["start"] = {"dateTime": _ensure_dt(start).isoformat()}
    if end is not None:
        body["end"] = {"dateTime": _ensure_dt(end).isoformat()}
    if location is not None:
        body["location"] = location
    if description is not None:
        body["description"] = description
    if attendees is not None:
        body["attendees"] = [{"email": a} for a in attendees]
    updated = svc.events().patch(calendarId="primary", eventId=event_id, body=body).execute()
    return _event_summary(updated)


def delete_event(event_id: str, email: str | None = None) -> dict:
    svc = _calendar(email)
    svc.events().delete(calendarId="primary", eventId=event_id).execute()
    return {"deleted": event_id}


# ---------- gmail ----------

def _b64(data: str) -> str:
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")


def _strip_html(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", html)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _header_dict(payload: dict) -> dict:
    """Gmail headers arrive as [{"name":..,"value":..}] with original casing — index them by
    lower-cased name so callers can look up 'message-id' regardless of how Gmail cased it."""
    return {h["name"].lower(): h["value"] for h in payload.get("headers", [])}


def _extract_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    if mime == "text/plain" and payload.get("body", {}).get("data"):
        return _b64(payload["body"]["data"])
    for part in payload.get("parts", []) or []:
        text = _extract_body(part)
        if text:
            return text
    if mime == "text/html" and payload.get("body", {}).get("data"):
        return _strip_html(_b64(payload["body"]["data"]))
    return ""


def _message_summary(svc, mid: str) -> dict:
    msg = (
        svc.users()
        .messages()
        .get(userId="me", id=mid, format="metadata", metadataHeaders=["From", "Subject", "Date"])
        .execute()
    )
    headers = _header_dict(msg.get("payload", {}))
    return {
        "id": mid,
        "from": headers.get("from", ""),
        "subject": headers.get("subject", "(no subject)"),
        "date": headers.get("date", ""),
        "snippet": msg.get("snippet", ""),
        "unread": "UNREAD" in msg.get("labelIds", []),
    }


def _list_messages(svc, query: str, max_results: int) -> list[dict]:
    resp = svc.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    return [_message_summary(svc, m["id"]) for m in resp.get("messages", [])]


def get_emails(filter: str = "recent", max_results: int = 10, email: str | None = None) -> list[dict]:
    svc = _gmail(email)
    query = "is:unread" if (filter or "").lower() == "unread" else "in:inbox"
    return _list_messages(svc, query, max_results)


def search_emails(query: str, max_results: int = 10, email: str | None = None) -> list[dict]:
    return _list_messages(_gmail(email), query, max_results)


def read_email(message_id: str, email: str | None = None) -> dict:
    svc = _gmail(email)
    msg = svc.users().messages().get(userId="me", id=message_id, format="full").execute()
    headers = _header_dict(msg.get("payload", {}))
    return {
        "id": message_id,
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "subject": headers.get("subject", "(no subject)"),
        "date": headers.get("date", ""),
        "body": _extract_body(msg.get("payload", {})) or msg.get("snippet", ""),
    }


def send_email(to: str, subject: str, body: str, email: str | None = None) -> dict:
    svc = _gmail(email)
    mime = MIMEText(body)
    mime["To"] = to
    mime["Subject"] = subject
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("utf-8")
    sent = svc.users().messages().send(userId="me", body={"raw": raw}).execute()
    return {"id": sent.get("id"), "to": to, "subject": subject}


def account_label(email: str | None = None) -> str | None:
    """The primary (or given) connected address, for panel display."""
    accounts = google_auth.list_accounts()
    if email:
        return email if any(a["email"] == email for a in accounts) else None
    return accounts[0]["email"] if accounts else None


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
    h = _header_dict(last.get("payload", {}))
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
