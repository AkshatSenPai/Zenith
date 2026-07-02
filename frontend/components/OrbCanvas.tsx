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
