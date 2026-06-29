"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NAV_ITEMS, type View } from "../lib/nav";
import { getVaultNotes, type VaultNote } from "../lib/api";

type Group = "NAV" | "ACTION" | "VAULT";
type Command = { id: string; label: string; sub?: string; group: Group; run: () => void };

// Action ids map to page.tsx's onAction (briefing runs; the rest prefill the Command Center).
const ACTIONS: { id: string; label: string; sub: string }[] = [
  { id: "briefing", label: "Run briefing", sub: "Events · unread · weather, spoken" },
  { id: "email", label: "Draft an email", sub: "Prefill the Command Center" },
  { id: "proposal", label: "Draft a proposal", sub: "Prefill the Command Center" },
  { id: "event", label: "Add a calendar event", sub: "Prefill the Command Center" },
  { id: "note", label: "Log a note", sub: "Prefill the Command Center" },
];

const title = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

/** ⌘K command palette — search + grouped results (NAV / ACTION / VAULT). NAV switches views,
 *  ACTION runs/prefills via the parent, VAULT (recent notes, fetched on open) jumps to the
 *  Notes/Clients view. Keyboard: ↑/↓ move, Enter run, ESC close; backdrop click closes. */
export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (v: View) => void;
  onAction: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // On open: reset, focus the input, and fetch recent vault notes for the VAULT group.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    let cancelled = false;
    void getVaultNotes(undefined, 30).then((n) => {
      if (!cancelled && n) setNotes(n);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV_ITEMS.map((it) => ({
      id: `nav-${it.id}`,
      label: title(it.label),
      sub: "Go to view",
      group: "NAV",
      run: () => onNavigate(it.id),
    }));
    const actions: Command[] = ACTIONS.map((a) => ({
      id: `act-${a.id}`,
      label: a.label,
      sub: a.sub,
      group: "ACTION",
      run: () => onAction(a.id),
    }));
    const vault: Command[] = notes.map((n) => ({
      id: `vault-${n.path}`,
      label: n.title,
      sub: n.folder || "note",
      group: "VAULT",
      run: () => onNavigate(n.folder === "clients" ? "clients" : "notes"),
    }));
    return [...nav, ...actions, ...vault];
  }, [notes, onNavigate, onAction]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.sub ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  // keep the selection in range as the list filters, and scroll it into view
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      cmd.run();
      onClose();
    },
    [onClose],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-[22] flex items-start justify-center bg-black/50 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[90%] overflow-hidden rounded-xl border border-zenith-line2 bg-zenith-bg shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-center gap-3 border-b border-zenith-line px-4 py-3">
          <span className="text-zenith-lo">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search notes, clients, commands…"
            aria-label="Command palette search"
            className="min-w-0 flex-1 bg-transparent font-sans text-[15px] text-zenith-hi outline-none placeholder:text-zenith-dim"
          />
          <span className="rounded border border-zenith-line2 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-zenith-dim">ESC</span>
        </div>

        <div className="hud-scroll max-h-[344px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="p-5 text-center text-xs text-zenith-dim">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                ref={i === active ? activeRef : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={`flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-left transition-colors ${
                  i === active ? "bg-zenith-cyan/[0.08]" : ""
                }`}
              >
                <span className="flex-none text-zenith-cyan">
                  <GroupIcon group={c.group} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-zenith-hi">{c.label}</span>
                  {c.sub && <span className="block truncate text-[10px] text-zenith-lo">{c.sub}</span>}
                </span>
                <span className="font-mono text-[8px] tracking-wide text-zenith-dim">{c.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function GroupIcon({ group }: { group: Group }) {
  if (group === "NAV") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  }
  if (group === "ACTION") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
