"""Zenith — Proactivity (M7 Part 2). Surfaces "what slipped on your side" (approaching meetings,
unkept commitments) as <=3 nudge cards, computed on demand. WHITELIST-OF-SOURCES: reads only the
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
