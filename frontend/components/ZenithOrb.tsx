"use client";

import { memo, useId } from "react";
import type { Connection } from "../lib/mock";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const NODE_ANGLES = [-90, 0, 90, 180]; // Gmail top, Calendar right, WhatsApp bottom, Discord left
const ANCHOR_R = 122;
const CORE_R = 28;
const MAXR = 168;
const BANDS = 24;

function polar(deg: number, r: number) {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Star = { x: number; y: number; rad: number; size: number; o: number; band: number; tw: boolean; dl: number; du: number };

function buildField() {
  const rng = mulberry32(0x5eed42);
  const N = 180; // intense mesh
  const stars: Star[] = [];
  let guard = 0;
  while (stars.length < N && guard++ < 8000) {
    const a = rng() * Math.PI * 2;
    const r = MAXR * Math.pow(rng(), 0.58);
    if (r < 24) continue;
    const falloff = 1 - Math.pow(r / MAXR, 1.7);
    stars.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      rad: r,
      size: 0.8 + (0.5 + 1.1 * falloff) * rng(),
      o: Math.max(0.2, Math.min(0.92, (0.34 + 0.46 * falloff) * (0.72 + 0.28 * rng()))),
      band: Math.floor(rng() * BANDS), // which audio band this node dances to
      tw: rng() < 0.4,
      dl: rng() * 4,
      du: 3 + rng() * 3.5,
    });
  }
  // dense interlinked web (each star → 3 nearest)
  const edges: { a: number; b: number; o: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < stars.length; i++) {
    const near = stars
      .map((s, j) => ({ j, d: Math.hypot(s.x - stars[i].x, s.y - stars[i].y) }))
      .filter((o) => o.j !== i)
      .sort((p, q) => p.d - q.d);
    for (let k = 0; k < 3 && k < near.length; k++) {
      if (near[k].d > 46) continue;
      const j = near[k].j;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mr = (stars[i].rad + stars[j].rad) / 2;
      edges.push({ a: Math.min(i, j), b: Math.max(i, j), o: 0.06 + 0.14 * (1 - Math.min(1, mr / MAXR)) });
    }
  }
  // centric: many inner stars run a line to the core; the closest few carry a flow
  const coreLinks = stars.map((s, i) => ({ i, d: s.rad })).filter((o) => o.d < 88).sort((p, q) => p.d - q.d).map((o) => o.i);
  return { stars, edges, coreLinks };
}
const FIELD = buildField();

function anchorLabel(deg: number, text: string) {
  const node = polar(deg, ANCHOR_R);
  const w = text.length * 4.8 + 12;
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  let cx: number, cy: number;
  if (c > 0.3) { cx = node.x + 14 + w / 2; cy = node.y; }
  else if (c < -0.3) { cx = node.x - 14 - w / 2; cy = node.y; }
  else { cx = node.x; cy = node.y + (s > 0 ? 18 : -18); }
  return { bx: cx - w / 2, by: cy - 7, w, tx: cx, ty: cy };
}

// Static web (edges + core-convergence). Memoised — never re-renders during the audio reaction.
const MeshEdges = memo(function MeshEdges() {
  return (
    <>
      {FIELD.edges.map((e, i) => (
        <line key={`e${i}`} x1={FIELD.stars[e.a].x} y1={FIELD.stars[e.a].y} x2={FIELD.stars[e.b].x} y2={FIELD.stars[e.b].y} className="stroke-zenith-cyan" strokeWidth={0.6} opacity={e.o} />
      ))}
      {FIELD.coreLinks.map((idx, k) => {
        const s = FIELD.stars[idx];
        return (
          <g key={`cl${idx}`}>
            <line x1={s.x} y1={s.y} x2={0} y2={0} className="stroke-zenith-cyan" strokeWidth={0.6} opacity={0.06} />
            {k < 6 && <line x1={s.x} y1={s.y} x2={0} y2={0} className="flow-dash stroke-zenith-cyan" strokeWidth={1} strokeDasharray="2 11" strokeLinecap="round" opacity={0.5} />}
          </g>
        );
      })}
    </>
  );
});

// Reactive nodes — scale + brighten in place with their audio band (positions fixed, so the
// static edges stay aligned). Idle: gentle twinkle, no per-frame work.
function ReactiveNodes({ bars }: { bars: number[] }) {
  const reacting = bars.length > 0;
  return (
    <g>
      {FIELD.stars.map((s, i) => {
        const v = reacting ? bars[s.band % bars.length] ?? 0 : 0;
        const size = reacting ? s.size * (1 + v * 1.8) : s.size;
        const op = reacting ? Math.min(1, s.o + v * 0.7) : s.o;
        return (
          <circle
            key={i}
            cx={s.x} cy={s.y} r={size}
            className={`fill-zenith-cyan ${!reacting && s.tw ? "twinkle" : ""}`}
            opacity={op}
            style={!reacting && s.tw ? { animationDelay: `${s.dl}s`, animationDuration: `${s.du}s` } : undefined}
          />
        );
      })}
    </g>
  );
}

