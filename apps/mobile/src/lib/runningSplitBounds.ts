const MINUTE_MS = 60_000;

export type RunningSplitBounds = { startMs: number; nowMs: number; minMs: number; maxMs: number };

/**
 * Where a running block can be split (owner 28 Oct 2026, as Toggl; the web's `runningSplitBounds`): on whole
 * minutes, never within its first minute or the last minute before now. Null while it is too short.
 */
export function runningSplitBounds(startedAt: string, nowMs: number): RunningSplitBounds | null {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  const minMs = Math.ceil((startMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const maxMs = Math.floor((nowMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  return maxMs >= minMs ? { startMs, nowMs, minMs, maxMs } : null;
}

/** A split time snapped to the minute and kept inside the bounds. */
export function clampRunningSplit(bounds: RunningSplitBounds, atMs: number) {
  const snapped = Math.round(atMs / MINUTE_MS) * MINUTE_MS;
  return Math.min(bounds.maxMs, Math.max(bounds.minMs, snapped));
}

/** The middle of the block so far, on a minute: where the line starts. */
export function defaultRunningSplit(bounds: RunningSplitBounds) {
  return clampRunningSplit(bounds, (bounds.startMs + bounds.nowMs) / 2);
}
