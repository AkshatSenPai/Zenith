"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startRecording, transcribe, speak, cancelSpeech, getSpeechBars, type RecordingHandle } from "../lib/voice";
import { connections as mockConnections, type Connection } from "../lib/mock";
import { apiFetch, getGoogleStatus, connectGoogle, disconnectGoogle, getDiscordStatus, getTelegramStatus, getUsage, type GoogleStatus, type DiscordStatus, type TelegramStatus, type Usage } from "../lib/api";
import { TopBar } from "../components/TopBar";
import { IconNav } from "../components/IconNav";
import { MonthRuler } from "../components/MonthRuler";
import type { View } from "../lib/nav";
import { ZenithOrb, type OrbState } from "../components/ZenithOrb";
import { CalendarPanel } from "../components/CalendarPanel";
import { QuickActions } from "../components/QuickActions";
import { LeftRailExtras } from "../components/LeftRailExtras";
import { ConnectionsPanel } from "../components/ConnectionsPanel";
import { FocusCard } from "../components/FocusCard";
import { ActivityLog } from "../components/ActivityLog";
import { CommandCenter, type Message } from "../components/CommandCenter";
import { MemoryView } from "../components/MemoryView";
import { NotesView } from "../components/NotesView";
import { ClientsView } from "../components/ClientsView";
import { UsagePanel } from "../components/UsagePanel";
import { StatusCard } from "../components/StatusCard";
import { HexCorners } from "../components/hud/primitives";
import { BootScreen } from "../components/BootScreen";
import { AmbientBackground } from "../components/AmbientBackground";
import { StatusLabel } from "../components/StatusLabel";
import { Waveform } from "../components/Waveform";
import { SettingsView } from "../components/SettingsView";
import { briefingGreeting } from "../lib/greeting";

type PendingAction = { id: string; tool: string; input: Record<string, unknown>; untrusted?: boolean };

