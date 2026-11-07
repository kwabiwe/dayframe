const MINUTE_MS = 60_000;

export type SplitBounds = { startMs: number; stopMs: number; minMs: number; maxMs: number };

/** Where a finished block can be split: on whole minutes, leaving each half a minute or more. Null when it can't. */
export function splitBounds(entry: { startedAt: string; stoppedAt: string | null }): SplitBounds | null {
  if (!entry.stoppedAt) return null;
  const startMs = Date.parse(entry.startedAt);
  const stopMs = Date.parse(entry.stoppedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return null;
  const minMs = Math.ceil((startMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const maxMs = Math.floor((stopMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  return maxMs >= minMs ? { startMs, stopMs, minMs, maxMs } : null;
}

/** A split time snapped to the minute and kept inside the bounds. */
export function clampSplit(bounds: SplitBounds, atMs: number) {
  const snapped = Math.round(atMs / MINUTE_MS) * MINUTE_MS;
  return Math.min(bounds.maxMs, Math.max(bounds.minMs, snapped));
}

/** The middle of the block, on a minute: where the line starts. */
export function defaultSplit(bounds: SplitBounds) {
  return clampSplit(bounds, (bounds.startMs + bounds.stopMs) / 2);
}
