import { describe, expect, it } from "vitest";
import { LocationEvidenceMetadataSchema, LocationReviewActionSchema } from "./schemas";

describe("LocationReviewActionSchema", () => {
  it("accepts a trimmed one-time POI name and entry edits", () => {
    expect(LocationReviewActionSchema.parse({
      action: "record_poi_once",
      name: "  Wagamama  ",
      edit: { description: "Dinner" }
    })).toEqual({
      action: "record_poi_once",
      name: "Wagamama",
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
      name: "Wagamama",
      latitude: 51.5,
      appleIdentifier: "provider-secret"
    }).success).toBe(false);
  });
});

describe("LocationEvidenceMetadataSchema", () => {
  it("accepts the native callback clock only as an offset timestamp", () => {
    expect(LocationEvidenceMetadataSchema.parse({ nativeCallbackAt: "2026-10-04T07:51:03.125Z" })).toEqual({ nativeCallbackAt: "2026-10-04T07:51:03.125Z" });
    expect(LocationEvidenceMetadataSchema.safeParse({ nativeCallbackAt: "yesterday" }).success).toBe(false);
    expect(LocationEvidenceMetadataSchema.safeParse({ nativeCallbackAt: "2026-10-04T07:51:03" }).success).toBe(false);
  });
});
