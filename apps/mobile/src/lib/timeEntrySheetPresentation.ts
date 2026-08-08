export type TimeEntrySheetOpenReason =
  | "blank_timer_started"
  | "existing_active_timer"
  | "completed_entry"
  | "add_past_time"
  | "review_edit";

export type TimeEntrySheetPresentation = {
  id: number;
  reason: TimeEntrySheetOpenReason;
  requestDescriptionFocus: boolean;
  allowSuggestionsOnFocus: boolean;
};

export type TimeEntrySheetPhase =
  | "closed"
  | "opening"
  | "presented"
  | "dismiss_requested"
  | "dismissing"
  | "exited";

export type TimeEntrySheetKeyboardPhase =
  | "hidden"
  | "focus_requested"
  | "presenting"
  | "visible"
  | "interactive_dismissal"
  | "dismissing";

export type TimeEntrySheetSuggestionsPhase =
  | "closed"
  | "opening"
  | "visible"
  | "updating"
  | "closing";

export type TimeEntrySheetMutationPhase = "idle" | "saving" | "stopping" | "deleting";
export type TimeEntrySheetSurface = "form" | "date_picker";
export type TimeEntrySheetSwipePhase = "idle" | "dragging" | "settling" | "committed";

export type TimeEntrySheetKeyboardFrame = {
  inset: number;
  sequence: number;
};

export type TimeEntrySheetState = {
  active: boolean;
  anchorReady: boolean;
  appState: "active" | "background";
  baseGeometryRevision: number;
  descriptionFocused: boolean;
  focusCommandConsumed: boolean;
  focusConfirmed: boolean;
  focusOwnershipReady: boolean;
  hashtagQueryActive: boolean;
  inputReady: boolean;
  keyboardFrame: TimeEntrySheetKeyboardFrame | null;
  keyboardPhase: TimeEntrySheetKeyboardPhase;
  keyboardSessionToken: number | null;
  lastKeyboardSessionToken: number;
  lastPresentationId: number;
  modalShown: boolean;
  mutationPhase: TimeEntrySheetMutationPhase;
  mutationToken: number | null;
  pendingKeyboardFrame: TimeEntrySheetKeyboardFrame | null;
  presentation: TimeEntrySheetPresentation | null;
  reduceMotion: boolean;
  sheetPhase: TimeEntrySheetPhase;
  sheetPresented: boolean;
  suggestionResultCount: number;
  suggestionsPhase: TimeEntrySheetSuggestionsPhase;
  suggestionsSuppressed: boolean;
  surface: TimeEntrySheetSurface;
  swipePhase: TimeEntrySheetSwipePhase;
};

export type TimeEntrySheetEvent =
  | { type: "open_requested"; presentation: TimeEntrySheetPresentation; reduceMotion: boolean }
  | { type: "externally_hidden"; presentationId: number }
  | { type: "modal_shown"; presentationId: number }
  | { type: "sheet_presented"; presentationId: number }
  | { type: "description_input_ready"; presentationId: number }
  | { type: "description_anchor_ready"; presentationId: number }
  | { type: "focus_ownership_reset"; presentationId: number }
  | { type: "description_focus_effect_started"; presentationId: number }
  | { type: "description_focused"; presentationId: number }
  | { type: "description_blurred"; presentationId: number }
  | { type: "description_query_changed"; presentationId: number }
  | { type: "hashtag_query_changed"; presentationId: number; active: boolean }
  | { type: "suggestion_results_changed"; presentationId: number; count: number }
  | { type: "suggestions_animation_finished"; presentationId: number; direction: "open" | "close" }
  | { type: "suggestion_selected"; presentationId: number }
  | { type: "suggestion_selection_failed"; presentationId: number }
  | { type: "date_picker_requested"; presentationId: number }
  | { type: "date_picker_closed"; presentationId: number }
  | {
      type: "keyboard_focus_requested";
      presentationId: number;
      sessionToken: number;
    }
  | {
      type: "keyboard_frame_changed";
      presentationId: number;
      frame: TimeEntrySheetKeyboardFrame;
      interactive: boolean;
      sessionToken: number;
    }
  | {
      type: "keyboard_hidden";
      presentationId: number;
      sessionToken: number;
    }
  | { type: "swipe_started"; presentationId: number }
  | { type: "swipe_cancelled"; presentationId: number }
  | { type: "dismiss_requested"; presentationId: number }
  | { type: "dismiss_committed"; presentationId: number }
  | { type: "sheet_exit_finished"; presentationId: number }
  | {
      type: "mutation_started";
      presentationId: number;
      mutation: Exclude<TimeEntrySheetMutationPhase, "idle">;
      operationToken: number;
    }
  | {
      type: "mutation_finished";
      presentationId: number;
      operationToken: number;
      outcome: "succeeded" | "failed";
    }
  | { type: "app_backgrounded"; presentationId: number }
  | { type: "app_foregrounded"; presentationId: number }
  | { type: "reduce_motion_changed"; presentationId: number; reduceMotion: boolean }
  | { type: "base_geometry_invalidated"; presentationId: number };

