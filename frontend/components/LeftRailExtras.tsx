"use client";

// Fills the left rail below Usage: a compact Shortcuts card, a spacer, and a pinned
// status footer — so the column reads as intentional all the way down.
export function LeftRailExtras() {
  return (
    <>
      <section className="relative z-10 p-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Shortcuts</div>
        <ul className="space-y-1.5">
          <Row k="Space" v="hold to talk" />
          <Row k="Enter" v="send" />
          <Row k="Zenith" v="wake word · soon" />
        </ul>
      </section>

      {/* spacer pushes the footer to the bottom of the full-height rail */}
      <div className="flex-1" />

      <footer className="relative z-10 flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-zenith-text/50">
          <span className="blink glow-cyan h-1.5 w-1.5 rounded-full bg-zenith-cyan" />
          Claude Sonnet 4.6
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-zenith-text/30">ready</span>
      </footer>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-center justify-between font-mono text-[10px]">
      <span className="rounded-sm border border-zenith-cyan/20 px-1.5 py-0.5 tracking-widest text-zenith-cyan/70">{k}</span>
      <span className="text-zenith-text/45">{v}</span>
    </li>
  );
}
