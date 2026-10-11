import { describe, expect, it } from "vitest";
import { formatDuration } from "./durations";

describe("formatDuration (UIA-042, UIA-207)", () => {
  it("writes hours and minutes one way", () => {
    expect(formatDuration(6 * 3600 + 25 * 60)).toBe("6h 25m");
    expect(formatDuration(6 * 3600 + 5 * 60 + 59)).toBe("6h 5m");
    expect(formatDuration(2 * 3600)).toBe("2h");
    expect(formatDuration(35 * 60)).toBe("35m");
    expect(formatDuration(30 * 3600)).toBe("30h");
  });

  it("says <1m for a positive amount under a minute and 0m for nothing", () => {
    expect(formatDuration(1)).toBe("<1m");
    expect(formatDuration(59.9)).toBe("<1m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});
