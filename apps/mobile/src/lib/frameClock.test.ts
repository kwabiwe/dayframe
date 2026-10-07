import { describe, expect, it } from "vitest";
import { buildHistoryDaySections } from "./historyPresentation";
import { minuteClock, newestShownTimestamp } from "./frameClock";

const MINUTE = Date.parse("2026-10-07T09:15:00.000Z");

describe("minuteClock", () => {
  it("holds still within a minute and moves on the minute", () => {
    expect(minuteClock(MINUTE)).toBe(MINUTE);
    expect(minuteClock(MINUTE + 59_999)).toBe(MINUTE);
    expect(minuteClock(MINUTE + 60_000)).toBe(MINUTE + 60_000);
  });

  it("never falls behind the newest start or stop already shown", () => {
    const startedAt = MINUTE + 30_000;
    expect(minuteClock(MINUTE + 40_000, startedAt)).toBe(startedAt + 1000);
    expect(minuteClock(MINUTE + 59_000, startedAt)).toBe(startedAt + 1000);
    // Within the first second it never runs ahead of the real clock.
    expect(minuteClock(startedAt + 400, startedAt)).toBe(startedAt + 400);
    expect(minuteClock(MINUTE + 61_000, startedAt)).toBe(MINUTE + 60_000);
  });

  it("keeps a timer started this minute, and a short entry stopped this minute, in Today's list", () => {
    const running = { id: "running", startedAt: new Date(MINUTE + 30_000).toISOString(), stoppedAt: null };
    const short = { id: "short", startedAt: new Date(MINUTE + 5_000).toISOString(), stoppedAt: new Date(MINUTE + 20_000).toISOString() };
    const nowMs = MINUTE + 45_000;
    const clock = minuteClock(nowMs, newestShownTimestamp([running, short], nowMs));
    const sections = buildHistoryDaySections({ entries: [running, short] as never, nowMs: clock });
    const ids = sections.flatMap((section) => section.entries.map(({ entry }) => entry.id));
    expect(ids).toEqual(expect.arrayContaining(["running", "short"]));
  });

  it("ignores timestamps in the future, so a future-dated entry cannot make the clock tick every second", () => {
    const future = { id: "future", startedAt: new Date(MINUTE + 3_600_000).toISOString(), stoppedAt: null };
    expect(newestShownTimestamp([future], MINUTE + 10_000)).toBe(0);
  });
});