export function createClosedTimeEntrySheetState(): TimeEntrySheetState {
  return {
    active: false,
    anchorReady: false,
    appState: "active",
    baseGeometryRevision: 0,
    descriptionFocused: false,
    focusCommandConsumed: false,
    focusConfirmed: false,
    focusOwnershipReady: false,
    hashtagQueryActive: false,
    inputReady: false,
    keyboardFrame: null,
    keyboardPhase: "hidden",
    keyboardSessionToken: null,
    lastKeyboardSessionToken: 0,
    lastPresentationId: 0,
    modalShown: false,
    mutationPhase: "idle",
    mutationToken: null,
    pendingKeyboardFrame: null,
    presentation: null,
    reduceMotion: false,
    sheetPhase: "closed",
    sheetPresented: false,
    suggestionResultCount: 0,
    suggestionsPhase: "closed",
    suggestionsSuppressed: false,
    surface: "form",
    swipePhase: "idle"
  };
}

export function timeEntrySheetReducer(
  state: TimeEntrySheetState,
  event: TimeEntrySheetEvent
): TimeEntrySheetState {
  if (event.type === "open_requested") {
    if (!isValidPresentation(event.presentation)) return state;
    if (event.presentation.id <= state.lastPresentationId) return state;
    return {
      ...createClosedTimeEntrySheetState(),
      active: true,
      appState: state.appState,
      keyboardPhase: event.presentation.requestDescriptionFocus ? "focus_requested" : "hidden",
      lastKeyboardSessionToken: state.lastKeyboardSessionToken,
      lastPresentationId: event.presentation.id,
      presentation: event.presentation,
      reduceMotion: event.reduceMotion,
      sheetPhase: "opening"
    };
  }

  if (!isCurrentPresentation(state, event.presentationId)) return state;

  let next = state;
  switch (event.type) {
    case "externally_hidden":
      return {
        ...createClosedTimeEntrySheetState(),
        appState: state.appState,
        lastKeyboardSessionToken: state.lastKeyboardSessionToken,
        lastPresentationId: state.lastPresentationId,
        reduceMotion: state.reduceMotion
      };
    case "modal_shown":
      next = { ...state, modalShown: true };
      break;
    case "sheet_presented":
      if (state.sheetPhase !== "opening") return state;
      next = { ...state, sheetPhase: "presented", sheetPresented: true };
      break;
    case "description_input_ready":
      next = { ...state, inputReady: true };
      break;
    case "description_anchor_ready":
      next = { ...state, anchorReady: true };
      break;
    case "focus_ownership_reset":
      next = { ...state, focusOwnershipReady: true };
      break;
    case "description_focus_effect_started":
      if (!pendingDescriptionFocusPresentationId(state)) return state;
      next = {
        ...state,
        focusCommandConsumed: true,
        keyboardPhase: "focus_requested"
      };
      break;
    case "description_focused":
      if (
        !state.focusOwnershipReady ||
        state.appState !== "active" ||
        state.sheetPhase !== "presented"
      ) return state;
      next = {
        ...state,
        descriptionFocused: true,
        focusConfirmed: state.focusConfirmed || state.focusCommandConsumed,
        keyboardPhase: state.keyboardPhase === "hidden" ? "presenting" : state.keyboardPhase,
        suggestionsSuppressed: state.descriptionFocused ? state.suggestionsSuppressed : false,
        surface: "form"
      };
      break;
    case "description_blurred":
      next = {
        ...state,
        descriptionFocused: false,
        suggestionsSuppressed: false
      };
      break;
    case "description_query_changed":
      next = {
        ...state,
        suggestionsPhase: state.suggestionsPhase === "visible"
          ? "updating"
          : state.suggestionsPhase,
        suggestionsSuppressed: false
      };
      break;
    case "hashtag_query_changed":
      next = { ...state, hashtagQueryActive: event.active };
      break;
    case "suggestion_results_changed":
      next = {
        ...state,
        suggestionResultCount: Math.max(0, Math.floor(event.count))
      };
      if (
        state.suggestionsPhase === "updating" &&
        canShowHistoricalSuggestions(next)
      ) {
        next = { ...next, suggestionsPhase: "visible" };
      }
      break;
    case "suggestions_animation_finished":
      if (event.direction === "open") {
        if (!canShowHistoricalSuggestions(state)) {
          next = { ...state, suggestionsPhase: "closing" };
        } else if (state.suggestionsPhase === "opening") {
          next = { ...state, suggestionsPhase: "visible" };
        }
      } else if (state.suggestionsPhase === "closing") {
        next = { ...state, suggestionsPhase: "closed" };
      }
      break;
    case "suggestion_selected":
      next = { ...state, suggestionsSuppressed: true };
      break;
    case "suggestion_selection_failed":
      next = { ...state, suggestionsSuppressed: false };
      break;
    case "date_picker_requested":
      next = {
        ...state,
        descriptionFocused: false,
        surface: "date_picker",
        suggestionsSuppressed: true
      };
      break;
    case "date_picker_closed":
      next = { ...state, surface: "form" };
      break;
    case "keyboard_focus_requested":
      if (
        state.appState !== "active" ||
        state.sheetPhase !== "presented" ||
        !Number.isSafeInteger(event.sessionToken) ||
        event.sessionToken <= state.lastKeyboardSessionToken
      ) {
        return state;
      }
      next = {
        ...state,
        keyboardPhase: "focus_requested",
        keyboardSessionToken: event.sessionToken,
        lastKeyboardSessionToken: event.sessionToken
      };
      break;
    case "keyboard_frame_changed": {
      if (
        state.appState !== "active" ||
        state.keyboardSessionToken !== event.sessionToken
      ) {
        return state;
      }
      if (state.swipePhase === "dragging" || state.swipePhase === "settling") {
        next = { ...state, pendingKeyboardFrame: event.frame };
        break;
      }
      const inset = Math.max(0, event.frame.inset);
      const isInteractiveDismissal = (
        event.interactive &&
        state.keyboardFrame !== null &&
        inset < state.keyboardFrame.inset
      );
      next = {
        ...state,
        keyboardFrame: { ...event.frame, inset },
        keyboardPhase: inset === 0
          ? "hidden"
          : isInteractiveDismissal
            ? "interactive_dismissal"
            : "visible",
        pendingKeyboardFrame: null
      };
      break;
    }
    case "keyboard_hidden":
      if (
        state.appState !== "active" ||
        state.keyboardSessionToken !== event.sessionToken
      ) {
        return state;
      }
      next = {
        ...state,
        keyboardFrame: null,
        keyboardPhase: "hidden",
        keyboardSessionToken: null,
        pendingKeyboardFrame: null
      };
      break;
    case "swipe_started":
      if (state.sheetPhase !== "presented" || state.mutationPhase !== "idle") return state;
      next = { ...state, swipePhase: "dragging" };
      break;
    case "swipe_cancelled": {
      if (state.swipePhase !== "dragging" && state.swipePhase !== "settling") return state;
      const pending = state.pendingKeyboardFrame;
      next = {
        ...state,
        keyboardFrame: pending ?? state.keyboardFrame,
        keyboardPhase: pending
          ? pending.inset > 0 ? "visible" : "hidden"
          : state.keyboardPhase,
        pendingKeyboardFrame: null,
        swipePhase: "idle"
      };
      break;
    }
    case "dismiss_requested":
      if (state.sheetPhase !== "presented" || state.mutationPhase !== "idle") return state;
      next = {
        ...state,
        descriptionFocused: false,
        sheetPhase: "dismiss_requested",
        suggestionsSuppressed: true
      };
      break;
    case "dismiss_committed":
      if (
        state.mutationPhase !== "idle" ||
        state.sheetPhase !== "opening" &&
        state.sheetPhase !== "presented" &&
        state.sheetPhase !== "dismiss_requested"
      ) return state;
      next = {
        ...state,
        descriptionFocused: false,
        keyboardPhase: state.keyboardPhase === "hidden" ? "hidden" : "dismissing",
        pendingKeyboardFrame: null,
        sheetPhase: "dismissing",
        suggestionsSuppressed: true,
        swipePhase: "committed"
      };
      break;
    case "sheet_exit_finished":
      if (state.sheetPhase !== "dismissing") return state;
      next = {
        ...state,
        active: false,
        keyboardFrame: null,
        keyboardPhase: "hidden",
        keyboardSessionToken: null,
        pendingKeyboardFrame: null,
        sheetPhase: "exited",
        suggestionsPhase: "closed"
      };
      break;
    case "mutation_started":
      if (
        state.mutationPhase !== "idle" ||
        state.sheetPhase !== "presented" ||
        state.swipePhase !== "idle"
      ) return state;
      next = {
        ...state,
        mutationPhase: event.mutation,
        mutationToken: event.operationToken
      };
      break;
    case "mutation_finished":
      if (state.mutationToken !== event.operationToken) return state;
      next = {
        ...state,
        mutationPhase: "idle",
        mutationToken: null
      };
      break;
    case "app_backgrounded":
      next = {
        ...state,
        appState: "background",
        descriptionFocused: false,
        // A native focus command can be consumed immediately before iOS moves
        // the app to the background. If onFocus never confirms that command,
        // release it so the same presentation can retry after foregrounding.
        focusCommandConsumed: state.focusConfirmed ? state.focusCommandConsumed : false,
        keyboardFrame: null,
        keyboardPhase: "hidden",
        keyboardSessionToken: null,
        pendingKeyboardFrame: null,
        swipePhase: state.swipePhase === "committed" ? "committed" : "idle"
      };
      break;
    case "app_foregrounded":
      next = {
        ...state,
        appState: "active",
        keyboardFrame: null,
        keyboardPhase: "hidden",
        keyboardSessionToken: null,
        pendingKeyboardFrame: null
      };
      break;
    case "reduce_motion_changed":
      next = { ...state, reduceMotion: event.reduceMotion };
      break;
    case "base_geometry_invalidated":
      next = {
        ...state,
        anchorReady: false,
        baseGeometryRevision: state.baseGeometryRevision + 1
      };
      break;
    default:
      return state;
  }

  return reconcileSuggestions(next);
}

