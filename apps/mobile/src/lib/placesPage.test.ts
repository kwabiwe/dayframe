import { describe, expect, it } from "vitest";
import { learnedPlaceSubtitle, placeRowSubtitle } from "./placesPage";

const categories = [{ id: "c1", name: "Exercise" }];

describe("placeRowSubtitle", () => {
  it("says what a visit logs and the radius", () => {
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 100, defaultCategoryId: "c1" }, categories)).toBe("Logs as Exercise · 100 m");
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 80, defaultCategoryId: "c1", defaultActivityDescription: " Weights " }, categories))
      .toBe("Logs “Weights” as Exercise · 80 m");
    expect(placeRowSubtitle({ name: "Park", radiusMeters: 150 }, categories)).toBe("No default activity · 150 m");
    expect(placeRowSubtitle({ name: "Park", radiusMeters: 150, defaultActivityDescription: "Walk" }, categories)).toBe("Logs “Walk” · 150 m");
  });

  it("says when visits are not suggested, ignoring a stale default", () => {
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 100, loggingEnabled: false, defaultCategoryId: "c1" }, categories))
      .toBe("Visits not suggested · 100 m");
  });

  it("puts the saved name first when a role is the title", () => {
    expect(placeRowSubtitle({ name: "12 Example Street", role: "home", radiusMeters: 100 }, categories))
      .toBe("12 Example Street\nNo default activity · 100 m");
  });

  it("prefers the server's default activity name", () => {
    expect(placeRowSubtitle({ name: "Gym", radiusMeters: 100, defaultCategoryId: "gone", defaultCategoryName: "Training" }, categories))
      .toBe("Logs as Training · 100 m");
  });
});

describe("learnedPlaceSubtitle", () => {
  it("counts visits and days", () => {
    expect(learnedPlaceSubtitle({ visitCount: 1, distinctDayCount: 1, lastSeenAt: "nope" })).toBe("1 visit on 1 day · last seen recently");
    expect(learnedPlaceSubtitle({ visitCount: 4, distinctDayCount: 3, lastSeenAt: "2026-10-06T10:00:00Z" })).toMatch(/^4 visits on 3 days · last seen /);
  });
});
