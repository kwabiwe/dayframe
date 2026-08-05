import { describe, expect, it } from "vitest";
import {
  calendarBlockFallbackLine,
  calendarBlockLaneInsets,
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
  it("uses the exact text and action density thresholds", () => {
    expect(minimumTimeBlockHeight(64)).toBe(18);
    expect(minimumTimeBlockHeight(128)).toBe(32);

    expect(getTimeBlockDensity({ durationSeconds: 5 * 60, height: 17 })).toMatchObject({
      showAnyText: false,
      showFullPrimary: false,
      showSecondary: false,
      canShowInlineAction: false
    });
    const fallback = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 18 });
    expect(fallback).toMatchObject({
      isTiny: true,
      isShort: true,
      showAnyText: true,
      showFullPrimary: false,
      showSecondary: false,
      canDirectResize: false,
      canShowInlineAction: false
    });
    expect(timeBlockDensityClassNames(fallback)).not.toContain("has-no-text");
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 24 })).toMatchObject({
      showAnyText: true,
      showFullPrimary: true,
      showSecondary: false,
      canShowInlineAction: true
    });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 40 })).toMatchObject({
      isShort: false,
      showSecondary: true,
      canShowInlineAction: true,
      canDirectResize: false
    });
  });

  it("recomputes the same short duration from rendered zoom height", () => {
    const oneHourZoom = getTimeBlockDensity({ durationSeconds: 8 * 60, height: 18 });
    const halfHourZoom = getTimeBlockDensity({ durationSeconds: 8 * 60, height: 23 });
    const quarterHourZoom = getTimeBlockDensity({ durationSeconds: 8 * 60, height: 32 });

    expect([oneHourZoom, halfHourZoom, quarterHourZoom].map((density) => density.showAnyText))
      .toEqual([true, true, true]);
    expect([oneHourZoom, halfHourZoom, quarterHourZoom].map((density) => density.showSecondary))
      .toEqual([false, false, false]);
    expect([oneHourZoom, halfHourZoom, quarterHourZoom].map((density) => density.canShowInlineAction))
      .toEqual([false, false, true]);
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

  it("formats the combined primary, fallback, and full-entry secondary lines", () => {
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
    expect(calendarBlockFallbackLine(entry)).toBe("Train station pickup/drop-off");
    expect(calendarBlockPrimaryLine({ ...entry, description: "", categoryName: null })).toBe(
      "Uncategorized · #Family duties +2"
    );
    expect(calendarBlockSecondaryLine(entry, new Date("2026-08-02T12:00:00.000Z"))).toMatch(
      /^1h 15m \(.+ – .+\)$/
    );
    expect(calendarBlockSecondaryLine({
      startedAt: "2026-01-02T23:30:00.000Z",
      stoppedAt: "2026-01-03T00:30:00.000Z"
    }, new Date("2026-01-03T12:00:00.000Z"))).toContain("+1)");
    expect(calendarBlockSecondaryLine({ ...entry, stoppedAt: null }, new Date("2026-08-02T10:00:00.000Z")))
      .toContain("– now)");
  });

  it("requires deliberate resize movement", () => {
    expect(resizeDragThresholdPx).toBeGreaterThanOrEqual(4);
  });
});
