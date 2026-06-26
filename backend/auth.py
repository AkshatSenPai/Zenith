"""Zenith — backend API-token gate (Milestone 5 hardening).

Localhost binding was the only wall in front of the FastAPI routes. This adds a shared-secret header
(``X-Zenith-Token``) as defense-in-depth: every app route requires it EXCEPT the public health checks
(``GET /`` and ``GET /health``) and CORS preflight (``OPTIONS``).

Posture: **fail-open when unconfigured.** If ``ZENITH_API_TOKEN`` is not set, routes work as before
(localhost only) and ``main.py`` logs a loud startup warning. The moment the token IS set it is
strictly enforced — a missing or wrong header returns 401. This keeps fresh clones and the existing
route tests working while making enforcement one env var away.
"""

from __future__ import annotations

import os
import secrets

from dotenv import load_dotenv
from fastapi import Header, HTTPException, Request

load_dotenv()

# Health / diagnostics only (no secrets) — a liveness probe must never need the token.
EXEMPT_PATHS = {"/", "/health"}


def enforcement_enabled() -> bool:
    """True when a token is configured, so the caller can log 'enforced' vs 'open' at boot."""
    return bool(os.getenv("ZENITH_API_TOKEN"))


def require_token(
    request: Request,
    x_zenith_token: str | None = Header(default=None, alias="X-Zenith-Token"),
) -> None:
    """Global dependency: require the shared secret on every route except the exemptions.

    The token is read fresh from the environment on each call so tests can toggle it and a
    newly-set ``.env`` is honoured without an import-time capture.
    """
    if request.method == "OPTIONS":        # CORS preflight carries no custom headers
        return
    if request.url.path in EXEMPT_PATHS:   # public health checks
        return
    token = os.getenv("ZENITH_API_TOKEN")
    if not token:                          # fail-open (warned loudly at startup)
        return
    if not x_zenith_token or not secrets.compare_digest(x_zenith_token, token):
        raise HTTPException(status_code=401, detail="Missing or invalid X-Zenith-Token.")
