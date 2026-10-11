import { describe, expect, it } from "vitest";
import { alreadyRecordingToastMessage, startMatchesRunning, switchedToastMessage } from "./blocks-toast-copy";

const previous = { categoryId: "c", categoryName: "Client Work", description: null, startedAt: "2026-10-10T22:52:00.000Z", tagNames: [] };

describe("web switch toast copy (UIA-209)", () => {
  it("matches the iPhone wording", () => {
    expect(switchedToastMessage("Admin", previous, Date.parse("2026-10-10T23:34:30.000Z"))).toBe("Switched to Admin · 42m logged to Client Work");
    expect(switchedToastMessage("Admin", { ...previous, description: "Acme onboarding" }, Date.parse("2026-10-11T00:55:00.000Z")))
      .toBe("Switched to Admin · 2h 3m logged to Acme onboarding");
    expect(switchedToastMessage("Admin", previous, Date.parse("2026-10-10T22:52:40.000Z"))).toBe("Switched to Admin · under a minute logged to Client Work");
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
