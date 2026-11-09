import { describe, expect, it } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";
import {
  outingMutationFor,
  reviewOutings,
  reviewCardCategory,
  reviewMutationFor,
  reviewPicture,
  reviewProposalSignature,
  reviewTitle
} from "@/lib/review-deck";

const CAT = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

function item(overrides: Partial<ReviewItemRow> = {}): ReviewItemRow {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    type: "suggestion",
    title: "Morning walk",
    eventSource: "health_workout",
    eventType: "health_workout",
    projectName: null,
    categoryName: "Exercise",
    categoryColor: "mint",
    placeName: null,
    suggestedProjectId: null,
    suggestedCategoryId: CAT,
    suggestedPlaceId: null,
    suggestedStartedAt: local(10, 7),
    suggestedStoppedAt: local(10, 7, 45),
    confidence: "medium",
    status: "open",
    notes: null,
    rawPayload: null,
    createdAt: local(10, 8),
    ...overrides
  };
}

const v2 = { eventSource: "location_learning", eventType: "learned_place_visit", rawPayload: { algorithmVersion: "location-v2.0" } };
const categories = [
  { id: CAT, name: "Exercise", color: "mint", isPinned: false },
  { id: OTHER, name: "Errands", color: "amber", isPinned: false }
];

describe("Review deck helpers", () => {
  it("keeps time away as itself, never a commute", () => {
    const away = item({ title: "Time away from Home", eventSource: "location_learning", eventType: "commute_detected", rawPayload: { qualificationReason: "same_place_outing" } });
    expect(reviewTitle(away)).toBe("Time away from Home");
    expect(reviewPicture(away)).toBe("place");
    expect(reviewPicture(item({ eventSource: "location_learning", eventType: "commute_detected", rawPayload: {} }))).toBe("commute");
    expect(reviewPicture(item({ eventSource: "health_sleep", eventType: "health_sleep" }))).toBe("sleep");
    expect(reviewPicture(item())).toBe("workout");
  });

  it("shows a Stay or Move by the server's title (PRD D19)", () => {
    const drive = item({ title: "Drive", eventSource: "location_learning", eventType: "commute_detected",
      rawPayload: { routeLabel: "Home → Peak Gym" } });
    expect(reviewTitle(drive)).toBe("Drive");
    expect(reviewTitle(item({ title: "", eventSource: "location_learning", eventType: "commute_detected", rawPayload: {} }))).toBe("Getting around");
    // A Stay is called by its place, never "Visit to …".
    expect(reviewTitle(item({ ...v2, title: "Peak Gym", placeName: "Peak Gym" }))).toBe("Peak Gym");
    expect(reviewTitle(item({ ...v2, title: "", placeName: "Peak Gym" }))).toBe("Peak Gym");
  });

  it("logs with the plain accept or confirm unless the name or activity changed", () => {
    expect(reviewMutationFor(item(), "log", undefined)).toEqual({ action: "accept" });
    expect(reviewMutationFor(item(), "log", { name: "  Morning walk " })).toEqual({ action: "accept" });
    expect(reviewMutationFor(item(), "log", { categoryId: CAT })).toEqual({ action: "accept" });
    expect(reviewMutationFor(item(v2), "log", undefined)).toEqual({ action: "confirm" });
    expect(reviewMutationFor(item(), "skip", { name: "x" })).toEqual({ action: "ignore_once" });
    expect(reviewMutationFor(item(v2), "skip", undefined)).toEqual({ action: "ignore_once_location" });
  });

  it("sends edit_and_confirm with the whole window for a changed name or activity", () => {
    const base = item();
    expect(reviewMutationFor(base, "log", { name: "Park run" })).toEqual({
      action: "edit_and_confirm",
      edit: { categoryId: CAT, description: "Park run", descriptionTyped: true, startedAt: base.suggestedStartedAt, stoppedAt: base.suggestedStoppedAt }
    });
    // An activity-only change keeps the card's name for a generic moment…
    expect(reviewMutationFor(base, "log", { categoryId: OTHER })).toMatchObject({
      edit: { categoryId: OTHER, description: "Morning walk" }
    });
    // …and lets a Location visit keep naming itself.
    const visit = item(v2);
    const mutation = reviewMutationFor(visit, "log", { categoryId: OTHER, name: "" });
    expect(mutation).toEqual({ action: "edit_and_confirm", edit: { categoryId: OTHER, startedAt: visit.suggestedStartedAt, stoppedAt: visit.suggestedStoppedAt } });
  });

  it("never edits without a complete window", () => {
    expect(reviewMutationFor(item({ suggestedStoppedAt: null }), "log", { name: "Park run" })).toEqual({ action: "accept" });
  });

  it("falls back to the suggestion's activity when none is picked", () => {
    expect(reviewCardCategory(item(), { categoryId: OTHER }, categories)?.name).toBe("Errands");
    expect(reviewCardCategory(item(), undefined, categories)?.name).toBe("Exercise");
    expect(reviewCardCategory(item({ suggestedCategoryId: null, categoryName: null }), undefined, categories)).toBeNull();
  });

  it("signs the suggestion by name, times, activity and place", () => {
    const base = item();
    expect(reviewProposalSignature(base)).toBe(reviewProposalSignature({ ...base, confidence: "high", notes: "x" } as ReviewItemRow));
    expect(reviewProposalSignature(base)).not.toBe(reviewProposalSignature({ ...base, suggestedStoppedAt: local(10, 8) }));
    expect(reviewProposalSignature(base)).not.toBe(reviewProposalSignature({ ...base, suggestedCategoryId: OTHER }));
  });

  it("reads server Date props and refreshed ISO strings as the same suggestion, to the millisecond", () => {
    const iso = item({ suggestedStartedAt: "2026-10-10T07:00:00.250Z", suggestedStoppedAt: "2026-10-10T07:45:00.750Z" });
    const fromServer = {
      ...iso,
      suggestedStartedAt: new Date("2026-10-10T07:00:00.250Z"),
      suggestedStoppedAt: new Date("2026-10-10T07:45:00.750Z")
    } as unknown as ReviewItemRow;
    expect(reviewProposalSignature(fromServer)).toBe(reviewProposalSignature(iso));
    expect(reviewMutationFor(fromServer, "log", { name: "Park run" })).toMatchObject({
      edit: { startedAt: "2026-10-10T07:00:00.250Z", stoppedAt: "2026-10-10T07:45:00.750Z" }
    });
  });

});

