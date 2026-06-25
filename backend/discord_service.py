"""Zenith — Discord bot service (Milestone 4, part 1).

A discord.py gateway bot runs as a background task on FastAPI's event loop (started in main.py).
The Claude tool executors are sync — `run_tool` runs in an anyio worker thread — so they reach the
bot through `asyncio.run_coroutine_threadsafe(coro, loop).result()`, the standard
discord.py-inside-FastAPI bridge.

Constraints: the bot sees ONLY channels it's been invited to and NEVER the owner's DMs (reading own
DMs would need a user-token = Discord ToS violation). Server text channels only. Requires the
**Message Content** privileged intent (enable it in the Developer Portal).
"""

from __future__ import annotations

import asyncio
import os

import discord
from dotenv import load_dotenv

load_dotenv()

_TIMEOUT = 15  # seconds to wait for a bridged discord op

_client: discord.Client | None = None
_loop: asyncio.AbstractEventLoop | None = None
_state: dict = {"connecting": False, "last_error": None, "bot_user": None}


class DiscordNotConnected(Exception):
    """The bot isn't running (no token) or hasn't finished connecting."""


class DiscordChannelNotFound(Exception):
    """No visible text channel matches the given name/id."""


def configured() -> bool:
    return bool(os.getenv("DISCORD_BOT_TOKEN"))


# ---------- lifecycle (called from main.py startup / shutdown) ----------

def start(loop: asyncio.AbstractEventLoop) -> None:
    """Launch the bot as a background task on the given (FastAPI) event loop. No-op without a token."""
    global _client, _loop
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        print("[discord] DISCORD_BOT_TOKEN not set — Discord disabled.", flush=True)
        return
    if _client is not None:
        return
    _loop = loop
    intents = discord.Intents.default()
    intents.message_content = True  # privileged — must be enabled in the Developer Portal
    _client = discord.Client(intents=intents)

    @_client.event
    async def on_ready() -> None:
        _state["bot_user"] = str(_client.user)
        _state["connecting"] = False
        print(f"[discord] connected as {_client.user} ({len(_client.guilds)} server(s))", flush=True)

    _state["connecting"] = True
    _state["last_error"] = None

    async def _runner() -> None:
        try:
            await _client.start(token)
        except Exception as exc:  # noqa: BLE001 — bad token etc.; surface it, never crash the server
            _state["last_error"] = str(exc)
            _state["connecting"] = False
            print(f"[discord] bot failed: {exc}", flush=True)

    loop.create_task(_runner())


async def close() -> None:
    if _client is not None and not _client.is_closed():
        await _client.close()


# ---------- status (read on the loop via the async /discord/status endpoint) ----------

def _ready() -> bool:
    return _client is not None and _client.is_ready()


def status() -> dict:
    guilds = []
    if _ready():
        guilds = [{"id": str(g.id), "name": g.name, "channels": len(g.text_channels)} for g in _client.guilds]
    return {
        "connected": _ready(),
        "configured": configured(),
        "bot_user": _state["bot_user"],
        "guilds": guilds,
        "connecting": _state["connecting"] and not _ready(),
        "last_error": _state["last_error"],
    }


# ---------- async ops + the sync bridge ----------

def _bridge(make_coro):
    """Run a discord coroutine on the bot's loop from a worker thread and block for the result.
    Takes a factory so the coroutine is only created after the checks pass (no unawaited-coroutine
    warning on the disconnected path)."""
    if not configured():
        raise DiscordNotConnected("Discord is not configured. Set DISCORD_BOT_TOKEN in backend/.env.")
    if _client is None or _loop is None or not _client.is_ready():
        raise DiscordNotConnected("The Discord bot is still connecting — try again in a moment.")
    return asyncio.run_coroutine_threadsafe(make_coro(), _loop).result(timeout=_TIMEOUT)


def _resolve_channel(name_or_id: str):
    """First visible text channel matching a name (case-insensitive, strip #) or an id."""
    key = str(name_or_id).lstrip("#").strip().lower()
    for guild in _client.guilds:
        for ch in guild.text_channels:
            if not ch.permissions_for(guild.me).read_messages:
                continue
            if ch.name.lower() == key or str(ch.id) == key:
                return ch
    return None


def _fmt(m: "discord.Message") -> dict:
    return {
        "id": str(m.id),
        "author": m.author.display_name,
        "text": m.content,
        "time": m.created_at.isoformat(),
        "channel": m.channel.name,
    }


async def _list_channels():
    out = []
    for guild in _client.guilds:
        chans = [
            {"id": str(ch.id), "name": ch.name}
            for ch in guild.text_channels
            if ch.permissions_for(guild.me).read_messages
        ]
        out.append({"guild": guild.name, "guild_id": str(guild.id), "channels": chans})
    return out


async def _get_messages(channel: str, limit: int):
    ch = _resolve_channel(channel)
    if ch is None:
        raise DiscordChannelNotFound(f"No channel matching '{channel}' that the bot can see.")
    msgs = [_fmt(m) async for m in ch.history(limit=max(1, min(int(limit), 50)))]
    msgs.reverse()  # oldest -> newest for reading
    return msgs


async def _search(query: str, channel: str | None):
    q = query.lower()
    if channel:
        target = _resolve_channel(channel)
        if target is None:
            raise DiscordChannelNotFound(f"No channel matching '{channel}' that the bot can see.")
        targets, per = [target], 200
    else:
        targets = [c for g in _client.guilds for c in g.text_channels if c.permissions_for(g.me).read_messages]
        per = 40
    hits = []
    for ch in targets:
        async for m in ch.history(limit=per):
            if q in (m.content or "").lower():
                hits.append(_fmt(m))
                if len(hits) >= 25:
                    return hits
    return hits


async def _send(channel: str, text: str):
    ch = _resolve_channel(channel)
    if ch is None:
        raise DiscordChannelNotFound(f"No channel matching '{channel}' that the bot can see.")
    msg = await ch.send(text)
    return {"id": str(msg.id), "channel": ch.name, "guild": ch.guild.name}


# ---------- sync wrappers the tools call ----------

def list_channels() -> list[dict]:
    return _bridge(lambda: _list_channels())


def get_messages(channel: str, limit: int = 15) -> list[dict]:
    return _bridge(lambda: _get_messages(channel, limit))


def search_messages(query: str, channel: str | None = None) -> list[dict]:
    return _bridge(lambda: _search(query, channel))


def send_message(channel: str, text: str) -> dict:
    return _bridge(lambda: _send(channel, text))
