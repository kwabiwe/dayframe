import { describe, expect, it } from "vitest";
import {
  calendarBlockLaneInsets,
  calendarBlockVisualGeometry,
  canShowTimeBlockInlineAction,
  getTimeBlockDensity,
  layoutTimeBlockLanes,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "./time-block-display";

describe("time block display helpers", () => {
  it("uses rendered height to keep one readable title line in a minimum-height block", () => {
    expect(minimumTimeBlockHeight(64)).toBe(18);
    expect(minimumTimeBlockHeight(128)).toBe(32);

    const tiny = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 18 });
    expect(tiny).toMatchObject({
      isTiny: true,
      isShort: true,
      showTitle: true,
      showContext: false,
      showDuration: false,
      showTags: false,
      canDirectResize: false,
      canShowInlineAction: true
    });
    expect(timeBlockDensityClassNames(tiny)).not.toContain("has-no-text");
  });

  it("degrades metadata by title, duration, context, then tags", () => {
    const short = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 32 });
    expect(short).toMatchObject({
      showTitle: true,
      showContext: false,
      showDuration: false,
      showTags: false
    });

    const medium = getTimeBlockDensity({ durationSeconds: 20 * 60, height: 43 });
    expect(medium).toMatchObject({
      isTiny: false,
      isShort: false,
      showTitle: true,
      showDuration: true,
      showContext: false,
      showTags: false,
      canShowInlineAction: true,
      canDirectResize: false
    });

    const roomy = getTimeBlockDensity({ durationSeconds: 60 * 60, height: 80 });
    expect(roomy).toMatchObject({
      showTitle: true,
      showDuration: true,
      showContext: true,
      showTags: true,
      canShowInlineAction: true,
      canDirectResize: true
    });
  });

  it("recomputes the same short duration from rendered zoom height", () => {
    const oneHourZoom = getTimeBlockDensity({ durationSeconds: 8 * 60, height: 18 });
    const halfHourZoom = getTimeBlockDensity({ durationSeconds: 8 * 60, height: 23 });
    const quarterHourZoom = getTimeBlockDensity({ durationSeconds: 8 * 60, height: 32 });

    expect([oneHourZoom, halfHourZoom, quarterHourZoom].map((density) => density.showTitle))
      .toEqual([true, true, true]);
    expect([oneHourZoom, halfHourZoom, quarterHourZoom].map((density) => density.showDuration))
      .toEqual([false, false, false]);
    expect([oneHourZoom, halfHourZoom, quarterHourZoom].map((density) => density.canShowInlineAction))
      .toEqual([true, true, true]);
  });

  it("assigns visual lanes when minimum heights would otherwise cover nearby blocks", () => {
    const lanes = layoutTimeBlockLanes([
      { key: "five", top: 48, height: 18 },
      { key: "eight", top: 64, height: 18 },
      { key: "later", top: 96, height: 18 }
    ]);

    expect(lanes.get("five")).toMatchObject({ laneCount: 2, laneIndex: 0, mode: "lane" });
    expect(lanes.get("eight")).toMatchObject({ laneCount: 2, laneIndex: 1, mode: "lane" });
    expect(lanes.get("later")).toMatchObject({ laneCount: 1, laneIndex: 0, mode: "full" });
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

  it("only permits inline Play for completed, unselected pointer layouts with room", () => {
    const tall = getTimeBlockDensity({ durationSeconds: 60 * 60, height: 64 });
    const short = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 18 });
    const policy = (overrides: Partial<Parameters<typeof canShowTimeBlockInlineAction>[0]> = {}) =>
      canShowTimeBlockInlineAction({
        density: tall,
        isCompleted: true,
        isResizing: false,
        isSelected: false,
        textDensity: "full",
        ...overrides
      });

    expect(policy()).toBe(true);
    expect(policy({ density: short })).toBe(true);
    expect(policy({ isCompleted: false })).toBe(false);
    expect(policy({ isSelected: true })).toBe(false);
    expect(policy({ isResizing: true })).toBe(false);
    expect(policy({ textDensity: "none" })).toBe(false);
  });

  it("requires deliberate resize movement", () => {
    expect(resizeDragThresholdPx).toBeGreaterThanOrEqual(4);
  });
});
