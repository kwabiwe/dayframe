import { describe, expect, it } from "vitest";
import {
  DAYFRAME_STARTER_ACTIVITIES,
  isActivityIconKey,
  isPaletteKey,
  isStarterActivityKey,
  resolveActivityIcon,
  starterActivityByKey
} from "./index";

describe("starter activities", () => {
  it("are the 16 agreed activities, Errands included, with five pinned", () => {
    expect(DAYFRAME_STARTER_ACTIVITIES.map((starter) => starter.name)).toEqual([
      "Work", "Admin", "Learning", "Exercise", "Walk", "Sleep", "Mindfulness", "Meals",
      "Chores", "Errands", "Personal", "Hobbies", "Family", "Social", "Commute", "Travel"
    ]);
    expect(DAYFRAME_STARTER_ACTIVITIES.filter((starter) => starter.isPinned).map((starter) => starter.name)).toEqual([
      "Work", "Admin", "Learning", "Exercise", "Personal"
    ]);
  });

  it("use stable starter keys, shared palette keys and approved icons", () => {
    const keys = DAYFRAME_STARTER_ACTIVITIES.map((starter) => starter.starterKey);
    expect(new Set(keys).size).toBe(16);
    expect(new Set(DAYFRAME_STARTER_ACTIVITIES.map((starter) => starter.name.toLowerCase())).size).toBe(16);
    expect(new Set(DAYFRAME_STARTER_ACTIVITIES.map((starter) => starter.color)).size).toBe(16);
    for (const starter of DAYFRAME_STARTER_ACTIVITIES) {
      expect(isPaletteKey(starter.color), starter.name).toBe(true);
      expect(isActivityIconKey(starter.icon), starter.name).toBe(true);
      expect(isStarterActivityKey(starter.starterKey)).toBe(true);
    }
    expect(starterActivityByKey("errands")).toMatchObject({ name: "Errands", color: "chartreuse", icon: "errands" });
    expect(starterActivityByKey("sleep")).toMatchObject({ name: "Sleep", color: "blue-bold", icon: "sleep" });
    expect(starterActivityByKey("commute")).toMatchObject({ name: "Commute", color: "graphite", icon: "commute" });
    expect(isStarterActivityKey("general")).toBe(false);
  });

  it("would get the same icon from the name alone, so derived and stored icons agree", () => {
    for (const starter of DAYFRAME_STARTER_ACTIVITIES) {
      expect(resolveActivityIcon({ icon: null, name: starter.name }).key, starter.name).toBe(starter.icon);
    }
  });
});
