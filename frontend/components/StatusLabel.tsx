"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DUR, EASE, prefersReducedMotion } from "../lib/anim";
import type { OrbState } from "./ZenithOrb";

/** The orb's status word (idle / listening / thinking / speaking). Instead of hard-swapping
 *  the text, the new word lifts + fades in through a masked line — so listening→speaking
 *  reads as a transition, not a jump-cut. Re-runs whenever `state` changes. */
export function StatusLabel({ state }: { state: OrbState }) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(
        ref.current,
        { yPercent: 110, opacity: 0, filter: "blur(3px)" },
        { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: DUR.label, ease: EASE },
      );
    },
    { dependencies: [state], scope: ref },
  );

  return (
    <span className="inline-flex overflow-hidden align-bottom leading-none">
      <span ref={ref} className="inline-block text-zenith-cyan">
        {state}
      </span>
    </span>
  );
}
