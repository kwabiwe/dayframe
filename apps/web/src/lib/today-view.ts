import { formatDuration, goalCountingEntries, type GoalCountingCategory } from "@dayframe/shared";
import type { ReviewItemRow, TimeEntryRow } from "@/lib/queries";

/**
 * Today on web (Blocks parity step 12a): the pure presentation for the hero, ribbon, "Where
 * today went", the Review card, "This week" and Today's blocks. Day boundaries are the
 * browser's local midnights; everything is clipped to them and to `now`.
 */

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const DEFAULT_DAILY_GOAL_MINUTES = 480;

export type TodayEntry = Pick<
  TimeEntryRow,
  "id" | "startedAt" | "stoppedAt" | "categoryId" | "categoryName" | "categoryColor"
>;

export type ClippedInterval = { fromMs: number; toMs: number };

export function localDayStart(nowMs: number, offsetDays = 0) {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  if (offsetDays) day.setDate(day.getDate() + offsetDays);
  return day.getTime();
}

/** The next local midnight after `dayStartMs` (23, 24 or 25 hours later across DST). */
export function localDayEnd(dayStartMs: number) {
  const next = new Date(dayStartMs);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function clipEntry(
  entry: Pick<TimeEntryRow, "startedAt" | "stoppedAt">,
  startMs: number,
  endMs: number,
  nowMs: number
): ClippedInterval | null {
  const started = Date.parse(entry.startedAt);
  const stopped = entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs;
  if (!Number.isFinite(started) || !Number.isFinite(stopped)) return null;
  const fromMs = Math.max(started, startMs);
  const toMs = Math.min(stopped, endMs, nowMs);
  return toMs > fromMs ? { fromMs, toMs } : null;
}

/**
 * Time that overlapping entries share counts once (covered time, as goals use on iPhone and the
 * old dashboard). Each entry contributes only what no earlier-started entry already covers.
 */
export function coveredPieces<T extends TodayEntry>(entries: readonly T[], startMs: number, endMs: number, nowMs: number) {
  const intervals = entries
    .map((entry) => ({ entry, startedMs: Date.parse(entry.startedAt), clip: clipEntry(entry, startMs, endMs, nowMs) }))
    .filter((item): item is { entry: T; startedMs: number; clip: ClippedInterval } => item.clip !== null)
    .sort((a, b) => a.startedMs - b.startedMs || a.entry.id.localeCompare(b.entry.id));
  const pieces: { entry: T; ms: number }[] = [];
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const { entry, clip } of intervals) {
    const ms = clip.toMs - Math.max(clip.fromMs, coveredUntil);
    if (ms > 0) pieces.push({ entry, ms });
    coveredUntil = Math.max(coveredUntil, clip.toMs);
  }
  return pieces;
}

export type GoalCellSlice = { key: string; color: string | null; name: string; fraction: number; live: boolean };

/**
 * The goal frame (same rules as iPhone's `todayGoalFrame.ts`): one cell per goal hour, filled with
 * covered time in the order it happened. Cells stop at the goal; the total does not. The total is
 * every framed minute; the cells and percent use only time in activities that count toward the
 * goal (`goalCountingEntries`, UIA-043: Sleep does not by default).
 */
export function buildGoalFrame({
  categories,
  entries,
  goalMinutes,
  nowMs
}: {
  /** The workspace's activities with their "Counts toward goal" switch; left out, all time counts. */
  categories?: Iterable<GoalCountingCategory> | null;
  entries: readonly TodayEntry[];
  goalMinutes: number | null | undefined;
  nowMs: number;
}) {
  const minutes = goalMinutes && goalMinutes > 0 ? goalMinutes : DEFAULT_DAILY_GOAL_MINUTES;
  const goalMs = minutes * 60_000;
  const cellCount = Math.max(1, Math.round(minutes / 60));
  const edges = Array.from({ length: cellCount }, (_, index) => Math.round(((index + 1) * goalMs) / cellCount));
  const dayStart = localDayStart(nowMs);
  const dayEnd = localDayEnd(dayStart);
  const totalMs = coveredPieces(entries, dayStart, dayEnd, nowMs).reduce((sum, piece) => sum + piece.ms, 0);
  const pieces = coveredPieces(goalCountingEntries(entries, categories), dayStart, dayEnd, nowMs);
  const goalCountedMs = pieces.reduce((sum, piece) => sum + piece.ms, 0);
  const cells: GoalCellSlice[][] = Array.from({ length: cellCount }, () => []);
  let cursor = 0;
  let index = 0;
  for (const { entry, ms } of pieces) {
    let remaining = ms;
    while (remaining > 0 && cursor < goalMs) {
      while (index < cellCount - 1 && cursor >= edges[index]) index += 1;
      const cellStart = index === 0 ? 0 : edges[index - 1];
      const take = Math.min(edges[index] - cursor, remaining);
      if (take <= 0) break;
      cells[index].push({
        key: `${entry.id}:${index}`,
        color: entry.categoryId ? entry.categoryColor ?? null : null,
        name: entry.categoryName ?? "",
        fraction: take / (edges[index] - cellStart),
        live: !entry.stoppedAt
      });
      cursor += take;
      remaining -= take;
    }
  }
  return {
    cells,
    goalMinutes: minutes,
    /** Framed time that fills the goal (all of it unless an activity is switched off). */
    goalSeconds: Math.floor(goalCountedMs / 1000),
    percent: Math.round((goalCountedMs / goalMs) * 100),
    totalSeconds: Math.floor(totalMs / 1000)
  };
}

