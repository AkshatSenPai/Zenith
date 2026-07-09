# ZENITH — Product Requirements Document (PRD)
## Version 2.5 | July 2026
### Product: Zenith  ·  Wake word: "Zenith"  ·  Repo codename: JARVIS

> **What changed in v2.5 (App Launcher — SHIPPED 2026-07-09):** Zenith can now **open things**: "open Chrome", "open WhatsApp", "open my projects folder", "what can you open?" — **2 tools** (`open_app`, `list_apps`) on the EXISTING loop, zero route changes. The security model is the feature: **whitelist only.** The tool argument is always a *name to look up* in the owner's `backend/apps.json` (gitignored; `apps.example.json` is the committed template and fallback; `ZENITH_APPS_PATH` overrides the location; read fresh each call so edits need no restart) — Zenith **never** executes an arbitrary path or command a caller supplies, and there is deliberately **no shell escape hatch**. Name matching is stdlib-only (normalize → exact name/alias → substring → `difflib` fuzzy) and **refuses, listing what it *can* open, rather than guessing** on an unknown or ambiguous name. Five target kinds: `url`, `path` (ShellExecute — an app's Start-Menu `.lnk` is the robust, version-independent way to launch it), `protocol`, `command` (`shutil.which`), and `uwp` for Windows Store apps launched by **AppUserModelID** via `explorer.exe shell:AppsFolder\<AppID>` (find it with `Get-StartApps`). Prompt-injection is handled by a new **`GATE_IF_UNTRUSTED`** set rather than new gate code: `open_app` runs immediately on a normal turn, but if the **same turn already pulled untrusted `<external-content>`** into context (an email, a Discord message), it degrades into a confirm-gated pending action with the ⚠️ warning — so "Zenith, open X" buried in an email can't auto-launch. It reuses `run_loop`'s existing `saw_untrusted` flag; `open_app` is in neither `ACTION_TOOLS` nor `UNTRUSTED_TOOLS`. Successful launches land in the Activity Log (type `note`); `list_apps` is unlogged. **Explicitly out of scope:** Computer Use / screenshots / clicking / typing, arbitrary commands or shell access, and closing/killing apps or window management. Setup: `SETUP-APPS.md`. Gates: **+34 tests (197 backend green), all five target kinds live-verified.**

> **What changed in v2.4 (Notion integration + two app fixes — SHIPPED to main 2026-07-05):** **Notion** joins the assistant as **18 Claude tools on the EXISTING loop + confirm gate** (direct Notion REST API, NOT MCP — same M3/M4 pattern, zero route/gate changes). Read/query pages + databases, **create** pages (with rich blocks: headings, checklists, paragraphs) + database rows, **edit/append/delete** page content, **update/archive** (soft-delete → Notion trash) pages, **describe/create/alter** database structure, and **read/add page comments**. Every write/edit/delete flows through the confirm card; reads that carry Notion content are fenced as `<external-content>`. The client speaks Notion's **2025-09-03 data-source model**, so **multi-data-source databases work** (the old `2022-06-28` API 400'd on them) — live iteration surfaced three things the docs miss: `/search` filters by `"data_source"` not `"database"`, column edits target `PATCH /data_sources/{id}` (a DB-level PATCH silently no-ops), and search/list return *data-source* ids while URL ids are *database* ids (so `_data_source_id` resolves either). Auth = an **internal-integration token** (`NOTION_API_KEY`); pages/DBs must be **shared with the integration** inside Notion or it sees nothing (`SETUP-NOTION.md`). Comment tools 403 until the token's Read/Insert-comments capability is enabled. **All 18 tools live-verified against the real workspace.** Two app fixes rode along: (1) after a confirmed gated action the HUD now **speaks the result** (it only wrote it silently before — you couldn't tell it finished if the tab wasn't focused); (2) the **daily token kill-switch was raised 300k → 500k**, now env-overridable via `ZENITH_DAILY_TOKEN_BUDGET`. Gates: **161 backend tests green, tsc clean.**

> **What changed in v2.3 (v7 HUD redesign + 2D-canvas orb port — SHIPPED to main 2026-07-03):** The HUD got a full **v7 reskin** — an icon nav rail, a **⌘K command palette**, dedicated **Memory / Notes / Clients** views, a month ruler, a redesigned boot screen, and a **persisted reduced-motion toggle** (`lib/prefs.ts`). The center orb was **rebuilt as a 2D-`<canvas>` port of the owner's HUD mock** (`OrbCanvas.tsx`) — one renderer, three per-skin styles keyed by `--orb-mode`: Arc **sphere** (Fibonacci particle sphere + EQ halo + radar sweep), Ghost **mesh** (ink wireframe web), Amethyst **nebula** (volumetric cloud + rotating ellipses). **The react-three-fiber / three.js WebGL stack was uninstalled and `OrbScene.tsx` deleted** — no WebGL context remains in the HUD, so the old dispose-on-view-switch leak class is gone by construction. Two earlier orb laws were **retired with owner sign-off**: speaking on Arc now warms to **orange `255,169,77`**, and **2 rotating gap rings** are shared by all skins. A drifting **constellation ambient background** sits behind opaque rails, and the Command Center no longer presses the viewport bottom on a long reply. A post-merge `/review` then fixed **7 findings** (stuck-mic on Space-release-in-a-field, confirm-card restore on a network hiccup, a mislabelled voice error, three 60fps-canvas perf wins, stale comments); the security sweep was clean. Gates: **130 backend tests green, tsc clean, cross-skin live-verified**. *(The top-of-file changelog jumps v1.9 → v2.3; the intervening v2.0–v2.2 work — M5 polish, memory vault, Copy Factory — is logged in the footer.)*

> **What changed in v1.9 (security hardening — SHIPPED 2026-06-26, live-verified):** Milestone 5, part 1 (`SECURITY.md` priority order). A **backend API token** — every FastAPI route except `GET /` and `GET /health` now requires an `X-Zenith-Token` header (`backend/auth.py`; **fail-open + loud boot warning when unset**, strict **401** when set), and a single frontend **`apiFetch`** wrapper (`lib/api.ts`) attaches it on every call. A **prompt-injection guard** — read-tool results carrying third-party content (email / Discord / calendar / briefing) are fenced as `<external-content>`, the system prompt forbids acting on instructions inside them, and a **same-turn** untrusted flag raises a ⚠️ warning on the HUD confirm card **and** the Telegram confirm buttons (the gate still never auto-approves). **Secrets restricted at rest** (`secure_files.harden()` → `icacls` on Windows / `chmod 600` on POSIX for `.env` + `tokens/` at boot). The **rate limiter was verified thread-safe** (+ concurrency tests). **Logs scrubbed** behind `ZENITH_DEBUG_LOGS` (default: tool name + ok/failed, no bodies/recipients). Fixed a **`.gitignore` inline-comment bug** that had left `backend/tokens/` (live OAuth tokens) un-ignored — verified they were never committed. **+23 tests**; live-verified (auth 401/200, real `/chat`, HUD). The Telegram/Discord bots are unaffected (they call `chat_core` in-process, not over HTTP). Full posture + rotation steps in `SECURITY.md`. **Still open in M5:** settings page + usage/cost dashboard + README.

