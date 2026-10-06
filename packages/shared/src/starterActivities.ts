import type { DayframeActivityIconKey } from "./icons";
import type { DayframePaletteKey } from "./palette";

// The activities every new workspace starts with. `starterKey` is stored on the category so
// Health and Location can still find Sleep or Commute after someone renames it.
export const DAYFRAME_STARTER_ACTIVITIES = [
  { starterKey: "work", name: "Work", color: "blue", icon: "work", isPinned: true },
  { starterKey: "admin", name: "Admin", color: "steel", icon: "admin", isPinned: true },
  { starterKey: "learning", name: "Learning", color: "amber", icon: "learning", isPinned: true },
  { starterKey: "exercise", name: "Exercise", color: "red", icon: "gym", isPinned: true },
  { starterKey: "walk", name: "Walk", color: "lime", icon: "walk", isPinned: false },
  { starterKey: "sleep", name: "Sleep", color: "blue-bold", icon: "sleep", isPinned: false },
  { starterKey: "mindfulness", name: "Mindfulness", color: "teal", icon: "mindfulness", isPinned: false },
  { starterKey: "meals", name: "Meals", color: "orange", icon: "meals", isPinned: false },
  { starterKey: "chores", name: "Chores", color: "moss", icon: "chores", isPinned: false },
  { starterKey: "errands", name: "Errands", color: "chartreuse", icon: "errands", isPinned: false },
  { starterKey: "personal", name: "Personal", color: "sky", icon: "personal", isPinned: true },
  { starterKey: "hobbies", name: "Hobbies", color: "purple", icon: "hobbies", isPinned: false },
  { starterKey: "family", name: "Family", color: "rose", icon: "family", isPinned: false },
  { starterKey: "social", name: "Social", color: "magenta", icon: "social", isPinned: false },
  { starterKey: "commute", name: "Commute", color: "graphite", icon: "commute", isPinned: false },
  { starterKey: "travel", name: "Travel", color: "rust", icon: "travel", isPinned: false }
] as const satisfies ReadonlyArray<{
  starterKey: string;
  name: string;
  color: DayframePaletteKey;
  icon: DayframeActivityIconKey;
  isPinned: boolean;
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
