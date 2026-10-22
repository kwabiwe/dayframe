// What Today does when the server refuses a queued Start (stability audit 22 Oct 2026,
// iphone-timer-sync-3; Codex r1 on #532). The clean-up always runs for the signed-in account, shown or
// not, so a block hidden by a pending delete can't be brought back by Undo; the "Block not started"
// alert appears only if the person could see the block; an editor open on it leaves by its own exit.

export type RefusedTimerStartPresentationInput = {
  localId: string;
  ownerMatches: boolean;
  /** The block is on screen: running, in today's list, or still tracked as an optimistic Start. */
  shown: boolean;
  /** A delete of the block is pending (hidden, with Undo). */
  deletionPending: boolean;
  /** The entry an open Calendar editor is showing, if any. */
  calendarEditorEntryId: string | null;
};

export type RefusedTimerStartPresentation =
  | { run: false }
  | { run: true; alert: boolean; dismissCalendarEditor: boolean };

export function refusedTimerStartPresentation(input: RefusedTimerStartPresentationInput): RefusedTimerStartPresentation {
  if (!input.ownerMatches) return { run: false };
  return {
    run: true,
    alert: input.shown || input.deletionPending,
    dismissCalendarEditor: input.calendarEditorEntryId === input.localId
  };
}
