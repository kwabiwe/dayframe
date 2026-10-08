// Blocks parity step 5f: clear the Review inbox in bulk from the deck card's More menu.
// "Skip older than 7 days" keeps the last week to review; "Skip all" skips every open moment.
// Both skip once (ignore_once / ignore_once_location), never Log, and never make a rule.

export const REVIEW_BULK_SKIP_AGE_MS = 7 * 86_400_000;

export type ReviewBulkSkipScope = "older" | "all";

type BulkSkipItem = {
  id: string;
  suggestedStartedAt?: string | null;
  suggestedStoppedAt?: string | null;
};

/**
 * The items a bulk skip covers, in the order given. `skippable` says whether a card could be
 * skipped by itself right now (open, a complete suggested window, nothing saving or waiting for
 * it, not already held); a card that would only move behind the rest is never skipped in bulk.
 */
export function reviewBulkSkipCandidates<T extends BulkSkipItem>(
  items: readonly T[],
  { now, scope, skippable }: { now: number; scope: ReviewBulkSkipScope; skippable: (item: T) => boolean }
): T[] {
  const cutoff = now - REVIEW_BULK_SKIP_AGE_MS;
  return items.filter((item) => {
    if (!skippable(item)) return false;
    if (scope === "all") return true;
    const startedAt = item.suggestedStartedAt ? Date.parse(item.suggestedStartedAt) : Number.NaN;
    return Number.isFinite(startedAt) && startedAt < cutoff;
  });
}

function moments(count: number) {
  return `${count} ${count === 1 ? "moment" : "moments"}`;
}

/**
 * The one confirmation a bulk skip asks for. `complete` is false when some open moments are not
 * loaded on this iPhone (an older page could not be read), so the count is only what is here.
 */
export function reviewBulkSkipConfirmation(
  count: number,
  scope: ReviewBulkSkipScope,
  complete: boolean
) {
  const partial = complete ? "" : " Only moments loaded on this iPhone are included.";
  if (count === 0) {
    return {
      title: scope === "older" ? "Nothing older than 7 days" : "Nothing to skip",
      message: scope === "older"
        ? `Every moment left is from the last week.${partial}`
        : `No moment can be skipped right now.${partial}`,
      confirmLabel: null
    };
  }
  return {
    title: `Skip ${moments(count)}?`,
    message: scope === "older"
      ? `Moments older than 7 days are skipped; the last week stays to review. You can undo for a few seconds.${partial}`
      : `Every moment waiting for review is skipped. You can undo for a few seconds.${partial}`,
    confirmLabel: `Skip ${count}`
  };
}

export function reviewBulkSkipToast(count: number) {
  return `Skipped ${moments(count)}`;
}
