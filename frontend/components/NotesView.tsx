"use client";

import { useCallback, useEffect, useState } from "react";
import { getVaultNotes, getVaultNote, type VaultNote } from "../lib/api";
import { Markdown } from "./Markdown";

/** Read-only recent-notes browser (v7): note list (left) + reader (right). A note whose body is
 *  mostly checklist lines renders as read-only task rows (Obsidian/Todos is the editor); anything
 *  else renders as Markdown. Replaces VaultView mode="recent". */
function parseChecklist(md: string): { text: string; done: boolean }[] | null {
  const items: { text: string; done: boolean }[] = [];
  let nonEmpty = 0;
  for (const raw of md.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    nonEmpty++;
    const m = /^-\s*\[([ xX])\]\s+(.*)$/.exec(t);
    if (m) items.push({ text: m[2], done: m[1].toLowerCase() === "x" });
  }
  return items.length >= 2 && items.length >= nonEmpty * 0.6 ? items : null;
}

export function NotesView() {
  const [notes, setNotes] = useState<VaultNote[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<{ found: boolean; title: string; content: string } | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setLoaded(false);
    const n = await getVaultNotes(undefined, 30);
    if (n === null) setError(true);
    else setNotes(n);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (path: string) => {
    setSelected(path);
    setReading(true);
    setNote(null);
    const c = await getVaultNote(path);
    setNote(c ?? { found: false, title: "", content: "" });
    setReading(false);
  }, []);

  const checklist = note && note.content ? parseChecklist(note.content) : null;
  const selMeta = notes?.find((n) => n.path === selected);
  const tag = selMeta?.folder || (checklist ? "checklist" : "note");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zenith-line px-6 py-4">
        <h2 className="text-lg font-semibold text-zenith-hi">Notes</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-dim">recent notes · read-only</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[296px_1fr]">
        {/* list */}
        <div className="hud-scroll min-h-0 overflow-y-auto border-r border-zenith-line p-3">
          {!loaded ? (
            <ListSkeleton />
          ) : error ? (
            <Unreachable onRetry={() => void load()} />
          ) : !notes || notes.length === 0 ? (
            <p className="px-1 py-2 font-mono text-[11px] text-zenith-lo">No notes yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((n) => {
                const active = n.path === selected;
                return (
                  <li key={n.path}>
                    <button
                      onClick={() => void open(n.path)}
                      className={`press w-full rounded-[7px] border px-3 py-2.5 text-left transition-colors ${
                        active ? "border-zenith-cyan/30 bg-zenith-cyan/[0.07]" : "border-transparent hover:bg-zenith-cyan/[0.04]"
                      }`}
                    >
                      <div className={`truncate text-[13px] font-medium leading-snug ${active ? "text-zenith-cyan" : "text-zenith-mid"}`}>{n.title}</div>
                      {n.folder && <div className="mt-1 truncate font-mono text-[8px] uppercase tracking-[0.15em] text-zenith-dim">{n.folder}</div>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* reader */}
        <div className="hud-scroll min-h-0 overflow-y-auto px-7 py-6">
          {!selected ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-zenith-dim">Select a note to read</p>
          ) : reading ? (
            <DetailSkeleton />
          ) : note && !note.found ? (
            <p className="font-mono text-[11px] text-zenith-lo">Couldn&apos;t open this note.</p>
          ) : note ? (
            <div className="max-w-[760px]">
              {note.title && <h3 className="mb-1.5 text-lg font-semibold text-zenith-hi">{note.title}</h3>}
              <div className="mb-5 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-cyan">{tag}</div>
              {checklist ? (
                <div className="flex flex-col gap-2.5">
                  {checklist.map((it, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border ${it.done ? "border-zenith-cyan bg-zenith-cyan/15 text-zenith-cyan" : "border-zenith-line2"}`}>
                        {it.done && <CheckIcon />}
                      </span>
                      <span className={`text-[13px] leading-relaxed ${it.done ? "text-zenith-lo line-through" : "text-zenith-mid"}`}>{it.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-sm leading-relaxed text-zenith-mid">
                  <Markdown text={note.content} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-11 w-full animate-pulse rounded-[7px] bg-zenith-cyan/[0.06]" />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="h-4 w-1/3 animate-pulse rounded bg-zenith-cyan/[0.08]" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-zenith-cyan/[0.06]" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-zenith-cyan/[0.06]" />
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2 px-1 py-2">
      <p className="font-mono text-[11px] text-zenith-lo">Can&apos;t reach the backend.</p>
      <button onClick={onRetry} className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70">
        Retry
      </button>
    </div>
  );
}
