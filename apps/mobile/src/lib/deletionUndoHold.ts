import { DELETION_UNDO_MS } from "./historyDeletion";
import type { MobileAccountOwner } from "./mobileAccount";
import {
  enqueueTimeEntryDelete,
  extendTimeEntryCommandHold,
  wereTimeEntryCommandsDispatched,
  type TimeEntryCommandTarget
} from "./timeEntryOutbox";

/** The durable hold outlasts the Undo window by a second, so a sync at its edge never races Undo. */
const UNDO_HOLD_MARGIN_MS = 1_000;

export function undoHoldDeliverAfter(fromMs: number) {
  return new Date(fromMs + DELETION_UNDO_MS + UNDO_HOLD_MARGIN_MS).toISOString();
}

/**
 * Writes an undoable delete (stability audit timer-1). It is held in this process until the Undo
 * lifecycle releases it (the window closed) or removes it (Undo), however long a sheet takes to leave
 * before the window opens. A force-quit keeps it durable: its `deliverAfter` then lets it go.
 */
export function enqueueUndoableTimeEntryDelete(input: {
  owner: MobileAccountOwner;
  target: TimeEntryCommandTarget;
}) {
  return enqueueTimeEntryDelete({
    owner: input.owner,
    target: input.target,
    deliverAfter: undoHoldDeliverAfter(Date.now()),
    holdUntilReleased: true
  });
}

/** The Undo window has opened at `activatedAt`: the durable hold now covers all of it. */
export function holdDeletesForOpenedUndoWindow(commandIds: readonly string[], activatedAt: number) {
  return extendTimeEntryCommandHold(commandIds, undoHoldDeliverAfter(activatedAt));
}

/** Undo may restore only a delete no request was sent for; otherwise the server copy is gone. */
export function canUndoDeletes(commandIds: readonly string[]) {
  return !wereTimeEntryCommandsDispatched(commandIds);
}
