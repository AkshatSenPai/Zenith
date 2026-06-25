"use client";

import { useEffect, useState } from "react";
import { getCalendarEvents, type ApiCalEvent } from "../lib/api";

type Data = { connected: boolean; today: ApiCalEvent[]; tomorrow: ApiCalEvent[] };
type Phase = "loading" | "offline" | "ready";

export function CalendarPanel() {
  const [now] = useState(() => new Date());
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Data>({ connected: false, today: [], tomorrow: [] });

  useEffect(() => {
    let alive = true;
    async function load() {
      const [t, tm] = await Promise.all([getCalendarEvents("today"), getCalendarEvents("tomorrow")]);
      if (!alive) return;
      if (t === null) {
        setPhase("offline"); // backend unreachable
        return;
      }
      setData({ connected: t.connected, today: t.events, tomorrow: tm?.events ?? [] });
      setPhase("ready");
    }
    load();
    const id = setInterval(load, 60000); // refresh each minute
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const day = now.getDate();
  const month = now.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });

  return (
    <aside className="relative z-10 flex flex-col gap-4 p-4">
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

      {phase === "loading" ? (
        <Section title="Today">
          <Skeleton rows={3} />
        </Section>
      ) : phase === "offline" ? (
        <Notice text="Calendar unavailable — backend offline." />
      ) : !data.connected ? (
        <Notice text="Connect Google to see your calendar." />
      ) : (
        <>
          <Section title="Today">
            {data.today.length ? <EventList events={data.today} /> : <Empty text="No events today." />}
          </Section>
          <Section title="Tomorrow">
            {data.tomorrow.length ? <EventList events={data.tomorrow} /> : <Empty text="Nothing scheduled." />}
          </Section>
        </>
      )}
    </aside>
  );
}

function fmtTime(iso: string | null, allDay: boolean): string {
  if (allDay || !iso) return "all day";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(start: string | null, end: string | null, allDay: boolean): string {
  if (allDay || !start || !end) return "";
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (mins <= 0) return "";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${m}` : `${h}h`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">{title}</div>
      {children}
    </div>
  );
}

function EventList({ events }: { events: ApiCalEvent[] }) {
  return (
    <ul className="space-y-0.5">
      {events.map((e) => {
        const secondary = e.location || (e.attendees.length ? `${e.attendees.length} guest${e.attendees.length > 1 ? "s" : ""}` : "");
        return (
          <li key={e.id} className="press flex flex-col gap-0.5 rounded px-2 py-1.5 transition-colors hover:bg-zenith-cyan/[0.05]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-zenith-cyan" />
              <span className="font-mono text-[11px] tabular-nums text-zenith-cyan">{fmtTime(e.start, e.all_day)}</span>
              <span className="font-mono text-[9px] text-zenith-text/35">{fmtDuration(e.start, e.end, e.all_day)}</span>
              <span className="truncate font-body text-xs text-zenith-text/85">{e.title}</span>
            </div>
            {secondary && <span className="truncate pl-4 font-mono text-[9px] uppercase tracking-wide text-zenith-text/35">{secondary}</span>}
          </li>
        );
      })}
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

function Notice({ text }: { text: string }) {
  return <div className="font-body text-xs text-zenith-text/40">{text}</div>;
}
