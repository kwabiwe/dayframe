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

export type CompletedEntryCopyAction =
  | { kind: "split"; splitAt: string }
  | { kind: "duplicate" };

/** Stable seed for a completed-block command and the new entry it creates. */
export function completedEntryCopySeed(
  owner: { workspaceId: string; userId: string },
  entryId: string,
  commandId: string,
  expectedUpdatedAt: string,
  action: CompletedEntryCopyAction
) {
  return JSON.stringify([
    "dayframe-completed-entry-copy-v1", owner.workspaceId, owner.userId, entryId.toLowerCase(), commandId,
    Date.parse(expectedUpdatedAt), action.kind, action.kind === "split" ? Date.parse(action.splitAt) : null
  ]);
}

/** UUID v8 from the SHA-256 of the copy seed. The UUID is scoped before hashing. */
export function completedEntryCopyId(sha256Hex: string) {
  const variant = (Number.parseInt(sha256Hex[16], 16) & 3) | 8;
  return [
    sha256Hex.slice(0, 8), sha256Hex.slice(8, 12), "8" + sha256Hex.slice(13, 16),
    variant.toString(16) + sha256Hex.slice(17, 20), sha256Hex.slice(20, 32)
  ].join("-");
}
