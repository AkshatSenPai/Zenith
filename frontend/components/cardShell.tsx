export type Tone = "info" | "alert" | "critical";

export const TONES: Record<Tone, { border: string; text: string; corner: string }> = {
  info: { border: "border-zenith-cyan/40", text: "text-zenith-cyan", corner: "border-zenith-cyan" },
  alert: { border: "border-zenith-alert/55", text: "text-zenith-alert", corner: "border-zenith-alert" },
  critical: { border: "border-zenith-red/60", text: "text-zenith-red", corner: "border-zenith-red" },
};

/** The notched-corner accent shared by the confirm card and proactive nudge cards. */
export function Corner({ pos, cls }: { pos: "tl" | "tr" | "bl" | "br"; cls: string }) {
  const m: Record<string, string> = {
    tl: "left-0 top-0 border-l border-t",
    tr: "right-0 top-0 border-r border-t",
    bl: "bottom-0 left-0 border-b border-l",
    br: "bottom-0 right-0 border-b border-r",
  };
  return <span className={`pointer-events-none absolute h-2.5 w-2.5 ${m[pos]} ${cls}`} />;
}