> **What changed in v1.8 (skins / themes — SHIPPED 2026-06-25):** A switchable **skin system**. The whole palette is tokenized into **CSS variables** selected by a `data-skin` attribute on `<html>` (Tailwind colors become `rgb(var(--..)/<alpha>)` so every utility class auto-themes; the WebGL orb reads its colors / bloom / particle-count / mode from the same vars). Three skins: **Arc** (today's cyan — default, unchanged, pixel-identical), **Ghost** (light **paper `#F7F7F5` + graphite ink** — NOT the old dark-mono; glow/bloom killed so depth comes from a hairline + soft shadow, square corners, calmer motion, a **centered-focus layout** that hides the dashboard side-columns, and the orb flips to an **ink-network web** mode; one muted amber kept for alerts), **Amethyst** (violet `#B26BFF`; **rounded-glass** cards + a **bento layout** — orb as a 2×2 hero tile, panels as tiles, a slim full-width command bar). A skin = colors + treatment knobs (`--glow-strength`, `--panel-tint`, `--border-strength`, `--notch`/`--radius`, `--motion-scale`, `--bloom`, `--particle-count`, `--orb-mode`/`--orb-link-*`). Picked from the **Settings** view (`SkinPicker`); switching uses a brief **blur-mask crossfade** (~200ms, emil-design-eng) + a no-flash `<head>` script so there's no color flash on load. Built with the **Impeccable** plugin (design QA) + taste / minimalist / emil. Spec + 10-task plan: `docs/superpowers/{specs,plans}/2026-06-22-zenith-skins*.md`. **Shipped: Tasks 1–10 as atomic commits on `main` (`9e3b7b7..`); cross-skin QA passed — HUD + boot screenshotted per skin, no WebGL leak on the orb sphere↔network switch, reduced-motion honored.** Deferred polish: Ghost ink-web slightly dense in the centre; Amethyst command bar centered `max-w-2xl`.

> **What changed in v1.7 (voice → GPU + HUD motion):** Both heavy voice models moved off the CPU onto the **RTX 5060**: torch reinstalled as the **cu128** (Blackwell sm_120) build, **Kokoro TTS on `cuda`**, and **Whisper STT on `cuda`** (`medium`/`float16` via `nvidia-cudnn-cu12` / `nvidia-cublas-cu12`). A paragraph's TTS dropped **~17.6s → ~1.3s** and STT to ~1.1s, freeing the CPU — fixing both the reply-lag and the "PC lags when speaking" (CPU synthesis had been pegging the cores). Both engines now get a **boot-time inference warmup** so the first call of a session isn't a one-time ~17-30s cuDNN cold-start. Device is `.env`-driven (the code default stays CPU; `.env` is gitignored). The 8GB card is shared with the orb's WebGL, so **`medium` was chosen over `large-v3`**; verify on `/health` (`device==cuda`, `fallback==false`). Also: a **GSAP** HUD pass (cinematic boot screen + animated status-label transitions).

> **What changed in v1.6 (local voice — Kokoro default):** **Kokoro** (hexgrad/Kokoro-82M) became the **local/offline TTS engine** (`ZENITH_TTS_ENGINE=kokoro`, default voice `af_heart`, English), with **edge-tts kept as a one-flag fallback**. `synthesize()` dispatches by engine and returns `(bytes, media_type)` — edge→MP3, Kokoro→WAV — so `/speak` and the frontend serve either unchanged. Required moving the backend venv to **Python 3.11** (Kokoro's spacy/blis ship no 3.14 wheels).

> **What changed in v1.5 (orb direction + voice fix):** The orb is being rebuilt as a **glowing particle sphere** (react-three-fiber / WebGL + Bloom, ~40-60k cyan particles, audio-reactive core) — this **supersedes the reactive-mesh orb and the queued mesh-refinement**; the 4 connection nodes stay as labelled anchors around the sphere. STT now **defaults to English** (`WHISPER_LANGUAGE=en`) for speed + accuracy, with the **Hinglish / romanisation path kept dormant behind the flag** (not deleted — still the Phase-2 differentiator). Recommended desktop config: **`large-v3` on `cuda`/`float16`**, and the **silent CUDA->CPU fallback is now made visible** (startup log + active device/model on `/usage` or a new `/health`) — that silent fallback was the real cause of the ~20s latency. TTS stays **edge-tts** (English voices Neerja/Prabhat); **Kokoro** logged as a future offline-TTS option.

> **What changed in v1.4 (HUD build pass — implements the v1.3 direction):** The app-style HUD is now **built** in the frontend. The orb became a **reactive connection-mesh** (a glowing core + a mesh of nodes that react to live audio; 4 states). The chat input + mic + send were **merged into one Command Center** (`CommandCenter.tsx`), and the side rails/panels were filled in — `ContextRail`, `LeftRailExtras`, `QuickActions`, `FocusCard`, `ConnectionsPanel`, `ActivityLog`, `PlaceholderView`. Since v1.2, the single `CommsPanel` was split into `ConnectionsPanel` + `ActivityLog`, and the standalone `WaveformBar` was removed (the orb is now the voice visualizer). Backend got a voice-robustness fix: empty/undecodable mic clips are treated as **no-speech** (no more 500s). Panels still render `lib/mock.ts`; **no Tauri shell yet**. An orb/HUD **visual redesign is queued** (`TODO.md`): calmer mesh, core-breathing + inward edge-flow reaction, drop the concentric/orbital rings, stay cyan, and a Command-Center minimize/restore control.

> **What changed in v1.3 (this session — UI rethink, business context, scope):** UI art direction switched from film stills to clean **app-style dashboards** — the center orb becomes a **live connection-map**, plus a paginated monospace chat surface with a left context-rail, a **Connections list**, an **Activity log**, a **first-class confirm card**, fake telemetry **cut** (only the real `/usage` gauge kept), and the whole UI **de-Marvel'd** (Zenith's own naming; JARVIS internal only). Added the owner's **business context** (Arkquen — out of scope; ShapeOdyssey — agency) and a **Copy Factory / Template Studio** capability. **Pulled the personally-useful "future" features into Phase 1** (Copy Factory, Memory vault, Proactivity + WhatsApp triage); true SaaS machinery stays Phase 2. Added a Differentiation / moat + "don't build" section. Memory layer is now a **Markdown vault**, not Postgres.

> **What changed in v1.2 (Milestone 2 voice pass, from live testing):** TTS switched from browser SpeechSynthesis to **edge-tts neural voices** served by the backend at `POST /speak` (MP3, browser-independent); STT now **romanises Hindi to Latin script** (auto-detect, re-force Hindi off Urdu drift, VAD + beam tuning, CUDA→CPU fallback); replies render as markdown with **emojis stripped** and a no-emoji/Latin-script system prompt; build-order status markers added; system prompt (§9), env vars (§11), and folder structure (§8) reconciled with the actual code. Milestone 1 ("The Brain") and the voice in/out half of Milestone 2 are now built.

> **What changed in v1.1:** product name set to Zenith; architecture switched to Claude tool-use (not MCP-on-everything); delivery defined (Tauri desktop in Phase 1, PWA + optional desktop in Phase 2); speech-to-text moved from Web Speech API to local faster-whisper; added the confirm-gate pattern, the voice round-trip, a weather API for the briefing, a hardened rate-limit kill-switch, and a re-sequenced build order. New sections: Architecture (3) and Key Decisions & Gotchas (15).

---

## 1. PRODUCT VISION

Zenith is a full-stack personal AI assistant for desktop — inspired by Iron Man's JARVIS (which stays the internal repo codename).
Built for freelancers and agency owners who want to automate daily tasks via voice and chat.

- **Wake word:** "Zenith" (simple, one word). Phase-1 activation is push-to-talk (hold space); always-listening wake-word detection is a later add.
- **Phase 1:** Personal daily driver (current goal)
- **Phase 2:** SaaS product for Indian freelancers/agency owners (₹999-2999/month)

**Naming note:** "Zenith" is also used by major brands (LG's Zenith Electronics, Zenith watches/LVMH) and Indian software cos (Zenith Software, Bengaluru; Zenithra Tech, Delhi). Fine for the personal Phase-1 tool — but get a trademark lawyer's sign-off before launching the paid Phase-2 product, and lock a domain (non-.com; verify on porkbun, then trademark-check).

---

## 2. TARGET USER

**Primary User (Phase 1):** The builder himself
- Freelancer + agency owner
- Manages websites, SaaS projects
- Uses VS Code, Claude Code daily
- Needs: schedule management, email, WhatsApp, ad creation, coding help

**The owner's businesses (what Zenith is built around):**
- **Arkquen** (arkquen.com) — a real-estate-focused funnel / CRM / WhatsApp+email automation platform. Currently a **white-labeled subscription the owner resells**, on the way to **building their own**. It runs the *client-facing machine* (funnels, CRM, automated sequences). **Zenith does NOT integrate with Arkquen** — it's a moving target and out of scope.
- **ShapeOdyssey** (shapeodyssey.com) — a digital agency that builds **customer-acquisition systems**: Meta/Google ads + funnels (built in Arkquen) + websites + automation. Team-based.
- **Division of labour:** Arkquen runs the client machine → **Zenith runs *you***: proposals, agreements, ad copy, creative briefs, campaign reporting, website/funnel copy, ad-hoc client comms, and the Copy Factory (§4.9). None of it overlaps Arkquen.
- **Long-game (Phase 2):** the owner works in a team, so Zenith eventually trends toward a *founder's command center over a team*. Phase 1 stays the personal driver.

**Target Market (Phase 2):** Indian freelancers and agency owners
- Age 22-35
- Tools they already use: Gmail, WhatsApp, Google Calendar, Discord
- Pain point: Too many tabs, too much context switching
- Willingness to pay: ₹999-2999/month

---

## 3. ARCHITECTURE — HOW IT WIRES

**Claude is the brain.** The FastAPI backend defines a set of tools; Claude (Sonnet 4.6) decides which to call; FastAPI executes them against the real APIs and returns results. Every new integration is just one more entry in `TOOLS` — the chat route never changes. This replaces the original "Gmail MCP / Calendar MCP / Discord MCP" plan.

- **Tool use, not MCP-everywhere:** use direct API client libraries where an official API is easy (Google Calendar/Gmail, Discord). Use an MCP/bridge only for **personal WhatsApp**, where no official API exists.
- **Confirm gate:** read-only tools (read calendar, read mail) run immediately; action tools (`send_email`, `send_whatsapp`, `create_event`, `delete_*`) return a "pending action" → frontend shows a confirm card → `/chat/confirm` runs it. This is how "confirm before sending/creating" is enforced.
- **Voice round-trip:** mic (MediaRecorder, hold space) → `POST /transcribe` (faster-whisper, local, English default) → `POST /chat` (Claude + last-20 history + rate limit + Hinglish prompt + tools + confirm gate) → reply text (markdown-rendered, emojis stripped) → `POST /speak` (edge-tts neural → MP3) → frontend plays the audio.
- **Delivery:**
  - Phase 1 = Tauri **desktop app**, backend runs locally. No PWA.
  - Phase 2 = host the backend + ship a **PWA-installable** web app (the no-download path) + keep the Tauri desktop app as an optional download. One codebase serves all three.

```
[ User mic ] → Frontend (Tauri + Next.js)
                   │  audio
                   ▼
              FastAPI  /transcribe  → faster-whisper (local, English default)
                   │  transcript
                   ▼
              FastAPI  /chat  → Claude (history · tools · confirm gate)
                   │  reply text (markdown, emoji-stripped)
                   ▼
              FastAPI  /speak  → edge-tts neural → MP3
                   │  audio
                   ▼
              Frontend plays MP3 → [ Speaker ]
```

---

## 4. CORE FEATURES — MVP (Phase 1)

### 4.1 AI Brain
- Model: Claude Sonnet 4.6 API, via **tool use (function calling)**
- Conversation history: last 20 messages maintained (+ a token budget — tool results balloon)
- Language: **English by default** (the owner is comfortable in English). The Hinglish path is kept but **dormant behind `WHISPER_LANGUAGE`** — a Phase-2 differentiator, not deleted.
- Personality: Professional, concise, calls user "Boss" occasionally
- Rate limiting: 5 req/min, 150 msg/day, warn at 120 — enforce a **hard daily kill-switch**, not just a warning

### 4.2 Voice Interface
- Input (STT): **faster-whisper**, local/offline (replaces Web Speech API, which breaks inside the desktop shell). **Defaults to English (`WHISPER_LANGUAGE=en`)** for speed + accuracy — with `en` it skips transliteration entirely. The **Hinglish path is kept but dormant**: set `WHISPER_LANGUAGE=hi`/blank to re-enable auto-detect + **romanise Hindi to Latin** (real words, not translated; re-force off Urdu drift). VAD + `beam_size=5` curb mishears. **Now live on the GPU (v1.7): `medium`/`cuda`/`float16` on the RTX 5060** (~1.1s; `large-v3` skipped for VRAM headroom on the 8GB shared card — drop to `small`/`int8_float16` if it OOMs), with a **boot-time inference warmup** so the first call isn't a ~17s cuDNN cold-start. The CUDA→CPU fallback is safe but must be **logged loudly** — it silently ran on CPU before, which was the real cause of the lag. Configurable via `.env` (`WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE`, `WHISPER_LANGUAGE`); `.env` is gitignored so a fresh clone is CPU until the cu128 torch + nvidia-cudnn/cublas install is re-applied.
- Output (TTS): **edge-tts** neural voices (Microsoft, free / no key), rendered by the backend at `POST /speak` and returned as MP3 the frontend plays — browser-independent. Replaced browser SpeechSynthesis (robotic in some Chromium builds, silent in others). Voice via `ZENITH_TTS_VOICE` (default `en-IN-NeerjaNeural`). Piper (local) remains an option if a fully-offline voice is needed.
- Replies: rendered as markdown (bold/lists/code), with **emojis stripped** before display and before TTS.
- Activation: push-to-talk (hold space). Wake word "Zenith" via a detection engine is a later add.
- Languages: **English default**; occasional Hindi words still transcribe fine. Full Hinglish code-mixing stays available behind the flag for Phase 2 (it's imperfect in every STT engine — that's why it's opt-in now).

### 4.3 Google Calendar Integration
- Read today's and tomorrow's events
- Add new events via natural language (→ `create_event` tool, behind the confirm gate)
- "Kal 3 baje client call add kar" → creates event
- Multiple Google accounts supported

### 4.4 Gmail Integration
- Multiple Gmail accounts (personal + business both)
- Read last 10 unread emails with AI summary
- Draft emails via Zenith command
- Send emails behind the confirm gate

### 4.5 WhatsApp Integration
**Personal WhatsApp:**
- 1 personal number via whatsapp-mcp (open source, local bridge)
- Read messages, send messages, group messaging
- "Bhai ko bol do 8 baje aa raha hoon"
- ⚠️ Unofficial protocol → ToS / ban risk. Don't use a number you can't afford to lose.

**Business WhatsApp (multiple numbers):**
- Multiple business numbers via WhatsApp Cloud API
- Manage all client conversations from one place
- "Client X ke pending messages dikhao"
- New inquiry alerts (polling-based for v1)
- ⚠️ Each number needs WABA registration + verification. Verify Meta's current per-conversation pricing; ship with ONE business number first.

### 4.6 Discord Integration
- Multiple servers supported (via discord.py, direct)
- Read messages, send messages
- Server management basics

### 4.7 Morning Briefing
- Trigger: "Good morning" or "Briefing do"
- Output (voice + text):
  - Today's date, day, weather (needs a Weather API key)
  - Today's top news headlines (world + India, free RSS — no key; `get_news` tool / `NEWS_FEEDS`)
  - All meetings/events today
  - Unread email count + top 3 summaries
  - Pending WhatsApp messages count
  - Top priority reminder
- Delivered on trigger

### 4.8 Settings Panel
- Anthropic API key input (Phase 2 BYO-key needs encryption at rest)
- Google OAuth connect/disconnect (multiple accounts)
- WhatsApp number connect
- Discord server connect
- Voice speed + language preference
- Daily usage + cost dashboard, with the kill-switch cap

### 4.9 Copy Factory / Template Studio  *(pulled into Phase 1 — the owner's highest-value daily job)*
Input = the owner's **existing client intake form** (it already *is* the brief: niche, offer, audience, price, funnel type, merge variables). From one brief, Zenith generates **in the owner's voice**:
- Multi-stage **email sequences** (welcome → nurture → booking → reminder → no-show → re-engage)
- **WhatsApp (WABA) templates** in Meta's `{{1}}` positional format, **tagged by category** (Marketing / Utility / Authentication) to reduce approval rejections
- **Ad copy + creative briefs** (Meta/Google) and **landing-page / funnel copy**
- Output in **English, Hindi, or Hinglish** (Telugu on request), with A/B subject-line + hook variants

Zenith writes the **copy only — the owner pastes it into Arkquen. Nothing is wired to Arkquen.** Tools: `draft_sequence`, `draft_ad_copy`, `draft_landing_copy` (output-only; no send). The same client brief also feeds proposals and pre-call briefs → one input, many outputs ("client copy factory"). (Validated this session against a real client, Shadnagar Heights.)

### 4.10 Memory — Markdown vault (Obsidian-style)  *(replaces Postgres-for-memory)*
A **local Markdown vault** Zenith reads/writes: daily logs, client notes/briefs, meeting notes, decisions. Tools: `search_notes` (read), `save_note` (action). Enables "what did I do last week?", "notes from the Acme call", and **voice-matched drafts** (Zenith learns the owner's writing style from the vault). The vault doubles as the Copy Factory's brief store. Local + private; matches the Phase-1 privacy stance.

### 4.11 Proactivity + message triage  *(pulled into Phase 1)*
Move from reactive (ask → answer) to proactive. A background watcher surfaces *what slipped* as floating HUD status cards: aging unanswered client messages (Gmail/WhatsApp), commitments made ("you said you'd send Rahul the proposal"), today's prep, approaching deadlines. **WhatsApp triage** of the owner's *own* personal + business messages: "who's waiting on a reply?" → drafts replies (confirm-gated). Builds on M3/M4 tools; respects the rate/token cap. (Background scheduler/poller, e.g. APScheduler.)

---

## 5. FUTURE FEATURES (Phase 2 — true SaaS / heavier)

### 5.1 Computer Use (Desktop Control)
- Anthropic Computer Use API (experimental — slow/expensive, treat carefully)
- "Claude Code kholo aur naya chat start karo"
- "Ye PDF kholo aur edit karo"

### 5.2 Higgsfield Integration (Ad/Video Creation)
- YouTube Shorts generation for Papa's channel
- Facebook/Instagram ad videos
- "Mere SaaS ka 30 second ad banao"
- URL-to-video feature

### 5.3 Coding Assistant Mode
- Generate prompts for Claude Code
- SaaS/website task prompts ready-made
- "Ek landing page ka prompt banao with pricing table"

### 5.4 Business-data module (the freelancer command center — heavy)
- A real data layer (DB) for clients, projects, invoices, hours
- Dashboards: revenue, profit, invoices pending, time tracking, upcoming deadlines, Quick Actions (Create Invoice / Send Proposal / Add Task)
- Killer feature: **talk to your business data** — "summarize my month, what should I focus on?" → structured answer
- Time tracking: **integrate** (Toggl/Clockify), don't rebuild. Trend indicators only once history is stored.
- (The lightweight Phase-1 version is just the Markdown vault, §4.10.)

### 5.5 Multi-User (SaaS)
- User authentication (Clerk)
- Each user brings their own API key (store **encrypted at rest**)
- Per-user rate limiting
- Razorpay payment integration
- Hosted backend + **PWA-installable** web app (no-download path) + optional desktop download

> **Note:** "Persistent memory" from earlier drafts is now a **Phase-1 Markdown vault** (§4.10), not a Phase-2 database.

### 5.6 Differentiation / moat & "DON'T BUILD"
**Positioning:** the field splits into pretty JARVIS clones (great UI, no real work) and serious assistants (powerful, no soul). Zenith's lane → *a proactive, Hinglish-speaking, WhatsApp-native assistant that handles the founder's work and acts with a visible trust layer (the confirm gate + activity log).* Aesthetics get attention; that sentence is the reason to pay. The two lead moats are **proactivity** and **WhatsApp triage of your own messages** (both §4.11).

**DON'T BUILD (saturated / non-differentiating — spend zero effort):**
- PC / system monitoring (CPU/GPU/disk/reactor/battery telemetry — cosplay)
- Calendar auto-scheduling à la Motion/Reclaim (just integrate Calendar, don't compete)
- WhatsApp Business customer-chatbots / lead-gen (a different product; saturated in India)
- Smart-home / IoT; more 3D holographic eye-candy

---

## 6. UI DESIGN SPECIFICATION

### Theme — clean app-style HUD (updated v1.3)
Modeled on **app-style HUD dashboards** (the dashboard mockups), NOT the dense film stills. Near-black canvas, one cyan, thin strokes, rounded **notched-corner cards**, generous spacing — **legibility over decoration**. **De-Marvel'd:** Zenith's own naming everywhere — "JARVIS / Stark / J.A.R.V.I.S. Cloud / Pepper" never appear in the UI; JARVIS is the internal codename only.

**Colors:**
- Background: Pure black #000008
- Primary glow: Cyan #00FFE5
- Secondary: Electric blue #0066FF
- Alert/Warning: Orange #FF6B00
- Critical: Red #FF2020
- Text: Cool white #E0F7F7

**Fonts:** *(live for the **Arc** skin only — self-hosted at build via `next/font`, no runtime fetch. Ghost + Amethyst use the **system stack**; a skin opts in by remapping `--font-display`/`--font-body`/`--font-mono` under its `[data-skin]` block.)*
- Display: Space Grotesk
- Body: Inter
- Terminal/Code: JetBrains Mono

### Layout (Desktop)

```
+----------------------------------------------------------------+
|  ZENITH   Fri, 19 Jun 2026      * ONLINE      [usage] [gear]    |  top bar
+---------------+--------------------------+-----------------------+
|  CALENDAR     |                          |  CONNECTIONS          |
|  . 10:00 Mtg  |      ( ZENITH ORB )      |  Gmail      [*] on     |
|  . 14:00 Call |   particle-sphere core   |  Calendar   [*] on     |
|  . 17:00 Rev  |   nodes: Gmail Cal WA Dc  |  WhatsApp   [ ] off    |
|               |   (light up when linked) |  Discord    [ ] off    |
|  TOMORROW     |                          | --------------------- |
|  . 11:00 Demo |   state: listening...    |  ACTIVITY LOG         |
|               |                          |  create_event  OK     |
|  [left rail]  |  +--------------------+  |  email sent    OK     |
|   chat        |  | command center     |  |  rate warn 120/150    |
|   drafts      |  | paginated chat,    |  | --------------------- |
|   clients     |  | monospace, "1/6",  |  |  [ CONFIRM CARD ]     |
|   settings    |  | copy . save . share|  |  Send email to ...?   |
|               |  +--------------------+  |  [Confirm] [Cancel]   |
+---------------+--------------------------+-----------------------+
|  ~~ waveform (voice active) ~~    [ hold SPACE ] [ type... ] [>] |
+----------------------------------------------------------------+
```

### Skins / themes  *(v1.8 — SHIPPED 2026-06-25)*
The palette is tokenized into **CSS variables** keyed by `data-skin` on `<html>` (Tailwind colors → `rgb(var(--..)/<alpha>)`, so utility classes auto-theme; the 2D-canvas orb reads its color + `--orb-mode` from the same vars). Three skins, each = colors **+ treatment knobs** (`--glow-strength`, `--panel-tint`, `--border-strength`, `--notch`/`--radius`, `--motion-scale`, `--orb-mode`, `--amb-grid-a`):
- **Arc** — today's cyan HUD. Default, unchanged (pixel-identical). Notched corners, dense 4-column dashboard, 2D-canvas particle-sphere orb (`--orb-mode: sphere`).
- **Ghost** — light **paper `#F7F7F5` + graphite ink** (NOT the old dark-mono). Glow/bloom killed (depth from a hairline + soft shadow), square corners, calmer ambient motion, **centered-focus layout** (side dashboard columns hidden), the orb flips to an **ink-network web** mode (no bloom), one muted amber kept for alerts.
- **Amethyst** — violet `#B26BFF`. **Rounded-glass** cards (notch→`--radius`, semi-transparent + backdrop-blur) + a **bento layout** (orb as a 2×2 hero tile, Connections/Usage/Calendar/Activity as tiles, a slim full-width command bar).

Picked from the **Settings** view (`SkinPicker`); switching plays a brief **blur-mask crossfade** (~200ms, reduced-motion safe) and a no-flash `<head>` script prevents a color flash on load. Built with the **Impeccable** plugin + taste / minimalist / emil. Spec + 10-task plan under `docs/superpowers/`. **Shipped:** all 10 tasks are atomic commits on `main`; cross-skin QA passed (HUD + boot screenshots per skin, zero WebGL leak on the orb sphere↔network switch, reduced-motion honored). Deferred polish: Ghost ink-web centre density; Amethyst command bar width.

### Orb — 2D-`<canvas>` HUD-mock port  *(v8, 2026-07-02 — supersedes the v1.5 R3F particle sphere AND the v7 R3F nebula)*
The orb is a faithful **2D-`<canvas>` port** of the owner's Claude-designed HUD mock (`OrbCanvas.tsx`; spec `docs/superpowers/specs/2026-07-02-hud-orb-port-design.md`) — **one renderer**, three per-skin styles keyed by the `--orb-mode` CSS var (re-read each frame so a skin switch re-styles instantly):
- **Arc → `sphere`:** a 950-pt Fibonacci particle sphere + a 76-bar EQ halo + a radar sweep.
- **Ghost → `mesh`:** a 210-pt wobbling ink wireframe web.
- **Amethyst → `nebula`:** an 1180-pt twinkling volumetric cloud + 2 rotating ellipses.

All skins share: mode-driven **energy**, wobble, mouse tilt, ripples, **2 rotating gap rings** (the old "no rings" law is **retired**), and **4 channel lines with traveling packets wired to LIVE connection status** (Gmail ↑ / Calendar → / Telegram ↓ / Discord ←; packets reverse inward while thinking). It's **audio-reactive** — mic + Zenith's voice fold into the wobble + EQ. **Speaking on Arc warms to orange `255,169,77`** — an owner-sanctioned override of the old "never orange" rule (do NOT revert to cyan). Reduced motion **freezes time entirely** (energy/color still ease). The **4 connection nodes** stay as CSS-anchored labelled chips around the orb box, lit when connected.

> **Implementation:** `ZenithOrb.tsx` renders `OrbCanvas.tsx` (a mount-once `requestAnimationFrame` loop; live props stream in via refs). **The R3F/three.js stack was REMOVED** — `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing` uninstalled and `OrbScene.tsx` deleted — so **no WebGL context exists in the HUD**, and the old dispose-on-view-switch leak class is gone by construction. Per-frame cost was hardened in the M7-prep review (one `getComputedStyle`/frame, batched EQ-halo stroke, squared-distance ambient links).

### HUD Elements
- **Command center (`CommandCenter.tsx`):** chat input + **mic (hold space) + send merged into one surface**, with a monospace response area (**copy / save / share** per answer), a **left context-rail** (`ContextRail` + `LeftRailExtras`: chat / drafts / clients / settings), a **QuickActions** strip and a **FocusCard**
- **Connections list (`ConnectionsPanel.tsx`):** connected accounts + status dots (multi-account Gmail, multiple WhatsApp numbers, Discord servers)
- **Activity log (`ActivityLog.tsx`):** timestamped feed of what Zenith did ("create_event → confirmed", "email sent", "rate-limit warning") — the audit trail that pairs with the confirm gate
- **Confirm / pending-action card — FIRST-CLASS:** a prominent `StatusCard` near the orb (this is the trust layer; never buried)
- **Real `/usage` gauge (`GaugeIndicator`):** API usage + daily cap + token budget (the ONE gauge kept)
- Top **timeline/status bar** (`TopBar`) · **hex corner accents** (`hud/primitives`, used sparingly). *(The standalone bottom waveform bar was dropped — voice activity now drives the reactive orb directly.)*
- **CUT — do NOT build:** fake telemetry (CPU/GPU/disk/reactor/battery), a standing weather/environment widget, the decorative data-feed line graph

---

## 7. TECH STACK

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | Best React framework, scalable |
| Styling | Tailwind CSS | Fast HUD styling |
| Orb | HTML5 2D `<canvas>` (`OrbCanvas.tsx`) | Per-skin sphere/mesh/nebula port of the HUD mock; one renderer, R3F/three.js/WebGL removed (v8, 2026-07-02) |
| Desktop shell | Tauri (Phase 1) | Real app window, no browser tab; lighter than Electron |
| Backend | Python FastAPI | Fast, async; orchestrates Claude tool-use |
| AI Brain | Claude Sonnet 4.6 API (tool use) | Best quality/cost ratio; tools = clean routing |
| Voice In | faster-whisper (local/offline; **English default**, Hinglish optional) | Free, private; **`medium`/CUDA on the RTX 5060** (v1.7), no Chrome/Google dependency |
| Voice Out | **Kokoro** (local/offline, **default**, on GPU) → WAV; edge-tts neural → MP3 (one-flag fallback); backend `/speak` | Free, no key, private, browser-independent; ~0.7s/paragraph on GPU |
| Wake word (later) | Porcupine / openWakeWord | Detects "Zenith" for always-listening mode |
| Calendar | Google Calendar API (direct client lib) | Multi-account, robust |
| Email | Gmail API (direct, multi-account) | Multi-account |
| WhatsApp Personal | whatsapp-mcp bridge | Only MCP use; no official API (ToS risk) |
| WhatsApp Business | WhatsApp Cloud API | Multiple numbers |
| Discord | discord.py (direct) | Multi-server support |
| Notion | Notion REST API (direct, internal-integration token) | 18 tools; 2025-09-03 data-source model (multi-source DBs); read/create/edit/archive + DB structure + comments |
| Database | PostgreSQL | Conversation history, user prefs |
| Weather | Weather API (e.g. OpenWeather) | Morning briefing |
| Delivery | Phase 1 Tauri desktop · Phase 2 PWA + optional desktop | One codebase |
| Future | Anthropic Computer Use API | Desktop control |
| Future | Higgsfield API | Video/ad generation |

---

## 8. FOLDER STRUCTURE

> **Note (current — through M3):** this is the **target** structure; the real backend is still **flat** — `main.py`, `claude_service.py`, `memory_service.py`, `rate_limiter.py`, `stt_service.py`, `tts_service.py`, `tools.py`, plus M3's `google_auth.py`, `google_service.py`, `weather_service.py`, `activity_log.py`, and tests (`test_stt.py`, `test_transcribe_route.py`, `test_speak_route.py`, `test_tts_service.py`, `test_health_route.py`, `test_google_tools.py`) directly under `backend/` (no `routes/`/`services/`/`integrations/`/`database/` subdirs yet). Routes in `main.py`: `GET /`, `GET /health`, `GET /usage`, `GET /activity`, `POST /transcribe`, `POST /speak`, `POST /chat`, `POST /chat/confirm`, `GET /google/status`, `POST /google/connect`, `POST /google/disconnect`, `GET /calendar/events` (the **briefing is a tool**, not a route). Frontend: `app/` (`page.tsx`, `layout.tsx`, `globals.css`) + `components/` (`ZenithOrb`, `OrbScene`, `CommandCenter`, `ContextRail`, `LeftRailExtras`, `QuickActions`, `FocusCard`, `CalendarPanel`, `ConnectionsPanel`, `ActivityLog`, `PlaceholderView`, `GaugeIndicator`, `StatusCard`, `TopBar`, `StatusLabel`, `BootScreen`, `SkinProvider`, `SkinPicker`, `Markdown`, `hud/primitives.tsx`) + `lib/` (`voice.ts`, `format.ts`, `mock.ts`, `skins.ts`, `api.ts`). **No `src-tauri/` yet.** Refactor toward the tree below as integrations land.

```
jarvis/                             # repo codename; brand = Zenith
├── CLAUDE.md                       # Project context for Claude sessions
├── JARVIS_PRD.md                   # This file
├── .env                            # All secrets (never commit)
├── .env.example                    # Template
├── .gitignore
├── README.md                       # Setup instructions
│
├── src-tauri/                      # Tauri desktop shell (Phase 1)
│   ├── tauri.conf.json             # ← grant mic permission here
│   └── src/main.rs
│
├── frontend/                       # Next.js App
│   ├── app/
│   │   ├── page.tsx                # Main HUD dashboard
│   │   ├── layout.tsx
│   │   ├── calendar/page.tsx       # Full calendar view
│   │   ├── inbox/page.tsx          # Gmail + WhatsApp + Discord
│   │   └── settings/page.tsx       # API keys, connections, usage/cost
│   ├── components/
│   │   ├── ZenithOrb.tsx           # Animated center orb
│   │   ├── VoiceInput.tsx          # MediaRecorder, hold-space capture
│   │   ├── ConfirmCard.tsx         # Pending-action confirm gate UI
│   │   ├── ChatDisplay.tsx         # Terminal-style chat
│   │   ├── CalendarPanel.tsx       # Left panel
│   │   ├── CommsPanel.tsx          # Right panel (Gmail+WA+Discord)
│   │   ├── WaveformBar.tsx         # Bottom voice visualizer
│   │   ├── StatusCard.tsx          # Floating HUD alerts
│   │   └── GaugeIndicator.tsx      # Circular progress gauges
│   ├── lib/
│   │   ├── api.ts                  # Backend calls
│   │   └── voice.ts                # MediaRecorder + TTS utilities
│   └── styles/
│       └── globals.css             # HUD theme + animations
│
├── backend/                        # Python FastAPI
│   ├── main.py                     # Entry point (loads whisper model once)
│   ├── routes/
│   │   ├── chat.py                 # Claude + tool loop + confirm gate
│   │   ├── confirm.py              # Runs a pending action on user yes
│   │   ├── transcribe.py           # faster-whisper STT endpoint
│   │   ├── speak.py                # edge-tts neural TTS → MP3
│   │   └── briefing.py             # Morning briefing
│   ├── services/
│   │   ├── claude_service.py       # Anthropic API + history + tool loop
│   │   ├── memory_service.py       # Conversation management (last 20)
│   │   ├── rate_limiter.py         # Hard 5/min + 150/day kill-switch
│   │   ├── stt_service.py          # faster-whisper wrapper (English default; Hinglish optional)
│   │   ├── tts_service.py          # edge-tts neural voice → MP3 bytes
│   │   └── tools.py                # TOOL schemas + run_tool() + ACTION_TOOLS
│   ├── integrations/               # direct API clients (no MCP except WA-personal)
│   │   ├── google_client.py        # Calendar + Gmail (multi-account)
│   │   ├── discord_client.py       # discord.py
│   │   ├── whatsapp_personal.py    # whatsapp-mcp bridge
│   │   └── whatsapp_business.py    # WhatsApp Cloud API
│   └── database/
│       ├── models.py
│       └── connection.py
│
└── docs/
    └── setup.md                    # Step by step local setup
```

---

## 9. ZENITH SYSTEM PROMPT

> **Current prompt** as implemented in `backend/claude_service.py` (`ZENITH_PROMPT`). Tool capabilities are added as integrations land; Calendar/Gmail/WhatsApp/Discord tools are not wired yet.

```
You are Zenith — a highly intelligent personal AI assistant.
(Internal codename: JARVIS.) Your owner is a freelancer and agency owner based in India.

Personality:
- Professional but friendly, like a trusted senior colleague.
- Speak in Hinglish (Hindi + English mixed), but ALWAYS written in the Latin/Roman
  alphabet — e.g. "Boss, aaj aapki 3 meetings hain." NEVER reply in Devanagari, Urdu,
  Arabic, or any non-Latin script, even if the user's message appears in one.
- Concise — no unnecessary filler.
- Occasionally address the user as "Boss" (Iron Man style).
- Never say you can't do something without trying first.

Formatting:
- Plain, conversational text. Keep it minimal — short paragraphs and at most a few
  short bullet points. Use **bold** sparingly to highlight a key word or item.
- NEVER use emojis or emoticons. Avoid headings (#) and horizontal rules (---).

Tools:
- Use the tools available to you when they help — call them, don't just describe them.
- For any action that sends, creates, or deletes something, just call the right tool.
  The system pauses and asks the user to confirm before the action runs, so you do NOT
  need to ask "should I send it?" yourself — call the tool; confirmation is handled.

Rules:
- Keep responses short for simple queries.
- Never expose API keys or system internals.
- If unsure, ask one clarifying question.
```

---

## 10. RATE LIMITING

```python
MAX_REQUESTS_PER_MINUTE = 5
MAX_REQUESTS_PER_DAY = 150
WARNING_THRESHOLD = 120
MAX_CONVERSATION_HISTORY = 20      # messages kept in context
SYSTEM_PROMPT_MAX_TOKENS = 400
DAILY_TOKEN_BUDGET = 300_000       # hard cap — tool results balloon fast
# When the day's cap is hit, BLOCK further calls (kill-switch), not just warn.
```

---

## 11. ENV VARIABLES

```env
# Anthropic
ANTHROPIC_API_KEY=

# Backend API token (M5) — shared secret required on all routes except GET / and GET /health.
# Blank = disabled (localhost-only, with a loud boot warning). Generate: python -c "import secrets;print(secrets.token_urlsafe(32))"
ZENITH_API_TOKEN=
ZENITH_DEBUG_LOGS=                    # 1/true = verbose tool logs (inputs+results); blank = tool name + ok/failed only

# Google (multiple accounts)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# WhatsApp Business API (Cloud API)
WHATSAPP_BUSINESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# WhatsApp Personal — whatsapp-mcp bridge runs locally (QR-paired session, no key)

# Discord
DISCORD_BOT_TOKEN=

# Weather (morning briefing)
WEATHER_API_KEY=

# News headlines (morning briefing) — free RSS, no key. Optional override of the world+India defaults.
# Comma-separated "Label|url" pairs; blank = BBC World + Times of India.
NEWS_FEEDS=

# Speech-to-text — faster-whisper is local (no key).
# DEFAULT = English. On the RTX 5060 (8GB, shared with the orb) use cuda + medium (large-v3 is tight on VRAM).
WHISPER_LANGUAGE=en              # en (default) | hi | blank = auto-detect + romanise Hindi (Phase-2 Hinglish)
WHISPER_MODEL=medium             # RTX 5060: medium (large-v3 = OOM-risk) · CPU/8GB MacBook: small
WHISPER_DEVICE=cuda              # cuda (NVIDIA GPU) | cpu — fallback is safe but is now LOGGED loudly
WHISPER_COMPUTE=float16          # float16 (cuda) | int8_float16 (tight VRAM) | int8 (cpu)
# Optional cloud STT for Phase 2:
# DEEPGRAM_API_KEY=

# Text-to-speech — Kokoro local/offline (default, v1.6) or edge-tts (one-flag fallback)
ZENITH_TTS_ENGINE=kokoro              # kokoro (local, default) | edge (cloud neural, fallback)
ZENITH_KOKORO_VOICE=af_heart          # Kokoro English voice
ZENITH_KOKORO_DEVICE=cuda             # cuda (RTX 5060; needs cu128 torch) | cpu
ZENITH_TTS_VOICE=en-IN-NeerjaNeural   # edge-tts voice (used only when ENGINE=edge)

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/zenith

# App
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_ZENITH_API_TOKEN=         # must equal backend ZENITH_API_TOKEN (sent as the X-Zenith-Token header)
SECRET_KEY=
```

---

## 12. PREREQUISITES

**System:**
- Node.js 18+
- Python 3.10+ (user has 3.14 ✅)
- Rust toolchain (for the Tauri build)
- ffmpeg (faster-whisper audio decoding)
- Git ✅
- VS Code ✅
- PostgreSQL

**Machine:** MacBook Pro 2020 (8GB RAM) — use a "small" Whisper model here
**Desktop:** Windows, 32GB RAM — run a larger Whisper model on the GPU

**Accounts needed:**
- Anthropic Console → console.anthropic.com
- Google Cloud Console → enable Gmail + Calendar APIs
- WhatsApp Business → Meta Developer account (for business numbers)
- Discord Developer Portal → for bot token
- Weather API provider (e.g. OpenWeather)

**Payment:**
- Anthropic API: Start with $10 credit (~₹840)
- Wise card recommended if Indian Visa debit doesn't work

---

## 13. COST STRUCTURE

| Service | Monthly Cost |
|---------|-------------|
| Claude Pro (for building) | $20 (~₹1,680) |
| Anthropic API - Sonnet 4.6 | ~$5 (~₹420) |
| faster-whisper STT | Free (runs locally) |
| Google APIs | Free |
| WhatsApp Personal bridge | Free (open source) |
| WhatsApp Business API | Per-conversation pricing — verify Meta's current rates; start with 1 number |
| Discord | Free |
| Higgsfield (future) | $15 (~₹1,260) |
| **Total MVP** | **~₹2,100/month** |

---

## 14. BUILD ORDER

### Slice 0 — Vertical slice ✅ DONE
- Chat box + static orb + FastAPI `/chat` + one real Claude round-trip + rate-limiter stub
- Goal: prove the loop end to end before building HUD chrome

### Milestone 1 — The Brain ✅ DONE
- FastAPI + Claude tool-use scaffolding
- Last-20 history (+ token budget), enforced rate limit / kill-switch
- Hinglish system prompt
- Confirm gate, built once and reused
- **Do this BEFORE integrations** — every integration then plugs in as a tool

### Milestone 2 — HUD UI 🔄 IN PROGRESS (only the Tauri shell left)
- App-style HUD **built**, then given the **v7 redesign (SHIPPED to main 2026-07-03)**: IconNav rail, **⌘K CommandPalette**, dedicated **Memory / Notes / Clients** views, MonthRuler, redesigned boot screen, persisted **reduced-motion toggle** — alongside the merged **Command Center** (chat + mic + send, paginated), left/right rails, `QuickActions`, `FocusCard`, `CalendarPanel`, `ConnectionsPanel`, `ActivityLog`, `UsagePanel`, top bar. Panels are **live** — Calendar/Connections/Activity/Usage via M3 + M4 + `/activity` + `/usage` (all four connections live: Gmail/Calendar from Google, Telegram/Discord from their bots). Three **skins** (Arc/Ghost/Amethyst) shipped.
- **Orb = 2D-`<canvas>` HUD-mock port** (`OrbCanvas.tsx`, v8 — per-skin sphere/mesh/nebula; the R3F/three.js/WebGL stack **removed**, `OrbScene.tsx` deleted; §6). Audio-reactive; orange-on-speak (Arc) + gap rings both owner-sanctioned.
- Voice in (faster-whisper `/transcribe`) ✅ + out (Kokoro local / edge fallback `/speak`) ✅; empty/undecodable mic clips handled as no-speech (no 500) ✅
- Markdown reply rendering + emoji-strip ✅
- **Remaining:** scaffold the **Tauri desktop shell** (`src-tauri/`) + grant mic permission there. *(Done: orb → 2D-canvas port ✅ v8; voice English-default + GPU ✅ v1.7; panels wired to live data ✅ M3/M4; skins ✅ v1.8; v7 HUD reskin ✅ 2026-07-03.)*

### Milestone 3 — Google ✅ SHIPPED (live-verified 2026-06-25)
> Owner-verified end to end: connect → "what's on my calendar today?" → "any unread emails?" → "schedule a call tomorrow 4pm" (confirm → created) → "email Rahul I'm running late" (confirm → sent) → "good morning" (spoken briefing). Plus a **real Activity Log** (`/activity`, in-memory, records each successful tool run — replaces the mock) and the Connections connected-row polish.
- **Desktop-app OAuth** (google-auth-oauthlib `InstalledAppFlow`; client id/secret from `.env`, no `client_secret.json`). Single account now; per-email tokens in gitignored `backend/tokens/` so multi-account is a drop-in. **Least-privilege scopes:** `calendar.events`, `gmail.readonly`, `gmail.send`. Connect runs in a background thread → the frontend polls `/google/status`. **Consent screen must be set to Production** (Testing expires refresh tokens in 7 days).
- **11 tools on the EXISTING loop + confirm gate (no route/gate changes):** Calendar `get_calendar_events`/`search_calendar`/`create_event`/`update_event`/`delete_event`, Gmail `get_emails`/`search_emails`/`read_email`/`send_email`, plus `get_weather` + `get_briefing`. Action tools (`create_event`/`update_event`/`delete_event`/`send_email`) are gated. Direct Google client libs, NOT MCP.
- **Morning briefing:** one `get_briefing` tool assembles today's events + unread + weather (each section degrades alone) for Claude to narrate; a "Good morning" button sends it through the loop and speaks the reply.
- **Live panels:** Connections + orb Gmail/Calendar nodes and the Calendar panel read `/google/status` + `/calendar/events` (share the service layer, no API tokens spent). WhatsApp/Discord stay mock (M4).
- **Setup + the 5 acceptance tests:** `SETUP-GOOGLE.md`. Backend unit tests + the disconnected HUD are verified; the live Google path needs the owner's OAuth client + `WEATHER_API_KEY` in `.env`, then **Connect Google**.

### Milestone 4 — Messaging  *(Discord + Telegram ✅ SHIPPED — both live-verified 2026-06-25 · WhatsApp parked)*
- **Discord (✅ SHIPPED — live-verified 2026-06-25; bot reads channel messages + posts):** 4 tools on the EXISTING loop + confirm gate (no route/gate changes) — `list_discord_channels`, `get_discord_messages`, `search_discord_messages` (read-only) + `send_discord_message` (gated). Direct **discord.py** gateway bot runs as a background task on FastAPI's event loop; the sync `run_tool` reaches it via `asyncio.run_coroutine_threadsafe` (`backend/discord_service.py`). **Server channels only — the bot never reads the owner's DMs (a user-token would violate Discord ToS / risk a ban).** Needs the **Message Content** privileged intent + `DISCORD_BOT_TOKEN` (`SETUP-DISCORD.md`). `/discord/status` lights the orb Discord node + Connections row (token-based — no connect button); tool runs appear in the live Activity Log. WhatsApp stays mock.
- **Telegram remote (✅ SHIPPED — live-verified by the owner 2026-06-25:** phone → reply; "email …" → `[Confirm]` button → actually sends; reads mail/calendar): a phone front-end into the EXISTING brain — **NOT a tool**. The chat loop was extracted into **`chat_core.py`** (`process_chat`/`process_confirm`) so the HUD `/chat` and the bot share it (never forked); **`memory_service` is per-channel** (HUD vs telegram separate last-20, shared rate limiter). python-telegram-bot v20 **long-polling** on the FastAPI loop; async handlers bridge to the sync core via `asyncio.to_thread`. **🔒 LOCKED to `TELEGRAM_ALLOWED_USER_IDS`** (fail-closed; others ignored+logged). The confirm gate renders as `[✅ Confirm][✖ Cancel]` **inline buttons** → `process_confirm`. `/telegram/status` lights the orb **Telegram** node (which replaced WhatsApp's slot) + Connections row; tool runs hit the live Activity Log. Setup: `SETUP-TELEGRAM.md`.
- **WhatsApp — PARKED:** the unofficial *personal* bridge risks an account ban → **parked, not deleted** (Telegram took its orb slot; restore by re-adding the `WhatsApp` channel + a `/whatsapp` status). **WhatsApp Business stays Phase-2.**

### Milestone 5 — Hardening  *(✅ SHIPPED 2026-06-26, live-verified — both parts merged to main)*
- **Security — part 1 ✅ (see `SECURITY.md`):** **backend API token** (`X-Zenith-Token` on every route except `/` + `/health`; `backend/auth.py`; fail-open+warn when unset / 401 when set) + one frontend `apiFetch` wrapper (`lib/api.ts`); **prompt-injection guard** (fence untrusted read-tool results as `<external-content>`, system-prompt rule, same-turn ⚠️ warning on the HUD confirm card + Telegram buttons); **secrets restricted at rest** (`secure_files.harden()` — `icacls` / `chmod 600` on `.env` + `tokens/`); **thread-safe rate limiter** verified (+ concurrency tests); **logs scrubbed** behind `ZENITH_DEBUG_LOGS`; fixed a `.gitignore` bug that left `backend/tokens/` un-ignored. **+23 tests**; live-verified (auth 401/200, `/chat`, HUD). Bots unaffected (in-process). Encryption-at-rest deferred to Phase-2 (perms + a note instead).
- **Polish — part 2 ✅ (commit 4d68ff5, merged to main 2026-06-26):** real **usage/cost dashboard** (`UsagePanel` — token in/out split → est. ₹/$ cost + kill-switch chip; across all 3 skins; `rate_limiter.stats()` adds the split + cost + `killswitch`) · **Settings page** (`SettingsView` — Appearance / read-only active config from `/health` v0.5.0 + a `config` block / Connections / Security) · **README + `.env.example`** rewrite · **error/empty/loading audit** (Retry states on Activity/Calendar/Usage, Connections live/offline chip, stale `demo` badge removed; verified live in a real backend-down state + auto-recovery) · **+18 tests** (full fast suite 82 green)

### Milestone 6 — Memory vault + Copy Factory  *(Phase 1 — ✅ SHIPPED, both parts merged to main: vault 2026-06-26, Copy Factory 2026-06-27)*
- **Memory = local Markdown vault ✅** (Obsidian-style) — `vault_service.py` + 4 tools on the existing loop: `search_notes`/`read_note`/`list_notes` (read, trusted) + `save_note` (**local write, not gated**). Daily logs (`daily/YYYY-MM-DD.md`), client briefs, decisions. Path from `ZENITH_VAULT_PATH` (points at the owner's Obsidian vault); strict path-safety (no escape). Read-only HUD browser on the Drafts/Clients rail tabs. +18 tests, live-verified. (§4.10)
- **Copy Factory / Template Studio — Part 2 ✅ SHIPPED 2026-06-27** (live-verified, merged to main): 3 **output-only** tools on the existing loop (NOT gated; reads trusted; nothing wired to Arkquen) — `draft_sequence` (coherent multi-stage email + Meta WABA-template WhatsApp journey: Enquiry→Nurture→Booking→Reminder→No-show, `{{1}}` positional vars, category-tagged), `draft_ad_copy` (Meta primary/headlines + creative brief OR Google RSA within char limits), `draft_landing_copy` (hero→trust→benefits→FAQ→final CTA), in EN/HI/Hinglish (Latin only). New `backend/copy_factory.py` resolves the brief from `clients/<name>.md` (or inline text) + the owner's voice from `notes/voice.md`/recent client notes → a directive; the loop's Claude writes the finished copy, saved via the existing `save_note` → Drafts tab. `MAX_TOKENS` 1024→8192 (non-streaming-safe) so a full sequence isn't truncated. +9 tests (111 fast suite green). Plan: `docs/superpowers/plans/2026-06-26-copy-factory.md`. (§4.9)
- **To-dos ✅ SHIPPED 2026-06-28** — a vault-backed to-do list on the existing loop: 3 tools (`add_todo`/`list_todos`/`complete_todo`, local writes, **not gated**) + an editable **Today's Focus** HUD card (GET/POST/PATCH/DELETE `/todos`), stored as an Obsidian checklist (`Todos.md`) at the vault root. The two stale M6 QuickActions (Draft proposal, Log note) now prefill the Command Center. +12 tests. Plan: `docs/superpowers/plans/2026-06-27-todos.md`.

### Notion integration  *(✅ SHIPPED 2026-07-05, live-verified — merged to main)*
- **18 tools on the EXISTING loop + confirm gate (no route/gate changes):** reads `list_notion_pages`/`list_notion_databases`/`search_notion`/`read_notion_page`/`query_notion_database`/`describe_notion_database`/`get_notion_comments` (Notion content fenced as `<external-content>`); writes (all **gated**) `create_notion_page` (with rich blocks) / `create_notion_database_item` / `append_to_notion_page` / `update_notion_page` / `archive_notion_page` (soft-delete → trash) / `update_notion_block` / `delete_notion_block` (find a line by text) / `create_notion_database` / `update_notion_database` / `add_notion_comment`. Direct Notion REST API (NOT MCP); new `backend/notion_service.py`.
- **2025-09-03 data-source model:** databases are addressed through their data source so **multi-data-source DBs work** (old `2022-06-28` API 400'd). DB access is routed through `_db_schema`/`_db_query`/`_db_parent` + `_data_source_id` (resolves a database *or* data-source id). Live QA found: `/search` filters by `"data_source"`, column edits `PATCH /data_sources/{id}`, ids from search are data-source ids while URL ids are database ids.
- **Auth = internal-integration token** (`NOTION_API_KEY`); pages/DBs must be **shared with the integration** in Notion. Comment tools need the token's Read/Insert-comments capability. Setup: `SETUP-NOTION.md`. All 18 tools live-verified against the real workspace; **161 backend tests green, tsc clean.**

### Milestone 7 — Proactivity + WhatsApp triage  *(Phase 1)*
- Background watcher (e.g. APScheduler) → "what slipped" as floating status cards
- WhatsApp triage of your OWN messages: "who's waiting on a reply?" → confirm-gated drafts (§4.11)

> **Phase 2 (after the personal driver is solid):** multi-user auth (Clerk), per-user encrypted keys, Razorpay billing, hosted backend + PWA, the full **business-data dashboard** (§5.4), and optional Computer Use / Higgsfield.

---

## 15. KEY DECISIONS & GOTCHAS

- **STT:** Web Speech API dropped — recognition breaks inside the desktop shell (it depends on Chrome → Google's servers). Use faster-whisper locally.
- **STT language (decided this session):** **default to English (`WHISPER_LANGUAGE=en`)** for speed + accuracy. The Hinglish path — auto-detect + **romanise Hindi to Latin** (real words, not translated; re-force off Urdu drift), `beam_size=5` + `condition_on_previous_text=False`, `vad_filter` (fixed a ~58s silent-decode), dep `indic-transliteration` — is **kept but dormant behind the flag** (a Phase-2 differentiator; do NOT delete). With `en`, transliteration is skipped entirely.
- **TTS (decided in Pass B):** browser SpeechSynthesis was robotic in some Chromium builds and silent in others → replaced with **edge-tts** neural voices (free, no key). Backend renders MP3 at `POST /speak`; frontend plays it. Browser-independent and not rate-limited. Dep added: `edge-tts`.
- **Replies:** rendered as markdown (bold/lists/code) with **emojis stripped** before display and before TTS; the system prompt forbids emojis + heavy formatting and forces Latin-script Hinglish.
- **faster-whisper:** load the model ONCE at startup, not per request. **`large-v3` on `cuda`/`float16` on the 32GB GPU desktop** (~2-3s for a 12s clip); `small`/`medium` on the 8GB MacBook. **The safe CUDA→CPU fallback was silently running on CPU even on the GPU box — the real cause of the ~20s latency.** Make it LOUD: log requested-vs-actual device/model at startup, warn on CUDA-unavailable (likely missing CUDA 12 + cuDNN runtime — `nvidia-cublas-cu12` / `nvidia-cudnn-cu12`), and expose the active device/model on `/usage` (or a new `/health`). NVIDIA only. Push-to-talk masks remaining latency.
- **Tauri:** grant mic permission in `tauri.conf.json` + the OS-level usage string, or `getUserMedia` fails silently.
- **MCP vs tool use:** only personal WhatsApp uses MCP (no official API). Everything else is a direct API call exposed to Claude as a tool.
- **WhatsApp personal:** unofficial protocol → ToS / ban risk. Don't use a number you can't lose.
- **WhatsApp Business "1000 free msgs":** outdated — verify Meta's current per-conversation pricing; ship with one number first.
- **Domain & trademark:** "Zenith" is a contested mark; lock a non-.com domain (porkbun) and get a trademark sign-off before the paid launch.
- **Arkquen = OUT of scope** (white-label subscription being rebuilt — a moving target). Arkquen runs the *client machine*; Zenith runs the *founder*. No integration. (§2, §4.9)
- **Memory = Markdown vault** (Obsidian-style), not Postgres — local, private, and it doubles as the Copy Factory's brief store. (§4.10)
- **UI direction (v1.3):** app-style dashboards, not film stills — connection-map orb, paginated chat + left rail, Connections list, Activity log, first-class confirm card, fake telemetry cut, de-Marvel'd. (§6)
- **Differentiation / DON'T BUILD:** see §5.6 — lead on proactivity + WhatsApp triage; skip system monitoring, Motion-style auto-scheduling, WABA customer-chatbots, smart-home, and 3D eye-candy.
- **Phasing call (this session):** the personally-useful "future" features (Copy Factory, memory vault, proactivity, WhatsApp triage) were pulled into **Phase 1** because it's a daily driver for the owner; only true SaaS machinery stays Phase 2.
- **Orb (v8, 2026-07-02 — 2D-`<canvas>` port; supersedes the v1.5 R3F sphere + the v7 R3F nebula):** one renderer (`OrbCanvas.tsx`), per-skin sphere/mesh/nebula via `--orb-mode`; **R3F/three.js REMOVED** (`OrbScene.tsx` deleted → no WebGL, no dispose-on-view-switch leak). Audio-reactive (bars fold into wobble + EQ); reduced motion freezes it. Two old laws **retired** with owner sign-off: **speaking on Arc warms to orange `255,169,77`** (do NOT revert to cyan) and **2 rotating gap rings** are shared by all skins. (§6; spec `docs/superpowers/specs/2026-07-02-hud-orb-port-design.md`)
- **TTS (v1.5):** edge-tts stays default (English voices Neerja/Prabhat). **Kokoro** (hexgrad/kokoro) logged as a future **offline** TTS option — verify Hindi support before switching. The reply-lag is edge-tts's round-trip (separate from STT); pre-fetch/stream later.
- **Security (v1.9 / M5):** localhost binding was the only wall → added a **shared-secret `X-Zenith-Token`** on all routes (fail-open when unset so fresh clones + tests still run; strict 401 when set). The **confirm gate is the prompt-injection backstop** → fence untrusted read-tool content as `<external-content>`, tell the model it's data not instructions, and warn on a same-turn action-after-read. **Telegram/Discord bypass the HTTP gate by design** (they call `chat_core` in-process). The `NEXT_PUBLIC_` token is embedded in the client bundle (acceptable under local trust — the real boundary is localhost **+** token together). Encryption-at-rest deferred (tight file perms + a `SECURITY.md` note instead). Tokens live only in gitignored `.env` / `.env.local`. (`SECURITY.md`)

---

## 16. FUTURE ROADMAP

### Phase 1 — later milestones (pulled in from "future" this session)
- [x] M6: Memory vault (Markdown / Obsidian-style) + Copy Factory / Template Studio — ✅ shipped
- [ ] M7: Proactivity engine + WhatsApp triage of your own messages

### Phase 2 — Scale (Month 2-3)
- [ ] Host backend + PWA-installable web app + optional desktop download
- [ ] Multi-user auth (Clerk) + per-user encrypted keys + per-user rate limits
- [ ] Business-data dashboard (clients / projects / invoices / time; "talk to your business data")
- [ ] Cloud STT (Deepgram) for multi-user voice
- [ ] Optional / experimental: Anthropic Computer Use API · Higgsfield video/ad generation

### Phase 3 — Product (Month 4)
- [ ] Trademark clearance + final domain for "Zenith"
- [ ] User auth (Clerk)
- [ ] Multi-user support
- [ ] Razorpay payment (₹999/month)
- [ ] Landing page with TNC, Privacy Policy, Refund Policy
- [ ] Razorpay merchant account setup

### Phase 4 — Marketing (Month 4-5)
- [ ] Build in public — Twitter/X
- [ ] LinkedIn posts
- [ ] YouTube Shorts demos (via Higgsfield)
- [ ] Beta users (20-30 free)
- [ ] Facebook/Instagram ads — ₹5,000/month budget
- [ ] Target: 100 paying users = ₹1 lakh/month

---

## 17. MASTER PROMPT FOR OPUS 4.8

> Attach HUD reference images before sending this prompt.

```
Build Zenith — a full-stack personal AI desktop assistant
(wake word "Zenith", repo codename JARVIS).

Goal: My daily desktop tool — voice, calendar, email,
WhatsApp (personal + multiple business numbers), Discord, AI chat.

Stack: Next.js frontend wrapped in a Tauri desktop shell,
Python FastAPI backend, Claude Sonnet 4.6 API (tool use),
faster-whisper (local STT, English default) + edge-tts neural TTS
(backend /speak → MP3),
Google Calendar + Gmail API (direct, multi-account),
whatsapp-mcp bridge (personal) + WhatsApp Cloud API (multiple numbers),
discord.py, PostgreSQL.

Architecture: Claude calls tools, FastAPI executes them. Read-only
tools run immediately; action tools (send/create/delete) go through
a confirm gate — return a pending action, user confirms, then run.
Voice loop: mic (MediaRecorder, hold space) → /transcribe (whisper)
→ /chat (Claude + last-20 history + rate limit + system prompt
+ tools + confirm) → /speak (edge-tts neural → MP3).

UI: Match the HUD reference images attached exactly.
Dark theme (#000008 background, #00FFE5 cyan accent),
a 2D-canvas HUD orb (per-skin sphere/mesh/nebula, audio-reactive),
circular gauge indicators, floating status cards,
terminal-style chat, bottom waveform visualizer.

Constraints:
- Rate limit: 5 req/min, 150 msg/day — hard kill-switch, not just a warning
- Conversation history: last 20 messages only
- English default (Hinglish kept dormant behind a flag — Phase 2)
- All API keys via .env — never hardcoded
- Multi-account: multiple Gmail + multiple WhatsApp business numbers
- Confirmation before sending any message/email or creating/deleting events
- Production quality — complete code, no placeholders

Deliverable: Complete working codebase with folder structure,
all files, README setup guide, and .env.example
```

---

*PRD Version 2.4 | Updated: July 2026 (from v2.3 · v2.2 · v2.1 · v2.0 · v1.9 · v1.8 · v1.7 · v1.6 · v1.5 · v1.4 · v1.3 · v1.2 · v1.1 · v1.0, June 15, 2026)*
*v2.4 (Notion integration + two app fixes, SHIPPED to main 2026-07-05, on `feat/notion-integration` c9770ac→b8a63bb): Notion as **18 Claude tools** on the existing loop + confirm gate (direct REST API, NOT MCP; zero route/gate changes) — read/query pages+DBs, create pages (rich blocks) + rows, append/edit/delete page content, update/archive (soft-delete) pages, describe/create/alter DB structure, read/add comments; writes gated, reads fenced. Migrated to Notion's **2025-09-03 data-source model** so multi-data-source DBs work (routed via `_db_schema`/`_db_query`/`_db_parent`/`_data_source_id`; live QA fixed `/search` `"data_source"` filter, `PATCH /data_sources/{id}` column edits, and database-vs-data-source id resolution). New `backend/notion_service.py`; auth via internal-integration `NOTION_API_KEY`; `SETUP-NOTION.md`. All 18 tools live-verified. Two ride-along fixes: HUD **speaks confirmed-action results** (was silent), daily token cap **300k→500k** (env `ZENITH_DAILY_TOKEN_BUDGET`). 161 backend tests green, tsc clean.*
*v2.3 (v7 HUD redesign + 2D-canvas orb port, SHIPPED to main 2026-07-03, 89a409a→f428c96): full v7 HUD reskin (IconNav, ⌘K CommandPalette, Memory/Notes/Clients views, MonthRuler, v7 boot screen, persisted reduced-motion toggle) + the **2D-`<canvas>` orb port** (`OrbCanvas.tsx` — per-skin sphere/mesh/nebula via `--orb-mode`; the three.js/R3F stack UNINSTALLED, `OrbScene.tsx` deleted → no WebGL; orange-on-speak on Arc + gap rings both sanctioned; constellation ambient behind opaque rails). A post-merge `/review` fixed 7 findings (`f428c96`: stuck-mic keyup, confirm-card restore on network-fail, voice-error mislabel, 3 canvas-perf wins, stale comments); security sweep clean. Plus two ride-along fixes: CC no longer presses the viewport bottom on long replies (`4a38bd7`), env-driven CORS allowlist (`89a409a`). 130 backend tests green, tsc clean, cross-skin live-verified.*
*v2.2 (M6 Part 2 — Copy Factory, SHIPPED 2026-06-27, merged to main): three output-only draft tools (`draft_sequence`, `draft_ad_copy`, `draft_landing_copy`) on the existing loop + confirm gate (zero route/gate changes); `backend/copy_factory.py` resolves a vault/inline brief + the owner's voice into a directive and the loop's Claude writes the copy; not gated, reads trusted, nothing wired to Arkquen; `MAX_TOKENS` 1024→8192; +9 tests (111 fast suite green); live-verified.*
*Next Step: Milestone 7 — Proactivity + WhatsApp triage (Notion integration shipped to main 2026-07-05; v7 HUD + orb port shipped 2026-07-03; M6 fully shipped). Tauri desktop shell (`src-tauri/`) still pending from M2.*
