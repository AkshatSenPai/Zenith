"use client";

import { useEffect, useState } from "react";
import { getHealth, type Health, type GoogleStatus, type DiscordStatus, type TelegramStatus } from "../lib/api";
import { SkinPicker } from "./SkinPicker";

/** Settings view: Appearance (the live SkinPicker) + read-only active config from /health +
 *  live connection status + the security posture. Env-driven values are shown read-only —
 *  the SkinPicker is the only true runtime control. Fully themed (zenith-* tokens). */
export function SettingsView({
  gstatus,
  dstatus,
  tstatus,
  onConnectGoogle,
  onDisconnectGoogle,
  connectError,
}: {
  gstatus: GoogleStatus | null;
  dstatus: DiscordStatus | null;
  tstatus: TelegramStatus | null;
  onConnectGoogle?: () => void;
  onDisconnectGoogle?: (email?: string) => void;
  connectError?: string | null;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  async function loadHealth() {
    const h = await getHealth();
    setHealth(h);
    setHealthError(h === null);
  }
  useEffect(() => {
    loadHealth();
  }, []);

  return (
    <div className="hud-scroll min-h-0 w-full flex-1 overflow-y-auto pb-16">
      {/* Appearance — the live skin control, unchanged */}
      <SkinPicker />

      <Section title="Active config" caption="Read-only · set in backend/.env">
        {healthError && !health ? (
          <Unreachable onRetry={loadHealth} />
        ) : !health ? (
          <SkeletonRows n={5} />
        ) : (
          <div className="space-y-4">
            <Group label="Speech-to-text">
              <Row label="Engine" value="faster-whisper" />
              <Row label="Model" value={health.whisper.model} />
              <Row
                label="Device"
                value={health.whisper.device}
                badge={health.whisper.fallback ? { text: "CPU fallback", tone: "red" } : undefined}
              />
              <Row label="Compute" value={health.whisper.compute} />
              <Row label="Language" value={health.whisper.language} />
            </Group>
            <Group label="Text-to-speech">
              <Row label="Engine" value={health.tts.engine} />
              <Row label="Voice" value={health.tts.voice} />
              <Row label="Device" value={health.tts.device} />
            </Group>
            <Group label="Backend">
              <Row label="Version" value={health.version} />
            </Group>
          </div>
        )}
      </Section>

      <Section title="Connections">
        <div className="space-y-1.5">
          {/* Google — the one connection with a runtime control (OAuth) */}
          <ConnRow
            name="Google"
            connected={Boolean(gstatus?.gmail_connected || gstatus?.calendar_connected)}
            detail={
              gstatus?.connecting
                ? "Connecting… finish sign-in in your browser"
                : gstatus?.accounts?.[0]?.email ?? (gstatus?.configured ? "Not linked" : "Set GOOGLE_CLIENT_ID in .env")
            }
            setupDoc="SETUP-GOOGLE.md"
          >
            {gstatus?.connecting ? (
              <span className="font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/70">…</span>
            ) : gstatus?.gmail_connected || gstatus?.calendar_connected ? (
              <button
                onClick={() => onDisconnectGoogle?.(gstatus?.accounts?.[0]?.email)}
                className="press font-mono text-[9px] uppercase tracking-widest text-zenith-text/45 transition hover:text-zenith-red"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={onConnectGoogle}
                className="press font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:text-zenith-cyan"
              >
                Connect
              </button>
            )}
          </ConnRow>
          {connectError && <p className="px-1 font-mono text-[9px] text-zenith-red">{connectError}</p>}

          <ConnRow
            name="Discord"
            connected={Boolean(dstatus?.connected)}
            detail={
              dstatus?.connected
                ? dstatus.bot_user ?? `${dstatus.guilds?.length ?? 0} server(s)`
                : dstatus?.configured
                ? "Bot offline"
                : "Set DISCORD_BOT_TOKEN in .env"
            }
            setupDoc="SETUP-DISCORD.md"
          />

          <ConnRow
            name="Telegram"
            connected={Boolean(tstatus?.connected)}
            detail={
              tstatus?.connected
                ? tstatus.bot_user
                  ? `@${tstatus.bot_user} · ${tstatus.allowed_count} allowed`
                  : "Online"
                : tstatus?.configured
                ? "Bot offline"
                : "Set TELEGRAM_BOT_TOKEN in .env"
            }
            setupDoc="SETUP-TELEGRAM.md"
          />
        </div>
      </Section>

      <Section title="Security" caption="See SECURITY.md">
        {healthError && !health ? (
          <Unreachable onRetry={loadHealth} />
        ) : !health ? (
          <SkeletonRows n={2} />
        ) : (
          <Group>
            <Row
              label="API token"
              value={health.config.auth_enforced ? "Enforced" : "Open · localhost only"}
              badge={
                health.config.auth_enforced
                  ? { text: "On", tone: "cyan" }
                  : { text: "Unset", tone: "alert" }
              }
            />
            <Row
              label="Debug logs"
              value={health.config.debug_logs ? "Verbose (logs bodies)" : "Scrubbed"}
              badge={
                health.config.debug_logs
                  ? { text: "On", tone: "alert" }
                  : { text: "Off", tone: "cyan" }
              }
            />
          </Group>
        )}
      </Section>
    </div>
  );
}

/* ---------- building blocks (themed; no hardcoded colors) ---------- */

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 pt-2">
      <div className="border-t border-zenith-cyan/12 pt-6">
        <h2 className="font-display text-lg font-semibold tracking-wide text-zenith-text">{title}</h2>
        {caption && (
          <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-zenith-text/45">{caption}</p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="panel px-3 py-1.5">
      {label && (
        <div className="border-b border-zenith-cyan/10 py-2 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-cyan/60">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

type Tone = "cyan" | "alert" | "red";
const toneCls: Record<Tone, string> = {
  cyan: "border-zenith-cyan/40 text-zenith-cyan/80",
  alert: "border-zenith-alert/50 text-zenith-alert",
  red: "border-zenith-red/50 text-zenith-red",
};

function Badge({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest ${toneCls[tone]}`}>
      {text}
    </span>
  );
}

function Row({ label, value, badge }: { label: string; value: string; badge?: { text: string; tone: Tone } }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zenith-cyan/8 py-2 last:border-0">
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-zenith-text/50">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        {badge && <Badge text={badge.text} tone={badge.tone} />}
        <span className="truncate font-mono text-[11px] tabular-nums text-zenith-text/85">{value}</span>
      </div>
    </div>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={on ? "glow-cyan h-2 w-2 shrink-0 rounded-full bg-zenith-cyan" : "h-2 w-2 shrink-0 rounded-full border border-zenith-text/30"}
    />
  );
}

function FileRef({ name }: { name: string }) {
  return (
    <span className="rounded-sm bg-zenith-cyan/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-zenith-text/45">{name}</span>
  );
}

function ConnRow({
  name,
  connected,
  detail,
  setupDoc,
  children,
}: {
  name: string;
  connected: boolean;
  detail: string;
  setupDoc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot on={connected} />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-widest text-zenith-text/85">{name}</div>
          <div className="truncate font-mono text-[9px] text-zenith-text/45">{detail}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {children}
        {setupDoc && <FileRef name={setupDoc} />}
      </div>
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="panel space-y-2 p-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-3 w-full animate-pulse rounded bg-zenith-cyan/[0.07]" />
      ))}
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="panel flex items-center justify-between gap-3 px-3 py-3">
      <span className="font-mono text-[11px] text-zenith-text/45">Can&apos;t reach the backend.</span>
      <button
        onClick={onRetry}
        className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
      >
        Retry
      </button>
    </div>
  );
}
