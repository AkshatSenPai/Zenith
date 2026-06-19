"use client";

import { useId } from "react";
import type { Connection } from "../lib/mock";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const NODE_ANGLES = [-90, 0, 90, 180]; // Gmail top, Calendar right, WhatsApp bottom, Discord left
const NODE_R = 98; // node distance from centre
const CORE_R = 30; // where spokes start

function polar(deg: number, r: number) {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// Label just outside its node, anchored away from the dot so long names never clip/overlap.
function labelPos(deg: number, node: { x: number; y: number }) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: node.x + (c > 0.3 ? 13 : c < -0.3 ? -13 : 0),
    y: node.y + (s > 0.3 ? 17 : s < -0.3 ? -13 : 0),
    anchor: (c > 0.3 ? "start" : c < -0.3 ? "end" : "middle") as "start" | "end" | "middle",
  };
}

// Sparse, hand-placed background constellation (intentional, not noise).
const STARS: [number, number][] = [
  [-118, -44], [-86, 30], [-54, -96], [-30, 70], [40, -110], [70, -40],
  [104, 28], [60, 96], [-100, -8], [16, -58], [-40, -20], [120, -78],
  [-70, 100], [92, 72],
];
const STAR_LINKS: [number, number][] = [[0, 2], [2, 4], [4, 5], [5, 6], [6, 7], [1, 3], [9, 10]];

export function ZenithOrb({
  state = "idle",
  size = 360,
  connections = [],
}: {
  state?: OrbState;
  size?: number;
  connections?: Connection[];
}) {
  const uid = useId().replace(/:/g, "");
  const coreId = `core-${uid}`;
  const bloomId = `bloom-${uid}`;

  const coreFill =
    state === "thinking" ? "#5aa0ff" : state === "speaking" ? "#ff9a4d" : "#eafffb";
  const glow =
    state === "thinking" ? "glow-blue" : state === "speaking" ? "glow-orange" : "glow-cyan";

  return (
    <svg viewBox="-160 -160 320 320" width={size} height={size} fill="none" className={glow}>
      <defs>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
          <stop offset="22%" stopColor="#00ffe5" stopOpacity={0.7} />
          <stop offset="55%" stopColor="#00ffe5" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#00ffe5" stopOpacity={0} />
        </radialGradient>
        <filter id={bloomId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      {/* background constellation (sparse, slow drift) */}
      <g className="spin-vslow" opacity={state === "idle" ? 0.5 : 0.35}>
        {STAR_LINKS.map(([a, b], i) => (
          <line key={i} x1={STARS[a][0]} y1={STARS[a][1]} x2={STARS[b][0]} y2={STARS[b][1]} className="stroke-zenith-cyan/10" strokeWidth={0.75} />
        ))}
        {STARS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 1.6 : 1} className="fill-zenith-cyan/30" />
        ))}
      </g>

      {/* faint halo rings */}
      <circle cx={0} cy={0} r={120} className="stroke-zenith-cyan/10" strokeWidth={1} />
      <circle cx={0} cy={0} r={146} className="stroke-zenith-cyan/[0.06] spin-vslow" strokeWidth={1} strokeDasharray="2 10" />

      {/* spokes + nodes */}
      {connections.slice(0, 4).map((c, i) => {
        const ang = NODE_ANGLES[i];
        const node = polar(ang, NODE_R);
        const label = labelPos(ang, node);
        const on = c.connected;
        return (
          <g key={c.channel}>
            <g transform={`rotate(${ang})`}>
              <line x1={CORE_R} y1={0} x2={NODE_R - 7} y2={0} className={on ? "stroke-zenith-cyan/35" : "stroke-zenith-cyan/10"} strokeWidth={1} />
              {on && (
                <line x1={CORE_R} y1={0} x2={NODE_R - 7} y2={0} className="flow-dash stroke-zenith-cyan" strokeWidth={1.5} strokeDasharray="3 9" strokeLinecap="round" opacity={0.9} />
              )}
              {on && <circle cx={NODE_R} cy={0} r={11} className="stroke-zenith-cyan/25" strokeWidth={1} />}
              <circle
                cx={NODE_R} cy={0} r={on ? 6 : 5}
                className={on ? "fill-zenith-cyan stroke-zenith-cyan glow-cyan node-pulse" : "fill-zenith-bg stroke-zenith-cyan/25"}
                strokeWidth={1.5}
              />
            </g>
            <text
              x={label.x} y={label.y}
              textAnchor={label.anchor} dominantBaseline="middle"
              fontSize={8.5} letterSpacing={1}
              className={`font-mono ${on ? "fill-zenith-cyan" : "fill-zenith-text/30"}`}
            >
              {c.channel.toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* glowing core (pool of light + bright centre) */}
      <g filter={`url(#${bloomId})`}>
        <circle cx={0} cy={0} r={72} fill={`url(#${coreId})`} className={state === "idle" ? "core-bloom" : ""} />
      </g>
      <circle cx={0} cy={0} r={30} fill={`url(#${coreId})`} />
      <circle cx={0} cy={0} r={9} fill={coreFill} className="glow-cyan" />
      <circle cx={0} cy={0} r={16} className="stroke-white/70" strokeWidth={1} />

      {/* ---- state overlays ---- */}
      {state === "listening" && (
        <>
          <circle className="ripple stroke-zenith-cyan" cx={0} cy={0} r={70} strokeWidth={1.5} />
          <circle className="ripple stroke-zenith-cyan" cx={0} cy={0} r={70} strokeWidth={1} style={{ animationDelay: "1.3s" }} />
        </>
      )}
      {state === "thinking" && (
        <g className="orbit">
          <ellipse cx={0} cy={0} rx={120} ry={70} className="stroke-zenith-blue/45" strokeWidth={1} />
          <circle cx={120} cy={0} r={5} className="fill-zenith-blue stroke-zenith-blue glow-blue" />
        </g>
      )}
      {state === "speaking" && (
        <g className="stroke-zenith-alert">
          {[78, 96, 114].map((r, i) => (
            <circle key={r} cx={0} cy={0} r={r} strokeWidth={1.5} className="wave-pulse" style={{ animationDelay: `${i * 0.25}s` }} />
          ))}
        </g>
      )}
    </svg>
  );
}
