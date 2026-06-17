type Tone = "info" | "alert" | "critical";

const tones: Record<Tone, { border: string; text: string; corner: string }> = {
  info: { border: "border-zenith-cyan/40", text: "text-zenith-cyan", corner: "border-zenith-cyan" },
  alert: { border: "border-zenith-alert/50", text: "text-zenith-alert", corner: "border-zenith-alert" },
  critical: { border: "border-zenith-red/60", text: "text-zenith-red", corner: "border-zenith-red" },
};

function Corner({ pos, cls }: { pos: "tl" | "tr" | "bl" | "br"; cls: string }) {
  const m: Record<string, string> = {
    tl: "left-0 top-0 border-l border-t",
    tr: "right-0 top-0 border-r border-t",
    bl: "bottom-0 left-0 border-b border-l",
    br: "bottom-0 right-0 border-b border-r",
  };
  return <span className={`pointer-events-none absolute h-2 w-2 ${m[pos]} ${cls}`} />;
}

export function StatusCard({
  tone = "alert", title, children, onConfirm, onCancel, busy,
}: {
  tone?: Tone;
  title: string;
  children?: React.ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const t = tones[tone];
  return (
    <div className={`relative border ${t.border} bg-zenith-cyan/[0.03] px-4 py-3`}>
      <Corner pos="tl" cls={t.corner} />
      <Corner pos="tr" cls={t.corner} />
      <Corner pos="bl" cls={t.corner} />
      <Corner pos="br" cls={t.corner} />
      <div className="mb-1.5 flex items-center gap-2">
        <span className={t.text} aria-hidden>▲</span>
        <span className={`font-mono text-[10px] uppercase tracking-widest ${t.text}`}>{title}</span>
      </div>
      {children && <div className="font-body text-sm text-zenith-text/85">{children}</div>}
      {(onConfirm || onCancel) && (
        <div className="mt-3 flex gap-2">
          {onConfirm && (
            <button onClick={onConfirm} disabled={busy} className="rounded-sm bg-zenith-cyan px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-zenith-bg transition disabled:opacity-40">
              Confirm
            </button>
          )}
          {onCancel && (
            <button onClick={onCancel} disabled={busy} className="rounded-sm border border-zenith-red/50 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest text-zenith-red transition disabled:opacity-40">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
