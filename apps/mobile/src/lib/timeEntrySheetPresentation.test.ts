import { describe, expect, it } from "vitest";
import {
  classifyTimeEntrySheetDeferredFocus,
  createClosedTimeEntrySheetState,
  historicalSuggestionsObscureFormAccessibility,
  historicalSuggestionsVisibleTarget,
  pendingDescriptionFocusPresentationId,
  pendingTimeEntrySheetDismissRequestId,
  timeEntrySheetInvariantViolations,
  timeEntrySheetReducer,
  type TimeEntrySheetEvent,
  type TimeEntrySheetPresentation,
  type TimeEntrySheetState
} from "./timeEntrySheetPresentation";

const BLANK_PRESENTATION: TimeEntrySheetPresentation = {
  id: 11,
  reason: "blank_timer_started",
  requestDescriptionFocus: true,
  allowSuggestionsOnFocus: true
};

const EXISTING_PRESENTATION: TimeEntrySheetPresentation = {
  id: 12,
  reason: "existing_active_timer",
  requestDescriptionFocus: false,
  allowSuggestionsOnFocus: true
};

const REVIEW_PRESENTATION: TimeEntrySheetPresentation = {
  id: 13,
  reason: "review_edit",
  requestDescriptionFocus: true,
  allowSuggestionsOnFocus: true
};

function open(
  presentation = BLANK_PRESENTATION,
  reduceMotion = false
): TimeEntrySheetState {
  return timeEntrySheetReducer(createClosedTimeEntrySheetState(), {
    type: "open_requested",
    presentation,
    reduceMotion
  });
}

function presented(presentation = BLANK_PRESENTATION, reduceMotion = false) {
  return [
    { type: "modal_shown", presentationId: presentation.id },
    { type: "description_input_ready", presentationId: presentation.id },
    { type: "description_anchor_ready", presentationId: presentation.id },
    { type: "focus_ownership_reset", presentationId: presentation.id },
    { type: "sheet_presented", presentationId: presentation.id }
  ].reduce(
    (state, event) => timeEntrySheetReducer(state, event as TimeEntrySheetEvent),
    open(presentation, reduceMotion)
  );
}

function acquireKeyboardSession(
  state: TimeEntrySheetState,
  presentationId: number,
  sessionToken = state.lastKeyboardSessionToken + 1
) {
  return timeEntrySheetReducer(state, {
    type: "keyboard_focus_requested",
    presentationId,
    sessionToken
  });
}

