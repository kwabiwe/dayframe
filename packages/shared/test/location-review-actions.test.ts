import { describe, expect, it } from "vitest";
import { LocationReviewActionSchema } from "../src/location/schemas";

describe("Location Review action schema", () => {
  it("keeps the legacy accept and ignore actions but rejects the removed rule actions", () => {
    expect(LocationReviewActionSchema.parse({ action: "accept" })).toEqual({ action: "accept" });
    expect(LocationReviewActionSchema.parse({ action: "ignore_once" })).toEqual({ action: "ignore_once" });
    expect(LocationReviewActionSchema.safeParse({ action: "always_ignore_source" }).success).toBe(false);
    expect(LocationReviewActionSchema.safeParse({ action: "create_rule" }).success).toBe(false);
  });

  it("accepts one atomic saved-place correction with activity, category and time edits", () => {
    expect(LocationReviewActionSchema.parse({
      action: "change_place_and_confirm",
      placeId: "10000000-0000-4000-8000-000000000001",
      learnedPlaceId: null,
      edit: {
        categoryId: "20000000-0000-4000-8000-000000000002",
        description: "Training",
        startedAt: "2026-08-12T08:08:23.126Z",
        stoppedAt: "2026-08-12T08:22:30.004Z"
      }
    })).toEqual({
      action: "change_place_and_confirm",
      placeId: "10000000-0000-4000-8000-000000000001",
      learnedPlaceId: null,
      edit: {
        categoryId: "20000000-0000-4000-8000-000000000002",
        description: "Training",
        startedAt: "2026-08-12T08:08:23.126Z",
        stoppedAt: "2026-08-12T08:22:30.004Z"
      }
    });
  });

  it("keeps rich place correction strict", () => {
    expect(() => LocationReviewActionSchema.parse({
      action: "change_place_and_confirm",
      placeId: null,
      edit: { description: "Visit" },
      unexpected: true
    })).toThrow();
    expect(() => LocationReviewActionSchema.parse({
      action: "change_place",
      placeId: null,
      edit: { description: "This edit would otherwise be ignored" }
    })).toThrow();
  });
});
