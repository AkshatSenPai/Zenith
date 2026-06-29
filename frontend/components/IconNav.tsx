"use client";

import type { ReactNode } from "react";
import type { View } from "../lib/nav";
import { NAV_ITEMS } from "../lib/nav";

// v7 left icon strip (74px). One button per nav view; the active item lights the accent and shows
// a glowing left-bar. Drives the center router via onChange. Icons are inline lucide-style SVGs.
const ICONS: Record<View, ReactNode> = {
  chat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  memory: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  clients: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  notes: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
};

export function IconNav({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <nav className="flex w-[74px] flex-none flex-col items-center gap-1.5 border-r border-zenith-line py-[18px]">
      {NAV_ITEMS.map((n) => {
        const active = n.id === view;
        return (
          <button
            key={n.id}
            onClick={() => onChange(n.id)}
            aria-current={active ? "page" : undefined}
            title={n.label}
            className={`relative flex h-[54px] w-[54px] flex-col items-center justify-center gap-1.5 rounded-lg transition-colors ${
              active ? "text-zenith-cyan" : "text-zenith-lo hover:bg-zenith-cyan/[0.06] hover:text-zenith-mid"
            }`}
          >
            <span
              aria-hidden
              className={`absolute left-[-12px] top-1/2 w-0.5 -translate-y-1/2 rounded bg-zenith-cyan transition-all ${
                active ? "h-7 opacity-100 shadow-[0_0_8px_var(--orb-color)]" : "h-0 opacity-0"
              }`}
            />
            {ICONS[n.id]}
            <span className="font-mono text-[8px] tracking-[0.1em]">{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
