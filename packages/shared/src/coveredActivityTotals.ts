/**
 * "Where today went" (owner decision 14 Oct 2026; web #409, iPhone PRD D15): covered time per
 * activity. Where blocks overlap, each moment is split equally among the distinct activities
 * running in it, and two blocks of one activity count that moment once, so the activities add up
 * to the day's covered total (Today's hero on web and iPhone, PRD D14).
 *
 * Web's `coveredActivityTotals` / `whereTodayWentBars` (`apps/web/src/lib/today-view.ts`, #409)
 * and iPhone's strip (`apps/mobile/src/lib/todayWhereWent.ts`) both use this one copy; the tests
 * in `coveredActivityTotals.test.ts` carry #409's fixtures.
 */
export type CoveredActivityEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryColor?: string | null;
};

export type CoveredActivityTotal = {
  /** The activity's id, or "none" for time without an activity. */
  key: string;
  categoryId: string | null;
  name: string;
  color: string | null;
  seconds: number;
};

export type CoveredActivityBar = CoveredActivityTotal & {
  /** On the "Other" bar only: the activities it holds, largest first. */
  includes?: string[];
};

export const COVERED_ACTIVITY_NONE_KEY = "none";
export const COVERED_ACTIVITY_OTHER_KEY = "__other";

/** An entry's time inside [startMs, endMs), a running entry running to now; null when none. */
export function clipCoveredEntry(
  entry: Pick<CoveredActivityEntry, "startedAt" | "stoppedAt">,
  startMs: number,
  endMs: number,
  nowMs: number
): { fromMs: number; toMs: number } | null {
  const started = Date.parse(entry.startedAt);
  const stopped = entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs;
  if (!Number.isFinite(started) || !Number.isFinite(stopped)) return null;
  const fromMs = Math.max(started, startMs);
  const toMs = Math.min(stopped, endMs, nowMs);
  return toMs > fromMs ? { fromMs, toMs } : null;
}

/**
 * Covered time in [startMs, endMs) up to now, in milliseconds: the union of every block, so time
 * that overlapping blocks share counts once and a day never passes its real length (PRD D14). It
 * equals the sum of `coveredActivityTotals`' exact shares; Today's hero and iPhone's "Earlier this
 * week" day totals floor it to seconds.
 */
export function coveredDurationMs(
  entries: readonly Pick<CoveredActivityEntry, "startedAt" | "stoppedAt">[],
  startMs: number,
  endMs: number,
  nowMs: number
) {
  const clips = entries
    .map((entry) => clipCoveredEntry(entry, startMs, endMs, nowMs))
    .filter((clip): clip is { fromMs: number; toMs: number } => clip !== null)
    .sort((a, b) => a.fromMs - b.fromMs);
  let covered = 0;
  let until = Number.NEGATIVE_INFINITY;
  for (const clip of clips) {
    covered += Math.max(0, clip.toMs - Math.max(clip.fromMs, until));
    until = Math.max(until, clip.toMs);
  }
  return covered;
}

/** The bucket an entry's time goes to: its activity, or "No activity". */
export function coveredActivityKey(entry: Pick<CoveredActivityEntry, "categoryId">) {
  return entry.categoryId ?? COVERED_ACTIVITY_NONE_KEY;
}

function activityBucket(entry: CoveredActivityEntry): CoveredActivityTotal {
  return {
    key: coveredActivityKey(entry),
    categoryId: entry.categoryId ?? null,
    name: entry.categoryId ? entry.categoryName?.trim() || "No activity" : "No activity",
    color: entry.categoryId ? entry.categoryColor ?? null : null,
    seconds: 0
  };
}

function byTimeThenName(a: CoveredActivityTotal, b: CoveredActivityTotal) {
  return b.seconds - a.seconds || a.name.localeCompare(b.name);
}

/**
 * Covered time per activity in [startMs, endMs) up to now, largest first (then by name). Between
 * consecutive block boundaries the same activities are running, and that slice is split equally
 * among them in whole milliseconds (the odd ones to the first keys in key order), so the buckets
 * sum exactly to the covered total.
 *
 * Rounding matches the hero's display: the hero floors covered seconds and shows whole minutes,
 * so the buckets get exactly the hero's whole minutes (largest remainder first) and then exactly
 * its leftover seconds (each bucket nearest its exact share first). The seconds therefore sum to
 * the hero's seconds and the displayed minutes sum to the hero's minutes. Buckets with no whole
 * second are left out.
 */
