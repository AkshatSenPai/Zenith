# Setup — Web search (Tavily)

Zenith can search the live web via a `web_search` tool backed by **Tavily** (a search API built for AI
agents). It's one API key, ~2 minutes.

Without a key, Zenith simply says web search isn't configured and everything else keeps working.

---

## Steps

1. Go to **https://app.tavily.com/** and sign up (any email — no work-domain wall).
2. Copy your **API key** (starts with `tvly-`).
3. Add it to **`backend/.env`**:

   ```
   TAVILY_API_KEY=tvly-your-key-here
   ```

   (Also add `TAVILY_API_KEY=` to `backend/.env.example` for documentation, if you like.)
4. **Restart the backend** so it picks up the new env var.

That's it.

---

## Using it

Just ask, by voice or text:

- "**Search the web for** the latest Meta ads pricing"
- "**Look up** what's new in Next.js 15"
- "**Google** the GST rate on digital services in India"
- "What's the **current** USD to INR rate?"

Zenith returns a short summary plus source links, and the search shows up in the Activity Log.

## Notes

- **Free tier:** Tavily's free plan includes a monthly query allowance — plenty for personal use. Check
  your usage in the Tavily dashboard.
- **Untrusted by design:** web results are treated as untrusted data (fenced), so a malicious page
  can't make Zenith take actions — the same guard used for email/Notion.
- **Search only (for now):** it searches and summarizes. A "read/summarize this exact URL" tool is a
  planned follow-up.
- **Troubleshooting:** if it says "Web search isn't configured", the key isn't in `backend/.env` or the
  backend wasn't restarted. If searches error, check the key is valid and you have quota left.
