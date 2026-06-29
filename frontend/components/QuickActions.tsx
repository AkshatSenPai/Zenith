"use client";

import { useRef, useState } from "react";
import { quickActions, dayStats } from "../lib/mock";
import { briefingGreeting } from "../lib/greeting";

// Starter prompts for the real M3/M6 actions; they prefill the Command Center input.
const PREFILL: Record<string, string> = {
  email: "Draft an email to ",
  event: "Add to my calendar: ",
  proposal: "Draft a proposal for ",
  note: "Note that ",
};

// v7 left-rail Quick Actions: time-aware greeting/briefing button + a 2-col action grid.
// Callbacks (onPrefill/onBriefing) and the prefill/flash logic are unchanged.
export function QuickActions({
  onPrefill,
  onBriefing,
}: {
  onPrefill?: (text: string) => void;
  onBriefing?: () => void;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function tap(id: string) {
    if (PREFILL[id] && onPrefill) {
      onPrefill(PREFILL[id]);
      return;
    }
    setFlash(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1400);
  }

  return (
    <section className="px-[18px] pb-2">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-dim">Quick Actions</div>

      {/* time-aware greeting → runs the spoken briefing (events + unread + weather) */}
      <button
        onClick={onBriefing}
        className="press mb-2.5 flex w-full items-center justify-between rounded-md border border-zenith-line bg-zenith-panel px-3 py-2.5 text-left transition-colors hover:border-zenith-cyan/40"
      >
        <span className="text-[12px] text-zenith-mid">{briefingGreeting()}</span>
        <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-zenith-cyan">briefing</span>
      </button>

      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-dim">
        <Stat n={dayStats.meetings} label="meetings" />
        <span className="text-zenith-faint">·</span>
        <Stat n={dayStats.unread} label="unread" />
        <span className="text-zenith-faint">·</span>
        <Stat n={dayStats.drafts} label="drafts" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {quickActions.map((a) => {
          const live = Boolean(PREFILL[a.id]);
          return (
            <button
              key={a.id}
              onClick={() => tap(a.id)}
              className="press flex min-h-[68px] flex-col items-start gap-2 rounded-md border border-zenith-line bg-zenith-panel px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-zenith-cyan/40 hover:bg-zenith-cyan/[0.05]"
            >
              <span className="text-[12px] font-medium leading-tight text-zenith-mid">{a.label}</span>
              <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-zenith-cyan/55">
                {live ? "ready" : flash === a.id ? `soon · ${a.milestone}` : a.milestone}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-[13px] font-semibold tabular-nums text-zenith-cyan">{n}</span>
      {label}
    </span>
  );
}
