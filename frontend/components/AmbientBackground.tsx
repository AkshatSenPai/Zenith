"use client";

import { useEffect, useRef } from "react";

// v7 ambient field: a calm drifting particle + faint grid layer behind the HUD. Reads --orb-color
// so it re-tints per skin, and damps to a single static frame under reduced motion. Pointer-events
// none and parked at -z-20 so it never intercepts clicks or sits over content. See the v7 reference
// bgRef loop (docs/superpowers/reference/v7/Zenith HUD v7.dc.html).
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.reduceMotion === "true";

    let w = 0;
    let h = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    // Accent colour of the active skin (re-read each frame so a skin switch re-tints live).
    function accent() {
      return getComputedStyle(document.documentElement).getPropertyValue("--orb-color").trim() || "#2ee6d6";
    }

    const N = 56;
    const pts = Array.from({ length: N }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00018,
      vy: (Math.random() - 0.5) * 0.00018,
      r: 0.6 + Math.random() * 1.1,
    }));

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      const col = accent();
      // faint grid
      ctx!.globalAlpha = 0.025;
      ctx!.strokeStyle = col;
      ctx!.lineWidth = 1;
      const step = 64;
      ctx!.beginPath();
      for (let x = 0; x <= w; x += step) {
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += step) {
        ctx!.moveTo(0, y);
        ctx!.lineTo(w, y);
      }
      ctx!.stroke();
      // drifting dots
      ctx!.fillStyle = col;
      for (const p of pts) {
        if (!reduce) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0) p.x += 1;
          if (p.x > 1) p.x -= 1;
          if (p.y < 0) p.y += 1;
          if (p.y > 1) p.y -= 1;
        }
        ctx!.globalAlpha = 0.18;
        ctx!.beginPath();
        ctx!.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    let raf = 0;
    if (reduce) {
      draw();
    } else {
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      window.removeEventListener("resize", resize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-20 h-full w-full" />;
}