describe("time-entry sheet presentation focus", () => {
  it("waits for Modal, custom-sheet, input, anchor and native focus reset readiness", () => {
    let state = open();
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();

    state = timeEntrySheetReducer(state, { type: "modal_shown", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "description_input_ready", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "description_anchor_ready", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "sheet_presented", presentationId: 11 });
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();

    state = timeEntrySheetReducer(state, { type: "focus_ownership_reset", presentationId: 11 });
    expect(pendingDescriptionFocusPresentationId(state)).toBe(11);
  });

  it("discards an early native focus and keeps blank auto-focus eligible after presentation", () => {
    let state = open();
    for (const event of [
      { type: "modal_shown", presentationId: 11 },
      { type: "description_input_ready", presentationId: 11 },
      { type: "description_anchor_ready", presentationId: 11 },
      { type: "focus_ownership_reset", presentationId: 11 }
    ] satisfies TimeEntrySheetEvent[]) {
      state = timeEntrySheetReducer(state, event);
    }
    const opening = state;
    state = timeEntrySheetReducer(state, {
      type: "description_focused",
      presentationId: 11
    });
    expect(state).toBe(opening);
    expect(state.descriptionFocused).toBe(false);

    state = timeEntrySheetReducer(state, { type: "sheet_presented", presentationId: 11 });
    expect(pendingDescriptionFocusPresentationId(state)).toBe(11);
  });

  it("suppresses focus when dismissal owns an opening presentation", () => {
    let state = open();
    state = timeEntrySheetReducer(state, { type: "modal_shown", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "focus_ownership_reset", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 11 });
    expect(state.sheetPhase).toBe("dismissing");
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
    const dismissing = state;
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    expect(state).toBe(dismissing);
    state = timeEntrySheetReducer(state, { type: "sheet_presented", presentationId: 11 });
    expect(state).toBe(dismissing);
  });

  it("emits one focus command regardless of readiness event order", () => {
    const readinessEvents: TimeEntrySheetEvent[] = [
      { type: "modal_shown", presentationId: 11 },
      { type: "description_input_ready", presentationId: 11 },
      { type: "description_anchor_ready", presentationId: 11 },
      { type: "focus_ownership_reset", presentationId: 11 },
      { type: "sheet_presented", presentationId: 11 }
    ];

    for (const events of permutations(readinessEvents)) {
      let state = events.reduce(timeEntrySheetReducer, open());
      expect(pendingDescriptionFocusPresentationId(state)).toBe(11);
      state = timeEntrySheetReducer(state, {
        type: "description_focus_effect_started",
        presentationId: 11
      });
      expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
      const repeated = timeEntrySheetReducer(state, {
        type: "description_focus_effect_started",
        presentationId: 11
      });
      expect(repeated).toBe(state);
    }
  });

  it("never infers focus from an existing active timer's blank Description", () => {
    expect(pendingDescriptionFocusPresentationId(presented(EXISTING_PRESENTATION))).toBeNull();
  });

  it("resets focus and keyboard ownership before a mounted rapid reopen", () => {
    let state = presented();
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: BLANK_PRESENTATION.id
    });
    state = acquireKeyboardSession(state, BLANK_PRESENTATION.id);
    state = timeEntrySheetReducer(state, {
      type: "description_focused",
      presentationId: BLANK_PRESENTATION.id
    });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: BLANK_PRESENTATION.id,
      frame: { inset: 312, sequence: 1 },
      interactive: false,
      sessionToken: 1
    });
    expect(state.descriptionFocused).toBe(true);
    expect(state.keyboardPhase).toBe("visible");

    state = timeEntrySheetReducer(state, {
      type: "open_requested",
      presentation: EXISTING_PRESENTATION,
      reduceMotion: false
    });
    expect(state.descriptionFocused).toBe(false);
    expect(state.focusOwnershipReady).toBe(false);
    expect(state.keyboardFrame).toBeNull();
    expect(state.keyboardPhase).toBe("hidden");
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();

    const beforeLeakedFocus = state;
    state = timeEntrySheetReducer(state, {
      type: "description_focused",
      presentationId: EXISTING_PRESENTATION.id
    });
    expect(state).toBe(beforeLeakedFocus);

    state = timeEntrySheetReducer(state, {
      type: "focus_ownership_reset",
      presentationId: EXISTING_PRESENTATION.id
    });
    expect(state.focusOwnershipReady).toBe(true);
    expect(state.descriptionFocused).toBe(false);
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
  });

  it("honors a rapid reopen focus intent exactly once only after native reset", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = timeEntrySheetReducer(state, {
      type: "description_focused",
      presentationId: EXISTING_PRESENTATION.id
    });
    state = timeEntrySheetReducer(state, {
      type: "open_requested",
      presentation: REVIEW_PRESENTATION,
      reduceMotion: false
    });
    for (const event of [
      { type: "modal_shown", presentationId: REVIEW_PRESENTATION.id },
      { type: "description_input_ready", presentationId: REVIEW_PRESENTATION.id },
      { type: "description_anchor_ready", presentationId: REVIEW_PRESENTATION.id },
      { type: "sheet_presented", presentationId: REVIEW_PRESENTATION.id }
    ] satisfies TimeEntrySheetEvent[]) {
      state = timeEntrySheetReducer(state, event);
    }
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();

    state = timeEntrySheetReducer(state, {
      type: "focus_ownership_reset",
      presentationId: REVIEW_PRESENTATION.id
    });
    expect(pendingDescriptionFocusPresentationId(state)).toBe(REVIEW_PRESENTATION.id);
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: REVIEW_PRESENTATION.id
    });
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
    expect(timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: REVIEW_PRESENTATION.id
    })).toBe(state);
  });

  it("cancels an unconsumed request while backgrounded and recovers on foreground", () => {
    let state = presented();
    state = timeEntrySheetReducer(state, { type: "app_backgrounded", presentationId: 11 });
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
    state = timeEntrySheetReducer(state, { type: "app_foregrounded", presentationId: 11 });
    expect(pendingDescriptionFocusPresentationId(state)).toBe(11);
  });

  it("replays a consumed but unconfirmed focus command after background interruption", () => {
    let state = presented();
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: 11
    });
    state = acquireKeyboardSession(state, 11);
    expect(state.focusCommandConsumed).toBe(true);
    expect(state.focusConfirmed).toBe(false);
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();

    state = timeEntrySheetReducer(state, { type: "app_backgrounded", presentationId: 11 });
    expect(state.focusCommandConsumed).toBe(false);
    expect(state.keyboardPhase).toBe("hidden");
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
    const backgrounded = state;
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    expect(state).toBe(backgrounded);

    state = timeEntrySheetReducer(state, { type: "app_foregrounded", presentationId: 11 });
    expect(pendingDescriptionFocusPresentationId(state)).toBe(11);
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: 11
    });
    state = acquireKeyboardSession(state, 11);
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    expect(state.focusCommandConsumed).toBe(true);
    expect(state.focusConfirmed).toBe(true);
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
  });

  it("does not replay a focus command that was confirmed before backgrounding", () => {
    let state = presented();
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: 11
    });
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "app_backgrounded", presentationId: 11 });
    state = timeEntrySheetReducer(state, { type: "app_foregrounded", presentationId: 11 });

    expect(state.focusCommandConsumed).toBe(true);
    expect(state.focusConfirmed).toBe(true);
    expect(pendingDescriptionFocusPresentationId(state)).toBeNull();
  });

  it("accepts current deferred tag focus and silently cancels it after dismiss ownership", () => {
    const state = presented(EXISTING_PRESENTATION);
    expect(classifyTimeEntrySheetDeferredFocus({
      currentPresentationId: 12,
      currentSequence: 4,
      requestPresentationId: 12,
      requestSequence: 4,
      state
    })).toBe("accepted");

    const dismissing = timeEntrySheetReducer(state, {
      type: "dismiss_committed",
      presentationId: 12
    });
    expect(classifyTimeEntrySheetDeferredFocus({
      currentPresentationId: 12,
      currentSequence: 5,
      requestPresentationId: 12,
      requestSequence: 4,
      state: dismissing
    })).toBe("cancelled");
    expect(classifyTimeEntrySheetDeferredFocus({
      currentPresentationId: 13,
      currentSequence: 5,
      requestPresentationId: 12,
      requestSequence: 4,
      state: dismissing
    })).toBe("stale");
  });

  it("ignores every callback from an older presentation", () => {
    let state = presented(EXISTING_PRESENTATION);
    const before = state;
    const staleEvents: TimeEntrySheetEvent[] = [
      { type: "modal_shown", presentationId: 11 },
      { type: "sheet_presented", presentationId: 11 },
      { type: "focus_ownership_reset", presentationId: 11 },
      { type: "description_focused", presentationId: 11 },
      { type: "dismiss_committed", presentationId: 11 },
      { type: "sheet_exit_finished", presentationId: 11 }
    ];
    state = staleEvents.reduce(timeEntrySheetReducer, state);
    expect(state).toBe(before);
  });

  it("never reopens an older or reused presentation identity", () => {
    let state = presented(EXISTING_PRESENTATION);
    const current = state;
    state = timeEntrySheetReducer(state, {
      type: "open_requested",
      presentation: BLANK_PRESENTATION,
      reduceMotion: false
    });
    expect(state).toBe(current);
    state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 12 });
    state = timeEntrySheetReducer(state, { type: "sheet_exit_finished", presentationId: 12 });
    state = timeEntrySheetReducer(state, { type: "externally_hidden", presentationId: 12 });
    const closed = state;
    state = timeEntrySheetReducer(state, {
      type: "open_requested",
      presentation: EXISTING_PRESENTATION,
      reduceMotion: false
    });
    expect(state).toBe(closed);
    state = timeEntrySheetReducer(state, {
      type: "open_requested",
      presentation: { ...EXISTING_PRESENTATION, id: 13 },
      reduceMotion: false
    });
    expect(state.presentation?.id).toBe(13);
  });
});

