import { describe, expect, it } from "vitest";
import { TODAY_CARD, compactDuration, formatLiveClock, spokenDuration } from "./todayBlocksLayout";

describe("Today Blocks card layout", () => {
  it("keeps the prototype's card sizes and 44-point minimum targets", () => {
    expect(TODAY_CARD).toMatchObject({ idlePadding: 20, liveBottomPadding: 16, padding: 18, primaryActionSize: 56, radius: 26 });
    expect(TODAY_CARD.secondaryActionSize).toBeGreaterThanOrEqual(44);
  });

  it("shows the live clock as H:MM:SS, as in the prototype", () => {
    expect(formatLiveClock(5)).toBe("0:00:05");
    expect(formatLiveClock(249)).toBe("0:04:09");
    expect(formatLiveClock(3723.9)).toBe("1:02:03");
    expect(formatLiveClock(43200)).toBe("12:00:00");
    expect(formatLiveClock(-3)).toBe("0:00:00");
  });

  it("speaks durations naturally and shows compact week totals", () => {
    expect(spokenDuration(42)).toBe("less than a minute");
    expect(spokenDuration(3723)).toBe("1 hour 2 minutes");
    expect(spokenDuration(7200)).toBe("2 hours");
    expect(compactDuration(0)).toBe("0m");
    expect(compactDuration(35 * 60)).toBe("35m");
    expect(compactDuration(4 * 3600 + 12 * 60)).toBe("4h 12m");
    expect(compactDuration(3 * 3600)).toBe("3h");
  });
});
