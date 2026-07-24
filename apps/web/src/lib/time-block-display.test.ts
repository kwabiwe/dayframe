import { describe, expect, it } from "vitest";
import {
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
      canShowInlineAction: false
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
  });

  it("assigns visual lanes when minimum heights would otherwise cover nearby blocks", () => {
    const lanes = layoutTimeBlockLanes([
      { key: "five", top: 48, height: 18 },
      { key: "eight", top: 64, height: 18 },
      { key: "later", top: 96, height: 18 }
    ]);

    expect(lanes.get("five")).toEqual({ laneCount: 2, laneIndex: 0 });
    expect(lanes.get("eight")).toEqual({ laneCount: 2, laneIndex: 1 });
    expect(lanes.get("later")).toEqual({ laneCount: 1, laneIndex: 0 });
  });

  it("requires deliberate resize movement", () => {
    expect(resizeDragThresholdPx).toBeGreaterThanOrEqual(4);
  });
});
