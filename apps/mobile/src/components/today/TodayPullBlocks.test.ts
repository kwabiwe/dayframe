import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ StyleSheet: { create: <T,>(styles: T) => styles } }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 59 }) }));
vi.mock("react-native-reanimated", () => ({ default: { View: "View" } }));

import { PULL_BLOCKS, PULL_FULL_DISTANCE, pullBlockScale } from "./TodayPullBlocks";

describe("block pull-to-refresh", () => {
  it("has the prototype's six blocks", () => {
    expect(PULL_BLOCKS.map((block) => block.height)).toEqual([18, 30, 40, 24, 14, 34]);
  });

  it("stacks the blocks up one after another as the pull grows", () => {
    expect(pullBlockScale(0, 0)).toBe(0);
    expect(pullBlockScale(-20, 0)).toBe(0);
    const half = PULL_BLOCKS.map((_, index) => pullBlockScale(PULL_FULL_DISTANCE / 2, index));
    expect(half[0]).toBeCloseTo(0.8);
    expect(half[5]).toBeCloseTo(0.2);
    for (let index = 1; index < half.length; index += 1) expect(half[index]).toBeLessThan(half[index - 1]);
    expect(PULL_BLOCKS.map((_, index) => pullBlockScale(PULL_FULL_DISTANCE, index))).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
