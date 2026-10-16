import { describe, expect, it } from "vitest";
import { timeWheelAccessibilityStep } from "./timeWheel";

describe("VoiceOver time card step (A11b)", () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 9, 14, h, m, s).getTime();
  const hm = (ms: number | null) => (ms === null ? null : `${new Date(ms).getHours()}:${String(new Date(ms).getMinutes()).padStart(2, "0")}:${new Date(ms).getSeconds()}`);

  it("moves to the next or previous 5-minute step", () => {
    expect(hm(timeWheelAccessibilityStep(at(9, 32), 1))).toBe("9:35:0");
    expect(hm(timeWheelAccessibilityStep(at(9, 32), -1))).toBe("9:30:0");
    expect(hm(timeWheelAccessibilityStep(at(9, 35), 1))).toBe("9:40:0");
    expect(hm(timeWheelAccessibilityStep(at(9, 35), -1))).toBe("9:30:0");
    expect(hm(timeWheelAccessibilityStep(at(9, 30, 20), -1))).toBe("9:30:0");
    expect(hm(timeWheelAccessibilityStep(at(9, 30, 20), 1))).toBe("9:35:0");
  });

  it("stays on the card's day and inside its bounds", () => {
    expect(timeWheelAccessibilityStep(at(23, 57), 1)).toBeNull();
    expect(timeWheelAccessibilityStep(at(0, 0), -1)).toBeNull();
    expect(timeWheelAccessibilityStep(at(9, 58), 1, { maximumMs: at(10, 1) })).toBe(at(10, 0));
    expect(timeWheelAccessibilityStep(at(10, 0), 1, { maximumMs: at(10, 1) })).toBeNull();
    expect(timeWheelAccessibilityStep(at(9, 2), -1, { minimumMs: at(9, 1) })).toBeNull();
    expect(timeWheelAccessibilityStep(Number.NaN, 1)).toBeNull();
  });
});
