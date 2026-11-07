export const TIMER_STATE_POLL_INTERVAL_MS = 3_000;
export const TIMER_STATE_RECONCILE_INTERVAL_MS = 5 * 60_000;

export type TimerStateFingerprint = {
  activeEntryId: string | null;
  updatedAt: string | null;
  serverNow: string;
  /** Optional while an installed client can still reach a server without the completed-block marker. */
  completedEntryRevision?: string;
};

export function timerStateChanged(
  previous: TimerStateFingerprint | null,
  next: TimerStateFingerprint
) {
  if (!previous) return false;
  return (
    previous.activeEntryId !== next.activeEntryId ||
    previous.updatedAt !== next.updatedAt
  );
}

export function completedEntriesChanged(
  appliedRevision: string | undefined,
  observedRevision: string | undefined
) {
  return observedRevision !== undefined && observedRevision !== appliedRevision;
}

export function timerStatePollDelay(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) return TIMER_STATE_POLL_INTERVAL_MS;
  if (consecutiveFailures === 1) return 6_000;
  if (consecutiveFailures === 2) return 12_000;
  return 30_000;
}
