# Zenith Skins — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans (inline) to implement this
> task-by-task. Frontend visual work has **no JS test runner** in this repo, so each task is
> verified by (a) `npx tsc --noEmit` / dev-server compile, (b) **browser screenshots via the
> chrome-devtools MCP** (drive `http://localhost:3000`, toggle `data-skin` to inspect each
> skin), and (c) for the design passes, the **Impeccable** skill (`/impeccable audit`,
> `polish`, `critique`) + its slop-detector. Steps use `- [ ]` checkboxes.

**Goal:** Add a skin/theme system to Zenith with three skins — Arc (current cyan, default),
Ghost (mono focus-mode, first), Amethyst (violet) — switchable from Settings.

**Architecture:** All color + treatment values become CSS variables selected by a
`data-skin` attribute on `<html>`. Tailwind tokens become `rgb(var(--…)/<alpha>)` so existing
utility classes auto-theme. A `SkinProvider` (context + localStorage) sets `data-skin`; a head
inline-script applies the saved skin before paint. The WebGL orb reads its colors/knobs from
the same CSS vars via `getComputedStyle` on skin change. Ghost additionally hides the side
dashboard columns (centered-focus layout) and trims chrome.

**Tech Stack:** Next.js 14 (App Router) · Tailwind · TypeScript · react-three-fiber · GSAP.
Design skills applied during build: **impeccable**, **taste-skill**, **minimalist-skill**
(Ghost), **redesign-skill**, **emil-design-eng**.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-06-22-zenith-skins-design.md` (authoritative for values).
- **Arc must look pixel-identical to today** after the token refactor — it's the regression gate.
- Only animate `transform`/`opacity`/`filter` (emil). Keep all `prefers-reduced-motion` paths.
- Tailwind color vars stored as **space-separated RGB channels** so `/opacity` modifiers work.
- Do NOT touch voice/confirm-gate/backend behavior. Frontend only.
- Don't `npm run build` while `npm run dev` is live. Commit per task; direct to `main`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Token foundation (Arc unchanged)
Convert all hardcoded colors to CSS variables; Arc keeps today's exact values.

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/components/BootScreen.tsx`, `frontend/components/StatusCard.tsx`,
  `frontend/components/ZenithOrb.tsx` (hardcoded hex → vars)

**Interfaces produced:** CSS vars `--zenith-bg/-cyan/-blue/-text/-alert/-red` (RGB channels),
`--orb-color/-cool/-core` (hex), knobs `--glow-strength/-panel-tint/-border-strength/-notch/
-motion-scale/-bloom/-particle-count`. Tailwind keys (`zenith-cyan` etc.) unchanged in name.

- [ ] **Step 1 — Impeccable baseline.** Run `/impeccable audit` over `frontend/` to capture the
  current HUD's design state + any anti-patterns to avoid carrying into the skins. Save notes.
- [ ] **Step 2 — Tailwind tokens → vars.** In `tailwind.config.ts`, replace each hex with
  `rgb(var(--zenith-<key>) / <alpha-value>)`:
  ```ts
  colors: {
    zenith: {
      bg:   "rgb(var(--zenith-bg) / <alpha-value>)",
      cyan: "rgb(var(--zenith-cyan) / <alpha-value>)",
      blue: "rgb(var(--zenith-blue) / <alpha-value>)",
      text: "rgb(var(--zenith-text) / <alpha-value>)",
      alert:"rgb(var(--zenith-alert) / <alpha-value>)",
      red:  "rgb(var(--zenith-red) / <alpha-value>)",
      scan: "#2EE6A6", // unchanged (not themed)
    },
  },
  ```
- [ ] **Step 3 — Arc var block.** At the top of `globals.css` add the default (Arc) block with
  today's values + knobs:
  ```css
  :root, [data-skin="arc"] {
    --zenith-bg: 0 0 8; --zenith-cyan: 0 255 229; --zenith-blue: 0 102 255;
    --zenith-text: 224 247 247; --zenith-alert: 255 107 0; --zenith-red: 255 32 32;
    --orb-color: #00ffe5; --orb-cool: #39d6ff; --orb-core: 190 255 250;
    --glow-strength: 1; --panel-tint: 1; --border-strength: 1;
    --notch: 14px; --radius: 0px; --motion-scale: 1; --bloom: 0.7; --particle-count: 28000;
  }
  ```
