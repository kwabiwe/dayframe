import { describe, expect, it } from "vitest";
import { emptyTimerEntryDraft, shouldStartTimerFromEntrySubmit } from "./timer-entry-draft";

describe("timer entry draft helpers", () => {
  it("starts from form submit only when the timer is idle and available", () => {
    expect(shouldStartTimerFromEntrySubmit({ hasActiveTimer: false, isBusy: false })).toBe(true);
    expect(shouldStartTimerFromEntrySubmit({ hasActiveTimer: true, isBusy: false })).toBe(false);
    expect(shouldStartTimerFromEntrySubmit({ hasActiveTimer: false, isBusy: true })).toBe(false);
  });

  it("resets stopped timer drafts to a clean optional-category state", () => {
    expect(emptyTimerEntryDraft()).toEqual({
      categoryId: "",
      description: ""
    });
  });
});
