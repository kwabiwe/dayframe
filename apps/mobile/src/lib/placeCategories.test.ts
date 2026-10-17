import { describe, expect, it } from "vitest";
import { formatPlaceDistance, nearbyPlaceCategory } from "./placeCategories";

describe("nearbyPlaceCategory (owner, 17 Oct 2026)", () => {
  it("names a nearby place's kind with its glyph", () => {
    expect(nearbyPlaceCategory("FitnessCenter")).toEqual({ label: "Gym", glyph: "dumbbell" });
    expect(nearbyPlaceCategory("Cafe")).toEqual({ label: "Café", glyph: "coffee" });
    expect(nearbyPlaceCategory("FoodMarket")).toEqual({ label: "Supermarket", glyph: "shopping-cart" });
  });

  it("reads an unknown kind in plain words, and no kind as Place", () => {
    expect(nearbyPlaceCategory("SkatingRink")).toEqual({ label: "Skating rink", glyph: "map-pin" });
    // Acronyms stay whole (Codex r1 on #479); known ones read in British English.
    expect(nearbyPlaceCategory("EVRepair")).toEqual({ label: "EV repair", glyph: "map-pin" });
    expect(nearbyPlaceCategory("RVPark")).toEqual({ label: "Caravan park", glyph: "tent" });
    expect(nearbyPlaceCategory("ConventionCenter")).toEqual({ label: "Conference centre", glyph: "building-2" });
    expect(nearbyPlaceCategory(null)).toEqual({ label: "Place", glyph: "map-pin" });
    expect(nearbyPlaceCategory(undefined)).toEqual({ label: "Place", glyph: "map-pin" });
  });

  it("rounds distances for reading", () => {
    expect(formatPlaceDistance(4)).toBe("10 m");
    expect(formatPlaceDistance(44)).toBe("40 m");
    expect(formatPlaceDistance(1234)).toBe("1.2 km");
    expect(formatPlaceDistance(-1)).toBe("");
  });
});
