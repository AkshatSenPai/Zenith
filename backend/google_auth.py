"""Zenith — Google OAuth + token storage (Milestone 3).

Desktop-app OAuth via google-auth-oauthlib's InstalledAppFlow. The client id/secret come
from `.env` (no client_secret.json on disk). Tokens are stored per-account at
`backend/tokens/<email>.json` (gitignored) so multi-account is a later drop-in. The connect
flow runs in a background thread (it blocks on the browser consent), so the HTTP request that
starts it returns immediately and the frontend polls `status()`.

Single account is the M3 default: `get_credentials(email=None)` returns the first/primary
account; an `email` arg selects a specific one later.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

load_dotenv()

# Least-privilege scopes ONLY: calendar read+create, gmail read, gmail send.
SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

TOKENS_DIR = Path(__file__).resolve().parent / "tokens"

# Connect-flow + refresh state (single process, guarded by a lock).
_lock = threading.Lock()
_connect_state: dict = {"connecting": False, "last_error": None}
_needs_reconnect: set[str] = set()   # emails whose token refresh has failed


class GoogleNotConfigured(RuntimeError):
    """GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing from .env."""


def _client_config() -> dict:
    cid = os.getenv("GOOGLE_CLIENT_ID")
    secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not cid or not secret:
        raise GoogleNotConfigured(
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET "
            "in backend/.env (see SETUP-GOOGLE.md)."
        )
    return {
        "installed": {
            "client_id": cid,
            "client_secret": secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


# ---------- token persistence ----------

def _token_path(email: str) -> Path:
    return TOKENS_DIR / f"{email}.json"


def _account_emails() -> list[str]:
    if not TOKENS_DIR.exists():
        return []
    return sorted(p.stem for p in TOKENS_DIR.glob("*.json"))


def _save_creds(email: str, creds: Credentials) -> None:
    TOKENS_DIR.mkdir(exist_ok=True)
    _token_path(email).write_text(creds.to_json(), encoding="utf-8")


def _load_creds(email: str) -> Credentials | None:
    path = _token_path(email)
    if not path.exists():
        return None
    try:
        return Credentials.from_authorized_user_info(json.loads(path.read_text(encoding="utf-8")), SCOPES)
    except Exception as exc:  # noqa: BLE001 — a corrupt token shouldn't crash the app
        print(f"[google] could not load token for {email}: {exc}", flush=True)
        return None


# ---------- connect / disconnect ----------

def _email_for(creds: Credentials) -> str:
    """The account's own address, via Gmail getProfile (gmail.readonly already granted)."""
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return service.users().getProfile(userId="me").execute()["emailAddress"]


def _run_connect_flow() -> None:
    try:
        flow = InstalledAppFlow.from_client_config(_client_config(), SCOPES)
        # access_type=offline + prompt=consent => Google returns a long-lived refresh token.
        creds = flow.run_local_server(
            port=0,
            access_type="offline",
            prompt="consent",
            authorization_prompt_message="Zenith: complete Google sign-in in your browser…",
            success_message="Zenith is connected. You can close this tab.",
        )
        email = _email_for(creds)
        _save_creds(email, creds)
        _needs_reconnect.discard(email)
        print(f"[google] connected {email}", flush=True)
    except Exception as exc:  # noqa: BLE001 — surface to the UI, never crash the server
        with _lock:
            _connect_state["last_error"] = str(exc)
        print(f"[google] connect failed: {exc}", flush=True)
    finally:
        with _lock:
            _connect_state["connecting"] = False


def connect() -> dict:
    """Start the OAuth flow in a background thread (opens the system browser). Returns
    immediately; the frontend polls status() for completion."""
    with _lock:
        if _connect_state["connecting"]:
            return {"started": True, "already_running": True}
        _connect_state["connecting"] = True
        _connect_state["last_error"] = None
    threading.Thread(target=_run_connect_flow, name="google-oauth", daemon=True).start()
    return {"started": True}


def disconnect(email: str | None = None) -> dict:
    """Remove one account's token (or all when email is None)."""
    targets = [email] if email else _account_emails()
    for addr in targets:
        path = _token_path(addr)
        if path.exists():
            path.unlink()
        _needs_reconnect.discard(addr)
    return {"disconnected": targets}


# ---------- credentials / services ----------

def get_credentials(email: str | None = None) -> Credentials | None:
    """Valid credentials for the given (or primary) account, refreshing if needed. Returns
    None when not connected or when a refresh fails (the account is flagged needs_reconnect)."""
    accounts = _account_emails()
    if not accounts:
        return None
    target = email or accounts[0]
    creds = _load_creds(target)
    if creds is None:
        return None
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                _save_creds(target, creds)
                _needs_reconnect.discard(target)
            except Exception as exc:  # noqa: BLE001 — expired/revoked refresh token
                _needs_reconnect.add(target)
                print(f"[google] refresh failed for {target}: {exc}", flush=True)
                return None
        else:
            _needs_reconnect.add(target)
            return None
    return creds


def get_service(api: str, version: str, email: str | None = None):
    """Build a Google API client for the primary (or given) account, or None if not connected."""
    creds = get_credentials(email)
    if creds is None:
        return None
    return build(api, version, credentials=creds, cache_discovery=False)


# ---------- status (for the HUD) ----------

def list_accounts() -> list[dict]:
    return [{"email": e, "needs_reconnect": e in _needs_reconnect} for e in _account_emails()]


def status() -> dict:
    """Snapshot for the Connections panel + orb nodes. One consent grants both Calendar and
    Gmail scopes, so the two flags track the same account in M3."""
    accounts = list_accounts()
    connected = any(not a["needs_reconnect"] for a in accounts)
    with _lock:
        connecting = _connect_state["connecting"]
        last_error = _connect_state["last_error"]
    return {
        "gmail_connected": connected,
        "calendar_connected": connected,
        "accounts": accounts,
        "connecting": connecting,
        "last_error": last_error,
        "configured": bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET")),
    }
