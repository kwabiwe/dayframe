import { describe, expect, it } from "vitest";
import { entryOverlapSeconds, entryOverlapsRange } from "./time-entry-overlap";

const range = {
  start: localDate(2026, 7, 23),
  end: localDate(2026, 7, 24)
};
const capturedNow = localDate(2026, 7, 23, 18);

describe("time-entry overlap", () => {
  it("credits an entry wholly inside the selected day", () => {
    expect(seconds(entry(9, 10))).toBe(3600);
  });

  it("clips an entry crossing midnight into the day", () => {
    const crossing = {
      startedAt: localDate(2026, 7, 22, 23, 30).toISOString(),
      stoppedAt: localDate(2026, 7, 23, 1, 30).toISOString()
    };
    expect(entryOverlapSeconds(crossing, range, capturedNow)).toBe(5400);
  });

  it("clips an entry that starts before the range", () => {
    const spanningStart = {
      startedAt: localDate(2026, 7, 22, 20).toISOString(),
      stoppedAt: localDate(2026, 7, 23, 2).toISOString()
    };
    expect(entryOverlapSeconds(spanningStart, range, capturedNow)).toBe(7200);
  });

  it("clips an entry that ends after the range", () => {
    const spanningEnd = {
      startedAt: localDate(2026, 7, 23, 22).toISOString(),
      stoppedAt: localDate(2026, 7, 24, 4).toISOString()
    };
    expect(entryOverlapSeconds(spanningEnd, range, capturedNow)).toBe(7200);
  });

  it("clips entries spanning both range boundaries", () => {
    const spanning = {
      startedAt: localDate(2026, 7, 20).toISOString(),
      stoppedAt: localDate(2026, 7, 27).toISOString()
    };
    expect(entryOverlapSeconds(spanning, range, capturedNow)).toBe(86400);
  });

  it("includes a running entry through one captured current time", () => {
    expect(entryOverlapSeconds(entry(16, null), range, capturedNow)).toBe(7200);
  });

  it("excludes entries touching but not crossing a boundary", () => {
    const endsAtStart = {
      startedAt: localDate(2026, 7, 22, 23).toISOString(),
      stoppedAt: range.start.toISOString()
    };
    expect(entryOverlapsRange(endsAtStart, range, capturedNow)).toBe(false);
  });

  it("safely excludes zero-duration and reversed entries", () => {
    expect(seconds(entry(9, 9))).toBe(0);
    expect(seconds(entry(10, 9))).toBe(0);
  });

  it("safely excludes invalid timestamps", () => {
    expect(entryOverlapSeconds({ startedAt: "invalid", stoppedAt: null }, range, capturedNow)).toBe(0);
  });

  it("never returns Infinity or NaN", () => {
    const result = entryOverlapSeconds(
      { startedAt: localDate(2026, 7, 23, 9).toISOString(), stoppedAt: null },
      { start: new Date(Number.NEGATIVE_INFINITY), end: new Date(Number.POSITIVE_INFINITY) },
      capturedNow
    );
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});

function seconds(value: ReturnType<typeof entry>) {
  return entryOverlapSeconds(value, range, capturedNow);
}

function entry(startHour: number, endHour: number | null) {
  return {
    startedAt: localDate(2026, 7, 23, startHour).toISOString(),
    stoppedAt: endHour === null ? null : localDate(2026, 7, 23, endHour).toISOString()
  };
}

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute);
}
