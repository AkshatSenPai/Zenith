"use client";

import type { Usage } from "../lib/api";

// Same threshold logic as GaugeIndicator: cyan < 80% < alert < 100% ≤ red.
function fillClass(pct: number): string {
  return pct >= 1 ? "bg-zenith-red" : pct >= 0.8 ? "bg-zenith-alert" : "bg-zenith-cyan";
}
function textClass(pct: number): string {
  return pct >= 1 ? "text-zenith-red" : pct >= 0.8 ? "text-zenith-alert" : "text-zenith-text/45";
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-widest">
        <span className="text-zenith-text/50">{label}</span>
        <span className={`tabular-nums ${textClass(pct)}`}>
          {fmt(value)}/{fmt(max)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zenith-cyan/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${fillClass(pct)} ${pct >= 0.8 ? "" : "glow-cyan"}`}
          style={{ width: `${Math.max(pct * 100, value > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/** Usage / cost dashboard. Three live progress bars (req/min · daily · tokens), an estimated
 *  ₹/$ cost line, a kill-switch chip, and a near-cap warning. States: skeleton while first
 *  loading, a "can't reach backend" + Retry on failure, otherwise the live panel. Fully themed
 *  (zenith-* tokens) so it tracks every skin. */
export function UsagePanel({ usage, error, onRetry }: { usage: Usage | null; error?: boolean; onRetry?: () => void }) {
  return (
    <section className="relative z-10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Usage</span>
        {usage && (
          <span
            className={`rounded-sm border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest ${
              usage.killswitch
                ? "border-zenith-red/50 text-zenith-red"
                : "border-zenith-cyan/40 text-zenith-cyan/80"
            }`}
          >
            {usage.killswitch ? "Tripped" : "OK"}
          </span>
        )}
      </div>

      {error && !usage ? (
        <div className="space-y-2">
          <p className="font-mono text-[10px] text-zenith-text/45">Can&apos;t reach the backend.</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
            >
              Retry
            </button>
          )}
        </div>
      ) : !usage ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="mb-1 h-2 w-1/3 animate-pulse rounded bg-zenith-cyan/[0.08]" />
              <div className="h-1.5 w-full animate-pulse rounded-full bg-zenith-cyan/[0.08]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Bar label="Req/min" value={usage.requests_last_minute} max={usage.per_minute_cap} />
          <Bar label="Daily" value={usage.requests_today} max={usage.daily_request_cap} />
          <Bar label="Tokens" value={usage.tokens_today} max={usage.daily_token_budget} />

          <div className="flex items-center justify-between border-t border-zenith-cyan/10 pt-2.5 font-mono text-[10px]">
            <span className="uppercase tracking-widest text-zenith-text/45">Cost · est.</span>
            <span className="tabular-nums text-zenith-text/75">
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
