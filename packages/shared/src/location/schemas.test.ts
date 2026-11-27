import { describe, expect, it } from "vitest";
import { LocationEvidenceMetadataSchema, LocationEvidenceUploadItemSchema, LocationReviewActionSchema } from "./schemas";

describe("LocationReviewActionSchema", () => {
  it("accepts a trimmed one-time POI name and entry edits", () => {
    expect(LocationReviewActionSchema.parse({
      action: "record_poi_once",
      name: "  Noodle House  ",
      edit: { description: "Dinner" }
    })).toEqual({
      action: "record_poi_once",
      name: "Noodle House",
      edit: { description: "Dinner" }
    });
  });

  it("rejects oversized names and provider metadata", () => {
    expect(LocationReviewActionSchema.safeParse({
      action: "record_poi_once",
      name: "x".repeat(121)
    }).success).toBe(false);
    expect(LocationReviewActionSchema.safeParse({
      action: "record_poi_once",
      name: "Noodle House",
      latitude: 51.5,
      appleIdentifier: "provider-secret"
    }).success).toBe(false);
  });
});

describe("LocationEvidenceMetadataSchema", () => {
  it("accepts a departure-only Visit at one instant without a place or position", () => {
    const departure = "2026-10-04T07:51:03.125Z";
    const evidence = {
      clientEvidenceId: "departure-only", kind: "visit", occurredAt: departure, endedAt: departure,
      receivedAt: departure, metadata: { visitArrivalUnknown: true }
    };
    expect(LocationEvidenceUploadItemSchema.parse(evidence)).toEqual(evidence);
    for (const invalid of [
      { kind: "significant_change" }, { latitude: 51, longitude: 0 }, { geofenceIdentifier: "place" }, { speedMetersPerSecond: 4 },
      { endedAt: null }, { endedAt: "2026-10-04T07:52:00.000Z" },
      { metadata: { visitArrivalUnknown: true, visitDepartureOpen: true } }
    ]) {
      expect(LocationEvidenceUploadItemSchema.safeParse({ ...evidence, ...invalid }).success).toBe(false);
    }
  });

  it("accepts the native callback clock only as an offset timestamp", () => {
    expect(LocationEvidenceMetadataSchema.parse({ nativeCallbackAt: "2026-10-04T07:51:03.125Z" })).toEqual({ nativeCallbackAt: "2026-10-04T07:51:03.125Z" });
    expect(LocationEvidenceMetadataSchema.safeParse({ nativeCallbackAt: "yesterday" }).success).toBe(false);
    expect(LocationEvidenceMetadataSchema.safeParse({ nativeCallbackAt: "2026-10-04T07:51:03" }).success).toBe(false);
  });
});
