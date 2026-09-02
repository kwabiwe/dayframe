import { describe, expect, it } from "vitest";
import {
  ReviewMutationEnvelopeSchema,
  ReviewMutationSchema
} from "../src/reviewMutations";

describe("Review mutation schemas", () => {
  it("accepts the supported terminal actions", () => {
    expect(ReviewMutationSchema.parse({ action: "accept" })).toEqual({ action: "accept" });
    expect(ReviewMutationSchema.parse({ action: "ignore_once" })).toEqual({ action: "ignore_once" });
    expect(ReviewMutationSchema.parse({ action: "confirm" })).toEqual({ action: "confirm" });
    expect(ReviewMutationSchema.parse({ action: "ignore_once_location" })).toEqual({
      action: "ignore_once_location"
    });
  });

  it("requires a complete valid window for edited confirmation", () => {
    expect(() => ReviewMutationSchema.parse({
      action: "edit_and_confirm",
      edit: {
        startedAt: "2026-07-27T09:00:00.000Z",
        stoppedAt: "2026-07-27T08:00:00.000Z"
      }
    })).toThrow(/End time must be after start time/);
  });

  it("keeps the idempotency envelope strict", () => {
    expect(() => ReviewMutationEnvelopeSchema.parse({
      clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda4",
      mutation: { action: "accept", unexpected: true }
    })).toThrow();
  });
});

describe("durable structural Location envelopes", () => {
  const id = "18600000-0000-4000-8000-000000000001";
  const actions = [
    { action: "change_place_and_confirm", placeId: id }, { action: "record_once" },
    { action: "record_poi_once", name: "Synthetic cafe" },
    { action: "save_place_and_confirm", name: "Synthetic place", latitude: 51.5, longitude: -0.1 },
    { action: "split", splitAt: "2026-08-28T08:30:00Z" },
    { action: "split_and_confirm", splitAt: "2026-08-28T08:30:00Z" },
    { action: "merge", adjacentReviewItemId: id }, { action: "merge_and_confirm", adjacentReviewItemId: id }
  ];
  it.each(actions)("accepts strict $action and rejects extra provider payload", (mutation) => {
    expect(ReviewMutationEnvelopeSchema.safeParse({ clientMutationId: id, mutation }).success).toBe(true);
    expect(ReviewMutationEnvelopeSchema.safeParse({ clientMutationId: id, mutation: { ...mutation, appleResponse: {} } }).success).toBe(false);
  });
  it("does not silently accept a pure place edit or invalid save coordinates", () => {
    expect(ReviewMutationSchema.safeParse({ action: "change_place", placeId: id }).success).toBe(false);
    expect(ReviewMutationSchema.safeParse({ action:"save_place_and_confirm", name:"X", latitude:91,longitude:0 }).success).toBe(false);
  });
});