- [ ] **Step 4 — Convert hardcoded sites in globals.css** (18 spots). Rules:
  `rgba(0,255,229,A)` → `rgb(var(--zenith-cyan) / calc(A * var(--glow-strength)))` for glows,
  or `* var(--panel-tint)` for panel/card fills/inner-glows, or `* var(--border-strength)` for
  borders; `rgba(0,102,255,A)` → `rgb(var(--zenith-blue) / A)`; `#000008`→`rgb(var(--zenith-bg))`;
  `#e0f7f7`→`rgb(var(--zenith-text))`. Make `.hud-card` clip-path use `var(--notch)`; make the
  spin/ambient animations use `calc(<dur> * var(--motion-scale))`. Keep `.bg-aura` gradients on
  `--zenith-cyan`/`--zenith-blue` scaled by `--panel-tint`.
- [ ] **Step 5 — Component hex → var.** `BootScreen.tsx` BootOrb SVG strokes `#00FFE5` →
  `currentColor` (wrap in `text-zenith-cyan`) or `rgb(var(--zenith-cyan))`; its inline rgba glows
  → `rgb(var(--zenith-cyan)/…)`. `StatusCard.tsx` hardcoded hex → token class/var.
  `ZenithOrb.tsx` `OrbFallback` gradient → `rgb(var(--zenith-cyan)/…)`.
- [ ] **Step 6 — Verify Arc unchanged.** Restart dev if needed; in chrome-devtools MCP load
  `http://localhost:3000`, screenshot the HUD + boot screen. Compare to the pre-change look —
  must be identical. Run `npx tsc --noEmit` (clean). Spot-check a `/opacity` class (e.g.
  `text-zenith-text/40`) renders translucent.
- [ ] **Step 7 — Commit.**
  ```bash
  git add frontend/tailwind.config.ts frontend/app/globals.css frontend/components/BootScreen.tsx frontend/components/StatusCard.tsx frontend/components/ZenithOrb.tsx
  git commit -m "refactor(frontend): tokenize colors into CSS vars (Arc unchanged)"
  ```

---

### Task 2: SkinProvider + persistence + no-flash
**Files:**
- Create: `frontend/lib/skins.ts`
- Create: `frontend/components/SkinProvider.tsx`
- Modify: `frontend/app/layout.tsx` (head inline script + wrap children)

**Interfaces produced:** `SKINS: {id:"arc"|"ghost"|"amethyst"; label:string; swatch:{bg,accent,panel:string}}[]`;
`type SkinId`; `useSkin(): { skin: SkinId; setSkin(id: SkinId): void }`; `SkinProvider`.

- [ ] **Step 1 — `lib/skins.ts`:** export `SkinId` union, `SKINS` array (id/label + preview swatch
  hexes for the picker), `DEFAULT_SKIN="arc"`, `SKIN_STORAGE_KEY="zenith-skin"`.
- [ ] **Step 2 — `SkinProvider.tsx`:** React context; on mount read `localStorage[SKIN_STORAGE_KEY]`
  (validate against SKINS, else default), set `document.documentElement.dataset.skin`; `setSkin`
  writes localStorage + dataset. Expose `{skin,setSkin}` via `useSkin()`.
- [ ] **Step 3 — No-flash script in `layout.tsx`:** a `<script dangerouslySetInnerHTML>` in
  `<head>` that reads the same key and sets `document.documentElement.dataset.skin` before paint
  (default `arc`). Wrap `{children}` in `<SkinProvider>`.
- [ ] **Step 4 — Verify:** browser — set skin via `useSkin` (temporarily wire a console call or set
  `localStorage` + reload); confirm `<html data-skin>` updates, persists across reload, no color
  flash on load. `npx tsc --noEmit` clean.
- [ ] **Step 5 — Commit** `feat(frontend): SkinProvider + persisted data-skin (no-flash)`.

---

### Task 3: Orb reads skin tokens
**Files:** Modify `frontend/components/OrbScene.tsx`.

