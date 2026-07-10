import { Corner, TONES, type Tone } from "./cardShell";

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
  const t = TONES[tone];
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
