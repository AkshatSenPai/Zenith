# Zenith — Skin / Theme System (design spec)

_Date: 2026-06-22 · **Ghost revised 2026-06-23 (light / ink-network)** · Status: approved · Author: pairing session_

## Goal
Give Zenith switchable **skins**. Today there is one hardcoded cyan look ("Arc").
Add two more — **Ghost** (first) and **Amethyst** (second) — where the *coloring is
totally different* and a skin can also carry a little **UI personality** (treatment +,
for Ghost, layout). Structure stays shared; skins are value-sets, not forks.

## Decisions (locked with owner)
- Build **Ghost first**, then **Amethyst**. Arc (current cyan) stays the default.
- A skin = **color tokens + treatment knobs** (glow, panel tint, border weight, corner
  chamfer, ambient-motion speed, bloom, particle count, **orb mode**).
- **Switcher lives in the Settings view** (currently a placeholder) — a 3-swatch picker,
  applies live, choice persisted.
- **Ghost** = **light / ink-network** (revised 2026-06-23): a near-white **paper** canvas
  (`#F7F7F5`) with graphite-black ink — the *inverse* of the dark HUD. Minimal treatment,
  **Centered-Focus layout** (side dashboard columns hidden), chrome trimmed (hex corners +
  top strip), **one muted amber kept for genuine alerts** (darkened to read on white). The
  orb becomes a **black network/web** (dark nodes + thin neighbour lines, no glow — see Orb
  + Ghost treatment). This **supersedes** the original "mono silver-white on pure black" idea.
- **Amethyst** = violet + **rounded-glass** treatment (rounded corners, glass blur, deeper
  violet glow, airier spacing) + a **Bento** layout (rounded tiles, orb as a 2×2 hero tile,
  calendar as a horizontal event strip, slim full-width command bar). Its own identity, not a
  recolor. (Owner approved the balanced bento mockup, 2026-06-22.)
- Non-goals: voice/confirm-gate/behavior untouched; only these three skins. (The original
  "no light theme" non-goal is **lifted for Ghost** — Ghost is now the light skin, by owner's
  call 2026-06-23.) Both Ghost AND Amethyst carry a layout personality; Arc stays the default
  dashboard.

## Architecture
Single source of truth = **CSS variables**, selected by a `data-skin` attribute on
`<html>`.

- **`components/SkinProvider.tsx`** — React context + `localStorage`. Sets
  `data-skin="arc" | "ghost" | "amethyst"`, exposes `{ skin, setSkin }`. A tiny inline
  script in `<head>` (`app/layout.tsx`) applies the saved skin **before first paint** so
  there is no color flash (standard no-FOUC theme pattern). Default `arc`.
- **`app/globals.css`** — one variable block per skin:
  `:root, [data-skin="arc"] { … }`, `[data-skin="ghost"] { … }`,
  `[data-skin="amethyst"] { … }`. All other CSS reads the vars; the 18 hardcoded
  rgba/hex sites are converted to `rgb(var(--token) / calc(<base> * var(--knob)))`.
- **`tailwind.config.ts`** — colors change from hex to
  `rgb(var(--zenith-cyan) / <alpha-value>)`, with the vars stored as **space-separated
  RGB channels** (`--zenith-cyan: 0 255 229`). Result: every existing
  `text-zenith-cyan`, `border-zenith-cyan/40`, `bg-zenith-bg`, etc. **auto-themes with
  zero component edits**, and all `/opacity` modifiers keep working. The token *name*
  `zenith-cyan` is kept (now means "accent") to avoid a codebase-wide rename. **Note for
  Ghost (light):** the "accent" token resolves to dark graphite ink, so a class like
  `text-zenith-cyan` correctly renders dark-on-light — the inversion is pure value-swap.
