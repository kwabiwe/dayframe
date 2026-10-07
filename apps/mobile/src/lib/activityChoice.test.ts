import { describe, expect, it } from "vitest";
import { activityChips, activityPickerSections, canCreateActivity, recentActivityIds } from "./activityChoice";

const activity = (id: string, name: string, isPinned = false, icon: string | null = null) => ({ color: "blue", icon, id, isPinned, name });
const all = [
  activity("work", "Work", true, "work"),
  activity("admin", "Admin", true, "admin"),
  activity("gym", "Exercise", true, "gym"),
  activity("walk", "Walk", false, "walk"),
  activity("piano", "Zorblax", false, null),
  activity("meals", "Meals", false, "meals"),
  activity("sleep", "Sleep", false, "sleep"),
  activity("family", "Family", false, "family"),
  activity("commute", "Commute", false, "commute"),
];

describe("recentActivityIds", () => {
  it("orders activities by their newest entry, without repeats", () => {
    expect(recentActivityIds([
      { categoryId: "walk", startedAt: "2026-10-06T08:00:00Z" },
      { categoryId: "piano", startedAt: "2026-10-07T08:00:00Z" },
      { categoryId: null, startedAt: "2026-10-07T09:00:00Z" },
      { categoryId: "walk", startedAt: "2026-10-07T10:00:00Z" },
      { categoryId: "bad", startedAt: "not a date" },
    ])).toEqual(["walk", "piano"]);
  });
});

describe("activityChips", () => {
  it("shows the chosen activity, then pinned, then recent, at most seven", () => {
    const chips = activityChips(all, "commute", ["piano", "work", "walk", "meals", "sleep", "family"]);
    expect(chips.map((chip) => chip.id)).toEqual(["commute", "work", "admin", "gym", "piano", "walk", "meals"]);
  });

  it("skips a chosen or recent activity that no longer exists", () => {
    expect(activityChips(all, "gone", ["gone", "walk"]).map((chip) => chip.id)).toEqual(["work", "admin", "gym", "walk"]);
  });
});

describe("activityPickerSections", () => {
  it("lists Recent, then your own, then each icon group A–Z", () => {
    const sections = activityPickerSections(all, "", ["piano", "walk"]);
    expect(sections.map((section) => section.title)).toEqual(["Recent", "Your own", "Work and study", "Body and mind", "Home and life", "People", "Getting around"]);
    expect(sections[0].rows.map((row) => row.id)).toEqual(["piano", "walk"]);
    expect(sections[1].rows.map((row) => row.id)).toEqual(["piano"]);
    expect(sections[2].rows.map((row) => row.id)).toEqual(["admin", "work"]);
  });

  it("filters by name, earliest match first", () => {
    const [results] = activityPickerSections([...all, activity("walkies", "Dog walk")], "wal", []);
    expect(results.title).toBeNull();
    expect(results.rows.map((row) => row.id)).toEqual(["walk", "walkies"]);
  });
});

describe("canCreateActivity", () => {
  it("offers Create only for a new name", () => {
    expect(canCreateActivity(all, "  ")).toBe(false);
    expect(canCreateActivity(all, "work ")).toBe(false);
    expect(canCreateActivity(all, "Pottery")).toBe(true);
  });
});
