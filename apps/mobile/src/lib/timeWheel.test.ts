import { describe, expect, it } from "vitest";
import { timeWheelMinuteInterval } from "./timeWheel";

describe("time wheel minute step (A11b)", () => {
  it("uses 5-minute rows for a time on a 5-minute step", () => {
    expect(timeWheelMinuteInterval(new Date(2026, 9, 14, 9, 35).getTime(), false)).toBe(5);
    expect(timeWheelMinuteInterval(new Date(2026, 9, 14, 0, 0).getTime(), false)).toBe(5);
  });

  it("opens in every minute for any other time, so nothing is rounded silently", () => {
    expect(timeWheelMinuteInterval(new Date(2026, 9, 14, 9, 37).getTime(), false)).toBe(1);
    expect(timeWheelMinuteInterval(Number.NaN, false)).toBe(1);
  });

  it("honours Every minute", () => {
    expect(timeWheelMinuteInterval(new Date(2026, 9, 14, 9, 35).getTime(), true)).toBe(1);
  });
});
