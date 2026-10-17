import { describe, expect, it } from "vitest";
import {
  ReviewMutationEnvelopeSchema,
  ReviewMutationSchema,
  validReviewAcknowledgement
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
    { action: "merge", adjacentReviewItemId: id }, { action: "merge_and_confirm", adjacentReviewItemId: id },
    { action: "save_place", name: "Synthetic place", radiusMeters: 110 }
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

describe("Save this place (PRD D19, design §7)", () => {
  const id = "18600000-0000-4000-8000-000000000002";
  const envelope = ReviewMutationEnvelopeSchema.parse({ clientMutationId: id,
    mutation: { action: "save_place", name: "Synthetic place", radiusMeters: 110, categoryId: null } });

  it("defaults to suggesting visits without logging them automatically, within 50–200 m", () => {
    expect(envelope.mutation).toMatchObject({ suggestVisits: true, autoLog: false });
    for (const radiusMeters of [49, 201]) {
      expect(ReviewMutationSchema.safeParse({ action: "save_place", name: "X", radiusMeters }).success).toBe(false);
    }
    expect(ReviewMutationSchema.safeParse({ action: "save_place", name: "X", radiusMeters: 110, latitude: 0, longitude: 0 }).success).toBe(false);
  });

  it("is acknowledged by the place it saved while its card stays open", () => {
    expect(validReviewAcknowledgement({ ok: true, action: "save_place", status: "open", placeId: id }, envelope, id)).toBe(true);
    expect(validReviewAcknowledgement({ ok: true, action: "save_place", status: "open" }, envelope, id)).toBe(false);
    expect(validReviewAcknowledgement({ ok: true, action: "save_place", status: "accepted", entryId: id }, envelope, id)).toBe(false);
  });

  it("lets Save place and confirm carry the place's switches and a large size, which older apps omit", () => {
    const base = { action: "save_place_and_confirm", name: "Synthetic place", latitude: 51.5, longitude: -0.1 };
    expect(ReviewMutationSchema.safeParse({ ...base, radiusMeters: 200, suggestVisits: false, autoLog: false }).success).toBe(true);
    expect(ReviewMutationSchema.parse(base)).not.toHaveProperty("suggestVisits");
    expect(ReviewMutationSchema.safeParse({ ...base, radiusMeters: 201 }).success).toBe(false);
  });
});

describe("one card per outing acknowledgements (PRD D19)", () => {
  const anchor = "30000000-0000-4000-8000-0000000000a2";
  const members = ["30000000-0000-4000-8000-0000000000a1", "30000000-0000-4000-8000-0000000000a3"];
  const envelope = (action: "confirm_outing" | "ignore_outing") => ReviewMutationEnvelopeSchema.parse({
    clientMutationId: "40000000-0000-4000-8000-000000000001", mutation: { action, memberReviewItemIds: members }
  });
  it("needs every member decided, each logged member with its block", () => {
    const ids = [anchor, ...members];
    expect(validReviewAcknowledgement({ ok: true, action: "confirm_outing", status: "accepted", reviewItemIds: ids,
      entryIds: ["e1", "e2", "e3"] }, envelope("confirm_outing"), anchor)).toBe(true);
    expect(validReviewAcknowledgement({ ok: true, action: "confirm_outing", status: "accepted", reviewItemIds: ids,
      entryIds: ["e1", "e2"] }, envelope("confirm_outing"), anchor)).toBe(false);
    expect(validReviewAcknowledgement({ ok: true, action: "confirm_outing", status: "accepted", reviewItemIds: [anchor],
      entryIds: ["e1", "e2", "e3"] }, envelope("confirm_outing"), anchor)).toBe(false);
    expect(validReviewAcknowledgement({ ok: true, action: "confirm_outing", status: "accepted", reviewItemIds: ids,
      alreadyResolved: true, equivalent: true }, envelope("confirm_outing"), anchor)).toBe(true);
    expect(validReviewAcknowledgement({ ok: true, action: "ignore_outing", status: "ignored", reviewItemIds: ids },
      envelope("ignore_outing"), anchor)).toBe(true);
  });
});
