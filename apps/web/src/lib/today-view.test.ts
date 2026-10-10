import { describe, expect, it } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";
import {
  activityTotals,
  blockRowHeight,
  buildGoalFrame,
  formatGoalHours,
  localDayEnd,
  localDayStart,
  pendingReviewSeconds,
  pendingReviewSpans,
  previousDays,
  ribbonHitAt,
  staleEditError,
  todayBlocks,
  withMinimumSpan,
  type TodayEntry
} from "@/lib/today-view";

// Local wall-clock times, so the tests hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const iso = (day: number, hour: number, minute = 0) => new Date(at(day, hour, minute)).toISOString();

function entry(id: string, from: string, to: string | null, categoryId: string | null = "focus"): TodayEntry {
  return {
    id,
    startedAt: from,
    stoppedAt: to,
    categoryId,
    categoryName: categoryId ? categoryId[0].toUpperCase() + categoryId.slice(1) : null,
    categoryColor: categoryId ? "mint" : null
  };
}

describe("Today day boundaries", () => {
  it("uses the browser's local midnights", () => {
    const now = at(10, 14, 30);
    expect(localDayStart(now)).toBe(at(10, 0));
    expect(localDayStart(now, -1)).toBe(at(9, 0));
    expect(localDayEnd(at(10, 0))).toBe(at(11, 0));
  });
});

describe("goal frame", () => {
  it("counts overlapping time once and fills cells in start order, stopping at the goal", () => {
    const now = at(10, 12);
    const frame = buildGoalFrame({
      entries: [
        entry("a", iso(10, 8), iso(10, 10)),
        // Overlaps a for an hour: only 10:00–11:00 is new covered time.
        entry("b", iso(10, 9), iso(10, 11), "admin")
      ],
      goalMinutes: 120,
      nowMs: now
    });
    expect(frame.totalSeconds).toBe(3 * 3600);
    expect(frame.percent).toBe(150);
    expect(frame.cells).toHaveLength(2);
    expect(frame.cells[0].map((slice) => [slice.key, slice.fraction])).toEqual([["a:0", 1]]);
    expect(frame.cells[1].map((slice) => [slice.key, slice.fraction])).toEqual([["a:1", 1]]);
  });

  it("clips yesterday's tail and a running block to now, and marks the live slice", () => {
    const now = at(10, 1, 30);
    const frame = buildGoalFrame({
      entries: [entry("night", iso(9, 23), iso(10, 1)), entry("live", iso(10, 1), null)],
      goalMinutes: 480,
      nowMs: now
    });
    expect(frame.totalSeconds).toBe(90 * 60);
    const slices = frame.cells.flat();
    expect(slices.find((slice) => slice.live)?.key.startsWith("live:")).toBe(true);
  });

  it("falls back to an 8 hour goal and names it", () => {
    const frame = buildGoalFrame({ entries: [], goalMinutes: 0, nowMs: at(10, 9) });
    expect(frame.cells).toHaveLength(8);
    expect(formatGoalHours(frame.goalMinutes)).toBe("8h");
    expect(formatGoalHours(450)).toBe("7h 30m");
  });
});

describe("Today's blocks", () => {
  it("lists entries overlapping today newest first, clipped to the day and now", () => {
    const now = at(10, 12);
    const rows = todayBlocks(
      [
        entry("old", iso(9, 9), iso(9, 10)),
        entry("cross", iso(9, 23), iso(10, 1)),
        entry("live", iso(10, 11), null),
        entry("mid", iso(10, 9), iso(10, 10))
      ],
      localDayStart(now),
      now
    );
    expect(rows.map((row) => row.entry.id)).toEqual(["live", "mid", "cross"]);
    expect(rows[2].clip).toEqual({ fromMs: at(10, 0), toMs: at(10, 1) });
    expect(rows[0].clip.toMs).toBe(now);
  });

  it("sizes a row's block 22–44 px by duration", () => {
    expect(blockRowHeight(0)).toBe(22);
    expect(blockRowHeight(3_600_000)).toBe(34);
    expect(blockRowHeight(10 * 3_600_000)).toBe(44);
  });
});

