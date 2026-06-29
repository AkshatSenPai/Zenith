# Zenith HUD — v7 Redesign (design spec)

**Date:** 2026-06-29
**Status:** approved (design); pending plan
**Branch:** `redesign/hud-v7` off `fix/hud-briefing-greeting-weather-boot` HEAD

---

## 1. Goal

Adopt the look and UX of the **v7 Claude-design prototype** (`Downloads/UIUX improvement review p2/Zenith HUD v7.dc.html`)
across the entire Zenith HUD, while **keeping every piece of existing behavior** — live backend
wiring, the confirm gate, the real WebGL orb, voice round-trip, and all three skins.

The end state: **looks like v7, works like today, plus a few new features the owner chose.**

This is **not** a rewrite. v7 is a static mock on a non-React runtime (`x-dc` / `support.js`); we do
**not** lift its HTML and re-wire it. We **re-dress the existing, already-wired React components in
place** — same fetches, same state, same handlers, new markup/tokens — and add the chosen new
features as new components calling existing endpoints.

## 2. Locked decisions

| Area | Decision |
|---|---|
| Chat view | **Paginated Command Center** — one conversation turn per page (prev/next, typing caret, role chips). Replaces the current scrolling thread. |
| Navigation | **v7 router-nav** — 74px icon strip (Chat / Memory / Clients / Notes / Settings) + 288px left content rail + center router + 316px right rail. Center swaps full-page views. |
| Typeface | **IBM Plex Sans + Plex Mono**, self-hosted via `next/font` (no runtime fetch — preserves instant paint). |
| Skins | Keep **Arc / Ghost / Amethyst**, refit token values to v7's polish. |
| Skin layout | **Unify all three skins on the v7 layout**; tokens differentiate. Drops Ghost's centered-focus layout and Amethyst's bento layout. |
| ⌘K palette | **Include** — fuzzy-search vault notes/clients + a command registry (nav + quick actions). |
| Memory view | **Replace** `VaultView` with v7's richer Memory page (pinned-context, vault grid, `[[wikilinks]]`). |
| Usage sparkline | **Include** — session token series accumulated client-side from `/usage` polls. |
| Toasts | **Skip.** |
| Sound | **Skip.** |

## 3. Non-negotiables (protected no matter what)

1. **Confirm gate / `StatusCard`** — v7 has no pending-action UI. We keep `pending` state,
   `resolvePending`, and `pendingBody` (incl. the ⚠ untrusted-content warning) exactly as-is.
   The card renders as a **pinned element, always visible whenever `pending` is set** (not hidden
   behind pagination), restyled to v7. It is the trust layer; it stays first-class.
2. **Connections are status-driven** — v7 shows on/off toggles; real connections reflect
   OAuth/token state. Google keeps real **connect/disconnect**; Gmail / Calendar / Telegram /
   Discord stay **read-only status dots** driven by `/google·discord·telegram/status`. No fake toggles.
3. **Real R3F particle orb** — v7's orb is a 2D-canvas mock. We keep `OrbScene`/`ZenithOrb` (WebGL,
   bloom, audio-reactive). We adopt only v7's **node-label chip styling**.
4. **All live wiring preserved** — every endpoint and handler in `page.tsx` survives the restructure.
5. **Accessibility** — `:focus-visible`, reduced-motion honored, ARIA on toggles/switches. v7's
   `role="switch"` / `aria-checked` patterns are adopted.

## 4. Approach

**Token-first re-skin in place, incremental.** Order of operations:

1. Foundation: port v7 tokens into the existing `data-skin` system in `globals.css`; add IBM Plex in
   `layout.tsx`; build v7's ambient layer (bg canvas, scanline, scan-beam, vignette, corner brackets).
2. Restructure `page.tsx` layout to the unified v7 grid + router-nav (behavior functions untouched).
3. Restyle each component in place, one per commit, verifying the live HUD after each.
4. Add new components (IconNav, CommandPalette, MemoryView, Sparkline, MonthRuler).
5. Cross-skin + reduced-motion QA.

Backend is **untouched** → the 130-test fast suite stays green throughout; `tsc --noEmit` clean at each step.

## 5. Architecture

