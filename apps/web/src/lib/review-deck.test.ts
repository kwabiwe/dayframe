import { describe, expect, it } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";
import {
  activeDraft,
  nextAfterDecision,
  outingMutationFor,
  outingSummary,
  reviewOutings,
  reviewCardCategory,
  reviewMutationFor,
  reviewPicture,
  reviewProposalSignature,
  reviewReason,
  reviewRoute,
  reviewTitle,
  reviewWhen,
  stepSelection
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

  it("shows a Stay or Move by the server's title and a Move's route line (PRD D19)", () => {
    const drive = item({ title: "Drive", eventSource: "location_learning", eventType: "commute_detected",
      rawPayload: { routeLabel: "Home → Peak Gym" } });
    expect(reviewTitle(drive)).toBe("Drive");
    expect(reviewRoute(drive)).toBe("Home → Peak Gym");
    expect(reviewTitle(item({ title: "", eventSource: "location_learning", eventType: "commute_detected", rawPayload: {} }))).toBe("Getting around");
    expect(reviewRoute(item({ title: "Morning walk" }))).toBeNull();
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

  it("drops a picked activity that is gone and falls back to the suggestion's", () => {
    expect(activeDraft({ categoryId: "gone", name: "x" }, categories)).toEqual({ categoryId: undefined, name: "x" });
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

  it("writes the when-line in local days", () => {
    const now = new Date(2026, 9, 10, 12).getTime();
    expect(reviewWhen(item(), now, "24h")).toBe("Today · 07:00–07:45");
    expect(reviewWhen(item(), now, "12h")).toBe("Today · 7:00 AM–7:45 AM");
    expect(reviewWhen(item({ suggestedStartedAt: local(9, 23), suggestedStoppedAt: local(10, 6) }), now, "24h")).toBe("Yesterday · 23:00–Today 06:00");
    expect(reviewWhen(item({ suggestedStartedAt: local(9, 23), suggestedStoppedAt: local(10, 6) }), now, "12h")).toBe("Yesterday · 11:00 PM–Today 6:00 AM");
  });

  it("steps through the queue and picks the next card after a decision", () => {
    expect(stepSelection(["a", "b", "c"], "c", 1)).toBe("a");
    expect(stepSelection(["a", "b", "c"], "a", -1)).toBe("c");
    expect(nextAfterDecision(["a", "b", "c"], "b")).toBe("c");
    expect(nextAfterDecision(["a", "b", "c"], "c")).toBe("b");
    expect(nextAfterDecision(["a"], "a")).toBeNull();
  });
});

describe("location reason line (location v3 bug 8)", () => {
  const location = (semanticReason: string, eventType = "geofence_exit") =>
    reviewReason(item({ eventSource: "location_learning", eventType, rawPayload: { semanticReason } }));

  it("says why a visit at a Log automatically place came to Review", () => {
    expect(location("auto_log_uncertain")).toBe("Not logged automatically · location was less certain than usual.");
    expect(location("auto_log_overlap")).toBe("Not logged automatically · it overlaps a block.");
    expect(location("auto_log_logged_before")).toBe("Not logged automatically · this visit was logged once before.");
    expect(location("auto_log_offered_before")).toBe("Not logged automatically · it was offered in Review before.");
    expect(location("auto_log_off")).toBe("Log automatically is off for this place.");
    // Moves that log themselves (PRD D19).
    expect(location("travel_mode_unknown")).toBe("Not logged automatically · how you travelled isn’t clear.");
    expect(location("log_trips_off")).toBe("Log trips automatically is off.");
    expect(location("trip_logged_before")).toBe("Not logged automatically · this trip was logged once before.");
    expect(location("trip_logging_opted_out")).toBe("Not logged automatically · you stopped logging trips like this.");
  });

  it("never claims automatic logging is off for the whole app", () => {
    expect(location("review_mode", "commute_detected")).toBe("Trips aren’t logged automatically yet.");
    expect(location("review_mode")).toBe("Not logged automatically.");
    expect(location("untrusted_place", "unknown_stay")).toBe("New place.");
    expect(location("untrusted_place", "learned_place_visit")).toBe("This place isn’t saved.");
    expect(location("ambiguous_place", "unknown_stay")).toBe("It’s near more than one saved place.");
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

  it("says how the outing travelled, there and back, with the travel time", () => {
    expect(outingSummary(reviewOutings([there, shop, back]).get(shop.id)!)).toBe("Drives there and back · 11m");
    expect(outingSummary(reviewOutings([there, shop]).get(shop.id)!)).toBe("Drives there · 6m");
    // A leg without a known way of travelling keeps the line neutral (Codex r1 on #466).
    const unknownBack = { ...back, rawPayload: { ...back.rawPayload, travelMode: undefined } };
    expect(outingSummary(reviewOutings([there, shop, unknownBack]).get(shop.id)!)).toBe("Travel there and back · 11m");
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

