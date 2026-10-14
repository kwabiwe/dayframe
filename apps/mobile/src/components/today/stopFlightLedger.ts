/**
 * The Today Stop flight that may still act, kept synchronously beside React state (Codex r2–r4 on #415).
 *
 * A flight's completion, its Stop's acceptance and its rollback arrive from different callbacks, and any of
 * them may run before React commits the others. The ledger is the one synchronous answer to "is this flight
 * still live?": a completion queued before a logout, a newer flight, a rejection or a refresh that restores
 * the running block can never land on a row that is running again.
 */
export type StopFlightLedger = {
  /** A measured flight for `entryId` is live from now on. */
  begin(token: number, entryId: string): void;
  isLive(token: number): boolean;
  /** Clears the live flight: only `token`'s, or whatever is live when omitted (logout). */
  clear(token?: number): void;
  /** Cancels the live flight if it is for `entryId` (rollback). Returns the cancelled token. */
  cancelFor(entryId: string): number | null;
  /**
   * Called before every publication of dashboard data. A publication that shows the flown block running
   * again after it was not (a refresh or projection restoring a rejected Stop) cancels its flight in the
   * same call, before anything renders. Returns the cancelled token.
   */
  published(previousActiveId: string | null | undefined, nextActiveId: string | null | undefined): number | null;
  /** The ghost finished: true once, for the live flight only. */
  finish(token: number): boolean;
};

export function createStopFlightLedger(resolveEntryId: (entryId: string) => string = (id) => id): StopFlightLedger {
  let liveToken: number | null = null;
  let liveEntryId: string | null = null;
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    Boolean(a && b && resolveEntryId(a) === resolveEntryId(b));
  const reset = () => {
    liveToken = null;
    liveEntryId = null;
  };
  const ledger: StopFlightLedger = {
    begin(token, entryId) {
      liveToken = token;
      liveEntryId = entryId;
    },
    isLive: (token) => liveToken === token,
    clear(token) {
      if (token === undefined || liveToken === token) reset();
    },
    cancelFor(entryId) {
      if (liveToken === null || !same(liveEntryId, entryId)) return null;
      const token = liveToken;
      reset();
      return token;
    },
    published(previousActiveId, nextActiveId) {
      // Before the Stop is applied the block is still showing: publications then (a tick, a refresh that
      // read the running block) are not a restoration and keep the flight.
      if (liveToken === null || same(previousActiveId, liveEntryId) || !same(nextActiveId, liveEntryId)) return null;
      return ledger.cancelFor(nextActiveId as string);
    },
    finish(token) {
      if (liveToken !== token) return false;
      reset();
      return true;
    }
  };
  return ledger;
}
