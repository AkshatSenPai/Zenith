"use client";

import { SKINS } from "../lib/skins";
import { useSkin } from "./SkinProvider";

/** Settings → Appearance control: three preview cards, one per skin. Click applies instantly and
 *  persists (via SkinProvider). Each preview shows that skin's OWN colors regardless of the active
 *  skin, so you can see what you're picking. The heading/caption are supplied by the Settings
 *  "Appearance" section (v7). emil: press-scale + hover behind a fine-pointer query, transitions on
 *  transform/opacity only. */
export function SkinPicker() {
  const { skin, setSkin } = useSkin();

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {SKINS.map((s) => {
        const active = skin === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            onClick={() => setSkin(s.id)}
            className={`group relative overflow-hidden rounded-lg border p-3 text-left transition-[transform,opacity] duration-200 ease-out active:scale-[0.98] ${
              active
                ? "border-zenith-cyan/60 ring-2 ring-zenith-cyan/50"
                : "border-zenith-line2 opacity-90 hover:opacity-100"
            }`}
          >
            {/* mini HUD preview rendered in the skin's own colors */}
            <div
              className="relative aspect-[16/10] w-full overflow-hidden rounded-md ring-1 ring-black/10"
              style={{ background: s.swatch.bg }}
            >
              <div
                className="absolute left-1/2 top-[42%] h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ background: s.swatch.accent, opacity: 0.9, filter: "blur(0.5px)" }}
              />
              <div className="absolute inset-x-2 bottom-2 h-5 rounded" style={{ background: s.swatch.panel }}>
                <div
                  className="absolute left-1.5 top-1.5 h-1 w-8 rounded-full"
                  style={{ background: s.swatch.accent, opacity: 0.7 }}
                />
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest text-zenith-mid">{s.label}</span>
              {active && (
                <span className="font-mono text-[9px] uppercase tracking-widest text-zenith-cyan">● active</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
