"use client";

import { useEffect, useState } from "react";
import { todayEvents, tomorrowEvents, type CalEvent } from "../lib/mock";
import { TickRing } from "./hud/primitives";

export function CalendarPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ today: CalEvent[]; tomorrow: CalEvent[] } | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    const id = setTimeout(() => {
      setData({ today: todayEvents, tomorrow: tomorrowEvents });
      setLoading(false);
    }, 600);
    return () => clearTimeout(id);
  }, []);

  const day = now.getDate();
  const month = now.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();

  return (
    <aside className="relative z-10 flex flex-col gap-4 border-r border-zenith-cyan/15 p-4">
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-16">
          <svg viewBox="-32 -32 64 64" className="glow-cyan spin-slow h-16 w-16 stroke-zenith-cyan" fill="none" strokeWidth={1}>
            <TickRing r={28} count={48} len={4} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-xl font-bold leading-none text-zenith-cyan">{day}</span>
            <span className="font-mono text-[8px] tracking-widest text-zenith-text/50">{month}</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-zenith-text/40">Calendar</div>
          <div className="font-body text-xs text-zenith-text/70">Your schedule</div>
        </div>
      </div>

      <Section title="Today">
        {loading ? <Skeleton rows={3} /> : data!.today.length ? <EventList events={data!.today} /> : <Empty text="No events today." />}
      </Section>
      <Section title="Tomorrow">
        {loading ? <Skeleton rows={1} /> : data!.tomorrow.length ? <EventList events={data!.tomorrow} /> : <Empty text="Nothing scheduled." />}
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">{title}</div>
      {children}
    </div>
  );
}

function EventList({ events }: { events: CalEvent[] }) {
  return (
    <ul className="space-y-1">
      {events.map((e, i) => (
        <li key={i} className="flex items-center gap-2 py-0.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-zenith-cyan" />
          <span className="font-mono text-[11px] text-zenith-cyan">{e.time}</span>
          <span className="truncate font-body text-xs text-zenith-text/80">{e.title}</span>
        </li>
      ))}
    </ul>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 w-full animate-pulse rounded bg-zenith-cyan/10" />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-body text-xs text-zenith-text/35">{text}</div>;
}
