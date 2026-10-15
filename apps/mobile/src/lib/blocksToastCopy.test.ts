import { describe, expect, it } from "vitest";
import {
  alreadyRecordingToastMessage,
  deletedToastAnnouncement,
  deletedToastMessage,
  startMatchesRunning,
  switchedToastCopy,
  toastAccessibilityText,
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

  it("says what is recording now on line 1 and where the replaced block's time went on line 2", () => {
    const now = Date.parse("2026-10-11T09:42:30.000Z");
    expect(switchedToastCopy("Work", block(), now)).toEqual({
      message: "Switched to Work",
      detail: "42m logged to Client Work",
      accessibilityLabel: "Switched to Work, 42 minutes logged to Client Work."
    });
    // Durations are the shared format: whole minutes rounded down, "2h 5m", "2h", "<1m".
    expect(switchedToastCopy("Work", block(), Date.parse("2026-10-11T11:05:00.000Z")).detail).toBe("2h 5m logged to Client Work");
    expect(switchedToastCopy("Work", block(), Date.parse("2026-10-11T11:05:00.000Z")).accessibilityLabel)
      .toBe("Switched to Work, 2 hours 5 minutes logged to Client Work.");
    expect(switchedToastCopy("Work", block(), Date.parse("2026-10-11T10:00:00.000Z")).detail).toBe("1h logged to Client Work");
    expect(switchedToastCopy("Work", block(), Date.parse("2026-10-11T09:45:00.000Z")).detail).toBe("45m logged to Client Work");
  });

  it("says <1m (spoken \"less than a minute\") for a block under a minute, even one switched in the same second", () => {
    const sub = switchedToastCopy("Work", block(), Date.parse("2026-10-11T09:00:20.000Z"));
    expect(sub.detail).toBe("<1m logged to Client Work");
    expect(sub.accessibilityLabel).toBe("Switched to Work, less than a minute logged to Client Work.");
    expect(switchedToastCopy("Work", block(), Date.parse("2026-10-11T09:00:00.000Z")).detail).toBe("<1m logged to Client Work");
    // A clock that ran backwards still never says "0m".
    expect(switchedToastCopy("Work", block(), Date.parse("2026-10-11T08:59:00.000Z")).detail).toBe("<1m logged to Client Work");
    expect(switchedToastCopy("Work", block({ startedAt: "not a date" }), Date.now()).detail).toBe("<1m logged to Client Work");
  });

  it("keeps the whole name on line 1 and the previous block's name on line 2, however long", () => {
    const now = Date.parse("2026-10-11T09:00:40.000Z");
    // The owner's report: this was one truncated line.
    const school = switchedToastCopy("School run", block({ categoryName: "Family", description: "Breakfast and packing bags" }), now);
    expect(school.message).toBe("Switched to School run");
    expect(school.detail).toBe("<1m logged to Breakfast and packing bags");
    const longName = "Quarterly planning with the whole design and engineering group";
    const long = switchedToastCopy(longName, block({ description: longName }), Date.parse("2026-10-11T10:30:00.000Z"));
    expect(long.message).toBe(`Switched to ${longName}`);
    expect(long.detail).toBe(`1h 30m logged to ${longName}`);
    expect(long.accessibilityLabel).toBe(`Switched to ${longName}, 1 hour 30 minutes logged to ${longName}.`);
    // A previous block with neither description nor activity is a bare block.
    expect(switchedToastCopy("Work", block({ categoryId: null, categoryName: null }), now).detail).toBe("<1m logged to No activity");
  });

  it("has no second line without a previous block", () => {
    expect(switchedToastCopy("Work", null, Date.now())).toEqual({ message: "Switched to Work", detail: null, accessibilityLabel: "Switched to Work." });
    expect(switchedToastCopy("Work", undefined, Date.now()).detail).toBeNull();
  });

  it("reads a toast as one sentence for VoiceOver", () => {
    expect(toastAccessibilityText("Already recording Deep work")).toBe("Already recording Deep work");
    expect(toastAccessibilityText({ message: "Switched to Work", detail: "42m logged to Client Work" })).toBe("Switched to Work. 42m logged to Client Work");
    expect(toastAccessibilityText({ message: "Switched to Work", detail: "42m logged to Client Work", accessibilityLabel: "Spoken." })).toBe("Spoken.");
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
