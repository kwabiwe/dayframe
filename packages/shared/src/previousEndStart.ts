/**
 * "Start at the previous end" (owner idea 1, 14 Oct 2026): when nothing is recording and today's
 * last block ended within the last few hours, offer to start the next block at that end instead
 * of now, so the gap between them is not lost. The offer never overlaps: it starts at the latest
 * end of any finished block, so no finished block can reach past it.
 */

/** How far back the previous end may be (about 4 h, owner). */
export const PREVIOUS_END_WINDOW_MS = 4 * 60 * 60 * 1000;
/** A gap shorter than a minute is not worth offering. */
export const PREVIOUS_END_MIN_GAP_MS = 60 * 1000;

type FinishedEntryLike = {
  id: string;
  categoryName: string | null;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
};

export type PreviousEndOffer = {
  /** The previous block's end: the new block's start. */
  startedAt: string;
  /** The previous block's name as its row shows it: the description, else the activity. */
  previousName: string;
  previousId: string;
};

/** The block's name as its row shows it: the description, else the activity. */
export function previousBlockName(entry: Pick<FinishedEntryLike, "categoryName" | "description">) {
  return entry.description?.trim() || entry.categoryName?.trim() || "No activity";
}

/**
 * The offer for a block starting at `startMs` (now, from idle), or null. `dayStartMs` is the
 * start of the viewer's local day: only a block that ended today counts. A finished block that
 * ends after `startMs` (time added ahead of now) means there is no gap to fill.
 */
export function previousEndOffer(
  entries: readonly FinishedEntryLike[],
  { dayStartMs, excludeId, startMs }: { dayStartMs: number; excludeId?: string | null; startMs: number }
): PreviousEndOffer | null {
  let latest: { entry: FinishedEntryLike; endMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.stoppedAt || entry.id === excludeId) continue;
    const endMs = Date.parse(entry.stoppedAt);
    if (!Number.isFinite(endMs)) continue;
    if (!latest || endMs > latest.endMs) latest = { entry, endMs };
  }
  if (!latest) return null;
  const gapMs = startMs - latest.endMs;
  if (latest.endMs < dayStartMs || gapMs < PREVIOUS_END_MIN_GAP_MS || gapMs > PREVIOUS_END_WINDOW_MS) return null;
  return {
    startedAt: new Date(latest.endMs).toISOString(),
    previousName: previousBlockName(latest.entry),
    previousId: latest.entry.id
  };
}
