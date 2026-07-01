# Amethyst Nebula Orb — Design (v7 per-skin orb, 2026-07-01)

## Context

The v7 HUD redesign (`redesign/hud-v7`) is complete and live-verified; the branch is a
clean fast-forward to `main`. The only gate left before merge is the **orb decision**.

The v7 mock (`docs/superpowers/reference/v7/v7-light-mesh.png`) shows the Amethyst orb as a
flat violet **elliptical nebula with a faint orbital ring**. The owner chose to rebuild the
Amethyst orb to match the mock, **explicitly overriding** the previously-locked orb spec in
CLAUDE.md ("center orb = glowing 3D particle *sphere*… **no concentric/orbital rings in any
state**"). Arc and Ghost keep their current orbs.

## Scope

- **Amethyst** → NEW nebula orb (this spec).
- **Arc** → UNCHANGED: cyan 3D particle sphere (`--orb-mode: sphere`). Must stay pixel-identical.
- **Ghost** → UNCHANGED: ink-network web (`--orb-mode: network`). No tendrils (dropped by the owner).

## Approach

Extend the existing per-skin `--orb-mode` token system in `OrbScene.tsx` (already dispatches
`sphere` vs `network`). Add a third mode, **`nebula`**, rendered in R3F — NOT a new 2D canvas.
This reuses the Canvas, bloom, audio-amplitude plumbing, reduced-motion handling, and WebGL
dispose paths, so there is no new render framework and no new leak surface.

### Nebula geometry

- A new `buildNebula(count)` builds an **oblate elliptical disc**: the same Fibonacci-shell +
  inner-haze idea as `buildSphereGeometry`, but the distribution is **squashed on one axis**
  (thin in Z/Y) so it reads as a flat galaxy rather than a ball. The core stays dense and
  bright; particles thin toward the rim.
- The disc is **slightly tilted** (a fixed X-rotation on the group) for the mock's perspective.
- Keeps the existing vertex/fragment shaders and the bright **core glow sprite** + **Bloom**.

### Orbital ring

- A single **thin, faint ellipse ring** around the disc's equator — a `THREE.RingGeometry`
  (or a line-loop) with an additive, low-opacity violet material.
- **Slowly rotates** with the disc when idle; **static under reduced motion**.
- Faint by default (matches the mock's whisper-thin ring); tunable via a token
  (`--orb-ring-alpha`) if needed.

### Audio-reactivity (kept)

The nebula keeps the current reactive behaviour: the **core breathes/brightens** on mic +
Zenith's voice, particles displace outward. The ring may pick up a subtle brightness/scale
nudge on speech (kept minimal). Reduced-motion freezes all of it (reuses `useReducedMotion`).

### Tokens

Amethyst's `[data-skin="amethyst"]` block in `globals.css` sets `--orb-mode: nebula` (plus any
new ring token). Arc and Ghost blocks are untouched, so their modes are unchanged.

## Protected / must-not-regress

- Arc sphere pixel-identical; Ghost ink-web unchanged.
- Audio-reactivity, reduced-motion freeze, per-skin token recolor.
- **WebGL dispose — no leak** on Chat↔Memory view switch (the new geometry/material/ring mesh
  must be disposed on unmount, matching the existing `useEffect(() => () => …dispose(), […])`
  pattern).
- The CSS-anchored connection-node chips (Gmail/Calendar/Telegram/Discord) around the orb.

## Spec override (documented)

Update the CLAUDE.md UI-STYLE orb section: the old "3D sphere only / no rings in any state"
becomes **per-skin orb modes** — Arc `sphere`, Amethyst `nebula` + orbital ring, Ghost
`network` (ink web). This is the owner's approved, intentional override — recorded so a future
session doesn't "fix" the ring as a spec violation.

## Verification

Same gate as the whole redesign (no frontend test runner — not adding one):

- `tsc --noEmit` clean.
- Live-HUD Playwright across **Arc / Ghost / Amethyst**: Amethyst shows the nebula + ring;
  Arc + Ghost visually unchanged.
- Reduced-motion toggle freezes the nebula + ring.
- **No WebGL leak** across repeated Chat↔Memory mount/unmount cycles (no "too many active
  WebGL contexts"); fresh context still allocates.
- 130 backend tests still pass (backend untouched).

## Out of scope

- Any change to Arc or Ghost orbs.
- Ghost tendrils (dropped by the owner).
- A new 2D canvas orb path.
