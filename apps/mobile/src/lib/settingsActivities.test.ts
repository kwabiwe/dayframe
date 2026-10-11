import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "./api";
import {
  applySavedActivity,
  beginSavedActivityChange,
  publishSavedActivity,
  subscribeSavedActivity,
  type SavedActivityEvent
} from "./settingsActivities";

const bootstrap = (extra: Partial<MobileBootstrap> = {}) =>
  ({
    user: { id: "u" },
    workspace: { id: "w" },
    categories: [{ id: "sleep", name: "Sleep", color: "blue-bold", isPinned: false, countsTowardGoal: true }],
    goalExcludedCategoryIds: [],
    ...extra
  }) as unknown as MobileBootstrap;
const event = (countsTowardGoal: boolean, sequence: number, owner = { userId: "u", workspaceId: "w" }): SavedActivityEvent => ({
  ...owner,
  sequence,
  category: { id: "sleep", name: "Sleep", color: "blue-bold", isPinned: false, countsTowardGoal }
});

describe("activity changes from Settings reach Today and Reports (UIA-043)", () => {
  it("applies an acknowledged switch to categories and the exclusion list", () => {
    const applied = new Map<string, number>();
    const off = applySavedActivity(bootstrap(), event(false, 1), applied);
    expect(off.categories[0].countsTowardGoal).toBe(false);
    expect(off.goalExcludedCategoryIds).toEqual(["sleep"]);
    const on = applySavedActivity(off, event(true, 2), applied);
    expect(on.goalExcludedCategoryIds).toEqual([]);
  });

  it("never lets an older answer replace a newer one", () => {
    const applied = new Map<string, number>();
    const newer = applySavedActivity(bootstrap(), event(false, 5), applied);
    const late = applySavedActivity(newer, event(true, 4), applied);
    expect(late).toBe(newer);
    expect(late.goalExcludedCategoryIds).toEqual(["sleep"]);
  });

  it("ignores another account or workspace, and adds a newly created activity", () => {
    const applied = new Map<string, number>();
    const data = bootstrap();
    expect(applySavedActivity(data, event(false, 1, { userId: "other", workspaceId: "w" }), applied)).toBe(data);
    expect(applySavedActivity(data, event(false, 1, { userId: "u", workspaceId: "other" }), applied)).toBe(data);
    const created = applySavedActivity(data, { ...event(false, 2), category: { id: "nap", name: "Nap", color: "sky", isPinned: false, countsTowardGoal: false } }, applied);
    expect(created.categories.map((category) => category.id)).toEqual(["sleep", "nap"]);
    expect(created.goalExcludedCategoryIds).toEqual(["nap"]);
  });

  it("publishes to subscribers with increasing sequences", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSavedActivity(listener);
    const first = beginSavedActivityChange();
    const second = beginSavedActivityChange();
    expect(second).toBeGreaterThan(first);
    publishSavedActivity(event(false, second));
    expect(listener).toHaveBeenCalledWith(event(false, second));
    unsubscribe();
    publishSavedActivity(event(true, second + 1));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
