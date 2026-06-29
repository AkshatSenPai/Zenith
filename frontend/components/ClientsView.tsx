"use client";

import { useCallback, useEffect, useState } from "react";
import { getVaultNotes, getVaultNote, type VaultNote } from "../lib/api";
import { Markdown } from "./Markdown";

/** Read-only clients browser (v7): client list (left) + client detail (right) — initial avatar +
 *  name, the real client note rendered as Markdown, and LINKED NOTES chips from the note's
 *  [[wikilinks]]. Reads the clients/ folder via /vault/notes (+ /vault/note). Replaces
 *  VaultView mode="clients". No fabricated location/PROJECT/facts — only what the vault stores. */
function extractLinks(md: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) && out.length < 8) {
    const name = m[1].split("|")[0].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function initial(title: string): string {
  const c = title.trim()[0];
  return c ? c.toUpperCase() : "·";
}

export function ClientsView() {
  const [clients, setClients] = useState<VaultNote[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<{ found: boolean; title: string; content: string } | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setLoaded(false);
    const n = await getVaultNotes("clients");
    if (n === null) setError(true);
    else setClients(n);
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

  const selMeta = clients?.find((c) => c.path === selected);
  const links = note && note.content ? extractLinks(note.content) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zenith-line px-6 py-4">
        <h2 className="text-lg font-semibold text-zenith-hi">Clients</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-dim">clients · read-only</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[296px_1fr]">
        {/* client list */}
        <div className="hud-scroll min-h-0 overflow-y-auto border-r border-zenith-line p-3">
          {!loaded ? (
            <ListSkeleton />
          ) : error ? (
            <Unreachable onRetry={() => void load()} />
          ) : !clients || clients.length === 0 ? (
            <p className="px-1 py-2 font-mono text-[11px] text-zenith-lo">No client notes yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {clients.map((c) => {
                const active = c.path === selected;
                return (
                  <li key={c.path}>
                    <button
                      onClick={() => void open(c.path)}
                      className={`press w-full rounded-[7px] border px-3 py-3 text-left transition-colors ${
                        active ? "border-zenith-cyan/30 bg-zenith-cyan/[0.07]" : "border-transparent hover:bg-zenith-cyan/[0.04]"
                      }`}
                    >
                      <div className={`truncate text-[13px] font-medium leading-snug ${active ? "text-zenith-cyan" : "text-zenith-mid"}`}>{c.title}</div>
                      <div className="mt-1 truncate font-mono text-[8px] uppercase tracking-[0.15em] text-zenith-dim">clients/</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* client detail */}
        <div className="hud-scroll min-h-0 overflow-y-auto px-8 py-7">
          {!selected ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-zenith-dim">Select a client to view</p>
          ) : reading ? (
            <DetailSkeleton />
          ) : note && !note.found ? (
            <p className="font-mono text-[11px] text-zenith-lo">Couldn&apos;t open this client note.</p>
          ) : note ? (
            <div className="max-w-[680px]">
              <div className="mb-7 flex items-center gap-4">
                <div className="flex h-12 w-12 flex-none items-center justify-center rounded-[10px] border border-zenith-cyan/30 bg-zenith-cyan/10 font-mono text-xl font-semibold text-zenith-cyan">
                  {initial(note.title || selMeta?.title || "")}
                </div>
                <div className="text-[21px] font-semibold leading-tight text-zenith-hi">{note.title || selMeta?.title}</div>
              </div>

              <div className="font-mono text-sm leading-relaxed text-zenith-mid">
                <Markdown text={note.content} />
              </div>

              {links.length > 0 && (
                <>
                  <div className="mb-2.5 mt-7 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-dim">Linked notes</div>
                  <div className="flex flex-wrap gap-2">
                    {links.map((l) => (
                      <span key={l} className="flex items-center gap-1.5 rounded-md border border-zenith-cyan/30 bg-zenith-cyan/10 px-3 py-1.5 text-xs text-zenith-cyan">
                        <LinkIcon />
                        {l}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 w-full animate-pulse rounded-[7px] bg-zenith-cyan/[0.06]" />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 animate-pulse rounded-[10px] bg-zenith-cyan/[0.08]" />
        <div className="h-5 w-40 animate-pulse rounded bg-zenith-cyan/[0.08]" />
      </div>
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
