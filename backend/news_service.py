"""Zenith — world + India news headlines for the morning briefing (free RSS, no API key).

A world feed + an India feed (overridable via `NEWS_FEEDS` in `.env`), parsed with feedparser and
**interleaved** so the result is a blended mix (world, India, world, India…), not two separate lists.
Degrades to a clear message rather than crashing, so a feed being down never breaks the briefing.
"""

from __future__ import annotations

import os

import feedparser
import requests
from dotenv import load_dotenv

load_dotenv()

# (label, url) — free, no-key RSS. World + India by default; override via NEWS_FEEDS in .env.
_DEFAULT_FEEDS = [
    ("World", "http://feeds.bbci.co.uk/news/world/rss.xml"),
    ("India", "https://timesofindia.indiatimes.com/rssfeedstopstories.cms"),
]
_TIMEOUT = 8
_UA = "Zenith/1.0 (morning-briefing)"


class NewsUnavailable(Exception):
    """Every configured feed failed or was empty — surfaced to the user, not a crash."""


def _feeds() -> list[tuple[str, str]]:
    """Parse NEWS_FEEDS ('Label|url, Label|url') from .env, else the world+India defaults."""
    raw = os.getenv("NEWS_FEEDS", "").strip()
    if not raw:
        return _DEFAULT_FEEDS
    out: list[tuple[str, str]] = []
    for part in raw.split(","):
        label, _, url = part.partition("|")
        if url.strip():
            out.append((label.strip() or "News", url.strip()))
    return out or _DEFAULT_FEEDS


def _fetch(url: str):
    """GET the feed with a timeout, then parse the bytes (feedparser-on-bytes avoids its blocking fetch)."""
    resp = requests.get(url, timeout=_TIMEOUT, headers={"User-Agent": _UA})
    resp.raise_for_status()
    return feedparser.parse(resp.content)


def get_headlines(limit: int = 5) -> list[dict]:
    """Top headlines, round-robin interleaved across the feeds for a world+India mix.
    Returns [{title, source}]. Raises NewsUnavailable only if EVERY feed fails/empty."""
    per_feed: list[list[dict]] = []
    for label, url in _feeds():
        try:
            parsed = _fetch(url)
            items = [
                {"title": (e.get("title") or "").strip(), "source": label}
                for e in parsed.entries
                if (e.get("title") or "").strip()
            ]
            if items:
                per_feed.append(items)
        except Exception:  # noqa: BLE001 — one bad feed shouldn't sink the rest
            continue
    if not per_feed:
        raise NewsUnavailable("News unavailable — couldn't reach the configured feeds right now.")

    out: list[dict] = []
    seen: set[str] = set()
    i = 0
    while len(out) < limit and any(i < len(f) for f in per_feed):
        for f in per_feed:
            if i < len(f):
                h = f[i]
                key = h["title"].lower()
                if key not in seen:
                    seen.add(key)
                    out.append(h)
                    if len(out) >= limit:
                        break
        i += 1
    return out
