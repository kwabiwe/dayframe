/**
 * How location-store changes reach the durable-work snapshot (`durableWorkMonitor.ts`).
 *
 * Every location mutation (each stored sample, upload batch and acknowledgement) used to refresh the whole
 * snapshot at once: the activity queue, Stop and time-entry outboxes, the keychain owner, Review and
 * Location diagnostics and two native status calls, in the background too, after every sample. The
 * snapshot is read only in the foreground (Settings › Sync help and the recovery owner, which acts only
 * while the app is active). So a location change in the background marks the snapshot stale and refreshes
 * it once when the app becomes active; in the foreground a burst of location changes refreshes it once
 * after `LOCATION_REFRESH_COALESCE_MS`. Other durable work still refreshes it at once.
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
        input.refresh();
      }, LOCATION_REFRESH_COALESCE_MS);
    },
    appBecameActive() {
      if (!deferred) return;
      deferred = false;
      input.refresh();
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      deferred = false;
    }
  };
}
