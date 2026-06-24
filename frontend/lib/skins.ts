// Skin registry — the three Zenith skins. A skin = a `data-skin` value on <html> that
// selects a CSS-variable block (colors + treatment knobs) in globals.css. See the spec
// docs/superpowers/specs/2026-06-22-zenith-skins-design.md for authoritative values.

export type SkinId = "arc" | "ghost" | "amethyst";

export const DEFAULT_SKIN: SkinId = "arc";
export const SKIN_STORAGE_KEY = "zenith-skin";

// `swatch` drives the Settings picker preview (bg + accent + a sample card surface).
export const SKINS: {
  id: SkinId;
  label: string;
  swatch: { bg: string; accent: string; panel: string };
}[] = [
  { id: "arc", label: "Arc", swatch: { bg: "#000008", accent: "#00ffe5", panel: "#06121a" } },
  { id: "ghost", label: "Ghost", swatch: { bg: "#f7f7f5", accent: "#1a1a1c", panel: "#ffffff" } },
  { id: "amethyst", label: "Amethyst", swatch: { bg: "#07050f", accent: "#b26bff", panel: "#140e26" } },
];

export function isSkinId(v: unknown): v is SkinId {
  return v === "arc" || v === "ghost" || v === "amethyst";
}
