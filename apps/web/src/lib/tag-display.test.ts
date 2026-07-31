import { describe, expect, it } from "vitest";
import { selectVisibleTags, TAG_SELECTION_MAX_COUNT } from "./tag-display";

describe("compact tag display", () => {
  it.each([
    [[], [], 0],
    [["One"], ["One"], 0],
    [["One", "Two"], ["One", "Two"], 0],
    [["One", "Two", "Three"], ["One", "Two", "Three"], 0],
    [["One", "Two", "Three", "Four"], ["One", "Two", "Three"], 1]
  ] as const)("shows a stable prefix for %j", (names, visible, hiddenCount) => {
    expect(selectVisibleTags([...names])).toEqual({ visible: [...visible], hiddenCount });
  });

  it("applies the 40-character budget before the three-tag limit", () => {
    expect(selectVisibleTags(["12345678901234567890", "12345678901234567890", "Third"]))
      .toEqual({ visible: ["12345678901234567890"], hiddenCount: 2 });
    expect(selectVisibleTags(["123456789012", "abcdefghijkl", "mnopqrstuvwx"]))
      .toEqual({ visible: ["123456789012", "abcdefghijkl"], hiddenCount: 1 });
  });

  it("reduces the visible prefix when measured field width is constrained", () => {
    expect(selectVisibleTags(["One", "Two", "Three"], {
      availableWidth: 86,
      tagWidths: [42, 42, 54],
      overflowWidth: 32
    })).toEqual({ visible: ["One"], hiddenCount: 2 });
  });

  it("keeps the separate selection guard at 24", () => {
    expect(TAG_SELECTION_MAX_COUNT).toBe(24);
  });
});
