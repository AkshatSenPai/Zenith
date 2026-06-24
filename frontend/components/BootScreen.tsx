"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { connections } from "../lib/mock";
import { DUR, EASE, prefersReducedMotion } from "../lib/anim";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Cinematic boot overlay. The real HUD mounts underneath immediately (so its WebGL orb
 *  warms up hidden), this covers it, plays a GSAP boot sequence, then dissolves to reveal
 *  the live HUD. Status lines are REAL (pings /health, reads the connection state) — no
 *  fake telemetry. Click / any key skips; prefers-reduced-motion → instant. */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLSpanElement | null)[]>([]);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const done = useRef(false);

  // null = still checking; resolves to "online"/"offline" (or 1.2s timeout → offline).
  const [health, setHealth] = useState<"online" | "offline" | null>(null);

  const linked = connections.filter((c) => c.connected).length;
  const lines = [
    "> INITIALIZING ZENITH",
    "> INTERFACE .......... ok",
    `> BACKEND :8000 ...... ${health ?? "...."}`,
    `> CONNECTIONS ........ ${linked}/${connections.length} linked`,
    "> READY",
  ];

  function finish() {
    if (done.current) return;
    done.current = true;
    onDone();
  }

  // Real backend check (raced against a 1.2s timeout so a dead backend can't hang the boot).
  useEffect(() => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) { settled = true; setHealth("offline"); }
    }, 1200);
    fetch(`${API_URL}/health`)
      .then((r) => (r.ok ? r : Promise.reject()))
      .then(() => { if (!settled) { settled = true; clearTimeout(t); setHealth("online"); } })
      .catch(() => { if (!settled) { settled = true; clearTimeout(t); setHealth("offline"); } });
    return () => { settled = true; clearTimeout(t); };
  }, []);

  // Orb + frame fade in immediately (covers the wait for /health).
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(orb.current, { opacity: 0, scale: 0.6, duration: DUR.boot, ease: EASE });
    },
    { scope: root },
  );

  // Typewriter + progress + dissolve — runs once /health is known (or timed out).
  useGSAP(
    () => {
      if (health === null) return;

      if (prefersReducedMotion()) {
        lineEls.current.forEach((el, i) => { if (el) el.textContent = lines[i]; });
        gsap.to(root.current, { opacity: 0, duration: 0.3, delay: 0.25, onComplete: finish });
        return;
      }

      const t = gsap.timeline({ delay: 0.35 });
      tl.current = t;

      // progress bar fills across the whole sequence
      t.fromTo(bar.current, { width: "0%" }, { width: "100%", duration: 2.0, ease: "none" }, 0);

      lineEls.current.forEach((el, i) => {
        if (!el) return;
        const text = lines[i];
        const o = { n: 0 };
        t.to(o, {
          n: text.length,
          duration: Math.max(0.22, text.length / 60), // ~60 chars/sec
          ease: "none",
          onUpdate: () => { el.textContent = text.slice(0, Math.ceil(o.n)); },
        }, i === 0 ? 0.1 : ">+0.06");
      });

      // hold a beat on READY, then dissolve the overlay to reveal the live HUD
      t.to(root.current, { opacity: 0, duration: DUR.dissolve, ease: EASE, onComplete: finish }, ">+0.3");
    },
    { dependencies: [health], scope: root },
  );

  // Skip: click anywhere / any key → quick fade out.
  useEffect(() => {
    function skip() {
      if (done.current) return;
      tl.current?.kill();
      gsap.to(root.current, { opacity: 0, duration: 0.25, onComplete: finish });
    }
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, []);

  return (
    <div
      ref={root}
      onClick={() => { tl.current?.kill(); if (!done.current) gsap.to(root.current, { opacity: 0, duration: 0.25, onComplete: finish }); }}
      className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center bg-zenith-bg"
      role="status"
      aria-label="Zenith is starting up"
    >
      <div className="bg-aura" />
      <div className="bg-grain" />

      {/* stylized boot orb (lightweight SVG — the real WebGL orb is revealed on dissolve) */}
      <div ref={orb} className="relative mb-11">
        <BootOrb />
      </div>

      {/* boot log */}
      <div className="w-[min(88vw,520px)] font-mono text-[14px] leading-[1.9] text-zenith-cyan/85">
        {lines.map((_, i) => (
          <div key={i} className="whitespace-pre">
            <span ref={(el) => { lineEls.current[i] = el; }} />
          </div>
        ))}
        <span className="blink text-zenith-cyan">▮</span>
      </div>

      {/* progress line */}
      <div className="mt-7 h-[2px] w-[min(88vw,520px)] overflow-hidden bg-zenith-cyan/12">
        <div ref={bar} className="h-full w-0 bg-zenith-cyan/70" />
      </div>

      <div className="absolute bottom-6 font-mono text-[10px] uppercase tracking-[0.3em] text-zenith-text/30">
        click or press any key to skip
      </div>
    </div>
  );
}

function BootOrb() {
  return (
    <svg viewBox="0 0 160 160" className="h-48 w-48 glow-cyan text-zenith-cyan" fill="none">
      <circle cx="80" cy="80" r="58" stroke="currentColor" strokeOpacity="0.12" />
      <circle cx="80" cy="80" r="44" stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 7" className="spin-vslow" />
      <circle cx="80" cy="80" r="30" stroke="currentColor" strokeOpacity="0.3" />
      <circle cx="80" cy="80" r="9" fill="currentColor" className="core-bloom" />
      {/* scattered points for the particle-sphere hint */}
      {[
        [80, 22], [128, 56], [120, 116], [58, 134], [26, 92], [34, 40], [110, 30], [136, 88],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" fill="currentColor" className="twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
      ))}
    </svg>
  );
}
