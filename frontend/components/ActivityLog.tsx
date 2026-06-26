"use client";

import { useCallback, useEffect, useState } from "react";
import { getActivity } from "../lib/api";
import type { ActivityEntry, ActivityTone, ActivityType } from "../lib/mock";

const toneColor: Record<ActivityTone, string> = {
  ok: "text-zenith-cyan",
  warn: "text-zenith-alert",
  info: "text-zenith-text/55",
};

// Minimal 14px line icons per activity type (not Lucide/Feather defaults).
function ActIcon({ type }: { type: ActivityType }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "h-3.5 w-3.5" };
  switch (type) {
    case "calendar":
      return <svg {...common}><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>;
    case "email":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
    case "message":
      return <svg {...common}><path d="M4 5h16v11H9l-5 4z" /></svg>;
    case "draft":
      return <svg {...common}><path d="M7 3h7l5 5v13H7zM14 3v5h5" /></svg>;
    case "note":
      return <svg {...common}><path d="M16 3.5 20.5 8 9 19.5l-5 1 1-5z" /></svg>;
    case "warn":
      return <svg {...common}><path d="M12 3 22 20H2zM12 10v5M12 18h.01" /></svg>;
  }
}

export function ActivityLog() {
  // entries: last-known list ([] = nothing logged yet). loaded: first response is in.
  // error: the most recent fetch couldn't reach the backend (keep showing stale entries if any).
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const e = await getActivity();
    if (e !== null) {
      setEntries(e);
      setError(false);
    } else {
      setError(true); // unreachable — keep any last-known entries on screen
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void load();
    };
    run();
    const id = setInterval(run, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [load]);

  return (
    <section className="relative z-10 border-t border-zenith-cyan/12 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Activity Log</div>
      {!loaded ? (
        <div className="font-mono text-[10px] text-zenith-text/35">loading…</div>
      ) : error && entries === null ? (
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-zenith-text/45">Can&apos;t reach the backend.</span>
          <button
            onClick={() => void load()}
            className="press rounded-sm border border-zenith-cyan/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
          >
            Retry
          </button>
        </div>
      ) : entries === null || entries.length === 0 ? (
        <div className="font-mono text-[10px] text-zenith-text/35">No activity yet — your actions will show here.</div>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((e, i) => (
            <li key={i} className="flex items-start gap-2.5 font-mono text-[11px] leading-tight">
              <span className={`mt-px shrink-0 ${toneColor[e.tone]}`}>
                <ActIcon type={e.type} />
              </span>
              <span className="shrink-0 tabular-nums text-zenith-text/35">{e.time}</span>
              <span className="min-w-0">
                <span className={toneColor[e.tone]}>{e.action}</span>
                {e.target && <span className="text-zenith-text/45"> {e.target}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
