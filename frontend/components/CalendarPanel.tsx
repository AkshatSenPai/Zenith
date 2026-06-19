"use client";

import { useEffect, useState } from "react";
import { todayEvents, tomorrowEvents, categoryColor, type CalEvent } from "../lib/mock";

export function CalendarPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ today: CalEvent[]; tomorrow: CalEvent[] } | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    const id = setTimeout(() => {
      setData({ today: todayEvents, tomorrow: tomorrowEvents });
      setLoading(false);
    }, 500);
    return () => clearTimeout(id);
  }, []);

  const day = now.getDate();
  const month = now.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });

  return (
    <aside className="relative z-10 flex flex-col gap-4 border-r border-zenith-cyan/12 p-4">
      <div className="flex items-center gap-3">
        <div className="panel relative flex h-14 w-14 flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold leading-none tabular-nums text-zenith-cyan">{day}</span>
          <span className="font-mono text-[8px] tracking-widest text-zenith-text/50">{month}</span>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Schedule</div>
          <div className="font-body text-xs text-zenith-text/65">{weekday}</div>
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
    <ul className="space-y-0.5">
      {events.map((e, i) => (
        <li key={i} className="press flex flex-col gap-0.5 rounded px-2 py-1.5 transition-colors hover:bg-zenith-cyan/[0.05]">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${categoryColor[e.category]}`} />
            <span className="font-mono text-[11px] tabular-nums text-zenith-cyan">{e.time}</span>
            <span className="font-mono text-[9px] text-zenith-text/35">{e.duration}</span>
            <span className="truncate font-body text-xs text-zenith-text/85">{e.title}</span>
          </div>
          <span className="pl-4 font-mono text-[9px] uppercase tracking-wide text-zenith-text/35">{e.client}</span>
        </li>
      ))}
    </ul>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 w-full animate-pulse rounded bg-zenith-cyan/[0.06]" />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-body text-xs text-zenith-text/35">{text}</div>;
}