export function pendingDescriptionFocusPresentationId(
  state: TimeEntrySheetState
): number | null {
  if (
    !state.active ||
    state.appState !== "active" ||
    state.sheetPhase !== "presented" ||
    !state.modalShown ||
    !state.sheetPresented ||
    !state.inputReady ||
    !state.anchorReady ||
    !state.focusOwnershipReady ||
    state.focusCommandConsumed ||
    !state.presentation?.requestDescriptionFocus
  ) {
    return null;
  }
  return state.presentation.id;
}

export function pendingTimeEntrySheetDismissRequestId({
  dismissRequestId,
  handledDismissRequestId,
  state,
  visible
}: {
  dismissRequestId: number | null | undefined;
  handledDismissRequestId: number | null;
  state: TimeEntrySheetState;
  visible: boolean;
}): number | null {
  if (
    !visible ||
    !Number.isSafeInteger(dismissRequestId) ||
    dismissRequestId === handledDismissRequestId ||
    dismissRequestId !== state.presentation?.id ||
    state.sheetPhase !== "presented"
  ) {
    return null;
  }
  return dismissRequestId ?? null;
}

export function historicalSuggestionsVisibleTarget(state: TimeEntrySheetState) {
  return canShowHistoricalSuggestions(state);
}

export function historicalSuggestionsObscureFormAccessibility(
  state: TimeEntrySheetState,
  overlayRenderable = true
) {
  return overlayRenderable && state.suggestionsPhase !== "closed";
}

