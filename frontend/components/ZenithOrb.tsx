"use client";

import dynamic from "next/dynamic";
import type { Connection } from "../lib/mock";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type ZenithOrbProps = {
  state?: OrbState;
  connections?: Connection[];
  /** Live 0–1 frequency bars (mic while listening, TTS while speaking); [] when idle. */
  bars?: number[];
};

// The orb is a WebGL particle sphere — load it client-only (no SSR) so we never try to hydrate a
// canvas / WebGL context on the server. Until it mounts, show a calm cyan glow so there's no blank
// flash. The 4 connection-node chips are CSS-positioned around the orb box (NOT drei <Html> 3D
// anchors), so they track the orb smoothly as it resizes — fixing the old drift/snap. See OrbScene.tsx.
const OrbScene = dynamic(() => import("./OrbScene"), {
  ssr: false,
  loading: () => <OrbFallback />,
});

function OrbFallback() {
  return (
    <div
      aria-hidden
      className="h-full w-full"
      style={{
        background:
          "radial-gradient(circle at 50% 50%, rgb(var(--zenith-cyan) / 0.16), rgb(var(--zenith-cyan) / 0.04) 38%, transparent 66%)",
      }}
    />
  );
}

// v7 node chips at the four edge-midpoints of the orb box; lit when the channel is connected.
const NODES: { channel: Connection["channel"]; label: string; cls: string }[] = [
  { channel: "Gmail", label: "GMAIL", cls: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" },
  { channel: "Calendar", label: "CALENDAR", cls: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2" },
  { channel: "Telegram", label: "TELEGRAM", cls: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" },
  { channel: "Discord", label: "DISCORD", cls: "left-0 top-1/2 -translate-y-1/2 -translate-x-1/2" },
];

function NodeChip({ label, on, cls }: { label: string; on: boolean; cls: string }) {
  return (
    <div className={`pointer-events-none absolute z-[2] ${cls}`}>
      <div
        className={`flex select-none items-center gap-1.5 whitespace-nowrap rounded-md border bg-zenith-bg px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors duration-500 ${
          on ? "border-zenith-cyan/30 text-zenith-mid" : "border-zenith-line2 text-zenith-lo"
        }`}
      >
        <span
          className={
            on
              ? "h-1.5 w-1.5 rounded-full bg-zenith-cyan shadow-[0_0_6px_rgb(var(--zenith-cyan)/0.9)]"
              : "h-1.5 w-1.5 rounded-full bg-zenith-faint"
          }
        />
        {label}
      </div>
    </div>
  );
}

export function ZenithOrb(props: ZenithOrbProps) {
  const on = (ch: Connection["channel"]) => !!props.connections?.find((c) => c.channel === ch)?.connected;
  return (
    <div className="relative h-full w-full">
      <OrbScene {...props} />
      {NODES.map((n) => (
        <NodeChip key={n.channel} label={n.label} on={on(n.channel)} cls={n.cls} />
      ))}
    </div>
  );
}
