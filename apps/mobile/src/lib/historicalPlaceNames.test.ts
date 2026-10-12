import { describe, expect, it } from "vitest";
import { historicalPlaceNames } from "./historicalPlaceNames";

describe("historicalPlaceNames", () => {
  it("collects trimmed, distinct saved and learned place names", () => {
    expect(historicalPlaceNames({
      places: [{ name: " Example Clinic " }, { name: "" }, { name: "Sample Park" }],
      learnedPlaces: [{ name: "Sample Park" }, { name: "12 Example Street" }]
    } as never)).toEqual(["Example Clinic", "Sample Park", "12 Example Street"]);
  });

  it("is empty without bootstrap data or places", () => {
    expect(historicalPlaceNames(null)).toEqual([]);
    expect(historicalPlaceNames({ places: [] } as never)).toEqual([]);
  });
});
