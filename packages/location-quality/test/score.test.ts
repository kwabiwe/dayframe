import { describe, expect, it } from "vitest";
import { readAnswerKey } from "../src/answerKey";
import { fixed, renderReport, summary } from "../src/report";
import { scoreRun, wilsonLower } from "../src/score";
import { exampletonAnswerKey, exampletonSegments, WINDOW, at } from "./exampleton";

const options = { ...WINDOW, homePlace: "P4", timeZone: "Europe/London" };
const key = readAnswerKey(exampletonAnswerKey, WINDOW.from, WINDOW.to);

describe("answer key", () => {
  it("reads visits as places, activity runs as trips and same-mode activities as one leg", () => {
    expect(key.stays.map((stay) => stay.home)).toEqual([true, false, false, true]);
    expect(key.trips).toHaveLength(2);
    expect(key.trips[1].legs.map((leg) => leg.mode)).toEqual(["walk", "bus"]);
  });

  it("leaves out a long, slow gap filler and any trip that contains one", () => {
    expect(key.fillers).toHaveLength(1);
    expect(key.activities).toHaveLength(3);
    expect(key.allTrips).toHaveLength(2);
  });

  it("keeps trips under two minutes for precision but does not ask the engine to find them", () => {
    const short = readAnswerKey([
      { startTime: "2026-03-02T09:00:00Z", endTime: "2026-03-02T09:30:00Z", visit: { hierarchyLevel: 0 } },
      { startTime: "2026-03-02T09:30:00Z", endTime: "2026-03-02T09:31:30Z", activity: { distanceMeters: 400, topCandidate: { type: "in passenger vehicle" } } },
      { startTime: "2026-03-02T09:31:30Z", endTime: "2026-03-02T10:00:00Z", visit: { hierarchyLevel: 0 } }
    ], WINDOW.from, WINDOW.to);
    expect(short.allTrips).toHaveLength(1);
    expect(short.trips).toHaveLength(0);
  });
});

describe("scoring the Exampleton day", () => {
  const report = scoreRun(key, exampletonSegments, options);
  const week = report.week;

  it("counts kind agreement over the minutes the key is sure about", () => {
    expect(report.key.unsureMinutes).toBe(120);
    expect(week.minutes).toBe(600);
    // 08:00 is still a Stay to the engine, a minute into the key's drive.
    expect(week.agree).toBe(599);
    expect(week.components.kind).toBeCloseTo(599 / 600, 10);
  });

  it("matches every stay and scores boundaries away from the filler", () => {
    expect([week.keyStays, week.engineStays, week.stayMatched, week.phantomStays]).toEqual([4, 4, 4, 0]);
    expect(week.stayStartErrors).toEqual([0, 0]);
    expect([...week.stayEndErrors].sort()).toEqual([0, 1]);
    expect(week.home).toEqual([2, 2]);
    expect(week.components.bounds).toBe(1);
  });

  it("finds both trips, counts legs and scores mode per travel minute", () => {
    expect([week.keyTrips, week.tripMatched, week.engineMoves, week.phantomMoves]).toEqual([2, 2, 2, 0]);
    expect(week.legs).toEqual([1, 2]);
    expect(week.multiLegTrips).toBe(1);
    expect(week.travelMinutes).toBe(45);
    // 19 drive minutes and 5 walk minutes right; the bus read as walking.
    expect(week.modeFine).toBe(24);
    expect(week.modeCoarse).toBe(24);
    expect(week.byMode).toEqual([["car", 20], ["bus", 20], ["walk", 5]]);
  });

  it("weights the day score 30 kind, 20 places, 15 bounds, 15 trips, 20 mode", () => {
    expect(week.score).toBeCloseTo(30 * (599 / 600) + 20 + 15 + 15 + 20 * (24 / 45), 10);
    expect(report.days.map((day) => day.label)).toEqual(["Mon 02 Mar"]);
    expect(report.days[0].score).toBeCloseTo(week.score, 10);
  });

  it("marks a Move inside a stay as phantom", () => {
    const phantom = { ...exampletonSegments[1], startedAt: at("16:00"), stoppedAt: at("16:10"), mode: null };
    const withPhantom = scoreRun(key, [...exampletonSegments, phantom], options).week;
    expect(withPhantom.phantomMoves).toBe(1);
    expect(withPhantom.movePrecision).toBeCloseTo(2 / 3, 10);
  });

  it("reports bars with their Wilson lower bounds", () => {
    const bars = Object.fromEntries(report.bars.map((bar) => [bar.label, [bar.right, bar.total]]));
    expect(bars["saved-place stays with both ends ≤5 min"]).toEqual([3, 3]);
    expect(bars["unknown-place stays with both ends ≤5 min"]).toEqual([1, 1]);
    expect(bars["Moves between known places that are real"]).toEqual([1, 1]);
    expect(bars["Moves with an unknown end that are real"]).toEqual([1, 1]);
  });

  it("renders times, counts and labels only", () => {
    const text = renderReport(report, "Europe/London", { detail: true });
    expect(text).toContain("Answer key window 02 06:00 → 02 18:00 (local).");
    expect(text).toContain(`WEEK score ${fixed(week.score, 0)}`);
    expect(text).not.toMatch(/\d+\.\d{4,}/);
    expect(summary(report).days).toHaveLength(1);
  });
});

describe("statistics", () => {
  it("matches the design baseline's Wilson bounds", () => {
    expect(Math.round(100 * wilsonLower(24, 26))).toBe(79);
    expect(Math.round(100 * wilsonLower(23, 23))).toBe(89);
    expect(Math.round(100 * wilsonLower(3, 5))).toBe(27);
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it("rounds exact halves to even, as the prototype did", () => {
    expect(fixed(0.5, 0)).toBe("0");
    expect(fixed(2.5, 0)).toBe("2");
    expect(fixed(0.125, 2)).toBe("0.12");
    expect(fixed(88.6, 0)).toBe("89");
  });
});

describe("scoring trip legs (location v4 step 6)", () => {
  // The midday trip with legs: a 5-minute walk, then a bus read as a drive.
  const withLegs = exampletonSegments.map((segment) => segment.startedAt === at("12:00") ? {
    ...segment, legs: [
      { startedAt: at("12:00"), stoppedAt: at("12:05"), mode: "walking" },
      { startedAt: at("12:05"), stoppedAt: at("12:25"), mode: "automotive" },
      // A leg reaching past its own trip only ever speaks for that trip's minutes.
      { startedAt: at("12:20"), stoppedAt: at("16:00"), mode: "train" }
    ]
  } : segment);

  it("takes each minute's mode from its leg, clipped to its own trip", () => {
    const before = scoreRun(key, exampletonSegments, options).week;
    const after = scoreRun(key, withLegs, options).week;
    // Without legs the whole trip reads as walking: right for the walk only. With legs, the walk stays
    // right and the bus becomes the right family (vehicle) but the wrong vehicle.
    expect(after.modeFine).toBe(before.modeFine);
    expect(after.modeCoarse).toBeGreaterThan(before.modeCoarse);
    // The overreaching leg never touches the afternoon stay.
    expect(after.covered).toBe(before.covered);
  });

  it("counts a multi-leg trip split into the right number of legs", () => {
    const twoLegs = withLegs.map((segment) => segment.legs ? { ...segment, legs: segment.legs.slice(0, 2) } : segment);
    expect(scoreRun(key, twoLegs, options).week.multiLegRight).toBe(1);
    expect(scoreRun(key, exampletonSegments, options).week.multiLegRight).toBe(0);
  });
});
