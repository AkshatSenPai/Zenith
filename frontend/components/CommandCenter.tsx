"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { CardBrackets } from "./hud/primitives";
import type { OrbState } from "./ZenithOrb";

export type Message = { role: "user" | "assistant"; content: string };
type Pair = { query?: string; response?: string };

function toPairs(messages: Message[]): Pair[] {
  const pairs: Pair[] = [];
  for (const m of messages) {
    if (m.role === "user") pairs.push({ query: m.content });
    else if (pairs.length && pairs[pairs.length - 1].response === undefined) pairs[pairs.length - 1].response = m.content;
    else pairs.push({ response: m.content });
  }
  return pairs;
}

export function CommandCenter({
  messages,
  loading,
  error,
  warning,
  expanded,
  input,
  onInput,
  onSend,
  onKeyDown,
  inputRef,
  voiceState,
  onMicDown,
  onMicUp,
  minimized,
  onMinimize,
  onRestore,
}: {
  messages: Message[];
  loading: boolean;
  error: string | null;
  warning: string | null;
  expanded: boolean;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  voiceState: OrbState;
  onMicDown: () => void;
  onMicUp: () => void;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
}) {
  const pairs = toPairs(messages);
  const total = Math.max(pairs.length, 1);
  const [page, setPage] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPage(Math.max(pairs.length - 1, 0));
  }, [pairs.length]);

  const cur = pairs[Math.min(page, pairs.length - 1)] ?? {};
  const response = cur.response ?? "";
  const empty = pairs.length === 0;
  const showThinking = loading && (cur.response === undefined || page === pairs.length - 1);
  const listening = voiceState === "listening";

  function ping(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }
  async function onCopy() {
    if (!response) return;
    try { await navigator.clipboard.writeText(response); ping("copied"); } catch { ping("copy failed"); }
  }
  function onSave() {
    if (!response) return;
    const url = URL.createObjectURL(new Blob([response], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url; a.download = `zenith-response-${Date.now()}.md`; a.click();
    URL.revokeObjectURL(url);
    ping("saved .md");
  }
  async function onShare() {
    if (!response) return;
    if (navigator.share) { try { await navigator.share({ title: "Zenith", text: response }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(response); ping("copied to share"); } catch { ping("share unavailable"); }
  }

  return (
    <div
      className="panel relative flex w-full min-h-0 max-w-2xl flex-col transition-[flex-grow] duration-300 ease-out"
      style={{ flexGrow: expanded ? 1 : 0 }}
    >
      <CardBrackets cls="border-zenith-cyan/30" />

      {/* header — doubles as the minimized "pill": click to restore when collapsed (§3) */}
      <div
        className={`flex items-center justify-between border-b border-zenith-cyan/12 px-4 py-2.5 ${minimized ? "cursor-pointer select-none" : ""}`}
        onClick={minimized ? onRestore : undefined}
        role={minimized ? "button" : undefined}
        aria-label={minimized ? "Restore Command Center" : undefined}
      >
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-zenith-cyan/70" />
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-zenith-cyan/75">Command Center</span>
        </div>
        <div className="flex items-center gap-3">
          {!empty && !minimized && (
            <span className="font-mono text-[10px] tabular-nums tracking-widest text-zenith-text/40">
              {String(page + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
          )}
          {minimized ? (
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">
              Restore <Chevron dir="up" />
            </span>
          ) : (
            !empty && (
              <button
                type="button"
                onClick={onMinimize}
                aria-label="Minimize Command Center"
                title="Minimize"
                className="press text-zenith-text/40 transition hover:text-zenith-cyan"
              >
                <Chevron dir="down" />
              </button>
            )
          )}
        </div>
      </div>

      {/* response surface — grows in when there's a conversation, collapses otherwise */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${expanded && !empty ? "flex-1 min-h-0 opacity-100" : "max-h-0 flex-none opacity-0"}`}>
        <div className="hud-scroll h-full overflow-y-auto px-5 py-4">
          {cur.query && (
            <div className="mb-3 flex gap-2 font-mono text-xs text-zenith-text/55">
              <span className="text-zenith-cyan/60">&gt;</span>
              <span className="whitespace-pre-wrap">{cur.query}</span>
            </div>
          )}
          {showThinking ? (
            <p className="font-mono text-sm text-zenith-cyan/70">Zenith is thinking<span className="blink">_</span></p>
          ) : response ? (
            <div className="font-mono text-sm leading-relaxed text-zenith-text"><Markdown text={response} /></div>
          ) : (
            <p className="font-mono text-xs text-zenith-text/30">No response on this page.</p>
          )}
        </div>
      </div>

      {(error || warning) && (
        <div className="border-t border-zenith-cyan/10 px-5 py-2">
          {error && <p className="font-mono text-xs text-zenith-red">{error}</p>}
          {warning && <p className="font-mono text-xs text-zenith-alert">{warning}</p>}
        </div>
      )}

      {/* response actions — only with a conversation */}
      {expanded && !empty && (
        <div className="flex items-center justify-between border-t border-zenith-cyan/12 px-4 py-2">
          <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest">
            {flash ? (
              <span className="text-zenith-cyan">{flash}</span>
            ) : (
              <>
                <FooterBtn onClick={onCopy} disabled={!response}>Copy</FooterBtn>
                <FooterBtn onClick={onSave} disabled={!response}>Save</FooterBtn>
                <FooterBtn onClick={onShare} disabled={!response}>Share</FooterBtn>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] tabular-nums tracking-widest text-zenith-text/50">
            <span>Page {page + 1} of {total}</span>
            <button aria-label="Previous response" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0} className="press px-1 text-zenith-cyan transition hover:text-white disabled:cursor-not-allowed disabled:text-zenith-text/20">‹</button>
            <button aria-label="Next response" onClick={() => setPage((p) => Math.min(pairs.length - 1, p + 1))} disabled={page >= pairs.length - 1} className="press px-1 text-zenith-cyan transition hover:text-white disabled:cursor-not-allowed disabled:text-zenith-text/20">›</button>
          </div>
        </div>
      )}

      {/* input row — collapses with the panel when minimized; reappears on restore (§3) */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${minimized ? "max-h-0 opacity-0" : "max-h-28 opacity-100"}`}>
      <div className="flex items-center gap-2.5 border-t border-zenith-cyan/15 px-3 py-2.5">
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); onMicDown(); }}
          onPointerUp={onMicUp}
          onPointerLeave={onMicUp}
          title="Hold to talk (or hold Space)"
          className={`press flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-widest transition ${
            listening ? "border-zenith-cyan bg-zenith-cyan/15 text-zenith-cyan" : "border-zenith-cyan/30 text-zenith-text/70 hover:border-zenith-cyan"
          }`}
        >
          {listening ? <><span className="blink h-2 w-2 rounded-full bg-zenith-cyan" /> Rec</> : <MicIcon />}
        </button>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Zenith — type, or hold Space to talk"
          className="min-w-0 flex-1 bg-transparent px-1 font-mono text-sm text-zenith-text outline-none placeholder:text-zenith-text/30"
        />
        <button
          onClick={onSend}
          disabled={loading || input.trim() === ""}
          className="press shrink-0 rounded-md bg-zenith-cyan px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-zenith-bg transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
      </div>
    </div>
  );
}

function FooterBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="press text-zenith-text/60 transition hover:text-zenith-cyan disabled:cursor-not-allowed disabled:text-zenith-text/20">
      {children}
    </button>
  );
}

function Chevron({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {dir === "down" ? <path d="M6 9l6 6 6-6" /> : <path d="M18 15l-6-6-6 6" />}
    </svg>
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
