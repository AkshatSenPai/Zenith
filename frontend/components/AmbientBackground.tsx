"use client";

import { useEffect, useRef } from "react";

import { REDUCE_MOTION_EVENT } from "../lib/prefs";

// v7 ambient field: a slowly-scrolling grid + a drifting CONSTELLATION network — nodes that link
// with hairlines when they pass near each other — behind the HUD. Re-tints per skin from
// --orb-color and damps to a single static frame under reduced motion. Pointer-events none, parked
// at -z-20 so it never intercepts clicks or covers content. Mirrors the v7 reference _initBg loop
// (docs/superpowers/reference/v7/Zenith HUD v7.dc.html).
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Reduced motion = OS setting OR the in-app toggle; `let` so a runtime toggle freezes/resumes.
    let reduce = mq.matches || document.documentElement.dataset.reduceMotion === "true";

    let w = 0;
    let h = 0;
    type Pt = { x: number; y: number; vx: number; vy: number };
    let nodes: Pt[] = [];
    function seed() {
      const n = Math.min(110, Math.round((w * h) / 20000));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
      }));
    }
    function resize() {
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    resize();
    window.addEventListener("resize", resize);

    // Accent of the active skin as "r,g,b" channels (re-read each frame so a skin switch re-tints).
    function channels(): string {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--orb-color").trim() || "#2ee6d6";
      let hex = v.replace("#", "");
      if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
      const num = parseInt(hex, 16);
      return `${(num >> 16) & 255},${(num >> 8) & 255},${num & 255}`;
    }

    const GAP = 52; // grid spacing
    const LINK = 130; // node-link distance
    let t = 0;

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      const col = channels();
      const light = document.documentElement.dataset.skin === "ghost";

      // scrolling grid
      const off = reduce ? 0 : (t * 5) % GAP;
      ctx!.strokeStyle = `rgba(${col},${light ? 0.04 : 0.05})`;
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (let x = -off; x < w; x += GAP) {
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, h);
      }
      for (let y = -off; y < h; y += GAP) {
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
      }
      ctx!.stroke();

      // drift the nodes (wrap at the edges)
      if (!reduce) {
        for (const p of nodes) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x = w;
          else if (p.x > w) p.x = 0;
          if (p.y < 0) p.y = h;
          else if (p.y > h) p.y = 0;
        }
      }

      // constellation links — a hairline between nodes closer than LINK, fading with distance
      const na = light ? 0.07 : 0.09;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK) {
            ctx!.strokeStyle = `rgba(${col},${(1 - dist / LINK) * na})`;
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.stroke();
          }
        }
      }

      // node dots
      ctx!.fillStyle = `rgba(${col},${light ? 0.35 : 0.5})`;
      for (const p of nodes) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    let raf = 0;
    function frame() {
      t += 0.016;
      draw();
      raf = requestAnimationFrame(frame);
    }
    function start() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (reduce) {
        draw(); // single static frame — no rAF
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    start();

    // Re-read on an OS change or the in-app toggle; freeze/resume the field immediately.
    const onReduceChange = () => {
      reduce = mq.matches || document.documentElement.dataset.reduceMotion === "true";
      start();
    };
    mq.addEventListener("change", onReduceChange);
    window.addEventListener(REDUCE_MOTION_EVENT, onReduceChange);

    return () => {
      window.removeEventListener("resize", resize);
      mq.removeEventListener("change", onReduceChange);
      window.removeEventListener(REDUCE_MOTION_EVENT, onReduceChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-20 h-full w-full" />;
}
