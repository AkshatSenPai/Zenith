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
_BULK_PRECEDENCE = {"bulk", "list", "junk"}   # RFC-3834 / historical bulk markers


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
    """RFC-2822 header date -> aware datetime. A header without an offset is treated as UTC."""
    try:
        d = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def _is_bulk(summary: dict) -> bool:
    """Newsletters, marketing, notifications, and mailing lists carry List-Unsubscribe / List-Id, or
    Precedence: bulk/list. Person-to-person mail does not, so this is a high-precision, zero-token
    noise filter — the thing that separates 'a human is waiting' from 'Grammarly wants you back'."""
    if summary.get("list_unsubscribe") or summary.get("list_id"):
        return True
    return (summary.get("precedence") or "").strip().lower() in _BULK_PRECEDENCE


def _is_waiting(summary: dict, me: str, now: dt.datetime, min_age_hours: float) -> bool:
    frm = summary.get("from", "")
    _name, addr = parseaddr(frm)
    if addr.lower() == me:
        return False                       # I sent the last message — the ball is in their court
    if _NOREPLY.search(frm):
        return False                       # machine mail never awaits a reply
    if _is_bulk(summary):
        return False                       # newsletter/notification/list mail — nobody awaits a reply
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
    limit = _max_threads() if max_results is None else max_results
    return rows[:limit]