/** The goal reads like every other duration ("8h", "7h 30m", "30m"; UIA-207). */
export function formatGoalHours(minutes: number) {
  return formatDuration(minutes * 60);
}

/** Entries that overlap the day, newest first, with their clipped interval. */
export function todayBlocks<T extends TodayEntry>(entries: readonly T[], dayStartMs: number, nowMs: number) {
  const dayEnd = localDayEnd(dayStartMs);
  return entries
    .map((entry) => ({ entry, clip: clipEntry(entry, dayStartMs, dayEnd, nowMs) }))
    .filter((item): item is { entry: T; clip: ClippedInterval } => item.clip !== null)
    .sort((a, b) => Date.parse(b.entry.startedAt) - Date.parse(a.entry.startedAt) || b.entry.id.localeCompare(a.entry.id));
}

/** The prototype's row block height: 22–44 px, growing 18 px per hour. */
export function blockRowHeight(durationMs: number) {
  return Math.round(Math.min(44, Math.max(22, 16 + (durationMs / HOUR_MS) * 18)));
}

export type ActivityTotal = { key: string; categoryId: string | null; name: string; color: string | null; seconds: number };

function activityBucket(entry: TodayEntry): ActivityTotal {
  return {
    key: entry.categoryId ?? "none",
    categoryId: entry.categoryId,
    name: entry.categoryId ? entry.categoryName?.trim() || "No activity" : "No activity",
    color: entry.categoryId ? entry.categoryColor : null,
    seconds: 0
  };
}

function byTimeThenName(a: ActivityTotal, b: ActivityTotal) {
  return b.seconds - a.seconds || a.name.localeCompare(b.name);
}

/**
 * Logged time per activity (overlaps count for each entry, as Reports does), largest first. The
 * Calendar head's week strip uses it beside its logged day and week totals; Today uses
 * `coveredActivityTotals` so its bars add up to the covered hero.
 */
export function activityTotals(entries: readonly TodayEntry[], startMs: number, endMs: number, nowMs: number): ActivityTotal[] {
  const totals = new Map<string, ActivityTotal>();
  for (const entry of entries) {
    const clip = clipEntry(entry, startMs, endMs, nowMs);
    if (!clip) continue;
    const current = totals.get(entry.categoryId ?? "none") ?? activityBucket(entry);
    current.seconds += (clip.toMs - clip.fromMs) / 1000;
    totals.set(current.key, current);
  }
  return [...totals.values()]
    .map((total) => ({ ...total, seconds: Math.floor(total.seconds) }))
    .filter((total) => total.seconds > 0)
    .sort(byTimeThenName);
}

/**
 * Covered time per activity ("Where today went"), largest first. Where blocks overlap, each
 * moment is split equally among the distinct activities running in it (two blocks of one
 * activity count that moment once), so the buckets add up to `coveredPieces`' total, the hero.
 * Running blocks run to now and everything is clipped to the range, as `clipEntry` does.
 *
 * Rounding matches the hero's display: the hero floors covered seconds and shows whole minutes,
 * so the buckets get exactly the hero's whole minutes (largest remainder first) and then exactly
 * its leftover seconds (each bucket nearest its exact share first). The seconds therefore sum to
 * the hero's seconds and the displayed minutes sum to the hero's minutes.
 */
