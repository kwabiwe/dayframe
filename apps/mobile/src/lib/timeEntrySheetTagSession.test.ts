import { describe, expect, it } from "vitest";
import {
  createPendingDescriptionSelectionSync,
  createTimeEntrySheetTagSession,
  resolveDescriptionSelectionEvent,
  timeEntrySheetTagSessionReducer
} from "./timeEntrySheetTagSession";

describe("time-entry sheet tag session", () => {
  it("retains Add a tag ownership through blur and requests a newer focus attempt", () => {
    let state = createTimeEntrySheetTagSession(7);
    state = timeEntrySheetTagSessionReducer(state, {
      type: "hashtag_changed",
      active: true,
      presentationId: 7,
      requestFocus: true
    });
    const firstRequest = state.focusRequestId;

    state = timeEntrySheetTagSessionReducer(state, {
      type: "description_blurred",
      presentationId: 7
    });
    expect(state.activeHashtag).toBe(true);
    expect(state.focusRequestId).toBeGreaterThan(firstRequest ?? 0);

    state = timeEntrySheetTagSessionReducer(state, {
      type: "description_focused",
      presentationId: 7
    });
    expect(state.activeHashtag).toBe(true);
    expect(state.focusRequestId).toBeNull();
  });

  it("recovers a manually typed hashtag after an unexpected native blur", () => {
    let state = createTimeEntrySheetTagSession(9);
    state = timeEntrySheetTagSessionReducer(state, {
      type: "hashtag_changed",
      active: true,
      presentationId: 9,
      requestFocus: false
    });
    expect(state.focusRequestId).toBeNull();

    state = timeEntrySheetTagSessionReducer(state, {
      type: "description_blurred",
      presentationId: 9
    });
    expect(state.activeHashtag).toBe(true);
    expect(state.focusRequestId).not.toBeNull();
  });

  it("keeps Description focus after consuming a tag and cancels stale recovery", () => {
    let state = createTimeEntrySheetTagSession(11);
    state = timeEntrySheetTagSessionReducer(state, {
      type: "hashtag_changed",
      active: true,
      presentationId: 11,
      requestFocus: false
    });
    state = timeEntrySheetTagSessionReducer(state, {
      type: "hashtag_consumed",
      presentationId: 11
    });
    expect(state.activeHashtag).toBe(false);
    expect(state.focusRequestId).not.toBeNull();
    const consumedRequest = state.focusRequestId;

    state = timeEntrySheetTagSessionReducer(state, {
      type: "cancelled",
      presentationId: 11
    });
    expect(state.activeHashtag).toBe(false);
    expect(state.focusRequestId).toBeNull();
    expect(state.lastFocusRequestId).toBeGreaterThan(consumedRequest ?? 0);
  });

  it("ignores late focus events from an earlier sheet presentation", () => {
    const state = createTimeEntrySheetTagSession(13, 4);
    const next = timeEntrySheetTagSessionReducer(state, {
      type: "hashtag_changed",
      active: true,
      presentationId: 12,
      requestFocus: true
    });
    expect(next).toBe(state);
  });

  it("ignores only the stale native caret echo after controlled text insertion", () => {
    const pending = createPendingDescriptionSelectionSync(
      { start: 4, end: 4 },
      { start: 6, end: 6 }
    );
    const stale = resolveDescriptionSelectionEvent({
      nextSelection: { start: 4, end: 4 },
      pending,
      textLength: 6
    });
    expect(stale).toEqual({
      accepted: false,
      pending,
      selection: { start: 6, end: 6 }
    });

    const acknowledged = resolveDescriptionSelectionEvent({
      nextSelection: { start: 6, end: 6 },
      pending: stale.pending,
      textLength: 6
    });
    expect(acknowledged).toEqual({
      accepted: true,
      pending: null,
      selection: { start: 6, end: 6 }
    });
  });

  it("accepts a genuinely different user caret while native sync is pending", () => {
    const pending = createPendingDescriptionSelectionSync(
      { start: 4, end: 4 },
      { start: 6, end: 6 }
    );
    expect(resolveDescriptionSelectionEvent({
      nextSelection: { start: 2, end: 2 },
      pending,
      textLength: 6
    })).toEqual({
      accepted: true,
      pending: null,
      selection: { start: 2, end: 2 }
    });
  });
});
