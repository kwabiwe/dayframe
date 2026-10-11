import { DAYFRAME_THEME } from "@dayframe/shared";
import { describe, expect, it } from "vitest";
import type { ReportSummary } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { buildReportRange } from "./reportsRanges";
import {
  buildReportsPresentation,
  entryOverlapMs,
  reportGoalSeconds,
  formatReportPercent,
  reportAxis,
} from "./reportsPresentation";
const now = +new Date(2026, 8, 9, 12);
const range = buildReportRange("today", now);
const entry = (values: Partial<MobileTimeEntry> = {}) =>
  ({
    id: "timer",
    categoryId: "a",
    categoryName: "Same name",
    categoryColor: "blue",
    reviewStatus: "confirmed",
    startedAt: new Date(now - 3600000).toISOString(),
    stoppedAt: null,
    ...values,
  }) as MobileTimeEntry;
const data = (activeEntry: MobileTimeEntry | null = null) =>
  ({
    activeEntry,
    categories: [],
    entries: [],
    user: { id: "u" },
    workspace: { id: "w" },
  }) as unknown as MobileBootstrap;
const summary = (): ReportSummary => ({
  capturedNow: new Date(now).toISOString(),
  range: range.request,
  totalSeconds: 7200,
  categories: [
    {
      key: "a",
      categoryId: "a",
      name: "Same name",
      color: "blue",
      seconds: 3600,
    },
    {
      key: "b",
      categoryId: "b",
      name: "Same name",
      color: "red",
      seconds: 3600,
    },
  ],
  buckets: range.buckets.map((b, index) => ({
    key: b.key,
    seconds: index === 0 ? 7200 : 0,
    byCategory:
      index === 0
        ? [
            { key: "a", seconds: 3600 },
            { key: "b", seconds: 3600 },
          ]
        : [],
  })),
  active: null,
});
describe("Revision 2 Reports projection", () => {
  it("counts overlap independently, keeps context denominator and reconciles none/some/all", () => {
    for (const selection of [
      { mode: "all" },
      { mode: "none" },
      { mode: "include", keys: ["a"] },
    ] as const) {
      const result = buildReportsPresentation({
        data: data(),
        summary: summary(),
        range,
        nowMs: now,
        selection,
        themeMode: "dark",
      });
      expect(result.contextDurationMs).toBe(7200000);
      expect(result.selectedLoggedSeconds).toBe(
        selection.mode === "all" ? 7200 : selection.mode === "none" ? 0 : 3600,
      );
      expect(result.buckets.reduce((sum, b) => sum + b.seconds, 0)).toBe(
        result.selectedLoggedSeconds,
      );
    }
  });
  it("replaces captured active contribution and ticks only the projected timer", () => {
    const snap = summary();
    snap.active = {
      id: "timer",
      categoryId: "a",
      startedAt: entry().startedAt,
      buckets: [{ key: range.buckets[0].key, seconds: 3600 }],
    };
    const result = buildReportsPresentation({
      data: data(entry()),
      summary: snap,
      range,
      nowMs: now + 60000,
      selection: { mode: "all" },
      themeMode: "dark",
    });
    expect(result.selectedLoggedSeconds).toBe(7260);
    const stopped = data();
    stopped.entries = [
      entry({ stoppedAt: new Date(now - 1800000).toISOString() }),
    ];
    expect(
      buildReportsPresentation({
        data: stopped,
        summary: snap,
        range,
        nowMs: now,
        selection: { mode: "all" },
        themeMode: "dark",
      }).selectedLoggedSeconds,
    ).toBe(5400);
    stopped.entries = [entry()];
    expect(buildReportsPresentation({
      data: stopped, summary: snap, range, nowMs: now,
      selection: { mode: "all" }, themeMode: "dark",
    }).selectedLoggedSeconds).toBe(3600);
    expect(
      buildReportsPresentation({
        data: data(),
        summary: snap,
        range,
        nowMs: now,
        selection: { mode: "all" },
        themeMode: "dark",
      }).selectedLoggedSeconds,
    ).toBe(3600);
  });
  it("excludes provisional active entries and clips at range and now", () => {
    expect(
      buildReportsPresentation({
        data: data(entry({ reviewStatus: "needs_review" })),
        summary: summary(),
        range,
        nowMs: now,
        selection: { mode: "all" },
        themeMode: "dark",
      }).selectedLoggedSeconds,
    ).toBe(7200);
    expect(
      entryOverlapMs(
        entry({
          startedAt: new Date(+range.start - 3600000).toISOString(),
          stoppedAt: new Date(+range.start + 3600000).toISOString(),
        }),
        range,
        now,
      ),
    ).toBe(3600000);
  });
  it("keeps >8 categories, unavailable selection and sub-percent labels", () => {
    const snap = summary();
    snap.categories = Array.from({ length: 12 }, (_, i) => ({
      key: String(i),
      categoryId: String(i),
      name: "Same",
      color: null,
      seconds: 1,
    }));
    snap.buckets[0].byCategory = snap.categories.map((c) => ({
      key: c.key,
      seconds: 1,
    }));
    const result = buildReportsPresentation({
      data: data(),
      summary: snap,
      range,
      nowMs: now,
      selection: { mode: "include", keys: ["gone"] },
      themeMode: "dark",
    });
    expect(result.allCategorySegments).toHaveLength(12);
    expect(
      result.filterOptions.find((o) => o.key === "gone")?.isUnavailable,
    ).toBe(true);
    expect(formatReportPercent(1, 1000)).toBe("<1%");
  });
  it("orders selected categories by exact duration then stable category key", () => {
    const snap = summary();
    snap.categories = [
      { key: "sleep", categoryId: "sleep", name: "Sleep", color: null, seconds: 21600 },
      { key: "general", categoryId: "general", name: "General", color: null, seconds: 7200 },
      { key: "test-z", categoryId: "test-z", name: "Test Z", color: null, seconds: 1800 },
      { key: "uncategorized", categoryId: null, name: "No activity", color: null, seconds: 2700 },
      { key: "test-a", categoryId: "test-a", name: "Test A", color: null, seconds: 1800 },
    ];
    snap.buckets[0].byCategory = snap.categories.map((category) => ({
      key: category.key,
      seconds: category.seconds,
    }));
    const result = buildReportsPresentation({
      data: data(),
      summary: snap,
      range,
      nowMs: now,
      selection: { mode: "all" },
      themeMode: "dark",
    });
    expect(result.visibleCategorySegments.map((segment) => segment.key)).toEqual([
      "sleep",
      "general",
      "uncategorized",
      "test-a",
      "test-z",
    ]);
    // Time without an activity is neutral, as on Calendar and Today.
    expect(result.visibleCategorySegments.find((segment) => segment.key === "uncategorized")?.color).toBe(
      DAYFRAME_THEME.dark.textMuted,
    );
  });
  it("clips a future projected timer to now instead of creating future time", () => {
    const future = entry({
      id: "optimistic-active-timer:future",
      startedAt: new Date(now + 60_000).toISOString(),
    });
    const result = buildReportsPresentation({
      data: data(future),
      summary: summary(),
      range,
      nowMs: now,
      selection: { mode: "all" },
      themeMode: "dark",
    });
    expect(result.selectedLoggedSeconds).toBe(7200);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].seconds).toBe(7200);
  });
  it("allows a running timer to cross ranks without freezing first-seen order", () => {
    const snap = summary();
    snap.categories = [
      { key: "a", categoryId: "a", name: "A", color: null, seconds: 3600 },
      { key: "b", categoryId: "b", name: "B", color: null, seconds: 3500 },
    ];
    snap.buckets[0].byCategory = [
      { key: "a", seconds: 3600 },
      { key: "b", seconds: 3500 },
    ];
    const running = entry({
      id: "timer",
      categoryId: "b",
      categoryName: "B",
      startedAt: new Date(now - 3_500_000).toISOString(),
    });
    snap.active = {
      id: "timer",
      categoryId: "b",
      startedAt: running.startedAt,
      buckets: [{ key: range.buckets[0].key, seconds: 3500 }],
    };
    const ordered = (at: number) =>
      buildReportsPresentation({
        data: data(running),
        summary: snap,
        range,
        nowMs: at,
        selection: { mode: "all" },
        themeMode: "dark",
      }).visibleCategorySegments.map((segment) => segment.key);
    expect(ordered(now)).toEqual(["a", "b"]);
    expect(ordered(now + 200_000)).toEqual(["b", "a"]);
  });
  it.each([0, 60, 3600, 7200, 1000000])(
    "uses a zero-based nice axis above %s seconds",
    (max) => {
      const axis = reportAxis(max);
      expect(axis.maximum).toBeGreaterThanOrEqual(max);
      expect(axis.ticks).toHaveLength(3);
      expect(axis.ticks.at(-1)?.seconds).toBe(0);
      expect(new Set(axis.ticks.map((t) => t.label)).size).toBe(3);
    },
  );
});

