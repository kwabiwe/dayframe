import { describe, expect, it } from "vitest";
import type { ReportSummary } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { buildReportRange } from "./reportsRanges";
import {
  buildReportsPresentation,
  entryOverlapMs,
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
    seconds: index === 11 ? 7200 : 0,
    byCategory:
      index === 11
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
      buckets: [{ key: range.buckets[11].key, seconds: 3600 }],
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