// Anchors (bright, boxed, connection-driven). Memoised on connections.
const AnchorLayer = memo(function AnchorLayer({ connections }: { connections: Connection[] }) {
  return (
    <>
      {connections.slice(0, 4).map((c, i) => {
        const ang = NODE_ANGLES[i];
        const node = polar(ang, ANCHOR_R);
        const inner = polar(ang, CORE_R);
        const spokeEnd = polar(ang, ANCHOR_R - 8);
        const on = c.connected;
        const lab = anchorLabel(ang, c.channel);
        return (
          <g key={c.channel}>
            <line x1={inner.x} y1={inner.y} x2={spokeEnd.x} y2={spokeEnd.y} className={on ? "stroke-zenith-cyan/45" : "stroke-zenith-cyan/12"} strokeWidth={on ? 1.5 : 1} />
            {on && <line x1={spokeEnd.x} y1={spokeEnd.y} x2={inner.x} y2={inner.y} className="flow-dash stroke-zenith-cyan" strokeWidth={1.5} strokeDasharray="3 9" strokeLinecap="round" opacity={0.9} />}
            {on && <circle cx={node.x} cy={node.y} r={12} className="stroke-zenith-cyan/25" strokeWidth={1} />}
            <circle cx={node.x} cy={node.y} r={on ? 7 : 6} className={on ? "fill-zenith-cyan stroke-zenith-cyan glow-cyan node-pulse" : "fill-zenith-bg stroke-zenith-cyan/30"} strokeWidth={1.5} />
            <rect x={lab.bx} y={lab.by} width={lab.w} height={14} rx={1.5} className={on ? "fill-zenith-bg/75 stroke-zenith-cyan/40" : "fill-zenith-bg/55 stroke-zenith-text/20"} strokeWidth={1} />
            <text x={lab.tx} y={lab.ty} textAnchor="middle" dominantBaseline="middle" fontSize={8} letterSpacing={1} className={`font-mono ${on ? "fill-zenith-cyan" : "fill-zenith-text/40"}`}>
              {c.channel.toUpperCase()}
            </text>
          </g>
        );
      })}
    </>
  );
});

export function ZenithOrb({
  state = "idle",
  connections = [],
  bars = [],
}: {
  state?: OrbState;
  connections?: Connection[];
  bars?: number[];
}) {
  const uid = useId().replace(/:/g, "");
  const coreId = `core-${uid}`;
  const bloomId = `bloom-${uid}`;

  const coreFill = state === "thinking" ? "#5aa0ff" : state === "speaking" ? "#ff9a4d" : "#eafffb";
  const glow = state === "thinking" ? "glow-blue" : state === "speaking" ? "glow-orange" : "glow-cyan";

  const reacting = bars.length > 0;
  const level = reacting ? bars.reduce((m, v) => (v > m ? v : m), 0) : 0;
  const coreScale = 1 + level * 0.28;

  return (
    <svg viewBox="-188 -188 376 376" fill="none" className="block h-full w-full">
      <defs>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
          <stop offset="16%" stopColor="#00ffe5" stopOpacity={0.5} />
          <stop offset="42%" stopColor="#00ffe5" stopOpacity={0.1} />
          <stop offset="100%" stopColor="#00ffe5" stopOpacity={0} />
        </radialGradient>
        <filter id={bloomId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* drifting web — static edges + audio-reactive nodes */}
      <g className="spin-vslow">
        <MeshEdges />
        <ReactiveNodes bars={bars} />
      </g>

      <AnchorLayer connections={connections} />

      {/* glowing core — collects from the anchors; scales/brightens with the live audio level */}
      <g style={{ transform: `scale(${coreScale})`, transformBox: "fill-box", transformOrigin: "center", transition: "transform 80ms linear" }}>
        <g filter={`url(#${bloomId})`}>
          <circle cx={0} cy={0} r={54} fill={`url(#${coreId})`} className={state === "idle" ? "core-bloom" : ""} />
        </g>
        <circle cx={0} cy={0} r={14} className="stroke-white/70" strokeWidth={1} />
        <g className={glow}>
          <circle cx={0} cy={0} r={8} fill={coreFill} />
        </g>
      </g>

      {/* thinking = brief orbiting dot */}
      {state === "thinking" && (
        <g className="orbit">
          <ellipse cx={0} cy={0} rx={126} ry={76} className="stroke-zenith-blue/40" strokeWidth={1} />
          <circle cx={126} cy={0} r={5} className="fill-zenith-blue stroke-zenith-blue glow-blue" />
        </g>
      )}
    </svg>
  );
}
