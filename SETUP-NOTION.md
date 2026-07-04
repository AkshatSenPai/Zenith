# Zenith — Notion setup

Zenith talks to Notion through an **internal integration** (a personal API token). Direct Notion
REST API — no MCP.

## 1. Create the integration
1. Go to https://www.notion.so/my-integrations → **New integration**.
2. Name it "Zenith", pick your workspace, keep the default capabilities (Read/Insert/Update content).
3. Copy the **Internal Integration Secret** (starts with `ntn_` / `secret_`).

## 2. Add the key
In `backend/.env`:
```
NOTION_API_KEY=ntn_your_secret_here
# NOTION_VERSION=2022-06-28   # optional
```
Restart the backend.

## 3. ⚠️ SHARE pages/databases with the integration (the #1 gotcha)
An internal integration sees **NOTHING by default** — only what you explicitly share with it.
For every page or database Zenith should see:
1. Open it in Notion.
2. Click the **⋯** menu (top-right) → **Connections** → **Connect to** → pick **Zenith**.
3. Sharing a page shares its child pages; sharing a database shares its rows.

If Zenith says "no pages are shared" or "couldn't find that page", this step is why.

## 4. Verify
- Connections panel shows a **Notion** row = **On** (workspace name).
- "What can you see in Notion?" → lists the shared page(s) + database(s).
- "Add a row to <database> …" → confirm card → Confirm → the row appears in Notion.
- "Create a page called X …" → confirm card → Confirm → the page appears in Notion.

## Notes
- Writes are text/simple content only (no tables-in-pages/embeds yet).
- Database rows: give field names that match the database's columns (case-insensitive); unmatched
  fields are skipped and named back to you.
