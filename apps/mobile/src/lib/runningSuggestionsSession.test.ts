import { describe, expect, it } from "vitest";
import { shouldShowRunningSuggestions } from "./runningSuggestionsSession";

const eligibleSession = {
  dismissedForSession: false,
  hasDescription: false,
  isRunningMode: true,
  suggestionsAvailable: true,
  visible: true
};

describe("running timer suggestion session eligibility", () => {
  it("shows suggestions for a newly presented blank running timer", () => {
    expect(shouldShowRunningSuggestions(eligibleSession)).toBe(true);
  });

  it("keeps them hidden after manual entry even if the description is cleared or data arrives later", () => {
    expect(shouldShowRunningSuggestions({
      ...eligibleSession,
      dismissedForSession: true,
      hasDescription: false
    })).toBe(false);
  });

  it("allows a fresh eligible presentation after the previous sheet closes", () => {
    expect(shouldShowRunningSuggestions({
      ...eligibleSession,
      visible: false
    })).toBe(false);
    expect(shouldShowRunningSuggestions(eligibleSession)).toBe(true);
  });

  it("does not show suggestions for non-running or pre-described entries", () => {
    expect(shouldShowRunningSuggestions({ ...eligibleSession, isRunningMode: false })).toBe(false);
    expect(shouldShowRunningSuggestions({ ...eligibleSession, hasDescription: true })).toBe(false);
  });
});
