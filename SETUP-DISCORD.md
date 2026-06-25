# Connecting Discord — one-time setup

Milestone 4 (part 1) gives Zenith **Discord server channels** as tools — list channels, read/search
recent messages, and post (gated by the confirm card). It uses a **discord.py bot**, not MCP. You
create a bot once, drop its token into `backend/.env`, invite it to your server(s), and Zenith
auto-connects on backend startup.

Budget ~5 minutes.

> **What the bot can and cannot see — by design:**
> A bot only sees **channels it has been added to**, and it **cannot read your personal DMs**.
> Reading your own DMs would require a *user token*, which violates Discord's ToS and risks a ban —
> Zenith deliberately does **not** do that. **Server channels only.**

---

## 1. Create the application + bot
1. Go to the **Discord Developer Portal**: <https://discord.com/developers/applications>.
2. **New Application** → name it `Zenith` → Create.
3. Left sidebar → **Bot** → **Add Bot** → Yes.
4. (Optional) set a name/avatar.

## 2. Enable the Message Content intent  *(required)*
Still on the **Bot** page → **Privileged Gateway Intents** → turn **ON** **MESSAGE CONTENT INTENT** →
Save. Without it, message text comes back empty.

## 3. Copy the bot token → `backend/.env`
On the **Bot** page → **Reset Token** (or Copy) → copy the token. Add it to `backend/.env`:

```dotenv
# Discord bot (server channels only — never DMs)
DISCORD_BOT_TOKEN=your-bot-token-here
```

`.env` is gitignored — the token never leaves your machine. **Treat it like a password.**

## 4. Invite the bot to your server(s)
1. Left sidebar → **OAuth2** → **URL Generator**.
2. **Scopes:** check **`bot`**.
3. **Bot Permissions:** check **View Channels**, **Read Message History**, **Send Messages**.
4. Copy the generated URL at the bottom, open it in your browser, pick your server → **Authorize**.
   (You need *Manage Server* on that server. Repeat for each server you want Zenith to see.)
5. In Discord, make sure the bot's role can actually see the channels you care about (channel-level
   permissions can override server defaults).

## 5. Restart + check
1. Restart the backend (`uvicorn main:app --reload --port 8000`). Watch the log for
   `[discord] connected as Zenith#1234 (N server(s))`.
2. In the HUD, the **Discord** node on the orb lights up and the **Connections** row shows the bot.

Now try:
- "What can you see on Discord?" → `list_discord_channels`
- "Latest messages in #general?" → real messages
- "Send 'on my way' to #team" → ConfirmCard → Confirm → it posts

---

## Troubleshooting
- **Discord row stays "Bot offline" / "Connecting…"** → check the backend log. A bad token logs
  `[discord] bot failed: ...`; a missing token logs `DISCORD_BOT_TOKEN not set — Discord disabled.`
- **"No channel matching '#x' that the bot can see"** → the bot isn't in that server, or its role
  lacks *View Channels* there. Re-invite / fix channel permissions.
- **Messages come back blank** → the **Message Content intent** isn't enabled (step 2).
- **Search** only covers **recent** messages per channel (Discord bots have no full-text search) —
  good for "latest mentions of X", not deep history.
- Channel names are matched case-insensitively; if two servers have a `#general`, the **first match**
  wins — name the other one or pass its id.

## Scope / safety
- The bot requests only **View Channels + Read Message History + Send Messages** — no manage, no
  kick/ban, no DMs. `send_discord_message` always passes through the **confirm gate** first.
- Everything runs locally against your own bot; no third-party server is involved.
