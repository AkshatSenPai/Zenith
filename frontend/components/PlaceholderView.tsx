"use client";

type Spec = { title: string; milestone: string; blurb: string };

const SPECS: Record<string, Spec> = {
  drafts: {
    title: "Drafts",
    milestone: "Milestone 6",
    blurb: "Copy Factory — email sequences, WhatsApp templates, ad copy and landing copy drafted in your voice from one client brief.",
  },
  clients: {
    title: "Clients",
    milestone: "Milestone 6",
    blurb: "Client vault — notes, briefs, and decisions in a local Markdown vault that Zenith can search and write back to.",
  },
  settings: {
    title: "Settings",
    milestone: "Milestone 5",
    blurb: "Connections, voice, model and the usage / kill-switch budget — all configurable here.",
  },
  memory: {
    title: "Memory",
    milestone: "Milestone 6",
    blurb: "Your Obsidian vault — pinned context, notes and [[links]] that Zenith remembers and writes back to.",
  },
};

export function PlaceholderView({ view }: { view: string }) {
  const spec = SPECS[view];
  if (!spec) return null;
  return (
    <div className="relative flex h-full items-center justify-center p-8">
      <div className="hud-card hud-card-border max-w-md px-8 py-10 text-center">
        <div className="mb-3 inline-block rounded border border-zenith-cyan/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-zenith-cyan/70">
          {spec.milestone}
        </div>
        <h2 className="mb-2 font-mono text-xl uppercase tracking-[0.2em] text-zenith-cyan">{spec.title}</h2>
        <p className="font-body text-sm leading-relaxed text-zenith-text/55">{spec.blurb}</p>
        <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-zenith-text/30">Not built yet — coming soon</p>
      </div>
    </div>
  );
}
