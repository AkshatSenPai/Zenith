// Mock data for the HUD panels (Milestone 2). Replaced by real integrations in
// later milestones — NOT wired to any API. One source of truth for connection
// status: both the orb's connection-map and the Connections panel read `connections`.

export type EventCategory = "client" | "internal" | "content";
export type CalEvent = {
  time: string;
  duration: string;
  title: string;
  client: string;
  category: EventCategory;
};

export const categoryColor: Record<EventCategory, string> = {
  client: "bg-zenith-cyan",
  internal: "bg-zenith-blue",
  content: "bg-zenith-alert",
};

export const todayEvents: CalEvent[] = [
  { time: "10:00", duration: "45m", title: "Funnel call — Shadnagar Heights", client: "Shadnagar Heights", category: "client" },
  { time: "13:30", duration: "30m", title: "Ad creative review", client: "Nivaan Realty", category: "client" },
  { time: "17:30", duration: "30m", title: "Papa's channel — edit pass", client: "YouTube", category: "content" },
];

export const tomorrowEvents: CalEvent[] = [
  { time: "11:00", duration: "30m", title: "Demo — Zenith beta", client: "Internal", category: "internal" },
];

export const dayStats = { meetings: 3, unread: 5, drafts: 2 };

export const focus = {
  title: "Send Shadnagar Heights the revised proposal",
  pending: 3,
};

export type QuickAction = { id: string; label: string; milestone: string };
export const quickActions: QuickAction[] = [
  { id: "proposal", label: "Draft proposal", milestone: "M6" },
  { id: "email", label: "New email", milestone: "M3" },
  { id: "event", label: "Add event", milestone: "M3" },
  { id: "note", label: "Log note", milestone: "M6" },
];

// --- Connections (drives the orb nodes AND the Connections panel) ---
// "WhatsApp" is PARKED (unofficial bridge = account-ban risk) — Telegram took its slot. Not deleted:
// to bring WhatsApp back, restore "WhatsApp" here + the ANCHORS slot in OrbScene + /whatsapp status.
export type Channel = "Gmail" | "Calendar" | "Telegram" | "Discord";
export type Connection = { channel: Channel; account: string; connected: boolean };

// Order matters: the orb places nodes in this sequence around the core.
export const connections: Connection[] = [
  { channel: "Gmail", account: "lalpaarth1210@gmail.com", connected: true },
  { channel: "Calendar", account: "Primary", connected: true },
  { channel: "Telegram", account: "Not linked", connected: false }, // takes WhatsApp's slot (parked)
  { channel: "Discord", account: "Not linked", connected: false },
];

// --- Activity log types (entries now come live from the backend /activity endpoint) ---
export type ActivityTone = "ok" | "warn" | "info";
export type ActivityType = "calendar" | "email" | "message" | "draft" | "note" | "warn";
export type ActivityEntry = {
  time: string;
  action: string;
  target?: string;
  tone: ActivityTone;
  type: ActivityType;
};
