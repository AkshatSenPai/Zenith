"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, transcribe, speak, cancelSpeech, getSpeechBars, type RecordingHandle } from "../lib/voice";
import { connections } from "../lib/mock";
import { TopBar } from "../components/TopBar";
import { ContextRail, type View } from "../components/ContextRail";
import { ZenithOrb, type OrbState } from "../components/ZenithOrb";
import { CalendarPanel } from "../components/CalendarPanel";
import { QuickActions } from "../components/QuickActions";
import { ConnectionsPanel } from "../components/ConnectionsPanel";
import { FocusCard } from "../components/FocusCard";
import { ActivityLog } from "../components/ActivityLog";
import { CommandCenter, type Message } from "../components/CommandCenter";
import { PlaceholderView } from "../components/PlaceholderView";
import { WaveformBar } from "../components/WaveformBar";
import { GaugeIndicator } from "../components/GaugeIndicator";
import { StatusCard } from "../components/StatusCard";
import { HexCorners } from "../components/hud/primitives";

type PendingAction = { id: string; tool: string; input: Record<string, unknown> };
type Usage = {
  requests_today: number;
  daily_request_cap: number;
  requests_last_minute: number;
  per_minute_cap: number;
  tokens_today: number;
  daily_token_budget: number;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
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
  const recordingRef = useRef<RecordingHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live voice state wins; otherwise "thinking" while a request is in flight.
  const orbState: OrbState = voiceState !== "idle" ? voiceState : loading ? "thinking" : "idle";
  const voiceActive = orbState === "listening" || orbState === "speaking";
  // The command center expands (and the orb recedes) once there's any activity.
  const chatActive = messages.length > 0 || loading || input.trim().length > 0 || orbState === "listening";

  async function refreshUsage() {
    try {
      const res = await fetch(`${API_URL}/usage`);
      if (res.ok) setUsage(await res.json());
    } catch {
      /* leave last-known usage */
    }
  }
  useEffect(() => {
    refreshUsage();
    const id = setInterval(refreshUsage, 5000);
    return () => clearInterval(id);
  }, []);

  // One rAF loop drives the waveform from whichever source is active (mic or TTS).
  useEffect(() => {
    if (voiceState !== "listening" && voiceState !== "speaking") {
      setBars([]);
      return;
    }
    let raf = 0;
    const tick = () => {
      if (voiceState === "listening" && recordingRef.current) setBars(recordingRef.current.getBars(32));
      else if (voiceState === "speaking") setBars(getSpeechBars(32));
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
  }) {
    if (data.warning !== undefined) setWarning(data.warning ?? null);
    if (data.pending && data.tool && data.id) {
      setPending({ id: data.id, tool: data.tool, input: data.pending });
    } else if (typeof data.reply === "string") {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply as string }]);
    }
  }

  async function sendMessage(textArg?: string): Promise<string | null> {
    const text = (textArg ?? input).trim();
    if (!text || loading) return null;
    setError(null);
    setPending(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
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
      const res = await fetch(`${API_URL}/chat/confirm`, {
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

  const pendingBody =
    pending?.tool === "send_message" ? (
      <>
        Send a message to <span className="text-zenith-cyan">{String(pending.input.to ?? "?")}</span>:
        <span className="mt-1 block rounded bg-black/40 px-3 py-2 font-mono text-xs">“{String(pending.input.body ?? "")}”</span>
      </>
    ) : pending ? (
      <>
        Run <span className="text-zenith-cyan">{pending.tool}</span>:{" "}
        <span className="font-mono text-xs">{JSON.stringify(pending.input)}</span>
      </>
    ) : null;

  return (
    <div className="relative grid h-screen grid-rows-[auto_1fr_auto] overflow-hidden text-zenith-text">
      {/* ambient depth layers (behind content) */}
      <div className="bg-aura" />
      <div className="bg-grain" />
      <HexCorners />

      <TopBar />

      {/* main row: rail · calendar+actions+usage · center · connections+focus+log */}
      <div className="stagger grid min-h-0 grid-cols-[64px_264px_1fr_320px]">
        <ContextRail view={view} onChange={setView} />

        {/* left */}
        <div className="hud-scroll flex min-h-0 flex-col overflow-y-auto">
          <CalendarPanel />
          <QuickActions />
          <section className="relative z-10 border-r border-zenith-cyan/12 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Usage</div>
            <div className="flex justify-around">
              {usage ? (
                <>
                  <GaugeIndicator label="Req/min" value={usage.requests_last_minute} max={usage.per_minute_cap} />
                  <GaugeIndicator label="Daily" value={usage.requests_today} max={usage.daily_request_cap} />
                  <GaugeIndicator label="Tokens" value={usage.tokens_today} max={usage.daily_token_budget} />
                </>
              ) : (
                <div className="py-4 font-mono text-[10px] text-zenith-text/35">loading usage…</div>
              )}
            </div>
          </section>
        </div>

        {/* center */}
        <div className="relative z-10 flex min-h-0 flex-col">
          {view === "chat" ? (
            <div className="flex min-h-0 flex-1 flex-col items-center px-4 pb-3 pt-2">
              <div
                className="origin-top transition-transform duration-500 ease-out"
                style={{ transform: chatActive ? "scale(0.82)" : "scale(1)" }}
              >
                <ZenithOrb state={orbState} size={340} connections={connections} />
              </div>
              <div className="-mt-2 font-mono text-[10px] uppercase tracking-[0.35em] text-zenith-text/50">
                Status: <span className="text-zenith-cyan">{orbState}</span>
              </div>

              {pending && (
                <div className="mt-3 w-full max-w-2xl">
                  <StatusCard tone="alert" title="Action — confirm before it runs" busy={loading} onConfirm={() => resolvePending(true)} onCancel={() => resolvePending(false)}>
                    {pendingBody}
                  </StatusCard>
                </div>
              )}

              <div className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center">
                <CommandCenter messages={messages} loading={loading} error={error} warning={warning} active={chatActive} />
              </div>
            </div>
          ) : (
            <PlaceholderView view={view} />
          )}
        </div>

        {/* right */}
        <div className="hud-scroll flex min-h-0 flex-col overflow-y-auto border-l border-zenith-cyan/12">
          <ConnectionsPanel connections={connections} />
          <FocusCard />
          <ActivityLog />
        </div>
      </div>

      {/* bottom bar: mic (push-to-talk) · compact reactive waveform · input */}
      <div className="relative z-10 border-t border-zenith-cyan/15 bg-[#05070d]/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              void startListening();
            }}
            onPointerUp={() => void stopListening()}
            onPointerLeave={() => {
              if (recordingRef.current) void stopListening();
            }}
            title="Hold to talk (or hold Space)"
            className={`press flex items-center gap-2 rounded-lg border px-4 py-3 font-mono text-xs uppercase tracking-widest transition ${
              orbState === "listening"
                ? "border-zenith-cyan bg-zenith-cyan/15 text-zenith-cyan"
                : "border-zenith-cyan/30 text-zenith-text/70 hover:border-zenith-cyan"
            }`}
          >
            {orbState === "listening" ? (
              <>
                <span className="blink h-2 w-2 rounded-full bg-zenith-cyan" /> Rec
              </>
            ) : (
              <MicIcon />
            )}
          </button>

          <div className="hidden shrink-0 sm:block">
            <WaveformBar active={voiceActive} bars={bars} />
          </div>

          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…  (or hold Space to talk)"
            className="flex-1 rounded-lg border border-zenith-cyan/25 bg-black/40 px-4 py-3 font-mono text-sm text-zenith-text outline-none transition-colors placeholder:text-zenith-text/30 focus:border-zenith-cyan"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={loading || input.trim() === ""}
            className="press rounded-lg bg-zenith-cyan px-5 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-zenith-bg transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </svg>
  );
}