export function coveredActivityTotals(
  entries: readonly CoveredActivityEntry[],
  startMs: number,
  endMs: number,
  nowMs: number
): CoveredActivityTotal[] {
  const buckets = new Map<string, CoveredActivityTotal>();
  const events: Array<{ atMs: number; key: string; delta: 1 | -1 }> = [];
  for (const entry of entries) {
    const clip = clipCoveredEntry(entry, startMs, endMs, nowMs);
    if (!clip) continue;
    const bucket = buckets.get(coveredActivityKey(entry)) ?? activityBucket(entry);
    buckets.set(bucket.key, bucket);
    events.push({ atMs: clip.fromMs, key: bucket.key, delta: 1 }, { atMs: clip.toMs, key: bucket.key, delta: -1 });
  }
  events.sort((a, b) => a.atMs - b.atMs);

  // Sweep the day: between consecutive boundaries the same activities are running.
  const exactMs = new Map<string, number>();
  const running = new Map<string, number>();
  let previousMs = events[0]?.atMs ?? 0;
  for (let index = 0; index < events.length; ) {
    const atMs = events[index].atMs;
    const sliceMs = atMs - previousMs;
    if (sliceMs > 0 && running.size > 0) {
      // Whole milliseconds, the odd ones to the first keys, so the shares sum exactly.
      const keys = [...running.keys()].sort();
      const share = Math.floor(sliceMs / keys.length);
      const extra = sliceMs - share * keys.length;
      keys.forEach((key, position) =>
        exactMs.set(key, (exactMs.get(key) ?? 0) + share + Math.min(1, Math.max(0, extra - position))));
    }
    for (; index < events.length && events[index].atMs === atMs; index += 1) {
      const { key, delta } = events[index];
      const count = (running.get(key) ?? 0) + delta;
      if (count > 0) running.set(key, count);
      else running.delete(key);
    }
    previousMs = atMs;
  }

  const shares = [...exactMs].map(([key, ms]) => ({ key, ms, minutes: Math.floor(ms / 60_000), seconds: 0 }));
  const coveredMs = shares.reduce((sum, share) => sum + share.ms, 0);
  const heroSeconds = Math.floor(coveredMs / 1000);
  const heroMinutes = Math.floor(heroSeconds / 60);
  const order = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

  // Whole minutes: the hero's, the spare ones to the largest remainders.
  let spareMinutes = heroMinutes - shares.reduce((sum, share) => sum + share.minutes, 0);
  for (const share of [...shares].sort((a, b) => (b.ms % 60_000) - (a.ms % 60_000) || b.ms - a.ms || order(a, b))) {
    if (spareMinutes <= 0) break;
    share.minutes += 1;
    spareMinutes -= 1;
  }

  // Leftover seconds (under a minute, so no bucket's minutes change): start from each bucket's
  // whole seconds past its minutes, then move one second at a time toward the exact shares.
  const gapMs = (share: (typeof shares)[number]) => share.ms - share.minutes * 60_000 - share.seconds * 1000;
  for (const share of shares) share.seconds = Math.min(59, Math.max(0, Math.floor((share.ms - share.minutes * 60_000) / 1000)));
  let spareSeconds = heroSeconds - heroMinutes * 60 - shares.reduce((sum, share) => sum + share.seconds, 0);
  while (spareSeconds !== 0) {
    const adding = spareSeconds > 0;
    const candidates = shares.filter((share) => (adding ? share.seconds < 59 : share.seconds > 0));
    if (!candidates.length) break;
    const pick = candidates.reduce((best, share) => {
      const difference = gapMs(share) - gapMs(best);
      return (adding ? difference > 0 : difference < 0) || (difference === 0 && order(share, best) < 0) ? share : best;
    });
    pick.seconds += adding ? 1 : -1;
    spareSeconds += adding ? -1 : 1;
  }

  return shares
    .map((share) => ({ ...buckets.get(share.key)!, seconds: share.minutes * 60 + share.seconds }))
    .filter((total) => total.seconds > 0)
    .sort(byTimeThenName);
}

/**
 * The bars a "Where today went" surface draws: every activity when there are `limit` or fewer;
 * otherwise the top `limit - 1` and a neutral "Other" bar, always last, holding the rest, so the
 * bars still add up to the covered total. Web draws five (top four + Other); iPhone draws four
 * (top three + Other).
 */
export function coveredActivityBars(totals: readonly CoveredActivityTotal[], limit: number): CoveredActivityBar[] {
  if (totals.length <= limit) return [...totals];
  const shown = totals.slice(0, Math.max(0, limit - 1));
  const rest = totals.slice(Math.max(0, limit - 1));
  return [
    ...shown,
    {
      key: COVERED_ACTIVITY_OTHER_KEY,
      categoryId: null,
      name: "Other",
      color: null,
      seconds: rest.reduce((sum, total) => sum + total.seconds, 0),
      includes: rest.map((total) => total.name)
    }
  ];
}
