/**
 * What Today's quick-start mosaic last laid out (frames computed, not proof they were seen), kept in memory on this iPhone only (never uploaded,
 * never sent to analytics) so a blank mosaic (Trello 210) can be read in Settings › Sync help in the
 * same app session. It holds no activity names or IDs: only a width, counts and a time.
 */
export type QuickStartDiagnostics = {
  /** The width the tiles were last laid out at, in points; 0 before any. */
  width: number;
  /** Where that width came from: the mosaic's own layout, a measure, or the screen width. */
  widthSource: "layout" | "measure" | "window" | null;
  tileCount: number;
  /**
   * How many tiles were found hidden or part-moved after their entrance should have ended, and set at
   * rest. Setting the values is all this proves; it does not confirm the tile was then seen.
   */
  hiddenCount: number;
  lastHiddenAt: number | null;
};

const empty: QuickStartDiagnostics = { width: 0, widthSource: null, tileCount: 0, hiddenCount: 0, lastHiddenAt: null };
let record: QuickStartDiagnostics = { ...empty };

export function readQuickStartDiagnostics(): QuickStartDiagnostics {
  return record;
}

export function recordQuickStartLayout(width: number, widthSource: NonNullable<QuickStartDiagnostics["widthSource"]>, tileCount: number) {
  if (record.width === width && record.widthSource === widthSource && record.tileCount === tileCount) return;
  record = { ...record, width, widthSource, tileCount };
}

export function recordQuickStartTileFoundHidden(at = Date.now()) {
  record = { ...record, hiddenCount: record.hiddenCount + 1, lastHiddenAt: at };
}

/** Test-only: a fresh app session. */
export function resetQuickStartDiagnosticsForTests() {
  record = { ...empty };
}

/** The plain line Sync help shows; `formatTime` is the page's own clock format. */
export function quickStartDiagnosticsSummary(diagnostics: QuickStartDiagnostics, formatTime: (at: number) => string) {
  if (!diagnostics.widthSource) return "No layout yet in this session";
  const tiles = `${diagnostics.tileCount} ${diagnostics.tileCount === 1 ? "tile" : "tiles"}`;
  const source = diagnostics.widthSource === "layout" ? "" : diagnostics.widthSource === "measure" ? " (measured)" : " (from screen width)";
  const layout = `Last layout: ${tiles} at ${diagnostics.width} pt wide${source}.`;
  if (!diagnostics.hiddenCount || diagnostics.lastHiddenAt === null) return `${layout} No hidden tiles found.`;
  const found = diagnostics.hiddenCount === 1 ? "1 hidden tile to rest" : `${diagnostics.hiddenCount} hidden tiles to rest`;
  return `${layout} Set ${found}, last ${formatTime(diagnostics.lastHiddenAt)}.`;
}
