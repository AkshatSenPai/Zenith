# Proactivity — design spec

**Date:** 2026-07-09
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Milestone:** M7 (Proactivity + message triage). This is **Part 2 of 3**: App Launcher (Part 1) shipped 2026-07-09; **WhatsApp/message triage is Part 3** and gets its own spec. This spec covers proactivity only.

---

## 1. What this is

Everything in Zenith so far is **pull**: you ask, it answers. Proactivity makes Zenith **surface what slipped on your side before you ask** — a small stack of "nudge" cards in the HUD, drawn from data you already connected in M3–M6. It's mostly *assembly* over existing services, not new integration.

**The moat framing (from the PRD):** a proactive assistant that acts through a visible trust layer is the differentiator. But a proactive assistant that nags gets muted within a day — so restraint (few cards, dismiss/snooze, auto-clear) is a first-class design goal, not a nicety.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **v1 scope** | What-slipped-on-your-side: Calendar prep + vault commitments + near deadlines. Inbound-message "who's waiting on a reply" nudges are **Part 3 (triage)**. | Keeps proactivity's data mostly **trusted** (your calendar, your notes) → tiny injection surface. Triage is where untrusted-message machinery lives. |
| **Trigger** | **On-demand while the HUD is open** — recompute on window focus + every ~60s the tab is open. No background loop. | Phase 1 has **no push channel** (Tauri shell unbuilt), so a background loop's nudges would sit unseen until you open the HUD anyway. On-demand is visibly identical with far less machinery. Background loop revisits once Tauri notifications exist. |
| **Commitment extraction** | **Claude-assisted, cached and keyed on the daily-note file changing.** | Pulling structured "who/what/by-when/done" out of prose needs language understanding; caching on file-change means Claude fires a handful of times a day, not every 60s poll. |
| **Anti-nag** | **≤3 cards, ranked by urgency. Dismiss + Snooze (Tonight/Tomorrow), persisted. Auto-clear when the thing resolves.** | The single most important UX property. Snooze stops a can't-act-now item from nagging without forcing "banish forever." |
| **Action** | One "deal with it" button that **prefills the Command Center** and rides the normal loop + confirm gate. | No new action plumbing; safest re: injection (nothing auto-runs). |
| **Architecture** | Backend `proactivity_service.py` + a `/proactive` endpoint the HUD polls. (Rejected: a chat tool = pull, kills the point; frontend-computed = can't reach vault/Claude, untestable.) | Keeps Claude + vault access server-side (required for extraction + safety); logic is testable. |

## 3. Architecture

```
HUD (main view)                     backend
  refreshProactive (60s + on focus) ──GET /proactive──▶ proactivity_service.gather()
  NudgeStack renders ≤3 NudgeCards                        ├─ calendar gatherer  (google_service.get_events)  [deterministic]
  Dismiss / Snooze ─────────────────POST /proactive/dismiss   └─ commitments gatherer (vault daily notes → Claude, cached)  [on change]
  Action button → prefills Command Center                 filter (ledger) → auto-clear/prune → rank → top 3
                                                          state: backend/.zenith/proactive.json
```

Both routes are automatically behind the app-level auth gate (`Depends(auth.require_token)` in `main.py`); the HUD calls them through `apiFetch` so the `X-Zenith-Token` rides along.

## 4. Nudge data model

`GET /proactive` returns `{ "nudges": [ …≤3 ] }`, each:

```jsonc
{
  "id": "commitment:rahul-proposal:a1b2c3",  // stable: kind:slug:shorthash
  "kind": "prep" | "commitment" | "deadline",
  "tone": "info" | "alert" | "critical",     // drives StatusCard tone
  "title": "COMMITMENT",                      // mono label on the card
  "body": "You told Rahul you'd send the proposal by Fri — logged Tue, still open.",
  "action": { "label": "Draft it", "prefill": "draft the proposal for Rahul" }, // or null
  "urgency": 74                               // 0–100, ranking only
}
```

**Stable `id` is the linchpin.** `kind:slug(subject):shorthash` — Dismiss/Snooze remember *that specific item* across the 60s recomputes; if the underlying thing changes materially the hash changes, so a genuinely-new state can re-surface instead of staying silently suppressed.

## 5. Gatherers

The data supports **two** gatherers cleanly (not three — see §5.3).

### 5.1 Calendar gatherer — deterministic, no Claude
Reads `google_service.get_events(when="today")`. Emits:
- **prep**: an event starting within the next ~45 min → `"Call with Rahul at 3:00 (in 40 min)"`, action **Brief me** (`prefill: "brief me on my meeting with Rahul"`). If an event attendee/title matches a `clients/<name>.md` note, the brief is genuinely useful.
- **deadline**: a dated/all-day item due today or tomorrow → `alert` tone.
- No Google connection, or the read throws → **no calendar nudges** (best-effort; never an error).

### 5.2 Commitments gatherer — Claude, cached on change
Reads a **bounded window of recent `daily/*.md`** under `vault_service.vault_root()` — default the **last 7 days** (tunable; long enough to catch a still-open commitment from earlier in the week, short enough to keep extraction cheap). Computes a **signature** over those windowed files (names + mtimes + sizes). If it equals the cached signature → reuse cached items (**zero tokens**). If not → one Claude call extracts `[{what, who, by_when, done}]` as JSON, and the cache (signature + items) is rewritten.
- Emits a **commitment** nudge per open item (action **Draft it** when it's a deliverable).
- A commitment whose `by_when` is near carries **higher urgency** — that *is* the deadline flavor.
- **Auto-clears** when the item's `done` flips true (you logged "sent Rahul the proposal") — the nudge simply isn't gathered anymore.
- The extraction call binds **no tools** (see §8) and its token usage is recorded to the rate limiter.

### 5.3 To-dos are intentionally NOT a gatherer
`Todos.md` stores `- [ ] text` with **no due date and no created-at**, so there is nothing to compute "overdue" or "due soon" from, and open to-dos already live in the **Today's Focus** card. Driving deadline nudges off raw to-dos would be guesswork *and* duplicate the FocusCard. So in v1, deadlines come from the **Calendar** and from the **`by_when`** that falls out of commitment extraction. (Future option: a `📅 YYYY-MM-DD` tag in the to-do format — tracked in §10, not built here.)

## 6. State — `backend/.zenith/proactive.json`

Same gitignored, `secure_files`-hardened directory as `history.json`; same atomic tmp→`os.replace` write, same best-effort try/except, same load-at-import. One file, two sections:

```jsonc
{
  "ledger": {
    "dismissed": { "commitment:rahul-proposal:a1b2c3": "2026-07-09T14:00Z" }, // id -> when dismissed
    "snoozed":   { "prep:evt_xyz": "2026-07-09T20:00Z" }                      // id -> hidden until
  },
  "cache": {
    "signature": "<hash of daily-note names+mtimes+sizes>",
    "commitments": [ { "what": "...", "who": "Rahul", "by_when": "Fri", "done": false, "id": "..." } ]
  }
}
```

**Per `GET /proactive`:** gather → **filter** (drop ids in `dismissed`, or in `snoozed` with a future time) → **auto-clear + prune** (a resolved item isn't gathered, so it falls out; its orphaned ledger entry and any expired snooze are pruned so the file can't grow forever) → **rank**.

**Ranking** — each nudge carries `urgency` 0–100 (indicative, tunable): prep = sooner meeting → higher (`in 10 min` ≈ 90, `in 45 min` ≈ 55); deadline = overdue → `critical` + top; commitment = base + boost when `by_when` is near or the item is old. Sort desc, tiebreak by kind (prep > deadline > commitment), take **top 3**.

## 7. Endpoints

| Route | Body | Returns | Notes |
|---|---|---|---|
| `GET /proactive` | — | `{ "nudges": [ …≤3 ] }` | gather→filter→rank. **Best-effort per gatherer** — one throwing contributes nothing; the endpoint never 500s. Serving from cache spends zero tokens. |
| `POST /proactive/dismiss` | `{ "id": "...", "snooze": "evening" \| "tomorrow" \| null }` | `{ "ok": true }` | `snooze` null → **dismiss** (permanent until the item's hash changes); a preset → **snooze**, backend computes the until-time (`evening` = the UI's "Tonight" = today 20:00; `tomorrow` = 09:00). Unknown id → still `ok` (idempotent). |

The action button needs **no endpoint** — the prefill string is already in the nudge; "Draft it" / "Brief me" drops it into the Command Center client-side and rides the normal loop.

A small in-process lock guards the extract-on-change step so two near-simultaneous polls don't both call Claude.

## 8. Cross-cutting concerns

**Injection safety.** The commitments gatherer feeds *your own* daily notes to Claude, not third-party content — that's precisely why message-reading is Part 3. Two hard guarantees regardless of note contents (a note could contain pasted external text): the extraction call binds **no tools**, so it structurally cannot act — it can only return JSON; and a nudge's action is a **prefill string that never auto-runs** — anything that sends/creates still hits the confirm gate. Worst case: a bogus commitment/prep card appears (even from a poisoned calendar-invite title) and you Dismiss it. Nothing executes without you.

**Token budget.** Extraction counts against the daily token budget (visible + capped), is **not** subject to the 5-req/min user limit (it's not a user turn), is **skipped when the kill-switch is tripped** (calendar nudges still work), and is cached so it's rare.

**Error handling.** Best-effort per gatherer (§7); a corrupt `proactive.json` starts fresh and logs, like `history.json`; if everything fails the endpoint returns `{nudges: []}`. A failed poll on the frontend is silent, same as the other panels.

**Auth.** Both routes inherit the app-level `Depends(auth.require_token)` gate automatically; the HUD uses `apiFetch`.

## 9. HUD

**Placement.** A vertical stack of ≤3 cards in the **center column, directly above the Command Center** — the slot the confirm `StatusCard` already uses. The center column is the one region present in **all three skins** (Arc columns, Ghost centered-focus, Amethyst bento), so there's no per-skin layout work; the rails aren't viable (Ghost hides them). An **active confirm card always sits on top** (it's the trust layer for an in-flight action); nudges render below it. Nudges appear only on the **main dashboard view**, not over Settings/Memory/etc. On a short viewport the stack scrolls in its own container so the Command Center never gets pushed off-screen (the CC bottom-overflow fix stays intact).

**Components.** New `NudgeStack` + `NudgeCard` in `frontend/components/`, reusing `StatusCard`'s notched-corner shell and `info`/`alert`/`critical` tone tokens (so it auto-themes across skins — no new colors). `StatusCard` itself is **not** overloaded: its Confirm/Cancel API is the confirm-gate contract. Each `NudgeCard` footer = the primary action (prefills the Command Center) + **Snooze** (Tonight / Tomorrow) + **Dismiss** ✕.

**Polling.** `refreshProactive` on a 60s `setInterval` + a window-focus refetch (the pattern `FocusCard` already uses), through `apiFetch`. Reduced-motion skips the card's entrance transition.

## 10. Out of scope (v1) / future

- **Message triage** ("who's waiting on a reply?", draft replies on Gmail + Discord) — **M7 Part 3**, separate spec.
- **Background watcher loop + OS/Tauri desktop notifications** — revisit once the Tauri shell exists (a push channel makes always-on worthwhile).
- **Dated to-dos** — a `📅 YYYY-MM-DD` tag on the to-do format so overdue to-dos can nudge; small follow-up, not this spec.
- **Full-history commitments** — accumulate extracted commitments across the entire daily-note history (a rolling store marked done on resolve) instead of a bounded 7-day window, so an old still-open commitment never ages out.
- Snooze presets beyond Tonight/Tomorrow; per-nudge "why am I seeing this" detail; multi-account calendar prep.

## 11. Testing

**`backend/test_proactivity.py`** — all Claude/Google/filesystem seams mocked → offline, cross-platform, fast (~20–25 tests; suite 197 → ~220):
- **Gatherers:** calendar events → prep/deadline (event in ~40 min → prep + "Brief me"; dated-today → deadline; none → none; raise → none); commitments JSON → nudges (open → "Draft it"; `done` → auto-clear; near `by_when` → higher urgency).
- **Extraction cache:** unchanged signature → Claude not called (assert count 0, reuse); changed → re-extract once + rewrite.
- **Ledger:** dismiss suppresses that id only; snooze "tomorrow" hides until the computed time and reappears after (inject a fake "now"); orphaned entries + expired snoozes pruned; corrupt store → fresh, no crash.
- **Ranking/model:** feed 5 → top 3; tone mapping (overdue → critical); stable id identical across gathers, changes on material change.
- **Endpoints:** `GET /proactive` ≤3 and **stays 200 when a gatherer throws**; `POST /proactive/dismiss` writes dismiss vs future-snooze; unknown id idempotent.
- **Budget/safety:** kill-switch tripped → extraction skipped, calendar nudges still returned, zero Claude calls; extraction call made with **no `tools`** (assert); usage recorded to the limiter.

**Frontend** (no unit harness; backend-pytest project) — verified via **live screenshots across all three skins**: nudge stack on Arc/Ghost/Amethyst, confirm-card-on-top priority, Dismiss removing a card, Snooze hiding it, action prefilling the Command Center, reduced-motion pass.

## 12. Files

**New:** `backend/proactivity_service.py`, `backend/test_proactivity.py`, `frontend/components/NudgeStack.tsx`, `frontend/components/NudgeCard.tsx`, this spec, the implementation plan.
**Touched:** `backend/main.py` (two routes), `frontend/app/page.tsx` (poll + render + prefill wiring). Reuses `google_service`, `vault_service`, `claude_service`/anthropic client, `rate_limiter`, `auth`, `secure_files`, `StatusCard` styling. `backend/.zenith/proactive.json` is created at runtime (gitignored).
