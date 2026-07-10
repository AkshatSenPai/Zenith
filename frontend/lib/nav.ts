// Shared navigation model for the v7 icon-strip router. The center pane swaps full-page views
// keyed by `View`; IconNav and CommandPalette both consume NAV_ITEMS (order = strip order).
export type View = "chat" | "triage" | "memory" | "clients" | "notes" | "settings";

export const NAV_ITEMS: { id: View; label: string }[] = [
  { id: "chat", label: "CHAT" },
  { id: "triage", label: "TRIAGE" },
  { id: "memory", label: "MEMORY" },
  { id: "clients", label: "CLIENTS" },
  { id: "notes", label: "NOTES" },
  { id: "settings", label: "SETTINGS" },
];
