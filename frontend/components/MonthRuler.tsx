"use client";

import { useEffect, useState } from "react";

// v7 day ruler under the top bar: every day of the current month, today marked in the accent.
// Date is set client-side (useEffect) so SSR markup matches first paint (no hydration mismatch).
export function MonthRuler() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <div className="h-[30px] flex-none border-b border-zenith-line" aria-hidden />;

  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const days = new Date(year, month + 1, 0).getDate();
  const monthLabel = `${now.toLocaleString("en-US", { month: "short" }).toUpperCase()} ${year}`;

  return (
    <div className="relative z-[2] flex h-[30px] flex-none items-center gap-2.5 border-b border-zenith-line px-[18px]">
      <span className="flex-none font-mono text-[9px] tracking-[0.2em] text-zenith-faint">{monthLabel}</span>
      <div className="flex flex-1 items-center justify-between">
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const isToday = d === today;
          return (
            <div key={d} className="flex flex-1 flex-col items-center gap-0.5">
              <span className={`font-mono text-[9px] ${isToday ? "text-zenith-cyan" : "text-zenith-faint"}`}>
                {String(d).padStart(2, "0")}
              </span>
              <span className={isToday ? "h-2 w-px bg-zenith-cyan" : "h-1 w-px bg-zenith-faint"} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
