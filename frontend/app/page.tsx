"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, transcribe, speak, cancelSpeech, type RecordingHandle } from "../lib/voice";
import { TopBar } from "../components/TopBar";
import { ZenithOrb, type OrbState } from "../components/ZenithOrb";
import { CalendarPanel } from "../components/CalendarPanel";
import { CommsPanel } from "../components/CommsPanel";
import { WaveformBar } from "../components/WaveformBar";
import { GaugeIndicator } from "../components/GaugeIndicator";
import { StatusCard } from "../components/StatusCard";
import { HexCorners } from "../components/hud/primitives";
import { Markdown } from "../components/Markdown";

type Message = { role: "user" | "assistant"; content: string };
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [voiceState, setVoiceState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [usage, setUsage] = useState<Usage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recordingRef = useRef<RecordingHandle | null>(null);
  const rafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pass B: live voice state wins; otherwise "thinking" while a request is in flight.
  const orbState: OrbState = voiceState !== "idle" ? voiceState : loading ? "thinking" : "idle";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, pending]);

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
      const tick = () => {
        if (!recordingRef.current) return;
        setLevel(recordingRef.current.getLevel());
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setError("Mic blocked — check browser permissions.");
      setVoiceState("idle");
    }
  }, [loading]);

  const stopListening = useCallback(async () => {
    const handle = recordingRef.current;
    if (!handle) return;
    recordingRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setLevel(0);
    setVoiceState("thinking");
    try {
      const blob = await handle.stop();
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
    <div className="relative grid h-screen grid-rows-[auto_1fr_auto] overflow-hidden bg-zenith-bg text-zenith-text">
      <HexCorners />
      <TopBar />

      {/* main row */}
      <div className="grid min-h-0 grid-cols-[280px_1fr_300px]">
        {/* left: calendar + system gauges */}
        <div className="hud-scroll flex min-h-0 flex-col overflow-y-auto">
          <CalendarPanel />
          <div className="relative z-10 border-r border-t border-zenith-cyan/15 p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">System</div>
            <div className="flex justify-around">
              {usage ? (
                <>
                  <GaugeIndicator label="Req/min" value={usage.requests_last_minute} max={usage.per_minute_cap} />
                  <GaugeIndicator label="Daily" value={usage.requests_today} max={usage.daily_request_cap} />
                  <GaugeIndicator label="Tokens" value={usage.tokens_today} max={usage.daily_token_budget} />
                </>
              ) : (
                <div className="font-mono text-[10px] text-zenith-text/35">loading usage…</div>
              )}
            </div>
          </div>
        </div>

        {/* center: orb + chat */}
        <div className="relative z-10 flex min-h-0 flex-col items-center">
          <div className="flex flex-col items-center pt-4">
            <ZenithOrb state={orbState} size={300} />
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-zenith-text/50">
              Status: <span className="text-zenith-cyan">{orbState}</span>
            </div>
          </div>

          <div ref={scrollRef} className="hud-scroll w-full max-w-xl flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="text-center font-body text-sm text-zenith-text/35">Say something to Zenith…</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                {m.role === "user" ? (
                  <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded-lg bg-zenith-cyan/10 px-4 py-2 font-body text-sm text-zenith-text">
                    {m.content}
                  </span>
                ) : (
                  <div className="inline-block max-w-[85%] rounded-lg bg-zenith-blue/10 px-4 py-2 text-left font-body text-sm text-zenith-text">
                    <Markdown text={m.content} />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-left">
                <span className="inline-block rounded-lg bg-zenith-blue/10 px-4 py-2 font-mono text-sm text-zenith-cyan/70">
                  Zenith is thinking…
                </span>
              </div>
            )}
          </div>

          <div className="w-full max-w-xl space-y-2 px-4 pb-3">
            {pending && (
              <StatusCard tone="alert" title="Action — confirm" busy={loading} onConfirm={() => resolvePending(true)} onCancel={() => resolvePending(false)}>
                {pendingBody}
              </StatusCard>
            )}
            {warning && <p className="text-center font-mono text-xs text-zenith-alert">{warning}</p>}
            {error && <p className="text-center font-mono text-xs text-zenith-red">{error}</p>}
          </div>
        </div>

        {/* right: communications */}
        <div className="hud-scroll min-h-0 overflow-y-auto">
          <CommsPanel />
        </div>
      </div>

      {/* bottom bar: waveform + mic (push-to-talk) + input */}
      <div className="relative z-10 border-t border-zenith-cyan/20 px-4 py-3">
        <div className="mb-2">
          <WaveformBar active={orbState === "listening" || orbState === "speaking"} level={level} />
        </div>
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
            className={`rounded-lg border px-4 py-3 font-mono text-sm transition ${
              voiceState === "listening"
                ? "border-zenith-cyan bg-zenith-cyan/15 text-zenith-cyan"
                : "border-zenith-cyan/30 text-zenith-text/70 hover:border-zenith-cyan"
            }`}
          >
            {voiceState === "listening" ? "● REC" : "🎤"}
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…  (or hold Space to talk)"
            className="flex-1 rounded-lg border border-zenith-cyan/30 bg-black/40 px-4 py-3 font-body text-sm text-zenith-text outline-none placeholder:text-zenith-text/30 focus:border-zenith-cyan"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={loading || input.trim() === ""}
            className="rounded-lg bg-zenith-cyan px-5 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-zenith-bg transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
