import { describe, expect, it } from "vitest";
import { checkAskingStartMs, checksOldestFirst, checkStillAsks, listCheckOverlaps, type ListCheck } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";
import { reviewAnswerMutation, reviewAnswerQuestion } from "./reviewAnswer";
import { bootstrapBlocksById, clashChecksByBlock, clashEndsFor, clashStillAsksHere, projectTimerTripClashEnds } from "./timerTripClashBlocks";

// Location v4 design §7, synthetic Exampleton data: "Team sync ran 18m into your trip", asked on its block.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const HASH = "d".repeat(64);
const block = (overrides: Partial<MobileTimeEntry> = {}): MobileTimeEntry => ({
  id: "block-1", projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: "work", categoryName: "Work",
  placeName: null, source: "mobile_app", confidence: "high", reviewStatus: "confirmed", description: "Team sync",
  startedAt: at(29, 9), stoppedAt: at(29, 11), durationSeconds: 7_200, ...overrides
});
const clash = (overrides: Partial<MobileReviewItem> = {}, day = 29): MobileReviewItem => ({
  id: "clash-1", type: "location_timer_trip_clash", title: "Team sync ran 18m into your trip", eventSource: "location_learning",
  eventType: "timer_trip_clash", categoryName: "Work", placeName: null, suggestedCategoryId: "work", suggestedPlaceId: null,
  suggestedStartedAt: at(day, 9), suggestedStoppedAt: at(day, 10, 42), confidence: "high", status: "open", notes: null,
  rawPayload: { timeEntryId: "block-1", tripId: "trip-1", tripStartedAt: at(day, 10, 42), tripStoppedAt: at(day, 11, 10), overlapSeconds: 1080 },
  createdAt: at(day, 11), proposalHash: HASH, ...overrides
});
const data = (entries: MobileTimeEntry[], reviewItems: MobileReviewItem[] = [clash()], activeEntry: MobileTimeEntry | null = null) => ({
  user: { id: "user", name: "Synthetic", email: "user@example.test" }, workspace: { id: "workspace", name: "Synthetic" },
  categories: [{ id: "work", name: "Work", color: "blue", isPinned: false }, { id: "commute", name: "Commute", color: "amber", isPinned: false, starterKey: "commute" }],
  activeEntry, projects: [], places: [], entries, reviewItems
}) as MobileBootstrap;
const now = Date.parse(at(29, 18));
const checkOf = (item: MobileReviewItem): ListCheck => ({ id: item.id, segmentId: null, startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt });

describe("a block that ran into a trip, on its block (location v4 design §7)", () => {
  it("attaches to the block its payload names, whether or not the block is loaded", () => {
    expect(clashChecksByBlock([clash(), { ...clash(), id: "clash-0" }, { id: "stay", type: "activity_suggestion", eventType: "unknown_stay", rawPayload: null }]))
      .toEqual(new Map([["block-1", "clash-0"]]));
    // Not loaded here (an older day): the server's question stands.
    expect(clashStillAsksHere(clash(), data([]), now)).toBe(true);
    expect(clashStillAsksHere(clash(), data([block()]), now)).toBe(true);
    // Not a clash: not this rule's.
    expect(clashStillAsksHere({ ...clash(), type: "activity_suggestion", eventType: "unknown_stay" }, data([]), now)).toBe(true);
  });

  it("stops asking at once once the block, as this iPhone has it, no longer runs into the trip", () => {
    // Edited (a queued edit) to end at the trip's start, or made a move activity.
    expect(clashStillAsksHere(clash(), data([block({ stoppedAt: at(29, 10, 42) })]), now)).toBe(false);
    expect(clashStillAsksHere(clash(), data([block({ categoryId: "commute" })]), now)).toBe(false);
    // The running block stopped (a queued Stop) before the trip ran 5 minutes on.
    expect(clashStillAsksHere(clash(), data([], [clash()], block({ stoppedAt: at(29, 10, 45) })), now)).toBe(false);
    expect(clashStillAsksHere(clash(), data([], [clash()], block({ stoppedAt: null })), now)).toBe(true);
  });

  it("counts once, in the badge's 7 days, Today's chip on its day, oldest first with the others", () => {
    const today = new Date(2026, 9, 29).getTime();
    const fromMs = checkAskingStartMs(today);
    const asking = checksOldestFirst([checkOf(clash()), { id: "older", segmentId: "s", startedAt: at(28, 8), stoppedAt: at(28, 9) }]
      .filter((check) => checkStillAsks(check, fromMs)));
    expect(asking.map((check) => check.id)).toEqual(["older", "clash-1"]);
    expect(asking.filter((check) => listCheckOverlaps(check, today, today + 86_400_000)).map((check) => check.id)).toEqual(["clash-1"]);
    // A week and a day ago: no longer asks, so neither the badge nor the chip counts it.
    expect(checkStillAsks(checkOf(clash({}, 21)), fromMs)).toBe(false);
  });

  it("asks End it at the trip's start and Keep it, with accept + its proposal and ignore_once", () => {
    const question = reviewAnswerQuestion(clash(), "24h");
    expect(question).toEqual({ question: "Team sync ran 18m into your trip", detail: null, logLabel: "End it at 10:42", skipLabel: "Keep it" });
    expect(JSON.stringify(question).toLowerCase()).not.toContain("timer");
    expect(reviewAnswerQuestion(clash(), "12h").logLabel).toBe("End it at 10:42 AM");
    expect(reviewAnswerMutation(clash(), true)).toEqual({ action: "accept", expectedProposalHash: HASH });
    expect(reviewAnswerMutation(clash(), false)).toEqual({ action: "ignore_once" });
    // An older server's item without its proposal: only Keep it.
    expect(reviewAnswerQuestion(clash({ proposalHash: undefined }), "24h").logLabel).toBeNull();
    expect(() => reviewAnswerMutation(clash({ proposalHash: undefined }), true)).toThrow();
    // A change of its own waiting: no answers, as any "?".
    expect(reviewAnswerQuestion(clash(), "24h", { pendingChange: true })).toMatchObject({ logLabel: null, skipLabel: null });
  });

  it("shows End it on the running block before the server does: ended at the trip's start, no longer running", () => {
    const running = block({ stoppedAt: null });
    const before = data([], [clash()], running);
    const ends = clashEndsFor(before.reviewItems, new Set(["clash-1"]), []);
    expect(ends).toEqual(new Map([["block-1", at(29, 10, 42)]]));
    const after = projectTimerTripClashEnds(before, ends)!;
    expect(after.activeEntry).toBeNull();
    expect(bootstrapBlocksById(after).get("block-1")).toMatchObject({ stoppedAt: at(29, 10, 42), durationSeconds: 6_120 });
    // And so its question no longer asks.
    expect(clashStillAsksHere(clash(), after, now)).toBe(false);
    // Undo: nothing ended, the same data back.
    expect(projectTimerTripClashEnds(before, clashEndsFor(before.reviewItems, new Set(), []))).toBe(before);
  });

  it("applies an End it waiting in the outbox (offline) to a finished block, never lengthening one", () => {
    const finished = data([block()]);
    const ended = projectTimerTripClashEnds(finished, clashEndsFor([], new Set(), [{ timeEntryId: "block-1", tripStartedAt: at(29, 10, 42) }]))!;
    expect(ended.entries[0].stoppedAt).toBe(at(29, 10, 42));
    const shorter = data([block({ stoppedAt: at(29, 10) })]);
    expect(projectTimerTripClashEnds(shorter, new Map([["block-1", at(29, 10, 42)]]))).toBe(shorter);
  });
});
