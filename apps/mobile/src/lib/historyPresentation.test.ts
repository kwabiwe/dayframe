import { describe, expect, it } from "vitest";
import { buildHistoryDaySections, historyDayLabel } from "./historyPresentation";
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
