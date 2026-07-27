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
