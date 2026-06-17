"use client";

import { useEffect, useState } from "react";

export function TopBar() {
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
    <header className="relative z-10 border-b border-zenith-cyan/20 px-4 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="glow-cyan font-display text-lg font-bold tracking-[0.35em] text-zenith-cyan">ZENITH</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zenith-text/40">v2 · HUD</span>
        </div>
        <div className="font-mono text-xs tracking-widest text-zenith-text/80">
          {now ? (
            <>
              {dateStr} <span className="text-zenith-cyan">· {timeStr}</span>
            </>
          ) : (
            <span className="text-zenith-text/30">syncing…</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan">
            <span className="blink glow-cyan h-2 w-2 rounded-full bg-zenith-cyan" /> Online
          </span>
          <button aria-label="Settings" className="text-zenith-text/50 transition hover:text-zenith-cyan">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
            </svg>
          </button>
        </div>
      </div>

      {now && (
        <div className="mt-1.5 flex items-end gap-[3px]">
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = i + 1;
            const isToday = d === todayDate;
            return (
              <div key={d} className="flex flex-1 flex-col items-center">
                <div className={`w-px ${isToday ? "glow-cyan h-3 bg-zenith-cyan" : "h-1.5 bg-zenith-cyan/25"}`} />
                <span className={`font-mono text-[8px] ${isToday ? "text-zenith-cyan" : "text-zenith-text/30"}`}>
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
