// Reusable inline-SVG HUD primitives. Each takes a centre (cx, cy) in the
// parent <svg> user units. Stroke colour is inherited — set it on a wrapping
// <g>/<svg> via a Tailwind `stroke-*` utility.

export function TickRing({
  r, count, len, width = 1, cx = 0, cy = 0,
}: { r: number; count: number; len: number; width?: number; cx?: number; cy?: number }) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * 2 * Math.PI;
        const c = Math.cos(a);
        const s = Math.sin(a);
        return (
          <line
            key={i}
            x1={cx + r * c}
            y1={cy + r * s}
            x2={cx + (r - len) * c}
            y2={cy + (r - len) * s}
            strokeWidth={width}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
}

export function Arc({
  r, start, sweep, width = 2, cx = 0, cy = 0,
}: { r: number; start: number; sweep: number; width?: number; cx?: number; cy?: number }) {
  const circ = 2 * Math.PI * r;
  const len = (circ * sweep) / 360;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      strokeWidth={width}
      strokeDasharray={`${len} ${circ - len}`}
      strokeLinecap="round"
      transform={`rotate(${start} ${cx} ${cy})`}
    />
  );
}

export function Caliper({
  r, side, sweep = 44, width = 2, cx = 0, cy = 0,
}: { r: number; side: "left" | "right"; sweep?: number; width?: number; cx?: number; cy?: number }) {
  const mid = side === "left" ? 180 : 0;
  const start = mid - sweep / 2;
  const tick = 8;
  const end = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return {
      x1: cx + r * Math.cos(a),
      y1: cy + r * Math.sin(a),
      x2: cx + (r - tick) * Math.cos(a),
      y2: cy + (r - tick) * Math.sin(a),
    };
  };
  const e0 = end(start);
  const e1 = end(start + sweep);
  return (
    <g>
      <Arc r={r} start={start} sweep={sweep} width={width} cx={cx} cy={cy} />
      <line x1={e0.x1} y1={e0.y1} x2={e0.x2} y2={e0.y2} strokeWidth={width} strokeLinecap="round" />
      <line x1={e1.x1} y1={e1.y1} x2={e1.x2} y2={e1.y2} strokeWidth={width} strokeLinecap="round" />
    </g>
  );
}

export function Hex({
  cx, cy, size, width = 1,
}: { cx: number; cy: number; size: number; width?: number }) {
  const pts = Array.from({ length: 6 })
    .map((_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`;
    })
    .join(" ");
  return <polygon points={pts} fill="none" strokeWidth={width} />;
}

export function Crosshair({
  r = 16, cx = 0, cy = 0, width = 1.5, diamond = false,
}: { r?: number; cx?: number; cy?: number; width?: number; diamond?: boolean }) {
  return (
    <g strokeWidth={width} strokeLinecap="round">
      <line x1={cx - r} y1={cy} x2={cx - r / 2.5} y2={cy} />
      <line x1={cx + r / 2.5} y1={cy} x2={cx + r} y2={cy} />
      <line x1={cx} y1={cy - r} x2={cx} y2={cy - r / 2.5} />
      <line x1={cx} y1={cy + r / 2.5} x2={cx} y2={cy + r} />
      <circle cx={cx} cy={cy} r={2} />
      {diamond && (
        <polygon
          points={`${cx},${cy - r * 1.5} ${cx + r * 1.5},${cy} ${cx},${cy + r * 1.5} ${cx - r * 1.5},${cy}`}
          fill="none"
        />
      )}
    </g>
  );
}

// Small L-shaped corner brackets for cards (premium HUD accent). Absolute-positioned;
// the parent must be `relative`. Subtle by default; pass a brighter `cls` for emphasis.
export function CardBrackets({ cls = "border-zenith-cyan/25", size = 8 }: { cls?: string; size?: number }) {
  const s = `${size}px`;
  return (
    <>
      <span className={`pointer-events-none absolute left-0 top-0 border-l border-t ${cls}`} style={{ width: s, height: s }} />
      <span className={`pointer-events-none absolute right-0 top-0 border-r border-t ${cls}`} style={{ width: s, height: s }} />
      <span className={`pointer-events-none absolute bottom-0 left-0 border-b border-l ${cls}`} style={{ width: s, height: s }} />
      <span className={`pointer-events-none absolute bottom-0 right-0 border-b border-r ${cls}`} style={{ width: s, height: s }} />
    </>
  );
}

// Thin L-shaped corner ticks framing the viewport (v7 design): a 1px hairline accent bracket
// inset from each corner. Replaces the old hex-cluster accents; tints/dims per skin via --zenith-cyan.
export function HexCorners() {
  const tick = "pointer-events-none fixed z-30 h-4 w-4 border-zenith-cyan/40";
  return (
    <>
      <span className={`${tick} left-2 top-2 border-l border-t`} />
      <span className={`${tick} right-2 top-2 border-r border-t`} />
      <span className={`${tick} bottom-2 left-2 border-b border-l`} />
      <span className={`${tick} bottom-2 right-2 border-b border-r`} />
    </>
  );
}
