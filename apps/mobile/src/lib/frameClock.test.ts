import { describe, expect, it } from "vitest";
import { minuteClock } from "./frameClock";

describe("minuteClock", () => {
  it("holds still within a minute and moves on the minute", () => {
    const start = Date.parse("2026-10-07T09:15:00.000Z");
    expect(minuteClock(start)).toBe(start);
    expect(minuteClock(start + 59_999)).toBe(start);
    expect(minuteClock(start + 60_000)).toBe(start + 60_000);
  });
});
