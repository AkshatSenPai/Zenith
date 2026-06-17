export function WaveformBar({ active = false, level = 0 }: { active?: boolean; level?: number }) {
  const W = 600;
  const mid = 30;
  const amp = (active ? 16 : 6) + level * 18; // live mic level boosts amplitude
  let d = `M 0 ${mid}`;
  for (let x = 0; x <= W; x += 5) {
    const y = mid + amp * Math.sin(x / 22) * (0.65 + 0.35 * Math.sin(x / 90));
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return (
    <svg viewBox="0 0 600 60" preserveAspectRatio="none" className="glow-cyan h-12 w-full" fill="none">
      <line x1={0} y1={mid} x2={600} y2={mid} className="stroke-zenith-cyan/15" strokeWidth={1} />
      <g className="wave-scroll">
        <path d={d} className="stroke-zenith-cyan" strokeWidth={1.5} />
        <path d={d} transform="translate(600 0)" className="stroke-zenith-cyan" strokeWidth={1.5} />
      </g>
    </svg>
  );
}
