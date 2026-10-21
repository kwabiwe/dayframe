import type { DayframeActivityIconKey } from "./icons";
import type { DayframePaletteKey } from "./palette";

// The activities every new workspace starts with. `starterKey` is stored on the category so
// Health and Location can still find Sleep or Commute after someone renames it. Every starter
// counts toward the daily goal except Sleep (owner decision UIA-043, 11 Oct 2026).
export const DAYFRAME_STARTER_ACTIVITIES = [
  { starterKey: "work", name: "Work", color: "blue", icon: "work", isPinned: true, countsTowardGoal: true },
  { starterKey: "admin", name: "Admin", color: "steel", icon: "admin", isPinned: true, countsTowardGoal: true },
  { starterKey: "learning", name: "Learning", color: "amber", icon: "learning", isPinned: true, countsTowardGoal: true },
  { starterKey: "exercise", name: "Exercise", color: "red", icon: "gym", isPinned: true, countsTowardGoal: true },
  { starterKey: "walk", name: "Walk", color: "lime", icon: "walk", isPinned: false, countsTowardGoal: true },
  { starterKey: "sleep", name: "Sleep", color: "blue-bold", icon: "sleep", isPinned: false, countsTowardGoal: false },
  { starterKey: "mindfulness", name: "Mindfulness", color: "teal", icon: "mindfulness", isPinned: false, countsTowardGoal: true },
  { starterKey: "meals", name: "Meals", color: "orange", icon: "meals", isPinned: false, countsTowardGoal: true },
  { starterKey: "chores", name: "Chores", color: "moss", icon: "chores", isPinned: false, countsTowardGoal: true },
  { starterKey: "errands", name: "Errands", color: "chartreuse", icon: "errands", isPinned: false, countsTowardGoal: true },
  { starterKey: "personal", name: "Personal", color: "sky", icon: "personal", isPinned: true, countsTowardGoal: true },
  { starterKey: "hobbies", name: "Hobbies", color: "purple", icon: "hobbies", isPinned: false, countsTowardGoal: true },
  { starterKey: "family", name: "Family", color: "rose", icon: "family", isPinned: false, countsTowardGoal: true },
  { starterKey: "social", name: "Social", color: "magenta", icon: "social", isPinned: false, countsTowardGoal: true },
  { starterKey: "commute", name: "Commute", color: "graphite", icon: "commute", isPinned: false, countsTowardGoal: true },
  // "Getting around" (owner, 20 Oct 2026; was "Travel"): every Move that is not Home ↔ Work. The
  // key stays `travel`, so workspaces that already have it keep finding it.
  { starterKey: "travel", name: "Getting around", color: "rust", icon: "journey", isPinned: false, countsTowardGoal: true }
] as const satisfies ReadonlyArray<{
  starterKey: string;
  name: string;
  color: DayframePaletteKey;
  icon: DayframeActivityIconKey;
  isPinned: boolean;
  countsTowardGoal: boolean;
}>;

export type DayframeStarterActivity = (typeof DAYFRAME_STARTER_ACTIVITIES)[number];
export type DayframeStarterActivityKey = DayframeStarterActivity["starterKey"];

const STARTER_BY_KEY = new Map<string, DayframeStarterActivity>(
  DAYFRAME_STARTER_ACTIVITIES.map((starter) => [starter.starterKey, starter])
);

export function isStarterActivityKey(value: unknown): value is DayframeStarterActivityKey {
  return typeof value === "string" && STARTER_BY_KEY.has(value);
}

export function starterActivityByKey(key: DayframeStarterActivityKey): DayframeStarterActivity {
  return STARTER_BY_KEY.get(key)!;
}
