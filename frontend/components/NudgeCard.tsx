import { Corner, TONES, type Tone } from "./cardShell";

export type Nudge = {
  id: string;
  kind: string;
  tone: Tone;
  title: string;
  body: string;
  action: { label: string; prefill: string } | null;
  urgency: number;
};

/** A single proactive nudge. Same notched shell as StatusCard (shared cardShell), but its own
 *  footer: primary action (prefills the Command Center) + Snooze (Tonight/Tomorrow) + Dismiss. */
export function NudgeCard({
  nudge, onAction, onDismiss, onSnooze,
}: {
  nudge: Nudge;
  onAction: (n: Nudge) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, preset: "evening" | "tomorrow") => void;
}) {
  const t = TONES[nudge.tone] ?? TONES.info;
  return (
    <div className={`status-surface relative border ${t.border} px-4 py-3`}>
      <Corner pos="tl" cls={t.corner} /><Corner pos="tr" cls={t.corner} />
      <Corner pos="bl" cls={t.corner} /><Corner pos="br" cls={t.corner} />
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${t.text}`}>{nudge.title}</span>
        <button
          onClick={() => onDismiss(nudge.id)}
          aria-label="Dismiss"
          className="press font-mono text-[11px] text-zenith-lo transition hover:text-zenith-alert"
        >✕</button>
      </div>
      <div className="text-sm leading-relaxed text-zenith-mid">{nudge.body}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {nudge.action && (
          <button
            onClick={() => onAction(nudge)}
            className="press rounded-md bg-zenith-cyan px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zenith-bg transition hover:opacity-90"
          >{nudge.action.label}</button>
        )}
        <button
          onClick={() => onSnooze(nudge.id, "evening")}
          className="press rounded-md border border-zenith-line2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo transition hover:text-zenith-mid"
        >Tonight</button>
        <button
          onClick={() => onSnooze(nudge.id, "tomorrow")}
          className="press rounded-md border border-zenith-line2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo transition hover:text-zenith-mid"
        >Tomorrow</button>
      </div>
    </div>
  );
}
