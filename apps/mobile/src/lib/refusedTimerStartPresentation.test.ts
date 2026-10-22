import { describe, expect, it } from "vitest";
import { refusedTimerStartPresentation } from "./refusedTimerStartPresentation";

const base = { localId: "optimistic-y", ownerMatches: true, shown: false, deletionPending: false, calendarEditorEntryId: null };

describe("presenting a refused queued Start", () => {
  it("does nothing for another account", () => {
    expect(refusedTimerStartPresentation({ ...base, ownerMatches: false, shown: true })).toEqual({ run: false });
  });

  it("always cleans up, alerting only when the block could be seen (Codex r1 on #532)", () => {
    expect(refusedTimerStartPresentation(base)).toEqual({ run: true, alert: false, dismissCalendarEditor: false });
    expect(refusedTimerStartPresentation({ ...base, shown: true })).toMatchObject({ run: true, alert: true });
    // Hidden by a pending delete: cleaned up (so Undo can't bring it back) and alerted.
    expect(refusedTimerStartPresentation({ ...base, deletionPending: true })).toMatchObject({ run: true, alert: true });
  });

  it("dismisses a Calendar editor open on the refused block, and only that one", () => {
    expect(refusedTimerStartPresentation({ ...base, calendarEditorEntryId: "optimistic-y" })).toMatchObject({ dismissCalendarEditor: true });
    expect(refusedTimerStartPresentation({ ...base, calendarEditorEntryId: "other" })).toMatchObject({ dismissCalendarEditor: false });
  });
});
