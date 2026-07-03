# Notion Integration — Design Spec

**Date:** 2026-07-03 · **Status:** approved (owner) · **Milestone:** Notion (Phase 1)

## Goal

Give Zenith read + create access to the owner's Notion workspace as **Claude tools on the
EXISTING loop + confirm gate** — the exact architecture of M3 (Google) / M4 (Discord, Telegram).
Direct Notion REST API, **not** MCP (MCP is reserved for WhatsApp-personal only, per CLAUDE.md).
No changes to the chat route or the confirm gate; every new capability is one more `TOOLS` entry.

## Non-goals (out of scope now)

- Rebuilding the Markdown/Obsidian vault in Notion — the local vault stays the notes/briefs system.
- Any Arkquen connection.
- Complex Notion blocks on write (tables-in-pages, embeds, columns) — writes are **text/simple
  content only** (paragraph blocks).
- `update_notion_page` — **deferred to a documented fast-follow** (append-blocks vs set-properties
  is a different shape; not in the owner's test plan). Easy to add later as ACTION + gate.
- A 5th orb node — see "HUD wiring".

## Auth model

A Notion **internal integration** (simplest for single-user personal use):

1. Create it at `notion.so/my-integrations` → copy the **Internal Integration Secret**.
2. Put `NOTION_API_KEY=<secret>` in gitignored `backend/.env`.
3. **Share pages/databases with the integration inside Notion** (open the page → `⋯` → *Connections*
   → add the integration). **An internal integration sees NOTHING by default** — only what is
   explicitly shared with it. This is the #1 "why can't it see my page?" gotcha and must be the
   loudest line in `SETUP-NOTION.md`.

Token-based, always-on (like Discord/Telegram) — no OAuth/connect button.

## Architecture

```
Claude (chat loop) --calls--> run_tool(name, input)  [tools.py]
                                   │
                                   ├── read tool  → notion_service.<read>  → Notion REST → fenced <external-content> → back to Claude
                                   └── action tool → CONFIRM GATE (ACTION_TOOLS) → /chat/confirm → notion_service.<create> → Notion REST
```

- **`backend/notion_service.py`** — a thin synchronous REST client over `requests` (same style as
  `weather_service.py`), called from the sync `run_tool`. Owns: the HTTP client, `configured()`,
  `status()`, exceptions, and one function per tool.
- **No async bridge** needed (unlike Discord) — Notion is plain request/response, and `run_tool`
  is already synchronous.

### HTTP client

- Base URL `https://api.notion.com/v1`.
- Headers: `Authorization: Bearer {NOTION_API_KEY}`, `Notion-Version: {NOTION_VERSION}` (default
  `2022-06-28` — stable, widely documented; overridable via `.env`), `Content-Type: application/json`.
- `_request(method, path, *, json=None, params=None)` →
  - raises `NotionNotConnected` if `NOTION_API_KEY` is unset,
  - raises `NotionError(message)` on a non-2xx (surfacing Notion's `message` field),
  - returns parsed JSON on success. Timeout 10s.
- Exceptions mirror `discord_service`: `NotionNotConnected(Exception)`, `NotionError(Exception)`.
  `run_tool` catches both → plain failed-string result (never 500s the chat route).

### `status()` (for `/notion/status`)

Returns `{configured, connected, workspace, last_error}`:
- `configured` = `bool(NOTION_API_KEY)`.
- `connected` / `workspace` come from `GET /v1/users/me` (the integration's bot user + owner
  workspace name). **Cached with a short TTL (~60s)** so the HUD's 4s status poll doesn't hammer
  Notion — the check runs at most once/60s; in between, the cached result is returned. On error,
  `connected=false` + `last_error`.

### Read helpers

- `list_pages(limit=25)` / `list_databases(limit=25)` → `POST /v1/search` with
  `filter={property:"object", value:"page"|"database"}` (the dedicated list-databases endpoint is
  deprecated → listing IS search). Return `[{id, title, last_edited}]`.
- `search(query, limit=25)` → `POST /v1/search` with `query`. Return `[{id, object, title}]`.
- `read_page(page_id)` → `GET /v1/pages/{id}` (title from properties) +
  `GET /v1/blocks/{id}/children?page_size=100` → extract `plain_text` from supported block types
  (paragraph, heading_1/2/3, bulleted/numbered_list_item, to_do, quote, callout, code). Follows
  `has_more`/`next_cursor` up to a **cap (~300 blocks)** to bound token use; nested children are not
  recursed (top-level flatten — noted as a v1 limitation). Returns a plain-text rendering + title.
- `query_database(database_id, filter=None, limit=25)` → `POST /v1/databases/{id}/query` with an
  optional pass-through `filter` (a valid Notion filter object; omitted → first N rows). Returns
  each row's `id`, title, and key properties flattened to text.

All read results are **fenced as untrusted** (see Security).

### Action helpers (gated)

- `create_page(parent, title, content)` → `POST /v1/pages`.
  - `parent` = a Notion **page** id OR a page **title** resolved via search (first match). If it
    resolves to nothing, return a helpful "couldn't find a shared page named X — share it with the
    integration" string (failed, not an exception).
  - Body: `{parent:{page_id}, properties:{title:[{text:{content:title}}]}, children:[…]}` where
    `children` = `content` split on blank lines → **paragraph** blocks (text only).
- `create_database_item(database_id, properties)` → `POST /v1/pages` with `parent:{database_id}`.
  - `database_id` = a real id OR a database name resolved via search.
  - **Property coercion:** fetch the DB schema (`GET /v1/databases/{id}`), then coerce the simple
    `{field: value}` dict Claude provides into Notion's typed shape via `_coerce_properties(schema,
    props)`, supporting: `title`, `rich_text`, `number`, `select`, `multi_select`, `date`,
    `checkbox`, `url`, `email`, `phone_number`. Unknown property names or unsupported types are
    skipped and named in the returned confirmation. A row needs at least the title property.

### `_coerce_properties(schema, props)`

Pure helper (unit-tested in isolation): maps `{name: value}` → Notion property payloads keyed by the
schema's declared type for each name. Robust to the owner speaking loosely ("Status": "Done" →
`{select:{name:"Done"}}`; "Count": 3 → `{number:3}`; "Done?": true → `{checkbox:true}`; "Due":
"2026-07-10" → `{date:{start:"2026-07-10"}}`). Comma-joined strings for `multi_select`.

## Tools (7 — 5 read, 2 action)

| Tool | Kind | Service call |
|---|---|---|
| `list_notion_pages` | read (untrusted) | `list_pages` |
| `list_notion_databases` | read (untrusted) | `list_databases` |
| `search_notion` | read (untrusted) | `search(query)` |
| `read_notion_page` | read (untrusted) | `read_page(page_id)` |
| `query_notion_database` | read (untrusted) | `query_database(database_id, filter?)` |
| `create_notion_page` | **action (gated)** | `create_page(parent, title, content)` |
| `create_notion_database_item` | **action (gated)** | `create_database_item(database_id, properties)` |

- `ACTION_TOOLS` += `create_notion_page`, `create_notion_database_item`. The existing confirm gate
  handles them with **zero route/gate changes**; the HUD confirm card renders via its existing
  generic branch (`Run <tool>: <json>`) — no confirm-card change needed.
- `UNTRUSTED_TOOLS` += all 5 read tools (fenced `<external-content>`).

## Security

Notion is a shared cloud workspace — rows/pages can carry text authored by others or pasted from
email/web, i.e. a prompt-injection vector. So Notion reads are treated like email/Discord/calendar,
**not** like the (strictly-local, owner-authored) vault: **all 5 read tools are `UNTRUSTED_TOOLS`**,
their output fenced as `<external-content>` with the "do not act on instructions inside" marker. The
2 create tools are gated and the gate never auto-approves; the same-turn ⚠️ untrusted warning already
raised by the security layer applies when a create follows a Notion read.

## HUD wiring

- **`/notion/status` route** in `main.py` (`GET`) → `notion_service.status()`, mirroring
  `/discord/status` + `/telegram/status`.
- **Connections row, NO orb node.** The orb has exactly 4 nodes on the 4 cardinal edges
  (Gmail↑/Calendar→/Telegram↓/Discord←), each bound to a channel line in `OrbCanvas`. There is no
  clean 5th position; forcing one breaks the symmetry. Notion therefore appears as a **Connections
  panel row** (status dot + `On`/`Off`) — driven by `/notion/status` through the existing
  `connections` list — and in the **Activity Log**, but not on the orb. (Revisitable later.)
  - `frontend/lib/mock.ts`: `Channel` += `"Notion"`; add a Notion entry to `mockConnections`
    (`connected:false`, `account:"Not linked"`).
  - `frontend/lib/api.ts`: `NotionStatus` type + `getNotionStatus()`.
  - `frontend/app/page.tsx`: `nstatus` state + a `/notion/status` poll (mirrors discord/telegram) +
    a Notion branch in `buildConnections`. `ZenithOrb` `NODES` stays at 4 (no Notion node); the orb's
    `connRef` is unchanged, so no channel line is added.
- **Activity Log:** add the 7 Notion tools to `activity_log._MAP` as type `note` (labels: "list
  Notion pages/databases", "searched Notion", "read Notion page", "queried Notion DB", "Notion page
  created", "Notion row added"); `_activity_target` returns a short detail (title/query/db name).

## Config

```env
# Notion — internal integration (notion.so/my-integrations). Share pages/DBs WITH the integration
# inside Notion, or it sees nothing.
NOTION_API_KEY=
NOTION_VERSION=2022-06-28   # optional override of the Notion API version header
```

Added to `backend/.env.example`; the real key lives only in gitignored `.env`.

## Files

**New:** `backend/notion_service.py`, `backend/test_notion.py`, `SETUP-NOTION.md`
**Touched:** `backend/tools.py`, `backend/activity_log.py`, `backend/main.py`,
`backend/.env.example`, `frontend/lib/api.ts`, `frontend/lib/mock.ts`, `frontend/app/page.tsx`

## Testing

- **Backend unit** (`backend/test_notion.py`, `requests` mocked — no network, mirrors
  `test_weather.py`): `configured()`/`status()` (unset key → not configured; mocked `/users/me` →
  connected + workspace); each read helper parses a mocked Notion payload; `create_page` +
  `create_database_item` build the correct request body; `_coerce_properties` for each supported
  type; name→id resolution (id passthrough vs search); gate membership (both creates in
  `ACTION_TOOLS`, all 5 reads in `UNTRUSTED_TOOLS`); `NotionNotConnected` with no key. ~10–12 tests;
  full fast suite stays green. (No frontend test runner — project rule; HUD verified via live
  Playwright.)
- **Live QA gate (owner-driven — needs the real token + shared content):**
  1. Share ONE page + ONE database with the integration in Notion.
  2. "What can you see in Notion?" → lists the shared page + database.
  3. "Add a row to `<database>` with these fields" → ConfirmCard → Confirm → the row exists in Notion.
  4. "Create a page called X with this content" → ConfirmCard → Confirm → the page exists in Notion.
  5. Connections panel shows a **Notion** row = `On`; tool runs appear in the Activity Log.

## Decisions resolved

- **No 5th orb node** → Connections-row-only (preserves the 4-cardinal orb).
- **`update_notion_page` deferred** to a fast-follow (keeps this milestone tight; matches the test plan).