export function coveredActivityTotals(entries: readonly TodayEntry[], startMs: number, endMs: number, nowMs: number): ActivityTotal[] {
  const buckets = new Map<string, ActivityTotal>();
  const events: Array<{ atMs: number; key: string; delta: 1 | -1 }> = [];
  for (const entry of entries) {
    const clip = clipEntry(entry, startMs, endMs, nowMs);
    if (!clip) continue;
    const bucket = buckets.get(entry.categoryId ?? "none") ?? activityBucket(entry);
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

export type WhereTodayWentBar = ActivityTotal & {
  /** On the "Other" bar only: the activities it holds, largest first. */
  includes?: string[];
};

export const WHERE_TODAY_WENT_BARS = 5;
export const WHERE_TODAY_WENT_OTHER_KEY = "__other";

/**
 * The bars "Where today went" draws: every activity when there are five or fewer; otherwise the
 * top four and a neutral "Other" bar, always last, holding the rest, so the bars still add up to
 * the covered hero.
 */
export function whereTodayWentBars(totals: readonly ActivityTotal[], limit = WHERE_TODAY_WENT_BARS): WhereTodayWentBar[] {
  if (totals.length <= limit) return [...totals];
  const shown = totals.slice(0, limit - 1);
  const rest = totals.slice(limit - 1);
  return [
    ...shown,
    {
      key: WHERE_TODAY_WENT_OTHER_KEY,
      categoryId: null,
      name: "Other",
      color: null,
      seconds: rest.reduce((sum, total) => sum + total.seconds, 0),
      includes: rest.map((total) => total.name)
    }
  ];
}

export type WeekDaySummary = {
  dayStartMs: number;
  dateKey: string;
  totalSeconds: number;
  segments: Array<{ key: string; color: string | null; name: string; left: number; width: number }>;
};

/** The six days before today, newest first, each with its covered total and entry strips. */
export function previousDays(entries: readonly TodayEntry[], nowMs: number, count = 6): WeekDaySummary[] {
  const days: WeekDaySummary[] = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const start = localDayStart(nowMs, -offset);
    const end = localDayEnd(start);
    const span = end - start;
    const segments = entries
      .map((entry) => ({ entry, clip: clipEntry(entry, start, end, nowMs) }))
      .filter((item): item is { entry: TodayEntry; clip: ClippedInterval } => item.clip !== null)
      .sort((a, b) => a.clip.fromMs - b.clip.fromMs)
      .map(({ entry, clip }) => ({
        key: entry.id,
        color: entry.categoryId ? entry.categoryColor : null,
        name: entry.categoryName ?? "",
        left: ((clip.fromMs - start) / span) * 100,
        width: ((clip.toMs - clip.fromMs) / span) * 100
      }));
    const totalMs = coveredPieces(entries, start, end, nowMs).reduce((sum, piece) => sum + piece.ms, 0);
    days.push({ dayStartMs: start, dateKey: dateKey(start), totalSeconds: Math.floor(totalMs / 1000), segments });
  }
  return days;
}

export function dateKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type PendingReviewSpan = { id: string; title: string; color: string | null; name: string; fromMs: number; toMs: number };

/** Open Review suggestions with a complete window, clipped to the range (the ribbon's hatched spans). */
export function pendingReviewSpans(items: readonly ReviewItemRow[], startMs: number, endMs: number, nowMs: number): PendingReviewSpan[] {
  const spans: PendingReviewSpan[] = [];
  for (const item of items) {
    if (item.status !== "open" || !item.suggestedStartedAt || !item.suggestedStoppedAt) continue;
    const clip = clipEntry({ startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt }, startMs, endMs, nowMs);
    if (!clip) continue;
    spans.push({
      id: item.id,
      title: item.title,
      color: item.suggestedCategoryId ? item.categoryColor : null,
      name: item.categoryName ?? "",
      ...clip
    });
  }
  return spans.sort((a, b) => a.fromMs - b.fromMs);
}

/** Total suggested time across open Review items (the Review card's "noticed but didn't log"). */
export function pendingReviewSeconds(items: readonly ReviewItemRow[]) {
  let total = 0;
  for (const item of items) {
    if (item.status !== "open" || !item.suggestedStartedAt || !item.suggestedStoppedAt) continue;
    const ms = Date.parse(item.suggestedStoppedAt) - Date.parse(item.suggestedStartedAt);
    if (Number.isFinite(ms) && ms > 0) total += ms;
  }
  return Math.floor(total / 1000);
}

/** Widens spans to what the ribbon draws (`max(3px, width)`), so a hit matches the visible block. */
export function withMinimumSpan<T extends { fromMs: number; toMs: number }>(spans: readonly T[], minimumMs: number): T[] {
  return spans.map((item) => (item.toMs - item.fromMs >= minimumMs ? item : { ...item, toMs: item.fromMs + minimumMs }));
}

export const RIBBON_MIN_BLOCK_PX = 3;
/** Neighbouring ribbon blocks sit 1 px apart (X2): half a pixel of transparent edge on each side. */
export const RIBBON_GAP_PX = 1;

/**
 * Where the next block starts after this one, when it starts at or after this one ends (so the
 * minimum width never reaches over it), or null.
 */
export function ribbonNextStartMs(item: { fromMs: number; toMs: number }, all: ReadonlyArray<{ fromMs: number; toMs: number }>) {
  let next: number | null = null;
  for (const other of all) {
    if (other === item || other.fromMs < item.toMs || other.fromMs <= item.fromMs) continue;
    if (next === null || other.fromMs < next) next = other.fromMs;
  }
  return next;
}

/** A block's reach on the ribbon: its time, at least the minimum, never past the next block's start. */
export function ribbonReach<T extends { fromMs: number; toMs: number }>(spans: readonly T[], all: ReadonlyArray<{ fromMs: number; toMs: number }>, minimumMs: number): T[] {
  return spans.map((item) => {
    const next = ribbonNextStartMs(item, all);
    const reach = Math.max(item.toMs, item.fromMs + minimumMs);
    return { ...item, toMs: next === null ? reach : Math.min(reach, next) };
  });
}

export type RibbonHit =
  | { kind: "entry"; id: string }
  | { kind: "pending"; id: string }
  | { kind: "gap"; atMs: number };

/**
 * What a tap or hover lands on, as drawn: each block's reach (ribbonReach) less half the gap on each
 * side wins first; only in a gap between drawn blocks does the full reach answer.
 */
export function ribbonDrawnHitAt(
  atMs: number,
  entries: ReadonlyArray<{ id: string; fromMs: number; toMs: number; startedMs?: number }>,
  pending: ReadonlyArray<{ id: string; fromMs: number; toMs: number }>,
  { minimumMs, halfGapMs }: { minimumMs: number; halfGapMs: number }
): RibbonHit {
  const all = [...entries, ...pending];
  const reachedEntries = ribbonReach(entries, all, minimumMs);
  const reachedPending = ribbonReach(pending, all, minimumMs);
  const drawn = <T extends { fromMs: number; toMs: number }>(spans: T[]) =>
    spans.map((item) => ({ ...item, fromMs: item.fromMs + halfGapMs, toMs: item.toMs - halfGapMs }));
  const visible = ribbonHitAt(atMs, drawn(reachedEntries), drawn(reachedPending));
  return visible.kind === "gap" ? ribbonHitAt(atMs, reachedEntries, reachedPending) : visible;
}

/** What sits under a point on the day ribbon: an entry (newest wins), else a Review span, else a gap. */
export function ribbonHitAt(
  atMs: number,
  entries: ReadonlyArray<{ id: string; fromMs: number; toMs: number; startedMs?: number }>,
  pending: ReadonlyArray<{ id: string; fromMs: number; toMs: number }>
): RibbonHit {
  // The ribbon paints in `todayBlocks` order reversed: later start on top, then the larger ID.
  // Two blocks clipped to the same midnight still differ by when they really started.
  let hit: { id: string; order: number } | null = null;
  for (const entry of entries) {
    const order = entry.startedMs ?? entry.fromMs;
    if (atMs < entry.fromMs || atMs > entry.toMs) continue;
    if (!hit || order > hit.order || (order === hit.order && entry.id.localeCompare(hit.id) > 0)) hit = { id: entry.id, order };
  }
  if (hit) return { kind: "entry", id: hit.id };
  // Suggestions paint in order, so the last one under the point is the one on top.
  let span: { id: string } | null = null;
  for (const item of pending) {
    if (atMs >= item.fromMs && atMs <= item.toMs) span = item;
  }
  return span ? { kind: "pending", id: span.id } : { kind: "gap", atMs };
}

/**
 * Why an editor's save must not go ahead, or null. Saving a running block goes through the
 * shell's "update what is running" path, so it is only safe while the block the editor opened is
 * still the one running; it may have been stopped, switched or deleted elsewhere since.
 */
export function staleEditError(
  editing: Pick<TimeEntryRow, "id" | "stoppedAt">,
  entries: ReadonlyArray<Pick<TimeEntryRow, "id" | "stoppedAt">>,
  activeId: string | null
) {
  const current = entries.find((entry) => entry.id === editing.id);
  if (!current) return "This block was deleted. Close the editor to continue.";
  if (!editing.stoppedAt && (current.stoppedAt || activeId !== editing.id)) {
    return "This block stopped while you were editing. Close the editor and edit it again.";
  }
  return null;
}

/** An entry the shell has not saved yet (an optimistic Start); it gets its real ID on reconcile. */
export function isUnsavedEntryId(id: string) {
  return id.startsWith("optimistic-");
}

/** Where a local wall-clock hour sits on the day (23- and 25-hour days included), as a percentage. */
export function hourPercent(dayStartMs: number, dayEndMs: number, hour: number) {
  if (hour >= 24) return 100;
  const at = new Date(dayStartMs);
  at.setHours(hour, 0, 0, 0);
  return ((at.getTime() - dayStartMs) / (dayEndMs - dayStartMs)) * 100;
}
