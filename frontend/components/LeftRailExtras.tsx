"use client";

// v7 left-rail tail: a Shortcuts card, a spacer, and a pinned status footer so the column
// reads as intentional all the way down.
export function LeftRailExtras() {
  return (
    <>
      <section className="px-[18px] py-2">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zenith-dim">Shortcuts</div>
        <ul className="flex flex-col gap-2.5">
          <Row k="Space" v="hold to talk" />
          <Row k="⌘K" v="command palette" />
          <Row k="Enter" v="send" />
        </ul>
      </section>

      {/* spacer pushes the footer to the bottom of the full-height rail */}
      <div className="flex-1" />

      <footer className="flex items-center justify-between border-t border-zenith-line px-[18px] py-3">
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-lo">
          <span className="h-1.5 w-1.5 rounded-full bg-zenith-cyan shadow-[0_0_6px_rgb(var(--zenith-cyan)/0.8)]" />
          Claude Sonnet 4.6
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-zenith-dim">ready</span>
      </footer>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-center justify-between">
      <kbd className="rounded border border-b-2 border-zenith-line2 bg-zenith-panel px-2 py-0.5 font-mono text-[10px] text-zenith-mid">{k}</kbd>
      <span className="text-[11px] text-zenith-lo">{v}</span>
    </li>
  );
}
