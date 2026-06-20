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

// The orb is a WebGL particle sphere — load it client-only (no SSR) so we never try to
// hydrate a canvas / WebGL context on the server (the Next 14 App Router gotcha). Until it
// mounts, show a calm cyan glow so there's no blank flash. See OrbScene.tsx / TODO.md §2.
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
          "radial-gradient(circle at 50% 50%, rgba(0,255,229,0.16), rgba(0,255,229,0.04) 38%, transparent 66%)",
      }}
    />
  );
}

export function ZenithOrb(props: ZenithOrbProps) {
  return (
    <div className="h-full w-full">
      <OrbScene {...props} />
    </div>
  );
}
