"""Zenith — App Launcher.

Opens the owner's PRE-APPROVED apps / files / folders / websites by name. SECURITY MODEL:
WHITELIST ONLY. Zenith only ever launches an entry from apps.json — it NEVER runs an arbitrary
path or command a caller (or a prompt-injected email) supplies. The tool argument is a NAME to
look up here, never a path to execute. There is no "run any command" escape hatch.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path


class LauncherError(Exception):
    """Base for app-launcher failures (caught in tools.run_tool → marked failed, never logged as opened)."""


class AppNotFound(LauncherError):
    """No confident whitelist match. Message lists what CAN be opened."""


class LaunchError(LauncherError):
    """A matched entry failed to launch (bad target, not on PATH, OS refused)."""


_HERE = Path(__file__).resolve().parent
DEFAULT_APPS_PATH = _HERE / "apps.json"
EXAMPLE_APPS_PATH = _HERE / "apps.example.json"


def apps_path() -> Path:
    """apps.json location: ZENITH_APPS_PATH override (quotes/~ handled) else backend/apps.json."""
    env = (os.getenv("ZENITH_APPS_PATH") or "").strip().strip('"').strip("'")
    if env:
        return Path(os.path.expanduser(env))
    return DEFAULT_APPS_PATH


def load_apps() -> list[dict]:
    """Read the whitelist FRESH (edits apply with no restart). Falls back to the committed
    apps.example.json when apps.json is absent. Returns [] on a missing/broken file. Only entries
    with both a name and a target survive."""
    path = apps_path()
    if not path.exists():
        path = EXAMPLE_APPS_PATH
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    apps = data.get("apps", []) if isinstance(data, dict) else data
    return [a for a in apps if isinstance(a, dict) and a.get("name") and a.get("target")]


def _normalize(s: str) -> str:
    """Lowercase, alphanumerics only — so 'VS Code', 'vs-code', 'vscode' all collapse to one key."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def list_apps() -> list[str]:
    """The launchable names, for 'what can you open?'."""
    return [a["name"] for a in load_apps()]


def _keys(a: dict) -> list[str]:
    return [a["name"], *a.get("aliases", [])]


def _no_match_msg(apps: list[dict]) -> str:
    names = ", ".join(a["name"] for a in apps) or "(nothing configured — add apps to backend/apps.json)"
    return f"I don't have that in my launch list. I can open: {names}."


def _ambiguous_msg(name: str, subs: list[dict]) -> str:
    return f"'{name}' could mean a few things: {', '.join(a['name'] for a in subs)}. Which one?"


def resolve(name: str) -> dict:
    """Find the ONE whitelist entry `name` refers to. Raises AppNotFound (message lists options)
    when there is no confident single match — NEVER guesses."""
    apps = load_apps()
    q = _normalize(name)
    if not q or not apps:
        raise AppNotFound(_no_match_msg(apps))
    # 1) exact on name/alias
    for a in apps:
        if any(_normalize(k) == q for k in _keys(a)):
            return a
    # 2) substring either direction
    subs = [a for a in apps if any(q in _normalize(k) or _normalize(k) in q for k in _keys(a))]
    if len(subs) == 1:
        return subs[0]
    if len(subs) > 1:
        raise AppNotFound(_ambiguous_msg(name, subs))
    # 3) fuzzy close-match against every key
    keyed = {_normalize(k): a for a in apps for k in _keys(a)}
    close = difflib.get_close_matches(q, list(keyed), n=1, cutoff=0.72)
    if close:
        return keyed[close[0]]
    raise AppNotFound(_no_match_msg(apps))
