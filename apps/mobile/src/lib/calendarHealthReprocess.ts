import { AuthRequiredError } from "./api";
import { reprocessExistingHealthReviewItems } from "./health";

/**
 * Apple Health's "?" brought up to date when Calendar › List comes to the front (location v4 step 15; Codex r1 on
 * #615). The Review deck forced the server's Health reprocess whenever it opened, whether or not this iPhone captures
 * Health itself; with the deck gone the List does it instead, bounded: at most once per account every
 * `CALENDAR_HEALTH_REPROCESS_INTERVAL_MS` (an attempt counts, so a failing one is not retried in a loop), inside a
 * deadline, stopped at the next batch when the account changes. It never reads or depends on Health capture.
 */
export const CALENDAR_HEALTH_REPROCESS_INTERVAL_MS = 15 * 60_000;
export const CALENDAR_HEALTH_REPROCESS_DEADLINE_MS = 20_000;

const lastAttemptByOwner = new Map<string, number>();

export type CalendarHealthReprocessOutcome = "throttled" | "unchanged" | "changed" | "stale" | "failed";

export async function reprocessHealthOnCalendarFront(input: {
  ownerKey: string;
  isCurrentOwner: () => boolean;
  now?: number;
  reprocess?: typeof reprocessExistingHealthReviewItems;
}): Promise<CalendarHealthReprocessOutcome> {
  const now = input.now ?? Date.now();
  const last = lastAttemptByOwner.get(input.ownerKey);
  if (last !== undefined && now - last < CALENDAR_HEALTH_REPROCESS_INTERVAL_MS) return "throttled";
  lastAttemptByOwner.set(input.ownerKey, now);
  const reprocess = input.reprocess ?? reprocessExistingHealthReviewItems;
  try {
    const result = await reprocess(undefined, {
      force: true,
      deadlineAt: now + CALENDAR_HEALTH_REPROCESS_DEADLINE_MS,
      beforeRequest: async () => input.isCurrentOwner()
    });
    if (!input.isCurrentOwner()) return "stale";
    return result.confirmedCount > 0 || result.ignoredCount > 0 || result.updatedCategoryCount > 0 || result.repairedSleepEntryCount > 0
      ? "changed"
      : "unchanged";
  } catch (error) {
    if (!input.isCurrentOwner()) return "stale";
    // Signed out: the caller's sign-out path takes it. Anything else waits for the next interval.
    if (error instanceof AuthRequiredError) throw error;
    return "failed";
  }
}

/** Tests only: forget every account's last attempt. */
export function resetCalendarHealthReprocessForTests() {
  lastAttemptByOwner.clear();
}
