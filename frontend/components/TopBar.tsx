"use client";

import { useEffect, useState } from "react";
import { useSkin } from "./SkinProvider";
import { SKINS } from "../lib/skins";

// v7 top bar: diamond + ZENITH lockup, centered date/time, ONLINE chip, ⌘K palette button, and a
// skin-cycle chip (Arc → Ghost → Amethyst). The month/day ruler now lives in <MonthRuler/>, so it's
// no longer here. No sound control (excluded from the redesign).
export function TopBar({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const [now, setNow] = useState<Date | null>(null);
  const { skin, setSkin } = useSkin();

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now
    ? now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
    : "";
  const timeStr = now ? now.toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";
  const skinLabel = (SKINS.find((s) => s.id === skin)?.label ?? "Arc").toUpperCase();
  const cycleSkin = () => {
    const i = SKINS.findIndex((s) => s.id === skin);
    setSkin(SKINS[(i + 1) % SKINS.length].id);
  };

  return (
    <header className="relative z-[6] flex h-[54px] flex-none items-center gap-3.5 border-b border-zenith-line px-[18px]">
      {/* lockup */}
      <div className="flex items-center gap-2.5">
        <span className="h-[18px] w-[18px] rotate-45 border-[1.5px] border-zenith-cyan shadow-[0_0_12px_rgb(var(--zenith-cyan)/0.5)]" />
        <span className="font-mono text-[17px] font-semibold tracking-[0.3em] text-zenith-hi">ZENITH</span>
        <span className="rounded-sm border border-zenith-line2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-dim">
          HUD V7
        </span>
      </div>

      {/* center date · time */}
      <div className="flex flex-1 items-center justify-center gap-3 font-mono text-[13px] tracking-wide">
        {now ? (
          <>
            <span className="text-zenith-mid">{dateStr}</span>
            <span className="text-zenith-faint">·</span>
            <span className="font-medium text-zenith-cyan">{timeStr}</span>
          </>
        ) : (
          <span className="text-zenith-dim">syncing…</span>
        )}
      </div>

      {/* right cluster */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 rounded-full border border-zenith-cyan/25 bg-zenith-cyan/[0.07] px-2.5 py-1">
          <span className="blink h-[7px] w-[7px] rounded-full bg-zenith-cyan shadow-[0_0_8px_rgb(var(--zenith-cyan)/0.8)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-cyan">Online</span>
        </div>

        <button
          onClick={onOpenPalette}
          title="Command palette (⌘K)"
          aria-label="Open command palette"
          className="press flex h-[30px] items-center gap-1.5 rounded-full border border-zenith-line2 px-2.5 text-zenith-lo transition hover:border-zenith-cyan/45 hover:text-zenith-cyan"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="font-mono text-[9px] tracking-wide">⌘K</span>
        </button>

        <button
          onClick={cycleSkin}
          title="Cycle skin"
          aria-label={`Skin: ${skinLabel}. Click to cycle.`}
          className="press flex h-[30px] items-center gap-2 rounded-full border border-zenith-line2 px-2.5 text-zenith-lo transition hover:border-zenith-cyan/45 hover:text-zenith-cyan"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-zenith-cyan shadow-[0_0_7px_rgb(var(--zenith-cyan)/0.8)]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.15em]">{skinLabel}</span>
        </button>
      </div>
    </header>
  );
}
