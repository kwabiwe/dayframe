// Shows a Lock Screen Stop made while Dayframe was away (its Live Activity has already ended; owner
// decision 24 Oct 2026, option A) on the Dashboard as it is shown now, before any fetch: offline, the
// fetch never comes (Codex r1–r3 on #578).
import type { MobileBootstrap, QueuedEvent } from "./api";
import { isWaitingLockScreenStop, projectDurableLocalWork } from "./durableLocalProjection";
import type { MobileAccountOwner } from "./mobileAccount";

export type WaitingLockScreenStopsDependencies = {
  /** The Dashboard as shown now. */
  shown(): MobileBootstrap | null;
  ownerOf(bootstrap: MobileBootstrap): MobileAccountOwner;
  /** This account's queued events that may be Lock Screen Stops: the app's queue and the native one. */
  readStops(owner: MobileAccountOwner): Promise<QueuedEvent[]>;
  revision(): number;
  /** Publishes as a local change: advances the mutation revision first, so a refresh already in flight
   * (which may have read the queue before the Stop) is reconciled, not applied over it (Codex r3). */
  publishAsMutation(next: MobileBootstrap): void;
};

/**
 * Applies only the waiting Lock Screen Stops, each only to its own block, to the Dashboard shown, and
 * publishes only when that stops the block shown running and nothing changed while reading. Overlapping
 * calls (a foreground and a load) share one read.
 */
export function createWaitingLockScreenStopsApplier(dependencies: WaitingLockScreenStopsDependencies) {
  let running: Promise<void> | null = null;
  const run = async () => {
    const shown = dependencies.shown();
    if (!shown?.activeEntry) return;
    const revision = dependencies.revision();
    const owner = dependencies.ownerOf(shown);
    const stops = (await dependencies.readStops(owner).catch(() => [])).filter(isWaitingLockScreenStop);
    if (!stops.length) return;
    if (dependencies.shown() !== shown || dependencies.revision() !== revision) return;
    const next = projectDurableLocalWork(shown, {
      owner,
      activityEvents: stops,
      timeEntryCommands: [],
      timerStops: [],
      correlations: new Map()
    });
    if (next.activeEntry?.id === shown.activeEntry.id) return;
    dependencies.publishAsMutation(next);
  };
  return () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };
}
