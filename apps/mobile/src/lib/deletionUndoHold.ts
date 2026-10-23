import { DELETION_UNDO_MS } from "./historyDeletion";
import type { MobileAccountOwner } from "./mobileAccount";
import {
  createTimeEntryCommandHoldLease,
  enqueueTimeEntryDelete,
  extendTimeEntryCommandHold,
  removeTimeEntryCommands,
  wereTimeEntryCommandsDispatched,
  type TimeEntryCommandHoldLease,
  type TimeEntryCommandTarget
} from "./timeEntryOutbox";

/** The durable hold outlasts the Undo window by a second, so a sync at its edge never races Undo. */
const UNDO_HOLD_MARGIN_MS = 1_000;

/**
 * The Undo owner's lifetime (the dashboard's deletion coordinator). End it when that owner goes away;
 * `onLapse` must close the matching Undo as if it expired: its delete is about to be delivered.
 */
export function createUndoHoldLease(onLapse: (clientCommandId: string) => void) {
  return createTimeEntryCommandHoldLease({ onLapse });
}

export function undoHoldDeliverAfter(fromMs: number) {
  return new Date(fromMs + DELETION_UNDO_MS + UNDO_HOLD_MARGIN_MS).toISOString();
}

/**
 * Writes one deletion's undoable deletes (stability audit timer-1), one after another. Each is held in
 * this process, under the Undo owner's `lease`, until the Undo lifecycle releases it (the window
 * closed) or removes it (Undo), however long a sheet takes to leave before the window opens. When the
 * lease ends first (sign-out, the dashboard going away), even mid-write, nothing stays held and each
 * durable `deliverAfter` lets its delete go, as after a force-quit. A failed write removes the ones
 * already written and rethrows.
 */
export async function persistUndoableTimeEntryDeletes(input: {
  lease: TimeEntryCommandHoldLease;
  owner: MobileAccountOwner;
  targets: readonly TimeEntryCommandTarget[];
}) {
  const commandIds: string[] = [];
  try {
    for (const target of input.targets) {
      const command = await enqueueTimeEntryDelete({
        owner: input.owner,
        target,
        deliverAfter: undoHoldDeliverAfter(Date.now()),
        holdLease: input.lease
      });
      commandIds.push(command.clientCommandId);
    }
    return commandIds;
  } catch (error) {
    await removeTimeEntryCommands(commandIds).catch(() => undefined);
    throw error;
  }
}

/** The Undo window has opened at `activatedAt`: the durable hold now covers all of it. */
export function holdDeletesForOpenedUndoWindow(commandIds: readonly string[], activatedAt: number) {
  return extendTimeEntryCommandHold(commandIds, undoHoldDeliverAfter(activatedAt));
}

/** Undo may restore only a delete no request was sent for; otherwise the server copy is gone. */
export function canUndoDeletes(commandIds: readonly string[]) {
  return !wereTimeEntryCommandsDispatched(commandIds);
}
