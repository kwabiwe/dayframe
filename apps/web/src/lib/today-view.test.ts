import { describe, expect, it } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";
import {
  activityTotals,
  blockRowHeight,
  buildGoalFrame,
  coveredActivityTotals,
  formatGoalHours,
  hourPercent,
  isUnsavedEntryId,
  localDayEnd,
  localDayStart,
  pendingReviewSeconds,
  pendingReviewSpans,
  previousDays,
  ribbonHitAt,
  staleEditError,
  todayBlocks,
  whereTodayWentBars,
  ribbonDrawnHitAt,
  ribbonNextStartMs,
  ribbonReach,
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

  it("keeps Sleep in the framed total but out of the goal cells and percent (UIA-043)", () => {
    const now = at(10, 12);
    const entries = [entry("night", iso(10, 0), iso(10, 7), "sleep"), entry("work", iso(10, 8), iso(10, 10), "focus"), entry("bare", iso(10, 10), iso(10, 11), null)];
    const frame = buildGoalFrame({
      categories: [{ id: "sleep", countsTowardGoal: false }, { id: "focus", countsTowardGoal: true }],
      entries,
      goalMinutes: 480,
      nowMs: now
    });
    expect(frame.totalSeconds).toBe(10 * 3600);
    // Time without an activity counts; Sleep does not.
    expect(frame.goalSeconds).toBe(3 * 3600);
    expect(frame.percent).toBe(38);
    expect(frame.cells.flat().some((slice) => slice.key.startsWith("night:"))).toBe(false);
    // Switched back on, or without the flag at all, every framed minute fills the goal.
    const on = buildGoalFrame({ categories: [{ id: "sleep", countsTowardGoal: true }], entries, goalMinutes: 480, nowMs: now });
    expect(on.goalSeconds).toBe(10 * 3600);
    expect(buildGoalFrame({ entries, goalMinutes: 480, nowMs: now }).percent).toBe(125);
  });

  it("falls back to an 8 hour goal and names it", () => {
    const frame = buildGoalFrame({ entries: [], goalMinutes: 0, nowMs: at(10, 9) });
    expect(frame.cells).toHaveLength(8);
    expect(formatGoalHours(frame.goalMinutes)).toBe("8h");
    expect(formatGoalHours(450)).toBe("7h 30m");
    expect(formatGoalHours(30)).toBe("30m");
    expect(formatGoalHours(45)).toBe("45m");
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

describe("Where today went (covered, overlaps shared)", () => {
  const day = at(10, 0);
  const nextDay = at(11, 0);
  const named = (totals: ReturnType<typeof coveredActivityTotals>) => totals.map((total) => [total.name, total.seconds]);
  const sum = (totals: ReturnType<typeof coveredActivityTotals>) => totals.reduce((total, item) => total + item.seconds, 0);

  it("no longer adds up to more than the hero when two activities overlap", () => {
    const now = at(10, 13);
    const entries = [entry("a", iso(10, 9), iso(10, 11)), entry("b", iso(10, 10), iso(10, 12), "admin")];
    const hero = buildGoalFrame({ entries, goalMinutes: 480, nowMs: now }).totalSeconds;
    expect(hero).toBe(3 * 3600);
    // Logged time (Reports, the Calendar head) counts 10:00–11:00 twice.
    expect(sum(activityTotals(entries, day, nextDay, now))).toBe(4 * 3600);
    // Today shares it: 1h 30m each.
    expect(named(coveredActivityTotals(entries, day, nextDay, now))).toEqual([
      ["Admin", 5400],
      ["Focus", 5400]
    ]);
    expect(sum(coveredActivityTotals(entries, day, nextDay, now))).toBe(hero);
  });

  it("splits a shared slice equally among two and three activities running in it", () => {
    const now = at(10, 18);
    const totals = coveredActivityTotals(
      [
        entry("a", iso(10, 9), iso(10, 12)),
        entry("b", iso(10, 10), iso(10, 12), "admin"),
        entry("c", iso(10, 11), iso(10, 12), null)
      ],
      day,
      nextDay,
      now
    );
    // 09–10 Focus alone; 10–11 Focus + Admin (30m each); 11–12 all three (20m each).
    expect(named(totals)).toEqual([
      ["Focus", 3600 + 1800 + 1200],
      ["Admin", 1800 + 1200],
      ["No activity", 1200]
    ]);
    expect(totals[2].color).toBeNull();
    expect(sum(totals)).toBe(3 * 3600);
  });

  it("counts two overlapping blocks of the same activity once", () => {
    const now = at(10, 18);
    const totals = coveredActivityTotals(
      [entry("a", iso(10, 9), iso(10, 11)), entry("b", iso(10, 10), iso(10, 12)), entry("c", iso(10, 10, 30), iso(10, 11), "admin")],
      day,
      nextDay,
      now
    );
    // Focus covers 09–12; Admin shares 10:30–11:00 with Focus only (two Focus blocks count as one).
    expect(named(totals)).toEqual([
      ["Focus", 3 * 3600 - 900],
      ["Admin", 900]
    ]);
  });

  it("runs a running block to now", () => {
    const now = at(10, 12, 30);
    const entries = [entry("a", iso(10, 9), iso(10, 11), "admin"), entry("live", iso(10, 10), null)];
    const totals = coveredActivityTotals(entries, day, nextDay, now);
    expect(named(totals)).toEqual([
      ["Focus", 1800 + 5400],
      ["Admin", 3600 + 1800]
    ]);
    expect(sum(totals)).toBe(buildGoalFrame({ entries, goalMinutes: 480, nowMs: now }).totalSeconds);
  });

  it("clips blocks to local midnight", () => {
    const now = at(10, 2);
    const entries = [entry("night", iso(9, 22), iso(10, 1)), entry("late", iso(9, 23), iso(10, 0, 30), "admin")];
    // Only 00:00–01:00 is today: 00:00–00:30 shared, then Focus alone.
    expect(named(coveredActivityTotals(entries, day, nextDay, now))).toEqual([
      ["Focus", 900 + 1800],
      ["Admin", 900]
    ]);
  });

  it("rounds to the hero's whole minutes, so the displayed bars add up to the displayed hero", () => {
    const now = at(10, 18);
    const focusEnd = new Date(at(10, 10, 30) + 40_000).toISOString();
    const adminEnd = new Date(at(10, 11, 30) + 30_000).toISOString();
    const entries = [entry("a", iso(10, 9), focusEnd), entry("b", iso(10, 11), adminEnd, "admin")];
    // Exactly 1h 30m 40s and 30m 30s: floored bars would read 1h 30m + 30m against a 2h 1m hero.
    const totals = coveredActivityTotals(entries, day, nextDay, now);
    expect(named(totals)).toEqual([
      ["Focus", 91 * 60],
      ["Admin", 30 * 60 + 10]
    ]);
    expect(sum(totals)).toBe(buildGoalFrame({ entries, goalMinutes: 480, nowMs: now }).totalSeconds);
  });

  it("always sums to the hero across random days", () => {
    let seed = 20261014;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    // Up to twelve activities, so many days need the "Other" bar.
    const activities = ["focus", "admin", "sleep", "gym", "reading", "cooking", "commute", "music", "family", "errands", "study", null] as const;
    let otherDays = 0;
    for (let run = 0; run < 400; run += 1) {
      const now = at(10, 0) + Math.floor(random() * 24 * 3_600_000);
      const dayStart = localDayStart(now);
      const dayEnd = localDayEnd(dayStart);
      const entries: TodayEntry[] = [];
      const count = 1 + Math.floor(random() * 16);
      for (let index = 0; index < count; index += 1) {
        // Some start yesterday, some run past now, some are still running; times to the millisecond.
        const from = dayStart - 3 * 3_600_000 + Math.floor(random() * 30 * 3_600_000);
        const to = random() < 0.15 ? null : from + 1 + Math.floor(random() * 4 * 3_600_000);
        const activity = activities[Math.floor(random() * activities.length)];
        entries.push(entry(`e${index}`, new Date(from).toISOString(), to === null ? null : new Date(to).toISOString(), activity));
      }
      const totals = coveredActivityTotals(entries, dayStart, dayEnd, now);
      const hero = buildGoalFrame({ entries, goalMinutes: 480, nowMs: now }).totalSeconds;
      expect(sum(totals)).toBe(hero);
      const bars = whereTodayWentBars(totals);
      expect(sum(bars)).toBe(hero);
      expect(bars.length).toBe(Math.min(totals.length, 5));
      if (totals.length > 5) {
        expect(bars[4].name).toBe("Other");
        expect(bars[4].includes).toEqual(totals.slice(4).map((total) => total.name));
      } else {
        expect(bars).toEqual(totals);
      }
      if (totals.length > 5) otherDays += 1;
      expect(totals.reduce((minutes, item) => minutes + Math.floor(item.seconds / 60), 0)).toBe(Math.floor(hero / 60));
      // Each bucket stays near its exact equal-split share (brute force over every boundary).
      const exact = bruteForceShares(entries, dayStart, dayEnd, now);
      for (const total of totals) expect(Math.abs(total.seconds - exact.get(total.key)! / 1000)).toBeLessThan(120);
      for (const [key, ms] of exact) if (ms >= 120_000) expect(totals.some((total) => total.key === key)).toBe(true);
      for (let index = 1; index < totals.length; index += 1) {
        const [before, after] = [totals[index - 1], totals[index]];
        expect(before.seconds > after.seconds || (before.seconds === after.seconds && before.name.localeCompare(after.name) <= 0)).toBe(true);
      }
    }
    expect(otherDays).toBeGreaterThan(50);
  });

  it("keeps the top four and gathers the rest into a neutral Other bar, last, when there are more than five", () => {
    const now = at(10, 18);
    for (const count of [6, 10]) {
      const names = ["focus", "admin", "sleep", "gym", "reading", "cooking", "commute", "music", "family", "errands"].slice(0, count);
      // Every activity runs 09:00–10:00 together, plus one more lone minute each so the order is fixed.
      const entries = names.flatMap((name, index) => [
        entry(`${name}-shared`, iso(10, 9), iso(10, 10), name),
        entry(`${name}-own`, iso(10, 11, index * 2), iso(10, 11, index * 2 + count - index), name)
      ]);
      const hero = buildGoalFrame({ entries, goalMinutes: 480, nowMs: now }).totalSeconds;
      const totals = coveredActivityTotals(entries, day, nextDay, now);
      const bars = whereTodayWentBars(totals);
      expect(totals).toHaveLength(count);
      expect(bars).toHaveLength(5);
      expect(bars.slice(0, 4)).toEqual(totals.slice(0, 4));
      expect(bars[4]).toMatchObject({ key: "__other", name: "Other", categoryId: null, color: null });
      expect(bars[4].includes).toEqual(totals.slice(4).map((total) => total.name));
      expect(sum(bars)).toBe(hero);
    }
    // Five or fewer: every activity, unchanged.
    const five = coveredActivityTotals(
      ["focus", "admin", "sleep", "gym", "reading"].map((name) => entry(name, iso(10, 9), iso(10, 10), name)),
      day,
      nextDay,
      now
    );
    expect(whereTodayWentBars(five)).toEqual(five);
  });
});

function bruteForceShares(entries: readonly TodayEntry[], startMs: number, endMs: number, nowMs: number) {
  const clips = entries.flatMap((item) => {
    const from = Math.max(Date.parse(item.startedAt), startMs);
    const to = Math.min(item.stoppedAt ? Date.parse(item.stoppedAt) : nowMs, endMs, nowMs);
    return to > from ? [{ key: item.categoryId ?? "none", from, to }] : [];
  });
  const points = [...new Set(clips.flatMap((clip) => [clip.from, clip.to]))].sort((a, b) => a - b);
  const shares = new Map<string, number>();
  for (let index = 1; index < points.length; index += 1) {
    const keys = new Set(clips.filter((clip) => clip.from <= points[index - 1] && clip.to >= points[index]).map((clip) => clip.key));
    for (const key of keys) shares.set(key, (shares.get(key) ?? 0) + (points[index] - points[index - 1]) / keys.size);
  }
  return shares;
}

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

  it("a minimum-width block never reaches over the next block (X2, Codex r3)", () => {
    const all = [{ id: "a", fromMs: 1000, toMs: 1010 }, { id: "b", fromMs: 1100, toMs: 5000 }];
    const reached = ribbonReach(all, all, 500);
    expect(reached[0].toMs).toBe(1100); // stops where b starts, not at 1500
    expect(reached[1].toMs).toBe(5000);
    expect(ribbonNextStartMs(all[0], all)).toBe(1100);
    // Overlapping in time: no clamp (they stack, later on top).
    const overlapping = [{ id: "a", fromMs: 1000, toMs: 2000 }, { id: "b", fromMs: 1500, toMs: 3000 }];
    expect(ribbonNextStartMs(overlapping[0], overlapping)).toBeNull();
  });

  it("a tap selects the block drawn under it (X2, Codex r3)", () => {
    // 300 px track over a day: 12:00–12:01 then 12:01–13:00; minimum 3 px, gap 1 px.
    const day = 86_400_000;
    const px = (value: number) => (value / 300) * day;
    const at = (hour: number, minute: number) => (hour * 60 + minute) * 60_000;
    const entries = [{ id: "a", fromMs: at(12, 0), toMs: at(12, 1) }, { id: "b", fromMs: at(12, 1), toMs: at(13, 0) }];
    const options = { minimumMs: px(3), halfGapMs: px(0.5) };
    // a reaches only to b's start (150.21 px), so it is drawn 150.5–149.7: hidden by the gap; b from 150.71.
    expect(ribbonDrawnHitAt(px(151), entries, [], options)).toEqual({ kind: "entry", id: "b" });
    expect(ribbonDrawnHitAt(px(160), entries, [], options)).toEqual({ kind: "entry", id: "b" });
    // In the gap itself, the full reach still answers.
    expect(ribbonDrawnHitAt(px(150.6), entries, [], options).kind).toBe("entry");
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

describe("ribbon details", () => {
  it("picks the later-started block when two are clipped to the same midnight", () => {
    const entries = [
      { id: "older", fromMs: 0, toMs: 200, startedMs: -7200 },
      { id: "newer", fromMs: 0, toMs: 100, startedMs: -3600 }
    ];
    expect(ribbonHitAt(50, entries, [])).toEqual({ kind: "entry", id: "newer" });
    expect(ribbonHitAt(150, entries, [])).toEqual({ kind: "entry", id: "older" });
  });

  it("breaks an equal-start tie the way the ribbon paints it (larger ID on top), in any input order", () => {
    const a = { id: "a", fromMs: 0, toMs: 100, startedMs: 0 };
    const b = { id: "b", fromMs: 0, toMs: 100, startedMs: 0 };
    expect(ribbonHitAt(50, [a, b], [])).toEqual({ kind: "entry", id: "b" });
    expect(ribbonHitAt(50, [b, a], [])).toEqual({ kind: "entry", id: "b" });
  });

  it("picks the suggestion painted on top when suggestions overlap", () => {
    const pending = [
      { id: "location", fromMs: 0, toMs: 100 },
      { id: "walk", fromMs: 25, toMs: 75 }
    ];
    expect(ribbonHitAt(50, [], pending)).toEqual({ kind: "pending", id: "walk" });
    expect(ribbonHitAt(90, [], pending)).toEqual({ kind: "pending", id: "location" });
  });

  it("places hour marks by local wall-clock time", () => {
    const start = at(10, 0);
    expect(hourPercent(start, localDayEnd(start), 6)).toBeCloseTo(25);
    expect(hourPercent(start, localDayEnd(start), 24)).toBe(100);
  });

  it("recognises a Start the server has not saved yet", () => {
    expect(isUnsavedEntryId("optimistic-timer:2026-10-10T09:00:00.000Z:1")).toBe(true);
    expect(isUnsavedEntryId("80000000-0000-4000-8000-000000000001")).toBe(false);
  });
});