describe("Blocks day stacks", () => {
  it("gives each bucket its selected activities in the overall order, with their colours", () => {
    const week = buildReportRange("week", now);
    const weekSummary: ReportSummary = {
      capturedNow: new Date(now).toISOString(),
      range: week.request,
      totalSeconds: 9000,
      categories: [
        { key: "a", categoryId: "a", name: "Work", color: "blue", seconds: 5400 },
        { key: "b", categoryId: "b", name: "Gym", color: "red", seconds: 3600 },
      ],
      buckets: week.buckets.map((b, index) => ({
        key: b.key,
        seconds: index === 0 ? 5400 : index === 1 ? 3600 : 0,
        byCategory:
          index === 0
            ? [
                { key: "b", seconds: 1800 },
                { key: "a", seconds: 3600 },
              ]
            : index === 1
              ? [
                  { key: "a", seconds: 1800 },
                  { key: "b", seconds: 1800 },
                ]
              : [],
      })),
      active: null,
    };
    const all = buildReportsPresentation({
      data: data(),
      summary: weekSummary,
      range: week,
      nowMs: now,
      selection: { mode: "all" },
      themeMode: "dark",
    });
    expect(all.buckets[0].segments.map((s) => [s.key, s.seconds])).toEqual([
      ["a", 3600],
      ["b", 1800],
    ]);
    expect(all.buckets[0].segments[0].color).toBe(
      all.allCategorySegments.find((c) => c.key === "a")!.color,
    );
    expect(all.buckets[2].segments).toEqual([]);
    const gymOnly = buildReportsPresentation({
      data: data(),
      summary: weekSummary,
      range: week,
      nowMs: now,
      selection: { mode: "include", keys: ["b"] },
      themeMode: "dark",
    });
    expect(gymOnly.buckets[1].segments.map((s) => s.key)).toEqual(["b"]);
    expect(gymOnly.buckets[1].seconds).toBe(1800);
  });
});

