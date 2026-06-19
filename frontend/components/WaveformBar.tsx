import type { CSSProperties } from "react";

const N = 32;

/** Compact reactive visualizer: live frequency bars while listening/speaking,
 *  a calm low pulse when idle. Heights animate via GPU `scaleY`. */
export function WaveformBar({ active = false, bars }: { active?: boolean; bars?: number[] }) {
  const live = active && !!bars && bars.length > 0;
  return (
    <div className={`flex h-9 items-end gap-[3px] ${active ? "glow-cyan" : ""}`} aria-hidden>
      {Array.from({ length: N }).map((_, i) => {
        const v = live ? bars![i % bars!.length] : 0;
        const style: CSSProperties = live
          ? {
              height: "100%",
              transformOrigin: "center",
              transform: `scaleY(${Math.max(0.06, v)})`,
              animation: "none",
              transition: "transform 90ms linear",
            }
          : {
              height: "100%",
              transformOrigin: "center",
              transform: "scaleY(0.22)",
              animationDelay: `${(i % 8) * 90}ms`,
            };
        return (
          <span
            key={i}
            className={`bar-idle w-[3px] shrink-0 rounded-full ${active ? "bg-zenith-cyan" : "bg-zenith-cyan/35"}`}
            style={style}
          />
        );
      })}
    </div>
  );
}
