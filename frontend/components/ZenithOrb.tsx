"use client";

import { TickRing, Arc, Caliper, Crosshair } from "./hud/primitives";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export function ZenithOrb({ state = "idle", size = 300 }: { state?: OrbState; size?: number }) {
  const accent =
    state === "thinking" ? "stroke-zenith-blue" :
    state === "speaking" ? "stroke-zenith-alert" :
    "stroke-zenith-cyan";
  const glow =
    state === "thinking" ? "glow-blue" :
    state === "speaking" ? "glow-orange" :
    "glow-cyan";
  const innerSpin = state === "listening" || state === "speaking" ? "spin-fast" : "spin-mid";
  const pulse = state === "idle" ? "orb-idle-pulse" : "";

  return (
    <svg viewBox="-120 -120 240 240" width={size} height={size} fill="none" className={`${glow} ${pulse}`}>
      {/* outer segmented tick ring */}
      <g className={`${accent} spin-slow`} strokeWidth={1.5}>
        <TickRing r={112} count={72} len={9} />
      </g>
      {/* fine counter-rotating ring */}
      <g className="stroke-zenith-cyan/40 spin-rev-slow" strokeWidth={1}>
        <TickRing r={98} count={140} len={4} />
      </g>
      {/* partial arcs */}
      <g className={`${accent} spin-mid`} strokeWidth={2} opacity={0.85}>
        <Arc r={86} start={20} sweep={70} />
        <Arc r={86} start={140} sweep={38} />
        <Arc r={86} start={212} sweep={88} />
      </g>
      {/* white double inner ring */}
      <g className="stroke-white">
        <circle cx={0} cy={0} r={60} strokeWidth={2} />
        <circle cx={0} cy={0} r={55} strokeWidth={1} opacity={0.6} />
      </g>
      {/* inner segmented gauge */}
      <g className={`${accent} ${innerSpin}`} strokeWidth={2}>
        <TickRing r={46} count={48} len={9} />
      </g>
      {/* caliper brackets, left & right */}
      <g className={accent} strokeWidth={2} opacity={0.8}>
        <Caliper r={120} side="left" />
        <Caliper r={120} side="right" />
      </g>
      {/* central gear / crosshair */}
      <g className={accent} strokeWidth={1.5}>
        <Crosshair r={18} />
        <circle cx={0} cy={0} r={28} strokeWidth={1} opacity={0.5} />
      </g>

      {/* ---- state overlays ---- */}
      {state === "listening" && (
        <>
          <g className="stroke-zenith-cyan" strokeWidth={1.5}>
            <Crosshair r={42} diamond />
          </g>
          <circle className="ripple stroke-zenith-cyan" cx={0} cy={0} r={68} strokeWidth={1.5} />
          <circle className="ripple stroke-zenith-cyan" cx={0} cy={0} r={68} strokeWidth={1} style={{ animationDelay: "1.3s" }} />
        </>
      )}
      {state === "thinking" && (
        <g className="orbit">
          <ellipse cx={0} cy={0} rx={118} ry={66} className="stroke-zenith-blue/50" strokeWidth={1} />
          <circle cx={118} cy={0} r={5} className="fill-zenith-blue stroke-zenith-blue glow-blue" />
        </g>
      )}
      {state === "speaking" && (
        <g className="stroke-zenith-alert">
          {[70, 84, 98].map((r, i) => (
            <circle key={r} cx={0} cy={0} r={r} strokeWidth={1.5} className="wave-pulse" style={{ animationDelay: `${i * 0.25}s` }} />
          ))}
        </g>
      )}
    </svg>
  );
}
