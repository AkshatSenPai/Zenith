# HUD-mock orb port + constellation fidelity — design spec

**Date:** 2026-07-02
**Reference:** `C:\Users\Akshat Singh\Downloads\Zenith HUD.html` (Claude-design bundled export; decoded
`x-dc` source = the authority for all constants below — `_initOrb` and `_initBg`).
**Owner decisions (2026-07-02):** (1) replace the R3F/WebGL orb with the mock's single **2D-canvas**
orb for ALL skins; (2) **orange-on-speak is sanctioned** on the Arc sphere (overrides the old
"never orange" law — update CLAUDE.md); (3) live mic/TTS bars keep modulating the orb (practicality
fold-in, identical at rest).

## Scope

- **In:** the orb (new `OrbCanvas.tsx`, delete `OrbScene.tsx`, drop the `three`/`@react-three/*`
  deps), the ambient constellation retune, opaque rails, CLAUDE.md orb-spec update.
- **Out:** everything else in the mock — top beam, toasts, waveform restyle, boot, mock theme
  palettes (our skins keep their existing color tokens), layout. WhatsApp stays parked.

## 1. `OrbCanvas.tsx` — 2D-canvas orb (port of the mock's `_initOrb`)

One `"use client"` component, plain `<canvas>` + `useEffect` init (no dynamic import / SSR guard
needed), rAF loop, `ResizeObserver` resize, `DPR = min(devicePixelRatio, 2)`. All mutable frame
state (mode, energy, bars, tilt, ripples, reduce-motion) lives in refs so the effect mounts once —
the same ref pattern OrbScene uses today.

**Props:** unchanged `ZenithOrbProps` (`state`, `connections`, `bars`).
**Mode mapping:** our `thinking` = mock `processing`; others 1:1.
**Skin dispatch:** existing `--orb-mode` var, values `sphere` (Arc) | `mesh` (Ghost — renamed from
`network`) | `nebula` (Amethyst), re-read per frame so a skin switch re-styles live.
**Colors:** accent = `--orb-color` channels (re-read per frame, as `AmbientBackground.channels()`
does). Warm speak color `255,169,77` applies **only when `--orb-mode` = sphere** (mock rule).
Ghost is the `light` branch (`data-skin === "ghost"`).

### Shared frame model (all skins — mock constants, verbatim)

- **Energy** eases to target by `+= (targ − e) * 0.06`; targets: speaking `0.92`, thinking `0.72`,
  listening `0.55`, idle `0.15`.
- **Wobble:** speaking `(sin(9t)+sin(5.3t+1)+sin(13.7t))/3 · 0.11e`; thinking `sin(7t)·0.03e`;
  listening `sin(5t)·0.045e`; idle `sin(1.2t)·0.022`. `baseR = min(W,H)·0.33·(1+wob)`.
- **Rotation:** `ay = t·(0.16 + 0.45e + spin) + tiltX·0.9`, `ax = 0.42 + tiltY·0.5`; `spin = 0.85`
  extra while thinking. Project: rotate Y by `ay` then X by `ax`; `depth = (z′+1)/2`.
- **Mouse tilt:** window `mousemove` → offset from canvas center, clamped `±0.7 / ±0.5`, eased `0.05`.
- **Ripples:** on speak-start push `{r: 0.5·min(W,H)·0.33, a:.6}` and `{r: 0.2·…, a:.5}`; while
  listening push `{r: baseR·0.9, a:.5}` every `0.5s`. Update `r += 2.6`, `a ×= .965`, kill `< .02`;
  stroke `colStr` lw 1.
- **Gap rings (all skins):** `ring(baseR·1.22, +0.3t, dark .16 / light .22, gap 1.1)` and
  `ring(baseR·1.4, −0.22t, dark .10 / light .14, gap 2.0)` — accent, lw 1, arc `rot → rot+2π−gap`.
