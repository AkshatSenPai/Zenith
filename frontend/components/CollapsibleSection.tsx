"use client";

import { useEffect, useState } from "react";

// Shared collapse state for the right-rail sections, persisted per storageKey ("1" open / "0" shut).
// Each panel keeps its own rich header (chip / count) and uses this hook + <Chevron/> to self-collapse.
export function useCollapsed(storageKey: string, defaultOpen = true) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === "0") setOpen(false);
    else if (saved === "1") setOpen(true);
  }, [storageKey]);
  const toggle = () =>
    setOpen((o) => {
      localStorage.setItem(storageKey, o ? "0" : "1");
      return !o;
    });
  return { open, toggle };
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`flex text-zenith-lo transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </span>
  );
}
