import { describe, expect, it } from "vitest";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import { buildReportsPresentation } from "./reportsPresentation";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");

function entry(input: Partial<MobileTimeEntry> & Pick<MobileTimeEntry, "id" | "startedAt" | "stoppedAt">): MobileTimeEntry {
  return {
    categoryColor: "blue",
    categoryId: "work",
    categoryName: "Work",
    clientName: null,
    confidence: "high",
    description: null,
    durationSeconds: 0,
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "mobile_app",
    ...input
  };
}

function bootstrap(entries: MobileTimeEntry[], extra: Partial<MobileBootstrap> = {}): MobileBootstrap {
  return {
    activeEntry: null,
    categories: [
      { id: "work", name: "Work", color: "blue", isPinned: false },
      { id: "health", name: "Health", color: "green", isPinned: false }
    ],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    places: [],
    projects: [],
    reviewItems: [],
    user: { id: "user", email: "user@example.test", name: "User" },
    workspace: { id: "workspace", name: "Workspace" },
    ...extra
  };
}

function report(data: MobileBootstrap, selection: { mode: "all" } | { mode: "include"; keys: string[] } = { mode: "all" }, period: "today" | "week" = "today") {
  return buildReportsPresentation({ data, nowMs: NOW, period, selection, themeMode: "dark" });
}

