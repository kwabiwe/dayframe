import { describe, expect, it } from "vitest";
import {
  CALENDAR_BLOCK_LABEL,
  CALENDAR_V3_OVERLAP,
  layoutCalendarHybrid,
  calendarBlockLabelTier,
  calendarDenseLabel,
  calendarDrawnExtent,
  layoutCalendarBlockColumns,
  wholeWordsThatFit,
  type CalendarDrawnBlock
} from "./calendarBlockLayout";

/** The mock-up's synthetic Exampleton Thursday, drawn at the web's 64 px an hour from 06:00. */
const minute = (hh: number, mm: number) => hh * 60 + mm;
function drawn(blocks: Array<[string, number, number]>, pixelsPerHour: number, minimumHeight: number): CalendarDrawnBlock[] {
  const perMinute = pixelsPerHour / 60;
  return blocks.map(([id, start, end]) => ({ id, ...calendarDrawnExtent((start - 360) * perMinute, (end - start) * perMinute, minimumHeight) }));
}
const thursday: Array<[string, number, number]> = [
  ["school-run", minute(8, 36), minute(8, 47)],
  ["getting-around-am", minute(8, 47), minute(10, 39)],
  ["quarterly-plan", minute(10, 45), minute(12, 30)],
  ["call-with-sam", minute(11, 30), minute(11, 45)],
  ["coffee", minute(12, 30), minute(12, 34)],
  ["team-sync", minute(13, 30), minute(14, 40)],
  ["getting-around-pm", minute(14, 40), minute(16, 26)]
];
const byId = (layout: ReturnType<typeof layoutCalendarBlockColumns>) => Object.fromEntries(layout.map((item) => [item.id, item]));

