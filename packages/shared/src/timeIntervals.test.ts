import { describe, expect, it } from "vitest";
import {
  TIME_OVERLAP_LAYOUT_CONSTANTS,
  analyzeTimeIntervals,
  layoutTimeIntervals,
  type TimeIntervalInput
} from "./timeIntervals";

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 6, 27, hour, minute)).toISOString();
const interval = (id: string, startHour: number, endHour: number): TimeIntervalInput => ({
  id,
  startedAt: at(startHour),
  stoppedAt: at(endHour)
});

describe("analyzeTimeIntervals", () => {
  it("returns a stable empty summary", () => {
    expect(analyzeTimeIntervals([])).toMatchObject({
      entries: [],
      invalidEntryIds: [],
      totalLoggedSeconds: 0,
      timeCoveredSeconds: 0,
      additionalOverlappingActivitySeconds: 0,
      concurrentCoverageSeconds: 0,
      maxConcurrency: 0,
      hasOverlap: false
    });
  });

  it("counts one valid interval once", () => {
    const result = analyzeTimeIntervals([interval("only", 9, 10)]);
    expect(result).toMatchObject({
      totalLoggedSeconds: 3_600,
      timeCoveredSeconds: 3_600,
      additionalOverlappingActivitySeconds: 0,
      maxConcurrency: 1,
      hasOverlap: false
    });
    expect(result.entries[0]).toMatchObject({
      overlapCount: 0,
      uniqueOverlapSeconds: 0,
      firstOverlapStartMs: null,
      lastOverlapEndMs: null
    });
  });

  it("treats touching half-open intervals as non-overlapping", () => {
    const result = analyzeTimeIntervals([interval("a", 9, 10), interval("b", 10, 11)]);
    expect(result).toMatchObject({
      loggedSeconds: 7200,
      coveredSeconds: 7200,
      additionalOverlapSeconds: 0,
      concurrentCoverageSeconds: 0,
      maxConcurrency: 1
    });
    expect(result.entries.every((entry) => entry.overlapCount === 0)).toBe(true);
  });

  it("measures partial and contained overlaps without double-counting covered time", () => {
    const result = analyzeTimeIntervals([
      interval("base", 9, 12),
      interval("partial", 11, 13),
      {
        id: "contained",
        startedAt: at(9, 30),
        stoppedAt: at(10)
      }
    ]);
    expect(result).toMatchObject({
      loggedSeconds: 19_800,
      coveredSeconds: 14_400,
      additionalOverlapSeconds: 5_400,
      concurrentCoverageSeconds: 5_400,
      maxConcurrency: 2
    });
    expect(result.entries.find((entry) => entry.id === "base")).toMatchObject({
      overlapSeconds: 5_400,
      overlapCount: 2,
      overlappingEntryIds: ["contained", "partial"]
    });
  });

  it("handles overlap chains and dense concurrency", () => {
    const result = analyzeTimeIntervals([
      interval("a", 9, 12),
      interval("b", 10, 13),
      interval("c", 11, 14)
    ]);
    expect(result).toMatchObject({
      loggedSeconds: 32_400,
      coveredSeconds: 18_000,
      additionalOverlapSeconds: 14_400,
      concurrentCoverageSeconds: 10_800,
      maxConcurrency: 3
    });
  });

  it("reports the canonical two- and three-entry simultaneous examples", () => {
    const two = analyzeTimeIntervals([interval("a", 9, 10), interval("b", 9, 10)]);
    expect(two).toMatchObject({
      totalLoggedSeconds: 7_200,
      timeCoveredSeconds: 3_600,
      additionalOverlappingActivitySeconds: 3_600,
      concurrentCoverageSeconds: 3_600,
      maxConcurrency: 2,
      hasOverlap: true
    });

    const three = analyzeTimeIntervals([
      interval("a", 9, 10),
      interval("b", 9, 10),
      interval("c", 9, 10)
    ]);
    expect(three).toMatchObject({
      totalLoggedSeconds: 10_800,
      timeCoveredSeconds: 3_600,
      additionalOverlappingActivitySeconds: 7_200,
      concurrentCoverageSeconds: 3_600,
      maxConcurrency: 3,
      hasOverlap: true
    });
    expect(three.entries.find((entry) => entry.id === "a")).toMatchObject({
      overlapCount: 2,
      uniqueOverlapSeconds: 3_600,
      firstOverlapStartMs: Date.parse(at(9)),
      lastOverlapEndMs: Date.parse(at(10)),
      maxConcurrency: 3
    });
  });

  it("keeps separated overlap clusters independent", () => {
    const result = analyzeTimeIntervals([
      interval("a", 8, 10),
      interval("b", 9, 11),
      interval("c", 14, 16),
      interval("d", 15, 17)
    ]);
    expect(result).toMatchObject({
      totalLoggedSeconds: 28_800,
      timeCoveredSeconds: 21_600,
      additionalOverlappingActivitySeconds: 7_200,
      concurrentCoverageSeconds: 7_200,
      maxConcurrency: 2
    });
  });

  it("clips running entries with one captured now and a range", () => {
    const result = analyzeTimeIntervals(
      [{ id: "running", startedAt: at(8), stoppedAt: null }],
      {
        range: { start: at(9), end: at(12) },
        now: at(10, 30)
      }
    );
    expect(result.entries[0]).toMatchObject({
      startMs: Date.parse(at(9)),
      endMs: Date.parse(at(10, 30)),
      loggedSeconds: 5_400
    });
  });

  it("excludes invalid, reversed, out-of-range, and duplicate-id intervals", () => {
    const result = analyzeTimeIntervals(
      [
        { id: "invalid", startedAt: "not-a-date", stoppedAt: at(10) },
        interval("reversed", 11, 10),
        interval("outside", 7, 8),
        interval("duplicate", 9, 10),
        interval("duplicate", 10, 11)
      ],
      { range: { start: at(9), end: at(12) } }
    );
    expect(result.entries.map((entry) => entry.id)).toEqual(["duplicate"]);
    expect(result.invalidEntryIds).toEqual(["duplicate", "invalid", "outside", "reversed"]);
  });

  it("deduplicates repeated delivery of the same stable entry ID", () => {
    const delivered = interval("same", 9, 10);
    const result = analyzeTimeIntervals([delivered, { ...delivered }]);
    expect(result.totalLoggedSeconds).toBe(3_600);
    expect(result.entries.map((entry) => entry.id)).toEqual(["same"]);
    expect(result.invalidEntryIds).toEqual(["same"]);
  });

  it("clips a cross-midnight entry to the requested range", () => {
    const result = analyzeTimeIntervals(
      [{
        id: "overnight",
        startedAt: "2026-07-26T23:30:00.000Z",
        stoppedAt: "2026-07-27T01:30:00.000Z"
      }],
      {
        range: {
          start: "2026-07-27T00:00:00.000Z",
          end: "2026-07-28T00:00:00.000Z"
        }
      }
    );
    expect(result.totalLoggedSeconds).toBe(5_400);
  });

  it("is stable when input order changes", () => {
    const entries = [interval("c", 11, 14), interval("a", 9, 12), interval("b", 10, 13)];
    expect(analyzeTimeIntervals(entries)).toEqual(analyzeTimeIntervals([...entries].reverse()));
  });

  it("uses the actual 23- and 25-hour elapsed lengths of Europe/London DST days", () => {
    const spring = analyzeTimeIntervals(
      [{
        id: "spring",
        startedAt: "2026-03-29T00:00:00.000Z",
        stoppedAt: "2026-03-29T23:00:00.000Z"
      }],
      {
        range: {
          start: "2026-03-29T00:00:00.000Z",
          end: "2026-03-29T23:00:00.000Z"
        }
      }
    );
    expect(spring.timeCoveredSeconds).toBe(23 * 3_600);

    const autumn = analyzeTimeIntervals(
      [{
        id: "autumn",
        startedAt: "2026-10-24T23:00:00.000Z",
        stoppedAt: "2026-10-26T00:00:00.000Z"
      }],
      {
        range: {
          start: "2026-10-24T23:00:00.000Z",
          end: "2026-10-26T00:00:00.000Z"
        }
      }
    );
    expect(autumn.timeCoveredSeconds).toBe(25 * 3_600);
  });
});