**Interfaces consumed:** `useSkin()` from Task 2. **Produced:** orb recolors on skin change.

- [ ] **Step 1 — Read tokens:** add a helper `readOrbTokens()` that does
  `getComputedStyle(document.documentElement)` and returns `{color, cool, core, bloom, count}`
  (parse hex strings; `parseFloat` the numbers; `--orb-core` is RGB channels → build `rgb(...)`).
- [ ] **Step 2 — React to skin:** consume `useSkin()`; in an effect keyed on `skin`, update
  `material.uniforms.uColor/uCool`, regenerate the core glow texture from the new `core`/`color`
  (parameterize `makeGlowTexture(color, core)`), set Bloom `intensity` from `bloom`, and if
  `count !== PARTICLE_COUNT` rebuild geometry (extract geometry-build into `buildGeometry(count)`
  and store count in state). Dispose old texture/geometry.
- [ ] **Step 3 — Bloom intensity prop:** lift `<Bloom intensity>` to read the token value (state).
- [ ] **Step 4 — Verify:** browser — Arc orb identical to before; in devtools set
  `document.documentElement.dataset.skin='amethyst'` (after Task 7 values exist, or temporarily
  inject test vars) and confirm the orb recolors + texture updates with no WebGL errors in console.
- [ ] **Step 5 — Commit** `feat(frontend): orb reads color/bloom/particle tokens per skin`.

---

### Task 4: Ghost skin — color + treatment
**Files:** Modify `frontend/app/globals.css` (add `[data-skin="ghost"]` block).

- [ ] **Step 1 — Consult minimalist + impeccable.** Invoke `taste-skill:minimalist-skill` and run
  `/impeccable critique` mentally against the Ghost target (mono, flat, restrained) before setting
  values, so the knobs reflect real minimal-design discipline, not just "less glow."
- [ ] **Step 2 — Ghost var block:**
  ```css
  [data-skin="ghost"] {
    --zenith-bg: 0 0 0; --zenith-cyan: 214 228 240; --zenith-blue: 150 170 190;
    --zenith-text: 224 230 238; --zenith-alert: 255 176 32; --zenith-red: 230 90 100;
    --orb-color: #d6e4f0; --orb-cool: #abc4d6; --orb-core: 235 242 250;
    --glow-strength: 0.15; --panel-tint: 0.2; --border-strength: 0.6;
    --notch: 0px; --radius: 0px; --motion-scale: 1.35; --bloom: 0.25; --particle-count: 20000;
  }
  ```
- [ ] **Step 3 — Flatten background in Ghost:** scope the `.bg-aura` gradient opacity to
  `var(--panel-tint)` (already from Task 1) so it nearly vanishes; keep grain.
- [ ] **Step 4 — Type-forward labels (optional knob):** add `[data-skin="ghost"]` rule bumping
  letter-spacing on `.font-mono` section labels if needed for the minimal feel (verify visually).
- [ ] **Step 5 — Verify:** browser — set `data-skin=ghost`; screenshot. Check: no neon glow, flat
  matte panels, square corners, silver text on pure black, ghost orb (dim, white, fewer particles),
  amber still visible on an alert element. `npx tsc` clean.
- [ ] **Step 6 — Commit** `feat(frontend): Ghost skin colors + minimal treatment knobs`.

---

### Task 5: Ghost layout — Centered Focus + chrome trim
**Files:** Modify `frontend/app/page.tsx`.

**Interfaces consumed:** `useSkin()`.

- [ ] **Step 1 — Read skin in page:** `const { skin } = useSkin(); const ghost = skin === "ghost";`
- [ ] **Step 2 — Conditional columns:** when `ghost`, do not render the left dashboard column
  (Calendar/QuickActions/Usage) or the right column (Connections/Focus/Activity); render only the
  icon rail + centered orb/status/command-center. Use the existing `orbBig` sizing so the orb is
  larger in focus mode. Keep the grid valid (switch to a centered single-column layout when ghost).
- [ ] **Step 3 — One-line usage:** in ghost, render a compact one-line usage readout (req/day/tokens)
  in a corner instead of the three gauges.
