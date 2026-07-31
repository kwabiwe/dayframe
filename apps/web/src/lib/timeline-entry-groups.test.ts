import { describe, expect, it } from "vitest";
import {
  groupTimelineEntries,
  groupTimelineEntriesByDay,
  timelineEntryGroupKey
} from "@/lib/timeline-entry-groups";
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
    updatedAt: "2026-07-25T08:30:00.000Z",
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

  it("keeps categories separate and groups blank uncategorized entries through the normal fallback key", () => {
    const groups = groupTimelineEntries([
      entry({ id: "work", categoryId: "work", categoryName: "Work" }),
      entry({ id: "home", categoryId: "home", categoryName: "Home" }),
      entry({ id: "blank-1", categoryId: null, categoryName: null, description: null }),
      entry({ id: "blank-2", categoryId: null, categoryName: null, description: " " })
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.at(-1)?.entries.map((item) => item.id)).toEqual(["blank-1", "blank-2"]);
    expect(timelineEntryGroupKey(groups.at(-1)!.representative)).not.toContain("entry:");
  });

  it("keeps blank uncategorized tag sets as part of the existing grouping identity", () => {
    const sameTags = groupTimelineEntries([
      entry({ id: "one", categoryId: null, categoryName: null, description: null, tagNames: [" Cubic ", "A24"] }),
      entry({ id: "two", categoryId: null, categoryName: null, description: " ", tagNames: ["a24", "cubic"] })
    ]);
    const differentTags = groupTimelineEntries([
      entry({ id: "a24", categoryId: null, categoryName: null, description: null, tagNames: ["A24"] }),
      entry({ id: "cubic", categoryId: null, categoryName: null, description: null, tagNames: ["Cubic"] })
    ]);

    expect(sameTags).toHaveLength(1);
    expect(sameTags[0]?.entries.map((item) => item.id)).toEqual(["one", "two"]);
    expect(differentTags).toHaveLength(2);
  });

  it("keeps uncategorized descriptions grouped only when their normalized text matches", () => {
    const matching = groupTimelineEntries([
      entry({ id: "one", categoryId: null, categoryName: null, description: " Planning   notes " }),
      entry({ id: "two", categoryId: null, categoryName: null, description: "planning notes" })
    ]);
    const different = groupTimelineEntries([
      entry({ id: "one", categoryId: null, categoryName: null, description: "Planning" }),
      entry({ id: "two", categoryId: null, categoryName: null, description: "Reading" })
    ]);

    expect(matching).toHaveLength(1);
    expect(different).toHaveLength(2);
  });

  it("keeps matching blank uncategorized entries separate across List day partitions", () => {
    const groups = groupTimelineEntriesByDay(
      [
        entry({ id: "friday", categoryId: null, categoryName: null, description: null, startedAt: "2026-07-31T08:00:00.000Z" }),
        entry({ id: "thursday", categoryId: null, categoryName: null, description: null, startedAt: "2026-07-30T08:00:00.000Z" })
      ],
      (item) => item.startedAt.slice(0, 10)
    );

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.day)).toEqual(["2026-07-31", "2026-07-30"]);
    expect(groups.map((group) => group.entries.map((item) => item.id))).toEqual([["friday"], ["thursday"]]);
  });

  it("groups descriptionless entries when category provides a useful identity", () => {
    const groups = groupTimelineEntries([
      entry({ id: "one", description: null }),
      entry({ id: "two", description: "" })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(2);
  });

  it("keeps otherwise identical entries separate when their tags differ", () => {
    const groups = groupTimelineEntries([
      entry({ id: "a24", tagNames: ["A24"] }),
      entry({ id: "cubic", tagNames: ["Cubic"] })
    ]);

    expect(groups).toHaveLength(2);
  });

  it("groups identical canonical tag sets regardless of order, case, or duplicates", () => {
    const groups = groupTimelineEntries([
      entry({ id: "newest", tagNames: [" Cubic ", "A24", "a24"] }),
      entry({ id: "older", tagNames: ["a24", "cubic"] })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((item) => item.id)).toEqual(["newest", "older"]);
  });

  it("keeps tagged and untagged entries in separate groups", () => {
    const groups = groupTimelineEntries([
      entry({ id: "tagged", tagNames: ["A24"] }),
      entry({ id: "untagged", tagNames: [] })
    ]);

    expect(groups).toHaveLength(2);
  });

  it("keeps a running entry separate while stopped matches still group", () => {
    const groups = groupTimelineEntries([
      entry({ id: "running", stoppedAt: null }),
      entry({ id: "stopped-new" }),
      entry({ id: "stopped-old", startedAt: "2026-07-25T07:00:00.000Z" })
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe("running:running");
    expect(groups[0]?.entries).toHaveLength(1);
    expect(groups[1]?.entries.map((item) => item.id)).toEqual(["stopped-new", "stopped-old"]);
  });
});