### 5.1 Foundation layer
- **`globals.css`** — the `:root` / `[data-skin=...]` variable blocks get v7's palette + spacing +
  treatment values. New/updated knobs as needed (e.g. ambient opacities). Tailwind keeps reading
  `rgb(var(--..)/<alpha>)`, so utility classes re-theme for free.
- **`layout.tsx`** — add IBM Plex Sans + Mono via `next/font/google` (self-hosted at build).
  **Plex becomes the shared font stack for all skins**; Arc's current Space Grotesk / Inter /
  JetBrains Mono remap under `[data-skin=arc]` is removed.
- **Ambient layer** — v7's background `<canvas>` field, repeating-scanline overlay, top scan-beam,
  corner brackets, vignette. Token-gated (`--scanline-op`, `--bloom`, etc.) so Ghost can damp them.

### 5.2 Layout & navigation (unified)
Remove the `ghost`/`amethyst`/`sideless` layout branching in `page.tsx`. One layout for all skins:

```
header (TopBar)
month ruler (MonthRuler)
┌ IconNav(74) ┬ LeftRail(288) ┬ Center router ┬ RightRail(316) ┐
│ Chat        │ Schedule      │ <view>        │ Connections    │
│ Memory      │ QuickActions  │               │ Today's Focus  │
│ Clients     │ Usage+spark   │               │ Activity Log   │
│ Notes       │ Shortcuts     │               │                │
│ Settings    │ status footer │               │                │
└─────────────┴───────────────┴───────────────┴────────────────┘
```

Center router views: `chat` · `memory` · `clients` · `notes` · `settings`
(the `View` type expands; current `drafts` → `notes`, add `memory`).

### 5.3 Component inventory

**Keep + restyle (wiring preserved):**
- `TopBar` — wordmark + HUD badge, centered date/time, ONLINE chip, ⌘K button, skin-cycle. **No sound button.**
- `CalendarPanel` → compact **Schedule** card in left rail (keeps `/calendar/events`).
- `QuickActions` — left-rail grid (keeps `onPrefill` / `onBriefing`).
- `UsagePanel` — left-rail Usage section **+ Sparkline** (keeps `/usage`).
- `ConnectionsPanel` — right-rail collapsible (keeps Google connect/disconnect + status dots).
- `FocusCard` → right-rail **Today's Focus**, inline add-todo + checkboxes (keeps `/todos`).
- `ActivityLog` — right-rail collapsible (keeps `/activity`).
- `SettingsView` — v7 Settings: Appearance (SkinPicker) / Motion (reduced-motion; **no sound**) /
  Active config (read-only from `/health`) / Security.
- `BootScreen` — restyle to v7; keeps the live connection-count logic from the fix branch.
- `CommandCenter` — becomes **paginated** (see 6).
- `StatusCard`, `Markdown`, `SkinProvider`, `SkinPicker`, `StatusLabel`, `hud/primitives` — restyle/keep.

