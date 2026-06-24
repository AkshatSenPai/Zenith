"use client";

import { useEffect, useState } from "react";

export function TopBar({ minimal = false }: { minimal?: boolean }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now
    ? now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
    : "";
  const timeStr = now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
  const daysInMonth = now ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() : 0;
  const todayDate = now ? now.getDate() : -1;

  return (
    <header className="relative z-10 border-b border-zenith-cyan/15 bg-zenith-bg/70 px-4 pb-2 pt-2.5">
      <div className="flex items-center justify-between gap-4">
        {/* lockup */}
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="glow-cyan h-5 w-5" fill="none">
            <path d="M12 2 22 12 12 22 2 12Z" className="stroke-zenith-cyan" strokeWidth={1.5} strokeLinejoin="round" />
            <path d="M12 7 17 12 12 17 7 12Z" className="fill-zenith-cyan/80" />
          </svg>
          <span className="glow-cyan font-display text-lg font-bold tracking-[0.3em] text-zenith-cyan">ZENITH</span>
          <span className="rounded-sm border border-zenith-cyan/15 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest text-zenith-text/40">
            HUD v2
          </span>
        </div>

        {/* date · time */}
        <div className="font-mono text-xs tracking-widest text-zenith-text/80">
          {now ? (
            <>
              {dateStr} <span className="text-zenith-cyan/90">· {timeStr}</span>
            </>
          ) : (
            <span className="text-zenith-text/30">syncing…</span>
          )}
        </div>

        {/* status cluster */}
        <div className="flex items-center gap-2 rounded-md border border-zenith-cyan/12 bg-black/30 px-2.5 py-1">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan">
            <span className="blink glow-cyan h-2 w-2 rounded-full bg-zenith-cyan" /> Online
          </span>
          <span className="h-3 w-px bg-zenith-cyan/15" />
          <button aria-label="Settings" className="press text-zenith-text/50 transition hover:text-zenith-cyan">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
            </svg>
          </button>
        </div>
      </div>

      {/* recessed day-ruler — hidden in Ghost's minimal focus chrome */}
      {!minimal && now && (
        <div className="mt-2 flex items-end gap-[3px] rounded border border-zenith-cyan/10 bg-black/40 px-2 py-1 shadow-[inset_0_1px_4px_rgba(0,0,0,0.6)]">
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1;
            const isToday = d === todayDate;
            return (
              <div key={d} className="flex flex-1 flex-col items-center">
                <div className={`w-px ${isToday ? "glow-cyan h-3 bg-zenith-cyan" : "h-1.5 bg-zenith-cyan/20"}`} />
                <span className={`font-mono text-[7px] tabular-nums ${isToday ? "text-zenith-cyan" : "text-zenith-text/25"}`}>
                  {String(d).padStart(2, "0")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </header>
  );
}
