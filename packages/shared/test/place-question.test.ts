import { describe, expect, it } from "vitest";
import { placeQuestion, visitedGuess } from "../src/location/placeQuestion";

describe("a place's question (card B)", () => {
  it("asks whether you visited the place it names", () => {
    expect(placeQuestion("Peak Gym")).toEqual({ question: "Visited Peak Gym?", guess: "Peak Gym" });
    expect(placeQuestion("  Exampleton Library ")).toEqual({ question: "Visited Exampleton Library?", guess: "Exampleton Library" });
  });

  it("asks where you were when Dayframe could not name it", () => {
    for (const title of ["Unknown place", "Near saved places", "Unclear place", "Suggestion", "", null, undefined]) {
      expect(placeQuestion(title)).toEqual({ question: "Where were you?", guess: null });
    }
    expect(visitedGuess("unknown PLACE")).toBeNull();
  });
});
