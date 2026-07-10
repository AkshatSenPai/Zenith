import { NudgeCard, type Nudge } from "./NudgeCard";

/** The proactive nudge stack, pinned above the Command Center. Renders nothing when empty so it
 *  takes no space; caps its own height and scrolls internally so it never pushes the CC off-screen. */
export function NudgeStack({
  nudges, onAction, onDismiss, onSnooze,
}: {
  nudges: Nudge[];
  onAction: (n: Nudge) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, preset: "evening" | "tomorrow") => void;
}) {
  if (!nudges.length) return null;
  return (
    <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
      {nudges.map((n) => (
        <NudgeCard key={n.id} nudge={n} onAction={onAction} onDismiss={onDismiss} onSnooze={onSnooze} />
      ))}
    </div>
  );
}