describe("time-entry sheet Suggestions and picker precedence", () => {
  function focusedWithResults() {
    let state = presented(EXISTING_PRESENTATION);
    state = timeEntrySheetReducer(state, {
      type: "suggestion_results_changed",
      presentationId: 12,
      count: 8
    });
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 12 });
    return state;
  }

  it("opens only after deliberate Description focus and real results", () => {
    let state = presented(EXISTING_PRESENTATION);
    expect(historicalSuggestionsVisibleTarget(state)).toBe(false);
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 12 });
    expect(historicalSuggestionsVisibleTarget(state)).toBe(false);
    state = timeEntrySheetReducer(state, {
      type: "suggestion_results_changed",
      presentationId: 12,
      count: 2
    });
    expect(state.suggestionsPhase).toBe("opening");
    expect(historicalSuggestionsVisibleTarget(state)).toBe(true);
  });

  it("isolates the obscured form from accessibility until the overlay fully closes", () => {
    let state = focusedWithResults();
    expect(state.suggestionsPhase).toBe("opening");
    expect(historicalSuggestionsObscureFormAccessibility(state)).toBe(true);
    expect(historicalSuggestionsObscureFormAccessibility(state, false)).toBe(false);
    state = timeEntrySheetReducer(state, {
      type: "suggestions_animation_finished",
      presentationId: 12,
      direction: "open"
    });
    expect(historicalSuggestionsObscureFormAccessibility(state)).toBe(true);
    state = timeEntrySheetReducer(state, {
      type: "description_query_changed",
      presentationId: 12
    });
    expect(state.suggestionsPhase).toBe("updating");
    expect(historicalSuggestionsObscureFormAccessibility(state)).toBe(true);
    state = timeEntrySheetReducer(state, {
      type: "suggestion_selected",
      presentationId: 12
    });
    expect(state.suggestionsPhase).toBe("closing");
    expect(historicalSuggestionsObscureFormAccessibility(state)).toBe(true);
    state = timeEntrySheetReducer(state, {
      type: "suggestions_animation_finished",
      presentationId: 12,
      direction: "close"
    });
    expect(state.suggestionsPhase).toBe("closed");
    expect(historicalSuggestionsObscureFormAccessibility(state)).toBe(false);
  });

  it("lets hashtag autocomplete take precedence and resumes after ordinary typing", () => {
    let state = focusedWithResults();
    state = timeEntrySheetReducer(state, {
      type: "suggestions_animation_finished",
      presentationId: 12,
      direction: "open"
    });
    expect(state.suggestionsPhase).toBe("visible");
    state = timeEntrySheetReducer(state, {
      type: "hashtag_query_changed",
      presentationId: 12,
      active: true
    });
    expect(state.suggestionsPhase).toBe("closing");
    expect(historicalSuggestionsVisibleTarget(state)).toBe(false);
    state = timeEntrySheetReducer(state, {
      type: "hashtag_query_changed",
      presentationId: 12,
      active: false
    });
    expect(state.suggestionsPhase).toBe("opening");
  });

  it("settles visible to updating to visible for same-count and rapid query results", () => {
    let state = focusedWithResults();
    state = timeEntrySheetReducer(state, {
      type: "suggestions_animation_finished",
      presentationId: 12,
      direction: "open"
    });
    expect(state.suggestionsPhase).toBe("visible");
    state = timeEntrySheetReducer(state, {
      type: "description_query_changed",
      presentationId: 12
    });
    expect(state.suggestionsPhase).toBe("updating");
    state = timeEntrySheetReducer(state, {
      type: "suggestion_results_changed",
      presentationId: 12,
      count: 8
    });
    expect(state.suggestionsPhase).toBe("visible");

    for (const count of [12, 1, 9, 3, 11]) {
      state = timeEntrySheetReducer(state, {
        type: "description_query_changed",
        presentationId: 12
      });
      expect(state.suggestionsPhase).toBe("updating");
      state = timeEntrySheetReducer(state, {
        type: "suggestion_results_changed",
        presentationId: 12,
        count
      });
      expect(state.suggestionsPhase).toBe("visible");
      expect(state.suggestionResultCount).toBe(count);
    }
  });

  it("closes an updating overlay when a query returns no results", () => {
    let state = focusedWithResults();
    state = timeEntrySheetReducer(state, {
      type: "suggestions_animation_finished",
      presentationId: 12,
      direction: "open"
    });
    state = timeEntrySheetReducer(state, {
      type: "description_query_changed",
      presentationId: 12
    });
    expect(state.suggestionsPhase).toBe("updating");
    state = timeEntrySheetReducer(state, {
      type: "suggestion_results_changed",
      presentationId: 12,
      count: 0
    });
    expect(state.suggestionsPhase).toBe("closing");
  });

  it("keeps selection closed until a new query or focus cycle", () => {
    let state = focusedWithResults();
    state = timeEntrySheetReducer(state, { type: "suggestion_selected", presentationId: 12 });
    expect(state.suggestionsPhase).toBe("closing");
    state = timeEntrySheetReducer(state, {
      type: "suggestions_animation_finished",
      presentationId: 12,
      direction: "close"
    });
    expect(state.suggestionsPhase).toBe("closed");
    state = timeEntrySheetReducer(state, { type: "description_query_changed", presentationId: 12 });
    expect(state.suggestionsPhase).toBe("opening");
  });

  it("closes for a date picker and does not reopen when the picker closes", () => {
    let state = focusedWithResults();
    state = timeEntrySheetReducer(state, { type: "date_picker_requested", presentationId: 12 });
    expect(state.surface).toBe("date_picker");
    expect(state.descriptionFocused).toBe(false);
    expect(state.suggestionsPhase).toBe("closing");
    state = timeEntrySheetReducer(state, { type: "date_picker_closed", presentationId: 12 });
    expect(state.surface).toBe("form");
    expect(historicalSuggestionsVisibleTarget(state)).toBe(false);
  });
});

