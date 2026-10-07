// Today's quick-start mosaic (Dayframe Blocks, docs/brand-style-guide.md "New layouts"):
// up to six pinned activities as solid blocks in three columns, sized by this week's time.

export const QUICK_START_MOSAIC = {
  height: 232,
  gap: 8,
  minTileHeight: 54,
  /** Below this a tile shows icon and name on one row and drops its duration. */
  compactBelow: 76,
  maxTiles: 6,
} as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type QuickStartActivity = {
  color: string | null;
  icon: string | null;
  id: string;
  name: string;
  weekSeconds: number;
};

export type QuickStartTile = QuickStartActivity & {
  compact: boolean;
  height: number;
};

export type QuickStartColumn = {
  flex: number;
  key: string;
  tiles: QuickStartTile[];
};

type WeeklyEntry = {
  categoryId: string | null;
  startedAt: string;
  stoppedAt: string | null;
};

/**
 * Completed time per activity over the last seven days. The running entry is left out on purpose,
 * so tiles keep their size while the timer ticks and change once, when a block is stopped.
 */
export function weeklySecondsByActivity(entries: readonly WeeklyEntry[], nowMs: number) {
  const windowStart = nowMs - WEEK_MS;
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.categoryId || !entry.stoppedAt) continue;
    const start = Math.max(Date.parse(entry.startedAt), windowStart);
    const end = Math.min(Date.parse(entry.stoppedAt), nowMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    totals.set(entry.categoryId, (totals.get(entry.categoryId) ?? 0) + Math.round((end - start) / 1000));
  }
  return totals;
}

/**
 * The first six pinned activities (already in usage order), ranked by this week's whole minutes.
 * Ties keep usage order, so a new week starts from the familiar arrangement and a few seconds of
 * tracking never moves a tile out from under the next tap.
 */
export function rankQuickStartActivities(
  pinned: ReadonlyArray<Omit<QuickStartActivity, "weekSeconds">>,
  weeklySeconds: ReadonlyMap<string, number>
): QuickStartActivity[] {
  return pinned
    .slice(0, QUICK_START_MOSAIC.maxTiles)
    .map((activity, index) => ({ activity: { ...activity, weekSeconds: weeklySeconds.get(activity.id) ?? 0 }, index }))
    .sort((left, right) => wholeMinutes(right.activity) - wholeMinutes(left.activity) || left.index - right.index)
    .map(({ activity }) => activity);
}

function wholeMinutes(activity: QuickStartActivity) {
  return Math.floor(activity.weekSeconds / 60);
}

// Rank positions per column, by tile count: the busiest activity takes the tall middle column.
const COLUMN_TEMPLATES: Record<number, number[][]> = {
  1: [[0]],
  2: [[0], [1]],
  3: [[1], [0], [2]],
  4: [[1], [0], [2, 3]],
  5: [[1, 4], [0], [2, 3]],
  6: [[1, 4], [0], [2, 3, 5]],
};

/** Columns and tile heights for ranked activities; every column fills the mosaic height exactly. */
export function layoutQuickStartMosaic(ranked: readonly QuickStartActivity[]): QuickStartColumn[] {
  const activities = ranked.slice(0, QUICK_START_MOSAIC.maxTiles);
  if (!activities.length) return [];
  const template = COLUMN_TEMPLATES[activities.length];
  return template.map((ranks, columnIndex) => {
    const items = ranks.map((rank) => activities[rank]);
    const heights = columnHeights(items.map((item) => item.weekSeconds));
    return {
      flex: template.length === 3 && columnIndex === 1 ? 1.15 : template.length === 2 && columnIndex === 0 ? 1.15 : 1,
      key: items.map((item) => item.id).join("|"),
      tiles: items.map((item, index) => ({
        ...item,
        compact: heights[index] < QUICK_START_MOSAIC.compactBelow,
        height: heights[index],
      })),
    };
  });
}

function columnHeights(seconds: number[]) {
  const { gap, height, minTileHeight } = QUICK_START_MOSAIC;
  const available = height - gap * (seconds.length - 1);
  const weights = seconds.map((value) => Math.max(value, 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let heights = weights.map((value) => Math.max(minTileHeight, (value / total) * available));
  const overflow = heights.reduce((sum, value) => sum + value, 0) - available;
  if (overflow > 0) {
    // Tiles lifted to the minimum borrow their room from the taller tiles in the same column.
    const flexible = heights.map((value) => value - minTileHeight);
    const flexibleTotal = flexible.reduce((sum, value) => sum + value, 0) || 1;
    heights = heights.map((value, index) => value - (flexible[index] / flexibleTotal) * overflow);
  }
  // Half-point heights; the last tile absorbs the rounding so the column ends flush.
  const rounded = heights.map((value) => Math.round(value * 2) / 2);
  rounded[rounded.length - 1] = available - rounded.slice(0, -1).reduce((sum, value) => sum + value, 0);
  return rounded;
}
