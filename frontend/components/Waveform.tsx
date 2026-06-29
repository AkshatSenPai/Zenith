"use client";

import { useEffect, useRef } from "react";

/** Status-row waveform (v7): draws the live 0–1 voice bars — mic while listening, TTS while
 *  speaking; an empty array → a faint idle baseline. The color follows the active skin's
 *  --zenith-cyan so it re-tints on a skin switch. A single <canvas> (not 56 live DOM nodes)
 *  keeps the ~60fps redraw cheap. */
export function Waveform({ bars, width = 170, height = 24 }: { bars: number[]; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--zenith-cyan").trim() || "0 255 229";
    const mid = height / 2;

    if (!bars.length) {
      ctx.strokeStyle = `rgb(${accent} / 0.22)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();
      return;
    }

    const n = bars.length;
    const step = width / n;
    const bw = Math.max(1, step - 1);
    ctx.fillStyle = `rgb(${accent})`;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(1, bars[i] ?? 0));
      const h = Math.max(1, v * (height - 2));
      ctx.fillRect(i * step, mid - h / 2, bw, h);
    }
  }, [bars, width, height]);

  return <canvas ref={ref} aria-hidden className="block" style={{ width, height }} />;
}
