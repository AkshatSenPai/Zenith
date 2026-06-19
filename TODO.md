# Zenith — TODO (next session)

Picking up the HUD/orb polish. Three items below; **1 and 2 are the priority** (the orb
reaction + the rings). Mock/visual only — no API wiring, no Tauri/Pass B.

---

## 1. Orb voice reaction — REDESIGN (current per-node version looks bad)

**Problem:** right now every mesh node scales up to ~2.8× + brightens with its audio band.
While speaking it reads as **"bleeding dots"** — fat blobs all over the disc, chaotic and
noisy (see the SPEAKING screenshot). Reject this approach.

**Goal:** the orb should react to voice (mine + Zenith's) in a way that feels *alive and
intelligent*, not bloated. Keep it cyan, 2D, smooth.

**Suggested alternatives (pick one or combine — I lean B + C):**

- **A — Energy pulse through the mesh.** On audio, a wave of *brightness* radiates from the
  core outward along the edges/nodes (or inward), like data flowing through the network.
  Nodes do **not** resize — only their brightness briefly lifts as the wave passes. Directional,
  JARVIS-like, no bloating. (More work: needs a travelling-wave function over node radius/time.)
- **B — Core-centric reaction (cleanest, recommended).** The reaction lives in the **core**:
  the central bloom gently **scales + intensifies** with the live amplitude (a breathing
  "voice orb"). The mesh stays calm. Elegant, zero bleeding. Easy.
- **C — Edges light up (recommended, pairs with B).** The connection **lines** brighten and the
  inward flow speeds up with the audio (energy *gathering* to the core) — nodes stay steady.
  Reinforces the "collecting from Gmail/Calendar" idea I liked.
- **D — Capped node shimmer (only if we keep node reaction).** Keep per-node reaction but cap
  HARD: size ≤ ~1.2×, small opacity lift, and only ~25% of nodes react (random subset) so it
  *shimmers* instead of ballooning.

**Recommendation:** **B + C** — core breathes with the voice + inner edges pulse/flow toward
it. Calm mesh, lively center, on-theme. Add D as a *very* subtle layer if it still feels static.

**Also:** the SPEAKING state currently turns the core **orange** — revisit; we're cyan-only.
Probably keep speaking cyan (maybe a touch brighter/whiter), no orange.

---

## 2. Remove the concentric / orbital rings during voice

**Problem:** when listening/thinking, a **blue elliptical orbit ring** sweeps around the orb
(the "thinking" state), plus the thin white ring hugging the core — these read as the
"concentric rings" I don't want (see the LISTENING screenshot).

**To do:**
- Drop the blue **orbit ellipse** for the `thinking` state. Replace with a non-ring cue —
  e.g. the core shifts to a cooler tone + a slow brightness pulse, or a tiny rotating arc
  segment (not a full ring).
- Reduce/remove the static **white ring** (r≈14) around the core if it still reads as a ring.
- Net: no full concentric/orbital rings in any state. Reaction = §1 (core/edges), not rings.

---

## 3. Command Center — minimize / restore "flap"

When an answer is shown, I want to be able to **minimize the Command Center** and **reopen it**
on demand.

**To do:**
- Add a minimize control (chevron/▾) in the Command Center header.
- Minimized = collapse to a thin bar / pill (just the header or a small "▸ Command Center"
  tab), freeing the space (orb can take it). Click to expand back to the full panel.
- Smooth transition (reuse the existing `--ease-out` / height-grow approach). Remember the
  last state during the session.

---

## Context / where things are
- Orb: `frontend/components/ZenithOrb.tsx` (mesh = `buildField`, reaction in `ReactiveNodes`
  + core scale; `thinking` orbit + core rings near the bottom of the file).
- Reaction data: `frontend/app/page.tsx` (rAF feeds `bars` from `getBars`/`getSpeechBars` in
  `lib/voice.ts`); `bars` is passed to `<ZenithOrb bars=… />`.
- Command Center: `frontend/components/CommandCenter.tsx` (input + mic + send merged in;
  `expanded` prop drives the grow). Add the minimize state here + a toggle from `page.tsx`.
- Left rail extras (done): `frontend/components/LeftRailExtras.tsx`.

Reminder: don't `npm run build` while `npm run dev` is live (it desyncs `.next`).