describe("Reports presentation accounting", () => {
  it("recomputes logged, covered, and overlap from selected intervals", () => {
    const data = bootstrap([
      entry({ id: "work", startedAt: "2026-09-08T09:00:00.000Z", stoppedAt: "2026-09-08T10:00:00.000Z" }),
      entry({ id: "health", categoryId: "health", categoryName: "Health", startedAt: "2026-09-08T09:30:00.000Z", stoppedAt: "2026-09-08T10:30:00.000Z" })
    ]);
    expect(report(data)).toMatchObject({ selectedLoggedSeconds: 7200, selectedCoveredSeconds: 5400, selectedAdditionalOverlapSeconds: 1800 });
    expect(report(data, { mode: "include", keys: ["health"] })).toMatchObject({ selectedLoggedSeconds: 3600, selectedCoveredSeconds: 3600, selectedAdditionalOverlapSeconds: 0, contextDurationMs: 7_200_000 });
  });

  it("uses the shared additional-activity result for triple overlap", () => {
    const data = bootstrap(["work", "health", "family"].map((categoryId, index) => entry({
      id: categoryId,
      categoryId,
      categoryName: categoryId,
      categoryColor: index === 0 ? "blue" : "green",
      startedAt: "2026-09-08T09:00:00.000Z",
      stoppedAt: "2026-09-08T10:00:00.000Z"
    })));
    expect(report(data)).toMatchObject({
      selectedLoggedSeconds: 10_800,
      selectedCoveredSeconds: 3_600,
      selectedAdditionalOverlapSeconds: 7_200
    });
  });

  it("keeps all categories in the context denominator and distinct same-name IDs", () => {
    const entries = Array.from({ length: 15 }, (_, index) => entry({
      id: `entry-${index}`,
      categoryId: `category-${index}`,
      categoryName: index < 2 ? "Same" : `Category ${index}`,
      startedAt: "2026-09-08T00:00:00.000Z",
      stoppedAt: "2026-09-08T00:30:00.000Z"
    }));
    const presentation = report(bootstrap(entries));
    expect(presentation.allCategorySegments).toHaveLength(15);
    expect(presentation.allCategorySegments.filter((segment) => segment.categoryName === "Same").map((segment) => segment.key).sort()).toEqual(["category-0", "category-1"]);
  });

  it("clips a cross-midnight running entry into both daily windows once", () => {
    const localNow = new Date(2026, 8, 8, 0, 10).getTime();
    const running = entry({ id: "running", startedAt: new Date(2026, 8, 7, 23, 50).toISOString(), stoppedAt: null });
    const presentation = buildReportsPresentation({ data: bootstrap([running], { activeEntry: running }), nowMs: localNow, period: "week", selection: { mode: "all" }, themeMode: "dark" });
    const positive = presentation.selectedWeekDailyBars.filter((bar) => bar.durationMs > 0);
    expect(positive.map((bar) => bar.durationMs)).toEqual([600_000, 600_000]);
    expect(presentation.selectedLoggedSeconds).toBe(1200);
  });

  it("allocates a completed overnight sleep entry across its local calendar days", () => {
    const localNow = new Date(2026, 8, 8, 12).getTime();
    const sleep = entry({
      id: "sleep",
      categoryId: "health",
      categoryName: "Health",
      source: "healthkit",
      startedAt: new Date(2026, 8, 7, 23, 30).toISOString(),
      stoppedAt: new Date(2026, 8, 8, 7).toISOString()
    });
    const presentation = buildReportsPresentation({ data: bootstrap([sleep]), nowMs: localNow, period: "week", selection: { mode: "all" }, themeMode: "dark" });
    expect(presentation.selectedWeekDailyBars.filter((bar) => bar.durationMs > 0).map((bar) => bar.durationMs)).toEqual([
      30 * 60_000,
      7 * 60 * 60_000
    ]);
  });

  it("keeps accounting invariants and output totals independent of source ordering", () => {
    let state = 0x5eed1234;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const startOfDay = new Date(2026, 8, 8).getTime();
    const entries = Array.from({ length: 60 }, (_, index) => {
      const start = startOfDay + Math.floor(random() * 10 * 60) * 60_000;
      const duration = (5 + Math.floor(random() * 115)) * 60_000;
      const categoryId = index % 3 === 0 ? "health" : index % 3 === 1 ? "work" : "family";
      return entry({
        id: `seeded-${index}`,
        categoryId,
        categoryName: categoryId,
        startedAt: new Date(start).toISOString(),
        stoppedAt: new Date(start + duration).toISOString()
      });
    });
    const forward = report(bootstrap(entries));
    const reverse = report(bootstrap([...entries].reverse()));

    expect(forward.selectedLoggedSeconds).toBeGreaterThanOrEqual(forward.selectedCoveredSeconds);
    expect(forward.selectedAdditionalOverlapSeconds).toBe(forward.selectedLoggedSeconds - forward.selectedCoveredSeconds);
    expect(forward.allCategorySegments.reduce((sum, segment) => sum + segment.durationMs, 0)).toBe(forward.contextDurationMs);
    expect(reverse).toMatchObject({
      selectedLoggedSeconds: forward.selectedLoggedSeconds,
      selectedCoveredSeconds: forward.selectedCoveredSeconds,
      selectedAdditionalOverlapSeconds: forward.selectedAdditionalOverlapSeconds,
      contextDurationMs: forward.contextDurationMs
    });
  });

  it("uses Uncategorized for null IDs, retains historical categories, and excludes Review-needed rows", () => {
    const presentation = report(bootstrap([
      entry({ id: "none", categoryId: null, categoryName: "Legacy label", startedAt: "2026-09-08T08:00:00.000Z", stoppedAt: "2026-09-08T08:30:00.000Z" }),
      entry({ id: "archived", categoryId: "archived", categoryName: "Archived", startedAt: "2026-09-08T09:00:00.000Z", stoppedAt: "2026-09-08T09:30:00.000Z" }),
      entry({ id: "review", reviewStatus: "needs_review", startedAt: "2026-09-08T10:00:00.000Z", stoppedAt: "2026-09-08T11:00:00.000Z" })
    ]));
    expect(presentation.allCategorySegments.map((segment) => segment.key).sort()).toEqual(["archived", "uncategorized"]);
    expect(presentation.filterOptions.find((option) => option.key === "archived")?.name).toBe("Archived");
    expect(presentation.selectedLoggedSeconds).toBe(3600);
  });

  it("retains subsecond geometry and excludes reversed or non-active open entries", () => {
    const presentation = report(bootstrap([
      entry({ id: "tiny", startedAt: "2026-09-08T09:00:00.000Z", stoppedAt: "2026-09-08T09:00:00.500Z" }),
      entry({ id: "reversed", startedAt: "2026-09-08T10:00:00.000Z", stoppedAt: "2026-09-08T09:00:00.000Z" }),
      entry({ id: "stale-open", startedAt: "2026-09-08T08:00:00.000Z", stoppedAt: null })
    ]));
    expect(presentation.contextDurationMs).toBe(500);
    expect(presentation.allCategorySegments).toHaveLength(1);
  });

  it("keeps selected weekly Daily time when the selected category has no time today", () => {
    const workYesterday = entry({ id: "yesterday", startedAt: "2026-09-07T09:00:00.000Z", stoppedAt: "2026-09-07T10:00:00.000Z" });
    const presentation = report(bootstrap([workYesterday]), { mode: "include", keys: ["work"] }, "today");
    expect(presentation.selectedLoggedSeconds).toBe(0);
    expect(presentation.selectedWeekDailyBars.reduce((sum, bar) => sum + bar.durationMs, 0)).toBe(3_600_000);
  });

  it("preserves the shared 59/60-second meaningful-overlap boundary", () => {
    const make = (overlapSeconds: number) => report(bootstrap([
      entry({ id: "a", startedAt: "2026-09-08T09:00:00.000Z", stoppedAt: "2026-09-08T10:00:00.000Z" }),
      entry({ id: "b", categoryId: "health", startedAt: new Date(Date.parse("2026-09-08T10:00:00.000Z") - overlapSeconds * 1000).toISOString(), stoppedAt: "2026-09-08T11:00:00.000Z" })
    ])).selectedAdditionalOverlapSeconds;
    expect(make(59)).toBe(0);
    expect(make(60)).toBe(60);
  });

  it("does not upgrade partial source coverage after filtering", () => {
    const data = bootstrap([], { entryCoverage: {
      capturedAt: new Date(NOW).toISOString(),
      dayEntries: { from: "2026-09-08T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 100, hasMore: true },
      weekEntries: { from: "2026-09-07T00:00:00.000Z", toExclusive: "2026-09-14T00:00:00.000Z", limit: 300, hasMore: true },
      historyEntries: { from: "2026-07-01T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 2000, hasMore: true }
    } });
    expect(report(data, { mode: "include", keys: ["work"] }).dataQuality.selectedPeriod).toBe("partial");
  });
});
