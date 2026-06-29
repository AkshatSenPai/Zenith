# Zenith HUD — v7 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-dress the entire Zenith HUD to match the v7 Claude-design prototype while keeping every piece of existing behavior (live wiring, confirm gate, real R3F orb, three skins), plus a few chosen new features.

**Architecture:** Token-first re-skin **in place**. Update the CSS-variable token layer + Tailwind to v7's values, swap in IBM Plex, restructure `page.tsx` into v7's unified layout + icon-strip router, then restyle each component while keeping its props/state/fetches/handlers untouched. New features are new components calling existing endpoints. Backend is **never touched**.

**Tech Stack:** Next.js 14 (App Router) · React 18 · TypeScript · Tailwind 3.4 (CSS-var themed) · react-three-fiber / three / drei / postprocessing (orb) · `next/font/google` (fonts).

## Global Constraints

- **Backend is untouched.** No new endpoints, no tool changes, no schema changes. The 130-test backend fast suite must stay green.
- **No new runtime font fetch.** IBM Plex via `next/font/google` (self-hosted at build), matching the existing zero-network-font rule.
- **No new dependencies** unless a task explicitly adds one (none are planned — Plex ships with `next/font`).
- **No frontend test runner exists** (no `test` script in `frontend/package.json`). Do **not** add one (YAGNI). Per-task verification = `npx tsc --noEmit` clean **+** live-HUD check.
- **Real clicks only** for any hit-testing / overlay / collapse behavior in Playwright (`browser_click`), then confirm with `elementFromPoint` / screenshot. Never programmatic `.click()` — it bypasses hit-testing and previously masked an overlay bug.
- **Protected, never regress:** the confirm gate (`StatusCard` + `pending`/`resolvePending`/`pendingBody`, incl. the ⚠ untrusted warning); status-driven connections (Google connect/disconnect real, others read-only dots); the real R3F orb (`OrbScene`/`ZenithOrb`); all live wiring in `page.tsx`; accessibility (`:focus-visible`, reduced-motion, ARIA).
- **Skins:** Arc / Ghost / Amethyst — all three render the **one unified v7 layout**; tokens differentiate. Ghost keeps its **ink-network** orb (`--orb-mode: network`) + ink accent; Amethyst keeps violet + rounded-glass card treatment. No bento, no centered-focus layout.
- **Out of scope:** toasts, interaction sounds, fake connection toggles, a vault "pin" flag.
- **Design reference (canonical visual source):** `docs/superpowers/reference/v7/Zenith HUD v7.dc.html` (copied in Task 1) — v7 line numbers cited per task are from this file. Screenshots in the same folder.

---

## Verification harness (used by every task)

