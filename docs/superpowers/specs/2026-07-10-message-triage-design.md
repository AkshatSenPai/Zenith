# Message triage — design spec

**Date:** 2026-07-10
**Status:** Approved (brainstorming complete) — ready for implementation plan
**Milestone:** M7 (Proactivity + message triage). This is **Part 3 of 3**: App Launcher (Part 1) shipped 2026-07-09; proactive nudges (Part 2) shipped 2026-07-10. This spec covers triage only.

---

## 1. What this is

Proactivity (Part 2) answers *"what slipped on my side?"* from **trusted** data — the owner's own calendar and notes. Triage answers the other half: *"who is waiting on a reply from me?"* — and to do that it must read **genuinely untrusted, attacker-controllable content** (inbound email). That is the whole reason it is a separate feature with its own spec, and the reason Part 2 was deliberately scoped to trusted sources.

The deliverable: a **Triage view** in the HUD listing threads awaiting the owner's reply, a chat tool that answers the same question in conversation, and a **Draft reply** path that rides the existing loop and confirm gate.

**Moat framing (PRD §14):** the two lead moats are proactivity and triage of your *own* messages. Both only pay off if the trust layer is visible — a draft the owner reviews, never an auto-send.

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| **Surface** | **Pull tool + a dedicated Triage view** in IconNav. NOT a nudge kind. | A nudge renders unprompted. Feeding attacker-controlled subject/snippet text into an unprompted card is a social-engineering surface; a pull view is only ever seen because the owner asked. Also keeps the ≤3 nudge cap for what slipped on *your* side. |
| **Sources (v1)** | **Gmail only.** | Gmail has a real, checkable signal: the thread's last message isn't from you. Discord's bot never sees DMs (by design), has no notion of the owner's identity, and "an unanswered @mention in a server channel" is far noisier. WhatsApp stays parked (ban risk). |
| **Detection** | **Deterministic. Zero Claude tokens to list.** Claude is called only when drafting. | Mirrors Part 2's split (deterministic calendar; Claude only where language understanding is required). "Who's waiting?" stays free to ask all day, and the kill-switch can never blank the view. |
| **Send path** | **New gated `reply_email(thread_id, body)` tool.** | `send_email(to, subject, body)` has no threading headers, so a "reply" would start a new thread. `reply_email` derives everything but the body server-side. `send_email` stays untouched for fresh mail. |
| **Draft context** | **Full chat loop, tools available.** | Drafting with the client's own note (`clients/rahul.md`) is the actual value. Risk is bounded because the recipient is thread-derived, the send is gated, and the full body is shown. See §7. |
| **Ledger** | **None.** No snooze/dismiss state. | Triage is pull-only — an unanswered thread you don't want to answer simply sits in a view you aren't looking at. It cannot nag. YAGNI. |

## 3. Architecture

```
HUD                                       backend
  TriageView (IconNav) ──GET /triage────▶ triage_service.waiting_threads()
  rows + [Draft reply]                       └─ google_service thread helpers  [deterministic, 0 tokens]
                                                 threads.list(q) → threads.get → last-message test

  Chat "who's waiting on a reply?" ─────▶ tool list_waiting_replies  → same function
                                                 result FENCED as <external-content>

  [Draft reply] → prefills Command Center → normal run_loop (all tools)
                                             read_email (fenced) + read_note (trusted)
                                          → reply_email  → EXISTING confirm gate → /chat/confirm → sent
```

New backend module `triage_service.py`. **Zero changes to the chat loop or the confirm gate** — `reply_email` is gated purely by being listed in `ACTION_TOOLS`, the same way M3/M4/Notion added gated tools.

`GET /triage` sits behind the app-level auth gate (`Depends(auth.require_token)`); the HUD calls it via `apiFetch`.

**No new OAuth scope.** M3 already granted `gmail.readonly` (covers `threads.list` / `threads.get`) and `gmail.send` (covers the reply). No re-consent.

## 4. Detection — deterministic, zero tokens

`triage_service.waiting_threads(now, max_results=10) -> list[dict]`

**Candidate query:** `in:inbox category:primary newer_than:14d`, capped at **25** threads from `threads.list`.

> **Do NOT add `-from:me` to the query.** `threads.list` matches a thread if *any* message in it matches, so `-from:me` matches nearly every thread containing at least one inbound message — it filters nothing and creates a false sense of correctness. The authoritative test is the last-message check below, performed in our code.

`category:primary` does the heavy lifting against promotions, newsletters, and bulk mail. The owner runs an agency; the inbox is noisy, and this single operator is the highest-value filter.

**The `newer_than:14d` bound is deliberate.** A thread whose last inbound message is older than 14 days ages out of triage entirely. This bounds the API cost and matches Part 2's bounded-window reasoning; if something that old still matters, it is a commitment in the vault, not an inbox row. Widening it is a config change, not a redesign.

