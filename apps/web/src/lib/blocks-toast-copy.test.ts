import { describe, expect, it } from "vitest";
import { alreadyRecordingToastMessage, startMatchesRunning, SWITCHED_TOAST_LEAD, switchedToastMessage } from "./blocks-toast-copy";

const previous = { categoryId: "c", categoryName: "Client Work", description: null, startedAt: "2026-10-10T22:52:00.000Z", tagNames: [] };

describe("web switch toast copy (UIA-209)", () => {
  it("matches the iPhone wording: one line, no logged-time detail (owner option A, 14 Oct)", () => {
    expect(switchedToastMessage("Admin")).toBe("Switched to Admin");
    expect(switchedToastMessage("A very long activity name that will need truncating")).toBe("Switched to A very long activity name that will need truncating");
    expect(SWITCHED_TOAST_LEAD).toBe("Switched to");
    expect(alreadyRecordingToastMessage({ categoryName: null, description: null })).toBe("Already recording No activity");
  });

  it("treats only the same activity, description and tags as the running block", () => {
    expect(startMatchesRunning(previous, { categoryId: "c", description: "", tagNames: [] })).toBe(true);
    expect(startMatchesRunning({ ...previous, tagNames: ["Billable"] }, { categoryId: "c", description: "", tagNames: [] })).toBe(false);
    expect(startMatchesRunning({ ...previous, description: "Plan" }, { categoryId: "c", description: "", tagNames: [] })).toBe(false);
    expect(startMatchesRunning(previous, { categoryId: "d", description: "", tagNames: [] })).toBe(false);
    expect(startMatchesRunning(null, { categoryId: "c", description: "", tagNames: [] })).toBe(false);
    // A bare start never matches.
    expect(startMatchesRunning({ ...previous, categoryId: null }, { categoryId: null, description: "", tagNames: [] })).toBe(false);
  });
});
