"use client";

// Tiny SVG sparkline for the usage panel — a session series of cumulative token totals.
// Auto-scales to the data; renders nothing until there are at least 2 points. Accent-themed.
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const span = max - min || 1;
  const xs = (i: number) => (i / (points.length - 1)) * 120;
  const ys = (v: number) => 26 - ((v - min) / span) * 24 - 1;
  const line = points.map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const area = `0,26 ${line} 120,26`;
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" className="block h-[26px] w-full">
      <polyline points={area} fill="rgb(var(--zenith-cyan) / 0.10)" stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke="rgb(var(--zenith-cyan))"
        strokeWidth="1.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
