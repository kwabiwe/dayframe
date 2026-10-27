import { describe, expect, it } from "vitest";
import type { MobileReviewItem } from "./api";
import { reviewAnswerMutation, reviewAnswerQuestion } from "./reviewAnswer";

const item = (overrides: Partial<MobileReviewItem> = {}): MobileReviewItem => ({
  id: "item",
  title: "Exampleton Library",
  eventSource: "manual",
  eventType: null,
  categoryName: null,
  placeName: null,
  suggestedCategoryId: null,
  suggestedPlaceId: null,
  suggestedStartedAt: new Date(2026, 9, 22, 10, 0).toISOString(),
  suggestedStoppedAt: new Date(2026, 9, 22, 11, 30).toISOString(),
  confidence: "medium",
  status: "open",
  notes: null,
  rawPayload: null,
  createdAt: new Date(2026, 9, 22, 12, 0).toISOString(),
  ...overrides
});
const locationV2 = item({ eventSource: "location_learning", eventType: "unknown_stay", rawPayload: { clientSegmentId: "segment-1" } });
const edit = { categoryId: "c1", description: "Reading", startedAt: "2026-10-22T09:00:00.000Z", stoppedAt: "2026-10-22T10:30:00.000Z" };

describe("reviewAnswerMutation (the deck's and the List's one rule, step 14 part 3b)", () => {
  it("logs and skips Location V2 evidence with confirm and ignore_once_location", () => {
    expect(reviewAnswerMutation(locationV2, true)).toEqual({ action: "confirm" });
    expect(reviewAnswerMutation(locationV2, false)).toEqual({ action: "ignore_once_location" });
  });

  it("accepts and ignores every other suggestion once (Health included)", () => {
    for (const other of [item(), item({ eventSource: "health_sleep", eventType: "health_sleep_import" })]) {
      expect(reviewAnswerMutation(other, true)).toEqual({ action: "accept" });
      expect(reviewAnswerMutation(other, false)).toEqual({ action: "ignore_once" });
    }
  });

  it("sends a real Log as change as edit_and_confirm, and never on Skip", () => {
    expect(reviewAnswerMutation(locationV2, true, { edit })).toEqual({ action: "edit_and_confirm", edit });
    expect(reviewAnswerMutation(locationV2, false, { edit })).toEqual({ action: "ignore_once_location" });
    expect(reviewAnswerMutation(locationV2, true, { edit: null })).toEqual({ action: "confirm" });
  });

  it("decides an outing in one row with its Moves", () => {
    expect(reviewAnswerMutation(locationV2, true, { outingMemberIds: ["m1", "m2"] })).toEqual({ action: "confirm_outing", memberReviewItemIds: ["m1", "m2"] });
    expect(reviewAnswerMutation(locationV2, true, { outingMemberIds: ["m1"], edit })).toEqual({ action: "confirm_outing", memberReviewItemIds: ["m1"], edit });
    expect(reviewAnswerMutation(locationV2, false, { outingMemberIds: ["m1"], edit })).toEqual({ action: "ignore_outing", memberReviewItemIds: ["m1"] });
    // No Moves left: an ordinary answer.
    expect(reviewAnswerMutation(locationV2, true, { outingMemberIds: [] })).toEqual({ action: "confirm" });
  });
});

describe("reviewAnswerQuestion (mock-up #ios-list)", () => {
  it("asks whether you visited the place, with its times, and Yes / Edit / Not now (card B)", () => {
    expect(reviewAnswerQuestion({ ...locationV2, categoryName: "Reading" }, "24h")).toEqual({
      question: "Visited Exampleton Library?", detail: "10:00–11:30", logLabel: "Yes", skipLabel: "Not now", more: true, moreLabel: "Edit", opens: false
    });
  });

  it("keeps Log it for an unnamed place from before Location V2, which has no editor (Codex r1 on #594)", () => {
    expect(reviewAnswerQuestion(item({ eventType: "unknown_stay", eventSource: "geofence_specific", title: "Unknown place" }), "24h")).toEqual({
      question: "Where were you?", detail: "10:00–11:30", logLabel: "Log it", skipLabel: "Not now", more: false, opens: false
    });
  });

  it("asks where you were when it cannot name the place: Edit names it, there is no Yes (card B)", () => {
    expect(reviewAnswerQuestion({ ...locationV2, title: "Unknown place" }, "24h")).toEqual({
      question: "Where were you?", detail: "10:00–11:30", logLabel: null, skipLabel: "Not now", more: true, moreLabel: "Edit", opens: false
    });
  });

  it("asks Apple Health in its own words", () => {
    expect(reviewAnswerQuestion(item({ eventType: "health_sleep_import", title: "Sleep" }), "24h")).toMatchObject({
      question: "Log your sleep, 10:00–11:30?", logLabel: "Log as Sleep", skipLabel: "Not sleep", more: false
    });
    expect(reviewAnswerQuestion(item({ eventType: "health_workout_import", categoryName: "Running" }), "12h")).toMatchObject({
      question: "Log the workout, 10:00 AM–11:30 AM?", logLabel: "Log as Running", skipLabel: "Not a workout"
    });
  });

  it("asks a trip and an outing", () => {
    // Card A: "Getting around, 14:44–16:31?" with Yes / Edit, and Not now.
    expect(reviewAnswerQuestion(item({ eventType: "commute_detected", eventSource: "location_learning", title: "Getting around",
      categoryName: "Getting around" }), "24h"))
      .toEqual({ question: "Getting around, 10:00–11:30?", detail: "As Getting around.", logLabel: "Yes", skipLabel: "Not now",
        more: true, moreLabel: "Edit", opens: false });
    expect(reviewAnswerQuestion(item({ eventType: "commute_detected", eventSource: "location_learning", title: "Commute" }), "24h").question)
      .toBe("Commute, 10:00–11:30?");
    expect(reviewAnswerQuestion(item({ eventType: "commute_detected", eventSource: "location_learning", title: undefined }), "24h").question)
      .toBe("Getting around, 10:00–11:30?");
    // An outing asks about its place alone; its trips there and back are decided with it (card B).
    expect(reviewAnswerQuestion(locationV2, "24h", { outing: true })).toEqual({
      question: "Visited Exampleton Library?", detail: "10:00–11:30", logLabel: "Yes", skipLabel: "Not now", more: true, moreLabel: "Edit", opens: false
    });
  });

  it("asks without times when the suggestion has none, and offers its own screen instead of answers", () => {
    // Without a whole window the outbox refuses every answer (Codex r3 on #582): it opens instead.
    expect(reviewAnswerQuestion(item({ suggestedStartedAt: null, suggestedStoppedAt: null }), "24h")).toEqual({
      question: "Log Exampleton Library?", detail: "It has no complete time yet, so it can't be answered here.",
      logLabel: null, skipLabel: null, more: false, opens: true
    });
  });

  it("opens, never answers, a suggestion with a waiting or rejected change of its own (Codex r10 on #582)", () => {
    expect(reviewAnswerQuestion(locationV2, "24h", { pendingChange: true })).toMatchObject({
      detail: "A change to it is waiting or wasn't accepted, so it can't be answered here.",
      logLabel: null, skipLabel: null, more: false, opens: true
    });
  });
});