describe("calendar block columns over drawn extents", () => {
  it("lays out the mock-up's Thursday as drawn: short blocks beside what their label line reaches", () => {
    const layout = byId(layoutCalendarBlockColumns(drawn(thursday, 64, CALENDAR_BLOCK_LABEL.webMinimumHeight)));
    // School run is 11 minutes: drawn one 16 px line tall, it reaches into Getting around.
    expect([layout["school-run"].columnIndex, layout["school-run"].columnCount]).toEqual([0, 2]);
    expect([layout["getting-around-am"].columnIndex, layout["getting-around-am"].columnCount]).toEqual([1, 2]);
    expect([layout["call-with-sam"].columnIndex, layout["call-with-sam"].columnCount]).toEqual([1, 2]);
    expect(layout["quarterly-plan"].columnCount).toBe(2);
    // Coffee starts where Quarterly plan ends: touching, so full width.
    expect(layout.coffee.columnCount).toBe(1);
    expect(layout["team-sync"].columnCount).toBe(1);
    expect(layout["getting-around-pm"].columnCount).toBe(1);
  });

  it("puts blocks side by side only when their drawn shapes collide, so zooming in can free them", () => {
    const blocks: Array<[string, number, number]> = [["a", minute(9, 0), minute(9, 5)], ["b", minute(9, 10), minute(10, 0)]];
    // 48 pt an hour: a 15 pt line is 18.75 minutes, so A's label reaches into B.
    expect(layoutCalendarBlockColumns(drawn(blocks, 48, 15)).map((item) => item.columnCount)).toEqual([2, 2]);
    // 128 pt an hour: 15 pt is about 7 minutes, so A ends before B starts.
    expect(layoutCalendarBlockColumns(drawn(blocks, 128, 15)).map((item) => item.columnCount)).toEqual([1, 1]);
  });

  it("reuses a freed column inside a cluster and gives every member the cluster's width", () => {
    const layout = byId(layoutCalendarBlockColumns([
      { id: "long", top: 0, bottom: 300 },
      { id: "first", top: 10, bottom: 60 },
      { id: "second", top: 80, bottom: 120 },
      { id: "third", top: 100, bottom: 140 }
    ]));
    expect(layout.long.columnIndex).toBe(0);
    expect(layout.first.columnIndex).toBe(1);
    expect(layout.second.columnIndex).toBe(1);
    expect(layout.third.columnIndex).toBe(2);
    expect(new Set(Object.values(layout).map((item) => item.columnCount))).toEqual(new Set([3]));
    expect(layout.third.offsetFraction).toBeCloseTo(2 / 3);
    expect(layout.third.widthFraction).toBeCloseTo(1 / 3);
  });

  it("chains collisions into one cluster and keeps touching blocks apart", () => {
    const chain = layoutCalendarBlockColumns([
      { id: "a", top: 0, bottom: 50 },
      { id: "b", top: 40, bottom: 90 },
      { id: "c", top: 80, bottom: 130 },
      { id: "d", top: 130.4, bottom: 160 }
    ]);
    expect(chain.filter((item) => item.id !== "d").every((item) => item.columnCount === 2)).toBe(true);
    expect(chain.find((item) => item.id === "d")).toMatchObject({ columnCount: 1, offsetFraction: 0, widthFraction: 1, zIndex: 0 });
  });

  it("is deterministic: same input in any order, duplicates and non-finite blocks left out", () => {
    const blocks: CalendarDrawnBlock[] = [
      { id: "b", top: 0, bottom: 40 },
      { id: "a", top: 0, bottom: 40 },
      { id: "c", top: 0, bottom: 80 },
      { id: "a", top: 500, bottom: 600 },
      { id: "nan", top: Number.NaN, bottom: 10 }
    ];
    const forward = layoutCalendarBlockColumns(blocks);
    const backward = layoutCalendarBlockColumns([...blocks].reverse().filter((block) => block.top !== 500));
    expect(forward.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(byId(forward)).toEqual(byId(backward));
  });

  it("keeps columns while a running block grows past a neighbour that started with it (Codex r2 on #545)", () => {
    const at = (runningBottom: number) => byId(layoutCalendarBlockColumns([
      { id: "done", top: 576, bottom: 608 },
      { id: "running", top: 576, bottom: runningBottom }
    ]));
    const before = at(597);
    const after = at(610);
    expect([before.done.columnIndex, before.running.columnIndex]).toEqual([after.done.columnIndex, after.running.columnIndex]);
  });

  it("stays O(n log n) when every block collides at once", () => {
    const coincident = Array.from({ length: 4000 }, (_, index) => ({ id: `c${index}`, top: 0, bottom: 20 }));
    const started = performance.now();
    const layout = layoutCalendarBlockColumns(coincident);
    expect(performance.now() - started).toBeLessThan(250);
    expect(new Set(layout.map((item) => item.columnIndex)).size).toBe(4000);
  });

  it("lays out 60 blocks well inside the layout budget", () => {
    const blocks = Array.from({ length: 60 }, (_, index) => ({ id: `b${index}`, top: index * 13, bottom: index * 13 + 15 + (index % 7) * 9 }));
    const started = performance.now();
    for (let run = 0; run < 100; run += 1) layoutCalendarBlockColumns(blocks);
    expect((performance.now() - started) / 100).toBeLessThan(4);
  });
});

describe("calendar block label tiers", () => {
  it("shows one line under 34, two from 34, the leg strip from 44 and only the icon under 34 wide", () => {
    expect(calendarBlockLabelTier({ height: 16, width: 120 })).toEqual({ lines: 1, iconOnly: false, legStrip: false, compactText: true });
    expect(calendarBlockLabelTier({ height: 33.9, width: 120 })).toMatchObject({ lines: 1, compactText: false });
    expect(calendarBlockLabelTier({ height: 34, width: 120 })).toMatchObject({ lines: 2, legStrip: false });
    expect(calendarBlockLabelTier({ height: 44, width: 120 })).toMatchObject({ lines: 2, legStrip: true });
    expect(calendarBlockLabelTier({ height: 80, width: 33 })).toMatchObject({ iconOnly: true });
  });

  it("never draws a block shorter than one label line", () => {
    expect(calendarDrawnExtent(100, 2, 16)).toEqual({ top: 100, bottom: 116 });
    expect(calendarDrawnExtent(100, 40, 16)).toEqual({ top: 100, bottom: 140 });
    expect(calendarDrawnExtent(100, Number.NaN, 15)).toEqual({ top: 100, bottom: 115 });
  });

  describe("dense-day rules (owner, 24 Oct 2026; mock-up calendar-dense v2)", () => {
    it("keeps every block in its own column for its whole height, and widens it right only into columns free for all of it", () => {
      // A long block meets a short one early (two columns); a later block beside the long one is free on its right.
      const layout = byId(layoutCalendarBlockColumns([
        { id: "short", top: 0, bottom: 18 },
        { id: "long", top: 10, bottom: 200 },
        { id: "later", top: 60, bottom: 80 }
      ], { expandRight: true }));
      expect(layout.short).toMatchObject({ columnIndex: 0, columnCount: 2, spanCount: 1, widthFraction: 0.5 });
      expect(layout.long).toMatchObject({ columnIndex: 1, columnCount: 2, spanCount: 1, widthFraction: 0.5 });
      // "later" takes the freed first column; the long block holds the second for its whole height.
      expect(layout.later).toMatchObject({ columnIndex: 0, spanCount: 1 });
      // Three columns, where a block in the first column can widen over a free third one.
      const three = byId(layoutCalendarBlockColumns([
        { id: "a", top: 0, bottom: 100 },
        { id: "b", top: 5, bottom: 30 },
        { id: "c", top: 10, bottom: 20 },
        { id: "d", top: 40, bottom: 60 }
      ], { expandRight: true }));
      expect(three.d).toMatchObject({ columnIndex: 1, columnCount: 3, spanCount: 2, offsetFraction: 1 / 3, widthFraction: 2 / 3 });
      expect(three.a).toMatchObject({ spanCount: 1 });
      // Without the option, nothing widens.
      expect(byId(layoutCalendarBlockColumns([{ id: "a", top: 0, bottom: 100 }, { id: "d", top: 40, bottom: 60 }, { id: "c", top: 10, bottom: 20 }])).d)
        .toMatchObject({ spanCount: 1 });
    });

    it("lets the title win: compact type, whole lines, the time only with room, a colour-only sliver", () => {
      const lines = { lineHeight: 16, compactLineHeight: 13, detailLineHeight: 15 };
      expect(calendarDenseLabel({ height: 18, width: 200, ...lines })).toEqual({ sliver: false, compact: true, detail: false, titleLines: 1 });
      expect(calendarDenseLabel({ height: 60, width: 80, ...lines })).toEqual({ sliver: false, compact: true, detail: false, titleLines: 4 });
      expect(calendarDenseLabel({ height: 60, width: 130, ...lines })).toEqual({ sliver: false, compact: false, detail: true, titleLines: 2 });
      expect(calendarDenseLabel({ height: 34, width: 130, ...lines })).toEqual({ sliver: false, compact: false, detail: true, titleLines: 1 });
      expect(calendarDenseLabel({ height: 60, width: 110, ...lines })).toMatchObject({ detail: false, titleLines: 3 });
      expect(calendarDenseLabel({ height: 60, width: 20, ...lines })).toEqual({ sliver: true, compact: true, detail: false, titleLines: 0 });
    });
  });
});

describe("wholeWordsThatFit (dense-day rules)", () => {
  it("keeps every word that fits and cuts from the first one wider than the title", () => {
    expect(wholeWordsThatFit([40, 20, 30], 50)).toBe(3);
    expect(wholeWordsThatFit([40, 60, 30], 50)).toBe(1);
    expect(wholeWordsThatFit([60, 20], 50)).toBe(0);
    expect(wholeWordsThatFit([50], 50)).toBe(1);
  });

  it("cuts nothing before layout", () => {
    expect(wholeWordsThatFit([60, 20], 0)).toBe(2);
    expect(wholeWordsThatFit([], 40)).toBe(0);
  });
});

// Calendar v3: the same cases as the iPhone's DayframeCalendarCoreTests (calendar-v3-mockup's synthetic Friday).
describe("layoutCalendarHybrid (Calendar v3, Apple's hybrid overlap)", () => {
  const hourHeight = 72;
  const laneWidth = 324;
  const block = (id: string, start: string, end: string) => {
    const minutes = (text: string) => { const [h, m] = text.split(":").map(Number); return h * 60 + m; };
    const top = (minutes(start) / 60) * hourHeight;
    return { id, top, bottom: Math.max((minutes(end) / 60) * hourHeight, top + 18) };
  };
  const day = [
    block("overnight", "01:00", "09:00"), block("gym", "05:00", "06:30"), block("walk", "06:30", "07:00"),
    block("prep", "07:00", "08:00"), block("plan", "09:00", "10:20"), block("sync", "09:00", "09:45"),
    block("inbox", "09:00", "09:05"), block("reply", "09:02", "09:06"), block("coffee", "09:05", "09:10"),
    block("party", "11:00", "13:30"), block("unknown", "11:00", "11:20"), block("parcel", "13:20", "13:40"),
    block("games", "18:00", "19:00"), block("bedtime", "18:45", "19:05"), block("shift", "20:00", "23:55"),
    block("stretch", "20:00", "20:40"), block("journal", "20:00", "20:20"), block("f1", "22:00", "22:45")
  ];

  it("puts close starts side by side and nests later starts 14 px in, on top", () => {
    const placed = new Map(layoutCalendarHybrid(day, { laneWidth, closeDistance: (CALENDAR_V3_OVERLAP.closeMinutes / 60) * hourHeight }).map((p) => [p.id, p]));
    expect(placed.get("overnight")).toMatchObject({ x: 0, width: laneWidth, depth: 0 });
    for (const id of ["gym", "walk", "prep"]) expect(placed.get(id)).toMatchObject({ depth: 1, x: 14, width: laneWidth - 14 });
    const nine = ["plan", "sync", "inbox", "reply", "coffee"].map((id) => placed.get(id)!);
    expect(nine.map((p) => p.columnCount)).toEqual([5, 5, 5, 5, 5]);
    expect(nine.map((p) => p.columnIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(nine.map((p) => p.depth)).toEqual([0, 0, 0, 0, 0]);
    expect(placed.get("unknown")?.columnIndex).toBe(1);
    expect(placed.get("parcel")).toMatchObject({ depth: 1, x: placed.get("party")!.x + 14 });
    expect(placed.get("bedtime")).toMatchObject({ depth: 1, x: 14 });
    expect(placed.get("f1")?.depth).toBe(1);
    expect(placed.get("f1")!.x + placed.get("f1")!.width).toBeCloseTo(laneWidth);
    expect(placed.get("shift")?.columnCount).toBe(3);
  });

  it("stops a nested group short of a block still running to its right, and never past the lane", () => {
    const placed = new Map(layoutCalendarHybrid([
      { id: "a", top: 0, bottom: 200 }, { id: "b", top: 0, bottom: 200 }, { id: "nested", top: 100, bottom: 150 }
    ], { laneWidth: 300, closeDistance: 24 }).map((p) => [p.id, p]));
    expect(placed.get("a")?.width).toBe(150);
    // Tied starts: the first placed is the parent; 2 short of b.
    expect(placed.get("nested")).toMatchObject({ depth: 1, x: 14 });
    expect(placed.get("nested")!.x + placed.get("nested")!.width).toBeCloseTo(148);
    const edge = layoutCalendarHybrid([
      { id: "wide", top: 0, bottom: 300 }, { id: "one", top: 50, bottom: 300 },
      { id: "two", top: 100, bottom: 300 }, { id: "three", top: 150, bottom: 300 }
    ], { laneWidth: 60, closeDistance: 24 });
    for (const placement of edge) {
      expect(placement.width).toBeGreaterThanOrEqual(Math.min(40, 60 - placement.x) - 0.001);
      expect(placement.x + placement.width).toBeLessThanOrEqual(60 + 0.001);
    }
  });

  it("lays out 500-block crowds and staircases quickly, inside the lane", () => {
    const crowd = Array.from({ length: 500 }, (_, index) => ({ id: `c${index}`, top: 9 * 48, bottom: 9 * 48 + 18 }));
    const staircase = Array.from({ length: 500 }, (_, index) => ({ id: `s${index}`, top: (index * 170 / 3600) * 48, bottom: 23.8 * 48 }));
    for (const blocks of [crowd, staircase]) {
      const started = performance.now();
      const placed = layoutCalendarHybrid(blocks, { laneWidth: 300, closeDistance: 18 });
      expect(performance.now() - started).toBeLessThan(250);
      expect(placed).toHaveLength(500);
      for (const placement of placed) expect(placement.x + placement.width).toBeLessThanOrEqual(300 + 1e-9);
    }
  });
});
