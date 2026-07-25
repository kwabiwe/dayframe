import { describe, expect, it } from "vitest";
import { groupTimelineEntries } from "@/lib/timeline-entry-groups";
import type { TimeEntryRow } from "@/lib/queries";

function entry(overrides: Partial<TimeEntryRow>): TimeEntryRow {
  return {
    id: "entry-1",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "category-1",
    categoryName: "Work",
    categoryColor: "blue",
    description: "Planning",
    startedAt: "2026-07-25T08:00:00.000Z",
    stoppedAt: "2026-07-25T08:30:00.000Z",
    durationSeconds: 1800,
    placeId: null,
    placeName: null,
    source: "manual",
    confidence: "high",
    reviewStatus: "confirmed",
    tagNames: [],
    tags: [],
    ...overrides
  };
}

describe("groupTimelineEntries", () => {
  it("groups normalized descriptions within the same category and sums duration", () => {
    const groups = groupTimelineEntries([
      entry({ id: "newest", description: " Planning ", durationSeconds: 1800 }),
      entry({ id: "older", description: "planning", durationSeconds: 900 })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((item) => item.id)).toEqual(["newest", "older"]);
    expect(groups[0].totalSeconds).toBe(2700);
  });

  it("keeps categories separate and leaves blank uncategorized entries individual", () => {
    const groups = groupTimelineEntries([
      entry({ id: "work", categoryId: "work", categoryName: "Work" }),
      entry({ id: "home", categoryId: "home", categoryName: "Home" }),
      entry({ id: "blank-1", categoryId: null, categoryName: null, description: null }),
      entry({ id: "blank-2", categoryId: null, categoryName: null, description: " " })
    ]);
    expect(groups).toHaveLength(4);
  });

  it("groups descriptionless entries when category provides a useful identity", () => {
    const groups = groupTimelineEntries([
      entry({ id: "one", description: null }),
      entry({ id: "two", description: "" })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
  });
});
