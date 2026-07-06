import { describe, expect, it } from "vitest";
import {
  getTimeBlockDensity,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "./time-block-display";

describe("time block display helpers", () => {
  it("uses a 15-minute visual minimum without making tiny blocks text-heavy", () => {
    expect(minimumTimeBlockHeight(64)).toBe(18);
    expect(minimumTimeBlockHeight(128)).toBe(32);

    const tiny = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 18 });
    expect(tiny).toMatchObject({
      isTiny: true,
      isShort: true,
      showTitle: false,
      showContext: false,
      showDuration: false
    });
    expect(timeBlockDensityClassNames(tiny)).toContain("has-no-text");
  });

  it("shows only clean essential text when there is enough block height", () => {
    const short = getTimeBlockDensity({ durationSeconds: 15 * 60, height: 32 });
    expect(short).toMatchObject({
      isTiny: false,
      isShort: true,
      showTitle: true,
      showContext: false,
      showDuration: false
    });

    const roomy = getTimeBlockDensity({ durationSeconds: 40 * 60, height: 44 });
    expect(roomy).toMatchObject({
      isTiny: false,
      isShort: false,
      showTitle: true,
      showContext: true,
      showDuration: true
    });
  });

  it("requires deliberate resize movement", () => {
    expect(resizeDragThresholdPx).toBeGreaterThanOrEqual(4);
  });
});