- **Channel lines + packets:** four channels — top=Gmail, right=Calendar, bottom=Telegram,
  left=Discord (same order as the `ZenithOrb` chips) — `on` driven by **live `connections`** (not
  the mock's hardcoded booleans). Line from `baseR+6` to `min(W,H)/2 − 8`; stroke on:
  `rgba(acc, light .22 / dark .16)`, off: `rgba(acc, .05)`. On-channels get 3 packets:
  `u = (t·(0.32+0.25e) + k/3) mod 1`, direction reversed while thinking, dot r 2,
  `alpha .85·sin(uπ)`, color `colStr`.
- **Core glow:** light skin → radial gradient `coreR = baseR·(1.05+0.45e)`, stops
  `(orb,.22+.2e) / (orb,.09) @ .5 / 0`. Dark skins → `globalCompositeOperation:'lighter'`,
  `coreR = baseR·(1.08+0.6e)`, white-hot center `rgb(120+135w, 240−30w, 230−80w)` at `.72+.45e`
  (w = warm speak on sphere else 0), then `(acc,.46+.3e) @.22 / (acc,.16) @.55 / 0`.

### Per-skin styles

- **`sphere` (Arc):** 950-pt Fibonacci sphere; particles drawn as rects, `a = .12+depth²·.72`,
  `sz = .5+depth·1.4`; while speaking, particles with `depth > .7 && (i·7)%5==0` go orange.
  **EQ halo:** 76 bars at `r0 = baseR·1.5`, `ang = i/76·2π + 0.18t`,
  `v = |sin(0.5i + t·speed)|` (speed 6 speaking / 4.5 thinking / 3 else); len idle `1.5+2v`,
  active `3 + v·(17 speaking / 9 else)·e`; stroke `rgba(colStr, .12+.4e)` lw 1.4.
  **Radar sweep:** rotate `0.85t`; gradient line 0→baseR ending `.45+.35e`; pie sector
  `arc(−0.55, 0)` filled `rgba(acc,.045)`.
- **`nebula` (Amethyst):** 1180 volumetric points (`r = rand^0.62`, uniform angles, twinkle phase +
  speed `0.4+1.1·rand`); `tw = .45+.55·sin(1.8t·sp + ph)`, `al = (.08+depth²·.72)(.4+.6tw)`,
  `sz = .6+2.1·depth·tw`; plus 2 rotating ellipses `rotate(0.12t + 1.3r)`, rx `baseR·1.16`,
  ry `baseR·0.4`, `rgba(acc,.09+.12e)` lw 1.2. (Supersedes the R3F `NebulaOrb` from `93206e5`.)
- **`mesh` (Ghost):** 210-pt Fibonacci mesh with per-point wobble phases (`jit = .05+.03e`), links
  where 3D distance `< 0.36`; links `rgba(orb, .05+dep²·.5)` lw 1, dots `al .22+.6·depth`,
  `sz .9+1.5·depth`. The mock declares 8 "venom tendrils" but never draws them — **omit**.

### Our two deviations from the mock (deliberate)

1. **Live audio fold-in:** while listening/speaking and `bars` non-empty, `avg = mean(bars)`
   scales the wobble amplitude `×(0.6 + 0.8·avg)`, and each EQ bar blends its sine `v` 50/50 with
   `bars[i % bars.length]`. Idle/no-bars renders byte-identical to the mock.
2. **Reduced motion (stricter than the mock):** the mock only zeroes wobble/jitter and slows `ay`
   to `0.05t` — radar/EQ/packets keep moving. We **freeze `t`** entirely under reduced motion
   (OS or in-app toggle, via `useReducedMotion` ref): energy/color still ease, nothing sweeps.
   Matches the freeze promise the rest of the HUD already keeps.

### Cleanup

`cancelAnimationFrame` + `ResizeObserver.disconnect` + `mousemove` listener removal on unmount.
No WebGL contexts exist anymore — the leak class this replaces is gone by construction.

## 2. `ZenithOrb.tsx`

Keep the wrapper + 4 CSS-anchored `NodeChip`s untouched. Replace the `dynamic(() =>
import("./OrbScene"))` + `OrbFallback` with a plain `<OrbCanvas {...props} />` import.

## 3. Deletions

- `frontend/components/OrbScene.tsx` (only importer of the three-stack — verified).
- Deps: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`,
  `@types/three` from `frontend/package.json`.
- Dead skin tokens: `--bloom`, `--particle-count`, `--orb-link-dist`, `--orb-link-alpha`
  (OrbScene was the only reader — re-verify at implementation time).

## 4. `AmbientBackground.tsx` — revert to mock tuning

Back to the mock's `_initBg` numbers (undoing the 2026-07-02 density bump `a7f7700`):
`n = min(110, W·H/20000)`, velocity `±0.09`, link distance `130`, link alpha `.07 light / .09 dark`,
dots `1.1px` at `.35 light / .5 dark`. Grid alpha becomes per-skin via a new `--amb-grid-a` token:
Arc `0.022`, Amethyst `0.03`, Ghost `0.05` (mock values). Node/link/grid color keeps reading
`--orb-color` as today. Keep: `ResizeObserver` reseed, per-frame skin re-tint, reduced-motion
static frame, and the `isolate` stacking fix in `page.tsx`.

## 5. Opaque rails (constellation confinement)

`page.tsx`: add `bg-zenith-bg` to the left and right rail `<aside>`s — the mock hides the field
behind rails with `background: var(--bg)` on both. Icon strip + center + top bar stay transparent
(mock behavior).

## 6. CLAUDE.md

Rewrite the orb spec: 2D-canvas orb (`OrbCanvas.tsx`), per-skin styles sphere/mesh/nebula keyed by
`--orb-mode`, gap rings on all skins (ring law fully retired), **orange-on-speak sanctioned on the
Arc sphere**, R3F/three stack removed, audio-bars fold-in + strict reduced-motion freeze noted.

## Verification

1. `cd frontend && npx tsc --noEmit` clean; `npm run dev` builds after dep removal.
2. Live Playwright: 3 skins × 4 states (idle / listening / thinking / speaking) — sphere+EQ+radar
   on Arc (orange while speaking), mesh on Ghost, nebula+ellipses on Amethyst; rings + channel
   packets everywhere; packets/chips track real connection status.
3. Constellation: mock density restored, per-skin grid alpha, **not visible behind either rail**,
   still visible behind icon strip + center; skin-switch shows no flash-then-vanish.
4. Reduced-motion (toggle + OS): orb and field freeze; energy/color still respond to state.
5. View cycling Chat↔Memory ×10: no console errors (plain 2D canvases — no WebGL contexts).
6. Backend untouched: fast suite (130) green.
