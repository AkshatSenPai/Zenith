"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { CardBrackets } from "./hud/primitives";

export type Message = { role: "user" | "assistant"; content: string };
type Pair = { query?: string; response?: string };

function toPairs(messages: Message[]): Pair[] {
  const pairs: Pair[] = [];
  for (const m of messages) {
    if (m.role === "user") pairs.push({ query: m.content });
    else if (pairs.length && pairs[pairs.length - 1].response === undefined)
      pairs[pairs.length - 1].response = m.content;
    else pairs.push({ response: m.content });
  }
  return pairs;
}

export function CommandCenter({
  messages,
  loading,
  error,
  warning,
  active,
}: {
  messages: Message[];
  loading: boolean;
  error: string | null;
  warning: string | null;
  active: boolean;
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

  function ping(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }

  async function onCopy() {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response);
      ping("copied");
    } catch {
      ping("copy failed");
    }
  }

  function onSave() {
    if (!response) return;
    const blob = new Blob([response], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zenith-response-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    ping("saved .md");
  }

  async function onShare() {
    if (!response) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Zenith", text: response });
        return;
      } catch {
        /* cancelled/unsupported — fall through */
      }
    }
    try {
      await navigator.clipboard.writeText(response);
      ping("copied to share");
    } catch {
      ping("share unavailable");
    }
  }

  return (
    <div
      className="panel relative flex w-full min-h-0 max-w-2xl flex-col transition-[flex-grow] duration-300 ease-out"
      style={{ flexGrow: active ? 1 : 0 }}
    >
      <CardBrackets cls="border-zenith-cyan/30" />

      {/* header */}
      <div className="flex items-center justify-between border-b border-zenith-cyan/12 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-zenith-cyan/70" />
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-zenith-cyan/75">Command Center</span>
        </div>
        {!empty && (
          <span className="font-mono text-[10px] tabular-nums tracking-widest text-zenith-text/40">
            {String(page + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        )}
      </div>

      {/* body */}
      <div className={`hud-scroll min-h-0 flex-1 overflow-y-auto px-5 ${empty ? "py-6" : "py-4"}`}>
        {empty ? (
          <p className="text-center font-mono text-sm text-zenith-text/40">
            Say something to Zenith
            <span className="text-zenith-text/25"> — type, or hold Space</span>
          </p>
        ) : (
          <>
            {cur.query && (
              <div className="mb-3 flex gap-2 font-mono text-xs text-zenith-text/55">
                <span className="text-zenith-cyan/60">&gt;</span>
                <span className="whitespace-pre-wrap">{cur.query}</span>
              </div>
            )}
            {showThinking ? (
              <p className="font-mono text-sm text-zenith-cyan/70">
                Zenith is thinking<span className="blink">_</span>
              </p>
            ) : response ? (
              <div className="font-mono text-sm leading-relaxed text-zenith-text">
                <Markdown text={response} />
              </div>
            ) : (
              <p className="font-mono text-xs text-zenith-text/30">No response on this page.</p>
            )}
          </>
        )}
        {error && <p className="mt-3 font-mono text-xs text-zenith-red">{error}</p>}
        {warning && <p className="mt-3 font-mono text-xs text-zenith-alert">{warning}</p>}
      </div>

      {/* footer — only once there's a conversation */}
      {!empty && (
        <div className="flex items-center justify-between border-t border-zenith-cyan/12 px-4 py-2.5">
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
            <button
              aria-label="Previous response"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0}
              className="press px-1 text-zenith-cyan transition hover:text-white disabled:cursor-not-allowed disabled:text-zenith-text/20"
            >
              ‹
            </button>
            <button
              aria-label="Next response"
              onClick={() => setPage((p) => Math.min(pairs.length - 1, p + 1))}
              disabled={page >= pairs.length - 1}
              className="press px-1 text-zenith-cyan transition hover:text-white disabled:cursor-not-allowed disabled:text-zenith-text/20"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FooterBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="press text-zenith-text/60 transition hover:text-zenith-cyan disabled:cursor-not-allowed disabled:text-zenith-text/20"
    >
      {children}
    </button>
  );
}
