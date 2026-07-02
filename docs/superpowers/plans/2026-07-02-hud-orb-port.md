# HUD-Mock Orb Port + Constellation Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the R3F/WebGL orb with the HUD mock's single 2D-canvas orb (per-skin sphere/mesh/nebula styles), retune the ambient constellation to the mock's exact values, and confine it away from the rails.

**Architecture:** One new `"use client"` canvas component (`OrbCanvas.tsx`) ports the mock's `_initOrb` verbatim, driven by live React props through refs (mode, connections, audio bars, reduced-motion). `ZenithOrb.tsx` keeps its wrapper + node chips and just swaps renderers. The three.js stack is then deleted. `AmbientBackground.tsx` reverts to mock tuning with a per-skin `--amb-grid-a` token, and the two rails get opaque backgrounds.

**Tech Stack:** Next.js 14 client components, 2D `<canvas>`, CSS custom properties (`data-skin` tokens), existing `lib/prefs` reduced-motion plumbing.

**Spec:** `docs/superpowers/specs/2026-07-02-hud-orb-port-design.md` (constants extracted from the decoded `Zenith HUD.html` mock — the authority).

## Global Constraints

- **No frontend test runner** — do NOT add one. Per-task gate = `cd frontend && npx tsc --noEmit` + live-HUD Playwright verification.
- **Backend untouched** — zero backend files in scope; the 130-test fast suite must stay green by construction.
- **Dev servers:** Zenith frontend runs on **:3001** (Arkquen's desktop app holds :3000; backend CORS now allows both). Backend live on :8000.
- **Colors only via skin tokens** — everything reads `--orb-color` / `data-skin` per frame. The ONLY hardcoded color is the sanctioned warm-speak `255,169,77`.
- **Reduced motion is stricter than the mock:** freeze `t` entirely (OS pref OR in-app toggle via `lib/prefs`); energy/color still ease.
- **Branch:** commit each task to `redesign/hud-v7` (merge to main stays held by the owner).
- Boot screen intercepts the first paint — skip it in verification with a real keydown (synthetic `window` KeyboardEvent works; it's a window listener).

---

### Task 1: `OrbCanvas.tsx` + swap into `ZenithOrb` + `mesh` token rename

**Files:**
- Create: `frontend/components/OrbCanvas.tsx`
- Modify: `frontend/components/ZenithOrb.tsx` (lines 15–35: drop dynamic import + `OrbFallback`; line 70: render `OrbCanvas`)
- Modify: `frontend/app/globals.css` (Ghost block line 101: `--orb-mode: network` → `mesh`)

**Interfaces:**
- Consumes: `ZenithOrbProps` (`state?: OrbState; connections?: Connection[]; bars?: number[]`) from `ZenithOrb.tsx` (type-only import — no runtime cycle); `useReducedMotion()` from `frontend/lib/prefs`.
- Produces: `export default function OrbCanvas(props: ZenithOrbProps): JSX.Element` — an `absolute inset-0` canvas that fills `ZenithOrb`'s `relative` wrapper. Later tasks rely on `--orb-mode` values being exactly `sphere | mesh | nebula`.

- [ ] **Step 1: Write `frontend/components/OrbCanvas.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";

import { useReducedMotion } from "../lib/prefs";
import type { ZenithOrbProps } from "./ZenithOrb";

// Zenith orb — 2D-canvas port of the owner's HUD mock (`_initOrb` in the decoded
// "Zenith HUD.html"; spec docs/superpowers/specs/2026-07-02-hud-orb-port-design.md).
// One renderer, three per-skin styles keyed by --orb-mode (re-read every frame so a live
// skin switch re-styles instantly):
//   sphere (Arc)     — 950-pt Fibonacci particle sphere + 76-bar EQ halo + radar sweep
//   mesh   (Ghost)   — 210-pt wobbling wireframe web (the mock's tendrils are never drawn)
//   nebula (Amethyst)— 1180 twinkling volumetric points + 2 rotating ellipses
// Shared: mode-driven energy, wobble, mouse tilt, ripples, 2 gap rings, 4 channel lines with
// traveling packets wired to LIVE connection status. Speaking on the sphere style warms to
// orange (owner-sanctioned override of the old "never orange" law, 2026-07-02).
// Deviations from the mock (deliberate, spec §"deviations"):
//   1. live mic/TTS bars modulate wobble + EQ while listening/speaking (identical at rest);
//   2. reduced motion freezes `t` entirely (mock only damps) — energy/color still ease.
// Replaces the R3F/WebGL OrbScene — no WebGL contexts exist here, so the old
// dispose-on-view-switch leak class is gone by construction.

type Vec3 = { x: number; y: number; z: number };

const N_SPHERE = 950;
const N_VOL = 1180;
const N_MESH = 210;
const GOLD = Math.PI * (3 - Math.sqrt(5));
const WARM = "255,169,77"; // sanctioned warm-speak accent (sphere style only)

function fibSphere(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = GOLD * i;
    out.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
  }
  return out;
}

/** Active skin's --orb-color as "r,g,b" channels (same parser as AmbientBackground). */
function orbChannels(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--orb-color").trim() || "#00ffe5";
  let hex = v.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const num = parseInt(hex, 16);
  return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
}

export default function OrbCanvas({ state = "idle", connections, bars }: ZenithOrbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  // Live props stream into the mount-once rAF loop via refs.
  const modeRef = useRef(state);
  const barsRef = useRef<number[]>(bars ?? []);
  const connRef = useRef({ top: false, right: false, bottom: false, left: false });
  const reduceRef = useRef(reduce);

  useEffect(() => { modeRef.current = state; }, [state]);
  useEffect(() => { barsRef.current = bars ?? []; }, [bars]);
  useEffect(() => { reduceRef.current = reduce; }, [reduce]);
  useEffect(() => {
    const on = (ch: string) => !!connections?.find((c) => c.channel === ch)?.connected;
    // channel geometry matches the NodeChip placement: Gmail ↑, Calendar →, Telegram ↓, Discord ←
    connRef.current = { top: on("Gmail"), right: on("Calendar"), bottom: on("Telegram"), left: on("Discord") };
  }, [connections]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cv.width = Math.max(1, Math.floor(w * dpr));
      cv.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    // ---- geometry (built once) ----
    const pts = fibSphere(N_SPHERE);

    type VolPt = Vec3 & { tw: number; sp: number };
    const vol: VolPt[] = [];
    for (let i = 0; i < N_VOL; i++) {
      const u = Math.random();
      const v = Math.random();
      const rr = Math.pow(Math.random(), 0.62);
      const theta = Math.acos(2 * v - 1);
      const phi = 2 * Math.PI * u;
      vol.push({
        x: Math.sin(theta) * Math.cos(phi) * rr,
        y: Math.cos(theta) * rr,
        z: Math.sin(theta) * Math.sin(phi) * rr,
        tw: Math.random() * 6.28,
        sp: 0.4 + Math.random() * 1.1,
      });
    }

    type MeshPt = Vec3 & { ph: number; s1: number; s2: number };
    const mpts: MeshPt[] = fibSphere(N_MESH).map((p) => ({
      ...p,
      ph: Math.random() * 6.28,
      s1: 0.8 + Math.random() * 1.7,
      s2: 1.5 + Math.random() * 2.6,
    }));
    const links: [number, number][] = [];
    for (let i = 0; i < mpts.length; i++)
      for (let j = i + 1; j < mpts.length; j++) {
        const dx = mpts[i].x - mpts[j].x;
        const dy = mpts[i].y - mpts[j].y;
        const dz = mpts[i].z - mpts[j].z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.36) links.push([i, j]);
      }

    // ---- mutable frame state ----
    let t = 0;
    let energy = 0.15;
    let tiltX = 0;
    let tiltY = 0;
    let mtx = 0;
    let mty = 0;
    let prevMode = "idle";
    let lastRip = 0;
    const ripples: { r: number; a: number }[] = [];

    const onMove = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      mtx = Math.max(-0.7, Math.min(0.7, (e.clientX - (r.left + r.width / 2)) / (r.width || 1)));
      mty = Math.max(-0.5, Math.min(0.5, (e.clientY - (r.top + r.height / 2)) / (r.height || 1)));
    };
    window.addEventListener("mousemove", onMove);

    const draw = () => {
      const RM = reduceRef.current;
      const mode = modeRef.current;
      const liveBars = barsRef.current;
      const light = document.documentElement.dataset.skin === "ghost";
      const style = getComputedStyle(document.documentElement).getPropertyValue("--orb-mode").trim() || "sphere";
      const acc = orbChannels();

      // energy eases to the mode target (mock: speaking .92 / processing .72 / listening .55 / idle .15)
      const targ = mode === "speaking" ? 0.92 : mode === "thinking" ? 0.72 : mode === "listening" ? 0.55 : 0.15;
      energy += (targ - energy) * 0.06;
      const e = energy;
      tiltX += (mtx - tiltX) * 0.05;
      tiltY += (mty - tiltY) * 0.05;

      // speak-start ripples (skipped under reduced motion; existing ones still decay below)
      if (!RM && mode === "speaking" && prevMode !== "speaking") {
        const br = Math.min(w, h) * 0.33;
        ripples.push({ r: br * 0.5, a: 0.6 }, { r: br * 0.2, a: 0.5 });
      }
      prevMode = mode;

      // live-audio fold-in: mean amplitude scales wobble; identical to the mock when idle/no bars
      const active = (mode === "speaking" || mode === "listening") && liveBars.length > 0;
      const avg = active ? liveBars.reduce((s, v) => s + v, 0) / liveBars.length : 0;
      const audioScale = active ? 0.6 + 0.8 * avg : 1;

      let wob: number;
      if (RM) wob = 0;
      else if (mode === "speaking") wob = ((Math.sin(t * 9) + Math.sin(t * 5.3 + 1) + Math.sin(t * 13.7)) / 3) * 0.11 * e * audioScale;
      else if (mode === "thinking") wob = Math.sin(t * 7) * 0.03 * e;
      else if (mode === "listening") wob = Math.sin(t * 5) * 0.045 * e * audioScale;
      else wob = Math.sin(t * 1.2) * 0.022;

      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.33 * (1 + wob);
      const spin = mode === "thinking" && !RM ? 0.85 : 0;
      const ay = t * (RM ? 0.05 : 0.16 + e * 0.45 + spin) + tiltX * 0.9;
      const ax = 0.42 + tiltY * 0.5;
      const cosA = Math.cos(ay);
      const sinA = Math.sin(ay);
      const cosX = Math.cos(ax);
      const sinX = Math.sin(ax);
      const warm = mode === "speaking" && style === "sphere";
      const colStr = warm ? WARM : acc;

      ctx.clearRect(0, 0, w, h);

      // channel lines + traveling packets — on/off from LIVE connection status
      const conn = connRef.current;
      const chans = [
        { dx: 0, dy: -1, on: conn.top },
        { dx: 0, dy: 1, on: conn.bottom },
        { dx: -1, dy: 0, on: conn.left },
        { dx: 1, dy: 0, on: conn.right },
      ];
      const edge = Math.min(w, h) / 2 - 8;
      for (const ch of chans) {
        const sx = cx + ch.dx * (baseR + 6);
        const sy = cy + ch.dy * (baseR + 6);
        const ex = cx + ch.dx * edge;
        const ey = cy + ch.dy * edge;
        ctx.strokeStyle = ch.on ? `rgba(${acc},${light ? 0.22 : 0.16})` : `rgba(${acc},0.05)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        if (ch.on)
          for (let k = 0; k < 3; k++) {
            let u = (t * (0.32 + e * 0.25) + k / 3) % 1;
            if (mode === "thinking") u = 1 - u; // packets flow inward while thinking
            const px = sx + (ex - sx) * u;
            const py = sy + (ey - sy) * u;
            const aa = Math.sin(u * Math.PI);
            ctx.fillStyle = `rgba(${colStr},${0.85 * aa})`;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, 6.283);
            ctx.fill();
          }
      }

      // core glow — dark skins get an additive white-hot core; Ghost a soft dark core
      if (light) {
        const coreR = baseR * (1.05 + e * 0.45);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
        g.addColorStop(0, `rgba(${acc},${0.22 + e * 0.2})`);
        g.addColorStop(0.5, `rgba(${acc},0.09)`);
        g.addColorStop(1, `rgba(${acc},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = "lighter";
        const coreR = baseR * (1.08 + e * 0.6);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
        const wv = warm ? e : 0;
        const r1 = Math.round(120 + 135 * wv);
        const g1 = Math.round(240 - 30 * wv);
        const b1 = Math.round(230 - 80 * wv);
        g.addColorStop(0, `rgba(${r1},${g1},${b1},${0.72 + e * 0.45})`);
        g.addColorStop(0.22, `rgba(${acc},${0.46 + e * 0.3})`);
        g.addColorStop(0.55, `rgba(${acc},0.16)`);
        g.addColorStop(1, `rgba(${acc},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }

      const proj = (p: Vec3) => {
        const x = p.x * cosA + p.z * sinA;
        const z = -p.x * sinA + p.z * cosA;
        const y2 = p.y * cosX - z * sinX;
        const z2 = p.y * sinX + z * cosX;
        return { px: cx + x * baseR, py: cy + y2 * baseR, depth: (z2 + 1) / 2 };
      };

      if (style === "mesh") {
        // GHOST — wobbling wireframe web, depth-shaded
        const jit = RM ? 0 : 0.05 + 0.03 * e;
        const mw = mpts.map((p) => ({
          x: p.x + (0.6 * Math.sin(t * p.s1 + p.ph) + 0.4 * Math.sin(t * p.s2 * 1.7 + p.ph * 2.3)) * jit,
          y: p.y + (0.6 * Math.sin(t * p.s1 * 1.2 + p.ph * 1.6) + 0.4 * Math.cos(t * p.s2 + p.ph)) * jit,
          z: p.z + (0.6 * Math.cos(t * p.s1 * 1.4 + p.ph) + 0.4 * Math.sin(t * p.s2 * 2.1 + p.ph)) * jit,
        }));
        const pr = mw.map(proj);
        ctx.lineWidth = 1;
        for (const [a, b] of links) {
          const a1 = pr[a];
          const a2 = pr[b];
          const dep = (a1.depth + a2.depth) / 2;
          ctx.strokeStyle = `rgba(${acc},${0.05 + dep * dep * 0.5})`;
          ctx.beginPath();
          ctx.moveTo(a1.px, a1.py);
          ctx.lineTo(a2.px, a2.py);
          ctx.stroke();
        }
        for (const q of pr) {
          ctx.fillStyle = `rgba(${acc},${0.22 + q.depth * 0.6})`;
          ctx.beginPath();
          ctx.arc(q.px, q.py, 0.9 + q.depth * 1.5, 0, 6.283);
          ctx.fill();
        }
      } else if (style === "nebula") {
        // AMETHYST — twinkling volumetric cloud + 2 rotating ellipses
        for (const p of vol) {
          const q = proj(p);
          const tw = 0.45 + 0.55 * Math.sin(t * p.sp * 1.8 + p.tw);
          const al = (0.08 + q.depth * q.depth * 0.72) * (0.4 + 0.6 * tw);
          const sz = 0.6 + q.depth * 2.1 * tw;
          ctx.fillStyle = `rgba(${acc},${al})`;
          ctx.beginPath();
          ctx.arc(q.px, q.py, sz, 0, 6.283);
          ctx.fill();
        }
        ctx.save();
        ctx.translate(cx, cy);
        for (let r = 0; r < 2; r++) {
          ctx.rotate(t * 0.12 + r * 1.3);
          ctx.strokeStyle = `rgba(${acc},${0.09 + 0.12 * e})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(0, 0, baseR * 1.16, baseR * 0.4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // ARC — particle surface sphere + EQ halo + radar sweep
        for (let i = 0; i < N_SPHERE; i++) {
          const q = proj(pts[i]);
          const a = 0.12 + q.depth * q.depth * 0.72;
          const sz = 0.5 + q.depth * 1.4;
          ctx.fillStyle = warm && q.depth > 0.7 && (i * 7) % 5 === 0 ? `rgba(${WARM},${a})` : `rgba(${acc},${a})`;
          ctx.fillRect(q.px - sz / 2, q.py - sz / 2, sz, sz);
        }
        const bcount = 76;
        const spd = mode === "speaking" ? 6 : mode === "thinking" ? 4.5 : 3;
        for (let i = 0; i < bcount; i++) {
          const ang = (i / bcount) * Math.PI * 2 + t * 0.18;
          let v = Math.abs(Math.sin(i * 0.5 + t * spd));
          if (active) v = 0.5 * v + 0.5 * (liveBars[i % liveBars.length] ?? 0); // live EQ fold-in
          const len = mode === "idle" ? 1.5 + v * 2 : 3 + v * (mode === "speaking" ? 17 : 9) * e;
          const r0 = baseR * 1.5;
          const x0 = cx + Math.cos(ang) * r0;
          const y0 = cy + Math.sin(ang) * r0;
          const x1 = cx + Math.cos(ang) * (r0 + len);
          const y1 = cy + Math.sin(ang) * (r0 + len);
          ctx.strokeStyle = `rgba(${colStr},${0.12 + 0.4 * e})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.85);
        const lg = ctx.createLinearGradient(0, 0, baseR, 0);
        lg.addColorStop(0, `rgba(${acc},0)`);
        lg.addColorStop(1, `rgba(${acc},${0.45 + e * 0.35})`);
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(baseR, 0);
        ctx.stroke();
        ctx.fillStyle = `rgba(${acc},0.045)`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, baseR, -0.55, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // listening ripple pulse (skipped under RM); existing ripples always decay so none linger
      if (!RM && mode === "listening" && t - lastRip > 0.5) {
        lastRip = t;
        ripples.push({ r: baseR * 0.9, a: 0.5 });
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 2.6;
        rp.a *= 0.965;
        if (rp.a < 0.02) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(${colStr},${rp.a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, rp.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2 rotating gap rings (all skins — the ring law is retired, spec §1)
      ctx.lineWidth = 1;
      const ring = (rad: number, rot: number, alpha: number, gap: number) => {
        ctx.strokeStyle = `rgba(${acc},${alpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, rot, rot + Math.PI * 2 - gap);
        ctx.stroke();
      };
      ring(baseR * 1.22, t * 0.3, light ? 0.22 : 0.16, 1.1);
      ring(baseR * 1.4, -t * 0.22, light ? 0.14 : 0.1, 2.0);
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!reduceRef.current) t += 0.016; // reduced motion freezes t — nothing sweeps, energy still eases
      draw();
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}
```

- [ ] **Step 2: Swap `ZenithOrb.tsx` to the new renderer**

Replace lines 1–35 (imports, dynamic loader, `OrbFallback`) with:

```tsx
"use client";

import type { Connection } from "../lib/mock";
import OrbCanvas from "./OrbCanvas";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type ZenithOrbProps = {
  state?: OrbState;
  connections?: Connection[];
  /** Live 0–1 frequency bars (mic while listening, TTS while speaking); [] when idle. */
  bars?: number[];
};
```

And in the `ZenithOrb` function body replace `<OrbScene {...props} />` with `<OrbCanvas {...props} />`. Keep `NODES`, `NodeChip`, and the wrapper `<div className="relative h-full w-full">` untouched. Update the file-header comment (line 15–18) to say the orb is the 2D-canvas mock port (`OrbCanvas.tsx`), chips stay CSS-anchored.

- [ ] **Step 3: Rename Ghost's orb mode token**

In `frontend/app/globals.css` Ghost block (line 101): `--orb-mode: network;` → `--orb-mode: mesh;`

- [ ] **Step 4: Typecheck**

Run: `cd "C:/Users/Akshat Singh/Dev Folder/Zenith/frontend" && npx tsc --noEmit`
Expected: exit 0. (OrbScene.tsx still exists and still compiles — deleted next task.)

- [ ] **Step 5: Live verify (Playwright on :3001, backend on :8000)**

1. Navigate `http://localhost:3001`, skip boot (`window.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}))` via evaluate, wait ~600ms).
2. Arc idle: screenshot — particle sphere + EQ halo + radar sweep + 2 gap rings + 4 channel lines (packets on the connected ones: Gmail/Calendar/Telegram/Discord per live status).
3. Skin re-style live: evaluate `document.documentElement.dataset.skin='ghost'` → screenshot (ink wireframe mesh, dark core, no additive glow); `='amethyst'` → screenshot (violet nebula + 2 ellipses); reset `='arc'`. (dataset-only switch is enough — every color/style token is re-read per frame.)
4. Orange-on-speak: type a short message in the Command Center, send; screenshot during the spoken reply (`speaking` state) — core/EQ/packets warm to orange on Arc. (Thinking state visible mid-flight: packets reverse + faster spin.)
5. Console: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/OrbCanvas.tsx frontend/components/ZenithOrb.tsx frontend/app/globals.css
git commit -m "feat(hud): 2D-canvas orb port from the HUD mock — sphere/mesh/nebula per skin"
```

---

### Task 2: Delete the R3F stack (OrbScene + three deps + dead CSS)

**Files:**
- Delete: `frontend/components/OrbScene.tsx`
- Modify: `frontend/package.json` (remove `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `@types/three`)
- Modify: `frontend/app/globals.css` (remove the two `.orb-canvas` rule blocks ~lines 276–282 and ~530–546; remove dead tokens `--bloom`, `--particle-count`, `--orb-link-dist`, `--orb-link-alpha` from all three skin blocks; fix the stale OrbScene mention in the comment at line ~203)
- Modify: `frontend/lib/mock.ts` (line 42 comment: "the ANCHORS slot in OrbScene" → "the channel/chip slots in OrbCanvas/ZenithOrb")

**Interfaces:**
- Consumes: Task 1's `OrbCanvas` being the only orb renderer.
- Produces: a frontend with zero three.js — nothing later depends on this task beyond the build staying green.

- [ ] **Step 1: Verify nothing else references the doomed symbols**

Run: `cd "C:/Users/Akshat Singh/Dev Folder/Zenith" && grep -rn "OrbScene\|readOrbTokens\|OrbTokens\|from \"three\"\|@react-three" frontend --include="*.ts" --include="*.tsx" | grep -v "components/OrbScene.tsx"`
Expected: only the `lib/mock.ts` comment (updated this task) and ZenithOrb's header comment if any residue — no live imports.

- [ ] **Step 2: Delete + uninstall**

```bash
cd "C:/Users/Akshat Singh/Dev Folder/Zenith"
git rm frontend/components/OrbScene.tsx
cd frontend && npm uninstall three @react-three/fiber @react-three/drei @react-three/postprocessing @types/three
```

- [ ] **Step 3: Prune dead CSS + comments**

In `globals.css`: delete the `.orb-canvas canvas` mask block (the radial feather — it existed to hide the WebGL bloom square) and the `.orb-canvas` / `:has(> canvas)` canvas-fill block (it forced three.js's inline sizing; a 2D canvas with `absolute inset-0 h-full w-full` needs neither). Delete `--bloom`, `--particle-count`, `--orb-link-dist`, `--orb-link-alpha` lines from the `:root`/arc, ghost, and amethyst blocks. Update the line ~203 comment that names OrbScene to name OrbCanvas. Update `lib/mock.ts:42`'s comment likewise.

- [ ] **Step 4: Typecheck + dev build boots**

Run: `cd "C:/Users/Akshat Singh/Dev Folder/Zenith/frontend" && npx tsc --noEmit`
Expected: exit 0.
Then reload `http://localhost:3001` (dev server picks up the dep change; restart it if the build errors on a stale three chunk) — HUD renders, orb present, console clean.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Akshat Singh/Dev Folder/Zenith"
git add -A frontend/package.json frontend/package-lock.json frontend/app/globals.css frontend/lib/mock.ts
git commit -m "refactor(hud): remove the R3F/three orb stack — OrbCanvas is the only renderer"
```

---

### Task 3: Constellation retune (mock values) + per-skin grid alpha + opaque rails

**Files:**
- Modify: `frontend/components/AmbientBackground.tsx` (seed/velocity/link/dot values; grid alpha from token)
- Modify: `frontend/app/globals.css` (add `--amb-grid-a` to the three skin blocks)
- Modify: `frontend/app/page.tsx` (both rail `<aside>`s get `bg-zenith-bg`)

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (independent).
- Produces: `--amb-grid-a` token (number as string, parsed with `parseFloat`).

- [ ] **Step 1: Revert `AmbientBackground.tsx` to the mock's `_initBg` numbers**

In `seed()` replace the density/velocity block (keep the ResizeObserver + everything else):

```ts
    function seed() {
      // v7 mock (_initBg) values — the authority. The 2026-07-02 denser/faster experiment read
      // as noise at the mock's link/dot alphas; the owner chose exact mock fidelity instead.
      const n = Math.min(110, Math.round((w * h) / 20000));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
      }));
    }
```

Restore `const LINK = 130;` (was 150). In `draw()`:
- grid stroke becomes token-driven — replace the `light ? 0.045 : 0.06` line with:

```ts
      const gridA = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--amb-grid-a")) || 0.022;
      ctx!.strokeStyle = `rgba(${col},${gridA})`;
```

- link alpha: `const na = light ? 0.07 : 0.09;` (was 0.14/0.2)
- dot fill: `` ctx!.fillStyle = `rgba(${col},${light ? 0.35 : 0.5})`; `` (was 0.42/0.62)
- dot radius: `ctx!.arc(p.x, p.y, 1.1, 0, Math.PI * 2);` (was 1.5)

- [ ] **Step 2: Add the grid-alpha token per skin in `globals.css`**

In the `:root, [data-skin="arc"]` block: `--amb-grid-a: 0.022;`
In `[data-skin="ghost"]`: `--amb-grid-a: 0.05;`
In `[data-skin="amethyst"]`: `--amb-grid-a: 0.03;`

- [ ] **Step 3: Opaque rails in `page.tsx`**

Left rail (line ~431): `className="hud-scroll flex w-[288px] flex-none flex-col overflow-y-auto border-r border-zenith-line bg-zenith-bg"`
Right rail (line ~503): `className="hud-scroll flex w-[316px] flex-none flex-col overflow-y-auto border-l border-zenith-line bg-zenith-bg"`
(The mock gives both rails `background: var(--bg)` — that is what keeps the constellation out of them. Icon strip, top bar, and center stay transparent.)

- [ ] **Step 4: Typecheck + live verify**

Run: `cd "C:/Users/Akshat Singh/Dev Folder/Zenith/frontend" && npx tsc --noEmit` → exit 0.
Reload :3001, skip boot: constellation is calm/sparse again (~110 nodes max, slow drift, hairline links); **no dots/links visible over either rail**; still visible behind the icon strip + center + top bar; dataset-skin switch to ghost/amethyst re-tints and grid alpha changes; reduced-motion toggle (Settings → Motion) freezes the field.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Akshat Singh/Dev Folder/Zenith"
git add frontend/components/AmbientBackground.tsx frontend/app/globals.css frontend/app/page.tsx
git commit -m "style(hud): constellation back to mock tuning + per-skin grid alpha + opaque rails"
```

---

### Task 4: CLAUDE.md orb spec rewrite + full cross-skin QA

**Files:**
- Modify: `CLAUDE.md` (UI STYLE orb bullet + KEY DECISIONS orb entry)

**Interfaces:**
- Consumes: everything above.
- Produces: docs matching reality; QA evidence screenshots.

- [ ] **Step 1: Rewrite the orb spec in CLAUDE.md**

Replace the "Center orb = glowing particle sphere (R3F/WebGL)…" UI-STYLE bullet and the "Orb (v1.5)/v7 per-skin orbs" KEY-DECISIONS entry with the new reality (keep surrounding entries intact):

> **Center orb = 2D-canvas HUD orb (v8, 2026-07-02)** — `OrbCanvas.tsx`, a faithful port of the owner's Claude-design HUD mock (spec `docs/superpowers/specs/2026-07-02-hud-orb-port-design.md`). Per-skin styles keyed by `--orb-mode`: Arc `sphere` (950-pt Fibonacci particle sphere + 76-bar EQ halo + radar sweep), Ghost `mesh` (wobbling ink wireframe web), Amethyst `nebula` (1180-pt twinkling volumetric cloud + 2 rotating ellipses). All skins share: mode-driven energy, wobble, mouse tilt, ripples, **2 rotating gap rings (the old "no rings" law is fully retired)**, and 4 channel lines with traveling packets wired to live connection status (chips: Gmail ↑ / Calendar → / Telegram ↓ / Discord ←). **Speaking on Arc warms to orange `255,169,77` — owner-sanctioned 2026-07-02 (overrides the old "never orange" rule; do NOT "fix" it back to cyan).** Live mic/TTS bars modulate wobble + EQ. Reduced motion freezes `t` entirely (stricter than the mock). **The R3F/three.js stack is REMOVED** (`three`, `@react-three/*` uninstalled; `OrbScene.tsx` deleted — supersedes the WebGL particle sphere AND the R3F Amethyst nebula). No WebGL contexts remain in the HUD.

Also update the MASTER PROMPT line mentioning "react-three-fiber (particle-sphere orb)" → "2D-canvas HUD orb (per-skin sphere/mesh/nebula)".

- [ ] **Step 2: Full QA pass (Playwright, backend live)**

1. Reload :3001, skip boot. For each skin (arc → ghost → amethyst via dataset evaluate): screenshot idle — correct style, rings, channels, constellation density, opaque rails.
2. Arc: send a chat message → screenshot thinking (reversed packets, faster spin) and speaking (orange). Verify the reply still typewriters and the confirm gate is unaffected (send "email …" style action only if desired — optional).
3. Reduced-motion ON (Settings → Motion): orb + constellation freeze (radar/EQ/packets static), energy still responds to a state change; toggle OFF resumes.
4. View cycling: Chat ↔ Memory ×10 — console stays clean (no context warnings possible; plain canvases).
5. `cd frontend && npx tsc --noEmit` → exit 0. Backend untouched this whole plan — run `cd backend && python -m pytest -q --ignore=test_stt.py --ignore=test_transcribe_route.py` once: 130 passed.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/Akshat Singh/Dev Folder/Zenith"
git add CLAUDE.md
git commit -m "docs: orb spec v8 — 2D-canvas HUD orb, rings + orange-on-speak sanctioned, R3F removed"
```