describe("time-entry sheet generation-scoped caller dismissal", () => {
  it("accepts one current request only after the sheet is presented", () => {
    let state = open(EXISTING_PRESENTATION);
    expect(pendingTimeEntrySheetDismissRequestId({
      dismissRequestId: EXISTING_PRESENTATION.id,
      handledDismissRequestId: null,
      state,
      visible: true
    })).toBeNull();

    state = presented(EXISTING_PRESENTATION);
    expect(pendingTimeEntrySheetDismissRequestId({
      dismissRequestId: EXISTING_PRESENTATION.id,
      handledDismissRequestId: null,
      state,
      visible: true
    })).toBe(EXISTING_PRESENTATION.id);
    expect(pendingTimeEntrySheetDismissRequestId({
      dismissRequestId: EXISTING_PRESENTATION.id,
      handledDismissRequestId: EXISTING_PRESENTATION.id,
      state,
      visible: true
    })).toBeNull();
  });

  it("ignores stale, hidden, and already-dismissing requests", () => {
    let state = presented(EXISTING_PRESENTATION);
    expect(pendingTimeEntrySheetDismissRequestId({
      dismissRequestId: BLANK_PRESENTATION.id,
      handledDismissRequestId: null,
      state,
      visible: true
    })).toBeNull();
    expect(pendingTimeEntrySheetDismissRequestId({
      dismissRequestId: EXISTING_PRESENTATION.id,
      handledDismissRequestId: null,
      state,
      visible: false
    })).toBeNull();

    state = timeEntrySheetReducer(state, {
      type: "dismiss_requested",
      presentationId: EXISTING_PRESENTATION.id
    });
    expect(pendingTimeEntrySheetDismissRequestId({
      dismissRequestId: EXISTING_PRESENTATION.id,
      handledDismissRequestId: null,
      state,
      visible: true
    })).toBeNull();
  });
});

