import { describe, expect, it } from "vitest";
import {
  calendarBlockLaneInsets,
  calendarBracketRailPx,
  calendarBlockDetailLine,
  calendarBlockDurationLabel,
  calendarBlockPrimaryParts,
  calendarBlockPrimaryLine,
  calendarBlockSecondaryLine,
  calendarBlockVisualGeometry,
  canShowTimeBlockInlineAction,
  getTimeBlockDensity,
  layoutTimeBlockLanes,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "./time-block-display";

describe("time block display helpers", () => {
  it("draws every block one 16 px label line tall and adds the detail line from 34 px (location v4 C6)", () => {
    expect(minimumTimeBlockHeight()).toBe(16);

    const minimum = getTimeBlockDensity({ durationSeconds: 4 * 60, height: 15 });
    expect(minimum).toMatchObject({ isTiny: true, isShort: true, showSecondary: false, canShowInlineAction: false });
    expect(timeBlockDensityClassNames(minimum)).not.toContain("has-no-text");
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 22 })).toMatchObject({ isTiny: false, isShort: true });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 24 })).toMatchObject({
      showSecondary: false,
      canShowInlineAction: true
    });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 33 })).toMatchObject({ isShort: true, showSecondary: false });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 34 })).toMatchObject({
      isShort: false,
      showSecondary: true,
      canDirectResize: false
    });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 48 })).toMatchObject({ canDirectResize: true });
  });

  it("puts blocks side by side when one's label line reaches into the next, never as an inset", () => {
    const lanes = layoutTimeBlockLanes([
      { key: "five", top: 48, height: 16 },
      { key: "eight", top: 60, height: 16 },
      { key: "later", top: 96, height: 16 },
      { key: "long", top: 200, height: 200 },
      { key: "inside", top: 260, height: 16 }
    ]);

    expect(lanes.get("five")).toMatchObject({ laneCount: 2, laneIndex: 0, mode: "lane" });
    expect(lanes.get("eight")).toMatchObject({ laneCount: 2, laneIndex: 1, mode: "lane" });
    expect(lanes.get("later")).toMatchObject({ laneCount: 1, laneIndex: 0, mode: "full" });
    // A short block inside a long one is a column of its own, not an overlay.
    expect(lanes.get("long")).toMatchObject({ laneCount: 2, laneIndex: 0, offsetFraction: 0, widthFraction: 0.5 });
    expect(lanes.get("inside")).toMatchObject({ laneCount: 2, laneIndex: 1, offsetFraction: 0.5, widthFraction: 0.5 });
  });

  it("keeps three or more side-by-side blocks titled", () => {
    const lanes = layoutTimeBlockLanes([
      { key: "a", top: 0, height: 64 },
      { key: "b", top: 10, height: 64 },
      { key: "c", top: 20, height: 64 }
    ]);
    expect([...lanes.values()].map((lane) => lane.laneCount)).toEqual([3, 3, 3]);
    expect([...lanes.values()].every((lane) => !("textDensity" in lane))).toBe(true);
  });

  it("adds a one-pixel visual gap without changing semantic time geometry", () => {
    const semantic = { top: 512, height: 18 };
    const visual = calendarBlockVisualGeometry(semantic);

    expect(semantic).toEqual({ top: 512, height: 18 });
    expect(visual).toEqual({ top: 512, height: 17, visualGap: 1 });
    expect(visual.height).toBeGreaterThan(0);
    expect(calendarBlockVisualGeometry({ top: 512, height: 64 })).toEqual({
      top: 512,
      height: 63,
      visualGap: 1
    });
    expect(calendarBlockVisualGeometry({
      top: 512,
      height: 64,
      continuesIntoNextDay: true
    })).toEqual({ top: 512, height: 64, visualGap: 0 });
  });

  it("keeps the outer inset and splits one pixel across neighbouring overlap lanes", () => {
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 1 })).toEqual({
      left: 8,
      right: 8
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 0.5 })).toEqual({
      left: 8,
      right: "calc(50% + 0.5px)"
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0.5, widthFraction: 0.5 })).toEqual({
      left: "calc(50% + 0.5px)",
      right: 8
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0.08, widthFraction: 0.92 })).toEqual({
      left: "calc(8% + 0.5px)",
      right: 8
    });
  });

  it("moves a bracketed day's blocks and lanes right of the bracket rail (location v3 PR 14b)", () => {
    expect(calendarBracketRailPx).toBe(12);
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 1 }, calendarBracketRailPx)).toEqual({
      left: 20,
      right: 8
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 0.5 }, calendarBracketRailPx)).toEqual({
      left: 20,
      right: "calc((100% - 12px) * 0.5 + 0.5px)"
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0.5, widthFraction: 0.5 }, calendarBracketRailPx)).toEqual({
      left: "calc(12px + (100% - 12px) * 0.5 + 0.5px)",
      right: 8
    });
  });

  it("permits inline Play at safe height regardless of lane text density", () => {
    const tall = getTimeBlockDensity({ durationSeconds: 60 * 60, height: 64 });
    const tiny = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 23 });
    const policy = (overrides: Partial<Parameters<typeof canShowTimeBlockInlineAction>[0]> = {}) =>
      canShowTimeBlockInlineAction({
        density: tall,
        isCompleted: true,
        isResizing: false,
        isSelected: false,
        ...overrides
      });

    expect(policy()).toBe(true);
    expect(policy({ density: tiny })).toBe(false);
    expect(policy({ isCompleted: false })).toBe(false);
    expect(policy({ isSelected: true })).toBe(false);
    expect(policy({ isResizing: true })).toBe(false);
    expect(policy()).toBe(true);
  });

  it("formats the combined primary and full-entry secondary lines", () => {
    const entry = {
      categoryName: "Personal",
      description: "Train station pickup/drop-off",
      startedAt: "2026-08-02T08:00:00.000Z",
      stoppedAt: "2026-08-02T09:15:29.000Z",
      tagNames: ["Family duties", "Errands", "Travel"]
    };
    expect(calendarBlockPrimaryLine(entry)).toBe(
      "Train station pickup/drop-off · Personal · #Family duties +2"
    );
    expect(calendarBlockPrimaryParts(entry)).toEqual({
      description: "Train station pickup/drop-off",
      category: "Personal",
      firstTag: "Family duties",
      hiddenTagCount: 2
    });
    expect(calendarBlockPrimaryLine({ ...entry, description: "", categoryName: null })).toBe(
      "No activity · #Family duties +2"
    );
    expect(calendarBlockSecondaryLine(entry, new Date("2026-08-02T12:00:00.000Z"), "24h")).toMatch(
      /^1h 15m \(.+ – .+\)$/
    );
    expect(calendarBlockSecondaryLine({
      startedAt: "2026-01-02T23:30:00.000Z",
      stoppedAt: "2026-01-03T00:30:00.000Z"
    }, new Date("2026-01-03T12:00:00.000Z"), "24h")).toContain("+1)");
    expect(calendarBlockSecondaryLine({ ...entry, stoppedAt: null }, new Date("2026-08-02T10:00:00.000Z"), "12h"))
      .toContain("– now)");
  });

  it("labels a block with its title and real length, and its detail line with activity and times", () => {
    const entry = {
      categoryName: "Deep work",
      description: "Quarterly plan",
      startedAt: "2026-08-02T09:45:00.000Z",
      stoppedAt: "2026-08-02T11:30:00.000Z",
      tagNames: []
    };
    expect(calendarBlockDurationLabel(entry, new Date("2026-08-02T12:00:00.000Z"))).toBe("1h 45m");
    expect(calendarBlockDurationLabel({ ...entry, stoppedAt: "2026-08-02T09:49:00.000Z" }, new Date())).toBe("4m");
    expect(calendarBlockDurationLabel({ ...entry, stoppedAt: null }, new Date("2026-08-02T09:56:00.000Z"))).toBe("11m");
    expect(calendarBlockDetailLine(entry, new Date("2026-08-02T12:00:00.000Z"), "24h")).toMatch(/^Deep work · \d\d:\d\d–\d\d:\d\d$/);
    expect(calendarBlockDetailLine({ ...entry, description: "" }, new Date("2026-08-02T12:00:00.000Z"), "24h")).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
    expect(calendarBlockDetailLine({ ...entry, stoppedAt: null }, new Date("2026-08-02T12:00:00.000Z"), "12h")).toMatch(/–now$/);
  });

  it("requires deliberate resize movement", () => {
    expect(resizeDragThresholdPx).toBeGreaterThanOrEqual(4);
  });
});
