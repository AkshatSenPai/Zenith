// Typed fetch helpers for the Milestone 3 Google integration (status / connect / disconnect),
// live calendar events, and the real activity log. All fail soft (return null / {ok:false}) so
// the HUD degrades to a "Connect Google" / offline state instead of throwing.

import type { ActivityEntry } from "./mock";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010";
const TOKEN = process.env.NEXT_PUBLIC_ZENITH_API_TOKEN ?? "";

/**
 * Single backend fetch wrapper. Resolves a path against API_URL and attaches the shared-secret
 * header (X-Zenith-Token) on every request, so the whole HUD authenticates uniformly. It never sets
 * Content-Type itself, so FormData (multipart /transcribe) keeps its auto-generated boundary. Pass
 * an absolute URL to bypass the API_URL prefix. The token is omitted when unset (backend fail-open).
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (TOKEN) headers.set("X-Zenith-Token", TOKEN);
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  return fetch(url, { ...init, headers });
}

/** Whether the desktop background watcher may fire OS notifications. Default true / on any error. */
export async function getProactiveAlerts(): Promise<boolean> {
  try {
    const r = await apiFetch("/proactive");
    const d = await r.json();
    return d.alerts_enabled !== false;
  } catch {
    return true;
  }
}

/** Toggle background alerts (persisted server-side; the Rust watcher reads it from /proactive). */
export async function setProactiveAlerts(enabled: boolean): Promise<void> {
  try {
    await apiFetch("/proactive/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    /* ignore */
  }
}

export type GoogleAccount = { email: string; needs_reconnect: boolean };
export type GoogleStatus = {
  gmail_connected: boolean;
  calendar_connected: boolean;
  accounts: GoogleAccount[];
  connecting: boolean;
  last_error: string | null;
  configured: boolean;
};

export async function getGoogleStatus(): Promise<GoogleStatus | null> {
  try {
    const res = await apiFetch("/google/status");
    return res.ok ? ((await res.json()) as GoogleStatus) : null;
  } catch {
    return null; // backend offline → treated as disconnected
  }
}

export async function connectGoogle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch("/google/connect", { method: "POST" });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      return { ok: false, error: d.detail ?? `Connect failed (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Can't reach Zenith's backend on :8010." };
  }
}

export async function disconnectGoogle(email?: string): Promise<void> {
  try {
    await apiFetch("/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email ?? null }),
    });
  } catch {
    /* ignore — the next status poll reflects reality */
  }
}

export type ApiCalEvent = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  all_day: boolean;
  location: string | null;
  attendees: string[];
  html_link: string | null;
};
export type CalendarResponse = { connected: boolean; events: ApiCalEvent[] };

/** when = today | tomorrow | YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD. null = backend unreachable. */
export async function getCalendarEvents(when = "today"): Promise<CalendarResponse | null> {
  try {
    const res = await apiFetch(`/calendar/events?when=${encodeURIComponent(when)}`);
    return res.ok ? ((await res.json()) as CalendarResponse) : null;
  } catch {
    return null;
  }
}

export type Usage = {
  requests_today: number;
  daily_request_cap: number;
  requests_last_minute: number;
  per_minute_cap: number;
  tokens_today: number;
  daily_token_budget: number;
  input_tokens_today: number;
  output_tokens_today: number;
  cost_usd: number;
  cost_inr: number;
  killswitch: boolean;
};

/** Live usage/cost snapshot for the HUD gauges. null = backend unreachable (drives the error state). */
export async function getUsage(): Promise<Usage | null> {
  try {
    const res = await apiFetch("/usage");
    return res.ok ? ((await res.json()) as Usage) : null;
  } catch {
    return null;
  }
}

export type Health = {
  status: string;
  version: string;
  whisper: {
    language: string;
    model: string;
    device: string;
    compute: string;
    requested_device: string;
    fallback: boolean;
    error: string | null;
  };
  tts: { engine: string; voice: string; lang: string | null; device: string };
  config: { debug_logs: boolean; auth_enforced: boolean };
};

/** Active backend config for the Settings page (STT/TTS device + security posture). null = unreachable. */
export async function getHealth(): Promise<Health | null> {
  try {
    const res = await apiFetch("/health");
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export type VaultNote = { path: string; title: string; folder: string; modified: number };

/** Vault note index for the HUD Drafts/Clients tabs. null = backend unreachable; [] = none yet. */
export async function getVaultNotes(folder?: string, recent?: number): Promise<VaultNote[] | null> {
  try {
    const qs = new URLSearchParams();
    if (folder) qs.set("folder", folder);
    if (recent) qs.set("recent", String(recent));
    const res = await apiFetch(`/vault/notes?${qs.toString()}`);
    if (!res.ok) return null;
    return ((await res.json()).notes ?? []) as VaultNote[];
  } catch {
    return null;
  }
}

/** Full content of one vault note (read-only). null = backend unreachable. */
export async function getVaultNote(path: string): Promise<{ found: boolean; title: string; content: string } | null> {
  try {
    const res = await apiFetch(`/vault/note?path=${encodeURIComponent(path)}`);
    return res.ok ? ((await res.json()) as { found: boolean; title: string; content: string }) : null;
  } catch {
    return null;
  }
}

/** Recent tool activity (newest first). null = backend unreachable; [] = nothing logged yet. */
export async function getActivity(): Promise<ActivityEntry[] | null> {
  try {
    const res = await apiFetch("/activity");
    if (!res.ok) return null;
    const d = (await res.json()) as { entries?: ActivityEntry[] };
    return d.entries ?? [];
  } catch {
    return null;
  }
}

export type DiscordGuild = { id: string; name: string; channels: number };
export type DiscordStatus = {
  connected: boolean;
  configured: boolean;
  bot_user: string | null;
  guilds: DiscordGuild[];
  connecting: boolean;
  last_error: string | null;
};

/** Discord bot status (server channels only; token-based, auto-connects). null = backend unreachable. */
export async function getDiscordStatus(): Promise<DiscordStatus | null> {
  try {
    const res = await apiFetch("/discord/status");
    return res.ok ? ((await res.json()) as DiscordStatus) : null;
  } catch {
    return null;
  }
}

export type TelegramStatus = {
  connected: boolean;
  configured: boolean;
  bot_user: string | null;
  allowed_count: number;
  last_error: string | null;
};

/** Telegram remote bot status (locked to an allow-list). null = backend unreachable. */
export async function getTelegramStatus(): Promise<TelegramStatus | null> {
  try {
    const res = await apiFetch("/telegram/status");
    return res.ok ? ((await res.json()) as TelegramStatus) : null;
  } catch {
    return null;
  }
}

export type NotionStatus = {
  connected: boolean;
  configured: boolean;
  workspace: string | null;
  last_error: string | null;
};

/** Notion integration status (internal-integration token; Connections row only, no orb node). */
export async function getNotionStatus(): Promise<NotionStatus | null> {
  try {
    const res = await apiFetch("/notion/status");
    return res.ok ? ((await res.json()) as NotionStatus) : null;
  } catch {
    return null;
  }
}

export type Todo = { index: number; text: string; done: boolean };

/** The owner's to-do list. null = backend unreachable; [] = none yet. */
export async function getTodos(): Promise<Todo[] | null> {
  try {
    const res = await apiFetch("/todos");
    if (!res.ok) return null;
    return ((await res.json()).todos ?? []) as Todo[];
  } catch {
    return null;
  }
}

async function mutateTodos(path: string, init: RequestInit): Promise<Todo[] | null> {
  try {
    const res = await apiFetch(path, init);
    if (!res.ok) return null;
    return ((await res.json()).todos ?? []) as Todo[];
  } catch {
    return null;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function addTodo(text: string): Promise<Todo[] | null> {
  return mutateTodos("/todos", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ text }) });
}

export function setTodoDone(index: number, done: boolean): Promise<Todo[] | null> {
  return mutateTodos(`/todos/${index}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ done }) });
}

export function removeTodo(index: number): Promise<Todo[] | null> {
  return mutateTodos(`/todos/${index}`, { method: "DELETE" });
}

export type WaitingThread = {
  thread_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  snippet: string;
  last_at: string;
  age_hours: number;
  source: string;
  reason?: string; // present only on "no reply needed" (filtered) rows
};

/** Threads waiting on a reply, plus the ones the classifier filtered as no-reply-needed.
 *  null = backend unreachable (distinct from connected:false).
 *  no-store: this list must reflect the inbox right now, so never serve a cached response. */
export async function getTriage(): Promise<
  { connected: boolean; threads: WaitingThread[]; filtered: WaitingThread[] } | null
> {
  try {
    const res = await apiFetch("/triage", { cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      connected?: boolean;
      threads?: WaitingThread[];
      filtered?: WaitingThread[];
    };
    return { connected: d.connected ?? false, threads: d.threads ?? [], filtered: d.filtered ?? [] };
  } catch {
    return null;
  }
}