export function classifyTimeEntrySheetDeferredFocus({
  currentPresentationId,
  currentSequence,
  requestPresentationId,
  requestSequence,
  state
}: {
  currentPresentationId: number;
  currentSequence: number;
  requestPresentationId: number;
  requestSequence: number;
  state: TimeEntrySheetState;
}): "accepted" | "cancelled" | "stale" {
  if (
    requestPresentationId !== currentPresentationId ||
    state.presentation?.id !== requestPresentationId
  ) {
    return "stale";
  }
  if (
    requestSequence !== currentSequence ||
    !state.active ||
    state.appState !== "active" ||
    state.sheetPhase !== "presented" ||
    state.swipePhase !== "idle" ||
    state.mutationPhase !== "idle"
  ) {
    return "cancelled";
  }
  return "accepted";
}

export function timeEntrySheetInvariantViolations(state: TimeEntrySheetState): string[] {
  const violations: string[] = [];
  if (state.sheetPhase === "closed" && state.active) {
    violations.push("closed sheet cannot be active");
  }
  if (state.sheetPhase === "closed" && state.presentation !== null) {
    violations.push("closed sheet cannot retain a presentation");
  }
  if (state.surface === "date_picker" && state.suggestionsPhase === "visible") {
    violations.push("date picker and Suggestions cannot both be visible");
  }
  if (state.focusConfirmed && !state.focusOwnershipReady) {
    violations.push("confirmed Description focus requires reset native focus ownership");
  }
  if (
    state.suggestionsPhase === "visible" &&
    (!state.descriptionFocused || state.hashtagQueryActive)
  ) {
    violations.push("visible Suggestions require Description focus without hashtag precedence");
  }
  if (state.sheetPhase === "exited" && state.active) {
    violations.push("exited sheet cannot remain active");
  }
  if (state.swipePhase === "committed" && state.sheetPhase !== "dismissing" && state.sheetPhase !== "exited") {
    violations.push("committed swipe requires a dismissing or exited sheet");
  }
  if (
    state.appState === "background" &&
    (
      state.keyboardSessionToken !== null ||
      state.keyboardFrame !== null ||
      state.pendingKeyboardFrame !== null ||
      state.keyboardPhase !== "hidden"
    )
  ) {
    violations.push("background sheet cannot retain keyboard ownership");
  }
  if (state.keyboardFrame !== null && state.keyboardSessionToken === null) {
    violations.push("keyboard frames require an active keyboard session");
  }
  if (state.mutationPhase !== "idle" && state.swipePhase !== "idle") {
    violations.push("mutation and swipe cannot own the sheet together");
  }
  return violations;
}

