"use client";

import { useRef, useState } from "react";
import { quickActions, dayStats } from "../lib/mock";

export function QuickActions() {
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function tap(id: string) {
    setFlash(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1400);
  }

  return (
    <section className="relative z-10 border-r border-zenith-cyan/12 p-4">
      <div className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Quick Actions</div>

      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] uppercase tracking-widest text-zenith-text/45">
        <Stat n={dayStats.meetings} label="meetings" />
        <span className="text-zenith-cyan/20">·</span>
        <Stat n={dayStats.unread} label="unread" />
        <span className="text-zenith-cyan/20">·</span>
        <Stat n={dayStats.drafts} label="drafts" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {quickActions.map((a) => (
          <button
            key={a.id}
            onClick={() => tap(a.id)}
            className="panel panel-hover press relative flex flex-col items-start gap-1 px-3 py-2.5 text-left"
          >
            <span className="font-mono text-[11px] text-zenith-text/85">{a.label}</span>
            <span className="font-mono text-[8px] uppercase tracking-widest text-zenith-cyan/55">
              {flash === a.id ? `soon · ${a.milestone}` : a.milestone}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-display text-sm font-bold tabular-nums text-zenith-cyan">{n}</span>
      {label}
    </span>
  );
}
