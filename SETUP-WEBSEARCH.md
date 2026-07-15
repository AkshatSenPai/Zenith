# Setup — Web search (Tavily)

Zenith can search the live web via a `web_search` tool **and read a specific page** via a `read_url`
tool, both backed by **Tavily** (a search API built for AI agents). It's one API key, ~2 minutes — the
same key powers both tools.

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

**Read a specific page** (paste or name a URL):

- "**Read** https://example.com/post and summarize it"
- "**What does this say** — <link>"
- "**Open** that blog post and pull out the key points"

Zenith fetches the page's cleaned text (via `read_url`) so it can summarize or answer questions about
it. Long pages are truncated to keep replies fast.

## Notes

- **Free tier:** Tavily's free plan includes a monthly query allowance — plenty for personal use. Check
  your usage in the Tavily dashboard.
- **Untrusted by design:** web results are treated as untrusted data (fenced), so a malicious page
  can't make Zenith take actions — the same guard used for email/Notion.
- **Read a URL:** the `read_url` tool fetches one page's content (Tavily Extract) so Zenith can
  summarize or answer questions about a link you give it. Same key, no extra setup.
- **Troubleshooting:** if it says "Web search isn't configured", the key isn't in `backend/.env` or the
  backend wasn't restarted. If searches error, check the key is valid and you have quota left.
