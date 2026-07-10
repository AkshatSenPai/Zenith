"use client";

import { useCallback, useEffect, useState } from "react";
import { getTriage, type WaitingThread } from "../lib/api";

function ageLabel(hours: number): string {
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** Who's waiting on a reply (Gmail). Pull-only: this list is never rendered unprompted, because its
 *  text comes from third parties. "Draft reply" prefills the Command Center — an inert string that
 *  never runs a tool; the send still rides the confirm gate. */
export function TriageView({ onDraft }: { onDraft: (t: WaitingThread) => void }) {
  const [threads, setThreads] = useState<WaitingThread[]>([]);
  const [connected, setConnected] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const d = await getTriage();
    if (d === null) setError(true);
    else {
      setThreads(d.threads);
      setConnected(d.connected);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  return (
    <div className="hud-scroll flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-zenith-cyan">
          Waiting on your reply
        </h2>
        {loaded && !error && connected && (
          <span className="font-mono text-[10px] text-zenith-lo">{threads.length}</span>
        )}
      </div>

      {!loaded && <p className="font-mono text-[11px] text-zenith-lo">Loading…</p>}

      {loaded && error && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-zenith-lo">Can’t reach Zenith’s backend.</p>
          <button
            onClick={() => void load()}
            className="press rounded-md border border-zenith-line2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo transition hover:text-zenith-mid"
          >
            Retry
          </button>
        </div>
      )}

      {loaded && !error && !connected && (
        <p className="text-sm text-zenith-lo">Google isn’t connected. Link it in the Connections panel.</p>
      )}

      {loaded && !error && connected && threads.length === 0 && (
        <p className="text-sm text-zenith-lo">Nothing waiting.</p>
      )}

      {loaded && !error && connected && threads.length > 0 && (
        <ul className="flex flex-col gap-2">
          {threads.map((t) => (
            <li key={t.thread_id} className="status-surface border border-zenith-line2 px-4 py-3">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold text-zenith-mid">{t.from_name}</span>
                <span className="flex-none font-mono text-[10px] uppercase tracking-[0.14em] text-zenith-lo">
                  {ageLabel(t.age_hours)} · {t.source}
                </span>
              </div>
              <div className="truncate text-sm text-zenith-mid">{t.subject}</div>
              <div className="mt-0.5 truncate text-[12px] text-zenith-lo">{t.snippet}</div>
              <div className="mt-3">
                <button
                  onClick={() => onDraft(t)}
                  className="press rounded-md bg-zenith-cyan px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zenith-bg transition hover:opacity-90"
                >
                  Draft reply
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
