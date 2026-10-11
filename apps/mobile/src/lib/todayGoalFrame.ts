import { goalCountingEntries, type GoalCountingCategory } from "@dayframe/shared";

/**
 * Today's goal frame (Blocks prototype): the day's tracked total against the daily goal, drawn as
 * one cell per goal hour that fills with entries in the order they happened. The total is every
 * block's own time, overlaps included (UIA-305, owner: one total wherever totals appear, so a day
 * can pass 24h). Goals use covered time (product-model.md): time that overlapping entries share
 * counts once toward the goal and is drawn in the colour of the entry that started first. Cells
 * stop at the goal; the total does not. The cells and percent use only activities that count
 * toward the goal (`goalCountingEntries`, UIA-043: Sleep does not by default).
 */
type GoalFrameEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  categoryColor?: string | null;
  categoryId?: string | null;
};

export type GoalFrameSlice = { key: string; color: string | null; fraction: number; live: boolean };

export const DEFAULT_DAILY_GOAL_MINUTES = 480;
const HOUR_MS = 3_600_000;

export function buildTodayGoalFrame({
  categories,
  entries,
  goalMinutes,
  nowMs,
}: {
  /** The workspace's activities with their "Counts toward goal" switch; left out, all time counts. */
  categories?: Iterable<GoalCountingCategory> | null;
  entries: readonly GoalFrameEntry[];
  goalMinutes: number | null | undefined;
  nowMs: number;
}) {
  const minutes = goalMinutes && goalMinutes > 0 ? goalMinutes : DEFAULT_DAILY_GOAL_MINUTES;
  const goalMs = minutes * 60_000;
  const cellCount = Math.max(1, Math.round(minutes / 60));
  // Integer cell edges: a fractional cell width once let a cursor sitting on an edge take a zero
  // step forever (for example 394 minutes in 7 cells).
  const edges = Array.from({ length: cellCount }, (_, index) => Math.round(((index + 1) * goalMs) / cellCount));
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);
  const startMs = dayStart.getTime();

  const totalMs = loggedMs(entries, startMs, nowMs);
  const pieces = coveredPieces(goalCountingEntries(entries, categories), startMs, nowMs);
  const goalCountedMs = pieces.reduce((sum, piece) => sum + piece.ms, 0);
  const cells: GoalFrameSlice[][] = Array.from({ length: cellCount }, () => []);
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
        color: entry.categoryColor ?? entry.categoryId ?? null,
        fraction: take / (edges[index] - cellStart),
        live: !entry.stoppedAt,
      });
      cursor += take;
      remaining -= take;
    }
  }

  return {
    cells,
    goalHours: minutes / 60,
    /** Framed time that fills the goal (all of it unless an activity is switched off). */
    goalSeconds: Math.floor(goalCountedMs / 1000),
    percent: Math.min(100, Math.round((goalCountedMs / goalMs) * 100)),
    totalSeconds: Math.floor(totalMs / 1000),
  };
}

/** Every entry's own time today, overlaps included. */
function loggedMs(entries: readonly GoalFrameEntry[], startMs: number, nowMs: number) {
  let total = 0;
  for (const entry of entries) {
    const from = Math.max(Date.parse(entry.startedAt), startMs);
    const to = Math.min(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs, nowMs);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) total += to - from;
  }
  return total;
}

/** Union in start order: each entry contributes only the time no earlier entry already covers. */
function coveredPieces(entries: readonly GoalFrameEntry[], startMs: number, nowMs: number) {
  const intervals = entries
    .map((entry) => ({
      entry,
      startedMs: Date.parse(entry.startedAt),
      from: Math.max(Date.parse(entry.startedAt), startMs),
      to: Math.min(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs, nowMs),
    }))
    .filter((interval) => Number.isFinite(interval.from) && Number.isFinite(interval.to) && interval.to > interval.from)
    .sort((a, b) => a.startedMs - b.startedMs || a.entry.id.localeCompare(b.entry.id));
  const pieces: { entry: GoalFrameEntry; ms: number }[] = [];
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const { entry, from, to } of intervals) {
    const ms = to - Math.max(from, coveredUntil);
    if (ms > 0) pieces.push({ entry, ms });
    coveredUntil = Math.max(coveredUntil, to);
  }
  return pieces;
}