describe("goal streak time (UIA-043)", () => {
  const week = buildReportRange("week", now);
  const monday = +week.buckets[0].start;
  const at = (hour: number) => new Date(monday + hour * 3_600_000).toISOString();
  const withEntries = (entries: MobileTimeEntry[], extra: Partial<MobileBootstrap> = {}) =>
    ({ ...data(), entries, ...extra }) as MobileBootstrap;

  const weekSummary = (goalSeconds: number[] | null, active: ReportSummary["active"] = null): ReportSummary => ({
    capturedNow: new Date(now).toISOString(),
    range: week.request,
    totalSeconds: 8 * 3600,
    categories: [{ key: "work", categoryId: "work", name: "Work", color: "blue", seconds: 8 * 3600 }],
    buckets: week.buckets.map((b, index) => ({
      key: b.key,
      seconds: index === 0 ? 8 * 3600 : 0,
      byCategory: index === 0 ? [{ key: "work", seconds: 8 * 3600 }] : [],
      ...(goalSeconds ? { goalSeconds: goalSeconds[index] ?? 0 } : {}),
    })),
    active,
  });
  const present = (summary: ReportSummary, bootstrap: MobileBootstrap = data()) =>
    buildReportsPresentation({ data: bootstrap, summary, range: week, nowMs: now, selection: { mode: "all" }, themeMode: "dark" });

  it("takes covered goal time from the fresh report, not the logged sum", () => {
    // Two overlapping 4h Work blocks: 8h logged, 4h covered goal time.
    const presented = present(weekSummary([4 * 3600]));
    expect(presented.buckets[0].seconds).toBe(8 * 3600);
    expect(presented.buckets[0].goalSeconds).toBe(4 * 3600);
    // An older server without goal time: the streak falls back to the phone's entries.
    expect(present(weekSummary(null)).buckets[0].goalSeconds).toBeUndefined();
  });

  it("unions the server's goal intervals with the locally projected timer (overlaps once)", () => {
    // Codex repro: a counting block 08:00–15:00 and a server timer 09:00–16:00 whose Stop at 14:00
    // is still queued. Real coverage is 08:00–15:00 = 7h, not 8h − 7h + 5h = 6h.
    const day = week.buckets[0];
    const at = (hour: number) => new Date(+day.start + hour * 3_600_000).toISOString();
    const local = entry({ id: "timer", categoryId: "work", startedAt: at(9), stoppedAt: at(14) });
    const withIntervals = (timerStart: number): ReportSummary => {
      const base = weekSummary(week.buckets.map((_, index) => (index === 0 ? 8 * 3600 : 0)), {
        id: "timer",
        categoryId: "work",
        startedAt: at(timerStart),
        buckets: [{ key: day.key, seconds: (16 - timerStart) * 3600 }],
      });
      return {
        ...base,
        buckets: base.buckets.map((bucket, index) => ({
          ...bucket,
          goalIntervals: index === 0 ? [{ start: at(8), end: at(15) }] : [],
        })),
      };
    };
    const later = Date.parse(at(17));
    const presentAt = (summary: ReportSummary, bootstrap: MobileBootstrap) =>
      buildReportsPresentation({ data: bootstrap, summary, range: week, nowMs: Math.max(now, later), selection: { mode: "all" }, themeMode: "dark" });
    const bootstrap = { ...data(), entries: [local] } as MobileBootstrap;
    expect(presentAt(withIntervals(9), bootstrap).buckets[0].goalSeconds).toBe(7 * 3600);
    // The timer's start corrected locally to 07:00: it now extends coverage to 07:00–15:00.
    const corrected = { ...data(), entries: [{ ...local, startedAt: at(7) }] } as MobileBootstrap;
    expect(presentAt(withIntervals(9), corrected).buckets[0].goalSeconds).toBe(8 * 3600);
    // A timer in an activity that doesn’t count adds nothing beyond the server’s counting intervals.
    const notCounting = { ...corrected, goalExcludedCategoryIds: ["work"] } as MobileBootstrap;
    expect(presentAt(withIntervals(9), notCounting).buckets[0].goalSeconds).toBe(7 * 3600);
  });

  it("swaps the server's running-timer share for the local projection in goal time (goalSeconds only)", () => {
    const today = week.buckets.findIndex((b) => +b.start <= now && now < +b.end);
    const startedAt = new Date(now - 2 * 3_600_000).toISOString();
    const captured = 3600;
    const goal = week.buckets.map((_, index) => (index === today ? captured : 0));
    const active = { id: "timer", categoryId: "work", startedAt, buckets: [{ key: week.buckets[today].key, seconds: captured }] };
    const running = entry({ id: "timer", categoryId: "work", startedAt, stoppedAt: null });
    // The server read an hour of the timer; locally it has run two.
    expect(present(weekSummary(goal, active), data(running)).buckets[today].goalSeconds).toBe(2 * 3600);
    // A timer in an activity that doesn't count never adds goal time.
    const sleeping = { ...data(running), goalExcludedCategoryIds: ["work"] } as MobileBootstrap;
    expect(present(weekSummary(week.buckets.map(() => 0), active), sleeping).buckets[today].goalSeconds).toBe(0);
  });

  it("counts overlapping goal time once, as Today and web Reports do", () => {
    const work = (id: string) => entry({ id, categoryId: "work", startedAt: at(8), stoppedAt: at(12) });
    const seconds = reportGoalSeconds(withEntries([work("one"), work("two")]), week.buckets, now);
    expect(seconds[0]).toBe(4 * 3600);
  });

  it("leaves out Sleep, even archived, and keeps time without an activity", () => {
    const entries = [
      entry({ id: "night", categoryId: "sleep", startedAt: at(0), stoppedAt: at(7) }),
      entry({ id: "work", categoryId: "work", startedAt: at(9), stoppedAt: at(10) }),
      entry({ id: "bare", categoryId: null, startedAt: at(10), stoppedAt: at(11) }),
      entry({ id: "suggested", categoryId: "work", reviewStatus: "needs_review", startedAt: at(13), stoppedAt: at(14) }),
    ];
    // Sleep archived: not in `categories`, but in the bootstrap's exclusion list.
    expect(reportGoalSeconds(withEntries(entries, { goalExcludedCategoryIds: ["sleep"] }), week.buckets, now)[0]).toBe(2 * 3600);
    // An older bootstrap without the list counts everything.
    expect(reportGoalSeconds(withEntries(entries), week.buckets, now)[0]).toBe(9 * 3600);
    // The active activity's own switch wins over a stale list.
    const switchedOn = withEntries(entries, {
      categories: [{ id: "sleep", name: "Sleep", color: "blue", isPinned: false, countsTowardGoal: true }],
      goalExcludedCategoryIds: ["sleep"],
    });
    expect(reportGoalSeconds(switchedOn, week.buckets, now)[0]).toBe(9 * 3600);
  });
});
