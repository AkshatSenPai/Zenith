export function GaugeIndicator({
  label, value, max, unit = "",
}: { label: string; value: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const stroke = pct >= 1 ? "stroke-zenith-red" : pct >= 0.8 ? "stroke-zenith-alert" : "stroke-zenith-cyan";
  const text = pct >= 1 ? "text-zenith-red" : pct >= 0.8 ? "text-zenith-alert" : "text-zenith-cyan";
  const r = 38;
  const circ = 2 * Math.PI * r;
  const len = circ * pct;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 100 100" className="h-16 w-16 -rotate-90" fill="none">
          <circle cx={50} cy={50} r={r} className="stroke-zenith-cyan/15" strokeWidth={6} />
          <circle cx={50} cy={50} r={r} className={`${stroke} glow-cyan`} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${len} ${circ - len}`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-mono text-xs ${text}`}>{Math.round(pct * 100)}%</span>
        </div>
      </div>
      <span className="font-mono text-[9px] uppercase tracking-widest text-zenith-text/50">{label}</span>
      <span className="font-mono text-[9px] text-zenith-text/35">
        {value}{unit}/{max}{unit}
      </span>
    </div>
  );
}
