import { describe, expect, it } from "vitest";
import { maskTimeInput, parseTimeInput } from "@/lib/time-input";

describe("time input", () => {
  it("masks digits as HH:MM", () => {
    expect(maskTimeInput("1")).toBe("1");
    expect(maskTimeInput("1715")).toBe("17:15");
    expect(maskTimeInput("17:1599")).toBe("17:15");
  });

  it("rejects incomplete and out-of-range times", () => {
    expect(parseTimeInput("17:15")).toEqual({ hours: 17, minutes: 15 });
    expect(parseTimeInput("7:15")).toBeNull();
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("12:60")).toBeNull();
  });
});
