# Connecting Telegram — a phone remote for Zenith (one-time setup)

Milestone 4 adds a **Telegram remote**: message a bot from your phone and it runs through the *same*
Zenith brain as the HUD (Claude + history + tools + the confirm gate), replying on Telegram. Action
tools (send email, create event, post to Discord…) come back as **[✅ Confirm] [✖ Cancel]** buttons.

Official **Bot API** — zero ban risk (unlike the WhatsApp bridge, which is parked). Budget ~3 minutes.

> **🔒 Security — this bot is locked to YOU.** It can read your mail/calendar and send things, so it
> only answers Telegram user ids in `TELEGRAM_ALLOWED_USER_IDS`. Everyone else is **ignored + logged**.
> If the allow-list is empty it rejects **everyone** (fail-closed). Never share the bot or leave the
> list blank-but-running expecting it to work.

---

## 1. Create the bot
1. In Telegram, open **@BotFather** → send `/newbot`.
2. Give it a name and a username (must end in `bot`).
3. BotFather replies with a **token** like `123456789:AA...`. Copy it.

## 2. Get your numeric user id
Open **@userinfobot** in Telegram → send anything → it replies with your **Id** (a number like
`123456789`). That's *your account id*, not the bot's.

## 3. Add both to `backend/.env`
```dotenv
# Telegram remote (locked to your user id)
TELEGRAM_BOT_TOKEN=123456789:AA...
TELEGRAM_ALLOWED_USER_IDS=123456789        # comma-separate to allow a few people: 111,222
```
`.env` is gitignored. **Treat the token like a password.**

## 4. Restart + test
1. Restart the backend (`uvicorn main:app --reload --port 8010`). Watch for
   `[telegram] polling as @YourBot (1 allowed id(s))`.
2. In the HUD, the orb's **Telegram** node (bottom, where WhatsApp used to be) lights up and the
   Connections row shows `@YourBot`.
3. From your phone, open your bot and send **"hi"** → Zenith replies.

Try:
- "What's on my calendar today?" → real events.
- "Email Rahul I'm running late" → `[✅ Confirm] [✖ Cancel]` → tap **Confirm** → it sends, and the
  confirmation comes back on Telegram.

---

## Troubleshooting
- **Telegram node stays "Bot offline"** → check the backend log. No token logs
  `TELEGRAM_BOT_TOKEN not set`; a bad token logs `[telegram] start failed: ...`.
- **Bot ignores you** → your id isn't in `TELEGRAM_ALLOWED_USER_IDS` (check @userinfobot again), or
  the list is empty (fail-closed). The log prints `IGNORED message from unauthorized id=...`.
- **No reply at all** → long-polling needs outbound internet from the backend host; no inbound/public
  URL is required (we don't use webhooks).
- **Buttons say "That action expired"** → the backend restarted (pending actions are in-memory). Send
  the request again.

## Notes / scope
- **Long-polling** (`getUpdates`), not webhooks — the backend runs locally behind NAT, no public host.
- Telegram is **not a tool**; it's a chat ingress sharing the brain. It gets its **own** last-20
  history (separate from the HUD), the **same** rate limit / token budget, and its tool runs show in
  the HUD **Activity Log**.
- Out of scope for now (future): voice notes, proactive push from Zenith, webhooks, anyone but you.
