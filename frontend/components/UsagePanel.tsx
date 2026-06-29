"use client";

import type { Usage } from "../lib/api";
import { Sparkline } from "./Sparkline";

// Same threshold logic as before: cyan < 80% < alert < 100% ≤ red.
function fillClass(pct: number): string {
  return pct >= 1 ? "bg-zenith-red" : pct >= 0.8 ? "bg-zenith-alert" : "bg-zenith-cyan";
}
function textClass(pct: number): string {
  return pct >= 1 ? "text-zenith-red" : pct >= 0.8 ? "text-zenith-alert" : "text-zenith-mid";
}
function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-lo">{label}</span>
        <span className={`font-mono text-[10px] tabular-nums ${textClass(pct)}`}>
          {fmt(value)}/{fmt(max)}
        </span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-zenith-line2">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${fillClass(pct)}`}
          style={{ width: `${Math.max(pct * 100, value > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/** v7 Usage / cost panel. Three live meters (req/min · daily · tokens), a session-token sparkline,
 *  an estimated ₹/$ cost line, a kill-switch chip, and near-cap warnings. States: skeleton while
 *  first loading, a "can't reach backend" + Retry on failure, otherwise live. `history` is the
 *  session token series (cumulative tokens_today samples) accumulated in page.tsx. */
export function UsagePanel({
  usage,
  error,
  onRetry,
  history,
}: {
  usage: Usage | null;
  error?: boolean;
  onRetry?: () => void;
  history?: number[];
}) {
  return (
    <section className="px-[18px] py-2">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-dim">Usage · Sonnet 4.6</span>
        {usage && (
          <span
            className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
              usage.killswitch ? "border-zenith-red/50 text-zenith-red" : "border-zenith-cyan/30 text-zenith-cyan"
            }`}
          >
            {usage.killswitch ? "Tripped" : "OK"}
          </span>
        )}
      </div>

      {error && !usage ? (
        <div className="space-y-2">
          <p className="text-[11px] text-zenith-lo">Can&apos;t reach the backend.</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
            >
              Retry
            </button>
          )}
        </div>
      ) : !usage ? (
        <div className="space-y-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="mb-1.5 h-2 w-1/3 animate-pulse rounded bg-zenith-line2" />
              <div className="h-[3px] w-full animate-pulse rounded-full bg-zenith-line2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Bar label="Req/min" value={usage.requests_last_minute} max={usage.per_minute_cap} />
          <Bar label="Daily" value={usage.requests_today} max={usage.daily_request_cap} />
          <Bar label="Tokens" value={usage.tokens_today} max={usage.daily_token_budget} />

          {history && history.length >= 2 && (
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-lo">Session · Tokens</span>
                <span className="font-mono text-[9px] tabular-nums text-zenith-dim">{fmt(history[history.length - 1])}</span>
              </div>
              <Sparkline points={history} />
            </div>
          )}

          <div className="flex items-center justify-between border-t border-zenith-line pt-2.5 font-mono text-[10px]">
            <span className="uppercase tracking-[0.15em] text-zenith-dim">Cost · est.</span>
            <span className="tabular-nums text-zenith-mid">
              ~₹{usage.cost_inr.toFixed(2)} · ${usage.cost_usd.toFixed(usage.cost_usd < 1 ? 3 : 2)}
            </span>
          </div>

          {usage.requests_today >= 120 && !usage.killswitch && (
            <div className="rounded-sm border border-zenith-alert/40 bg-zenith-alert/10 px-2 py-1.5 font-mono text-[10px] text-zenith-alert">
              {Math.max(usage.daily_request_cap - usage.requests_today, 0)} requests left today.
            </div>
          )}
          {usage.killswitch && (
            <div className="rounded-sm border border-zenith-red/50 bg-zenith-red/10 px-2 py-1.5 font-mono text-[10px] text-zenith-red">
              Daily cap reached — kill-switch engaged. Resets tomorrow.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
