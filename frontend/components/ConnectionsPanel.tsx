"use client";

import type { Connection } from "../lib/mock";
import type { GoogleStatus } from "../lib/api";

export function ConnectionsPanel({
  connections,
  status,
  onConnect,
  onDisconnect,
  connectError,
}: {
  connections: Connection[];
  status?: GoogleStatus | null;
  onConnect?: () => void;
  onDisconnect?: (email?: string) => void;
  connectError?: string | null;
}) {
  const account = status?.accounts?.[0]?.email;
  const connected = Boolean(status?.gmail_connected || status?.calendar_connected);
  const needsReconnect = Boolean(status?.accounts?.some((a) => a.needs_reconnect));

  return (
    <section className="relative z-10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Connections</span>
        <span className="rounded-sm border border-zenith-alert/40 px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest text-zenith-alert/75">
          demo
        </span>
      </div>

      {/* Google connect control (real) — drives the Gmail + Calendar rows below + the orb nodes */}
      <div className="mb-3">
        {status?.connecting ? (
          <div className="panel flex items-center gap-2 px-3 py-2 font-mono text-[10px] text-zenith-cyan/80">
            <span className="blink h-2 w-2 rounded-full bg-zenith-cyan" />
            Connecting… finish sign-in in your browser
          </div>
        ) : connected ? (
          <div className="panel flex items-center justify-between px-3 py-2">
            <span className="min-w-0 truncate font-mono text-[10px] text-zenith-text/75">
              Google · <span className="text-zenith-cyan">{account}</span>
            </span>
            <button
              onClick={() => onDisconnect?.(account)}
              className="press shrink-0 font-mono text-[9px] uppercase tracking-widest text-zenith-text/45 transition hover:text-zenith-red"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={onConnect}
            className="panel panel-hover press flex w-full items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="font-mono text-[11px] text-zenith-text/85">Connect Google</span>
            <span className="font-mono text-[8px] uppercase tracking-widest text-zenith-cyan/70">Gmail · Calendar</span>
          </button>
        )}
        {needsReconnect && !status?.connecting && (
          <div className="mt-1 font-mono text-[9px] uppercase tracking-widest text-zenith-alert/80">Reconnect needed</div>
        )}
        {connectError && <div className="mt-1 font-mono text-[9px] text-zenith-red">{connectError}</div>}
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
