"use client";

import { useEffect, useState } from "react";
import { getHealth, type Health, type GoogleStatus, type DiscordStatus, type TelegramStatus } from "../lib/api";
import { SkinPicker } from "./SkinPicker";
import { getReduceMotion, setReduceMotion } from "../lib/prefs";
import { isTauri, getAutostartEnabled, setAutostartEnabled } from "../lib/tauri";

/** Settings view (v7): Appearance (the live SkinPicker) · Motion (reduced-motion toggle) ·
 *  read-only active config from /health · live connection status · the security posture.
 *  Env-driven values are read-only — the skin + motion toggles are the only runtime controls.
 *  Fully themed via the v7 hierarchy tokens (zenith-hi/mid/lo/dim + line/line2/panel). */
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

  // Reduced-motion toggle: persisted in localStorage + mirrored to <html data-reduce-motion>.
  // Seed from storage on mount (not during render) to avoid an SSR/client mismatch — matches the
  // SkinProvider pattern. setReduceMotion notifies the orb/ambient field so they calm immediately.
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(getReduceMotion()), []);
  const toggleReduce = () => {
    const next = !reduce;
    setReduce(next);
    setReduceMotion(next);
  };

  // Startup (Tauri desktop only): "Launch on login" toggles the OS autostart entry via the plugin.
  // Seed from the real OS state; reconcile after a write so the UI reflects what actually happened.
  const [isDesktop, setIsDesktop] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  useEffect(() => {
    setIsDesktop(isTauri());
    getAutostartEnabled().then(setAutostartOn);
  }, []);
  const toggleAutostart = async () => {
    const next = !autostartOn;
    setAutostartOn(next); // optimistic
    await setAutostartEnabled(next);
    setAutostartOn(await getAutostartEnabled()); // reconcile with the OS
  };

  const googleConnected = Boolean(gstatus?.gmail_connected || gstatus?.calendar_connected);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zenith-line px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-zenith-hi">Settings</h2>
          <span className="text-xs text-zenith-lo">Appearance, motion &amp; the active backend config</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-dim">Preferences</span>
      </header>

      <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-6 py-7">
        <div className="mx-auto flex max-w-3xl flex-col gap-9">
          {/* Appearance — the live skin control (heading/caption supplied here, v7) */}
          <Section title="Appearance" caption="Skin · applies instantly to the whole HUD">
            <SkinPicker />
          </Section>

          {/* Motion — reduced-motion only (the v7 mock's sound toggle is cut by locked scope) */}
          <Section title="Motion" caption="Comfort">
            <ToggleRow
              label="Reduced motion"
              desc="Calms the orb, ambient field and scan beam; stops looping animations."
              on={reduce}
              onChange={toggleReduce}
            />
            <p className="mt-2 px-1 font-mono text-[10px] text-zenith-dim">
              Your system &ldquo;reduce motion&rdquo; setting is always respected too.
            </p>
          </Section>

          {/* Startup — desktop app only (autostart is meaningless in a browser tab) */}
          {isDesktop && (
            <Section title="Startup" caption="Desktop app">
              <ToggleRow
                label="Launch on login"
                desc="Start Zenith with Windows, hidden in the tray. Summon it with the tray icon or Ctrl+Alt+Z."
                on={autostartOn}
                onChange={toggleAutostart}
              />
            </Section>
          )}

          <Section title="Active config" caption="Read-only · set in backend/.env">
            {healthError && !health ? (
              <Unreachable onRetry={loadHealth} />
            ) : !health ? (
              <SkeletonRows n={5} />
            ) : (
              <div className="space-y-3">
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

          <Section title="Connections" caption="Google sign-in · others read-only">
            <div className="space-y-2.5">
              {/* Google — the one connection with a runtime control (OAuth) */}
              <ConnRow
                name="Google"
                connected={googleConnected}
                detail={
                  gstatus?.connecting
                    ? "Connecting… finish sign-in in your browser"
                    : gstatus?.accounts?.[0]?.email ?? (gstatus?.configured ? "Not linked" : "Set GOOGLE_CLIENT_ID in .env")
                }
                setupDoc="SETUP-GOOGLE.md"
              >
                {gstatus?.connecting ? (
                  <span className="font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/70">…</span>
                ) : googleConnected ? (
                  <button
                    onClick={() => onDisconnectGoogle?.(gstatus?.accounts?.[0]?.email)}
                    className="press font-mono text-[9px] uppercase tracking-widest text-zenith-lo transition hover:text-zenith-red"
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
                  badge={health.config.auth_enforced ? { text: "On", tone: "cyan" } : { text: "Unset", tone: "alert" }}
                />
                <Row
                  label="Debug logs"
                  value={health.config.debug_logs ? "Verbose (logs bodies)" : "Scrubbed"}
                  badge={health.config.debug_logs ? { text: "On", tone: "alert" } : { text: "Off", tone: "cyan" }}
                />
              </Group>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---------- building blocks (themed; v7 hierarchy tokens, no hardcoded colors) ---------- */

function Section({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-base font-semibold text-zenith-hi">{title}</h3>
      {caption && <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-dim">{caption}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[9px] border border-zenith-line">
      {label && (
        <div className="border-b border-zenith-line bg-zenith-cyan/[0.03] px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-cyan/80">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

type Tone = "cyan" | "alert" | "red";
const toneCls: Record<Tone, string> = {
  cyan: "border-zenith-cyan/40 text-zenith-cyan",
  alert: "border-zenith-alert/50 text-zenith-alert",
  red: "border-zenith-red/50 text-zenith-red",
};

function Badge({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`rounded-[4px] border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest ${toneCls[tone]}`}>
      {text}
    </span>
  );
}

function Row({ label, value, badge }: { label: string; value: string; badge?: { text: string; tone: Tone } }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zenith-line px-4 py-2.5 last:border-b-0">
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-widest text-zenith-lo">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        {badge && <Badge text={badge.text} tone={badge.tone} />}
        <span className="truncate font-mono text-[11px] tabular-nums text-zenith-mid">{value}</span>
      </div>
    </div>
  );
}

/** Reduced-motion / preference switch. A native button so keyboard (Enter/Space) + focus come free;
 *  role="switch" + aria-checked expose the on/off state to assistive tech. */
function ToggleRow({ label, desc, on, onChange }: { label: string; desc?: string; on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className="press flex w-full items-center justify-between gap-4 rounded-[9px] border border-zenith-line px-4 py-3 text-left outline-none transition-colors hover:border-zenith-line2 focus-visible:ring-2 focus-visible:ring-zenith-cyan/50"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-zenith-mid">{label}</span>
        {desc && <span className="mt-0.5 block text-[11px] text-zenith-lo">{desc}</span>}
      </span>
      <span
        className={`relative h-[22px] w-10 shrink-0 rounded-full border transition-colors ${
          on ? "border-zenith-cyan/50 bg-zenith-cyan/25" : "border-zenith-line2 bg-zenith-cyan/[0.04]"
        }`}
      >
        <span
          className={`absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full transition-all ${
            on ? "left-[20px] bg-zenith-cyan" : "left-[1px] bg-zenith-lo"
          }`}
        />
      </span>
    </button>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={
        on
          ? "glow-cyan h-2 w-2 shrink-0 rounded-full bg-zenith-cyan"
          : "h-2 w-2 shrink-0 rounded-full border border-zenith-lo/40"
      }
    />
  );
}

function FileRef({ name }: { name: string }) {
  return <span className="rounded-[4px] bg-zenith-cyan/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-zenith-lo">{name}</span>;
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
    <div className="flex items-center justify-between gap-3 rounded-[7px] border border-zenith-line2 bg-zenith-panel px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot on={connected} />
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-mid">{name}</div>
          <div className="truncate font-mono text-[11px] text-zenith-lo">{detail}</div>
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
    <div className="space-y-2 rounded-[9px] border border-zenith-line p-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-3 w-full animate-pulse rounded bg-zenith-cyan/[0.07]" />
      ))}
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[9px] border border-zenith-line px-4 py-3">
      <span className="font-mono text-[11px] text-zenith-lo">Can&apos;t reach the backend.</span>
      <button
        onClick={onRetry}
        className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
      >
        Retry
      </button>
    </div>
  );
}
