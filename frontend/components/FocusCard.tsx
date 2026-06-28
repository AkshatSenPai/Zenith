"use client";

import { useCallback, useEffect, useState } from "react";
import { getTodos, addTodo, setTodoDone, removeTodo, type Todo } from "../lib/api";
import { CardBrackets } from "./hud/primitives";

/** "Today's Focus" — the owner's to-do list, backed by the vault's Todos.md (GET/POST/PATCH/DELETE
 *  /todos). Editable: check off, remove on hover, add via the input. Re-fetches on window focus so a
 *  to-do Zenith added by voice shows up. Loading / empty / unreachable+Retry states match VaultView. */
export function FocusCard() {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
    <section className="relative z-10 px-4 pb-2 pt-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Today&apos;s Focus</div>
      <div className="panel relative px-3.5 py-3">
        <CardBrackets cls="border-zenith-cyan/25" />

        {!loaded ? (
          <Skeleton />
        ) : error ? (
          <Unreachable onRetry={() => void load()} />
        ) : (
          <>
            {todos && todos.length > 0 ? (
              <ul className="space-y-1.5">
                {todos.map((t) => (
                  <li key={t.index} className="group flex items-start gap-2">
                    <button
                      onClick={() => void apply(setTodoDone(t.index, !t.done))}
                      className="press mt-0.5 flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[3px] border border-zenith-cyan/40"
                      aria-label={t.done ? "Mark not done" : "Mark done"}
                    >
                      {t.done && <span className="h-2 w-2 rounded-[1px] bg-zenith-cyan" />}
                    </button>
                    <span className={`flex-1 font-body text-xs leading-relaxed ${t.done ? "text-zenith-text/35 line-through" : "text-zenith-text/80"}`}>
                      {t.text}
                    </span>
                    <button
                      onClick={() => void apply(removeTodo(t.index))}
                      className="press flex-none font-mono text-zenith-text/0 transition group-hover:text-zenith-text/40 hover:!text-zenith-alert"
                      aria-label="Remove to-do"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-[11px] text-zenith-text/40">No to-dos yet.</p>
            )}

            <div className="mt-2.5 flex items-center gap-2 border-t border-zenith-cyan/10 pt-2.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
                placeholder="add a task…"
                className="flex-1 bg-transparent font-body text-xs text-zenith-text placeholder:text-zenith-text/30 focus:outline-none"
              />
              <button
                onClick={() => void add()}
                disabled={busy || !draft.trim()}
                className="press font-mono text-sm text-zenith-cyan/70 disabled:opacity-30"
                aria-label="Add to-do"
              >
                +
              </button>
            </div>

            {pending > 0 && (
              <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-zenith-alert/80">
                <span className="h-1.5 w-1.5 rounded-full bg-zenith-alert" /> {pending} pending
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-3/4 animate-pulse rounded bg-zenith-cyan/[0.08]" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-zenith-cyan/[0.08]" />
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] text-zenith-text/45">Can&apos;t reach the backend.</p>
      <button
        onClick={onRetry}
        className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70"
      >
        Retry
      </button>
    </div>
  );
}
