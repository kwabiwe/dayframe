// Blocks parity step 6b-1: Settings › Activities. Activities are grouped the way the All
// activities picker groups them (your own first, then by icon group), pinning is capped at the
// quick-start mosaic's six tiles, and the editor checks names the way the server does.
import { activityPickerSections, type ChoosableActivity } from "./activityChoice";
import { QUICK_START_MOSAIC, weeklySecondsByActivity } from "./quickStartMosaic";

export const QUICK_START_PIN_LIMIT = QUICK_START_MOSAIC.maxTiles;

export function activitiesPageGroups<T extends ChoosableActivity>(activities: readonly T[]) {
  return activityPickerSections(activities, "", []).map((section) => ({
    key: section.key,
    title: section.title ?? "",
    rows: section.rows
  }));
}

/** Whether pinning one more activity would go past quick start's six tiles. */
export function pinLimitReached(activities: readonly { id: string; isPinned?: boolean }[], activityId: string) {
  const target = activities.find((activity) => activity.id === activityId);
  if (!target || target.isPinned) return false;
  return activities.filter((activity) => activity.isPinned).length >= QUICK_START_PIN_LIMIT;
}

/** The editor's name problem, if any: empty, or the same name (any case) as another activity. */
export function activityNameProblem(
  activities: readonly { id: string; name: string }[],
  name: string,
  editingId: string | null
) {
  const trimmed = name.trim();
  if (!trimmed) return "Give the activity a name.";
  const lower = trimmed.toLocaleLowerCase();
  if (activities.some((activity) => activity.id !== editingId && activity.name.trim().toLocaleLowerCase() === lower)) {
    return `${trimmed} already exists.`;
  }
  return null;
}

type WeekEntry = { id: string; categoryId: string | null; startedAt: string; stoppedAt: string | null };

/**
 * Completed time per activity over the last seven days, from every entry list the bootstrap
 * carries (as Today's quick start does), each entry counted once and moments still to review
 * left out.
 */
export function activityWeekSeconds<E extends WeekEntry>(
  lists: readonly (readonly E[] | null | undefined)[],
  nowMs: number,
  isStillToReview: (entry: E) => boolean
) {
  const byId = new Map<string, E>();
  for (const list of lists) for (const entry of list ?? []) byId.set(entry.id, entry);
  return weeklySecondsByActivity([...byId.values()].filter((entry) => !isStillToReview(entry)), nowMs);
}

/** "2h 30m in the last 7 days", or a plain line when the activity wasn't used. */
export function formatActivityWeek(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "Not used in the last 7 days";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const amount = hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
  return `${amount} in the last 7 days`;
}
