// Mock data for the HUD panels (Milestone 2, Pass A). Replaced by real
// integrations in a later milestone — NOT wired to any API.

export type CalEvent = { time: string; title: string };

export const todayEvents: CalEvent[] = [
  { time: "10:00", title: "Client call — Acme redesign" },
  { time: "14:00", title: "SaaS sprint review" },
  { time: "17:30", title: "Papa's channel — edit pass" },
];

export const tomorrowEvents: CalEvent[] = [
  { time: "11:00", title: "Demo — Zenith beta" },
];

export type CommChannel = "Gmail" | "WhatsApp" | "Discord";
export type CommItem = { channel: CommChannel; who: string; preview: string };

export const commCounts: Record<CommChannel, number> = {
  Gmail: 3,
  WhatsApp: 5,
  Discord: 2,
};

export const commItems: CommItem[] = [
  { channel: "WhatsApp", who: "Rahul", preview: "bhai kal aa raha hai?" },
  { channel: "Gmail", who: "Acme Corp", preview: "Re: revised proposal" },
  { channel: "Discord", who: "#dev-team", preview: "deploy looks good 🚀" },
];
