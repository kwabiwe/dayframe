import { describe, expect, it } from "vitest";
import {
  canonicalPlaceCoordinateText,
  resolvedPlaceSelectionDraft,
  shouldClearResolvedPlace
} from "./placeEditorState";

const resolved = {
  suggestionId: "opaque-id",
  title: "Synthetic Sports Centre",
  subtitle: "Example Lane, Exampleton",
  name: "Synthetic Sports Centre",
  formattedAddress: "Example Lane, Exampleton, ZZ5 5EE",
  latitude: 10.73123449,
  longitude: 20.47123449
};

describe("place editor selection state", () => {
  it("populates one canonical coordinate and a suggested untouched name", () => {
    expect(resolvedPlaceSelectionDraft(resolved, "", false)).toEqual({
      searchQuery: resolved.title,
      selectedResult: resolved,
      placeName: resolved.name,
      latitudeText: "10.731234",
      longitudeText: "20.471234"
    });
  });

  it("never overwrites a manually edited Dayframe name", () => {
    expect(resolvedPlaceSelectionDraft(resolved, "Swimming", true).placeName).toBe("Swimming");
  });

  it("clears a stale resolved selection only after the query materially changes", () => {
    expect(shouldClearResolvedPlace(" Synthetic Sports Centre ", resolved)).toBe(false);
    expect(shouldClearResolvedPlace("Sample Leisure Centre", resolved)).toBe(true);
    expect(shouldClearResolvedPlace("anything", null)).toBe(false);
  });

  it("uses the same normalized coordinate text for every editor input path", () => {
    expect(canonicalPlaceCoordinateText(10.7, -0.1)).toEqual({
      latitudeText: "10.7",
      longitudeText: "-0.1"
    });
  });
});
