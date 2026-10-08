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

export type ReviewBulkSkipEntry = { key: string; itemId: string; proposal: string };

export type ReviewBulkSkipOutcome = {
  /** Skipped once through the durable outbox. */
  saved: ReviewBulkSkipEntry[];
  /** The local save failed; the moment stays to review. */
  failed: ReviewBulkSkipEntry[];
  /** A refresh changed the moment (or another change for it is saving): not what was confirmed. */
  changed: ReviewBulkSkipEntry[];
  /** Resolved elsewhere while held: nothing to do. */
  resolved: ReviewBulkSkipEntry[];
  /** The signed-in account changed: nothing more is written, and nothing is put back. */
  abandoned: ReviewBulkSkipEntry[];
};

/**
 * Saves a held bulk skip one moment at a time. Each moment is checked against the current data
 * right before it is written (a refresh during an earlier write may have changed it), and the
 * run stops the moment the account changes, so no write or restore crosses accounts.
 */
export async function runReviewBulkSkip<T>(
  entries: readonly ReviewBulkSkipEntry[],
  {
    enqueue,
    isSaving,
    openItem,
    ownerMatches,
    signature
  }: {
    enqueue: (item: T) => Promise<void>;
    isSaving: (itemId: string) => boolean;
    openItem: (itemId: string) => T | undefined;
    ownerMatches: () => boolean;
    signature: (item: T) => string;
  }
): Promise<ReviewBulkSkipOutcome> {
  const outcome: ReviewBulkSkipOutcome = { saved: [], failed: [], changed: [], resolved: [], abandoned: [] };
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!ownerMatches()) {
      outcome.abandoned.push(...entries.slice(index));
      break;
    }
    const item = openItem(entry.itemId);
    if (!item) {
      outcome.resolved.push(entry);
      continue;
    }
    if (signature(item) !== entry.proposal || isSaving(entry.itemId)) {
      outcome.changed.push(entry);
      continue;
    }
    try {
      await enqueue(item);
      outcome.saved.push(entry);
    } catch {
      if (ownerMatches()) outcome.failed.push(entry);
      else outcome.abandoned.push(entry);
    }
  }
  return outcome;
}

/** Whether the loaded data still belongs to the account that held a bulk skip. */
export function reviewBulkSkipOwnerMatches(
  owner: { workspaceId: string; userId: string },
  data: { workspace: { id: string }; user: { id: string } } | null | undefined
) {
  return Boolean(data && data.workspace.id === owner.workspaceId && data.user.id === owner.userId);
}
