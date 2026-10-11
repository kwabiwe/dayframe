import { describe, expect, it } from "vitest";
import type { CategoryRow, TimeEntryRow } from "@/lib/queries";
import { activityNameProblem, activityWeeks, formatActivityWeek, libraryGroups, pinLimitReached } from "@/lib/library-activities";

const activity = (id: string, name: string, overrides: Partial<CategoryRow> = {}): CategoryRow => ({ id, name, color: "mint", isPinned: false, icon: null, ...overrides });
const DAY = 24 * 3_600_000;
const NOW = Date.UTC(2026, 9, 10, 12);

function entry(id: string, categoryId: string | null, fromMs: number, toMs: number | null): TimeEntryRow {
  return { id, categoryId, startedAt: new Date(fromMs).toISOString(), stoppedAt: toMs === null ? null : new Date(toMs).toISOString() } as TimeEntryRow;
}

describe("Library activities", () => {
  it("groups your own first (always, for New activity), then icon groups with activities, A–Z", () => {
    const groups = libraryGroups([activity("1", "Work"), activity("2", "Zither practice"), activity("3", "Admin")]);
    expect(groups.map((group) => group.title)).toEqual(["Your own", "Work and study"]);
    expect(groups[0].activities.map((item) => item.name)).toEqual(["Zither practice"]);
    expect(groups[1].activities.map((item) => item.name)).toEqual(["Admin", "Work"]);
    expect(libraryGroups([])).toEqual([{ key: "group-own", title: "Your own", ownGroup: true, activities: [] }]);
  });

  it("caps quick start at six pins, never blocking an unpin", () => {
    const six = Array.from({ length: 6 }, (_, index) => activity(`${index}`, `A${index}`, { isPinned: true }));
    const all = [...six, activity("x", "Extra")];
    expect(pinLimitReached(all, "x")).toBe(true);
    expect(pinLimitReached(all, "0")).toBe(false);
    expect(pinLimitReached(all.slice(1), "x")).toBe(false);
  });

  it("refuses an empty name or one another activity has (any case)", () => {
    const list = [activity("1", "Reading")];
    expect(activityNameProblem(list, "  ", null)).toBe("Give the activity a name.");
    expect(activityNameProblem(list, "reading ", null)).toBe("reading already exists.");
    expect(activityNameProblem(list, "Reading", "1")).toBeNull();
  });

  it("buckets six rolling weeks, clipping entries and counting each entry once", () => {
    const series = activityWeeks([
      [entry("a", "c1", NOW - 2 * 3_600_000, NOW - 3_600_000)],
      // The same entry in another list counts once.
      [entry("a", "c1", NOW - 2 * 3_600_000, NOW - 3_600_000), entry("b", "c1", NOW - 8 * DAY, NOW - 8 * DAY + 1_800_000)],
      // Running: up to now. Older than six weeks: ignored. No activity: ignored.
      [entry("r", "c2", NOW - 600_000, null), entry("old", "c1", NOW - 60 * DAY, NOW - 59 * DAY), entry("n", null, NOW - DAY, NOW - DAY + 60_000)]
    ], NOW);
    expect(series.get("c1")).toEqual([0, 0, 0, 0, 1_800, 3_600]);
    expect(series.get("c2")).toEqual([0, 0, 0, 0, 0, 600]);
    expect(series.has("null")).toBe(false);
  });

  it("writes the last 7 days plainly", () => {
    expect(formatActivityWeek(0)).toBe("Not used in the last 7 days");
    expect(formatActivityWeek(1_800)).toBe("30m in the last 7 days");
    expect(formatActivityWeek(7_200)).toBe("2h in the last 7 days");
    expect(formatActivityWeek(9_000)).toBe("2h 30m in the last 7 days");
  });
});
