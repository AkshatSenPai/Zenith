// Persisted UI preferences. Currently just the reduced-motion toggle (Settings → Motion).
//
// The flag is mirrored onto <html data-reduce-motion="true"> — set pre-paint by the no-flash
// script in app/layout.tsx so the HUD boots calm with no flash of motion, and toggled at runtime
// by setReduceMotion. CSS reads the attribute (globals.css); the JS-driven motion (the WebGL orb
// + the ambient canvas) re-reads it live via useReducedMotion / the REDUCE_MOTION_EVENT, so a
// toggle calms everything immediately without a reload.

import { useEffect, useState } from "react";

export const REDUCE_MOTION_KEY = "zenith-reduce-motion";
/** Dispatched on `window` whenever the in-app flag flips, so live JS motion can re-read it. */
export const REDUCE_MOTION_EVENT = "zenith:reduce-motion";

/** The persisted in-app reduced-motion flag (independent of the OS setting). */
export function getReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(REDUCE_MOTION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the in-app reduced-motion flag, mirror it onto <html data-reduce-motion>, and notify
 *  live listeners (orb / ambient field) so they calm immediately. */
export function setReduceMotion(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable (private mode / quota) — the attribute below still applies this session.
  }
  if (on) document.documentElement.dataset.reduceMotion = "true";
  else delete document.documentElement.dataset.reduceMotion;
  window.dispatchEvent(new Event(REDUCE_MOTION_EVENT));
}

/** True when motion should be reduced right now: the in-app toggle OR the OS setting. */
export function reduceMotionActive(): boolean {
  if (typeof window === "undefined") return false;
  const os = !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return os || getReduceMotion();
}

/** Reactive `reduceMotionActive()` — re-renders when the in-app toggle flips or the OS setting
 *  changes. Use in client components that drive JS motion (e.g. the orb). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches || getReduceMotion());
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener(REDUCE_MOTION_EVENT, sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener(REDUCE_MOTION_EVENT, sync);
    };
  }, []);
  return reduced;
}
