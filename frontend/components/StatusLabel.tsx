"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DUR, EASE, prefersReducedMotion } from "../lib/anim";
import type { OrbState } from "./ZenithOrb";

/** The orb's status word (idle / listening / thinking / speaking). On every change the old
 *  word lifts + blurs out and the new word blurs in from below, so listening→speaking reads
 *  as a deliberate transition rather than a hard swap. The text is driven imperatively so
 *  React never fights the running tween, and it stays an inline-block on the text baseline
 *  so it sits level with the "STATUS:" label beside it. */
export function StatusLabel({ state }: { state: OrbState }) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      if (prefersReducedMotion()) {
        el.textContent = state;
        return;
      }

      // First mount: nothing to swap out — just fade the word up into place.
      if (first.current) {
        first.current = false;
        el.textContent = state;
        gsap.fromTo(
          el,
          { opacity: 0, yPercent: 45, filter: "blur(4px)" },
          { opacity: 1, yPercent: 0, filter: "blur(0px)", duration: DUR.label, ease: EASE },
        );
        return;
      }

      // Swap: blur the old word out (up), set the new text, blur it in (from below).
      gsap
        .timeline()
        .to(el, { opacity: 0, yPercent: -45, filter: "blur(5px)", duration: 0.16, ease: "power2.in" })
        .add(() => {
          el.textContent = state;
        })
        .fromTo(
          el,
          { opacity: 0, yPercent: 45, filter: "blur(5px)" },
          { opacity: 1, yPercent: 0, filter: "blur(0px)", duration: DUR.label, ease: EASE },
        );
    },
    { dependencies: [state], scope: ref },
  );

  return <span ref={ref} className="inline-block text-zenith-cyan" />;
}
