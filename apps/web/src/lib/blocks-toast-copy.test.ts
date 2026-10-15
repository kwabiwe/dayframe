import { describe, expect, it } from "vitest";
import { alreadyRecordingToastMessage, startMatchesRunning, switchedToastCopy } from "./blocks-toast-copy";

const previous = { categoryId: "c", categoryName: "Client Work", description: null, startedAt: "2026-10-10T22:52:00.000Z", tagNames: [] };

describe("web switch toast copy (UIA-209)", () => {
  it("matches the iPhone's two lines (owner decision 15 Oct 2026, #400)", () => {
    expect(switchedToastCopy("Admin", previous, Date.parse("2026-10-10T23:34:30.000Z")))
      .toEqual({ message: "Switched to Admin", detail: "42m logged to Client Work" });
    expect(switchedToastCopy("Admin", { ...previous, description: "Acme onboarding" }, Date.parse("2026-10-11T00:55:00.000Z")))
      .toEqual({ message: "Switched to Admin", detail: "2h 3m logged to Acme onboarding" });
    expect(switchedToastCopy("Admin", previous, Date.parse("2026-10-10T22:52:40.000Z")).detail).toBe("<1m logged to Client Work");
    expect(switchedToastCopy("Admin", previous, Date.parse("2026-10-10T22:51:00.000Z")).detail).toBe("<1m logged to Client Work");
    // The legacy "Start activity" placeholder names the activity instead, as on iPhone (Codex r1 on #430).
    expect(switchedToastCopy("Admin", { ...previous, description: "Start activity" }, Date.parse("2026-10-10T23:34:30.000Z")).detail)
      .toBe("42m logged to Client Work");
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
