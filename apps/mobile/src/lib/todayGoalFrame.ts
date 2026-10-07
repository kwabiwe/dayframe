/**
 * Today's goal frame (Blocks prototype): the day's tracked total against the daily goal, drawn as
 * one cell per goal hour that fills with entries in the order they happened. Goals use covered
 * time, as on the web dashboard (product-model.md): time that overlapping entries share counts
 * once and is drawn in the colour of the entry that started first. Cells stop at the goal; the
 * total does not.
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
  entries,
  goalMinutes,
  nowMs,
}: {
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

  const intervals = entries
    .map((entry) => ({
      entry,
      startedMs: Date.parse(entry.startedAt),
      from: Math.max(Date.parse(entry.startedAt), startMs),
      to: Math.min(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs, nowMs),
    }))
    .filter((interval) => Number.isFinite(interval.from) && Number.isFinite(interval.to) && interval.to > interval.from)
    .sort((a, b) => a.startedMs - b.startedMs || a.entry.id.localeCompare(b.entry.id));

  // Union in start order: each entry contributes only the time no earlier entry already covers.
  const pieces: { entry: GoalFrameEntry; ms: number }[] = [];
  let coveredUntil = Number.NEGATIVE_INFINITY;
  for (const { entry, from, to } of intervals) {
    const ms = to - Math.max(from, coveredUntil);
    if (ms > 0) pieces.push({ entry, ms });
    coveredUntil = Math.max(coveredUntil, to);
  }

  const totalMs = pieces.reduce((sum, piece) => sum + piece.ms, 0);
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
    percent: Math.min(100, Math.round((totalMs / goalMs) * 100)),
    totalSeconds: Math.floor(totalMs / 1000),
  };
}
