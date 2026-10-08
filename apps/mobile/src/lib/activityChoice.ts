import { DAYFRAME_ACTIVITY_ICON_GROUPS, activityGroupFor } from "@dayframe/shared";

// Choosing an activity in the entry sheet (Blocks prototype quickChips / openActivityPicker):
// a short wrapped row of chips, never scrolled sideways, and everything else one search away.

export type ChoosableActivity = {
  color?: string | null;
  icon?: string | null;
  id: string;
  isPinned: boolean;
  name: string;
};

/** The prototype shows at most seven chips, then "All activities N". */
export const ACTIVITY_CHIP_LIMIT = 7;
/** Recent activities at the top of the picker. */
export const PICKER_RECENT_LIMIT = 5;

type RecentEntry = { categoryId: string | null; startedAt: string };

/** Activities used most recently first (by each one's newest entry), without repeats. */
export function recentActivityIds(entries: readonly RecentEntry[]): string[] {
  const newest = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.categoryId) continue;
    const at = Date.parse(entry.startedAt);
    if (!Number.isFinite(at)) continue;
    if (at > (newest.get(entry.categoryId) ?? Number.NEGATIVE_INFINITY)) newest.set(entry.categoryId, at);
  }
  return [...newest.entries()].sort((left, right) => right[1] - left[1]).map(([id]) => id);
}

/**
 * The chips: the chosen activity, then pinned ones (in the given usage order), then recent ones,
 * without repeats, at most seven. Activities that no longer exist are skipped.
 */
export function activityChips<T extends ChoosableActivity>(
  activities: readonly T[],
  selectedId: string | null,
  recentIds: readonly string[],
  limit = ACTIVITY_CHIP_LIMIT
): T[] {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const chosen: T[] = [];
  const add = (id: string | null | undefined) => {
    if (!id || chosen.length >= limit) return;
    const activity = byId.get(id);
    if (activity && !chosen.includes(activity)) chosen.push(activity);
  };
  add(selectedId);
  for (const activity of activities) if (activity.isPinned) add(activity.id);
  for (const id of recentIds) add(id);
  return chosen;
}

export type PickerSection<T> = { key: string; title: string | null; rows: T[] };

const GROUP_ORDER: ReadonlyArray<{ id: string | null; label: string }> = [
  { id: null, label: "Your own" },
  ...DAYFRAME_ACTIVITY_ICON_GROUPS.map((group) => ({ id: group.id as string, label: group.label })),
];

function byName<T extends ChoosableActivity>(left: T, right: T) {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

/**
 * The picker's list. Without a query: Recent (up to five), then the groups (your own first) in
 * A–Z order. With a query: the activities whose name contains it, best match (earliest) first.
 */
export function activityPickerSections<T extends ChoosableActivity>(
  activities: readonly T[],
  query: string,
  recentIds: readonly string[]
): PickerSection<T>[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle) {
    const hits = activities
      .filter((activity) => activity.name.toLocaleLowerCase().includes(needle))
      .sort((left, right) =>
        left.name.toLocaleLowerCase().indexOf(needle) - right.name.toLocaleLowerCase().indexOf(needle) || byName(left, right)
      );
    return [{ key: "results", rows: hits, title: null }];
  }
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const sections: PickerSection<T>[] = [];
  const recent = recentIds.map((id) => byId.get(id)).filter((activity): activity is T => Boolean(activity)).slice(0, PICKER_RECENT_LIMIT);
  if (recent.length) sections.push({ key: "recent", rows: recent, title: "Recent" });
  for (const group of GROUP_ORDER) {
    const rows = activities.filter((activity) => activityGroupFor({ icon: activity.icon, name: activity.name }) === group.id).sort(byName);
    if (rows.length) sections.push({ key: `group-${group.id ?? "own"}`, rows, title: group.label });
  }
  return sections;
}

/** Whether "Create “q”" is offered: a query that no activity is already called (any case). */
export function canCreateActivity(activities: readonly ChoosableActivity[], query: string) {
  const name = query.trim();
  if (!name) return false;
  const lower = name.toLocaleLowerCase();
  return !activities.some((activity) => activity.name.trim().toLocaleLowerCase() === lower);
}

/** How many wrapped rows a sequence of items of these widths takes in a row of `rowWidth`. */
export function wrappedRowCount(widths: readonly number[], rowWidth: number, gap: number) {
  if (widths.length === 0) return 0;
  let rows = 1;
  let x = 0;
  for (const width of widths) {
    const w = Math.min(width, rowWidth);
    if (x === 0) {
      x = w;
    } else if (x + gap + w <= rowWidth + 0.5) {
      x += gap + w;
    } else {
      rows += 1;
      x = w;
    }
  }
  return rows;
}

/**
 * The largest number of leading chips that, followed by the All-activities pill, wraps into at
 * most `maxRows` rows. The chosen activity (`keepFirst`) is always kept, truncating if it must.
 */
export function chipsThatFit({
  chipWidths,
  gap,
  keepFirst,
  maxRows,
  pillWidth,
  rowWidth,
}: {
  chipWidths: readonly number[];
  gap: number;
  keepFirst: boolean;
  maxRows: number;
  pillWidth: number;
  rowWidth: number;
}) {
  for (let count = chipWidths.length; count > 0; count -= 1) {
    if (wrappedRowCount([...chipWidths.slice(0, count), pillWidth], rowWidth, gap) <= maxRows) return count;
  }
  return keepFirst && chipWidths.length > 0 ? 1 : 0;
}
