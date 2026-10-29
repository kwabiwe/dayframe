import { AuthRequiredError } from "./api";
import { reprocessExistingHealthReviewItems } from "./health";

/**
 * Apple Health's "?" brought up to date when Calendar › List comes to the front (location v4 step 15; Codex r1 on
 * #615). The Review deck forced the server's Health reprocess whenever it opened, whether or not this iPhone captures
 * Health itself; with the deck gone the List does it instead, bounded: at most once per account every
 * `CALENDAR_HEALTH_REPROCESS_INTERVAL_MS` (an attempt counts, so a failing one is not retried in a loop), inside a
 * deadline. It never reads or depends on Health capture.
 *
 * Foreground only (Codex r2 on #615): before every batch it checks that the account is the same and the List is still
 * in front, and the caller's `signal` aborts it when the app leaves the front. A run cut short that way is
 * "interrupted": its attempt is forgotten (so the next time in front runs again) and the caller reloads only once
 * back in front.
 */
export const CALENDAR_HEALTH_REPROCESS_INTERVAL_MS = 15 * 60_000;
export const CALENDAR_HEALTH_REPROCESS_DEADLINE_MS = 20_000;

const lastAttemptByOwner = new Map<string, number>();

export type CalendarHealthReprocessOutcome = "throttled" | "unchanged" | "changed" | "stale" | "interrupted" | "failed";

export async function reprocessHealthOnCalendarFront(input: {
  ownerKey: string;
  isCurrentOwner: () => boolean;
  /** Whether Dayframe is in front with Calendar › List on screen. */
  isInFront: () => boolean;
  signal?: AbortSignal;
  now?: number;
  reprocess?: typeof reprocessExistingHealthReviewItems;
}): Promise<CalendarHealthReprocessOutcome> {
  const now = input.now ?? Date.now();
  const last = lastAttemptByOwner.get(input.ownerKey);
  if (last !== undefined && now - last < CALENDAR_HEALTH_REPROCESS_INTERVAL_MS) return "throttled";
  if (input.signal?.aborted || !input.isInFront()) return "interrupted";
  lastAttemptByOwner.set(input.ownerKey, now);
  const reprocess = input.reprocess ?? reprocessExistingHealthReviewItems;
  const stillWanted = () => input.isCurrentOwner() && input.isInFront() && !input.signal?.aborted;
  const interrupted = () => {
    if (lastAttemptByOwner.get(input.ownerKey) === now) lastAttemptByOwner.delete(input.ownerKey);
    return "interrupted" as const;
  };
  try {
    const result = await reprocess(undefined, {
      force: true,
      signal: input.signal,
      deadlineAt: now + CALENDAR_HEALTH_REPROCESS_DEADLINE_MS,
      beforeRequest: async () => stillWanted(),
      // Read again at the transport, after its session read, right before sending (Codex r5 on #615).
      isWanted: stillWanted
    });
    if (!input.isCurrentOwner()) return "stale";
    if (!input.isInFront() || input.signal?.aborted) return interrupted();
    return result.confirmedCount > 0 || result.ignoredCount > 0 || result.updatedCategoryCount > 0 || result.repairedSleepEntryCount > 0
      ? "changed"
      : "unchanged";
  } catch (error) {
    if (!input.isCurrentOwner()) return "stale";
    if (!input.isInFront() || input.signal?.aborted) return interrupted();
    // Signed out: the caller's sign-out path takes it. Anything else waits for the next interval.
    if (error instanceof AuthRequiredError) throw error;
    return "failed";
  }
}

/** Tests only: forget every account's last attempt. */
export function resetCalendarHealthReprocessForTests() {
  lastAttemptByOwner.clear();
}
