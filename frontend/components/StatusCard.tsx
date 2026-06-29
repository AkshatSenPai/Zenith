type Tone = "info" | "alert" | "critical";

const tones: Record<Tone, { border: string; text: string; corner: string }> = {
  info: { border: "border-zenith-cyan/40", text: "text-zenith-cyan", corner: "border-zenith-cyan" },
  alert: { border: "border-zenith-alert/55", text: "text-zenith-alert", corner: "border-zenith-alert" },
  critical: { border: "border-zenith-red/60", text: "text-zenith-red", corner: "border-zenith-red" },
};

function Corner({ pos, cls }: { pos: "tl" | "tr" | "bl" | "br"; cls: string }) {
  const m: Record<string, string> = {
    tl: "left-0 top-0 border-l border-t",
    tr: "right-0 top-0 border-r border-t",
    bl: "bottom-0 left-0 border-b border-l",
    br: "bottom-0 right-0 border-b border-r",
  };
  return <span className={`pointer-events-none absolute h-2.5 w-2.5 ${m[pos]} ${cls}`} />;
}

/** Confirm gate / status card — the trust layer. Pinned above the paginated Command Center and
 *  shown only while an action is pending (page.tsx). Restyled to v7 (text hierarchy + rounded
 *  buttons); keeps the tone/busy API + the ⚠ untrusted warning passed in via children. */
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
    <div className={`status-surface relative border ${t.border} px-4 py-3.5`}>
      <Corner pos="tl" cls={t.corner} />
      <Corner pos="tr" cls={t.corner} />
      <Corner pos="bl" cls={t.corner} />
      <Corner pos="br" cls={t.corner} />
      <div className="mb-2 flex items-center gap-2">
        <span className={`text-[10px] ${t.text}`} aria-hidden>▲</span>
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${t.text}`}>{title}</span>
      </div>
      {children && <div className="text-sm leading-relaxed text-zenith-mid">{children}</div>}
      {(onConfirm || onCancel) && (
        <div className="mt-3.5 flex gap-2.5">
          {onConfirm && (
            <button
              onClick={onConfirm}
              disabled={busy}
              className="press rounded-md bg-zenith-cyan px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-zenith-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={busy}
              className="press rounded-md border border-zenith-line2 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-zenith-lo transition hover:border-zenith-alert hover:text-zenith-alert disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
