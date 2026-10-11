import { describe, expect, it } from "vitest";
import {
  alreadyRecordingToastMessage,
  deletedToastAnnouncement,
  deletedToastMessage,
  startMatchesRunning,
  switchedToastMessage,
  toastSwatchColor,
  undoDeleteAccessibilityLabel
} from "./blocksToastCopy";

const block = (overrides: Record<string, unknown> = {}) => ({
  categoryColor: "blue",
  categoryId: "work",
  categoryName: "Client Work",
  description: "",
  startedAt: "2026-10-11T09:00:00.000Z",
  tagNames: [] as string[],
  ...overrides
});

describe("Blocks toast copy (UIA-003/004)", () => {
  it("names the deleted block, or counts several", () => {
    expect(deletedToastMessage([block({ description: "Deep work" })])).toBe("Deleted Deep work");
    expect(deletedToastMessage([block()])).toBe("Deleted Client Work");
    expect(deletedToastMessage([block({ categoryId: null, categoryName: null })])).toBe("Deleted No activity");
    expect(deletedToastMessage([block(), block()])).toBe("Deleted 2 blocks");
    expect(deletedToastAnnouncement([block({ description: "Deep work" })])).toBe("Deleted Deep work. Undo available.");
    expect(undoDeleteAccessibilityLabel([block({ description: "Deep work" })])).toBe("Undo deleting Deep work");
    expect(undoDeleteAccessibilityLabel([block(), block(), block()])).toBe("Undo deleting 3 blocks");
  });

  it("says what is recording now and where the replaced block's time went", () => {
    const now = Date.parse("2026-10-11T09:42:30.000Z");
    expect(switchedToastMessage("Work", block(), now)).toBe("Switched to Work · 42m logged to Client Work");
    expect(switchedToastMessage("Work", block(), Date.parse("2026-10-11T11:05:00.000Z"))).toBe("Switched to Work · 2h 5m logged to Client Work");
    expect(switchedToastMessage("Work", block(), Date.parse("2026-10-11T09:00:20.000Z"))).toBe("Switched to Work · under a minute logged to Client Work");
    expect(alreadyRecordingToastMessage(block({ description: "Deep work" }))).toBe("Already recording Deep work");
  });

  it("matches only a start of exactly what is recording", () => {
    const running = block({ description: "Deep work", tagNames: ["focus"] });
    expect(startMatchesRunning(running, { categoryId: "work", description: " deep work ", tagNames: ["Focus"] })).toBe(true);
    expect(startMatchesRunning(running, { categoryId: "work", description: "Deep work", tagNames: [] })).toBe(false);
    expect(startMatchesRunning(running, { categoryId: "read", description: "Deep work", tagNames: ["focus"] })).toBe(false);
    expect(startMatchesRunning(running, { categoryId: "work", description: "Email", tagNames: ["focus"] })).toBe(false);
    // A bare Start opens the running block instead; nothing running never matches.
    expect(startMatchesRunning(block({ categoryId: null }), { categoryId: null, description: "", tagNames: [] })).toBe(false);
    expect(startMatchesRunning(null, { categoryId: "work", description: "", tagNames: [] })).toBe(false);
  });

  it("uses the activity colour for the swatch, and a neutral one without an activity", () => {
    expect(toastSwatchColor(block(), "dark")).toMatch(/^#[0-9A-F]{6}$/i);
    expect(toastSwatchColor(block({ categoryColor: null, categoryId: null }), "dark")).toBeNull();
  });
});
