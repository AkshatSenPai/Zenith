// Shared GSAP motion config for the HUD, so timings/eases stay consistent and every
// animation can bail out cleanly under `prefers-reduced-motion`.

// power3.out ≈ the CSS --ease-out cubic-bezier(0.23, 1, 0.32, 1) used elsewhere.
export const EASE = "power3.out";
export const EASE_INOUT = "power4.inOut";

export const DUR = {
  label: 0.32, // status-word crossfade
  boot: 0.7, // boot orb fade-in
  dissolve: 0.6, // boot overlay dissolve
} as const;

/** True when the OS asks for reduced motion — callers skip/instant their animations. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
