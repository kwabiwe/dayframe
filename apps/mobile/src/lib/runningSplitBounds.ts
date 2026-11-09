import type { SplitBounds } from "@dayframe/shared";

const MINUTE_MS = 60_000;

/**
 * Where a running block can be split (owner 28 Oct 2026, as Toggl; the web's `runningSplitBounds`): on whole
 * minutes, never within its first minute or the last minute before now. Null while it is too short.
 */
export function runningSplitBounds(startMs: number, nowMs: number): SplitBounds | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  const minMs = Math.ceil((startMs + MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const maxMs = Math.floor((nowMs - MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  return maxMs >= minMs ? { startMs, stopMs: nowMs, minMs, maxMs } : null;
}
