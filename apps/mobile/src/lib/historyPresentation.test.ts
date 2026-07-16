import { describe, expect, it } from "vitest";
import { buildHistoryDaySections, groupHistoryDayEntries, historyDayLabel } from "./historyPresentation";
import type { MobileTimeEntry } from "./api";

describe("mobile history presentation", () => {
  it("groups up to sixty days newest first and keeps today present", () => {
    const nowMs = new Date(2026, 6, 16, 12, 0).getTime();
    const sections = buildHistoryDaySections({
      entries: [
        entry("today", new Date(2026, 6, 16, 9, 0), new Date(2026, 6, 16, 10, 0)),
        entry("yesterday", new Date(2026, 6, 15, 8, 0), new Date(2026, 6, 15, 8, 30)),
        entry("outside", new Date(2026, 4, 1, 8, 0), new Date(2026, 4, 1, 9, 0))
      ],
      nowMs
    });

    expect(sections.map((section) => section.key)).toEqual(["2026-07-16", "2026-07-15"]);
    expect(sections[0].totalSeconds).toBe(3600);
    expect(historyDayLabel(sections[0], nowMs)).toBe("Today");
    expect(historyDayLabel(sections[1], nowMs)).toBe("Yesterday");
  });

  it("allocates cross-midnight time to both local day sections", () => {
    const nowMs = new Date(2026, 6, 16, 2, 0).getTime();
    const sections = buildHistoryDaySections({
      entries: [entry("overnight", new Date(2026, 6, 15, 23, 30), new Date(2026, 6, 16, 0, 30))],
      nowMs
    });

    expect(sections.map((section) => [section.key, section.totalSeconds])).toEqual([
      ["2026-07-16", 1800],
      ["2026-07-15", 1800]
    ]);
  });

  it("deduplicates bootstrap overlap and uses the shared active timestamp", () => {
    const nowMs = new Date(2026, 6, 16, 12, 15).getTime();
    const active = entry("active", new Date(2026, 6, 16, 12, 0), null);
    const sections = buildHistoryDaySections({ entries: [active, { ...active }], nowMs });

    expect(sections[0].entries).toHaveLength(1);
    expect(sections[0].totalSeconds).toBe(900);
  });

  it("groups descriptionless tasks by category and totals their overlap", () => {
    const grouped = groupHistoryDayEntries([
      { entry: entry("work-one", new Date(2026, 6, 16, 9, 0), new Date(2026, 6, 16, 9, 30)), overlapSeconds: 1800 },
      { entry: entry("work-two", new Date(2026, 6, 16, 10, 0), new Date(2026, 6, 16, 11, 0)), overlapSeconds: 3600 }
    ].map((item) => ({
      ...item,
      entry: { ...item.entry, categoryId: "work", categoryName: "Work", description: null }
    })));

    expect(grouped).toHaveLength(1);
    expect(grouped[0].entries.map(({ entry: item }) => item.id)).toEqual(["work-one", "work-two"]);
    expect(grouped[0].totalSeconds).toBe(5400);
  });

  it("groups matching descriptions case-insensitively but keeps categories separate", () => {
    const base = [
      { ...entry("school-one", new Date(2026, 6, 16, 9, 0), new Date(2026, 6, 16, 9, 30)), description: "School drop-off" },
      { ...entry("school-two", new Date(2026, 6, 16, 10, 0), new Date(2026, 6, 16, 10, 30)), description: "  school   DROP-OFF " },
      { ...entry("school-work", new Date(2026, 6, 16, 11, 0), new Date(2026, 6, 16, 11, 30)), categoryId: "work", categoryName: "Work", description: "School drop-off" }
    ];
    const grouped = groupHistoryDayEntries(base.map((item) => ({ entry: item, overlapSeconds: 1800 })));

    expect(grouped).toHaveLength(2);
    expect(grouped[0].entries).toHaveLength(2);
    expect(grouped[1].entries).toHaveLength(1);
  });
});

function entry(id: string, startedAt: Date, stoppedAt: Date | null): MobileTimeEntry {
  return {
    categoryColor: "blue",
    categoryId: "category",
    categoryName: "Category",
    clientName: null,
    confidence: "manual",
    description: id,
    durationSeconds: stoppedAt ? Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000) : 0,
    id,
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "manual_app",
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt?.toISOString() ?? null
  };
}
