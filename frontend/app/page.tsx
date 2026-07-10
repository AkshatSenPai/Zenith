"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startRecording, transcribe, speak, cancelSpeech, getSpeechBars, type RecordingHandle } from "../lib/voice";
import { connections as mockConnections, type Connection } from "../lib/mock";
import { apiFetch, getGoogleStatus, connectGoogle, disconnectGoogle, getDiscordStatus, getTelegramStatus, getNotionStatus, getUsage, type GoogleStatus, type DiscordStatus, type TelegramStatus, type NotionStatus, type Usage } from "../lib/api";
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
import { NudgeStack } from "../components/NudgeStack";
import type { Nudge } from "../components/NudgeCard";
import { TriageView } from "../components/TriageView";
import type { WaitingThread } from "../lib/api";
import { HexCorners } from "../components/hud/primitives";
import { BootScreen } from "../components/BootScreen";
import { AmbientBackground } from "../components/AmbientBackground";
import { StatusLabel } from "../components/StatusLabel";
import { Waveform } from "../components/Waveform";
import { CommandPalette } from "../components/CommandPalette";
import { SettingsView } from "../components/SettingsView";
import { briefingGreeting } from "../lib/greeting";

type PendingAction = { id: string; tool: string; input: Record<string, unknown>; untrusted?: boolean };

