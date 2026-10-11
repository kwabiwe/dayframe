import { DAYFRAME_ACTIVITY_ICON_GROUPS, activityGroupFor } from "@dayframe/shared";
import type { CategoryRow, TimeEntryRow } from "@/lib/queries";

// Web Library › Activities (Blocks parity step 14a-1): activity cards grouped the way the iPhone
// Activities page and the All activities picker group them (your own first, then by icon group),
// with six rolling weeks of time for each card's sparkline. Mirrors apps/mobile/src/lib/activitiesPage.ts.

export const QUICK_START_PIN_LIMIT = 6;
export const SPARK_WEEKS = 6;
const WEEK_MS = 7 * 24 * 3_600_000;

const GROUP_ORDER: ReadonlyArray<{ id: string | null; label: string }> = [
  { id: null, label: "Your own" },
  ...DAYFRAME_ACTIVITY_ICON_GROUPS.map((group) => ({ id: group.id as string, label: group.label }))
];

export type LibraryGroup = { key: string; title: string; ownGroup: boolean; activities: CategoryRow[] };

/** "Your own" always shows (it holds New activity); other groups only when they have activities. */
export function libraryGroups(activities: readonly CategoryRow[]): LibraryGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const rows = activities
      .filter((activity) => activityGroupFor({ icon: activity.icon ?? null, name: activity.name }) === group.id)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    if (!rows.length && group.id !== null) return [];
    return [{ key: `group-${group.id ?? "own"}`, title: group.label, ownGroup: group.id === null, activities: rows }];
  });
}

/** Whether pinning one more activity would go past quick start's six tiles. */
export function pinLimitReached(activities: readonly CategoryRow[], activityId: string) {
  const target = activities.find((activity) => activity.id === activityId);
  if (!target || target.isPinned) return false;
  return activities.filter((activity) => activity.isPinned).length >= QUICK_START_PIN_LIMIT;
}

/** The editor's name problem, if any: empty, or the same name (any case) as another activity. */
export function activityNameProblem(activities: readonly { id: string; name: string }[], name: string, editingId: string | null) {
  const trimmed = name.trim();
  if (!trimmed) return "Give the activity a name.";
  const lower = trimmed.toLocaleLowerCase();
  if (activities.some((activity) => activity.id !== editingId && activity.name.trim().toLocaleLowerCase() === lower)) {
    return `${trimmed} already exists.`;
  }
  return null;
}

/**
 * Seconds per activity in each of the last six rolling weeks (oldest first; the last is "the last
 * 7 days"), from every entry list the bootstrap carries, each entry counted once and clipped to the
 * week. A running entry counts up to now.
 */
export function activityWeeks(lists: readonly (readonly TimeEntryRow[] | null | undefined)[], nowMs: number) {
  const byId = new Map<string, TimeEntryRow>();
  for (const list of lists) for (const entry of list ?? []) if (entry) byId.set(entry.id, entry);
  const start = nowMs - SPARK_WEEKS * WEEK_MS;
  const weeks = new Map<string, number[]>();
  for (const entry of byId.values()) {
    if (!entry.categoryId) continue;
    const from = Math.max(Date.parse(entry.startedAt), start);
    const to = Math.min(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs, nowMs);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const series = weeks.get(entry.categoryId) ?? Array.from({ length: SPARK_WEEKS }, () => 0);
    for (let index = 0; index < SPARK_WEEKS; index += 1) {
      const weekStart = start + index * WEEK_MS;
      const overlap = Math.min(to, weekStart + WEEK_MS) - Math.max(from, weekStart);
      if (overlap > 0) series[index] += overlap / 1000;
    }
    weeks.set(entry.categoryId, series);
  }
  return weeks;
}

/** "2h 30m in the last 7 days", or a plain line when the activity wasn't used. */
export function formatActivityWeek(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "Not used in the last 7 days";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const amount = hours === 0 ? `${rest}m` : rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  return `${amount} in the last 7 days`;
}
