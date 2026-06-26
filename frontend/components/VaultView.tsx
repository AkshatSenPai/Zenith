"use client";

import { useCallback, useEffect, useState } from "react";
import { getVaultNotes, getVaultNote, type VaultNote } from "../lib/api";
import { Markdown } from "./Markdown";

/** Read-only memory-vault browser for the rail's Drafts/Clients tabs: a note list (left) + a
 *  reader (right). NOT an editor — Obsidian is the editor. mode="clients" lists the clients/
 *  folder; mode="recent" lists the newest notes across the vault. Fully themed (zenith-* tokens),
 *  with loading / empty / "can't reach backend" + Retry states (mirrors UsagePanel/SettingsView). */
export function VaultView({ mode, title }: { mode: "clients" | "recent"; title: string }) {
  const [notes, setNotes] = useState<VaultNote[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<{ found: boolean; content: string } | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const n = mode === "clients" ? await getVaultNotes("clients") : await getVaultNotes(undefined, 30);
    if (n === null) setError(true);
    else setNotes(n);
    setLoaded(true);
  }, [mode]);

  useEffect(() => {
    setNotes(null);
    setLoaded(false);
    setSelected(null);
    setContent(null);
    void load();
  }, [load]);

  const open = useCallback(async (path: string) => {
    setSelected(path);
    setReading(true);
    setContent(null);
    const c = await getVaultNote(path);
    setContent(c ? { found: c.found, content: c.content } : { found: false, content: "" });
    setReading(false);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-zenith-cyan/12 px-5 py-3">
        <h2 className="font-display text-lg font-semibold tracking-wide text-zenith-text">{title}</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zenith-text/40">
          {mode === "clients" ? "clients/" : "recent notes"} · read-only
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(200px,280px)_1fr]">
        {/* note list */}
        <div className="hud-scroll min-h-0 overflow-y-auto border-r border-zenith-cyan/12 p-3">
          {!loaded ? (
            <ListSkeleton />
          ) : error ? (
            <Unreachable onRetry={() => void load()} />
          ) : !notes || notes.length === 0 ? (
            <p className="px-1 py-2 font-mono text-[11px] text-zenith-text/40">
              {mode === "clients" ? "No client notes yet." : "No notes yet."}
            </p>
          ) : (
            <ul className="space-y-1">
              {notes.map((n) => {
                const active = n.path === selected;
                return (
                  <li key={n.path}>
                    <button
                      onClick={() => void open(n.path)}
                      className={`press w-full rounded px-2.5 py-2 text-left transition-colors ${
                        active ? "bg-zenith-cyan/10 text-zenith-cyan" : "text-zenith-text/80 hover:bg-zenith-cyan/[0.05]"
                      }`}
                    >
                      <div className="truncate font-body text-sm">{n.title}</div>
                      {n.folder && (
                        <div className="truncate font-mono text-[9px] uppercase tracking-widest text-zenith-text/35">
                          {n.folder}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* reader */}
        <div className="hud-scroll min-h-0 overflow-y-auto p-6">
          {!selected ? (
            <p className="font-mono text-[11px] uppercase tracking-widest text-zenith-text/30">
              Select a note to read
            </p>
          ) : reading ? (
            <div className="space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-zenith-cyan/[0.08]" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-zenith-cyan/[0.08]" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-zenith-cyan/[0.08]" />
            </div>
          ) : content && !content.found ? (
            <p className="font-mono text-[11px] text-zenith-text/40">Couldn&apos;t open this note.</p>
          ) : content ? (
            <div className="font-mono text-sm leading-relaxed text-zenith-text">
              <Markdown text={content.content} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-8 w-full animate-pulse rounded bg-zenith-cyan/[0.06]" />
      ))}
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2 px-1 py-2">
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