describe("time-entry sheet keyboard, swipe and mutation interruptions", () => {
  it("reaches visible after an observed positive keyboard frame", () => {
    let state = presented();
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: 11
    });
    state = acquireKeyboardSession(state, 11);
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    expect(state.keyboardPhase).toBe("focus_requested");
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 11,
      frame: { inset: 312, sequence: 1 },
      interactive: false,
      sessionToken: 1
    });
    expect(state.keyboardPhase).toBe("visible");
  });

  it("drops keyboard and queued frames when the app backgrounds", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = acquireKeyboardSession(state, 12);
    state = timeEntrySheetReducer(state, { type: "swipe_started", presentationId: 12 });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 12,
      frame: { inset: 220, sequence: 1 },
      interactive: true,
      sessionToken: 1
    });
    state = timeEntrySheetReducer(state, { type: "app_backgrounded", presentationId: 12 });
    expect(state.keyboardPhase).toBe("hidden");
    expect(state.keyboardFrame).toBeNull();
    expect(state.pendingKeyboardFrame).toBeNull();
    expect(state.swipePhase).toBe("idle");
  });

  it("rejects lifecycle-restoration frames until deliberate focus owns a new session", () => {
    let state = presented();
    state = timeEntrySheetReducer(state, {
      type: "suggestion_results_changed",
      presentationId: 11,
      count: 6
    });
    state = timeEntrySheetReducer(state, {
      type: "description_focus_effect_started",
      presentationId: 11
    });
    state = acquireKeyboardSession(state, 11, 1);
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 11,
      frame: { inset: 335, sequence: 1 },
      interactive: false,
      sessionToken: 1
    });
    expect(state.keyboardPhase).toBe("visible");

    state = timeEntrySheetReducer(state, { type: "app_backgrounded", presentationId: 11 });
    expect(state.keyboardSessionToken).toBeNull();
    expect(state.keyboardPhase).toBe("hidden");
    expect(timeEntrySheetInvariantViolations(state)).toEqual([]);
    const backgrounded = state;
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 11,
      frame: { inset: 380, sequence: 2 },
      interactive: false,
      sessionToken: 1
    });
    expect(state).toBe(backgrounded);

    state = timeEntrySheetReducer(state, { type: "app_foregrounded", presentationId: 11 });
    const foregrounded = state;
    for (const [inset, sequence] of [[380, 3], [335, 4]] as const) {
      state = timeEntrySheetReducer(state, {
        type: "keyboard_frame_changed",
        presentationId: 11,
        frame: { inset, sequence },
        interactive: inset === 335,
        sessionToken: 1
      });
    }
    expect(state).toBe(foregrounded);
    expect(state.keyboardPhase).toBe("hidden");
    expect(state.keyboardFrame).toBeNull();

    state = acquireKeyboardSession(state, 11, 2);
    state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 11 });
    const refocused = state;
    state = timeEntrySheetReducer(state, {
      type: "keyboard_hidden",
      presentationId: 11,
      sessionToken: 1
    });
    expect(state).toBe(refocused);
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 11,
      frame: { inset: 335, sequence: 5 },
      interactive: false,
      sessionToken: 2
    });
    expect(state.keyboardPhase).toBe("visible");
    expect(state.keyboardSessionToken).toBe(2);
    expect(state.suggestionsPhase).toBe("opening");
  });

  it("queues only the latest keyboard frame during a swipe and releases it once", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = acquireKeyboardSession(state, 12);
    state = timeEntrySheetReducer(state, { type: "swipe_started", presentationId: 12 });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 12,
      frame: { inset: 240, sequence: 1 },
      interactive: true,
      sessionToken: 1
    });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 12,
      frame: { inset: 180, sequence: 2 },
      interactive: true,
      sessionToken: 1
    });
    expect(state.pendingKeyboardFrame).toEqual({ inset: 180, sequence: 2 });
    state = timeEntrySheetReducer(state, { type: "swipe_cancelled", presentationId: 12 });
    expect(state.keyboardFrame).toEqual({ inset: 180, sequence: 2 });
    expect(state.pendingKeyboardFrame).toBeNull();
    const settled = state;
    state = timeEntrySheetReducer(state, { type: "swipe_cancelled", presentationId: 12 });
    expect(state).toBe(settled);
  });

  it("cannot cancel a committed swipe with a stale keyboard completion", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = acquireKeyboardSession(state, 12);
    state = timeEntrySheetReducer(state, { type: "swipe_started", presentationId: 12 });
    state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 12 });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_hidden",
      presentationId: 12,
      sessionToken: 1
    });
    const beforeCancel = state;
    state = timeEntrySheetReducer(state, { type: "swipe_cancelled", presentationId: 12 });
    expect(state).toBe(beforeCancel);
    expect(state.sheetPhase).toBe("dismissing");
  });

  it("commits sheet dismissal while an interactive keyboard dismissal is in flight", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = acquireKeyboardSession(state, 12);
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 12,
      frame: { inset: 300, sequence: 1 },
      interactive: false,
      sessionToken: 1
    });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 12,
      frame: { inset: 220, sequence: 2 },
      interactive: true,
      sessionToken: 1
    });
    expect(state.keyboardPhase).toBe("interactive_dismissal");
    state = timeEntrySheetReducer(state, { type: "swipe_started", presentationId: 12 });
    state = timeEntrySheetReducer(state, {
      type: "keyboard_frame_changed",
      presentationId: 12,
      frame: { inset: 160, sequence: 3 },
      interactive: true,
      sessionToken: 1
    });
    expect(state.pendingKeyboardFrame).toEqual({ inset: 160, sequence: 3 });
    state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 12 });
    expect(state.sheetPhase).toBe("dismissing");
    expect(state.keyboardPhase).toBe("dismissing");
    expect(state.pendingKeyboardFrame).toBeNull();
    state = timeEntrySheetReducer(state, {
      type: "keyboard_hidden",
      presentationId: 12,
      sessionToken: 1
    });
    expect(state.sheetPhase).toBe("dismissing");
    state = timeEntrySheetReducer(state, { type: "sheet_exit_finished", presentationId: 12 });
    expect(state.sheetPhase).toBe("exited");
  });

  it("gates duplicate mutations and rejects stale operation completions", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = timeEntrySheetReducer(state, {
      type: "mutation_started",
      presentationId: 12,
      mutation: "deleting",
      operationToken: 7
    });
    expect(state.mutationPhase).toBe("deleting");
    const deleting = state;
    state = timeEntrySheetReducer(state, {
      type: "mutation_started",
      presentationId: 12,
      mutation: "deleting",
      operationToken: 8
    });
    expect(state).toBe(deleting);
    state = timeEntrySheetReducer(state, {
      type: "mutation_finished",
      presentationId: 12,
      operationToken: 6,
      outcome: "failed"
    });
    expect(state).toBe(deleting);
    state = timeEntrySheetReducer(state, {
      type: "mutation_finished",
      presentationId: 12,
      operationToken: 7,
      outcome: "succeeded"
    });
    expect(state.mutationPhase).toBe("idle");
  });

  it("allows exactly one swipe or mutation owner in normal and Reduce Motion", () => {
    for (const reduceMotion of [false, true]) {
      let state = presented(EXISTING_PRESENTATION, reduceMotion);
      state = timeEntrySheetReducer(state, { type: "swipe_started", presentationId: 12 });
      const dragging = state;
      state = timeEntrySheetReducer(state, {
        type: "mutation_started",
        presentationId: 12,
        mutation: "saving",
        operationToken: 8
      });
      expect(state).toBe(dragging);
      state = timeEntrySheetReducer(state, { type: "swipe_cancelled", presentationId: 12 });
      state = timeEntrySheetReducer(state, {
        type: "mutation_started",
        presentationId: 12,
        mutation: "saving",
        operationToken: 9
      });
      expect(state.mutationPhase).toBe("saving");
      const saving = state;
      state = timeEntrySheetReducer(state, { type: "swipe_started", presentationId: 12 });
      expect(state).toBe(saving);
      state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 12 });
      expect(state).toBe(saving);
      state = timeEntrySheetReducer(state, {
        type: "mutation_finished",
        presentationId: 12,
        operationToken: 9,
        outcome: "failed"
      });
      expect(state.sheetPhase).toBe("presented");
      expect(state.mutationPhase).toBe("idle");
      expect(timeEntrySheetInvariantViolations(state)).toEqual([]);
    }
  });

  it("keeps the Modal-owned presentation alive through visual exit", () => {
    let state = presented(EXISTING_PRESENTATION);
    state = timeEntrySheetReducer(state, { type: "dismiss_requested", presentationId: 12 });
    expect(state.sheetPhase).toBe("dismiss_requested");
    expect(state.active).toBe(true);
    state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 12 });
    expect(state.sheetPhase).toBe("dismissing");
    expect(state.active).toBe(true);
    state = timeEntrySheetReducer(state, { type: "sheet_exit_finished", presentationId: 12 });
    expect(state.sheetPhase).toBe("exited");
    expect(state.active).toBe(false);
    state = timeEntrySheetReducer(state, { type: "externally_hidden", presentationId: 12 });
    expect(state.sheetPhase).toBe("closed");
    expect(state.presentation).toBeNull();
  });

  it("reaches identical endpoints under normal and Reduce Motion", () => {
    const run = (reduceMotion: boolean) => {
      let state = presented(EXISTING_PRESENTATION, reduceMotion);
      state = timeEntrySheetReducer(state, { type: "description_focused", presentationId: 12 });
      state = timeEntrySheetReducer(state, { type: "dismiss_committed", presentationId: 12 });
      state = timeEntrySheetReducer(state, { type: "sheet_exit_finished", presentationId: 12 });
      return state;
    };
    const normal = run(false);
    const reduced = run(true);
    expect({ ...normal, reduceMotion: false }).toEqual({ ...reduced, reduceMotion: false });
  });
});

