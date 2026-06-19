"use client";

export type View = "chat" | "drafts" | "clients" | "settings";

const ITEMS: { id: View; label: string; icon: React.ReactNode }[] = [
  {
    id: "chat",
    label: "Chat",
    icon: <path d="M4 5h16v10H8l-4 4z" />,
  },
  {
    id: "drafts",
    label: "Drafts",
    icon: <path d="M7 3h7l5 5v13H7zM14 3v5h5" />,
  },
  {
    id: "clients",
    label: "Clients",
    icon: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1.5-5.6M21 20a6 6 0 0 0-5-5.9" />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" /></>,
  },
];

export function ContextRail({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <nav className="relative z-10 flex flex-col items-stretch gap-1 border-r border-zenith-cyan/15 py-3">
      {ITEMS.map((it) => {
        const active = it.id === view;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            title={it.label}
            className={`group relative flex flex-col items-center gap-1 px-2 py-3 transition ${
              active ? "text-zenith-cyan" : "text-zenith-text/45 hover:text-zenith-text/80"
            }`}
          >
            {active && <span className="glow-cyan absolute left-0 top-1/2 h-7 w-0.5 -translate-y-1/2 bg-zenith-cyan" />}
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              {it.icon}
            </svg>
            <span className="font-mono text-[8px] uppercase tracking-widest">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
