"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { DUR, EASE, prefersReducedMotion } from "../lib/anim";
import { apiFetch, getGoogleStatus, getDiscordStatus, getTelegramStatus } from "../lib/api";

/** v7 boot overlay. The real HUD mounts underneath immediately (so its WebGL orb warms up
 *  hidden), this covers it, plays a GSAP boot sequence (diamond fade-in + typewriter + progress),
 *  then dissolves to reveal the live HUD. Status lines are REAL (pings /health, reads the
 *  connection state) — no fake telemetry. Click / any key skips; prefers-reduced-motion → instant. */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const lineEls = useRef<(HTMLSpanElement | null)[]>([]);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const done = useRef(false);

  // null = still checking; resolves to "online"/"offline" (or 1.2s timeout → offline).
  const [health, setHealth] = useState<"online" | "offline" | null>(null);
  // Real linked-connection count (Gmail/Calendar/Telegram/Discord) — set together with `health`.
  const [linked, setLinked] = useState(0);
  const TOTAL = 4;

  const lines = [
    "INITIALIZING ZENITH",
    "INTERFACE .......... ok",
    `BACKEND :8000 ...... ${health ?? "...."}`,
    `CONNECTIONS ........ ${linked}/${TOTAL} linked`,
    "READY",
  ];

  function finish() {
    if (done.current) return;
    done.current = true;
    onDone();
  }

  // Real backend + connection check, raced against a 1.2s timeout so a dead backend can't hang the
  // boot. health + the linked count resolve in one batch so the typewriter prints the true "N/4".
  useEffect(() => {
    let settled = false;
    const finish = (h: "online" | "offline", n: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      setLinked(n);
      setHealth(h);
    };
    const t = setTimeout(() => finish("offline", 0), 1200);
    Promise.all([
      apiFetch("/health").then((r) => r.ok).catch(() => false),
      getGoogleStatus(),
      getDiscordStatus(),
      getTelegramStatus(),
    ]).then(([ok, g, d, tg]) => {
      const n = [g?.gmail_connected, g?.calendar_connected, tg?.connected, d?.connected].filter(Boolean).length;
      finish(ok ? "online" : "offline", n);
    });
    return () => { settled = true; clearTimeout(t); };
  }, []);

  // Diamond + wordmark fade in immediately (covers the wait for /health).
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(mark.current, { opacity: 0, scale: 0.6, duration: DUR.boot, ease: EASE });
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
      className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center gap-6 bg-zenith-bg"
      role="status"
      aria-label="Zenith is starting up"
    >
      {/* diamond + spaced wordmark */}
      <div ref={mark} className="flex flex-col items-center gap-6">
        <span className="h-7 w-7 rotate-45 border-[1.5px] border-zenith-cyan shadow-[0_0_22px_rgb(var(--zenith-cyan)/0.6)]" />
        <span className="pl-[14px] font-mono text-[38px] font-semibold tracking-[0.38em] text-zenith-hi [text-shadow:0_0_20px_rgb(var(--zenith-cyan)/0.45)]">
          ZENITH
        </span>
      </div>

      {/* progress line */}
      <div className="h-[2px] w-[300px] overflow-hidden rounded-sm bg-zenith-line2">
        <div ref={bar} className="h-full w-0 bg-zenith-cyan shadow-[0_0_10px_rgb(var(--zenith-cyan)/0.9)]" />
      </div>

      {/* boot log (real status lines) */}
      <div className="flex h-[128px] w-[320px] flex-col gap-1.5 font-mono text-[10px] leading-relaxed tracking-wide text-zenith-lo">
        {lines.map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 whitespace-pre">
            <span className="text-zenith-cyan">›</span>
            <span ref={(el) => { lineEls.current[i] = el; }} />
          </div>
        ))}
      </div>

      <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-zenith-dim">click to skip</div>
    </div>
  );
}
