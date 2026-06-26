"""Zenith — Telegram remote (Milestone 4).

A phone front-end into the EXISTING brain: a message runs through `chat_core` (the SAME loop as
POST /chat — Claude + last-20 history + rate limit + tools + confirm gate), and the confirm gate is
rendered as inline `[Confirm][Cancel]` buttons. Telegram is NOT a tool; it's a chat ingress.

python-telegram-bot v20+ (async), **long-polling** (no webhooks — the backend is behind NAT), run on
FastAPI's event loop. **LOCKED to `TELEGRAM_ALLOWED_USER_IDS`** — every other sender is ignored + logged
(fail-closed: an empty allow-list rejects EVERYONE). The async handlers bridge to the sync chat core
via `asyncio.to_thread` so a Claude call never blocks the loop. Errors are swallowed → the bot
reconnects and never crashes FastAPI.
"""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import chat_core

load_dotenv()

CHANNEL = "telegram"

_app: Application | None = None
_state: dict = {"connected": False, "bot_user": None, "last_error": None}

# A first-contact greeting (static — no API call / rate-limit slot). Allowed users are greeted once
# per process: on /start, or on their first text message. Resets on restart (acceptable).
WELCOME = (
    "Zenith online, Boss. I'm your assistant — now right here on your phone.\n\n"
    "Ask me to:\n"
    "• check your calendar or unread email\n"
    "• send an email or a message (I'll ask you to confirm first)\n"
    "• read or post in your Discord channels\n"
    "• get a briefing — just say \"good morning\"\n\n"
    "Anything that sends or changes something comes back as a Confirm/Cancel button, so nothing "
    "happens without your okay. What do you need?"
)
_seen_users: set[int] = set()


# ---------- config / auth (security first) ----------

def configured() -> bool:
    return bool(os.getenv("TELEGRAM_BOT_TOKEN"))


def _allowed_ids() -> set[int]:
    raw = os.getenv("TELEGRAM_ALLOWED_USER_IDS", "")
    return {int(p.strip()) for p in raw.replace(";", ",").split(",") if p.strip().isdigit()}


def _is_allowed(user) -> bool:
    """The allow-list gate. Empty list → reject everyone (fail-closed)."""
    return user is not None and user.id in _allowed_ids()


# ---------- rendering the confirm gate as buttons ----------

def _keyboard(pid: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Confirm", callback_data=f"ok:{pid}"),
        InlineKeyboardButton("✖ Cancel", callback_data=f"no:{pid}"),
    ]])


def _action_summary(tool: str, inp: dict) -> str:
    if tool == "send_email":
        return f"Send email to {inp.get('to', '?')}\nSubject: {inp.get('subject', '')}\n\n{inp.get('body', '')}"
    if tool == "send_message":
        return f"Send a message to {inp.get('to', '?')}:\n{inp.get('body', '')}"
    if tool == "send_discord_message":
        return f"Post to #{str(inp.get('channel', '')).lstrip('#')}:\n{inp.get('text', '')}"
    if tool in ("create_event", "update_event"):
        return f"{tool}: {inp.get('summary', '(event)')}\nStart: {inp.get('start', '?')}"
    if tool == "delete_event":
        return f"Delete calendar event {inp.get('event_id', '?')}"
    return f"{tool}: {inp}"


def _confirm_body(outcome: dict) -> str:
    """The confirm prompt, with an injection warning when the action followed untrusted read-content."""
    warn = ""
    if outcome.get("untrusted"):
        warn = ("⚠️ This action may have been triggered by content Zenith read "
                "(email/Discord/calendar). Verify before approving.\n\n")
    return warn + "Confirm this action?\n\n" + _action_summary(outcome["tool"], outcome["pending"])


# ---------- handlers ----------

async def _greet_once(update: Update, user) -> None:
    """Send the welcome the first time we see an allowed user this process."""
    if user.id in _seen_users:
        return
    _seen_users.add(user.id)
    if update.message:
        await update.message.reply_text(WELCOME)


