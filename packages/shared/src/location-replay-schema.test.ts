import { describe, expect, it } from "vitest";
import {
  LocationReplayRequestSchema,
  LocationReplayResponseSchema
} from "./location";

describe("location replay contracts", () => {
  it("normalises the legacy rollout request without accepting unrelated fields", () => {
    expect(LocationReplayRequestSchema.parse({
      deviceId: "ios-device",
      algorithmVersion: "location-v2.0",
      rolloutMode: "v2"
    }).rolloutMode).toBe("v2_review");

    expect(() => LocationReplayRequestSchema.parse({
      deviceId: "ios-device",
      algorithmVersion: "location-v2.0",
      latitude: 51.5
    })).toThrow();
  });

  it("keeps replay responses high-level and coordinate-free", () => {
    expect(LocationReplayResponseSchema.parse({
      ok: true,
      replayVersion: "location-v2.0",
      rolloutMode: "v2_review",
      clientAcknowledgedMode: true,
      finalisedSegmentCount: 2,
      semanticSegmentCount: 1,
      warnings: []
    })).toEqual(expect.objectContaining({ semanticSegmentCount: 1 }));

    expect(() => LocationReplayResponseSchema.parse({
      ok: true,
      replayVersion: "location-v2.0",
      rolloutMode: "v2_review",
      clientAcknowledgedMode: true,
      finalisedSegmentCount: 2,
      semanticSegmentCount: 1,
      warnings: [],
      coordinates: [0, 0]
    })).toThrow();
  });
});
