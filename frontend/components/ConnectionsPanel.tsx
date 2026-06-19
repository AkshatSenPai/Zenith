"use client";

import type { Connection } from "../lib/mock";

export function ConnectionsPanel({ connections }: { connections: Connection[] }) {
  return (
    <section className="relative z-10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Connections</span>
        <span className="rounded-sm border border-zenith-alert/40 px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest text-zenith-alert/75">
          demo
        </span>
      </div>
      <ul className="space-y-1.5">
        {connections.map((c) => (
          <li key={c.channel} className="panel panel-hover relative flex items-center justify-between px-3 py-2">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-widest text-zenith-text/85">{c.channel}</div>
              <div className="truncate font-mono text-[9px] text-zenith-text/40">{c.account}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={
                  c.connected
                    ? "glow-cyan h-2 w-2 rounded-full bg-zenith-cyan"
                    : "h-2 w-2 rounded-full border border-zenith-text/30"
                }
              />
              <span className={`font-mono text-[8px] uppercase tracking-widest ${c.connected ? "text-zenith-cyan" : "text-zenith-text/35"}`}>
                {c.connected ? "On" : "Off"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