// Gmail + Calendar reflect the live Google status; WhatsApp + Discord stay mock (M4).
// Order is preserved — the orb places its nodes in this sequence.
function buildConnections(g: GoogleStatus | null, d: DiscordStatus | null, t: TelegramStatus | null): Connection[] {
  const email = g?.accounts?.[0]?.email;
  const guilds = d?.guilds?.length ?? 0;
  const discordAccount = d?.connected
    ? d.bot_user ?? `${guilds} server${guilds === 1 ? "" : "s"}`
    : d?.connecting
    ? "Connecting…"
    : d?.configured
    ? "Bot offline"
    : "Not linked";
  const telegramAccount = t?.connected ? (t.bot_user ? `@${t.bot_user}` : "Online") : t?.configured ? "Bot offline" : "Not linked";
  return mockConnections.map((c) => {
    if (c.channel === "Gmail")
      return { ...c, connected: !!g?.gmail_connected, account: g?.gmail_connected ? email ?? c.account : "Not linked" };
    if (c.channel === "Calendar")
      return { ...c, connected: !!g?.calendar_connected, account: g?.calendar_connected ? "Primary" : "Not linked" };
    if (c.channel === "Telegram") // takes WhatsApp's slot (WhatsApp parked)
      return { ...c, connected: !!t?.connected, account: telegramAccount };
    if (c.channel === "Discord")
      return { ...c, connected: !!d?.connected, account: discordAccount };
    return c;
  });
}

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [voiceState, setVoiceState] = useState<OrbState>("idle");
  const [bars, setBars] = useState<number[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageHistory, setUsageHistory] = useState<number[]>([]);
  const [usageError, setUsageError] = useState(false);
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  const [dstatus, setDstatus] = useState<DiscordStatus | null>(null);
  const [tstatus, setTstatus] = useState<TelegramStatus | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // (skin-conditional layout removed — all skins share the unified v7 layout now.)

  // Live voice state wins; otherwise "thinking" while a request is in flight.
  const orbState: OrbState = voiceState !== "idle" ? voiceState : loading ? "thinking" : "idle";
  const connections = useMemo(() => buildConnections(gstatus, dstatus, tstatus), [gstatus, dstatus, tstatus]);
  // Whole-backend reachability from the /usage poll (runs every 5s, config-independent).
  const backendState: "loading" | "offline" | "live" = usageError ? "offline" : usage === null ? "loading" : "live";

  async function refreshUsage() {
    const u = await getUsage();
    if (u) {
      setUsage(u);
      setUsageError(false);
      // session token series for the usage sparkline (append on change, cap at 60 samples)
      setUsageHistory((h) => (h.length && h[h.length - 1] === u.tokens_today ? h : [...h, u.tokens_today].slice(-60)));
    } else {
      setUsageError(true); // keep last-known usage; flag the error (panel shows it only when no usage yet)
    }
  }
  useEffect(() => {
    refreshUsage();
    const id = setInterval(refreshUsage, 5000);
    return () => clearInterval(id);
  }, []);

  // Live Google connection status → drives the Connections panel + orb Gmail/Calendar nodes.
  const refreshGoogle = useCallback(async () => {
    setGstatus(await getGoogleStatus());
  }, []);
  useEffect(() => {
    refreshGoogle();
  }, [refreshGoogle]);
  // While a connect flow is mid-browser, poll until the account appears.
  useEffect(() => {
    if (!gstatus?.connecting) return;
    const id = setInterval(refreshGoogle, 2500);
    return () => clearInterval(id);
  }, [gstatus?.connecting, refreshGoogle]);

  const onConnectGoogle = useCallback(async () => {
    setConnectError(null);
    const r = await connectGoogle();
    if (!r.ok) {
      setConnectError(r.error ?? "Connect failed.");
      return;
    }
    await refreshGoogle(); // status now shows connecting → polling kicks in
  }, [refreshGoogle]);
  const onDisconnectGoogle = useCallback(async (email?: string) => {
    await disconnectGoogle(email);
    await refreshGoogle();
  }, [refreshGoogle]);

  // Discord bot status (token-based, auto-connects on backend boot) → orb Discord node + row.
  const refreshDiscord = useCallback(async () => {
    setDstatus(await getDiscordStatus());
  }, []);
  useEffect(() => {
    refreshDiscord();
  }, [refreshDiscord]);
  // Keep polling while the bot is still coming online (or the backend is unreachable); stop once
  // it's connected or known-unconfigured.
  useEffect(() => {
    if (dstatus && (dstatus.connected || !dstatus.configured)) return;
    const id = setInterval(refreshDiscord, 4000);
    return () => clearInterval(id);
  }, [dstatus, refreshDiscord]);

  // Telegram remote status (token-based, long-polling) → orb Telegram node + Connections row.
  const refreshTelegram = useCallback(async () => {
    setTstatus(await getTelegramStatus());
  }, []);
  useEffect(() => {
    refreshTelegram();
  }, [refreshTelegram]);
  useEffect(() => {
    if (tstatus && (tstatus.connected || !tstatus.configured)) return;
    const id = setInterval(refreshTelegram, 4000);
    return () => clearInterval(id);
  }, [tstatus, refreshTelegram]);

  // One rAF loop drives the waveform from whichever source is active (mic or TTS).
  useEffect(() => {
    if (voiceState !== "listening" && voiceState !== "speaking") {
      setBars([]);
      return;
    }
    let raf = 0;
    const tick = () => {
      if (voiceState === "listening" && recordingRef.current) setBars(recordingRef.current.getBars(56));
      else if (voiceState === "speaking") setBars(getSpeechBars(56));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voiceState]);

  function applyData(data: {
    reply?: string;
    warning?: string | null;
    pending?: Record<string, unknown>;
    tool?: string;
    id?: string;
    untrusted?: boolean;
  }) {
    if (data.warning !== undefined) setWarning(data.warning ?? null);
    if (data.pending && data.tool && data.id) {
      setPending({ id: data.id, tool: data.tool, input: data.pending, untrusted: data.untrusted });
    } else if (typeof data.reply === "string") {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
    }
  }

  async function sendMessage(textArg?: string, opts?: { fresh?: boolean }): Promise<string | null> {
    const text = (textArg ?? input).trim();
    if (!text || loading) return null;
    setError(null);
    setPending(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, fresh: opts?.fresh ?? false }),
      });
      if (res.status === 429) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail ?? "Rate limit reached. Thoda ruk ja, Boss.");
        return null;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail ?? `Server error (${res.status}).`);
        return null;
      }
      const data = await res.json();
      applyData(data);
      return data.reply ?? null;
    } catch {
      setError("Can't reach Zenith's backend. Is it running on :8000?");
      return null;
    } finally {
      setLoading(false);
      refreshUsage();
    }
  }

  // The greeting button → run the briefing FRESH (fresh:true ignores prior chat history so a briefing
  // is never deduplicated against an earlier one), then speak the reply.
  async function runBriefing() {
    if (loading) return;
    // Explicit briefing ask (not a bare greeting): "good evening" alone reads as chit-chat, only
    // "good morning" cued get_briefing. The greeting still leads so the spoken reply matches the clock.
    const reply = await sendMessage(`${briefingGreeting()}. Brief me on my day.`, { fresh: true });
    if (reply) {
      setVoiceState("speaking");
      try {
        await speak(reply);
      } finally {
        setVoiceState("idle");
      }
    }
  }

  function prefillInput(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  const startListening = useCallback(async () => {
    if (recordingRef.current || loading) return;
    cancelSpeech();
    setError(null);
    try {
      const handle = await startRecording();
      recordingRef.current = handle;
      setVoiceState("listening");
    } catch {
      setError("Mic blocked — check browser permissions.");
      setVoiceState("idle");
    }
  }, [loading]);

  const stopListening = useCallback(async () => {
    const handle = recordingRef.current;
    if (!handle) return;
    recordingRef.current = null;
    setVoiceState("thinking");
    try {
      const blob = await handle.stop();
      // Accidental tap / no audio → a header-only clip. Skip the round-trip entirely.
      if (blob.size < 1024) {
        setVoiceState("idle");
        return;
      }
      const text = await transcribe(blob);
      if (!text) {
        setVoiceState("idle");
        return;
      }
      const reply = await sendMessage(text);
      if (reply) {
        setVoiceState("speaking");
        await speak(reply);
      }
    } catch {
      setError("Voice failed — could not transcribe. Is the backend running on :8000?");
    } finally {
      setVoiceState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push-to-talk: hold Space to record (ignored while typing in the text box).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      if (document.activeElement === inputRef.current) return; // typing a space
      e.preventDefault();
      void startListening();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (document.activeElement === inputRef.current) return;
      void stopListening();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startListening, stopListening]);

  async function resolvePending(approved: boolean) {
    if (!pending || loading) return;
    const cur = pending;
    setPending(null);
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cur.id, approved }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail ?? `Server error (${res.status}).`);
        return;
      }
      applyData(await res.json());
    } catch {
      setError("Can't reach Zenith's backend. Is it running on :8000?");
    } finally {
      setLoading(false);
      refreshUsage();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const pendingBody = pending ? (
    <>
      {pending.untrusted && (
        <span className="mb-2 block border border-zenith-alert/50 bg-zenith-alert/10 px-2 py-1.5 font-mono text-[11px] leading-snug text-zenith-alert">
          ⚠ This may have been triggered by content Zenith read (email / Discord / calendar). Verify before approving.
        </span>
      )}
      {pending.tool === "send_message" ? (
        <>
          Send a message to <span className="text-zenith-cyan">{String(pending.input.to ?? "?")}</span>:
          <span className="mt-1 block rounded bg-black/40 px-3 py-2 font-mono text-xs">“{String(pending.input.body ?? "")}”</span>
        </>
      ) : (
        <>
          Run <span className="text-zenith-cyan">{pending.tool}</span>:{" "}
          <span className="font-mono text-xs">{JSON.stringify(pending.input)}</span>
        </>
      )}
    </>
  ) : null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-zenith-text">
      {booting && <BootScreen onDone={() => setBooting(false)} />}

      {/* ambient depth layers (behind content) — v7 field + scanline + vignette */}
      <AmbientBackground />
      <div className="amb-scanline" />
      <div className="amb-vignette" />
      <HexCorners />

      <TopBar />
      <MonthRuler />

      {/* main row: icon strip · left rail · center router · right rail — one layout for all skins */}
      <div className="stagger flex min-h-0 flex-1">
        <IconNav view={view} onChange={setView} />

        {/* left rail */}
        <aside className="hud-scroll flex w-[288px] flex-none flex-col overflow-y-auto border-r border-zenith-line">
          <CalendarPanel />
          <QuickActions onPrefill={prefillInput} onBriefing={() => void runBriefing()} />
          <UsagePanel usage={usage} error={usageError} onRetry={refreshUsage} history={usageHistory} />
          <LeftRailExtras />
        </aside>

        {/* center router */}
        <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
          {view === "chat" ? (
            <div className="flex min-h-0 flex-1 flex-col items-center px-4 pb-4 pt-2">
              {/* fixed-size orb — it no longer recedes; the Command Center is paginated, not grown */}
              <div className="aspect-square w-[min(46vw,52vh)] max-w-[520px] shrink-0">
                <ZenithOrb state={orbState} connections={connections} bars={bars} />
              </div>

              {/* STATUS + live waveform (v7) — mt clears the orb's bottom node chip */}
              <div className="mb-3 mt-5 flex items-center gap-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11px] tracking-[0.25em] text-zenith-dim">STATUS</span>
                  <span className="min-w-[92px] font-mono text-[11px] font-semibold uppercase tracking-[0.25em]">
                    <StatusLabel state={orbState} />
                  </span>
                </div>
                <Waveform bars={bars} />
              </div>

              {/* confirm gate — pinned between STATUS and the CC, visible regardless of the CC page */}
              {pending && (
                <div className="rise-in mb-2 w-full max-w-[720px]">
                  <StatusCard tone="alert" title="Action — confirm before it runs" busy={loading} onConfirm={() => resolvePending(true)} onCancel={() => resolvePending(false)}>
                    {pendingBody}
                  </StatusCard>
                </div>
              )}

              <div className="flex w-full flex-none flex-col items-center">
                <CommandCenter
                  messages={messages}
                  loading={loading}
                  error={error}
                  warning={warning}
                  input={input}
                  onInput={setInput}
                  onSend={() => void sendMessage()}
                  onKeyDown={handleKeyDown}
                  inputRef={inputRef}
                  voiceState={orbState}
                  onMicDown={() => void startListening()}
                  onMicUp={() => void stopListening()}
                />
              </div>
            </div>
          ) : view === "memory" ? (
            <MemoryView />
          ) : view === "clients" ? (
            <ClientsView />
          ) : view === "notes" ? (
            <NotesView />
          ) : (
            <SettingsView
              gstatus={gstatus}
              dstatus={dstatus}
              tstatus={tstatus}
              onConnectGoogle={onConnectGoogle}
              onDisconnectGoogle={onDisconnectGoogle}
              connectError={connectError}
            />
          )}
        </main>

        {/* right rail */}
        <aside className="hud-scroll flex w-[316px] flex-none flex-col overflow-y-auto border-l border-zenith-line">
          <ConnectionsPanel connections={connections} status={gstatus} onConnect={onConnectGoogle} onDisconnect={onDisconnectGoogle} connectError={connectError} backendState={backendState} />
          <FocusCard />
          <ActivityLog />
        </aside>
      </div>
    </div>
  );
}