async def _on_start(update: Update, _ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """/start — the conventional Telegram entry point. Allow-list gated, like everything else."""
    user = update.effective_user
    if not _is_allowed(user):
        print(f"[telegram] IGNORED /start from unauthorized id={getattr(user, 'id', '?')}", flush=True)
        return
    _seen_users.add(user.id)
    if update.message:
        await update.message.reply_text(WELCOME)


async def _on_message(update: Update, _ctx: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not _is_allowed(user):
        print(f"[telegram] IGNORED message from unauthorized id={getattr(user, 'id', '?')}", flush=True)
        return
    text = (update.message.text or "").strip() if update.message else ""
    if not text:
        return
    await _greet_once(update, user)  # one-time welcome on first contact, then answer normally
    try:
        outcome = await asyncio.to_thread(chat_core.process_chat, text, CHANNEL)
    except chat_core.RateLimited as exc:
        await update.message.reply_text(str(exc))
        return
    except chat_core.ClaudeUnavailable:
        await update.message.reply_text("Zenith's brain is unavailable right now — try again in a moment.")
        return
    except Exception as exc:  # noqa: BLE001 — never crash the handler
        print(f"[telegram] message error: {exc}", flush=True)
        await update.message.reply_text("Something went wrong handling that.")
        return

    if "reply" in outcome:
        await update.message.reply_text(outcome["reply"] or "(no reply)")
    else:
        body = _confirm_body(outcome)
        await update.message.reply_text(body, reply_markup=_keyboard(outcome["id"]))


async def _on_callback(update: Update, _ctx: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.callback_query
    if q is None:
        return
    if not _is_allowed(q.from_user):
        await q.answer("Not authorized.", show_alert=True)
        print(f"[telegram] IGNORED callback from unauthorized id={getattr(q.from_user, 'id', '?')}", flush=True)
        return
    await q.answer()
    action, _, pid = (q.data or "").partition(":")
    try:
        outcome = await asyncio.to_thread(chat_core.process_confirm, pid, action == "ok")
    except KeyError:
        await q.edit_message_text("That action expired — send the request again.")
        return
    except chat_core.RateLimited as exc:
        await q.edit_message_text(str(exc))
        return
    except Exception as exc:  # noqa: BLE001
        print(f"[telegram] callback error: {exc}", flush=True)
        await q.edit_message_text("Something went wrong.")
        return

    if "reply" in outcome:
        await q.edit_message_text(outcome["reply"] or "Done.")
    else:
        body = _confirm_body(outcome)
        await q.edit_message_text(body, reply_markup=_keyboard(outcome["id"]))


async def _on_error(_update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    print(f"[telegram] handler error: {context.error}", flush=True)


# ---------- lifecycle (called from main.py startup / shutdown) ----------

async def start() -> None:
    """Initialize + start long-polling on the current event loop (no-op without a token)."""
    global _app
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("[telegram] TELEGRAM_BOT_TOKEN not set — Telegram disabled.", flush=True)
        return
    if _app is not None:
        return
    if not _allowed_ids():
        print("[telegram] WARNING: TELEGRAM_ALLOWED_USER_IDS is empty — the bot will reject EVERYONE "
              "(fail-closed). Set your numeric id (see SETUP-TELEGRAM.md).", flush=True)
    try:
        app = Application.builder().token(token).build()
        app.add_handler(CommandHandler("start", _on_start))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, _on_message))
        app.add_handler(CallbackQueryHandler(_on_callback))
        app.add_error_handler(_on_error)
        await app.initialize()
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)
        me = await app.bot.get_me()
        _app = app
        _state.update(connected=True, bot_user=me.username, last_error=None)
        print(f"[telegram] polling as @{me.username} ({len(_allowed_ids())} allowed id(s))", flush=True)
    except Exception as exc:  # noqa: BLE001 — surface, never crash boot
        _state.update(connected=False, last_error=str(exc))
        print(f"[telegram] start failed: {exc}", flush=True)


async def close() -> None:
    global _app
    if _app is None:
        return
    try:
        if _app.updater and _app.updater.running:
            await _app.updater.stop()
        await _app.stop()
        await _app.shutdown()
    except Exception as exc:  # noqa: BLE001
        print(f"[telegram] shutdown error: {exc}", flush=True)
    _app = None
    _state["connected"] = False


def status() -> dict:
    return {
        "connected": _state["connected"],
        "configured": configured(),
        "bot_user": _state["bot_user"],
        "allowed_count": len(_allowed_ids()),
        "last_error": _state["last_error"],
    }
