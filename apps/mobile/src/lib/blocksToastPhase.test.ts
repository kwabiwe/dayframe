import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) } }));
vi.mock("./motion", () => ({ MOBILE_MOTION: { controlMs: 140, layoutMs: 220, sheetMs: 260, screenMs: 280 } }));
vi.mock("react-native-reanimated", () => ({
  Easing: { bezier: () => () => 0, out: () => () => 0, cubic: () => 0 },
  ReduceMotion: { Never: "never", System: "system" },
  withDelay: (_: number, value: unknown) => value,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value
}));

import { toastExitStart } from "./blocksMotion";

// Codex r1 on #373: a toast that skipped its entrance (handed to another Review deck slot) must
// start its exit from rest, never from an uninitialised entrance.
describe("toastExitStart", () => {
  it("starts a settled toast's exit from rest", () => {
    const start = toastExitStart({ value: "settled" }) as unknown as { opacity: number; transform: Array<Record<string, number>> };
    expect(start.opacity).toBe(1);
    expect(start.transform).toEqual([{ translateY: 0 }, { scale: 1 }]);
  });
  it("leaves an entrance still running to inherit its own values", () => {
    expect(toastExitStart({ value: "entering" })).toEqual({});
  });
});
