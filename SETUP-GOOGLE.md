# Connecting Google (Calendar + Gmail) — one-time setup

Milestone 3 gives Zenith real Calendar + Gmail tools. They use **direct Google API client libs
with Desktop-app OAuth** — you create a Google Cloud OAuth client once, paste the id/secret into
`backend/.env`, then click **Connect Google** in the HUD. Tokens are stored locally (gitignored),
keyed by account, and auto-refresh.

You only do this once. Budget ~10 minutes.

---

## 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/>.
2. Top bar → project dropdown → **New Project** → name it (e.g. `zenith`) → **Create**.
3. Make sure that project is selected for the rest of these steps.

## 2. Enable the APIs
APIs & Services → **Library**, then enable both:
- **Google Calendar API**
- **Gmail API**

(Search each by name → **Enable**.)

## 3. Configure the OAuth consent screen
APIs & Services → **OAuth consent screen**:
1. **User type: External** → Create. (Internal is only for Google Workspace orgs.)
2. Fill the required fields (app name `Zenith`, your email for support + developer contact). Logo/links optional.
3. **Scopes:** you can leave this blank here — Zenith requests its scopes at connect time. (For
   reference, the least-privilege scopes are `calendar.events`, `gmail.readonly`, `gmail.send`.)
4. **Publishing status → set the app to "Production"** (Publish app → Confirm).
   - **Why this matters:** a *Testing* app expires its refresh tokens after **7 days**, so Zenith
     would silently disconnect every week. **Production** tokens are long-lived.
   - It will say "unverified". That's **fine for you as the sole user** — Google verification is only
     needed if you ship the app to others. At connect time you'll see a warning screen → click
     **Advanced → Go to Zenith (unsafe)** → continue. (It's your own app.)

## 4. Create the OAuth client (Desktop app)
APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID**:
1. **Application type: Desktop app** → name it (e.g. `zenith-desktop`) → **Create**.
   - Desktop clients allow the loopback redirect Zenith uses (`http://localhost:<random-port>`), so
     there's nothing to configure for redirect URIs.
2. Copy the **Client ID** and **Client secret** (download the JSON if you like — you only need those two values).

## 5. Put the keys in `backend/.env`
Add these lines to `backend/.env` (create it from `backend/.env.example` if needed). `.env` is
gitignored — your secrets never leave the machine.

```dotenv
# Google (Calendar + Gmail) — from the Desktop OAuth client above
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx

# Weather for the morning briefing — free key from https://openweathermap.org/api
WEATHER_API_KEY=xxxxxxxx
WEATHER_DEFAULT_LOCATION=Hyderabad,IN
```

- **Weather key:** sign up at <https://openweathermap.org/>, then **API keys** → copy the default key.
  A new key can take a few minutes to activate. `WEATHER_DEFAULT_LOCATION` is `City,CountryCode`.

## 6. Connect
1. Start the backend (`uvicorn main:app --reload --port 8000`) and frontend (`npm run dev`, on `:3000`).
2. In the HUD's **Connections** panel, click **Connect Google**.
3. Your browser opens the Google consent screen → pick your account → (Advanced → continue past the
   unverified warning) → **Allow**.
4. The panel shows your account and the orb's **Gmail + Calendar** nodes light up. Done.

Now try: *"What's on my calendar today?"*, *"Any unread emails?"*, *"Schedule a call tomorrow at 4pm"*
(confirm the card), *"Email Rahul I'm running late"* (confirm), and *"Good morning"* for the briefing.

---

## Troubleshooting
- **"Google OAuth not configured"** when you click Connect → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  aren't in `backend/.env`, or the backend wasn't restarted after adding them.
- **Reconnect needed** appears later → the refresh token was revoked/expired (often because the consent
  screen is still in *Testing*). Set it to **Production** (step 3.4) and click Connect again.
- **Weather says "set WEATHER_API_KEY"** → key missing in `.env`, or a brand-new key that hasn't
  activated yet (wait a few minutes).
- **Browser didn't open on Connect** → the flow runs on the backend host; open the URL printed in the
  backend log manually, or check that a default browser is set.
- Tokens live in `backend/tokens/<email>.json` (gitignored). Delete a file (or click **Disconnect**)
  to fully unlink an account.

## Privacy / scope notes
- Zenith requests **only** calendar read+create, Gmail read, and Gmail send — no contacts, no drive,
  no delete-mail. Action tools (create/update/delete event, send email) always pass through the
  confirm gate before anything happens.
- Everything runs locally against your own Google account; no third-party server is involved.
