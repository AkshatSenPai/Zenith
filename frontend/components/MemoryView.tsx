"use client";

import { useCallback, useEffect, useState } from "react";
import { getVaultNotes, getVaultNote, type VaultNote } from "../lib/api";
import { Markdown } from "./Markdown";

// "Pinned" has no backend flag — it's just the most-recently-modified notes, hydrated with a real
// preview + [[links]] as the hero cards. The full VAULT grid stays light (the backend note index
// carries no preview/link fields and the backend is untouched, so we don't fetch every note's body
// just for the grid — click a card to read the real note).
const PINNED_COUNT = 3;

function extractLinks(md: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) && out.length < 6) {
    const name = m[1].split("|")[0].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function makePreview(md: string, n = 150): string {
  const text = md
    .replace(/^---[\s\S]*?---/, "") // drop frontmatter
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > n ? `${text.slice(0, n).trimEnd()}…` : text;
}

function relTime(ts: number): string {
  if (!ts) return "";
  const ms = ts < 1e12 ? ts * 1000 : ts; // tolerate seconds or millis
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Pinned = { note: VaultNote; preview: string; links: string[] };

export function MemoryView() {
  const [notes, setNotes] = useState<VaultNote[] | null>(null);
  const [pinned, setPinned] = useState<Pinned[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<{ title: string; content: string } | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setLoaded(false);
    const n = await getVaultNotes(undefined, 40);
    if (n === null) {
      setError(true);
      setLoaded(true);
      return;
    }
    setNotes(n);
    setLoaded(true);
    const hydrated = await Promise.all(
      n.slice(0, PINNED_COUNT).map(async (note) => {
        const c = await getVaultNote(note.path);
        const body = c?.content ?? "";
        return { note, preview: makePreview(body), links: extractLinks(body) } as Pinned;
      }),
    );
    setPinned(hydrated);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (path: string) => {
    setOpenPath(path);
    setReading(true);
    setOpenNote(null);
    const c = await getVaultNote(path);
    setOpenNote(c ? { title: c.title, content: c.content } : { title: "", content: "" });
    setReading(false);
  }, []);

  const count = notes?.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zenith-line px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-zenith-hi">Memory</h2>
          <span className="text-xs text-zenith-lo">Obsidian vault · what Zenith remembers</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-dim">{count} notes</span>
      </header>

      {openPath ? (
        <Reader note={openNote} reading={reading} onBack={() => { setOpenPath(null); setOpenNote(null); }} />
      ) : (
        <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {!loaded ? (
            <GridSkeleton />
          ) : error ? (
            <Unreachable onRetry={() => void load()} />
          ) : count === 0 ? (
            <p className="font-mono text-[11px] text-zenith-lo">Vault is empty — notes you save appear here.</p>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <SectionLabel>Pinned context</SectionLabel>
                  <div className="mb-8 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
                    {pinned.map((p) => (
                      <button
                        key={p.note.path}
                        onClick={() => void open(p.note.path)}
                        className="press rounded-[9px] border border-zenith-cyan/25 bg-zenith-cyan/[0.05] px-4 py-3.5 text-left transition-colors hover:border-zenith-cyan/45"
                      >
                        <div className="mb-1.5 flex items-center gap-2 text-zenith-cyan">
                          <NoteIcon />
                          <span className="text-sm font-semibold text-zenith-hi">{p.note.title}</span>
                        </div>
                        {p.preview && <div className="mb-2.5 line-clamp-2 text-xs leading-relaxed text-zenith-lo">{p.preview}</div>}
                        {p.links.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {p.links.map((l) => (
                              <LinkChip key={l}>{l}</LinkChip>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <SectionLabel>Vault</SectionLabel>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
                {notes!.map((n) => (
                  <button
                    key={n.path}
                    onClick={() => void open(n.path)}
                    className="press rounded-lg border border-zenith-line bg-zenith-panel px-3.5 py-3 text-left transition-colors hover:border-zenith-cyan/35"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-zenith-mid">{n.title}</span>
                      {n.folder && <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-zenith-dim">{n.folder}</span>}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.05em] text-zenith-dim">{relTime(n.modified)}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Reader({ note, reading, onBack }: { note: { title: string; content: string } | null; reading: boolean; onBack: () => void }) {
  return (
    <div className="hud-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <button onClick={onBack} className="press mb-4 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zenith-lo transition hover:text-zenith-cyan">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="15 18 9 12 15 6" /></svg>
        Back to vault
      </button>
      {reading ? (
        <div className="space-y-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-zenith-cyan/[0.08]" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-zenith-cyan/[0.08]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-zenith-cyan/[0.08]" />
        </div>
      ) : note && note.content ? (
        <div className="max-w-[760px]">
          {note.title && <h3 className="mb-4 text-lg font-semibold text-zenith-hi">{note.title}</h3>}
          <div className="font-mono text-sm leading-relaxed text-zenith-mid">
            <Markdown text={note.content} />
          </div>
        </div>
      ) : (
        <p className="font-mono text-[11px] text-zenith-lo">Couldn&apos;t open this note.</p>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-zenith-dim">{children}</div>;
}

function LinkChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[5px] border border-zenith-cyan/20 bg-zenith-cyan/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.02em] text-zenith-cyan">
      [[{children}]]
    </span>
  );
}

function NoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-zenith-cyan/[0.05]" />
      ))}
    </div>
  );
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] text-zenith-lo">Can&apos;t reach the backend.</p>
      <button onClick={onRetry} className="press rounded-sm border border-zenith-cyan/40 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/80 transition hover:border-zenith-cyan/70">
        Retry
      </button>
    </div>
  );
}