describe("generated transition sequences", () => {
  it("preserves reducer invariants across deterministic reordered events", () => {
    const eventFactories: Array<(id: number, sequence: number) => TimeEntrySheetEvent> = [
      (id) => ({ type: "modal_shown", presentationId: id }),
      (id) => ({ type: "sheet_presented", presentationId: id }),
      (id) => ({ type: "description_input_ready", presentationId: id }),
      (id) => ({ type: "description_anchor_ready", presentationId: id }),
      (id) => ({ type: "focus_ownership_reset", presentationId: id }),
      (id) => ({ type: "description_focused", presentationId: id }),
      (id) => ({ type: "description_blurred", presentationId: id }),
      (id) => ({ type: "date_picker_requested", presentationId: id }),
      (id) => ({ type: "date_picker_closed", presentationId: id }),
      (id) => ({ type: "swipe_started", presentationId: id }),
      (id) => ({ type: "swipe_cancelled", presentationId: id }),
      (id, sequence) => ({
        type: "keyboard_frame_changed",
        presentationId: id,
        frame: { inset: (sequence * 37) % 320, sequence },
        interactive: sequence % 2 === 0,
        sessionToken: sequence
      }),
      (id, sequence) => ({
        type: "keyboard_focus_requested",
        presentationId: id,
        sessionToken: sequence
      }),
      (id, sequence) => ({
        type: "keyboard_hidden",
        presentationId: id,
        sessionToken: sequence
      }),
      (id) => ({ type: "app_backgrounded", presentationId: id }),
      (id) => ({ type: "app_foregrounded", presentationId: id })
    ];

    for (let seed = 1; seed <= 80; seed += 1) {
      let state = open(EXISTING_PRESENTATION, seed % 2 === 0);
      let random = seed;
      for (let index = 0; index < 120; index += 1) {
        random = (random * 48_271) % 2_147_483_647;
        const factory = eventFactories[random % eventFactories.length];
        state = timeEntrySheetReducer(state, factory(12, index));
        expect(timeEntrySheetInvariantViolations(state), `seed ${seed}, event ${index}`).toEqual([]);
      }
    }
  });
});

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1)
  ]).map((tail) => [value, ...tail]));
}