**New:**
- `IconNav` — 74px icon strip; drives the center router (replaces `ContextRail`'s role).
- `CommandPalette` — ⌘K overlay; searches `/vault` notes+clients + a command registry; ESC/backdrop close.
- `MemoryView` — full center view over `/vault` (pinned-context cards → recent/important, vault grid, `[[links]]`).
- `Sparkline` — small SVG polyline in `UsagePanel`, fed by a client-side session token series.
- `MonthRuler` — the day ruler under the top bar.
- Waveform — reuse existing `voice.ts` bars (`getBars`/`getSpeechBars`) next to STATUS; small new render or fold into CommandCenter.

**Retire:**
- `VaultView` (superseded by `MemoryView` + the Clients/Notes views).
- `ContextRail` (superseded by `IconNav`).
- Bento CSS + the `sideless` / centered-focus layout branches (the unified layout removes them).
- `LeftRailExtras` / `GaugeIndicator` — absorbed into the new left rail, or removed if unused after the restyle.

## 6. Chat view (the delicate part)

Layout: **orb** (fixed, centered, width/max-height eased) → **STATUS + waveform** row → **confirm
card (pinned, shown only when `pending`)** → **paginated Command Center card**.

- **Pagination** — `messages` are shown one turn per page with ‹ / › controls, a `ccPage` index, a
  typing caret on the latest assistant turn, and role chips (YOU / ZENITH). `sendMessage`,
  voice (`startListening`/`stopListening`), markdown rendering, and the input row (mic + send) are
  unchanged; only the presentation of `messages` changes. New page auto-advances to the latest turn.
- **Confirm card** — keep the current proven pattern: `pending && <StatusCard>{pendingBody}</StatusCard>`
  rendered as a prominent pinned element in the chat column (restyled to v7), **always visible when
  pending** regardless of the current page. `resolvePending(true/false)` unchanged.
- **Orb lifecycle** — the orb now mounts **only in the chat view** (other views replace the center).
  On view switch it unmounts → **dispose the WebGL context cleanly** (honor the existing "zero WebGL
  leak on switch" rule). The orb-recede / CC-grow / `ccMinimized` dance is retired in favor of v7's
  fixed orb + fixed paginated card.
- **Connection-node drift** (the open bug) is re-solved here: the v7 chip-style node labels are
  re-anchored to track the orb smoothly during any size transition.

## 7. New features (detail)

- **⌘K palette** — overlay with a search input + result list grouped by source. Sources: vault notes
  & clients (`/vault/notes`), nav targets (the 5 views), and quick actions (briefing, prefill drafts).
  Opens on ⌘K / the top-bar button; closes on ESC / backdrop. No backend changes.
- **Memory view** — center view over `/vault`. "Pinned context" maps to recent/important notes (the
  vault has no pin flag yet — noted as a future backend nicety, not built now). Renders the vault grid
  with tags + previews and `[[wikilink]]` chips; selecting a note opens it (reuses `/vault/note`).
- **Usage sparkline** — `UsagePanel` accumulates a small in-memory series of token totals from the
  existing 5s `/usage` poll and draws a polyline + cost line. No new endpoint.

## 8. Skins (unified layout, three tints)

All three render the **same v7 layout**; tokens + a few scoped rules differentiate:
- **Arc** — v7's cyan; sphere orb; full ambient layer.
- **Ghost** — light paper + ink; **keeps its ink-network orb** (`--orb-mode: network`); ambient
  damped (`--bloom: 0`, scanline off); white card surfaces. (No more centered-focus layout.)
- **Amethyst** — violet; nebula/sphere orb; rounded-glass card surfaces via tokens. (No more bento.)

`SkinPicker` (Settings → Appearance) + the top-bar skin-cycle both drive `SkinProvider`; the
blur-mask crossfade + no-flash load are kept.

## 9. Out of scope

- Toasts; interaction sounds.
- Any backend change (no new endpoints, no schema changes, no tool changes).
- Connection on/off toggles (status stays derived).
- A vault "pin" flag (Memory view approximates pinned with recent/important for now).

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Paginated chat buries the confirm card | Confirm card is a pinned element, always shown when `pending`, independent of page. |
| WebGL context leak when orb unmounts on view switch | Explicit dispose on unmount; verify across repeated switches. |
| Node labels drift during orb size transition | Re-anchor labels to track the orb (closes the open bug). |
| IBM Plex via runtime fetch slows paint | Self-host via `next/font` (build-time), matching the current zero-network-font rule. |
| Reduced-motion users get heavy ambient/orb motion | Honor `prefers-reduced-motion` + the Settings toggle across ambient layer + orb. |
| Big restructure breaks a wire | Incremental, one component per commit, live-HUD + `tsc` verified each step; behavior fns untouched. |

## 11. Verification

- Per-step: live HUD against the real backend; **real Playwright clicks** (not programmatic) for any
  hit-testing/overlay-sensitive change; `tsc --noEmit` clean.
- Cross-skin QA: Arc / Ghost / Amethyst, each — HUD + boot + all five views + the confirm flow.
- Reduced-motion pass. Zero WebGL leak on repeated view switches. Backend 130-test fast suite green.

## 12. Branch & merge

- New branch `redesign/hud-v7` off `fix/hud-briefing-greeting-weather-boot` HEAD (inherits the
  briefing/weather/boot/orb fixes).
- The fix branch can still ff-merge to `main` independently.
- The redesign merges after full cross-skin live verification.