- [ ] **Step 4 — Trim chrome:** when `ghost`, hide `<HexCorners/>` and simplify/hide the top timeline
  strip in `TopBar` (pass a `minimal` prop or gate inside).
- [ ] **Step 5 — Verify:** browser — toggle ghost on/off; screenshot both. Ghost = clean centered
  focus screen; switching back to Arc restores the full dashboard intact. `npx tsc` clean.
- [ ] **Step 6 — Commit** `feat(frontend): Ghost centered-focus layout + trimmed chrome`.

---

### Task 6: Settings skin picker + switch crossfade
**Files:** Create `frontend/components/SkinPicker.tsx`; modify the Settings rendering
(`PlaceholderView` usage in `page.tsx` → render `SkinPicker` when `view==="settings"`);
add the switch-transition class to `globals.css`.

**Interfaces consumed:** `useSkin()`, `SKINS`.

- [ ] **Step 1 — `SkinPicker.tsx`:** three cards (one per `SKINS` entry) showing a mini swatch
  (bg + accent + sample card) + label; active card marked; click → `setSkin(id)`. Apply emil
  component rules: `:active { transform: scale(.97) }`, hover behind
  `@media (hover:hover) and (pointer:fine)`, transitions on transform/opacity only. Build with
  `frontend-design` + `taste-skill` for the card design.
- [ ] **Step 2 — Wire into Settings:** in `page.tsx`, when `view==="settings"` render `<SkinPicker/>`
  instead of `<PlaceholderView view="settings"/>` (keep PlaceholderView for drafts/clients).
- [ ] **Step 3 — Switch crossfade (emil blur-mask):** in `setSkin` (or a wrapper), on change add a
  class to the app root that applies `filter: blur(2px)` + slight opacity dip for ~220ms with
  `var(--ease-out)`, swap `data-skin` at the dip, then settle; CSS:
  ```css
  .skin-swapping { filter: blur(2px); opacity: .85; transition: filter .22s var(--ease-out), opacity .22s var(--ease-out); }
  @media (prefers-reduced-motion: reduce) { .skin-swapping { filter: none; transition: opacity .15s linear; } }
  ```
  Orb re-reads tokens on the same tick (Task 3 effect fires on `skin` change).
- [ ] **Step 4 — Verify:** browser — open Settings, click each skin; confirm live apply, persistence
  across reload, and a smooth blurred crossfade (slow it to 5x per emil to inspect). Check
  reduced-motion path (opacity only).
- [ ] **Step 5 — Commit** `feat(frontend): Settings skin picker + blur-mask switch transition`.

---

### Task 7: Amethyst skin — color + rounded-glass treatment
**Files:** Modify `frontend/app/globals.css` (add `[data-skin="amethyst"]` block + corner override).

- [ ] **Step 1 — Amethyst var block:**
  ```css
  [data-skin="amethyst"] {
    --zenith-bg: 7 5 15; --zenith-cyan: 178 107 255; --zenith-blue: 106 91 255;
    --zenith-text: 238 230 251; --zenith-alert: 255 107 0; --zenith-red: 255 48 80;
    --orb-color: #b26bff; --orb-cool: #8a6bff; --orb-core: 230 215 255;
    --glow-strength: 1; --panel-tint: 1; --border-strength: 1;
    --notch: 0px; --radius: 18px; --motion-scale: 1; --bloom: 0.7; --particle-count: 28000;
  }
  ```
- [ ] **Step 2 — Rounded-glass corner override:** Arc/Ghost cards use the notch/square clip-path;
  Amethyst is rounded glass:
  ```css
  [data-skin="amethyst"] .hud-card, [data-skin="amethyst"] .panel {
    clip-path: none; border-radius: var(--radius); backdrop-filter: blur(8px);
  }
  ```
  Ensure `.hud-card-border::before` (inset stroke) also uses `border-radius: var(--radius)` under
  Amethyst so the hairline follows the rounded corner.
- [ ] **Step 3 — taste/impeccable pass:** invoke `taste-skill` + `/impeccable polish` to tune the
  violet/glow/blur so panels read premium, not garish (adjust accent/bg depth/blur if needed).