describe("Where today went", () => {
  it("totals logged time per activity, No activity included, largest first", () => {
    const now = at(10, 18);
    const totals = activityTotals(
      [
        entry("a", iso(10, 8), iso(10, 9)),
        entry("b", iso(10, 10), iso(10, 12), "admin"),
        entry("c", iso(10, 13), iso(10, 13, 30), null),
        entry("d", iso(10, 14), iso(10, 14, 30))
      ],
      at(10, 0),
      at(11, 0),
      now
    );
    expect(totals.map((total) => [total.name, total.seconds])).toEqual([
      ["Admin", 7200],
      ["Focus", 5400],
      ["No activity", 1800]
    ]);
    expect(totals[2].color).toBeNull();
  });
});

describe("This week", () => {
  it("summarises the six days before today, newest first, with covered totals", () => {
    const now = at(10, 9);
    const days = previousDays(
      [entry("a", iso(9, 6), iso(9, 12)), entry("b", iso(9, 11), iso(9, 13), "admin"), entry("c", iso(3, 9), iso(3, 10))],
      now
    );
    expect(days.map((day) => day.dateKey)).toEqual([
      "2026-10-09",
      "2026-10-08",
      "2026-10-07",
      "2026-10-06",
      "2026-10-05",
      "2026-10-04"
    ]);
    expect(days[0].totalSeconds).toBe(7 * 3600);
    expect(days[0].segments).toHaveLength(2);
    expect(days[0].segments[0].left).toBeCloseTo(25);
    expect(days[0].segments[0].width).toBeCloseTo(25);
  });
});

describe("Review on Today", () => {
  const item = (id: string, from: string | null, to: string | null, status = "open") => ({
    id,
    title: `Item ${id}`,
    status,
    suggestedStartedAt: from,
    suggestedStoppedAt: to,
    suggestedCategoryId: "focus",
    categoryName: "Focus",
    categoryColor: "mint"
  }) as unknown as ReviewItemRow;

  it("draws open suggestions with a complete window on the ribbon and sums their time", () => {
    const now = at(10, 12);
    const items = [
      item("a", iso(10, 7), iso(10, 8)),
      item("b", iso(10, 9), null),
      item("c", iso(10, 10), iso(10, 11), "resolved"),
      item("d", iso(9, 9), iso(9, 10))
    ];
    expect(pendingReviewSpans(items, at(10, 0), at(11, 0), now).map((span) => span.id)).toEqual(["a"]);
    expect(pendingReviewSeconds(items)).toBe(2 * 3600);
  });

  it("finds the entry under a point (newest wins), then a suggestion, else the gap", () => {
    const entries = [
      { id: "early", fromMs: 0, toMs: 100 },
      { id: "late", fromMs: 50, toMs: 150 }
    ];
    const pending = [{ id: "p", fromMs: 200, toMs: 300 }];
    expect(ribbonHitAt(75, entries, pending)).toEqual({ kind: "entry", id: "late" });
    expect(ribbonHitAt(250, entries, pending)).toEqual({ kind: "pending", id: "p" });
    expect(ribbonHitAt(400, entries, pending)).toEqual({ kind: "gap", atMs: 400 });
  });

  it("hit-tests a very short block at its drawn minimum width", () => {
    const entries = withMinimumSpan([{ id: "short", fromMs: 1000, toMs: 1010 }], 500);
    expect(ribbonHitAt(1300, entries, [])).toEqual({ kind: "entry", id: "short" });
    expect(ribbonHitAt(1600, entries, [])).toEqual({ kind: "gap", atMs: 1600 });
  });
});

describe("editing a block that changed elsewhere", () => {
  it("refuses a running block's save once it stopped, another block runs, or it was deleted", () => {
    const running = { id: "a", stoppedAt: null };
    expect(staleEditError(running, [running], "a")).toBeNull();
    expect(staleEditError(running, [{ id: "a", stoppedAt: iso(10, 9) }, { id: "b", stoppedAt: null }], "b")).toMatch(/stopped/);
    expect(staleEditError(running, [running, { id: "b", stoppedAt: null }], "b")).toMatch(/stopped/);
    expect(staleEditError(running, [], null)).toMatch(/deleted/);
    const finished = { id: "c", stoppedAt: iso(10, 9) };
    expect(staleEditError(finished, [finished], "b")).toBeNull();
  });
});