function reconcileSuggestions(state: TimeEntrySheetState): TimeEntrySheetState {
  const shouldShow = canShowHistoricalSuggestions(state);
  if (shouldShow) {
    if (state.suggestionsPhase === "closed" || state.suggestionsPhase === "closing") {
      return { ...state, suggestionsPhase: "opening" };
    }
    return state;
  }
  if (
    state.suggestionsPhase === "opening" ||
    state.suggestionsPhase === "visible" ||
    state.suggestionsPhase === "updating"
  ) {
    return { ...state, suggestionsPhase: "closing" };
  }
  return state;
}

function canShowHistoricalSuggestions(state: TimeEntrySheetState) {
  return Boolean(
    state.presentation?.allowSuggestionsOnFocus &&
    state.sheetPhase === "presented" &&
    state.appState === "active" &&
    state.descriptionFocused &&
    state.surface === "form" &&
    !state.hashtagQueryActive &&
    !state.suggestionsSuppressed &&
    state.suggestionResultCount > 0
  );
}

function isCurrentPresentation(
  state: TimeEntrySheetState,
  presentationId: number
) {
  return state.presentation?.id === presentationId;
}

function isValidPresentation(presentation: TimeEntrySheetPresentation) {
  return Number.isSafeInteger(presentation.id) && presentation.id > 0;
}
