import { describe, expect, it } from "vitest";
import { calendarBlockPresentation, calendarVisibleBlockHeight } from "./calendarBlocks";

describe("calendar block presentation", () => {
  it("keeps short blocks close to their true duration instead of inflating for text", () => {
    expect(calendarVisibleBlockHeight(11, 72)).toBeCloseTo(13.2);
    expect(calendarVisibleBlockHeight(20, 72)).toBe(24);
    expect(calendarVisibleBlockHeight(23, 72)).toBeCloseTo(27.6);
  });

  it("keeps one-minute blocks visible without becoming text-sized cards", () => {
    expect(calendarVisibleBlockHeight(1, 72)).toBe(4);
  });

  it("hides labels until the block has enough vertical space", () => {
    expect(calendarBlockPresentation(27)).toMatchObject({
      showTitle: false,
      showMeta: false,
      tiny: true
    });
    expect(calendarBlockPresentation(44)).toMatchObject({
      showTitle: true,
      showMeta: false,
      compact: true
    });
    expect(calendarBlockPresentation(64)).toMatchObject({
      showTitle: true,
      showMeta: true,
      compact: false
    });
  });
});
