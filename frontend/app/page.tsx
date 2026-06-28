"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startRecording, transcribe, speak, cancelSpeech, getSpeechBars, type RecordingHandle } from "../lib/voice";
import { connections as mockConnections, type Connection } from "../lib/mock";
import { apiFetch, getGoogleStatus, connectGoogle, disconnectGoogle, getDiscordStatus, getTelegramStatus, getUsage, type GoogleStatus, type DiscordStatus, type TelegramStatus, type Usage } from "../lib/api";
import { TopBar } from "../components/TopBar";
import { ContextRail, type View } from "../components/ContextRail";
import { ZenithOrb, type OrbState } from "../components/ZenithOrb";
import { CalendarPanel } from "../components/CalendarPanel";
import { QuickActions } from "../components/QuickActions";
import { LeftRailExtras } from "../components/LeftRailExtras";
import { ConnectionsPanel } from "../components/ConnectionsPanel";
import { FocusCard } from "../components/FocusCard";
import { ActivityLog } from "../components/ActivityLog";
import { CommandCenter, type Message } from "../components/CommandCenter";
import { PlaceholderView } from "../components/PlaceholderView";
import { UsagePanel } from "../components/UsagePanel";
import { StatusCard } from "../components/StatusCard";
import { HexCorners } from "../components/hud/primitives";
import { BootScreen } from "../components/BootScreen";
import { StatusLabel } from "../components/StatusLabel";
import { useSkin } from "../components/SkinProvider";
import { SettingsView } from "../components/SettingsView";
import { VaultView } from "../components/VaultView";
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
  const [usageError, setUsageError] = useState(false);
  const [ccMinimized, setCcMinimized] = useState(false);
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  const [dstatus, setDstatus] = useState<DiscordStatus | null>(null);
  const [tstatus, setTstatus] = useState<TelegramStatus | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { skin } = useSkin();
  const ghost = skin === "ghost"; // light/ink centered-focus skin: hide dashboard columns + chrome
  const amethyst = skin === "amethyst"; // violet bento dashboard
  const sideless = ghost || amethyst; // both drop the L/R dashboard columns (Ghost=focus, Amethyst=bento)

  // Live voice state wins; otherwise "thinking" while a request is in flight.
  const orbState: OrbState = voiceState !== "idle" ? voiceState : loading ? "thinking" : "idle";
  const voiceCycle = orbState !== "idle"; // listening / thinking / speaking
  const convo = messages.length > 0 || loading;
  // Orb stays big while idle or during a voice round-trip (so you watch it react); it recedes
  // to reveal the command center once there's a conversation to read. The CC grows to match.
  // Minimizing the CC (§3) also hands the space back to the orb.
  const orbBig = voiceCycle || !convo || ccMinimized;
  const ccExpanded = convo && !voiceCycle && !ccMinimized;
  const connections = useMemo(() => buildConnections(gstatus, dstatus, tstatus), [gstatus, dstatus, tstatus]);
  // Whole-backend reachability from the /usage poll (runs every 5s, config-independent).
  const backendState: "loading" | "offline" | "live" = usageError ? "offline" : usage === null ? "loading" : "live";

  async function refreshUsage() {
    const u = await getUsage();
    if (u) {
      setUsage(u);
      setUsageError(false);
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

  // Auto-restore the Command Center when a new message arrives (e.g. a push-to-talk answer
  // while minimized) so Zenith's reply is always shown. (§3 minimize/restore)
  useEffect(() => {
    setCcMinimized(false);
  }, [messages.length]);

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
    <div className="relative grid h-screen grid-rows-[auto_1fr] overflow-hidden text-zenith-text">
      {booting && <BootScreen onDone={() => setBooting(false)} />}

      {/* ambient depth layers (behind content) */}
      <div className="bg-aura" />
      <div className="bg-grain" />
      {!ghost && <HexCorners />}

      <TopBar minimal={ghost} />

      {/* main row: rail · calendar+actions+usage · center · connections+focus+log.
          Ghost = centered focus, Amethyst = bento: both keep only rail + center (side columns hidden). */}
      <div
        className={`stagger grid min-h-0 ${
          sideless ? "grid-cols-[64px_1fr]" : "grid-cols-[64px_264px_1fr_320px]"
        }`}
      >
        <ContextRail view={view} onChange={setView} />

        {/* left — full-height divider; content fills down to a pinned footer */}
        {!sideless && (
        <div className="hud-scroll flex min-h-0 flex-col overflow-y-auto border-r border-zenith-cyan/12">
          <CalendarPanel />
          <QuickActions onPrefill={prefillInput} onBriefing={() => void runBriefing()} />
          <UsagePanel usage={usage} error={usageError} onRetry={refreshUsage} />
          <LeftRailExtras />
        </div>
        )}

        {/* center */}
        <div className="relative z-10 flex min-h-0 flex-col">
          {view === "chat" ? (
            amethyst ? (
            /* Amethyst bento: orb hero + Connections/Usage/Calendar/Activity tiles + slim CC bar */
            <div className="bento stagger min-h-0 flex-1 p-4">
              {/* orb hero (2x2) */}
              <div className="bento-orb panel relative flex flex-col items-center justify-center overflow-hidden p-4">
                <div className="aspect-square w-[min(40vh,440px)] max-w-full">
                  <ZenithOrb state={orbState} connections={connections} bars={bars} />
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.35em] text-zenith-text/50">
                  Status: <StatusLabel state={orbState} />
                </div>
                {pending && (
                  <div className="rise-in absolute inset-x-4 bottom-4 z-20">
                    <StatusCard tone="alert" title="Action — confirm before it runs" busy={loading} onConfirm={() => resolvePending(true)} onCancel={() => resolvePending(false)}>
                      {pendingBody}
                    </StatusCard>
                  </div>
                )}
              </div>

              {/* connections */}
              <div className="bento-conn panel hud-scroll min-h-0 overflow-y-auto">
                <ConnectionsPanel connections={connections} status={gstatus} onConnect={onConnectGoogle} onDisconnect={onDisconnectGoogle} connectError={connectError} backendState={backendState} />
              </div>

              {/* usage — progress bars + estimated cost + kill-switch */}
              <div className="bento-usage panel hud-scroll min-h-0 overflow-y-auto">
                <UsagePanel usage={usage} error={usageError} onRetry={refreshUsage} />
              </div>

              {/* calendar — wide event strip */}
              <div className="bento-cal panel hud-scroll min-h-0 overflow-y-auto">
                <CalendarPanel />
              </div>

              {/* activity */}
              <div className="bento-activity panel hud-scroll min-h-0 overflow-y-auto">
                <ActivityLog />
              </div>

              {/* command center — slim full-width bar (grows when a conversation is open) */}
              <div className="bento-cc flex min-h-0 items-stretch justify-center">
                <CommandCenter
                  messages={messages}
                  loading={loading}
                  error={error}
                  warning={warning}
                  expanded={ccExpanded}
                  input={input}
                  onInput={setInput}
                  onSend={() => void sendMessage()}
                  onKeyDown={handleKeyDown}
                  inputRef={inputRef}
                  voiceState={orbState}
                  onMicDown={() => void startListening()}
                  onMicUp={() => void stopListening()}
                  minimized={ccMinimized}
                  onMinimize={() => setCcMinimized(true)}
                  onRestore={() => setCcMinimized(false)}
                />
              </div>
            </div>
            ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center px-4 pb-4 pt-2">
              <div
                className={`aspect-square shrink-0 transition-[width] duration-500 ease-out ${
                  orbBig
                    ? ghost
                      ? "w-[min(56vw,74vh)] max-w-[760px]" // Ghost focus: a larger hero orb
                      : "w-[min(58vw,62vh)] max-w-[640px]"
                    : "w-[min(34vw,34vh)] max-w-[360px]"
                }`}
              >
                <ZenithOrb state={orbState} connections={connections} bars={bars} />
              </div>
              <div className="-mt-1 mb-2 font-mono text-[10px] uppercase tracking-[0.35em] text-zenith-text/50">
                Status: <StatusLabel state={orbState} />
              </div>

              {pending && (
                <div className="rise-in mb-2 w-full max-w-2xl">
                  <StatusCard tone="alert" title="Action — confirm before it runs" busy={loading} onConfirm={() => resolvePending(true)} onCancel={() => resolvePending(false)}>
                    {pendingBody}
                  </StatusCard>
                </div>
              )}

              <div className="flex min-h-0 w-full flex-1 flex-col items-center">
                <CommandCenter
                  messages={messages}
                  loading={loading}
                  error={error}
                  warning={warning}
                  expanded={ccExpanded}
                  input={input}
                  onInput={setInput}
                  onSend={() => void sendMessage()}
                  onKeyDown={handleKeyDown}
                  inputRef={inputRef}
                  voiceState={orbState}
                  onMicDown={() => void startListening()}
                  onMicUp={() => void stopListening()}
                  minimized={ccMinimized}
                  onMinimize={() => setCcMinimized(true)}
                  onRestore={() => setCcMinimized(false)}
                />
              </div>
            </div>
            )
          ) : view === "settings" ? (
            <SettingsView
              gstatus={gstatus}
              dstatus={dstatus}
              tstatus={tstatus}
              onConnectGoogle={onConnectGoogle}
              onDisconnectGoogle={onDisconnectGoogle}
              connectError={connectError}
            />
          ) : view === "clients" ? (
            <VaultView mode="clients" title="Clients" />
          ) : view === "drafts" ? (
            <VaultView mode="recent" title="Notes" />
          ) : (
            <PlaceholderView view={view} />
          )}
        </div>

        {/* right (hidden in Ghost focus + Amethyst bento) */}
        {!sideless && (
        <div className="hud-scroll flex min-h-0 flex-col overflow-y-auto border-l border-zenith-cyan/12">
          <ConnectionsPanel connections={connections} status={gstatus} onConnect={onConnectGoogle} onDisconnect={onDisconnectGoogle} connectError={connectError} backendState={backendState} />
          <FocusCard />
          <ActivityLog />
        </div>
        )}
      </div>

      {/* Ghost focus: a single one-line usage readout in the corner (replaces the gauges) */}
      {ghost && usage && (
        <div className="pointer-events-none absolute bottom-3 left-[80px] z-20 font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-text/45">
          {usage.requests_today}/{usage.daily_request_cap} req · {Math.round(usage.tokens_today / 1000)}k tok · ~₹{usage.cost_inr.toFixed(2)}
          {usage.killswitch && <span className="ml-2 text-zenith-alert">● capped</span>}
        </div>
      )}
    </div>
  );
}
