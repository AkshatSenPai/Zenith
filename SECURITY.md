# Zenith — Security posture & hardening checklist

Phase-1 is a **single-user personal daily driver on your own machine.** This file documents the
current security model, the real risks, and the M5 hardening status.

## The model
**"One trusted user on a trusted local machine."** Security rests on three assumptions:
1. the machine is yours and uncompromised, 2. `.env` + `backend/tokens/` stay on it, 3. the backend
stays bound to **localhost** (uvicorn's default). Break any of those and the picture changes.

## Controls in place ✓
- **Backend API token** — every FastAPI route except `GET /` and `GET /health` requires a shared
  secret in the `X-Zenith-Token` header (`backend/auth.py`). Set `ZENITH_API_TOKEN` in `backend/.env`
  and the matching `NEXT_PUBLIC_ZENITH_API_TOKEN` in `frontend/.env.local`. **Fail-open when unset**
  (localhost-only, with a loud boot warning); strict **401** when set. The Telegram/Discord bots call
  the brain **in-process**, so they're unaffected by the HTTP gate.
- **Prompt-injection guard** — read-tool results carrying third-party content (email, Discord,
  calendar, briefing) are fenced as `<external-content>`, and the system prompt forbids acting on
  instructions inside them. When an action is proposed in the **same turn** such content was read, the
  HUD confirm card and the Telegram confirm buttons show a ⚠️ warning. The confirm gate never
  auto-approves.
- **Secrets restricted at rest** — `backend/.env` + `backend/tokens/*.json` are locked to the current
  user at boot (`secure_files.harden()`: `icacls` on Windows / `chmod 600` on POSIX).
- **Secrets gitignored** — `.env`, `.env.local`, `backend/tokens/` never hit git. *(M5 fixed an
  inline-comment bug in `.gitignore` that had left `backend/tokens/` effectively un-ignored — the live
  OAuth tokens were never actually committed, verified against history.)*
- **Remote door locked** — Telegram is the only ingress reachable off-machine, **allow-listed by user
  id, fail-closed** (`TELEGRAM_ALLOWED_USER_IDS`; empty ⇒ rejects everyone). The single most important control.
- **Confirm gate on every action** — `send_email` / `create_event` / `update_event` / `delete_event` /
  `send_discord_message` / `send_message` never fire without explicit approval (HUD card / TG buttons).
- **Least privilege** — Google scopes `calendar.events` / `gmail.readonly` / `gmail.send` only;
  Discord **server channels only, never DMs**.
- **Budget kill-switch** — hard caps (5/min, 150/day, 300k tokens/day) that *block*, not just warn;
  the limiter is **thread-safe** (one Lock; the HUD + Telegram threads can't race).
- **Scrubbed logs** — tool-call logging defaults to `tool name + ok/failed` only (no bodies /
  recipients); set `ZENITH_DEBUG_LOGS=1` to log full inputs + results while debugging.
- **CORS** limited to `localhost:3000`; backend binds localhost by default.

## Open risks / gaps ⚠️
1. **The API token is a shared secret, not per-user auth** — fine for one local user; Phase-2 needs a
   real authn/authz layer.
2. **`NEXT_PUBLIC_ZENITH_API_TOKEN` is embedded in the client bundle** — visible in the browser.
   Acceptable under local trust: the real boundary is localhost **+** token together (it stops other
   local processes / an accidental non-localhost bind from calling blind), not the user's own browser.
3. **No at-rest *encryption*** — tokens + `.env` are permission-restricted but still plaintext on disk.
   The machine remains the boundary. Full encryption is deferred to Phase-2 (key-management
   complexity, risk to the live Google tokens, little gain under local trust).
4. **The confirm gate is a trust/UX layer, not an auth boundary** — a local caller holding the token
   could hit `/chat/confirm` and self-approve.
5. **The injection warning is same-turn only** — an action proposed a turn *after* untrusted content
   was read won't raise the banner; the system-prompt rule is the backstop there.
6. **OAuth consent screen is "unverified"** — fine for personal use; Google just shows a warning.

## Token rotation (if a secret leaks)
- **`ZENITH_API_TOKEN`** — generate a new value (`python -c "import secrets;print(secrets.token_urlsafe(32))"`),
  update `backend/.env` **and** `frontend/.env.local` (they must match), restart both.
- **Telegram bot** — `@BotFather` → `/revoke` (or `/token`), put the new token in `TELEGRAM_BOT_TOKEN`.
- **Discord bot** — Developer Portal → your app → **Bot → Reset Token**, update `DISCORD_BOT_TOKEN`.
- **Google** — revoke at https://myaccount.google.com/permissions, delete `backend/tokens/<email>.json`,
  reconnect from the HUD. Rotate `GOOGLE_CLIENT_SECRET` in the Cloud Console if the client itself leaked.
- **Anthropic** — rotate `ANTHROPIC_API_KEY` in the Anthropic Console.

## M5 hardening checklist
- [x] **Backend API token** — `X-Zenith-Token` on all routes except `/` and `/health`.
- [x] **Prompt-injection guard** — fence untrusted content; same-turn confirm warning; never auto-approve.
- [x] **Tighten secrets at rest** — `chmod 600` / `icacls` on `.env` + `tokens/` (encryption deferred).
- [x] **Thread-safe rate limiter** — verified Lock-guarded; regression + concurrency tests added.
- [x] **Scrub logs** — verbose tool logging gated behind `ZENITH_DEBUG_LOGS`.
- [x] **Fix `.gitignore`** so `backend/tokens/` is actually ignored.
- [x] **Delete the stray worktree `.env`** copy (`.claude/worktrees/skins-build/backend/.env`).
- [x] **Tests** — auth gate, prompt injection, rate limiter, secure-files (alongside the M3/M4 suites).
- [ ] **Settings page** + real usage/cost dashboard (roadmap M5, separate slice).

## Out of M5 → Phase-2
Multi-user auth (Clerk), per-user encrypted keys, hosted/internet-facing backend. These flip the model
from "local trust" to "public surface" and require everything above plus a real authn/authz layer.
