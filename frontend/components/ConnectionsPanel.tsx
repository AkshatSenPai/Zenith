"use client";

import type { Connection } from "../lib/mock";
import type { GoogleStatus } from "../lib/api";
import { useCollapsed, Chevron } from "./CollapsibleSection";

// v7 collapsible Connections. Status is DERIVED (read-only dots) — Google keeps its real
// connect/disconnect; Gmail/Calendar/Telegram/Discord are status rows, never user toggles.
export function ConnectionsPanel({
  connections,
  status,
  onConnect,
  onDisconnect,
  connectError,
  backendState = "live",
}: {
  connections: Connection[];
  status?: GoogleStatus | null;
  onConnect?: () => void;
  onDisconnect?: (email?: string) => void;
  connectError?: string | null;
  /** Whole-backend reachability (from the /usage poll): drives the header chip. */
  backendState?: "loading" | "offline" | "live";
}) {
  const { open, toggle } = useCollapsed("zenith.collapse.conn", true);
  const account = status?.accounts?.[0]?.email;
  const connected = Boolean(status?.gmail_connected || status?.calendar_connected);
  const needsReconnect = Boolean(status?.accounts?.some((a) => a.needs_reconnect));

  return (
    <section className="border-b border-zenith-line px-[18px] py-3.5">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-dim">Connections</span>
        <span className="flex items-center gap-2.5">
          {backendState === "offline" ? (
            <span className="rounded-sm border border-zenith-alert/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-zenith-alert">
              Backend offline
            </span>
          ) : backendState === "loading" ? (
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-zenith-dim">Connecting…</span>
          ) : (
            <span className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-zenith-cyan">
              <span className="h-1.5 w-1.5 rounded-full bg-zenith-cyan shadow-[0_0_6px_rgb(var(--zenith-cyan)/0.8)]" /> Live
            </span>
          )}
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        <div className="mt-3">
          {/* Google connect control (real) — drives the Gmail + Calendar rows + the orb nodes */}
          <div className="mb-2.5">
            {status?.connecting ? (
              <div className="flex items-center gap-2 rounded-md border border-zenith-line bg-zenith-panel px-3 py-2 font-mono text-[10px] text-zenith-cyan">
                <span className="blink h-2 w-2 rounded-full bg-zenith-cyan" /> Connecting… finish sign-in in your browser
              </div>
            ) : connected ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-zenith-line bg-zenith-panel px-3 py-2">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-mid">Google</div>
                  <div className="truncate text-[11px] text-zenith-lo">{account}</div>
                </div>
                <button
                  onClick={() => onDisconnect?.(account)}
                  className="press shrink-0 rounded border border-zenith-line2 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-zenith-dim transition hover:border-zenith-alert/50 hover:text-zenith-alert"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={onConnect}
                className="press flex w-full items-center justify-between rounded-md border border-zenith-line bg-zenith-panel px-3 py-2.5 text-left transition-colors hover:border-zenith-cyan/40"
              >
                <span className="text-[12px] text-zenith-mid">Connect Google</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-zenith-cyan">Gmail · Calendar</span>
              </button>
            )}
            {needsReconnect && !status?.connecting && (
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-zenith-alert/80">Reconnect needed</div>
            )}
            {connectError && <div className="mt-1 font-mono text-[9px] text-zenith-red">{connectError}</div>}
          </div>

          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <li key={c.channel} className="flex items-center justify-between rounded-md border border-zenith-line bg-zenith-panel px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={
                      c.connected
                        ? "h-1.5 w-1.5 shrink-0 rounded-full bg-zenith-cyan shadow-[0_0_6px_rgb(var(--zenith-cyan)/0.8)]"
                        : "h-1.5 w-1.5 shrink-0 rounded-full bg-zenith-faint"
                    }
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-mid">{c.channel}</div>
                    <div className="truncate text-[11px] text-zenith-lo">{c.account}</div>
                  </div>
                </div>
                <span className={`font-mono text-[8px] uppercase tracking-[0.1em] ${c.connected ? "text-zenith-cyan" : "text-zenith-dim"}`}>
                  {c.connected ? "On" : "Off"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
