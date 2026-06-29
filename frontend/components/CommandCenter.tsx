"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import type { OrbState } from "./ZenithOrb";

export type Message = { role: "user" | "assistant"; content: string };

export function CommandCenter({
  messages,
  loading,
  error,
  warning,
  input,
  onInput,
  onSend,
  onKeyDown,
  inputRef,
  voiceState,
  onMicDown,
  onMicUp,
}: {
  messages: Message[];
  loading: boolean;
  error: string | null;
  warning: string | null;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  voiceState: OrbState;
  onMicDown: () => void;
  onMicUp: () => void;
}) {
  // One turn per page. While a reply is in flight (the latest message is the user's), append a
  // synthetic Zenith page so paging to the end shows the thinking caret — not the user's echo.
  const thinking = loading && messages.length > 0 && messages[messages.length - 1].role === "user";
  const pages: Message[] = thinking ? [...messages, { role: "assistant", content: "" }] : messages;
  const total = pages.length;

  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(Math.max(0, total - 1)); // auto-advance to the latest turn
  }, [total]);

  const clamped = Math.min(page, Math.max(0, total - 1));
  const msg = total > 0 ? pages[clamped] : undefined;
  const canPrev = clamped > 0;
  const canNext = clamped < total - 1;
  const showCaret = thinking && clamped === total - 1;
  const listening = voiceState === "listening";
  const response = msg && msg.role === "assistant" ? msg.content : "";

  // Copy / Save / Share — preserved (the owner leans on Copy for the Copy Factory). Shown only
  // on a Zenith answer that has content.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function ping(m: string) {
    setFlash(m);
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
    if (navigator.share) { try { await navigator.share({ title: "Zenith", text: response }); return; } catch { /* fall through to clipboard */ } }
    try { await navigator.clipboard.writeText(response); ping("copied to share"); } catch { ping("share unavailable"); }
  }

  return (
    <div className="panel relative w-full max-w-[720px] overflow-hidden">
      {/* header: status dot + label · prev / page / next */}
      <div className="flex items-center justify-between border-b border-zenith-line px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-[7px] w-[7px] rounded-full bg-zenith-cyan shadow-[0_0_8px_rgb(var(--zenith-cyan)/0.9)]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-lo">Command Center</span>
        </div>
        <div className="flex items-center gap-1.5">
          <PageBtn dir="prev" disabled={!canPrev} onClick={() => setPage((p) => Math.max(0, p - 1))} />
          <span className="min-w-[46px] text-center font-mono text-[9px] tabular-nums tracking-[0.1em] text-zenith-lo">
            {total === 0 ? "0 / 0" : `${clamped + 1} / ${total}`}
          </span>
          <PageBtn dir="next" disabled={!canNext} onClick={() => setPage((p) => Math.min(total - 1, p + 1))} />
        </div>
      </div>

      {/* body: empty hint OR one turn (role chip + actions, then the text) */}
      <div className="hud-scroll min-h-[84px] max-h-[240px] overflow-y-auto px-4 py-3.5">
        {!msg ? (
          <div className="flex h-[54px] flex-col items-center justify-center gap-1.5 text-center">
            <div className="text-[13px] text-zenith-lo">
              Hold <span className="text-zenith-cyan">Space</span> to talk, or type below.
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-dim">Conversation · one turn per page</div>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2.5">
              <RoleChip role={msg.role} />
              {msg.role === "assistant" && msg.content
                ? flash
                  ? <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-zenith-cyan">{flash}</span>
                  : (
                    <span className="flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-[0.12em]">
                      <ActBtn onClick={onCopy}>Copy</ActBtn>
                      <ActBtn onClick={onSave}>Save</ActBtn>
                      <ActBtn onClick={onShare}>Share</ActBtn>
                    </span>
                  )
                : null}
            </div>
            {msg.role === "assistant" ? (
              <div className="text-[14px] leading-[1.55] text-zenith-mid">
                <Markdown text={msg.content} />
                {showCaret && <span className="blink text-zenith-cyan">▋</span>}
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-[14px] leading-[1.55] text-zenith-mid">{msg.content}</div>
            )}
          </>
        )}
      </div>

      {(error || warning) && (
        <div className="border-t border-zenith-line px-4 py-2">
          {error && <p className="font-mono text-xs text-zenith-red">{error}</p>}
          {warning && <p className="font-mono text-xs text-zenith-alert">{warning}</p>}
        </div>
      )}

      {/* input row: text · mic · send (v7) */}
      <div className="flex items-center gap-3 border-t border-zenith-line py-2.5 pl-4 pr-2.5">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Zenith…"
          className="min-w-0 flex-1 bg-transparent font-sans text-sm text-zenith-hi outline-none placeholder:text-zenith-dim"
        />
        <button
          type="button"
          onPointerDown={(e) => { e.preventDefault(); onMicDown(); }}
          onPointerUp={onMicUp}
          onPointerLeave={onMicUp}
          title="Hold to talk (or hold Space)"
          aria-label="Hold to talk"
          className={`press flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border transition ${
            listening
              ? "border-zenith-cyan bg-zenith-cyan/15 text-zenith-cyan"
              : "border-zenith-line2 text-zenith-lo hover:border-zenith-cyan hover:text-zenith-cyan"
          }`}
        >
          {listening ? <span className="blink h-2 w-2 rounded-full bg-zenith-cyan" /> : <MicIcon />}
        </button>
        <button
          onClick={onSend}
          disabled={loading || input.trim() === ""}
          aria-label="Send"
          className="press flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full border border-zenith-cyan/30 bg-zenith-cyan/10 text-zenith-cyan transition hover:bg-zenith-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function RoleChip({ role }: { role: "user" | "assistant" }) {
  const isZen = role === "assistant";
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] ${
        isZen ? "border-zenith-cyan/30 bg-zenith-cyan/10 text-zenith-cyan" : "border-zenith-line2 text-zenith-mid"
      }`}
    >
      {isZen ? "Zenith" : "You"}
    </span>
  );
}

function PageBtn({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous turn" : "Next turn"}
      className="press flex h-6 w-6 items-center justify-center rounded-[5px] border border-zenith-line2 text-zenith-cyan transition hover:text-white disabled:cursor-not-allowed disabled:text-zenith-faint"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        {dir === "prev" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
      </svg>
    </button>
  );
}

function ActBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="press text-zenith-lo transition hover:text-zenith-cyan">
      {children}
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}