Run once, keep running:
- **Backend** (untouched, for live data): `cd backend && .venv/Scripts/python -m uvicorn main:app --port 8000` (use the project's normal launch; backend boot includes warmups so allow ~30-45s).
- **Frontend:** `cd frontend && npm run dev` → http://localhost:3000

Per-task gates (in order):
1. **Type-check:** `cd frontend && npx tsc --noEmit` → must print nothing (clean).
2. **Live check:** open http://localhost:3000 in the Playwright MCP browser, perform the task's stated check across the relevant skins (cycle skin via Settings → Appearance or the top-bar chip). Use **real clicks**.
3. **Commit** the listed files.

Backend regression (Task 20 only): `cd backend && python -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py` → all green.

---

## File structure (created / modified / retired)

**Created**
- `frontend/lib/nav.ts` — `View` type + `NAV_ITEMS` (shared by IconNav, CommandPalette, page).
- `frontend/lib/prefs.ts` — reduced-motion get/set (localStorage + `<html data-reduce-motion>`).
- `frontend/components/IconNav.tsx` — 74px icon strip; drives the router.
- `frontend/components/MonthRuler.tsx` — day ruler under the top bar.
- `frontend/components/AmbientBackground.tsx` — v7 background particle/grid canvas (token-gated).
- `frontend/components/CollapsibleSection.tsx` — reusable collapsible right-rail section.
- `frontend/components/Sparkline.tsx` — small SVG polyline for usage.
- `frontend/components/ShortcutsPanel.tsx` — keyboard-hints block (left rail).
- `frontend/components/CommandPalette.tsx` — ⌘K palette.
- `frontend/components/MemoryView.tsx` — vault overview (replaces VaultView's "memory" role).
- `frontend/components/NotesView.tsx` — notes list + detail (replaces `VaultView mode="recent"`).
- `frontend/components/ClientsView.tsx` — clients list + client detail (replaces `VaultView mode="clients"`).

**Modified**
- `frontend/tailwind.config.ts` — add v7 token colors (text hierarchy, lines, panel).
- `frontend/app/globals.css` — v7 token values per skin; ambient styles; remove bento + helper layout rules; reduced-motion attribute rule.
- `frontend/app/layout.tsx` — IBM Plex (shared font); reduced-motion no-flash script.
- `frontend/app/page.tsx` — unified layout + router; remove `ghost`/`amethyst`/`sideless` branches; wire new chrome/views. **All handlers/state preserved.**
- `frontend/components/TopBar.tsx` — v7 top bar (+ skin-cycle + ⌘K button); drop `minimal`.
- `frontend/components/CalendarPanel.tsx` — compact Schedule card.
- `frontend/components/QuickActions.tsx`, `UsagePanel.tsx`, `ConnectionsPanel.tsx`, `FocusCard.tsx`, `ActivityLog.tsx`, `StatusCard.tsx`, `CommandCenter.tsx`, `BootScreen.tsx`, `SettingsView.tsx`, `StatusLabel.tsx`, `components/hud/primitives.tsx`, `ZenithOrb.tsx`, `OrbScene.tsx` — restyle to v7 (wiring preserved).

**Retired** (deleted in the task that supersedes them)
- `frontend/components/ContextRail.tsx` (→ IconNav, Task 4).
- `frontend/components/VaultView.tsx` (→ Memory/Notes/Clients views, Task 16).
- `frontend/components/LeftRailExtras.tsx`, `GaugeIndicator.tsx` (→ folded into the new rails / removed if unused, Task 6/7).

---

## Phase A — Foundation

### Task 1: IBM Plex + token plumbing + Arc/Amethyst values + design reference

**Files:**
- Create: `docs/superpowers/reference/v7/` (copy `Zenith HUD v7.dc.html` + the 3 screenshots from `Downloads/UIUX improvement review p2/`)
- Modify: `frontend/app/layout.tsx`, `frontend/tailwind.config.ts`, `frontend/app/globals.css`

**Interfaces:**
- Produces: CSS vars per skin — text hierarchy `--c-hi/--c-mid/--c-lo/--c-dim/--c-faint` (space-separated RGB channels), `--line`/`--line2`/`--panel` (baked rgba). Tailwind colors: `zenith.hi/mid/lo/dim/faint` (alpha-aware), `zenith.line/line2/panel` (no alpha). Shared font = IBM Plex.

- [ ] **Step 1: Copy the v7 reference into the repo**

```bash
mkdir -p "docs/superpowers/reference/v7"
cp "/c/Users/Akshat Singh/Downloads/UIUX improvement review p2/Zenith HUD v7.dc.html" "docs/superpowers/reference/v7/"
cp "/c/Users/Akshat Singh/Downloads/UIUX improvement review p2/screenshots/"*.png "docs/superpowers/reference/v7/"
```

- [ ] **Step 2: Swap fonts to IBM Plex in `layout.tsx`**

Replace the `Space_Grotesk/Inter/JetBrains_Mono` imports + vars with Plex (Plex Sans → display+body, Plex Mono → mono):

```tsx
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-mono" });
const fontVars = `${plexSans.variable} ${plexMono.variable}`;
```

Keep the `noFlashSkin` script and `<html className={fontVars}>`.

- [ ] **Step 3: Point the shared font vars at Plex (globals.css `:root`)**

In `:root`, set:
```css
--font-display: var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif;
--font-body: var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif;
--font-mono: var(--font-plex-mono), ui-monospace, monospace;
```
**Delete** the `[data-skin="arc"]` font remap block (the Space Grotesk / Inter / JetBrains Mono override) — Plex is now shared by all skins.

- [ ] **Step 4: Add the v7 text/line/panel tokens to each skin block in globals.css**

Arc (`:root, [data-skin="arc"]`) — append (values from v7 `THEMES.arc`, reference html lines ~608):
```css
--c-hi: 230 242 241; --c-mid: 201 214 217; --c-lo: 126 144 148; --c-dim: 79 97 102; --c-faint: 42 58 61;
--line: rgba(120,200,200,.08); --line2: rgba(120,200,200,.16); --panel: rgba(255,255,255,.02);
```
Amethyst (`[data-skin="amethyst"]`) — append (v7 `THEMES.amethyst`, lines ~613):
```css
--c-hi: 240 231 251; --c-mid: 220 205 239; --c-lo: 137 123 162; --c-dim: 90 77 116; --c-faint: 51 40 80;
--line: rgba(176,108,240,.12); --line2: rgba(176,108,240,.24); --panel: rgba(176,108,240,.05);
```
Ghost (`[data-skin="ghost"]`) — append (v7 `THEMES.light` hierarchy, lines ~618, but Ghost keeps its ink accent + network orb already set):
```css
--c-hi: 14 23 25; --c-mid: 38 56 59; --c-lo: 95 113 116; --c-dim: 138 154 156; --c-faint: 188 200 201;
--line: rgba(20,60,58,.12); --line2: rgba(20,60,58,.22); --panel: rgba(12,32,32,.03);
```

- [ ] **Step 5: Expose the new tokens in `tailwind.config.ts`**

In `theme.extend.colors.zenith`, add:
```ts
hi:    "rgb(var(--c-hi) / <alpha-value>)",
mid:   "rgb(var(--c-mid) / <alpha-value>)",
lo:    "rgb(var(--c-lo) / <alpha-value>)",
dim:   "rgb(var(--c-dim) / <alpha-value>)",
faint: "rgb(var(--c-faint) / <alpha-value>)",
line:  "var(--line)",
line2: "var(--line2)",
panel: "var(--panel)",
```

- [ ] **Step 6: Type-check + live check**

Run: `cd frontend && npx tsc --noEmit` → clean.
Live: load the HUD in all 3 skins. Expected: text now renders in IBM Plex; nothing crashes; existing layout still works (it still uses old classes — that's fine). Fonts visibly changed.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/reference/v7 frontend/app/layout.tsx frontend/app/globals.css frontend/tailwind.config.ts
git commit -m "feat(hud): IBM Plex + v7 design tokens (text hierarchy/line/panel) per skin"
```

### Task 2: Ambient background layer

**Files:**
- Create: `frontend/components/AmbientBackground.tsx`
- Modify: `frontend/app/globals.css` (ambient overlay classes), `frontend/app/page.tsx` (mount it)

**Interfaces:**
- Produces: `<AmbientBackground />` — a fixed, `pointer-events-none`, `z-0` full-viewport client component rendering a `<canvas>` particle/grid field whose color reads `--orb-color` and density damps under reduced motion.

- [ ] **Step 1: Build `AmbientBackground.tsx`**

A `"use client"` component: a `<canvas>` filling the viewport (`position:fixed; inset:0; z-index:0; pointer-events:none`). In a `useEffect`, run a rAF loop drawing ~60 slow-drifting dots + faint grid lines using the computed value of `--orb-color` (read via `getComputedStyle(document.documentElement)`). Reference: v7 `bgRef` loop (html lines ~981–990). Stop the loop on unmount (`cancelAnimationFrame`). If `matchMedia('(prefers-reduced-motion: reduce)').matches` **or** `document.documentElement.dataset.reduceMotion === 'true'`, draw a single static frame (no rAF).

- [ ] **Step 2: Add the static CSS ambient overlays to globals.css**

Add token-gated overlays (scanline, top scan-beam, vignette) as utility classes applied in page.tsx, e.g.:
```css
.amb-scanline { position:absolute; inset:0; z-index:1; pointer-events:none;
  background:repeating-linear-gradient(to bottom, rgb(var(--c-faint)/.06) 0 1px, transparent 1px 3px);
  opacity:var(--scanline-op, .6); }
.amb-vignette { position:absolute; inset:0; z-index:1; pointer-events:none;
  background:radial-gradient(ellipse 70% 60% at 50% 48%, transparent 40%, rgb(0 0 0/.5) 100%); }
```
Ghost already sets `--scanline-op` low/0; ensure `[data-skin="ghost"]` sets `--scanline-op: 0`.

- [ ] **Step 3: Mount in page.tsx**

Replace the existing `.bg-aura` / `.bg-grain` ambient divs with `<AmbientBackground />` + `<div className="amb-scanline" />` + `<div className="amb-vignette" />` at the top of the root container (keep `HexCorners` — it already matches the HUD corner-accent idiom and Ghost hides it as today).

- [ ] **Step 4: Type-check + live check**

`npx tsc --noEmit` → clean. Live: subtle drifting field visible behind content in Arc/Amethyst; calm/!static in Ghost and under OS reduced-motion. No interaction is blocked (pointer-events none — verify a button under it still clicks via real click).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/AmbientBackground.tsx frontend/app/globals.css frontend/app/page.tsx
git commit -m "feat(hud): v7 ambient background field + scanline/vignette (token-gated, reduced-motion aware)"
```

---

## Phase B — Structure pivot

### Task 3: IconNav + MonthRuler + shared nav model

**Files:**
- Create: `frontend/lib/nav.ts`, `frontend/components/IconNav.tsx`, `frontend/components/MonthRuler.tsx`

**Interfaces:**
- Produces:
  - `lib/nav.ts`: `export type View = "chat" | "memory" | "clients" | "notes" | "settings";` and `export const NAV_ITEMS: { id: View; label: string }[]` in v7 order (Chat, Memory, Clients, Notes, Settings).
  - `IconNav`: `export function IconNav({ view, onChange }: { view: View; onChange: (v: View) => void })` — 74px-wide `<nav>`, one button per `NAV_ITEMS` entry (icon + tiny mono label), active item shows the accent left-bar; matches v7 lines ~137–150.
  - `MonthRuler`: `export function MonthRuler()` — self-contained day ruler (1..daysInMonth) with today highlighted; matches v7 lines ~120–131.

- [ ] **Step 1: Write `lib/nav.ts`** (View + NAV_ITEMS).
- [ ] **Step 2: Write `MonthRuler.tsx`** (computes month/days/today from `new Date()`; mono labels; accent tick on today).
- [ ] **Step 3: Write `IconNav.tsx`** (buttons from NAV_ITEMS; inline SVG icons; `bg`/`color`/left-bar from active state; `aria-current` on active; `:focus-visible`).
- [ ] **Step 4: Type-check** `npx tsc --noEmit` → clean. (Not yet mounted — no live check; render is exercised in Task 4.)
- [ ] **Step 5: Commit**

```bash
git add frontend/lib/nav.ts frontend/components/IconNav.tsx frontend/components/MonthRuler.tsx
git commit -m "feat(hud): IconNav router strip + MonthRuler + shared nav model"
```

### Task 4: Restructure page.tsx → unified v7 layout + router

**Files:**
- Modify: `frontend/app/page.tsx`, `frontend/app/globals.css` (remove `.bento` + amethyst bento rules; keep amethyst rounded-glass + ghost white-card treatments)
- Delete: `frontend/components/ContextRail.tsx`

**Interfaces:**
- Consumes: `IconNav`, `MonthRuler`, `View` (Task 3); all existing components + handlers.
- Produces: the unified grid `grid-cols-[74px_288px_1fr_316px]` with a center router; `view` state typed `View`; same layout for all skins.

- [ ] **Step 1: Replace navigation + layout scaffold**
  - Import `View`/`IconNav`/`MonthRuler` from the new modules; remove the `ContextRail` import and the `import ... View` from it.
  - Change `useState<View>("chat")` to use the new `View`; rename the old `"drafts"` view to `"notes"` and add `"memory"`.
  - Delete `ghost`/`amethyst`/`sideless` booleans and every branch keyed on them (the bento JSX block at lines ~413–474, the Ghost orb-size special-case, the Ghost corner usage readout, `TopBar minimal`, the `sideless` grid-cols switch).
  - New root: `<TopBar onOpenPalette={...stub...} />` then `<MonthRuler />` then a single grid row:
    ```tsx
    <div className="grid min-h-0 grid-cols-[74px_288px_1fr_316px]">
      <IconNav view={view} onChange={setView} />
      <aside className="hud-scroll ... border-r border-zenith-line">{/* left rail: CalendarPanel, QuickActions, UsagePanel, ShortcutsPanel */}</aside>
      <main className="relative z-10 flex min-h-0 flex-col">{/* router (Step 2) */}</main>
      <aside className="hud-scroll ... border-l border-zenith-line">{/* right rail: ConnectionsPanel, FocusCard, ActivityLog */}</aside>
    </div>
    ```
    Keep all the existing wiring props on each component exactly as they are today.
- [ ] **Step 2: Center router** — replace the `view === "chat" ? ... : settings : clients : drafts : placeholder` tree with:
  ```tsx
  {view === "chat" ? (/* chat: existing inline JSX — orb + StatusLabel + confirm card + CommandCenter */)
   : view === "memory" ? <MemoryView />
   : view === "clients" ? <ClientsView />
   : view === "notes" ? <NotesView />
   : <SettingsView .../>}
  ```
  Keep the chat as **inline JSX** in the `view==="chat"` branch (do NOT extract a `ChatView` component — it stays inline; the orb + StatusLabel + confirm card + CommandCenter keep their existing styling, restyled in Phase E). For THIS task, `MemoryView`/`ClientsView`/`NotesView` don't exist yet — temporarily render the existing `VaultView`/`PlaceholderView` in those slots (`view==="clients" ? <VaultView mode="clients" title="Clients" />`, `view==="notes" ? <VaultView mode="recent" title="Notes" />`, `view==="memory" ? <PlaceholderView view="memory" />`). They're swapped in Tasks 14–16.
- [ ] **Step 3: globals.css** — delete the `.bento*` blocks (lines ~146–169) and the Ghost centered-focus helpers that are now unused. **Keep** `[data-skin="amethyst"] .hud-card/.panel` rounded-glass and `[data-skin="ghost"] .hud-card/.panel` white-card rules.
- [ ] **Step 4: Delete `ContextRail.tsx`.**
- [ ] **Step 5: Type-check + live check** — `npx tsc --noEmit` clean. Live (all 3 skins, **real clicks**): top bar + ruler render; the 5 nav icons switch the center view; **chat works end-to-end** (type a message → reply; push-to-talk; trigger an action → confirm card appears above the command center → Confirm runs it); connections/usage/activity/focus all show live data; no skin shows bento/centered-focus anymore. May look rough — that's expected pre-restyle.
- [ ] **Step 6: Commit**

```bash
git add frontend/app/page.tsx frontend/app/globals.css
git rm frontend/components/ContextRail.tsx
git commit -m "refactor(hud): unified v7 layout + icon-strip router (all skins; wiring preserved)"
```

---

## Phase C — Top bar + left rail

### Task 5: TopBar restyle (+ skin-cycle + ⌘K button)

**Files:** Modify `frontend/components/TopBar.tsx`, `frontend/app/page.tsx` (pass `onOpenPalette`)

**Interfaces:**
- Produces: `export function TopBar({ onOpenPalette }: { onOpenPalette: () => void })` — v7 header (lines ~87–118): diamond + `ZENITH` wordmark + `HUD V7` badge; centered date/time; `ONLINE`/offline chip (reads existing backend state if passed, else static ONLINE); a `⌘K` button (`onClick={onOpenPalette}`); a skin-cycle chip using `useSkin()` to rotate arc→ghost→amethyst. **No sound button.**

- [ ] **Step 1:** Rewrite TopBar markup to v7 using `zenith.hi/mid/lo/dim` + `zenith.line2` + `zenith.cyan` (accent). Remove the `minimal` prop. Add the skin-cycle button (cycles `useSkin().setSkin`) and the ⌘K button.
- [ ] **Step 2:** In page.tsx pass `onOpenPalette` — for now a stub `() => {}` (wired in Task 17).
- [ ] **Step 3: Type-check + live check** — clean; date/time live; skin-cycle chip rotates all 3 skins with the crossfade; ⌘K button present (no-op for now). `:focus-visible` rings on buttons.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/TopBar.tsx frontend/app/page.tsx
git commit -m "style(hud): v7 top bar (skin-cycle + Cmd-K button; drop minimal/sound)"
```

### Task 6: Left rail — Schedule + QuickActions + Shortcuts

**Files:** Modify `frontend/components/CalendarPanel.tsx`, `frontend/components/QuickActions.tsx`; Create `frontend/components/ShortcutsPanel.tsx`; Modify `frontend/app/page.tsx`; delete `LeftRailExtras.tsx` if now unused.

**Interfaces:**
- Produces: `CalendarPanel` restyled as the compact **Schedule** card (date chip + weekday + Today/Tomorrow rows; v7 lines ~154–175) keeping its `/calendar/events` fetch. `QuickActions` as a 2-col grid (v7 lines ~177–187) keeping `onPrefill`/`onBriefing`. `ShortcutsPanel` (v7 lines ~217–227) — static keyboard hints (`Space` talk, `⌘K` palette, `Enter` send).

- [ ] **Step 1:** Restyle `CalendarPanel` to the v7 Schedule card (keep data fetching + Retry/empty states).
- [ ] **Step 2:** Restyle `QuickActions` to the v7 grid (keep callbacks + the briefing greeting label from `briefingGreeting()`).
- [ ] **Step 3:** Create `ShortcutsPanel.tsx` (pure presentational).
- [ ] **Step 4:** In page.tsx left rail, order: `CalendarPanel`, `QuickActions`, `UsagePanel` (restyled in Task 7), `ShortcutsPanel`. Remove `LeftRailExtras` usage; `git rm` it if nothing else imports it.
- [ ] **Step 5: Type-check + live check** — clean; left rail matches v7; Schedule shows live events (or empty state); quick actions prefill/briefing still work (**real click** the briefing button → spoken reply).
- [ ] **Step 6: Commit**

```bash
git add frontend/components/CalendarPanel.tsx frontend/components/QuickActions.tsx frontend/components/ShortcutsPanel.tsx frontend/app/page.tsx
git rm frontend/components/LeftRailExtras.tsx   # only if unused
git commit -m "style(hud): v7 left rail — Schedule + Quick Actions + Shortcuts"
```

### Task 7: UsagePanel restyle + Sparkline

**Files:** Create `frontend/components/Sparkline.tsx`; Modify `frontend/components/UsagePanel.tsx`, `frontend/app/page.tsx`

**Interfaces:**
- Consumes: existing `Usage` type + `/usage` poll in page.tsx.
- Produces: `Sparkline({ points }: { points: number[] })` → SVG polyline+area, `viewBox="0 0 120 26"`, auto-scaled. `UsagePanel` gains an optional `history?: number[]` prop (cumulative `tokens_today` samples); renders meters (REQ/MIN, DAILY, TOKENS) + the sparkline (when ≥2 points) + the cost line + OK/Tripped chip — v7 lines ~189–215.

- [ ] **Step 1: Write `Sparkline.tsx`** (pure function):

```tsx
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1), min = Math.min(...points);
  const span = max - min || 1;
  const xs = (i: number) => (i / (points.length - 1)) * 120;
  const ys = (v: number) => 26 - ((v - min) / span) * 24 - 1;
  const line = points.map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const area = `0,26 ${line} 120,26`;
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" className="block h-[26px] w-full">
      <polyline points={area} fill="rgb(var(--zenith-cyan)/0.10)" stroke="none" />
      <polyline points={line} fill="none" stroke="rgb(var(--zenith-cyan))" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Accumulate the session series in page.tsx**

Add `const [usageHistory, setUsageHistory] = useState<number[]>([]);` and, inside `refreshUsage` after `setUsage(u)`, append (cap at 60 samples):
```tsx
setUsageHistory((h) => (h.length && h[h.length - 1] === u.tokens_today ? h : [...h, u.tokens_today].slice(-60)));
```
Pass `history={usageHistory}` to every `<UsagePanel ... />`.

- [ ] **Step 3:** Restyle `UsagePanel` to v7 meters + add `<Sparkline points={history ?? []} />` above the cost line. Keep the `error`/`onRetry` Retry state.
- [ ] **Step 4: Type-check + live check** — clean; usage panel matches v7; after a couple of `/chat` turns the sparkline draws; killswitch chip still flips on cap.
- [ ] **Step 5: Commit**

```bash
git add frontend/components/Sparkline.tsx frontend/components/UsagePanel.tsx frontend/app/page.tsx
git commit -m "feat(hud): v7 usage panel + session token sparkline"
```

---

## Phase D — Right rail

### Task 8: Collapsible section + ConnectionsPanel restyle

**Files:** Create `frontend/components/CollapsibleSection.tsx`; Modify `frontend/components/ConnectionsPanel.tsx`, `frontend/app/page.tsx`

**Interfaces:**
- Produces: `CollapsibleSection({ title, storageKey, defaultOpen, right, children })` — header row (mono title + optional `right` node + chevron), body shown/hidden; open-state persisted to `localStorage[storageKey]`; chevron rotates; `aria-expanded` on the header button. `right` is an optional ReactNode (e.g. a count). `ConnectionsPanel` wrapped in it (title `CONNECTIONS`), v7 lines ~511–538 — **keeping** the real Google connect/disconnect + read-only status dots (no toggles); the panel keeps its own LIVE/offline chip in its body as today.

- [ ] **Step 1: Write `CollapsibleSection.tsx`** (internal `useState` seeded from localStorage; toggle persists; `prefers-reduced-motion` removes the height transition).
- [ ] **Step 2:** Restyle `ConnectionsPanel` to v7 rows (status dot + name + detail; Google row keeps its `DISCONNECT`/connect; others are dots). Keep `connections`, `status`, `onConnect`, `onDisconnect`, `connectError`, `backendState` props.
- [ ] **Step 3:** In the page.tsx right rail wrap it: `<CollapsibleSection title="CONNECTIONS" storageKey="zenith.collapse.conn" defaultOpen><ConnectionsPanel .../></CollapsibleSection>` (the LIVE/offline indicator stays inside `ConnectionsPanel`, as today).
- [ ] **Step 4: Type-check + live check** (**real clicks**) — clean; collapsing/expanding works and persists across reload; Google connect/disconnect still functions; status dots reflect live `/status`.
- [ ] **Step 5: Commit**

```bash
git add frontend/components/CollapsibleSection.tsx frontend/components/ConnectionsPanel.tsx frontend/app/page.tsx
git commit -m "feat(hud): collapsible right-rail section + v7 Connections (status-driven preserved)"
```

### Task 9: FocusCard → Today's Focus

**Files:** Modify `frontend/components/FocusCard.tsx`, `frontend/app/page.tsx`

**Interfaces:** Produces FocusCard restyled to v7 "Today's Focus" (v7 lines ~541–560): checklist rows with a check box + strike-through on done + an inline `add a task…` input with `+`. Keeps all existing `/todos` GET/POST/PATCH and window-focus refetch.

- [ ] **Step 1:** Restyle FocusCard markup/classes to v7; keep every handler and the editable add/toggle behavior.
- [ ] **Step 2:** Wrap in `CollapsibleSection` (title `TODAY'S FOCUS`, `right` = count, `storageKey="zenith.collapse.focus"`).
- [ ] **Step 3: Type-check + live check** (**real clicks**) — clean; add a todo → appears + persists; toggle strikes through; voice-added items appear on window focus.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/FocusCard.tsx frontend/app/page.tsx
git commit -m "style(hud): v7 Today's Focus card (todos wiring preserved)"
```

### Task 10: ActivityLog restyle

**Files:** Modify `frontend/components/ActivityLog.tsx`, `frontend/app/page.tsx`

**Interfaces:** ActivityLog restyled to v7 (lines ~562–580: time + text rows; empty/loading/Retry states kept), wrapped in `CollapsibleSection` (title `ACTIVITY LOG`, `storageKey="zenith.collapse.log"`).

- [ ] **Step 1:** Restyle rows + keep `/activity` fetch + loading/empty/Retry states.
- [ ] **Step 2:** Wrap in `CollapsibleSection`.
- [ ] **Step 3: Type-check + live check** — clean; log shows live entries after a tool runs; collapses/persists.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/ActivityLog.tsx frontend/app/page.tsx
git commit -m "style(hud): v7 Activity Log (collapsible; wiring preserved)"
```

---

## Phase E — Chat view

### Task 11: Orb node-label chips + WebGL dispose + drift fix

**Files:** Modify `frontend/components/OrbScene.tsx`, `frontend/components/ZenithOrb.tsx` (and the node-label render therein)

**Interfaces:** Keeps `ZenithOrb({ state, connections, bars })`. Node labels (drei `<Html>`) restyled to v7 chip look (lines ~243–246: bg `--bg`, hairline accent border, status dot + mono label); labels track the orb smoothly during size transitions; the R3F `<Canvas>`/WebGL context disposes on unmount.

- [ ] **Step 1:** Restyle the 4 node-label chips (Gmail/Calendar/Telegram/Discord) to v7 using `zenith.bg`/`zenith.line2`/`zenith.cyan`/`zenith.lo`; lit when connected, dim when not (drive from `connections`).
- [ ] **Step 2: Drift fix** — anchor the labels so they don't slide during the orb's width/size transition (position them relative to the orb's CSS box, not the lagging WebGL projection). Verify center stays put while the orb resizes.
- [ ] **Step 3: Dispose on unmount** — ensure the r3f `<Canvas>` releases its WebGL context when the chat view unmounts. In `OrbScene`, add a cleanup that calls `gl.dispose()` / `forceContextLoss()` on unmount (drei `<Canvas>`: use `onCreated={({ gl }) => ...}` to stash, dispose in a `useEffect` cleanup), so repeated view switches don't leak contexts.
- [ ] **Step 4: Type-check + live check** (**real clicks**) — clean; nodes look v7; switch Chat→Memory→Chat ~10× and confirm (DevTools) no "too many WebGL contexts" warning and the orb still renders; node labels don't drift when the orb resizes.
- [ ] **Step 5: Commit**

```bash
git add frontend/components/OrbScene.tsx frontend/components/ZenithOrb.tsx
git commit -m "fix(hud): v7 orb node chips + label-drift fix + WebGL dispose on view switch"
```

### Task 12: CommandCenter → paginated + waveform

**Files:** Modify `frontend/components/CommandCenter.tsx`, `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `messages: Message[]`, `loading`, `input`, voice handlers, `inputRef` (all existing).
- Produces: a paginated CommandCenter — one turn per page (prev/next, page label `n/total`, role chip, typing caret on the latest assistant turn), the mic+send input row, and the STATUS + waveform row above it. Drops the `minimized`/`onMinimize`/`onRestore`/`expanded` props (the orb no longer recedes). v7 lines ~249–300.

- [ ] **Step 1: Pagination state** — in CommandCenter:
```tsx
const [page, setPage] = useState(0);
const total = messages.length;
useEffect(() => { setPage(Math.max(0, total - 1)); }, [total]); // auto-advance to latest
const clamped = Math.min(page, Math.max(0, total - 1));
const msg = messages[clamped];
const canPrev = clamped > 0, canNext = clamped < total - 1;
```
Render: header (status dot + `COMMAND CENTER` + `‹ n/total ›` controls), body (empty hint when `total===0`; else the `msg` with role chip + `Markdown` + a blinking caret when `loading && role==="assistant" && isLatest`), then the input row (mic hold-to-talk + send). Keep `onSend`/`onKeyDown`/`onMicDown`/`onMicUp`/`inputRef`.
- [ ] **Step 2: STATUS + waveform row** — above the card, render `STATUS <StatusLabel>` + a small `<canvas>`/bars driven by the existing `bars` prop (pass `bars` from page.tsx; reuse the `voice.ts` bar values already computed). v7 lines ~249–255.
- [ ] **Step 3: page.tsx** — remove `ccMinimized`/`orbBig`/`ccExpanded` state + the auto-restore effect; render the chat view as: fixed-size orb → STATUS+waveform → confirm card (Task 13) → `<CommandCenter messages loading error warning input onInput onSend onKeyDown inputRef voiceState bars onMicDown onMicUp />`. Give the orb a fixed responsive size (e.g. `w-[min(46vw,52vh)] max-w-[520px] aspect-square`).
- [ ] **Step 4: Type-check + live check** (**real clicks**) — clean; multi-turn conversation pages with ‹ ›; new reply auto-jumps to latest; caret blinks while streaming; push-to-talk + send both work; waveform animates while listening/speaking.
- [ ] **Step 5: Commit**

```bash
git add frontend/components/CommandCenter.tsx frontend/app/page.tsx
git commit -m "feat(hud): paginated Command Center (one turn/page) + status/waveform row"
```

### Task 13: Confirm card (StatusCard) restyle + pinned placement

**Files:** Modify `frontend/components/StatusCard.tsx`, `frontend/app/page.tsx`

**Interfaces:** Keeps `StatusCard({ tone, title, children, onConfirm, onCancel, busy })` and the `pendingBody`/`resolvePending` wiring. Restyled to v7; rendered as a **pinned element between the STATUS row and the CommandCenter**, shown only when `pending`, always visible regardless of the CommandCenter page.

- [ ] **Step 1:** Restyle `StatusCard` to v7 (notched/corner accents using `zenith.alert` for the action tone; Confirm/Cancel buttons; keep the ⚠ untrusted warning passed via `pendingBody`). Keep the `tone`/`busy` API.
- [ ] **Step 2:** Confirm placement in page.tsx chat view: `{pending && <div className="mb-2 w-full max-w-[720px]"><StatusCard tone="alert" title="Action — confirm before it runs" busy={loading} onConfirm={() => resolvePending(true)} onCancel={() => resolvePending(false)}>{pendingBody}</StatusCard></div>}` — directly above `<CommandCenter />`. (`pendingBody` unchanged.)
- [ ] **Step 3: Type-check + live check** (**real clicks**) — clean; trigger an action (e.g. "send a test email to me") → the ⚠/confirm card shows above the command center and stays visible even when you page the conversation; Confirm runs it; Cancel aborts; the untrusted ⚠ banner shows for read-tool-triggered actions.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/StatusCard.tsx frontend/app/page.tsx
git commit -m "style(hud): v7 confirm card, pinned above the paginated Command Center"
```

---

## Phase F — Center views

### Task 14: MemoryView

**Files:** Create `frontend/components/MemoryView.tsx`; Modify `frontend/app/page.tsx`

**Interfaces:** `export function MemoryView()` — full center view (v7 lines ~387–433): header (`Memory` + `N NOTES`), a "PINNED CONTEXT" grid (mapped to the most-recent/important notes), and a "VAULT" grid of note cards with tag + preview + `[[link]]`. Fetches via the existing `/vault/notes` (+ `/vault/note` on select) — reuse the fetch helpers from the current `VaultView`.

- [ ] **Step 1:** Build `MemoryView` reading `/vault/notes`; "pinned" = the first few recent notes (no backend pin flag — comment this). Card grid with tag/preview; selecting opens the note body (`/vault/note`).
- [ ] **Step 2:** Wire into page.tsx router: `view === "memory" ? <MemoryView /> : ...` (replace the Task-4 placeholder).
- [ ] **Step 3: Type-check + live check** — clean; Memory view lists real vault notes; opening one shows its body; all 3 skins.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/MemoryView.tsx frontend/app/page.tsx
git commit -m "feat(hud): v7 Memory view over the vault"
```

### Task 15: NotesView

**Files:** Create `frontend/components/NotesView.tsx`; Modify `frontend/app/page.tsx`

**Interfaces:** `export function NotesView()` — list + detail (v7 lines ~303–336): left note list, right body; checklist-style notes render as task rows, text notes as pre-wrapped body. Uses `/vault/notes` + `/vault/note` (recent scope).

- [ ] **Step 1:** Build `NotesView` (port the recent-mode behavior from `VaultView`, v7 list+detail styling).
- [ ] **Step 2:** Router: `view === "notes" ? <NotesView /> : ...`.
- [ ] **Step 3: Type-check + live check** — clean; notes list + detail work; selecting updates the body.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/NotesView.tsx frontend/app/page.tsx
git commit -m "feat(hud): v7 Notes view"
```

### Task 16: ClientsView + retire VaultView

**Files:** Create `frontend/components/ClientsView.tsx`; Modify `frontend/app/page.tsx`; Delete `frontend/components/VaultView.tsx`

**Interfaces:** `export function ClientsView()` — list + client detail (v7 lines ~338–385): client list, right pane with initial avatar, name/location, PROJECT, facts, LINKED NOTES chips. Uses `/vault/notes` (clients scope) + `/vault/note`.

- [ ] **Step 1:** Build `ClientsView` (clients-scope of the vault, v7 client-detail styling).
- [ ] **Step 2:** Router: `view === "clients" ? <ClientsView /> : ...`. Remove the last `VaultView` references; `git rm frontend/components/VaultView.tsx`.
- [ ] **Step 3: Type-check + live check** — clean; clients list + detail render real client notes; no remaining `VaultView` import.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/ClientsView.tsx frontend/app/page.tsx
git rm frontend/components/VaultView.tsx
git commit -m "feat(hud): v7 Clients view; retire VaultView"
```

---

## Phase G — Palette, boot, settings

### Task 17: Command palette (⌘K)

**Files:** Create `frontend/components/CommandPalette.tsx`; Modify `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `View`/`NAV_ITEMS`, `setView`, the quick-action callbacks (`runBriefing`, `prefillInput`), `/vault/notes`.
- Produces: `CommandPalette({ open, onClose, onNavigate, onAction })` — overlay (v7 lines ~53–74) with a search input + grouped results (NAV, ACTIONS, VAULT). ⌘K toggles it (global key handler in page.tsx); ESC/backdrop closes; ↑/↓ move, Enter runs.

- [ ] **Step 1: Build `CommandPalette.tsx`** — a `Command = { id; label; sub?; group: "NAV"|"ACTION"|"VAULT"; run: () => void }` list assembled from: NAV_ITEMS (→ `onNavigate(id)`), actions (Briefing → `onAction("briefing")`, Draft/Log → prefill), and vault notes fetched on open (→ navigate to Notes/Memory). Filter by query (case-insensitive substring on label+sub). Keyboard: ↑/↓ select, Enter `run()`, ESC `onClose()`. Backdrop click closes; `stopPropagation` on the panel. Autofocus the input on open.
- [ ] **Step 2: Wire in page.tsx** — `const [paletteOpen, setPaletteOpen] = useState(false);` a global `keydown` for `(e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'` → `e.preventDefault(); setPaletteOpen(o=>!o)`. Pass `onOpenPalette={() => setPaletteOpen(true)}` to TopBar (replacing the Task-5 stub). Render `<CommandPalette open={paletteOpen} onClose={()=>setPaletteOpen(false)} onNavigate={(v)=>{setView(v);setPaletteOpen(false);}} onAction={(a)=>{ if(a==='briefing') void runBriefing(); setPaletteOpen(false); }} />`.
- [ ] **Step 3: Type-check + live check** (**real clicks** + keyboard) — clean; ⌘K (and the top-bar button) open it; typing filters; Enter on a NAV item switches views; on an action runs it; ESC/backdrop close; the global Space push-to-talk is NOT triggered while the palette input is focused.
- [ ] **Step 4: Commit**

```bash
git add frontend/components/CommandPalette.tsx frontend/app/page.tsx
git commit -m "feat(hud): Cmd-K command palette (nav + actions + vault search)"
```

### Task 18: BootScreen restyle

**Files:** Modify `frontend/components/BootScreen.tsx`

**Interfaces:** Keeps `BootScreen({ onDone })` and the live connection-count logic (from the fix branch). Restyled to v7 boot overlay (lines ~40–51): diamond, spaced `ZENITH` wordmark, progress bar, the `LINKING NEURAL CORE / MOUNTING CHANNELS / GMAIL · OK / …` lines, `CLICK TO SKIP`.

- [ ] **Step 1:** Restyle markup/classes to v7; keep the real `N/4` linked-count + `/health` race + 1.2s timeout logic intact; honor reduced-motion (skip the scan/blink animations).
- [ ] **Step 2: Type-check + live check** — clean; reload → v7 boot shows real connection lines then reveals the HUD; click-to-skip works; all 3 skins.
- [ ] **Step 3: Commit**

```bash
git add frontend/components/BootScreen.tsx
git commit -m "style(hud): v7 boot screen (live connection count preserved)"
```

### Task 19: SettingsView restyle + reduced-motion toggle

**Files:** Create `frontend/lib/prefs.ts`; Modify `frontend/components/SettingsView.tsx`, `frontend/app/layout.tsx`, `frontend/app/globals.css`

**Interfaces:**
- Produces: `prefs.ts` — `getReduceMotion(): boolean`, `setReduceMotion(b: boolean): void` (writes `localStorage['zenith-reduce-motion']` + sets `document.documentElement.dataset.reduceMotion`). SettingsView restyled to v7 (lines ~435–506): Appearance (SkinPicker), Motion (**reduced-motion toggle only — no sound**), Active config (read-only from `/health`), Security. globals.css honors `[data-reduce-motion="true"]`.

- [ ] **Step 1: `prefs.ts`** (get/set as above).
- [ ] **Step 2: layout.tsx** — extend the no-flash inline script to also set `dataset.reduceMotion` from `localStorage['zenith-reduce-motion']` before paint.
- [ ] **Step 3: globals.css** — add `[data-reduce-motion="true"]{ --motion-scale: 0; --scanline-op: 0; }` and a rule that removes ambient/orb idle animation under it (alongside the existing `prefers-reduced-motion` block).
- [ ] **Step 4: SettingsView** — restyle to v7 sections; the Motion section has a `role="switch"` reduced-motion toggle calling `setReduceMotion`; keep Appearance=`SkinPicker`, Active config from `/health`, Security chips. Drop any sound row.
- [ ] **Step 5: Type-check + live check** (**real clicks**) — clean; toggle reduced-motion → ambient/orb calm immediately and the setting persists across reload; skin picker + config + security still correct; all 3 skins.
- [ ] **Step 6: Commit**

```bash
git add frontend/lib/prefs.ts frontend/components/SettingsView.tsx frontend/app/layout.tsx frontend/app/globals.css
git commit -m "feat(hud): v7 Settings + persisted reduced-motion toggle"
```

---

## Phase H — QA

### Task 20: Cross-skin + a11y + leak + regression pass

**Files:** fixes only (any component touched above), as needed.

- [ ] **Step 1: Backend regression** — `cd backend && python -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py` → all green (proves backend untouched).
- [ ] **Step 2: Type-check** — `cd frontend && npx tsc --noEmit` → clean.
- [ ] **Step 3: Cross-skin live matrix** (**real clicks**) — for each of Arc / Ghost / Amethyst: boot screen, all 5 views, a full chat turn, an action → confirm → run, collapse/expand each right-rail section, ⌘K palette, skin-cycle crossfade. Screenshot each skin's chat view.
- [ ] **Step 4: a11y + leak** — OS/Settings reduced-motion calms ambient+orb; `:focus-visible` rings on nav/buttons/inputs; switch Chat↔Memory ~10× with no WebGL-context warning; confirm card stays visible across pagination.
- [ ] **Step 5: Fix any regressions inline**, committing each: `git commit -m "fix(hud): <what>"`.
- [ ] **Step 6: Final commit (if QA notes/docs added)**

```bash
git add -A
git commit -m "test(hud): cross-skin + a11y + leak QA pass for v7 redesign"
```

---

## Self-review notes (coverage)

- **Spec §2 decisions** → Tasks: paginated CC (12), router-nav (3,4), IBM Plex (1), skins refit+unify (1,4), ⌘K (17), Memory view (14), sparkline (7); toasts/sound excluded throughout.
- **Spec §3 non-negotiables** → confirm gate (13), status-driven connections (8), real orb (11), wiring preserved (every task keeps props/handlers; 4 is the structural pivot that proves it), a11y (2,8,17,19,20).
- **Spec §6 tricky bits** → orb-only-in-chat + WebGL dispose (11), confirm × pagination (12,13), node drift (11).
- **Spec §11 verification** → harness section + per-task live checks + Task 20 matrix.
- **Retirements** → ContextRail (4), VaultView (16), LeftRailExtras/GaugeIndicator (6/7 if unused).
