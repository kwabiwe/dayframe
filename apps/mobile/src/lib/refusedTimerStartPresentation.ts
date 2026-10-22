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
  /** The entry a Calendar editor still on screen is showing, if any. */
  calendarEditorEntryId: string | null;
};

export type RefusedTimerStartPresentation =
  | { run: false }
  | { run: true; alert: boolean; dismissCalendarEditor: boolean };

export function refusedTimerStartPresentation(input: RefusedTimerStartPresentationInput): RefusedTimerStartPresentation {
  if (!input.ownerMatches) return { run: false };
  const dismissCalendarEditor = input.calendarEditorEntryId === input.localId;
  return {
    run: true,
    // An editor open on the block is on screen even when a refresh already took its row (Codex r2 on
    // #532), so it never closes without the explanation.
    alert: input.shown || input.deletionPending || dismissCalendarEditor,
    dismissCalendarEditor
  };
}
