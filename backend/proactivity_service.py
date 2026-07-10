"""Zenith — Proactivity (M7 Part 2). Surfaces "what slipped on your side" (approaching meetings,
unkept commitments) as <=3 nudge cards, computed on demand. WHITELIST-OF-SOURCES: reads only the
owner's own trusted data (Calendar, vault daily notes). A nudge's action is a PREFILL string, never
an executed tool — nothing acts without the owner. Inbound-message triage is a separate feature."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
from pathlib import Path


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
