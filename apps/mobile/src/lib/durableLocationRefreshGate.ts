/**
 * How location-store changes reach the durable-work snapshot (`durableWorkMonitor.ts`).
 *
 * Every location mutation (each stored sample, upload batch and acknowledgement) used to refresh the whole
 * snapshot at once: the activity queue, Stop and time-entry outboxes, the keychain owner, Review and
 * Location diagnostics and two native status calls, in the background too, after every sample. Nothing
 * needs fresh location totals in the background: the recovery owner acts only while the app is active, and
 * background timer continuation reads only the snapshot's account. So a location change in the background
 * marks the snapshot stale and refreshes it once when the app becomes active; in the foreground a burst of
 * location changes refreshes it once after `LOCATION_REFRESH_COALESCE_MS` (deferred instead if the app has
 * left the foreground by then). Other durable work still refreshes it at once.
 */
export const LOCATION_REFRESH_COALESCE_MS = 2_000;

type Timer = ReturnType<typeof setTimeout>;

export function createLocationRefreshGate(input: {
  isActive: () => boolean;
  refresh: () => void;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}) {
  const setTimer = input.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer));
  let timer: Timer | null = null;
  let deferred = false;
  return {
    locationChanged() {
      if (!input.isActive()) {
        deferred = true;
        return;
      }
      if (timer !== null) return;
      timer = setTimer(() => {
        timer = null;
        if (!input.isActive()) {
          deferred = true;
          return;
        }
        input.refresh();
      }, LOCATION_REFRESH_COALESCE_MS);
    },
    appBecameActive() {
      if (!deferred) return;
      deferred = false;
      // This refresh covers any change still waiting on the timer.
      if (timer !== null) clearTimer(timer);
      timer = null;
      input.refresh();
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      deferred = false;
    }
  };
}
