import { describe, expect, it } from "vitest";
import {
  canonicalPlaceCoordinateText,
  resolvedPlaceSelectionDraft,
  shouldClearResolvedPlace
} from "./placeEditorState";

const resolved = {
  suggestionId: "opaque-id",
  title: "Riverside Sports Centre",
  subtitle: "Victoria Road, Exampleton",
  name: "Riverside Sports Centre",
  formattedAddress: "Victoria Road, Exampleton, EX1 2AB",
  latitude: 51.73123449,
  longitude: 0.47123449
};

describe("place editor selection state", () => {
  it("populates one canonical coordinate and a suggested untouched name", () => {
    expect(resolvedPlaceSelectionDraft(resolved, "", false)).toEqual({
      searchQuery: resolved.title,
      selectedResult: resolved,
      placeName: resolved.name,
      latitudeText: "51.731234",
      longitudeText: "0.471234"
    });
  });

  it("never overwrites a manually edited Dayframe name", () => {
    expect(resolvedPlaceSelectionDraft(resolved, "Swimming", true).placeName).toBe("Swimming");
  });

  it("clears a stale resolved selection only after the query materially changes", () => {
    expect(shouldClearResolvedPlace(" Riverside Sports Centre ", resolved)).toBe(false);
    expect(shouldClearResolvedPlace("Riverside Leisure Centre", resolved)).toBe(true);
    expect(shouldClearResolvedPlace("anything", null)).toBe(false);
  });

  it("uses the same normalized coordinate text for every editor input path", () => {
    expect(canonicalPlaceCoordinateText(51.7, -0.1)).toEqual({
      latitudeText: "51.7",
      longitudeText: "-0.1"
    });
  });
});