describe("layoutTimeIntervals", () => {
  it("uses an inset overlay for a substantially shorter contained pair", () => {
    const result = layoutTimeIntervals([
      interval("base", 9, 12),
      { id: "short", startedAt: at(10), stoppedAt: at(10, 30) }
    ]);
    expect(result.find((layout) => layout.id === "base")?.mode).toBe("full");
    expect(result.find((layout) => layout.id === "short")).toMatchObject({
      mode: "insetOverlay",
      offsetFraction: TIME_OVERLAP_LAYOUT_CONSTANTS.insetOffsetFraction,
      widthFraction: 1 - TIME_OVERLAP_LAYOUT_CONSTANTS.insetOffsetFraction,
      zIndex: 2
    });
  });

  it("uses lanes for partial, identical, or similarly sized contained overlaps", () => {
    const result = layoutTimeIntervals([interval("a", 9, 11), interval("b", 10, 12)]);
    expect(result.map((layout) => layout.mode)).toEqual(["lane", "lane"]);
    expect(result.map((layout) => layout.laneCount)).toEqual([2, 2]);

    const identical = layoutTimeIntervals([interval("a", 9, 11), interval("b", 9, 11)]);
    expect(identical.every((layout) => layout.mode === "lane")).toBe(true);

    const similarContainment = layoutTimeIntervals([
      interval("base", 9, 11),
      { id: "large", startedAt: at(9, 15), stoppedAt: at(10, 45) }
    ]);
    expect(similarContainment.every((layout) => layout.mode === "lane")).toBe(true);
  });

  it("uses compact lanes for dense collisions", () => {
    const result = layoutTimeIntervals([
      interval("a", 9, 12),
      interval("b", 10, 13),
      interval("c", 11, 14)
    ]);
    expect(result.every((layout) => layout.mode === "compactLane")).toBe(true);
    expect(result.every((layout) => layout.textDensity === "none")).toBe(true);
  });

  it("is stable under reordered and duplicate-ID input", () => {
    const entries = [
      interval("a", 9, 12),
      interval("b", 10, 13),
      interval("c", 11, 14),
      interval("a", 15, 16)
    ];
    expect(layoutTimeIntervals(entries)).toEqual(layoutTimeIntervals([...entries].reverse()));
    expect(layoutTimeIntervals(entries).filter((layout) => layout.id === "a")).toHaveLength(1);
    for (const layout of layoutTimeIntervals(entries)) {
      expect(layout.offsetFraction).toBeGreaterThanOrEqual(0);
      expect(layout.widthFraction).toBeGreaterThan(0);
      expect(layout.offsetFraction + layout.widthFraction).toBeLessThanOrEqual(1);
    }
  });
});
