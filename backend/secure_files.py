"""Zenith — tighten permissions on secrets at rest (Milestone 5 hardening).

The machine is the security boundary (single trusted local user), but the live Google OAuth tokens
(``backend/tokens/<email>.json``) and ``backend/.env`` (all API keys + both bot tokens) sit in
plaintext. ``harden()`` restricts them to the current user at startup — the cross-platform equivalent
of ``chmod 600``. Best-effort: it logs what it did and **never raises** (a perms failure must not
block boot).

Full at-rest encryption is deliberately deferred (Phase-2): it adds key-management complexity and risk
to the live tokens for little gain under the local-trust model. See SECURITY.md.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent
_ENV = _BACKEND / ".env"
_TOKENS_DIR = _BACKEND / "tokens"
_ZENITH_DIR = _BACKEND / ".zenith"   # persisted conversation history (message content)


def _restrict_windows(path: Path, *, is_dir: bool) -> None:
    """Strip inherited ACLs and grant only the current user. (OI)(CI) makes a dir's grant inheritable
    so token files created later are restricted too."""
    user = os.environ.get("USERNAME") or "?"
    grant = f"{user}:(OI)(CI)F" if is_dir else f"{user}:F"
    res = subprocess.run(
        ["icacls", str(path), "/inheritance:r", "/grant:r", grant],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout or "icacls failed").strip())


def _restrict_posix(path: Path, *, is_dir: bool) -> None:
    os.chmod(path, 0o700 if is_dir else 0o600)


def _restrict(path: Path, *, is_dir: bool) -> None:
    if not path.exists():
        return
    try:
        if sys.platform.startswith("win"):
            _restrict_windows(path, is_dir=is_dir)
        else:
            _restrict_posix(path, is_dir=is_dir)
        print(f"[secure] restricted {path.name}{'/' if is_dir else ''} to the current user", flush=True)
    except Exception as exc:  # noqa: BLE001 — perms are best-effort; never block boot
        print(f"[secure] could not restrict {path.name}: {exc}", flush=True)


def harden() -> None:
    """Restrict backend/.env + backend/tokens/ (and each token file) to the current user. Idempotent."""
    _restrict(_ENV, is_dir=False)
    _restrict(_TOKENS_DIR, is_dir=True)
    if _TOKENS_DIR.exists():
        for token in _TOKENS_DIR.glob("*.json"):
            _restrict(token, is_dir=False)
    if _ZENITH_DIR.exists():
        _restrict(_ZENITH_DIR, is_dir=True)
        for f in _ZENITH_DIR.glob("*.json"):
            _restrict(f, is_dir=False)