describe("one card per outing (PRD D19)", () => {
  const v2 = (id: string, role: string, extra: Record<string, unknown>, from: [number, number], to: [number, number]) => item({
    id, eventSource: "location_learning", eventType: role === "stay" ? "unknown_stay" : "commute_detected",
    suggestedStartedAt: local(10, ...from), suggestedStoppedAt: local(10, ...to),
    rawPayload: { clientSegmentId: id, outingKey: "outing:shop", outingRole: role, ...extra }
  });
  const there = v2("30000000-0000-4000-8000-0000000000a1", "in", { travelMode: "automotive" }, [12, 28], [12, 34]);
  const shop = v2("30000000-0000-4000-8000-0000000000a2", "stay", {}, [12, 34], [13, 10]);
  const back = v2("30000000-0000-4000-8000-0000000000a3", "out", { travelMode: "automotive" }, [13, 10], [13, 15]);

  it("folds the Move cards into their unknown Stay's card, and leaves them alone without it", () => {
    const outings = reviewOutings([there, shop, back]);
    expect([...outings.keys()]).toEqual([shop.id]);
    expect(outings.get(shop.id)!.members.map((member) => member.id)).toEqual([there.id, back.id]);
    expect(reviewOutings([there, back]).size).toBe(0);
  });

  it("logs or skips every member together; Log as applies to the Stay", () => {
    const outing = reviewOutings([there, shop, back]).get(shop.id)!;
    expect(outingMutationFor(outing, "skip", undefined)).toEqual({ action: "ignore_outing", memberReviewItemIds: [there.id, back.id] });
    expect(outingMutationFor(outing, "log", undefined)).toEqual({ action: "confirm_outing", memberReviewItemIds: [there.id, back.id] });
    expect(outingMutationFor(outing, "log", { name: "Groceries" })).toMatchObject({
      action: "confirm_outing", edit: { description: "Groceries", startedAt: shop.suggestedStartedAt, stoppedAt: shop.suggestedStoppedAt }
    });
  });
});

