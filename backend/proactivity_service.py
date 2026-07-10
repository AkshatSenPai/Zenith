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

import chat_core
import claude_service
import google_service
import vault_service


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