- [ ] **Step 4 — Verify:** browser — switch to Amethyst; screenshot. Rounded glass cards, violet
  accent + orb, deeper glow, no notched corners. `npx tsc` clean. (Layout still the dashboard here;
  bento comes in Task 8.)
- [ ] **Step 5 — Commit** `feat(frontend): Amethyst skin colors + rounded-glass treatment`.

---

### Task 8: Amethyst layout — Bento
**Files:** Modify `frontend/app/page.tsx`; add a `.bento`/area classes to `globals.css`.

**Interfaces consumed:** `useSkin()`. Reuses existing panels (Calendar/Connections/Usage/Activity/
CommandCenter/Orb) as tile contents.

- [ ] **Step 1 — Bento grid CSS** in `globals.css` (scoped so it only applies under Amethyst):
  ```css
  [data-skin="amethyst"] .bento {
    display: grid; gap: 14px; height: 100%;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr 0.86fr 88px;
    grid-template-areas:
      "orb orb conn" "orb orb usage" "cal cal activity" "cc cc cc";
  }
  ```
  Plus `.bento-orb{grid-area:orb} .bento-conn{grid-area:conn} .bento-usage{grid-area:usage}
  .bento-cal{grid-area:cal} .bento-activity{grid-area:activity} .bento-cc{grid-area:cc}`.
- [ ] **Step 2 — Conditional layout in `page.tsx`:** when `skin === "amethyst"`, render the center
  region as the bento grid: orb (hero), Connections, Usage, Calendar (as a horizontal event strip —
  reuse `CalendarPanel` in a wide variant or a row layout), Activity, and the CommandCenter as the
  slim full-width `cc` bar. Arc/Ghost paths unchanged. Reference the approved mockup layout in the
  spec (`mock_amethyst_C2.html`).
- [ ] **Step 3 — Tighten Usage tile** vertical rhythm (the one flagged loose spot in the mockup).
- [ ] **Step 4 — Verify:** browser — switch Amethyst; screenshot. Bento reads balanced (orb hero,
  event strip, slim command bar); switching to Arc/Ghost restores their layouts. `npx tsc` clean.
- [ ] **Step 5 — Commit** `feat(frontend): Amethyst bento layout`.

---

### Task 9: Cross-skin verification + design QA
- [ ] **Step 1 — Screenshot matrix:** via chrome-devtools MCP, capture all three skins (Arc, Ghost,
  Amethyst) for the main HUD AND the boot screen (use the rAF-freeze trick for boot). Confirm Arc
  unchanged, Ghost focus-mode + minimal, Amethyst premium violet.
- [ ] **Step 2 — Impeccable QA:** run `/impeccable critique` + the slop-detector CLI over `frontend/`;
  fix any flagged generic-AI patterns.
- [ ] **Step 3 — Motion review (emil):** confirm switch crossfade < 300ms, ambient motion slowed only
  in Ghost (interactions still snappy), reduced-motion disables movement everywhere.
- [ ] **Step 4 — Regression:** `/opacity` classes render correctly in every skin; no WebGL/console
  errors on switch; persistence works.
- [ ] **Step 5 — Final commit / docs:** update `MEMORY.md` + `CLAUDE.md` UI section + the spec status
  to "shipped". Commit `docs: skins v1 (Arc/Ghost/Amethyst) shipped`.

---

## Self-Review
- **Spec coverage:** token system (T1), provider/no-flash/persistence (T2), orb tokens (T3), Ghost
  colors+treatment (T4) + layout+chrome (T5), Settings picker + switch transition (T6), Amethyst
  (T7), verification incl. boot-per-skin + reduced-motion + Impeccable (T8). All spec sections mapped.
- **Placeholders:** skin value blocks and key code are concrete; globals.css conversions specified as
  explicit rules over the known 18 sites (enumerated in Task 1). Verification is browser/tsc, not
  pytest, because there's no JS test runner (stated up front).
- **Type consistency:** `SkinId`, `useSkin()`, `SKINS`, `readOrbTokens()`, `buildGeometry(count)`,
  `makeGlowTexture(color, core)` referenced consistently across tasks.
- **Order:** infra (T1–3) precedes skins; Ghost (T4–5) before Amethyst (T7) per owner; picker (T6)
  lands between so both skins are switchable for QA.
