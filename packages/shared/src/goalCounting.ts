/**
 * Which time fills the daily goal (owner decision UIA-043, option c, 11 Oct 2026). Each activity
 * has a "Counts toward goal" switch (`categories.counts_toward_goal`), off for Sleep by default.
 * Time in an activity that does not count still shows as framed time everywhere else (totals,
 * ribbons, reports); only goal progress leaves it out: Today's goal frame on web and iPhone and
 * Reports' days on goal. Time without an activity counts, and so does an activity this list
 * does not know (an older server): only an explicit `false` excludes. Bootstrap's active
 * `categories` leave out archived activities, so it also sends `goalExcludedCategoryIds` (every
 * activity, active or archived, that does not count); `withGoalExclusions` merges the two so an
 * archived Sleep keeps its history out of the goal.
 */
export type GoalCountingCategory = { id: string; countsTowardGoal?: boolean | null };

/**
 * The active activities plus every other activity known not to count (archived ones). An active
 * activity's own flag wins over the list, so a list from an older bootstrap never overrides a
 * switch changed since.
 */
export function withGoalExclusions(
  categories: Iterable<GoalCountingCategory> | null | undefined,
  excludedIds: Iterable<string> | null | undefined
): GoalCountingCategory[] {
  const merged: GoalCountingCategory[] = [...(categories ?? [])];
  const known = new Set(merged.map((category) => category.id));
  for (const id of excludedIds ?? []) {
    if (!known.has(id)) {
      known.add(id);
      merged.push({ id, countsTowardGoal: false });
    }
  }
  return merged;
}

/**
 * Whether a new activity counts toward the goal before anyone touches its switch: everything but
 * Sleep (by name, ignoring case and spaces), as the Sleep starter.
 */
export function defaultCountsTowardGoal(name: string | null | undefined) {
  return (name ?? "").trim().toLocaleLowerCase("en") !== "sleep";
}

/** The ids of the activities whose time does not count toward the goal. */
export function goalExcludedCategoryIds(categories: Iterable<GoalCountingCategory> | null | undefined): Set<string> {
  const excluded = new Set<string>();
  for (const category of categories ?? []) if (category.countsTowardGoal === false) excluded.add(category.id);
  return excluded;
}

/** Whether time in this activity (null or "uncategorized" for none) fills the goal. */
export function categoryCountsTowardGoal(categoryId: string | null | undefined, excluded: ReadonlySet<string>) {
  return !categoryId || !excluded.has(categoryId);
}

/** The entries whose time fills the goal, in their original order. */
export function goalCountingEntries<T extends { categoryId?: string | null }>(
  entries: readonly T[],
  categories: Iterable<GoalCountingCategory> | null | undefined
): T[] {
  const excluded = goalExcludedCategoryIds(categories);
  if (excluded.size === 0) return [...entries];
  return entries.filter((entry) => categoryCountsTowardGoal(entry.categoryId, excluded));
}

/** [activity id or "uncategorized", seconds] pairs. */
type ActivitySeconds = Iterable<readonly [string, number]>;
type GoalCountingActivities = Iterable<GoalCountingCategory> | null | undefined;

/** Seconds that fill the goal, from per-activity seconds. */
export function goalCountingSeconds(perActivity: ActivitySeconds, activities: GoalCountingActivities) {
  const excluded = goalExcludedCategoryIds(activities);
  let total = 0;
  for (const [key, seconds] of perActivity) {
    if (Number.isFinite(seconds) && categoryCountsTowardGoal(key, excluded)) total += seconds;
  }
  return total;
}
