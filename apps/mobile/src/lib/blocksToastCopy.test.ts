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

  it("says only what is recording now: \"Switched to {activity}\" (owner option A, 14 Oct)", () => {
    expect(switchedToastCopy("Work")).toEqual({
      message: "Switched to Work",
      lead: "Switched to",
      name: "Work",
      accessibilityLabel: "Switched to Work."
    });
    // The owner's report: "School run" fits whole.
    expect(switchedToastCopy("School run").message).toBe("Switched to School run");
    expect(switchedToastCopy("No activity").message).toBe("Switched to No activity");
  });

  it("keeps a long name whole in the copy; only the toast's layout ends it in \"…\"", () => {
    const longName = "Quarterly planning with the whole design and engineering group and their managers";
    const long = switchedToastCopy(longName);
    expect(long.lead).toBe("Switched to");
    expect(long.name).toBe(longName);
    expect(long.message).toBe(`Switched to ${longName}`);
    // VoiceOver hears the whole name, never an ellipsis.
    expect(long.accessibilityLabel).toBe(`Switched to ${longName}.`);
    expect(long.message).not.toContain("…");
  });

  it("never mentions a duration or the previous block", () => {
    for (const name of ["Work", "School run", "Quarterly planning with the whole design and engineering group"]) {
      const copy = switchedToastCopy(name);
      const words = [copy.message, copy.lead, copy.name, copy.accessibilityLabel].join(" ");
      expect(words).not.toMatch(/logged|<1m|\d+m\b|\d+h\b|minute|hour|·/);
      expect(Object.keys(copy).sort()).toEqual(["accessibilityLabel", "lead", "message", "name"]);
    }
    // The function takes the new name alone: there is no previous block to describe.
    expect(switchedToastCopy.length).toBe(1);
  });

  it("reads a toast as one sentence for VoiceOver", () => {
    expect(toastAccessibilityText("Already recording Deep work")).toBe("Already recording Deep work");
    expect(toastAccessibilityText(switchedToastCopy("School run"))).toBe("Switched to School run.");
    expect(toastAccessibilityText({ message: "Switched to Work" })).toBe("Switched to Work");
    expect(toastAccessibilityText({ message: "Switched to Work", accessibilityLabel: "Spoken." })).toBe("Spoken.");
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
