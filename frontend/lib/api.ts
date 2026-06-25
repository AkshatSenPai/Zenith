// Typed fetch helpers for the Milestone 3 Google integration (status / connect / disconnect),
// live calendar events, and the real activity log. All fail soft (return null / {ok:false}) so
// the HUD degrades to a "Connect Google" / offline state instead of throwing.

import type { ActivityEntry } from "./mock";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
    const res = await fetch(`${API_URL}/google/status`);
    return res.ok ? ((await res.json()) as GoogleStatus) : null;
  } catch {
    return null; // backend offline → treated as disconnected
  }
}

export async function connectGoogle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/google/connect`, { method: "POST" });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { detail?: string };
      return { ok: false, error: d.detail ?? `Connect failed (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Can't reach Zenith's backend on :8000." };
  }
}

export async function disconnectGoogle(email?: string): Promise<void> {
  try {
    await fetch(`${API_URL}/google/disconnect`, {
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
    const res = await fetch(`${API_URL}/calendar/events?when=${encodeURIComponent(when)}`);
    return res.ok ? ((await res.json()) as CalendarResponse) : null;
  } catch {
    return null;
  }
}

/** Recent tool activity (newest first). null = backend unreachable; [] = nothing logged yet. */
export async function getActivity(): Promise<ActivityEntry[] | null> {
  try {
    const res = await fetch(`${API_URL}/activity`);
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
    const res = await fetch(`${API_URL}/discord/status`);
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
    const res = await fetch(`${API_URL}/telegram/status`);
    return res.ok ? ((await res.json()) as TelegramStatus) : null;
  } catch {
    return null;
  }
}
