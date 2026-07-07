import { describe, expect, it } from "vitest";
import {
  foregroundLocationPermissionGuidance,
  locationAccuracyWarning,
  suggestedPlaceNameFromGeocode,
  validatePlaceForm
} from "./places";

describe("mobile place helpers", () => {
  it("validates and normalizes place form values", () => {
    expect(
      validatePlaceForm({
        name: "  Gym  ",
        radiusMeters: "100.4",
        defaultCategoryId: "20000000-0000-4000-8000-000000000001"
      })
    ).toEqual({
      ok: true,
      value: {
        name: "Gym",
        radiusMeters: 100,
        defaultCategoryId: "20000000-0000-4000-8000-000000000001"
      }
    });
  });

  it("rejects missing names and unsafe radii", () => {
    expect(validatePlaceForm({ name: " ", radiusMeters: "100" })).toEqual({
      ok: false,
      message: "Place name is required."
    });
    expect(validatePlaceForm({ name: "Gym", radiusMeters: "10" })).toEqual({
      ok: false,
      message: "Radius must be at least 25m."
    });
    expect(validatePlaceForm({ name: "Gym", radiusMeters: "2501" })).toEqual({
      ok: false,
      message: "Radius must be 2000m or less."
    });
  });

  it("returns calm foreground permission guidance", () => {
    expect(foregroundLocationPermissionGuidance({ granted: true })).toBeNull();
    expect(foregroundLocationPermissionGuidance({ granted: false, canAskAgain: true })).toContain(
      "Location permission is needed"
    );
    expect(foregroundLocationPermissionGuidance({ granted: false, canAskAgain: false })).toContain(
      "Open iOS Settings"
    );
  });

  it("warns when precise location is off or accuracy is broad", () => {
    expect(locationAccuracyWarning(45, true)).toBeNull();
    expect(locationAccuracyWarning(220, true)).toContain("220m");
    expect(locationAccuracyWarning(40, false)).toContain("Precise Location is off");
  });

  it("uses low-risk reverse geocode labels", () => {
    expect(suggestedPlaceNameFromGeocode({ name: "Town Centre", city: "London" })).toBe("Town Centre");
    expect(suggestedPlaceNameFromGeocode({ street: "High Street", city: "London" })).toBe("High Street");
    expect(suggestedPlaceNameFromGeocode({})).toBe("");
  });
});
