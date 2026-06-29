"use client";

import { useCallback, useEffect, useState } from "react";
import { getCalendarEvents, type ApiCalEvent } from "../lib/api";

type Data = { connected: boolean; today: ApiCalEvent[]; tomorrow: ApiCalEvent[] };
type Phase = "loading" | "offline" | "ready";

// v7 compact Schedule card (left rail). Data wiring (/calendar/events, 60s refresh, phases) is
// unchanged from before — only the presentation is v7.
export function CalendarPanel() {
  const [now] = useState(() => new Date());
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Data>({ connected: false, today: [], tomorrow: [] });

  const load = useCallback(async () => {
    const [t, tm] = await Promise.all([getCalendarEvents("today"), getCalendarEvents("tomorrow")]);
    if (t === null) {
      setPhase("offline"); // backend unreachable
      return;
    }
    setData({ connected: t.connected, today: t.events, tomorrow: tm?.events ?? [] });
    setPhase("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void load();
    };
    run();
    const id = setInterval(run, 60000); // refresh each minute
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [load]);

  const day = now.getDate();
  const month = now.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });

  return (
    <section className="flex flex-col gap-4 p-[18px]">
      <div className="flex items-start gap-3.5">
        <div className="rounded-md border border-zenith-cyan/25 bg-zenith-cyan/[0.04] px-3 py-1.5 text-center">
          <div className="font-mono text-[28px] font-semibold leading-none tabular-nums text-zenith-hi">{day}</div>
          <div className="mt-0.5 font-mono text-[9px] tracking-[0.2em] text-zenith-cyan">{month}</div>
        </div>
        <div className="pt-0.5">
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-dim">Schedule</div>
          <div className="text-[17px] font-semibold text-zenith-hi">{weekday}</div>
        </div>
      </div>

      {phase === "loading" ? (
        <Section title="Today">
          <Skeleton rows={2} />
        </Section>
      ) : phase === "offline" ? (
        <Notice text="Calendar unavailable — backend offline." onRetry={() => void load()} />
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
    </section>
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
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-dim">{title}</div>
      {children}
    </div>
  );
}

function EventList({ events }: { events: ApiCalEvent[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {events.map((e) => {
        const secondary = e.location || (e.attendees.length ? `${e.attendees.length} guest${e.attendees.length > 1 ? "s" : ""}` : "");
        return (
          <li key={e.id} className="flex items-start gap-2.5 rounded-md border border-zenith-line bg-zenith-panel px-2.5 py-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-zenith-cyan" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-zenith-cyan">{fmtTime(e.start, e.all_day)}</span>
                <span className="font-mono text-[9px] text-zenith-faint">{fmtDuration(e.start, e.end, e.all_day)}</span>
                <span className="truncate text-[12px] text-zenith-mid">{e.title}</span>
              </div>
              {secondary && <span className="block truncate font-mono text-[9px] uppercase tracking-wide text-zenith-dim">{secondary}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 w-full animate-pulse rounded-md bg-zenith-line2" />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-zenith-line bg-zenith-panel px-2.5 py-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zenith-faint" />
      <span className="text-[11px] text-zenith-lo">{text}</span>
    </div>
  );
}

function Notice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-zenith-lo">{text}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="press shrink-0 rounded-sm border border-zenith-cyan/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
        >
          Retry
        </button>
      )}
    </div>
  );
}
