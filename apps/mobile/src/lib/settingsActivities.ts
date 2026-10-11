import type { MobileBootstrap } from "./api";

/**
 * Lets Today and Reports pick up an activity saved in Settings › Activities (its name, colour,
 * icon or "Counts toward goal" switch, UIA-043) without waiting for their next bootstrap. Each
 * change takes a sequence number before its request is sent; an answer that lands after a newer
 * change to the same activity was already applied is ignored, so an older response never wins.
 */
export type SavedActivityCategory = MobileBootstrap["categories"][number];
export type SavedActivityEvent = {
  userId: string;
  workspaceId: string;
  category: SavedActivityCategory;
  sequence: number;
};
type SavedActivityListener = (event: SavedActivityEvent) => void;

const listeners = new Set<SavedActivityListener>();
let nextSequence = 0;

/** Taken when an activity change is sent, before its answer can land. */
export function beginSavedActivityChange() {
  nextSequence += 1;
  return nextSequence;
}

export function publishSavedActivity(event: SavedActivityEvent) {
  for (const listener of listeners) listener(event);
}

export function subscribeSavedActivity(listener: SavedActivityListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Applies an acknowledged activity to a bootstrap of the same account and workspace: the activity
 * replaces (or joins) `categories`, and `goalExcludedCategoryIds` follows its switch. Returns the
 * same object when the event belongs elsewhere or is older than one already applied.
 */
export function applySavedActivity(
  data: MobileBootstrap,
  event: SavedActivityEvent,
  applied: Map<string, number>
): MobileBootstrap {
  if (data.user.id !== event.userId || data.workspace.id !== event.workspaceId) return data;
  const key = `${event.userId}:${event.workspaceId}:${event.category.id}`;
  if ((applied.get(key) ?? 0) > event.sequence) return data;
  applied.set(key, event.sequence);
  const { category } = event;
  const categories = data.categories.some((item) => item.id === category.id)
    ? data.categories.map((item) => (item.id === category.id ? { ...item, ...category } : item))
    : [...data.categories, category];
  const excluded = new Set(data.goalExcludedCategoryIds ?? []);
  if (category.countsTowardGoal === false) excluded.add(category.id);
  else if (category.countsTowardGoal === true) excluded.delete(category.id);
  return { ...data, categories, goalExcludedCategoryIds: [...excluded] };
}
