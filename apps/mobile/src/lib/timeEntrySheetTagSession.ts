export type DescriptionSelection = {
  end: number;
  start: number;
};

export type PendingDescriptionSelectionSync = {
  expected: DescriptionSelection;
  previous: DescriptionSelection;
};

export type TimeEntrySheetTagSession = {
  activeHashtag: boolean;
  focusRequestId: number | null;
  lastFocusRequestId: number;
  presentationId: number;
};

export type TimeEntrySheetTagSessionEvent =
  | { type: "presentation_opened"; presentationId: number }
  | {
      type: "hashtag_changed";
      active: boolean;
      presentationId: number;
      requestFocus: boolean;
    }
  | { type: "description_blurred"; presentationId: number }
  | { type: "description_focused"; presentationId: number }
  | { type: "hashtag_consumed"; presentationId: number }
  | { type: "cancelled"; presentationId: number };

export function createTimeEntrySheetTagSession(
  presentationId = 0,
  lastFocusRequestId = 0
): TimeEntrySheetTagSession {
  return {
    activeHashtag: false,
    focusRequestId: null,
    lastFocusRequestId,
    presentationId
  };
}

/**
 * Keeps hashtag ownership stable across the native responder hand-off caused by
 * tapping Add a tag or a chooser row. UIKit may deliver blur after the press
 * callback, so blur requests another monotonic focus attempt instead of
 * clearing the chooser. Explicit cancellation is the only blur-adjacent path
 * that clears ownership.
 */
export function timeEntrySheetTagSessionReducer(
  state: TimeEntrySheetTagSession,
  event: TimeEntrySheetTagSessionEvent
): TimeEntrySheetTagSession {
  if (event.type === "presentation_opened") {
    return createTimeEntrySheetTagSession(
      event.presentationId,
      state.lastFocusRequestId + 1
    );
  }
  if (event.presentationId !== state.presentationId) return state;

  switch (event.type) {
    case "hashtag_changed":
      if (!event.active) {
        return {
          ...state,
          activeHashtag: false
        };
      }
      if (!event.requestFocus) {
        return { ...state, activeHashtag: true };
      }
      return requestFocus({ ...state, activeHashtag: true });
    case "description_blurred":
      return state.activeHashtag ? requestFocus(state) : state;
    case "description_focused":
      return { ...state, focusRequestId: null };
    case "hashtag_consumed":
      return requestFocus({ ...state, activeHashtag: false });
    case "cancelled":
      return {
        ...state,
        activeHashtag: false,
        focusRequestId: null,
        lastFocusRequestId: state.lastFocusRequestId + 1
      };
  }
}

export function createPendingDescriptionSelectionSync(
  previous: DescriptionSelection,
  expected: DescriptionSelection
): PendingDescriptionSelectionSync | null {
  return selectionsEqual(previous, expected) ? null : { expected, previous };
}

/**
 * A controlled TextInput can emit the old native caret after onChangeText has
 * already derived the new one. Ignore only that known stale echo; accept the
 * expected acknowledgement or any genuinely different user selection.
 */
export function resolveDescriptionSelectionEvent({
  nextSelection,
  pending,
  textLength
}: {
  nextSelection: DescriptionSelection;
  pending: PendingDescriptionSelectionSync | null;
  textLength: number;
}): {
  accepted: boolean;
  pending: PendingDescriptionSelectionSync | null;
  selection: DescriptionSelection;
} {
  const selection = clampSelection(nextSelection, textLength);
  if (!pending) return { accepted: true, pending: null, selection };
  if (
    selectionsEqual(selection, pending.previous) &&
    !selectionsEqual(pending.previous, pending.expected)
  ) {
    return { accepted: false, pending, selection: pending.expected };
  }
  return { accepted: true, pending: null, selection };
}

function requestFocus(state: TimeEntrySheetTagSession): TimeEntrySheetTagSession {
  const focusRequestId = state.lastFocusRequestId + 1;
  return {
    ...state,
    focusRequestId,
    lastFocusRequestId: focusRequestId
  };
}

function clampSelection(
  selection: DescriptionSelection,
  textLength: number
): DescriptionSelection {
  const safeLength = Math.max(0, Math.floor(textLength));
  const start = Math.max(0, Math.min(safeLength, Math.floor(selection.start)));
  const end = Math.max(start, Math.min(safeLength, Math.floor(selection.end)));
  return { start, end };
}

function selectionsEqual(
  left: DescriptionSelection,
  right: DescriptionSelection
) {
  return left.start === right.start && left.end === right.end;
}
