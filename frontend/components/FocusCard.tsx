"use client";

import { useCallback, useEffect, useState } from "react";
import { getTodos, addTodo, setTodoDone, removeTodo, type Todo } from "../lib/api";
import { useCollapsed, Chevron } from "./CollapsibleSection";

/** v7 "Today's Focus" — the owner's to-do list, backed by the vault's Todos.md (GET/POST/PATCH/DELETE
 *  /todos). Editable (check off, remove on hover, add via input); re-fetches on window focus so a
 *  voice-added to-do appears. Collapsible header. All wiring unchanged. */
export function FocusCard() {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const { open, toggle } = useCollapsed("zenith.collapse.focus", true);

  const load = useCallback(async () => {
    setError(false);
    const t = await getTodos();
    if (t === null) setError(true);
    else setTodos(t);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const apply = useCallback(async (p: Promise<Todo[] | null>) => {
    setBusy(true);
    const t = await p;
    if (t !== null) setTodos(t);
    setBusy(false);
  }, []);

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await apply(addTodo(text));
  }

  const pending = todos?.filter((t) => !t.done).length ?? 0;

  return (
    <section className="border-b border-zenith-line px-[18px] py-3.5">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-dim">Today&apos;s Focus</span>
        <span className="flex items-center gap-2.5">
          <span className="font-mono text-[9px] text-zenith-lo">{pending}</span>
          <Chevron open={open} />
        </span>
      </button>

      {open && (
        <div className="mt-3 rounded-md border border-zenith-line p-3">
          {!loaded ? (
            <Skeleton />
          ) : error ? (
            <Unreachable onRetry={() => void load()} />
          ) : (
            <>
              {todos && todos.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {todos.map((t) => (
                    <li key={t.index} className="group flex items-start gap-2.5 rounded-md border border-zenith-line bg-zenith-panel px-2.5 py-2">
                      <button
                        onClick={() => void apply(setTodoDone(t.index, !t.done))}
                        className="press mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border border-zenith-line2"
                        aria-label={t.done ? "Mark not done" : "Mark done"}
                      >
                        {t.done && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--zenith-cyan))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                      <span className={`flex-1 text-[12px] leading-snug ${t.done ? "text-zenith-dim line-through" : "text-zenith-mid"}`}>
                        {t.text}
                      </span>
                      <button
                        onClick={() => void apply(removeTodo(t.index))}
                        className="press flex-none text-transparent transition group-hover:text-zenith-dim hover:!text-zenith-alert"
                        aria-label="Remove to-do"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zenith-lo">No to-dos yet.</p>
              )}

              <div className="mt-2.5 flex items-center gap-2 rounded-md border border-dashed border-zenith-line2 px-2.5 py-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void add();
                  }}
                  placeholder="add a task…"
                  className="flex-1 bg-transparent text-[12px] text-zenith-mid placeholder:text-zenith-dim focus:outline-none"
                />
                <button
                  onClick={() => void add()}
                  disabled={busy || !draft.trim()}
                  className="press flex h-[22px] w-[22px] flex-none items-center justify-center rounded border border-zenith-cyan/30 bg-zenith-cyan/[0.08] font-mono text-[15px] leading-none text-zenith-cyan disabled:opacity-30"
                  aria-label="Add to-do"
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-3/4 animate-pulse rounded bg-zenith-line2" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-zenith-line2" />
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zenith-lo">Can&apos;t reach the backend.</p>
      <button
        onClick={onRetry}
        className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
      >
        Retry
      </button>
    </div>
  );
}
