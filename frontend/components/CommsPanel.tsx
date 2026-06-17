"use client";

import { useEffect, useState } from "react";
import { commCounts, commItems, type CommChannel, type CommItem } from "../lib/mock";

const channelColor: Record<CommChannel, string> = {
  Gmail: "text-zenith-cyan",
  WhatsApp: "text-zenith-scan",
  Discord: "text-zenith-blue",
};

export function CommsPanel() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CommItem[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      setItems(commItems);
      setLoading(false);
    }, 700);
    return () => clearTimeout(id);
  }, []);

  return (
    <aside className="relative z-10 flex flex-col gap-3 border-l border-zenith-cyan/15 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Communications</span>
        <span className="rounded border border-zenith-alert/40 px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest text-zenith-alert/80">
          demo data
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Count label="Gmail" n={commCounts.Gmail} />
        <Count label="WhatsApp" n={commCounts.WhatsApp} />
        <Count label="Discord" n={commCounts.Discord} />
      </div>

      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-zenith-text/40">Recent</div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded bg-zenith-cyan/10" />
          ))}
        </div>
      ) : items.length ? (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="clip-card border border-zenith-cyan/20 bg-zenith-cyan/[0.03] px-3 py-2">
              <div className="flex items-center justify-between">
                <span className={`font-mono text-[10px] uppercase tracking-widest ${channelColor[it.channel]}`}>{it.channel}</span>
                <span className="font-mono text-[10px] text-zenith-text/50">{it.who}</span>
              </div>
              <div className="truncate font-body text-xs text-zenith-text/75">{it.preview}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="font-body text-xs text-zenith-text/35">No recent messages.</div>
      )}
    </aside>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div className="flex flex-col items-center rounded border border-zenith-cyan/15 py-2">
      <span className="font-display text-lg font-bold text-zenith-cyan">{n}</span>
      <span className="font-mono text-[8px] uppercase tracking-widest text-zenith-text/45">{label}</span>
    </div>
  );
}
