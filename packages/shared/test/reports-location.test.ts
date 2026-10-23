import { describe, expect, it } from "vitest";
import { gettingAroundSummary, notLoggedPlaceSeconds } from "../src/location/reportsLocation";

// Location v4 step 18: synthetic times only.
const at = (minutes: number) => new Date(Date.parse("2026-10-22T00:00:00.000Z") + minutes * 60_000).toISOString();
const day = { start: at(0), end: at(1_440) };
const NOW = Date.parse(at(1_500));

describe("Reports › Getting around and not logged (location v4 step 18)", () => {
  it("splits each trip block by its legs, counts stops and changes between them, and each trip once", () => {
    const summary = gettingAroundSummary([
      { id: "a", startedAt: at(500), stoppedAt: at(612), travelMode: null, legs: [
        { startedAt: at(500), stoppedAt: at(518), mode: "walking", confidence: "sure", distanceMeters: 900 },
        { startedAt: at(534), stoppedAt: at(589), mode: "automotive", confidence: "likely", distanceMeters: 47_000 },
        { startedAt: at(589), stoppedAt: at(612), mode: "walking", confidence: "sure", distanceMeters: 1_200 }] },
      { id: "b", startedAt: at(900), stoppedAt: at(930), travelMode: "cycling", legs: null }
    ], day, NOW);
    expect(summary).toEqual({ tripCount: 2, totalSeconds: (112 + 30) * 60,
      byMode: [{ mode: "automotive", seconds: 55 * 60 }, { mode: "walking", seconds: 41 * 60 }, { mode: "cycling", seconds: 30 * 60 }],
      stopsSeconds: 16 * 60 });
  });

  it("clips a block to the range and its legs to the block, and is nothing without blocks", () => {
    const summary = gettingAroundSummary([{ id: "a", startedAt: at(-30), stoppedAt: at(30), travelMode: null, legs: [
      { startedAt: at(-30), stoppedAt: at(40), mode: "walking", confidence: "sure", distanceMeters: null }] }], day, NOW);
    expect(summary).toEqual({ tripCount: 1, totalSeconds: 1_800, byMode: [{ mode: "walking", seconds: 1_800 }], stopsSeconds: 0 });
    expect(gettingAroundSummary([], day, NOW)).toBeNull();
  });

  it("counts an unnamed place's time outside blocks from ten minutes, as its List row does", () => {
    const places = [{ startedAt: at(600), stoppedAt: at(720) }, { startedAt: at(800), stoppedAt: at(808) }, { startedAt: at(1_400), stoppedAt: null }];
    const entries = [{ startedAt: at(600), stoppedAt: at(660) }, { startedAt: at(650), stoppedAt: at(690) }];
    // 30 min of the first, none of the 8-minute one, and the open one up to the end of the day (40 min).
    expect(notLoggedPlaceSeconds(places, entries, day, NOW)).toBe((30 + 40) * 60);
  });
});
