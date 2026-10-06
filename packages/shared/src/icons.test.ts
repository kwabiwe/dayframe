import { describe, expect, it } from "vitest";
import {
  DAYFRAME_ACTIVITY_ICONS,
  DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH,
  DAYFRAME_ACTIVITY_ICON_GROUPS,
  DAYFRAME_APP_ICONS,
  DAYFRAME_GLYPHS,
  activityIconKeyForName,
  isActivityIconKey,
  resolveActivityIcon
} from "./index";

describe("Dayframe icon set", () => {
  it("offers the approved 54 activity icons in six groups, each drawn from the shared geometry", () => {
    expect(DAYFRAME_ACTIVITY_ICONS).toHaveLength(54);
    expect(new Set(DAYFRAME_ACTIVITY_ICONS.map((icon) => icon.key)).size).toBe(54);
    expect(DAYFRAME_ACTIVITY_ICON_GROUPS.map((group) => group.label)).toEqual([
      "Work and study", "Body and mind", "Home and life", "People", "Getting around", "Free time"
    ]);
    for (const icon of DAYFRAME_ACTIVITY_ICONS) {
      expect(DAYFRAME_GLYPHS[icon.glyph], icon.key).toBeDefined();
      expect(DAYFRAME_ACTIVITY_ICON_GROUPS.some((group) => group.id === icon.group), icon.key).toBe(true);
    }
  });

  it("draws Swimming with the Dayframe swimmer and the starters with their approved glyphs", () => {
    const glyphOf = (key: string) => DAYFRAME_ACTIVITY_ICONS.find((icon) => icon.key === key)?.glyph;
    expect(glyphOf("swimming")).toBe("swimmer");
    expect(Object.fromEntries(["work", "admin", "learning", "gym", "walk", "sleep", "mindfulness", "meals", "chores", "errands", "personal", "hobbies", "family", "social", "commute", "travel"].map((key) => [key, glyphOf(key)]))).toEqual({
      work: "briefcase", admin: "inbox", learning: "book-open", gym: "dumbbell", walk: "footprints", sleep: "moon",
      mindfulness: "flower-2", meals: "utensils", chores: "house", errands: "shopping-bag", personal: "user-round",
      hobbies: "palette", family: "users", social: "message-circle", commute: "car", travel: "plane"
    });
  });

  it("only uses the outline element types every renderer supports", () => {
    const allowed = new Set(["circle", "ellipse", "line", "path", "polygon", "polyline", "rect"]);
    for (const [name, nodes] of Object.entries(DAYFRAME_GLYPHS)) {
      expect(nodes.length, name).toBeGreaterThan(0);
      for (const [tag] of nodes) expect(allowed.has(tag), `${name} uses ${tag}`).toBe(true);
    }
  });

  it("maps every app role to a glyph, including the native tab bar", () => {
    for (const [role, glyph] of Object.entries(DAYFRAME_APP_ICONS)) expect(DAYFRAME_GLYPHS[glyph], role).toBeDefined();
    expect([DAYFRAME_APP_ICONS.today, DAYFRAME_APP_ICONS.calendar, DAYFRAME_APP_ICONS.reports]).toEqual(["sun", "calendar-days", "chart-column"]);
    // Personal (an activity) and Account (an app role) must not share a person shape.
    expect(DAYFRAME_APP_ICONS.account).toBe("circle-user-round");
  });

  it.each([
    ["Gym", "gym"], ["Morning run", "gym"], ["Yoga", "gym"], ["Strength training", "gym"],
    ["Train to London", "train"], ["Evening walk", "walk"], ["Swim", "swimming"], ["Cycling", "cycling"],
    ["Sleep", "sleep"], ["Meditation", "mindfulness"], ["Dentist", "doctor"], ["Groceries", "groceries"],
    ["Errands", "errands"], ["Shopping", "errands"], ["Cooking dinner", "cooking"], ["Lunch", "meals"],
    ["Guitar practice", "instrument"], ["Reading", "learning"], ["Spanish lesson", "languages"],
    ["Client work", "office"], ["Deep work", "focus"], ["Work", "work"], ["Commute", "commute"],
    ["Dog walk", "pets"], ["Brunch with friends", "social"], ["Admin", "admin"], ["Code review", "code"]
  ])("suggests an icon for %s", (name, key) => {
    expect(activityIconKeyForName(name)).toBe(key);
  });

  it("suggests nothing for names it cannot place", () => {
    expect(activityIconKeyForName("Q3 planning")).toBeNull();
    expect(activityIconKeyForName("   ")).toBeNull();
  });

  it("resolves a stored key first, then the name, then the neutral dot", () => {
    expect(resolveActivityIcon({ icon: "garden", name: "Gym" })).toEqual({ key: "garden", glyph: "sprout" });
    expect(resolveActivityIcon({ icon: null, name: "Gym" })).toEqual({ key: "gym", glyph: "dumbbell" });
    expect(resolveActivityIcon({ icon: "not-a-key", name: "Gym" })).toEqual({ key: "gym", glyph: "dumbbell" });
    expect(resolveActivityIcon({ icon: null, name: "Q3 planning" })).toEqual({ key: null, glyph: DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH });
    expect(DAYFRAME_ACTIVITY_ICON_FALLBACK_GLYPH).toBe("circle-dot");
    expect(isActivityIconKey("errands")).toBe(true);
    expect(isActivityIconKey("shopping-bag")).toBe(false);
  });
});
