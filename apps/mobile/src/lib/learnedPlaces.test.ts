import { describe, expect, it, vi } from "vitest";
import {
  copyLearnedPlaceDetail,
  learnedPlaceDetailValues
} from "./learnedPlaces";
import type { MobileLearnedPlace } from "./api";

describe("learned-place detail helpers", () => {
  it("prefers a POI name and a complete cached address over coordinates", () => {
    expect(learnedPlaceDetailValues(learnedPlace())).toEqual({
      name: "Tesco Springfield",
      address: "Springfield Road, Chelmsford, CM2 6QT",
      coordinates: "51.739532, 0.456310"
    });
  });

  it("copies the exact address shown in the detail sheet", async () => {
    const writeClipboard = vi.fn(async () => undefined);
    const copied = await copyLearnedPlaceDetail(
      "206 Rainsford Road, Marconi, CM1 2PD",
      writeClipboard
    );

    expect(copied).toBe(true);
    expect(writeClipboard).toHaveBeenCalledWith("206 Rainsford Road, Marconi, CM1 2PD");
  });

  it("does not offer an empty value to the clipboard", async () => {
    const writeClipboard = vi.fn(async () => undefined);
    await expect(copyLearnedPlaceDetail(null, writeClipboard)).resolves.toBe(false);
    expect(writeClipboard).not.toHaveBeenCalled();
  });
});

function learnedPlace(): MobileLearnedPlace {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Tesco Springfield",
    latitude: 51.739532,
    longitude: 0.45631,
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
    address: {
      name: "Tesco Springfield",
      street: "Springfield Road",
      city: "Chelmsford",
      postalCode: "CM2 6QT"
    },
    poiName: "Tesco Springfield",
    formattedAddress: "Springfield Road, Chelmsford, CM2 6QT",
    geocodedAt: "2026-07-14T10:01:00.000Z",
    rawPayload: null
  };
}
