/** True only inside the Tauri desktop shell. Relies on withGlobalTauri:true in tauri.conf.json,
 *  which injects window.__TAURI__ before app JS runs. Safe (false) in a normal browser + SSR. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}