**Per-thread rules** (applied to the thread's chronologically last message):

| Rule | Action |
|---|---|
| last message `From` matches the connected account (`google_service.account_label()`) | **skip** — you already replied |
| last message `From` matches `noreply\|no-reply\|donotreply\|mailer-daemon` (case-insensitive) | **skip** — machine mail |
| last message age < **4h** (env `ZENITH_TRIAGE_MIN_AGE_HOURS`, default `4`) | **skip** — too fresh to nag |
| otherwise | **emit** |

**Rank** by age descending (longest-waiting first). **Cap** at 10 (env `ZENITH_TRIAGE_MAX`, default `10`).

**Emitted shape:**

```jsonc
{
  "thread_id": "18f2c...",
  "from_name": "Rahul Sharma",         // display name, or the address if absent
  "from_email": "rahul@acme.com",
  "subject": "Re: ShapeOdyssey proposal",
  "snippet": "Any update on the timeline?",
  "last_at": "2026-07-08T11:04:00+05:30",
  "age_hours": 51,
  "source": "gmail"
}
```

## 5. New `google_service` helpers

Thin, testable additions beside the existing Gmail functions:

- `me_address(email=None) -> str | None` — the connected address; wraps the existing `account_label()`. No extra API call. **Returns `None` when no account is connected**; `waiting_threads` treats that as not-connected and returns `[]` rather than comparing against `None`.
- `list_thread_ids(query, max_results, email=None) -> list[str]` — `users().threads().list(q=...)`.
- `thread_summary(thread_id, email=None) -> dict` — `users().threads().get(format="metadata", metadataHeaders=[From, Subject, Date, Message-ID, References])`; returns the **last** message's `from`, `subject`, `date`, `message_id`, `references`, and `snippet`, plus the thread's `message_count`. (`snippet` is a per-message field in the Gmail API, so it comes from the last message, not the thread.)
- `reply_to_thread(thread_id, body, email=None) -> dict` — builds the MIME reply and sends it (§6).

## 6. `reply_email` — the gated send

**Tool schema:** `reply_email(thread_id: str, body: str)`. **There is deliberately no `to` parameter.**

Everything except the body is derived server-side from `thread_summary(thread_id)`:

| Header | Value |
|---|---|
| `To` | the last message's `From` |
| `Subject` | the last message's `Subject`, prefixed `Re: ` unless it already starts with `Re:` (case-insensitive) |
| `In-Reply-To` | the last message's `Message-ID` |
| `References` | the last message's `References` + its `Message-ID` |
| `threadId` | passed in the Gmail send body so Gmail files it in-thread |

Implementation mirrors the existing `send_email`: `MIMEText(body)` → `base64.urlsafe_b64encode` → `users().messages().send(userId="me", body={"raw": raw, "threadId": thread_id})`.

`reply_email` is added to **`ACTION_TOOLS`** → it always returns a pending action and rides the existing confirm gate. It is **not** in `UNTRUSTED_TOOLS` (it produces no third-party content) and **not** in `GATE_IF_UNTRUSTED` (it is unconditionally gated already).

**Activity Log.** `activity_log.record()` looks the tool up in `_MAP` and **silently does nothing when the tool is absent** (`_MAP.get(tool)` → `None` → early return). Both new tools must therefore be registered, or a sent reply would never appear in the log — a hole in the trust layer:

```python
"list_waiting_replies": ("email", "info", "checked who's waiting"),
"reply_email":          ("email", "ok",   "reply sent"),
```

This matches the existing `get_emails` / `send_email` entries.

## 7. Cross-cutting concerns

**Injection safety.** This is the first Zenith feature whose input is fully attacker-controlled. Five properties hold:

1. **`list_waiting_replies` is in `UNTRUSTED_TOOLS`.** Its result carries third-party subjects and snippets, so it is fenced as `<external-content>` with the do-not-obey rule, exactly like `read_email`. Forgetting this is the single most likely implementation mistake.
2. **The model cannot choose a recipient.** `reply_email` exposes only `thread_id` and `body`; `To` is derived. A prompt-injected email cannot redirect a reply to an attacker's address — the worst case is that it talks back to the sender who already emailed you.
3. **The send is always confirm-gated.** The card shows To, Subject, and the **full body** (scrollable, not truncated), plus the ⚠ untrusted warning — which will always fire here, because the drafting turn read a fenced thread and set `saw_untrusted`.
4. **Triage is pull-only.** No unprompted rendering of attacker text anywhere; that is why it is not a nudge kind.
5. **Accepted residual risk:** an injected thread can ask Claude to quote vault content into the draft body, and drafting runs with tools (including trusted, ungated `read_note`). The mitigation is that the full body is displayed before Confirm. **The owner must read the body before approving.** This was an explicit, informed trade — the alternative (a no-tools draft call) loses client context and makes every draft generic.

**Token budget.** Listing costs **zero** Claude tokens. Drafting is one ordinary chat turn: it counts against the daily token budget *and* the 5/min request limit, because it **is** a user turn (unlike Part 2's extraction, which is not).

**Error handling.** Google not connected → `{"connected": false, "threads": []}`, never a 500 (mirrors `/calendar/events`). A single thread that fails to fetch is skipped, not fatal. A `GET /triage` failure in the HUD is silent and keeps the last state, same as the other panels.

**Auth.** `GET /triage` inherits the app-level token gate; the HUD uses `apiFetch`.

**Rate/API cost.** `threads.get` is one Google API call per candidate, so the 25-candidate cap bounds a refresh at ≤26 calls. Well inside Gmail quota; no API tokens are spent (this is Google, not Anthropic).

## 8. HUD

**Placement.** A new **TRIAGE** entry in `IconNav`, alongside CHAT / MEMORY / CLIENTS / NOTES / SETTINGS, rendering a full-width `TriageView` (same slot as `MemoryView` / `NotesView`). Not the center column — this is a list, not a card stack.

**Polling.** Fetch `/triage` on mount and on window focus (the pattern `FocusCard` already uses). No interval: the view is only mounted while the owner is looking at it, and a triage list does not change second to second.

**Row.** Sender · relative age (`2d`, `6h`) · subject · one-line snippet · **Draft reply** button.

**Draft reply** calls the existing `prefillInput(...)` and switches the view to chat. The prefill is an **inert string** — it never runs a tool, the same law the nudge cards follow. Prefill form:

> `draft a reply to <from_name> on the thread "<subject>" (thread_id: <thread_id>)`

Including the `thread_id` in the prefill is what lets Claude call `reply_email` with the right thread without a lookup round-trip.

**States.** Loading, empty (`Nothing waiting.`), and offline + Retry, matching `CalendarPanel` / `ActivityLog`. Auto-themes across Arc / Ghost / Amethyst via the existing tokens; no new colors.

## 9. Testing

**`backend/test_triage.py`** — all Google/Claude seams mocked → offline, cross-platform:

- **Detection:** last message from me → skipped · inbound, 6h old → included · inbound, 1h old → skipped (too fresh) · `noreply@` sender → skipped · ranking is age-descending · cap honored · Google not connected → `[]`, no raise · a thread whose `thread_summary` raises is skipped, others still returned.
- **`reply_email`:** derives `To` / `Subject` (`Re:` added once, not doubled) / `In-Reply-To` / `References` from the thread · passes `threadId` in the send body · the tool schema exposes **no** `to` property (assert on the JSON schema).
- **Gate membership (regression guards):** `"reply_email" in ACTION_TOOLS` · `"list_waiting_replies" in UNTRUSTED_TOOLS` · `"reply_email" not in UNTRUSTED_TOOLS`.
- **Activity Log:** both new tools are present in `activity_log._MAP` (guards the silent-skip behaviour of `_MAP.get`).
- **No connected account:** `me_address()` returning `None` → `waiting_threads()` returns `[]` without raising.
- **Route:** `GET /triage` → 200 with threads · returns `connected: false` (not 500) when Google is unlinked.

**Frontend** (no unit harness): `tsc --noEmit` clean, plus live screenshots of the Triage view across all three skins, an empty state, and one end-to-end draft → confirm card (showing To/Subject/full body + ⚠) → **Cancel**.

## 10. Out of scope (v1) / future

- **Discord triage** — needs a new `DISCORD_OWNER_USER_ID`, covers invited channels only (never DMs), and the signal is an unanswered `@mention`. Revisit once the Gmail shape is proven.
- **WhatsApp** — parked (unofficial bridge = ban risk). WhatsApp Business stays Phase 2.
- **Multi-account** — v1 triages the default connected account. `google_service` is already multi-account-ready (`email=` param), so this is a later widening, not a rewrite.
- **Claude classification** of "does this genuinely await a reply" (an FYI or a "thanks!" does not). Deterministic rules first; add a cached classification pass only if noise proves bad in real use.
- **Snooze / dismiss ledger** for triage rows.
- **Feeding waiting-reply counts into the proactivity NudgeStack** — deliberately not done; see §2.

## 11. Files

**New:** `backend/triage_service.py`, `backend/test_triage.py`, `frontend/components/TriageView.tsx`, this spec, the implementation plan.
**Touched:** `backend/google_service.py` (4 helpers), `backend/tools.py` (2 tool schemas + 2 executors + `ACTION_TOOLS`/`UNTRUSTED_TOOLS` membership), `backend/activity_log.py` (2 `_MAP` entries), `backend/main.py` (one route), `backend/.env.example` (2 vars), `frontend/lib/nav.ts` (a `View`), `frontend/components/IconNav.tsx` (an entry), `frontend/app/page.tsx` (render the view).
**Reuses:** the confirm gate, `run_loop`'s `saw_untrusted` + `_wrap_untrusted` fencing, `auth`, `apiFetch`, `prefillInput`, `activity_log`.