- **Orb** (`OrbScene.tsx`) — on skin change, reads the computed CSS vars
  (`--orb-color`, `--orb-cool`, `--orb-core`, `--bloom`, `--particle-count`, `--orb-mode`)
  via `getComputedStyle`, updates the shader uniforms, regenerates the glow-texture
  gradient, and rebuilds geometry only if particle count changed. Keeps CSS as the one
  source of truth even for WebGL.
  - **Ghost runs a second orb mode** (`--orb-mode: network`; Arc/Amethyst = `sphere`): far
    fewer, larger **dark nodes** (~1.4k) joined by thin `LineSegments` between near neighbours
    (within `--orb-link-dist`, alpha `--orb-link-alpha`), with **normal blending and bloom +
    glow OFF**. Audio reactivity drives line opacity/weight + node jitter + a slight outward
    expansion (no brightness pulse — it's ink, not light). **No connection nodes** in Ghost;
    state is read from the mono labels (`LISTENING` / `SPEAKING…`) + subtle web motion. This
    is a render **branch**, not a recolor — Arc/Amethyst keep the glowing point-sphere.
- **Layout** (`app/page.tsx`) — reads `skin` from context; when `skin === "ghost"` it
  does not render the left (calendar / quick actions / usage) or right (connections /
  focus / activity) dashboard columns, hides the hex corners + top timeline strip, and
  shows a one-line usage readout. Conditional rendering only — panels are untouched.
  **Note:** with the orb's connection nodes also dropped in Ghost, connection status is
  **not shown in focus mode** (accepted trade-off — check it in Arc/Amethyst).

## Token model (CSS variables)
**Colors** (RGB channels): `--zenith-bg`, `--zenith-cyan` (accent),
`--zenith-blue` (accent-2), `--zenith-text`, `--zenith-alert`, `--zenith-red`.
**Orb colors** (hex, read by JS): `--orb-color`, `--orb-cool`, `--orb-core`.
**Treatment knobs**: `--glow-strength` (0–1 mult on glow alpha), `--panel-tint` (0–1
mult on card/panel tint + inner glow), `--border-strength` (0–1 mult on border alpha),
`--notch` (Arc's corner chamfer px; 0 = square), `--radius` (rounded-corner px for
Amethyst), `--motion-scale` (ambient-loop duration multiplier — does NOT touch interaction
feedback), `--bloom` (orb bloom intensity), `--particle-count` (orb point count).
**Orb-mode knobs (Ghost network)**: `--orb-mode` (`sphere` | `network`), `--orb-link-dist`
(max neighbour distance for a drawn line, in sphere-radius units), `--orb-link-alpha`
(base line opacity). Corner *style* is applied per-skin (a small `[data-skin] .hud-card/
.panel` override): Arc = notched clip-path, Ghost = square, Amethyst = `border-radius:
var(--radius)` + glass (`backdrop-filter: blur`).

Example conversions:
```css
.glow-cyan { filter: drop-shadow(0 0 2px rgb(var(--zenith-cyan) / calc(.5 * var(--glow-strength)))); }
.spin-slow { animation: spin-cw calc(26s * var(--motion-scale)) linear infinite; }
.hud-card  { clip-path: polygon(0 0, calc(100% - var(--notch)) 0, 100% var(--notch), 100% 100%, var(--notch) 100%, 0 calc(100% - var(--notch))); }
```

## The three skins
Values are concrete starting points; exact shades are tunable during the build.

| Token | Arc (default) | Ghost (light/ink) | Amethyst |
| --- | --- | --- | --- |
| `--zenith-bg` | `0 0 8` | `247 247 245` (paper) | `7 5 15` |
| `--zenith-cyan` (accent) | `0 255 229` | `24 24 27` (ink) | `178 107 255` |
| `--zenith-blue` (accent-2) | `0 102 255` | `90 96 104` (graphite) | `106 91 255` |
| `--zenith-text` | `224 247 247` | `30 30 34` | `238 230 251` |
| `--zenith-alert` | `255 107 0` | `180 83 9` (amber, darkened) | `255 107 0` |
| `--zenith-red` | `255 32 32` | `200 30 46` | `255 48 80` |
| `--orb-color` | `#00ffe5` | `#1a1a1c` (ink) | `#b26bff` |
| `--orb-cool` | `#39d6ff` | `#4a4f57` (cool grey) | `#8a6bff` |
| `--orb-core` | `190 255 250` | `18 18 20` (densest ink) | `230 215 255` |
| `--glow-strength` | 1 | **0** | 1 |
| `--panel-tint` | 1 | **0** (light surface, no tint) | 1 |
| `--border-strength` | 1 | 0.16 (dark hairline) | 1 |
| `--notch` | 14px | 0px | 0px |
| `--radius` | 0 | 0 | 18px (rounded glass) |
| `--motion-scale` | 1 | 1.35 | 1 |
| `--bloom` | 0.7 | **0** | 0.7 |
| `--particle-count` | 28000 | **1400** (network nodes) | 28000 |
| `--orb-mode` | `sphere` | **`network`** | `sphere` |
| `--orb-link-dist` | — | `0.34` | — |
| `--orb-link-alpha` | — | `0.5` | — |
| corner style | notched | square | **rounded glass** |
| layout | full dashboard | **centered focus** | **bento** |

### Ghost core treatment (light / ink — always, since it *is* Ghost)
Invert to a **near-white paper canvas** (`#F7F7F5`) with **graphite-black ink**. Kill
glow/bloom entirely. The background is flat paper — drop the cyan/blue aura pools; keep a
faint grain + a very soft vignette for warmth. Panels are light surfaces separated by a
**dark hairline border + a whisper of soft shadow** (on white, glow can't create depth, so
a barely-there shadow does — kept subtle per taste/minimalist, never a heavy drop-shadow
box). Orb = a **black network/web** (dark nodes + thin neighbour lines, no glow; "thinking"
→ cooler grey ink + a slower pulse, never a colour). Type-forward labels (wider mono
tracking, lighter weight) carry the state word (`LISTENING` / `SPEAKING…`). Calmer ambient
motion; more breathing room; square corners; chrome trimmed. Muted amber (darkened, ~`#B45309`)
and red survive only for real alerts/critical so warnings still register on white.

### Ghost layout — Centered Focus
Remaining on screen: the slim icon rail, a **larger** centered network orb, the status
word, the command center, and a one-line usage readout in a corner. The dashboard returns
the moment you switch to Arc/Amethyst. **Connection status is intentionally not shown in
Ghost** (side panels hidden + orb nodes dropped) — switch to Arc/Amethyst to see it.

### Amethyst layout — Bento (owner-approved mockup)
A CSS-grid of rounded violet-glass tiles (balanced pass approved 2026-06-22):
```
"orb  orb   conn"      orb = 2×2 hero tile (cols 1-2, rows 1-2) with the connection nodes
"orb  orb   usage"     conn / usage stack in col 3
"cal  cal   activity"  cal = wide horizontal event strip (cols 1-2); activity in col 3
"cc   cc    cc"        command center = slim full-width bar (~88px) at the bottom
```
Grid: `grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 0.86fr 88px;` with the
named areas above. Tiles are `border-radius: var(--radius)` glass cards (`backdrop-filter:
blur`). The existing panels are reused as tile contents; only `page.tsx` changes (a bento
grid wrapper gated on `skin === "amethyst"`). Reference mockup:
`mock_amethyst_C2.html` (throwaway, no longer on disk — grid above is authoritative).
Tuning note: tighten the Usage tile's vertical rhythm.

## Skin switcher (Settings view)
Replace the Settings `PlaceholderView` with a real picker: three preview cards (Arc /
Ghost / Amethyst) showing a mini swatch (bg + accent + a sample card), the active one
marked. Click applies instantly and persists. Cards follow emil component rules:
`:active { transform: scale(.97) }`, hover behind `@media (hover:hover) and
(pointer:fine)`, transitions on `transform`/`opacity` only.

## Skin-switch transition (emil-design-eng)
Switching skin is an **occasional, user-triggered** change → it gets a **standard
animation with a clear purpose** (prevent a jarring full-UI color swap), kept **under
300ms**:
- On switch, briefly apply `filter: blur(2px)` + a small opacity dip on the app root for
  ~220ms with `--ease-out` (`cubic-bezier(.23,1,.32,1)`), swap `data-skin` at the dip,
  then settle. Blur masks the hard swap (emil's "blur to mask imperfect transitions").
  **Note:** the Arc↔Ghost switch crosses dark↔light, so the blur-mask matters most here —
  verify it doesn't strobe.
- Animate **only** `filter`/`opacity` (GPU-friendly).
- `prefers-reduced-motion`: opacity-only, no blur, ~150ms.
- The orb re-reads colors on the same tick so it changes in step with the DOM.

## Design-quality standards to apply during build
- **emil-design-eng** (loaded): custom easings already in `globals.css`
  (`--ease-out`/`--ease-in-out`/`--ease-drawer`); interaction feedback stays snappy
  (`--motion-scale` only affects ambient loops); never `transition: all`; only animate
  transform/opacity/filter; press states on clickables; keep reduced-motion paths.
- **taste-skill / redesign-skill / minimalist-skill** — invoked when building, to keep
  Ghost genuinely premium-minimal (not generic) and to upgrade existing surfaces during
  the refactor rather than just recolor them. Ghost's light inversion especially needs a
  real design pass: depth via subtle shadow/border, not glow.

## Files to change
- `tailwind.config.ts` — hex → `rgb(var(--…) / <alpha-value>)`.
- `app/globals.css` — per-skin var blocks; convert 18 hardcoded sites to vars + knobs;
  add the switch-transition class; Ghost light-surface panel rule (hairline + whisper shadow).
- `app/layout.tsx` — no-flash inline script; wrap app in `SkinProvider`.
- `components/OrbScene.tsx` — read skin vars incl. `--orb-mode`; **add the `network` render
  path** (dark nodes + neighbour `LineSegments`, normal blending, bloom off) for Ghost;
  regen texture/uniforms/geometry on change. `components/ZenithOrb.tsx` — fallback gradient → var.
- `components/BootScreen.tsx`, `components/StatusCard.tsx` — hardcoded hex → accent var.
- `app/page.tsx` — consume `skin`; Ghost conditional columns + trimmed chrome + one-line
  usage; mount the switch-transition wrapper.
- **New**: `lib/skins.ts` (ids + display metadata), `components/SkinProvider.tsx`,
  skin picker component for the Settings view.

## Verification
- `tsc` / Next build clean.
- Drive the browser, screenshot **all three skins** (Arc must look unchanged, Ghost
  light/ink-network focus mode, Amethyst) plus the **boot screen per skin**; confirm
  `/opacity` utility classes still render, the orb recolors / switches to the network mode
  correctly, and the switch crossfade plays (especially Arc↔Ghost dark↔light).
- Confirm `prefers-reduced-motion` still disables movement.

## Open questions
None blocking. Resolved 2026-06-23: Ghost paper tone = `#F7F7F5` (pure white is the
fallback), panels get a whisper of soft shadow (not dead-flat), orb = network/web with no
connection nodes. Tunable later: exact ink/graphite shades, Ghost link distance/density,
Amethyst bg depth.
