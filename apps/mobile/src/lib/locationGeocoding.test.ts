import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileLearnedPlace } from "./api";

const mocks = vi.hoisted(() => ({
  reverseGeocodeAsync: vi.fn(),
  resolveLearnedPlaceLocation: vi.fn()
}));

vi.mock("expo-location", () => ({
  reverseGeocodeAsync: mocks.reverseGeocodeAsync
}));

vi.mock("./api", () => ({
  resolveLearnedPlaceLocation: mocks.resolveLearnedPlaceLocation
}));

const {
  backfillLearnedPlaceLocations,
  learnedPlaceNeedsLocationResolution,
  resetLearnedPlaceGeocodingAttemptsForTests
} = await import("./locationGeocoding");

describe("learned-place geocoding", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetLearnedPlaceGeocodingAttemptsForTests();
  });

  it("lazily resolves and caches a legacy coordinate-only candidate once", async () => {
    const candidate = learnedPlace();
    mocks.reverseGeocodeAsync.mockResolvedValue([{
      name: "Example Gym Exampleton",
      street: "Sample Street",
      city: "Exampleton",
      postalCode: "ZZ2 2BB",
      formattedAddress: "Sample Street, Exampleton, ZZ2 2BB"
    }]);
    mocks.resolveLearnedPlaceLocation.mockResolvedValue({
      ok: true,
      learnedPlace: {
        id: candidate.id,
        name: "Example Gym Exampleton",
        address: { name: "Example Gym Exampleton" },
        poiName: "Example Gym Exampleton",
        formattedAddress: "Sample Street, Exampleton, ZZ2 2BB",
        geocodedAt: "2026-07-14T10:00:00.000Z"
      }
    });

    expect(learnedPlaceNeedsLocationResolution(candidate)).toBe(true);
    await expect(backfillLearnedPlaceLocations([candidate])).resolves.toHaveLength(1);
    await expect(backfillLearnedPlaceLocations([candidate])).resolves.toHaveLength(0);
    expect(mocks.reverseGeocodeAsync).toHaveBeenCalledTimes(1);
    expect(mocks.resolveLearnedPlaceLocation).toHaveBeenCalledTimes(1);
  });

  it("does not geocode a candidate that already has cached readable location data", () => {
    expect(learnedPlaceNeedsLocationResolution(learnedPlace({
      name: "Example Gym Exampleton",
      address: { formattedAddress: "Sample Street, Exampleton, ZZ2 2BB" }
    }))).toBe(false);
  });
});

function learnedPlace(overrides: Partial<MobileLearnedPlace> = {}): MobileLearnedPlace {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Regular place near 10.748, 20.438",
    latitude: 10.748,
    longitude: 20.438,
    radiusMeters: 160,
    visitCount: 2,
    distinctDayCount: 2,
    sampleCount: 6,
    totalDwellSeconds: 3000,
    longestDwellSeconds: 1800,
    averageAccuracyMeters: 30,
    maxClusterSpreadMeters: 40,
    firstSeenAt: "2026-07-12T09:00:00.000Z",
    lastSeenAt: "2026-07-14T10:00:00.000Z",
    lastStartedAt: "2026-07-14T09:30:00.000Z",
    lastStoppedAt: "2026-07-14T10:00:00.000Z",
    confidence: "medium",
    classification: "place_candidate",
    status: "candidate",
    address: null,
    poiName: null,
    formattedAddress: null,
    geocodedAt: null,
    rawPayload: null,
    ...overrides
  };
}