// All four connections reflect LIVE backend status: Gmail + Calendar from Google, Telegram + Discord
// from their bot status endpoints. (WhatsApp is parked — Telegram took its orb slot.) mock.ts only
// supplies the channel list + order here — the orb places its nodes in this sequence.
function buildConnections(g: GoogleStatus | null, d: DiscordStatus | null, t: TelegramStatus | null, n: NotionStatus | null): Connection[] {
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
    if (c.channel === "Notion")
      return { ...c, connected: !!n?.connected, account: n?.connected ? (n.workspace ?? "Connected") : n?.configured ? "Auth error" : "Not linked" };
    return c;
  });
}

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [voiceState, setVoiceState] = useState<OrbState>("idle");
  const [bars, setBars] = useState<number[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageHistory, setUsageHistory] = useState<number[]>([]);
  const [usageError, setUsageError] = useState(false);
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  const [dstatus, setDstatus] = useState<DiscordStatus | null>(null);
  const [tstatus, setTstatus] = useState<TelegramStatus | null>(null);
  const [nstatus, setNstatus] = useState<NotionStatus | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // (skin-conditional layout removed — all skins share the unified v7 layout now.)

  // Live voice state wins; otherwise "thinking" while a request is in flight.
  const orbState: OrbState = voiceState !== "idle" ? voiceState : loading ? "thinking" : "idle";
  const connections = useMemo(() => buildConnections(gstatus, dstatus, tstatus, nstatus), [gstatus, dstatus, tstatus, nstatus]);
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

  // Proactive nudges — recomputed on demand (60s while the tab is open + on window focus).
  useEffect(() => {
    let alive = true;
    async function refreshProactive() {
      try {
        const r = await apiFetch("/proactive");
        const data = await r.json();
        if (alive && Array.isArray(data.nudges)) setNudges(data.nudges as Nudge[]);
      } catch {
        /* best-effort: keep last state, same as the other panels */
      }
    }
    refreshProactive();
    const id = setInterval(refreshProactive, 60000);
    window.addEventListener("focus", refreshProactive);
    return () => { alive = false; clearInterval(id); window.removeEventListener("focus", refreshProactive); };
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

  // Notion integration status (internal-integration token) → Connections row only (no orb node).
  const refreshNotion = useCallback(async () => {
    setNstatus(await getNotionStatus());
  }, []);
  useEffect(() => {
    refreshNotion();
  }, [refreshNotion]);
  useEffect(() => {
    if (nstatus && (nstatus.connected || !nstatus.configured)) return;
    const id = setInterval(refreshNotion, 4000);
    return () => clearInterval(id);
  }, [nstatus, refreshNotion]);

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

  function onTriageDraft(t: WaitingThread) {
    // An inert prefill — same law as the nudge cards. It never runs a tool; the reply itself is
    // drafted by the normal loop and sent only through the confirm gate. The thread_id rides along
    // so Claude can call reply_email without a lookup round-trip.
    prefillInput(`draft a reply to ${t.from_name} on the thread "${t.subject}" (thread_id: ${t.thread_id})`);
    setView("chat");
  }

  function onNudgeAction(n: Nudge) {
    if (n.action) prefillInput(n.action.prefill);  // the prefill never auto-runs; it rides the normal loop
    void dismissNudge(n.id);                       // acting on it clears the card
  }

  async function dismissNudge(id: string, snooze?: "evening" | "tomorrow") {
    setNudges((cur) => cur.filter((n) => n.id !== id));   // optimistic remove
    try {
      await apiFetch("/proactive/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, snooze: snooze ?? null }),
      });
    } catch { /* best-effort; next poll reconciles */ }
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
    let reply: string | null = null;
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
      reply = await sendMessage(text); // swallows its own network/API errors, returns null
    } catch {
      // Only reached if recording.stop() or transcribe() throws — this label is accurate here.
      setError("Voice failed — could not transcribe. Is the backend running on :8000?");
      setVoiceState("idle");
      return;
    }
    if (!reply) {
      setVoiceState("idle");
      return;
    }
    // The reply is already on screen; speak it. A TTS failure here must NOT surface as a
    // transcription error — the written answer stands on its own.
    setVoiceState("speaking");
    try {
      await speak(reply);
    } catch {
      /* playback failed (e.g. TTS engine error) — keep the rendered reply, show no error strip */
    } finally {
      setVoiceState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push-to-talk: hold Space to record. Ignored while typing in ANY text field (the command
  // center input, the ⌘K palette search, etc.) so Space types a space there instead of recording.
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      if (isTyping()) return;
      e.preventDefault();
      void startListening();
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      // Unconditional (no isTyping guard): if a recording is live, releasing Space MUST stop it even
      // when focus has moved into a text field mid-hold (e.g. ⌘K opened the palette, which autofocuses
      // its input). stopListening() no-ops when nothing is recording, so a real space typed in a field
      // is unaffected — otherwise the mic could stay hot and the orb stuck on LISTENING.
      void stopListening();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startListening, stopListening]);

  // ⌘K / Ctrl-K toggles the command palette from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function resolvePending(approved: boolean) {
    if (!pending || loading) return;
    const cur = pending;
    setPending(null);
    setError(null);
    setLoading(true);
    let spokenReply: string | null = null;
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
      const data = await res.json();
      applyData(data);
      // Capture the result so we can SPEAK it below — after a confirmed action the owner may
      // not be looking at the tab, and a silent written result gave no signal it finished.
      // Only a final reply (nothing newly pending) is worth speaking.
      if (typeof data.reply === "string" && data.reply && !(data.pending && data.tool && data.id)) {
        spokenReply = data.reply;
      }
    } catch {
      // Network-level failure: the request never reached the backend, so the action is still pending
      // there (process_confirm pops the id only once the request arrives). Restore the card so the
      // owner can retry — after a *lost response* a retry harmlessly 404s instead of double-running,
      // because the backend pops-first. On an !res.ok above the id is already consumed → stays cleared.
      setPending(cur);
      setError("Can't reach Zenith's backend. Is it running on :8000?");
    } finally {
      setLoading(false);
      refreshUsage();
    }
    // Speak the confirmed-action result AFTER loading clears, mirroring the voice path in
    // stopListening. A TTS failure keeps the written result on screen and shows no error strip.
    if (spokenReply) {
      setVoiceState("speaking");
      try {
        await speak(spokenReply);
      } catch {
        /* playback failed (e.g. TTS engine error) — keep the rendered reply, no error strip */
      } finally {
        setVoiceState("idle");
      }
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
    <div className="relative isolate flex h-screen flex-col overflow-hidden text-zenith-text">
      {booting && <BootScreen onDone={() => setBooting(false)} />}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(v) => {
          setView(v);
          setPaletteOpen(false);
        }}
        onAction={(a) => {
          setPaletteOpen(false);
          setView("chat");
          if (a === "briefing") {
            void runBriefing();
            return;
          }
          const prefills: Record<string, string> = {
            email: "Draft an email to ",
            proposal: "Draft a proposal for ",
            event: "Add to my calendar: ",
            note: "Note that ",
          };
          if (prefills[a]) prefillInput(prefills[a]);
        }}
      />

      {/* ambient depth layers (behind content) — v7 field + scanline + vignette.
          The root div above carries `isolate` (isolation: isolate) so these -z-20/-z-10 layers
          form a stacking context here and paint ABOVE the page background. Without it they fall
          behind body's opaque background-color and only flash into view during the skin-swap
          (body opacity <1 temporarily makes body a stacking context). */}
      <AmbientBackground />
      <div className="amb-scanline" />
      <div className="amb-vignette" />
      <HexCorners />

      <TopBar onOpenPalette={() => setPaletteOpen(true)} />
      <MonthRuler />

      {/* main row: icon strip · left rail · center router · right rail — one layout for all skins */}
      <div className="stagger flex min-h-0 flex-1">
        <IconNav view={view} onChange={setView} />

        {/* left rail */}
        {/* rails are opaque (mock: background:var(--bg)) so the ambient constellation never shows through them */}
        <aside className="hud-scroll flex w-[288px] flex-none flex-col overflow-y-auto border-r border-zenith-line bg-zenith-bg">
          <CalendarPanel />
          <QuickActions onPrefill={prefillInput} onBriefing={() => void runBriefing()} />
          <UsagePanel usage={usage} error={usageError} onRetry={refreshUsage} history={usageHistory} />
          <LeftRailExtras />
        </aside>

        {/* center router */}
        <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
          {view === "chat" ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-4">
              {/* height-sized orb — flex can shrink it when a long reply grows the Command Center,
                  so the CC never presses the viewport edge (width follows via aspect-square) */}
              <div className="aspect-square h-[min(46vw,52vh)] max-h-[520px] min-h-[200px] w-auto shrink">
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

              {/* proactive nudges — below the confirm card, which always outranks them */}
              {nudges.length > 0 && (
                <div className="rise-in mb-2 w-full max-w-[720px]">
                  <NudgeStack
                    nudges={nudges}
                    onAction={onNudgeAction}
                    onDismiss={(id) => void dismissNudge(id)}
                    onSnooze={(id, preset) => void dismissNudge(id, preset)}
                  />
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
          ) : view === "triage" ? (
            <TriageView onDraft={onTriageDraft} />
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
        <aside className="hud-scroll flex w-[316px] flex-none flex-col overflow-y-auto border-l border-zenith-line bg-zenith-bg">
          <ConnectionsPanel connections={connections} status={gstatus} onConnect={onConnectGoogle} onDisconnect={onDisconnectGoogle} connectError={connectError} backendState={backendState} />
          <FocusCard />
          <ActivityLog />
        </aside>
      </div>
    </div>
  );
}
