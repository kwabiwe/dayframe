import { describe, expect, it } from "vitest";
import {
  calendarBlockLaneInsets,
  calendarBracketRailPx,
  calendarBlockDetailLine,
  calendarBlockDetailLines,
  calendarBlockLanePxInsets,
  calendarLaneWidth,
  layoutTimeBlockHybrid,
  calendarBlockDurationLabel,
  calendarBlockPrimaryParts,
  calendarBlockPrimaryLine,
  calendarBlockSecondaryLine,
  calendarBlockVisualGeometry,
  canShowTimeBlockInlineAction,
  getTimeBlockDensity,
  layoutTimeBlockLanes,
  minimumTimeBlockHeight,
  resizeDragThresholdPx,
  timeBlockDensityClassNames
} from "./time-block-display";

describe("time block display helpers", () => {
  it("draws every block one 18 px label line tall and adds the detail line from 34 px (dense-day rules, 24 Oct 2026)", () => {
    // 18 px drawn: the semantic minimum adds the 2 px visual gap.
    expect(minimumTimeBlockHeight()).toBe(20);
    expect(calendarBlockVisualGeometry({ top: 0, height: minimumTimeBlockHeight() }).height).toBe(18);

    const minimum = getTimeBlockDensity({ durationSeconds: 4 * 60, height: 15 });
    expect(minimum).toMatchObject({ isTiny: true, isShort: true, showSecondary: false, canShowInlineAction: false });
    expect(timeBlockDensityClassNames(minimum)).not.toContain("has-no-text");
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 22 })).toMatchObject({ isTiny: false, isShort: true });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 24 })).toMatchObject({
      showSecondary: false,
      canShowInlineAction: true
    });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 33 })).toMatchObject({ isShort: true, showSecondary: false });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 34 })).toMatchObject({
      isShort: false,
      showSecondary: true,
      canDirectResize: false
    });
    expect(getTimeBlockDensity({ durationSeconds: 20 * 60, height: 48 })).toMatchObject({ canDirectResize: true });
  });

  it("puts blocks side by side when one's label line reaches into the next, never as an inset", () => {
    const lanes = layoutTimeBlockLanes([
      { key: "five", top: 48, height: 16 },
      { key: "eight", top: 60, height: 16 },
      { key: "later", top: 96, height: 16 },
      { key: "long", top: 200, height: 200 },
      { key: "inside", top: 260, height: 16 }
    ]);

    expect(lanes.get("five")).toMatchObject({ laneCount: 2, laneIndex: 0, mode: "lane" });
    expect(lanes.get("eight")).toMatchObject({ laneCount: 2, laneIndex: 1, mode: "lane" });
    expect(lanes.get("later")).toMatchObject({ laneCount: 1, laneIndex: 0, mode: "full" });
    // A short block inside a long one is a column of its own, not an overlay.
    expect(lanes.get("long")).toMatchObject({ laneCount: 2, laneIndex: 0, offsetFraction: 0, widthFraction: 0.5 });
    expect(lanes.get("inside")).toMatchObject({ laneCount: 2, laneIndex: 1, offsetFraction: 0.5, widthFraction: 0.5 });
  });

  it("keeps three or more side-by-side blocks titled", () => {
    const lanes = layoutTimeBlockLanes([
      { key: "a", top: 0, height: 64 },
      { key: "b", top: 10, height: 64 },
      { key: "c", top: 20, height: 64 }
    ]);
    expect([...lanes.values()].map((lane) => lane.laneCount)).toEqual([3, 3, 3]);
    expect([...lanes.values()].every((lane) => !("textDensity" in lane))).toBe(true);
  });

  it("adds a two-pixel visual gap without changing semantic time geometry (dense-day rules)", () => {
    const semantic = { top: 512, height: 18 };
    const visual = calendarBlockVisualGeometry(semantic);

    expect(semantic).toEqual({ top: 512, height: 18 });
    expect(visual).toEqual({ top: 512, height: 16, visualGap: 2 });
    expect(visual.height).toBeGreaterThan(0);
    expect(calendarBlockVisualGeometry({ top: 512, height: 64 })).toEqual({
      top: 512,
      height: 62,
      visualGap: 2
    });
    expect(calendarBlockVisualGeometry({
      top: 512,
      height: 64,
      continuesIntoNextDay: true
    })).toEqual({ top: 512, height: 64, visualGap: 0 });
  });

  it("keeps the outer inset and splits two pixels across neighbouring overlap lanes (dense-day rules)", () => {
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 1 })).toEqual({
      left: 8,
      right: 8
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 0.5 })).toEqual({
      left: 8,
      right: "calc(50% + 1px)"
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0.5, widthFraction: 0.5 })).toEqual({
      left: "calc(50% + 1px)",
      right: 8
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0.08, widthFraction: 0.92 })).toEqual({
      left: "calc(8% + 1px)",
      right: 8
    });
  });

  it("moves a bracketed day's blocks and lanes right of the bracket rail (location v3 PR 14b)", () => {
    expect(calendarBracketRailPx).toBe(12);
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 1 }, calendarBracketRailPx)).toEqual({
      left: 20,
      right: 8
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0, widthFraction: 0.5 }, calendarBracketRailPx)).toEqual({
      left: 20,
      right: "calc((100% - 12px) * 0.5 + 1px)"
    });
    expect(calendarBlockLaneInsets({ offsetFraction: 0.5, widthFraction: 0.5 }, calendarBracketRailPx)).toEqual({
      left: "calc(12px + (100% - 12px) * 0.5 + 1px)",
      right: 8
    });
  });

  it("permits inline Play at safe height regardless of lane text density", () => {
    const tall = getTimeBlockDensity({ durationSeconds: 60 * 60, height: 64 });
    const tiny = getTimeBlockDensity({ durationSeconds: 5 * 60, height: 23 });
    const policy = (overrides: Partial<Parameters<typeof canShowTimeBlockInlineAction>[0]> = {}) =>
      canShowTimeBlockInlineAction({
        density: tall,
        isCompleted: true,
        isResizing: false,
        isSelected: false,
        ...overrides
      });

    expect(policy()).toBe(true);
    expect(policy({ density: tiny })).toBe(false);
    expect(policy({ isCompleted: false })).toBe(false);
    expect(policy({ isSelected: true })).toBe(false);
    expect(policy({ isResizing: true })).toBe(false);
    expect(policy()).toBe(true);
  });

  it("formats the combined primary and full-entry secondary lines", () => {
    const entry = {
      categoryName: "Personal",
      description: "Train station pickup/drop-off",
      startedAt: "2026-08-02T08:00:00.000Z",
      stoppedAt: "2026-08-02T09:15:29.000Z",
      tagNames: ["Family duties", "Errands", "Travel"]
    };
    expect(calendarBlockPrimaryLine(entry)).toBe(
      "Train station pickup/drop-off · Personal · #Family duties +2"
    );
    expect(calendarBlockPrimaryParts(entry)).toEqual({
      description: "Train station pickup/drop-off",
      category: "Personal",
      firstTag: "Family duties",
      hiddenTagCount: 2
    });
    expect(calendarBlockPrimaryLine({ ...entry, description: "", categoryName: null })).toBe(
      "No activity · #Family duties +2"
    );
    expect(calendarBlockSecondaryLine(entry, new Date("2026-08-02T12:00:00.000Z"), "24h")).toMatch(
      /^1h 15m \(.+ – .+\)$/
    );
    expect(calendarBlockSecondaryLine({
      startedAt: "2026-01-02T23:30:00.000Z",
      stoppedAt: "2026-01-03T00:30:00.000Z"
    }, new Date("2026-01-03T12:00:00.000Z"), "24h")).toContain("+1)");
    expect(calendarBlockSecondaryLine({ ...entry, stoppedAt: null }, new Date("2026-08-02T10:00:00.000Z"), "12h"))
      .toContain("– now)");
  });

  it("labels a block with its title and real length, and its detail line with activity and times", () => {
    const entry = {
      categoryName: "Deep work",
      description: "Quarterly plan",
      startedAt: "2026-08-02T09:45:00.000Z",
      stoppedAt: "2026-08-02T11:30:00.000Z",
      tagNames: []
    };
    expect(calendarBlockDurationLabel(entry, new Date("2026-08-02T12:00:00.000Z"))).toBe("1h 45m");
    expect(calendarBlockDurationLabel({ ...entry, stoppedAt: "2026-08-02T09:49:00.000Z" }, new Date())).toBe("4m");
    expect(calendarBlockDurationLabel({ ...entry, stoppedAt: null }, new Date("2026-08-02T09:56:00.000Z"))).toBe("11m");
    expect(calendarBlockDetailLine(entry, new Date("2026-08-02T12:00:00.000Z"), "24h")).toMatch(/^Deep work · \d\d:\d\d–\d\d:\d\d$/);
    expect(calendarBlockDetailLine({ ...entry, description: "" }, new Date("2026-08-02T12:00:00.000Z"), "24h")).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
    expect(calendarBlockDetailLine({ ...entry, stoppedAt: null }, new Date("2026-08-02T12:00:00.000Z"), "12h")).toMatch(/–now$/);
  });

  it("requires deliberate resize movement", () => {
    expect(resizeDragThresholdPx).toBeGreaterThanOrEqual(4);
  });

  it("gives a block its icon lines: the place, a trip's route or Apple Health, the tags, then the times (Calendar v3)", () => {
    const now = new Date("2026-10-24T15:00:00Z");
    const base = { startedAt: "2026-10-24T08:00:00Z", stoppedAt: "2026-10-24T09:20:00Z", tagNames: [] as string[] };
    expect(calendarBlockDetailLines({ ...base, placeName: "Exampleton Library", tagNames: ["planning"] }, now, "24h").map((line) => line.glyph))
      .toEqual(["map-pin", "tag", "clock"]);
    expect(calendarBlockDetailLines({ ...base, placeName: "Exampleton Station", automaticMoveEventId: "move" }, now, "24h")[0].glyph).toBe("route");
    expect(calendarBlockDetailLines({ ...base, placeName: "Exampleton Park", source: "health_workout" }, now, "24h")[0])
      .toEqual({ glyph: "heart-pulse", text: "From Apple Health" });
    const times = calendarBlockDetailLines(base, now, "24h");
    expect(times).toHaveLength(1);
    expect(times[0].text).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
    expect(calendarBlockDetailLines({ ...base, stoppedAt: null }, now, "24h")[0].text).toMatch(/–now$/);
  });

  it("lays blocks out with Apple's hybrid overlap in px across the measured lane (Calendar v3)", () => {
    const laneWidth = calendarLaneWidth(500);
    expect(laneWidth).toBe(500 - 16 + 2);
    const lanes = layoutTimeBlockHybrid([
      { key: "long", top: 0, height: 300 },
      { key: "close", top: 10, height: 40 },
      { key: "nested", top: 160, height: 40 }
    ], { laneWidth, pixelsPerHour: 64 });
    // Starts 10 px apart (under 20 minutes at 64 px an hour) sit side by side; a later start nests 14 px in.
    expect(lanes.get("long")).toMatchObject({ laneCount: 2, laneIndex: 0, px: { x: 0, depth: 0 } });
    expect(lanes.get("close")).toMatchObject({ laneCount: 2, laneIndex: 1 });
    expect(lanes.get("nested")?.px).toMatchObject({ x: 14, depth: 1 });
    expect(lanes.get("nested")!.zIndex).toBeGreaterThan(lanes.get("long")!.zIndex);
    // Drawn in px: right of the 8 px inset (and any rail), giving up the 2 px gap on the right.
    expect(calendarBlockLanePxInsets({ x: 14, width: 100, depth: 1 }, 12)).toEqual({ left: 8 + 12 + 14, width: 98, right: "auto" });
  });

  it("keeps every nested block above the one it starts inside, below the block in hand (Codex r1 on #583)", () => {
    // A staircase of shared-column groups, each nesting inside the last.
    const blocks = Array.from({ length: 12 }, (_, depth) => [
      { key: `d${depth}a`, top: depth * 40, height: 1000 },
      { key: `d${depth}b`, top: depth * 40 + 2, height: 1000 }
    ]).flat();
    const lanes = layoutTimeBlockHybrid(blocks, { laneWidth: 2000, pixelsPerHour: 64 });
    for (let depth = 1; depth < 12; depth += 1) {
      const parent = lanes.get(`d${depth - 1}b`)!;
      const child = lanes.get(`d${depth}a`)!;
      expect(child.px?.depth).toBeGreaterThan(parent.px!.depth);
      expect(child.zIndex).toBeGreaterThanOrEqual(parent.zIndex);
      expect(2 + child.zIndex).toBeLessThan(36);
    }
  });
});
