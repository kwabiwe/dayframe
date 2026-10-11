import { describe, expect, it } from "vitest";
import {
  DAYFRAME_STARTER_ACTIVITIES,
  categoryCountsTowardGoal,
  goalCountingEntries,
  goalCountingSeconds,
  goalExcludedCategoryIds
} from "./index";

const categories = [
  { id: "work", countsTowardGoal: true },
  { id: "sleep", countsTowardGoal: false },
  { id: "older-client" }
];

describe("goal counting (UIA-043)", () => {
  it("leaves out only activities switched off", () => {
    expect([...goalExcludedCategoryIds(categories)]).toEqual(["sleep"]);
    const excluded = goalExcludedCategoryIds(categories);
    expect(categoryCountsTowardGoal("sleep", excluded)).toBe(false);
    expect(categoryCountsTowardGoal("work", excluded)).toBe(true);
    // A missing flag (older server, archived activity not in the list) keeps counting.
    expect(categoryCountsTowardGoal("older-client", excluded)).toBe(true);
    expect(categoryCountsTowardGoal("unknown", excluded)).toBe(true);
  });

  it("counts time without an activity", () => {
    const excluded = goalExcludedCategoryIds(categories);
    expect(categoryCountsTowardGoal(null, excluded)).toBe(true);
    expect(categoryCountsTowardGoal(undefined, excluded)).toBe(true);
    expect(categoryCountsTowardGoal("uncategorized", excluded)).toBe(true);
  });

  it("filters entries and sums per-activity seconds by the same rule", () => {
    const entries = [
      { id: "a", categoryId: "sleep" },
      { id: "b", categoryId: "work" },
      { id: "c", categoryId: null }
    ];
    expect(goalCountingEntries(entries, categories).map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(goalCountingSeconds([["sleep", 28_800], ["work", 3_600], ["uncategorized", 600]], categories)).toBe(4_200);
  });

  it("follows the switch when it is toggled", () => {
    const entries = [{ id: "a", categoryId: "sleep" }];
    expect(goalCountingEntries(entries, [{ id: "sleep", countsTowardGoal: false }])).toEqual([]);
    expect(goalCountingEntries(entries, [{ id: "sleep", countsTowardGoal: true }])).toEqual(entries);
    expect(goalCountingSeconds([["sleep", 60]], [{ id: "sleep", countsTowardGoal: true }])).toBe(60);
    expect(goalCountingEntries(entries, null)).toEqual(entries);
  });

  it("starts Sleep, and only Sleep, not counting", () => {
    expect(DAYFRAME_STARTER_ACTIVITIES.filter((starter) => !starter.countsTowardGoal).map((starter) => starter.starterKey))
      .toEqual(["sleep"]);
  });
});
