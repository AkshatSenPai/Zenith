/** True only inside the Tauri desktop shell. Relies on withGlobalTauri:true in tauri.conf.json,
 *  which injects window.__TAURI__ before app JS runs. Safe (false) in a normal browser + SSR. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

type UnlistenFn = () => void;

/** Subscribe to the Rust-side global-hotkey event (Ctrl+Alt+Z), emitted by the Tauri host on
 *  key-down. No-op outside Tauri. Uses the withGlobalTauri global (window.__TAURI__.event.listen)
 *  so there's no extra npm dependency. Returns a cleanup function. */
export function onVoiceHotkey(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const listen = (window as unknown as {
    __TAURI__?: { event?: { listen?: (e: string, h: () => void) => Promise<UnlistenFn> } };
  }).__TAURI__?.event?.listen;
  if (typeof listen !== "function") return () => {};
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  listen("voice-hotkey", () => cb())
    .then((un) => { if (cancelled) un(); else unlisten = un; })
    .catch(() => {});
  return () => { cancelled = true; if (unlisten) unlisten(); };
}

function tauriInvoke<T>(cmd: string): Promise<T> | null {
  const invoke = (window as unknown as {
    __TAURI__?: { core?: { invoke?: (c: string) => Promise<unknown> } };
  }).__TAURI__?.core?.invoke;
  return typeof invoke === "function" ? (invoke(cmd) as Promise<T>) : null;
}

/** Whether "launch on login" is currently registered. False outside Tauri / on any error. */
export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  try { return (await tauriInvoke<boolean>("plugin:autostart|is_enabled")) ?? false; }
  catch { return false; }
}

/** Enable/disable launch-on-login. No-op outside Tauri; swallows errors. */
export async function setAutostartEnabled(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try { await tauriInvoke<void>(on ? "plugin:autostart|enable" : "plugin:autostart|disable"); }
  catch { /* ignore */ }
}
