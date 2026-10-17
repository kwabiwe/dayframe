import { describe, expect, it } from "vitest";
import type { MobileReviewItem } from "./api";
import { heldOutingStillSame, outingFocusSegment, outingTravelSeconds, reviewDeckOutingLine, reviewDeckOutingMutation, reviewDeckOutings } from "./reviewDeckOutings";

function item(id: string, start: string, stop: string, payload: Record<string, unknown>): MobileReviewItem {
  return {
    id, type: "location", title: id, eventSource: "location_learning", eventType: payload.outingRole === "stay" ? "unknown_stay" : "commute_detected",
    categoryName: null, categoryColor: null, placeName: null, suggestedCategoryId: null, suggestedPlaceId: null,
    suggestedStartedAt: start, suggestedStoppedAt: stop, confidence: "medium", status: "open", notes: null,
    createdAt: start, rawPayload: payload
  } as MobileReviewItem;
}

const stay = item("stay", "2026-10-17T10:10:00.000Z", "2026-10-17T10:25:00.000Z", { outingKey: "outing:a", outingRole: "stay" });
const there = item("there", "2026-10-17T10:04:00.000Z", "2026-10-17T10:10:00.000Z", { outingKey: "outing:a", outingRole: "in", travelMode: "automotive" });
const back = item("back", "2026-10-17T10:25:00.000Z", "2026-10-17T10:30:00.000Z", { outingKey: "outing:a", outingRole: "out", travelMode: "automotive" });
const now = Date.parse("2026-10-17T12:00:00.000Z");

describe("reviewDeckOutings (PRD D19, PR 12b)", () => {
  it("folds the Moves into the Stay's card and knows each Move's card", () => {
    const { outings, anchorByMember } = reviewDeckOutings([back, stay, there], () => true);
    expect(outings.get("stay")!.members.map((member) => member.id)).toEqual(["there", "back"]);
    expect([...anchorByMember]).toEqual([["there", "stay"], ["back", "stay"]]);
  });

  it("leaves a card with its own waiting change out, so its badge stays on its own card", () => {
    const { outings, anchorByMember } = reviewDeckOutings([stay, there, back], (candidate) => candidate.id !== "back");
    expect(outings.get("stay")!.members.map((member) => member.id)).toEqual(["there"]);
    expect(anchorByMember.has("back")).toBe(false);
    expect(reviewDeckOutings([stay, there], (candidate) => candidate.id !== "stay").outings.size).toBe(0);
  });

  it("says how the outing travelled and for how long", () => {
    const outing = reviewDeckOutings([stay, there, back], () => true).outings.get("stay")!;
    expect(outingTravelSeconds(outing, now)).toBe(11 * 60);
    expect(reviewDeckOutingLine(outing, now)).toBe("Drives there and back · 11m");
  });

  it("decides every part together; Log as applies to the Stay", () => {
    expect(reviewDeckOutingMutation(["there", "back"], false, null)).toEqual({ action: "ignore_outing", memberReviewItemIds: ["there", "back"] });
    expect(reviewDeckOutingMutation(["there"], true, null)).toEqual({ action: "confirm_outing", memberReviewItemIds: ["there"] });
    const edit = { description: "Errand", categoryId: null, startedAt: stay.suggestedStartedAt!, stoppedAt: stay.suggestedStoppedAt! };
    expect(reviewDeckOutingMutation(["there"], true, edit)).toEqual({ action: "confirm_outing", memberReviewItemIds: ["there"], edit });
  });

  it("saves a held outing only while every Move is still open, unchanged and in it", () => {
    const signature = (candidate: MobileReviewItem) => `${candidate.suggestedStartedAt}`;
    const members = [there, back].map((member) => ({ key: `review:${member.id}`, itemId: member.id, proposal: signature(member) }));
    const open = new Map([[there.id, there], [back.id, back]]);
    expect(heldOutingStillSame(members, "outing:a", (id) => open.get(id), signature)?.map((member) => member.id)).toEqual(["there", "back"]);
    // Decided elsewhere meanwhile.
    expect(heldOutingStillSame(members, "outing:a", (id) => (id === "back" ? undefined : open.get(id)), signature)).toBeNull();
    // Changed by a refresh.
    const moved = { ...back, suggestedStartedAt: "2026-10-17T10:26:00.000Z" };
    expect(heldOutingStillSame(members, "outing:a", (id) => (id === "back" ? moved : open.get(id)), signature)).toBeNull();
    // Now part of another outing.
    const rekeyed = { ...back, rawPayload: { ...back.rawPayload, outingKey: "outing:b" } };
    expect(heldOutingStillSame(members, "outing:a", (id) => (id === "back" ? rekeyed : open.get(id)), signature)).toBeNull();
    // The Stay itself left its outing.
    expect(heldOutingStillSame(members, null, (id) => open.get(id), signature)).toBeNull();
  });
});

describe("outingFocusSegment (Codex r2 on #473)", () => {
  // The Stay ends just before midnight (Earlier); the trip home ends after it (Today).
  const segmentFor = (candidate: MobileReviewItem) => (candidate.id === "stay" ? "earlier" : "today");
  const grouped = reviewDeckOutings([stay, there, back], () => true).anchorByMember;

  it("moves a Move's focus to its outing's segment when the grouping arrives after it was placed", () => {
    // First data: no outing known yet, so the focus opened Today.
    expect(outingFocusSegment({ placed: { itemId: "back", segment: "today" }, currentSegment: "today",
      anchorByMember: new Map(), openItems: [back], segmentFor })).toBeNull();
    // Fresh data folds the Move into the evening's Stay.
    expect(outingFocusSegment({ placed: { itemId: "back", segment: "today" }, currentSegment: "today",
      anchorByMember: grouped, openItems: [stay, there, back], segmentFor })).toBe("earlier");
  });

  it("leaves the person where they are once they moved, and does nothing in the Stay's own segment", () => {
    expect(outingFocusSegment({ placed: { itemId: "back", segment: "today" }, currentSegment: "earlier",
      anchorByMember: grouped, openItems: [stay, there, back], segmentFor })).toBeNull();
    expect(outingFocusSegment({ placed: { itemId: "back", segment: "earlier" }, currentSegment: "earlier",
      anchorByMember: grouped, openItems: [stay, there, back], segmentFor })).toBeNull();
    expect(outingFocusSegment({ placed: null, currentSegment: "today", anchorByMember: grouped, openItems: [stay, there, back], segmentFor })).toBeNull();
  });
});
