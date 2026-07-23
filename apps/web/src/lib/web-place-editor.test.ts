import { describe, expect, it, vi } from "vitest";
import {
  applyWebPlaceSuggestion,
  friendlyBrowserLocationError,
  resolveGrantedBrowserCoordinate,
  robustWebCoordinateMedian,
  selectWebPlaceSearchBias,
  validateWebPlaceForm
} from "./web-place-editor";

const suggestion = {
  id: "synthetic",
  title: "Synthetic School",
  subtitle: "Example Road",
  formattedAddress: "Synthetic School, Example Road",
  latitude: 51.7,
  longitude: 0.4,
  resultType: "amenity"
};

describe("web place editor state", () => {
  it("uses selected, existing, granted-browser and saved-place biases in order", () => {
    const selected = { latitude: 51, longitude: 0.1 };
    const existing = { latitude: 52, longitude: 0.2 };
    const browser = { latitude: 53, longitude: 0.3 };
    const saved = [{ latitude: 54, longitude: 0.4 }];

    expect(selectWebPlaceSearchBias({
      selectedCoordinate: selected,
      existingCoordinate: existing,
      browserCoordinate: browser,
      savedPlaceCoordinates: saved
    })).toEqual(selected);
    expect(selectWebPlaceSearchBias({
      existingCoordinate: existing,
      browserCoordinate: browser,
      savedPlaceCoordinates: saved
    })).toEqual(existing);
    expect(selectWebPlaceSearchBias({
      browserCoordinate: browser,
      savedPlaceCoordinates: saved
    })).toEqual(browser);
    expect(selectWebPlaceSearchBias({ savedPlaceCoordinates: saved })).toEqual(saved[0]);
  });

  it("uses a robust median for saved-place fallback", () => {
    expect(robustWebCoordinateMedian([
      { latitude: 51, longitude: 0.1 },
      { latitude: 53, longitude: 0.3 },
      { latitude: 52, longitude: 0.2 },
      { latitude: 500, longitude: 500 }
    ])).toEqual({ latitude: 52, longitude: 0.2 });
  });

  it("suggests a name until the user has manually edited it", () => {
    expect(applyWebPlaceSuggestion(suggestion, "", false).name).toBe("Synthetic School");
    expect(applyWebPlaceSuggestion(suggestion, "My school", true).name).toBe("My school");
    expect(applyWebPlaceSuggestion(suggestion, "My school", true)).toMatchObject({
      latitude: "51.7",
      longitude: "0.4"
    });
  });

  it("validates coordinates, radius and visit-suggestion defaults", () => {
    const valid = validateWebPlaceForm({
      name: " Synthetic School ",
      latitude: "51.7",
      longitude: "0.4",
      radiusMeters: "100",
      loggingEnabled: true,
      defaultCategoryId: "category",
      defaultActivityDescription: " Study "
    });
    expect(valid).toEqual({
      ok: true,
      value: {
        name: "Synthetic School",
        latitude: 51.7,
        longitude: 0.4,
        radiusMeters: 100,
        loggingEnabled: true,
        defaultCategoryId: "category",
        defaultActivityDescription: "Study"
      }
    });

    expect(validateWebPlaceForm({
      name: "Synthetic",
      latitude: "",
      longitude: "",
      radiusMeters: "100",
      loggingEnabled: false,
      defaultCategoryId: "category",
      defaultActivityDescription: "Hidden"
    })).toMatchObject({ ok: false, field: "latitude" });

    expect(validateWebPlaceForm({
      name: "Synthetic",
      latitude: "51.7",
      longitude: "0.4",
      radiusMeters: "24",
      loggingEnabled: true,
      defaultCategoryId: "",
      defaultActivityDescription: ""
    })).toMatchObject({ ok: false, field: "radiusMeters" });

    expect(validateWebPlaceForm({
      name: "Synthetic",
      latitude: "51.7",
      longitude: "0.4",
      radiusMeters: "2001",
      loggingEnabled: true,
      defaultCategoryId: "",
      defaultActivityDescription: ""
    })).toMatchObject({ ok: false, field: "radiusMeters" });

    expect(validateWebPlaceForm({
      name: "Synthetic",
      latitude: "51.7",
      longitude: "0.4",
      radiusMeters: "100",
      loggingEnabled: false,
      defaultCategoryId: "must-clear",
      defaultActivityDescription: "must-clear"
    })).toMatchObject({
      ok: true,
      value: {
        loggingEnabled: false,
        defaultCategoryId: null,
        defaultActivityDescription: null
      }
    });
  });

  it("never invokes geolocation merely for bias unless permission is already granted", async () => {
    const getCurrentPosition = vi.fn();
    const coordinate = await resolveGrantedBrowserCoordinate({
      permissions: { query: vi.fn(async () => ({ state: "prompt" as const })) },
      geolocation: { getCurrentPosition }
    });
    expect(coordinate).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("uses an already-granted cached browser location without exposing raw errors", async () => {
    const coordinate = await resolveGrantedBrowserCoordinate({
      permissions: { query: vi.fn(async () => ({ state: "granted" as const })) },
      geolocation: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 51.75, longitude: 0.45 } });
        }
      }
    });
    expect(coordinate).toEqual({ latitude: 51.75, longitude: 0.45 });
    expect(friendlyBrowserLocationError(1)).toContain("denied");
    expect(friendlyBrowserLocationError(3)).toContain("too long");
  });

  it("ignores invalid saved-place bias coordinates safely", () => {
    expect(selectWebPlaceSearchBias({
      savedPlaceCoordinates: [
        { latitude: Number.NaN, longitude: 0 },
        { latitude: 91, longitude: 0 }
      ]
    })).toBeNull();
  });
});
