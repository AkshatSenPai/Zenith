"use client";

import { focus } from "../lib/mock";
import { CardBrackets } from "./hud/primitives";

export function FocusCard() {
  return (
    <section className="relative z-10 px-4 pb-2 pt-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zenith-cyan/70">Today&apos;s Focus</div>
      <div className="panel panel-hover relative px-3.5 py-3">
        <CardBrackets cls="border-zenith-cyan/25" />
        <p className="font-body text-xs leading-relaxed text-zenith-text/80">{focus.title}</p>
        <div className="mt-2.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-zenith-alert/80">
          <span className="h-1.5 w-1.5 rounded-full bg-zenith-alert" /> {focus.pending} pending
        </div>
      </div>
    </section>
  );
}
