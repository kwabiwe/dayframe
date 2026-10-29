import { describe, expect, it } from "vitest";
import { askingChecks, checkBlockId, clashBlocksFrom, clashStillAsks, drawsAsOwnCheck, oldestCheckHref, reviewCheckHref, todaysChecks } from "@/lib/calendar-checks";
import { pendingReviewSeconds } from "@/lib/today-view";
import type { TimeEntryRow } from "@/lib/queries";
import { pendingReviewSpans } from "@/lib/today-view";
import type { ReviewItemRow } from "@/lib/queries";

// The badge's, Today's and the List's one list of "?" (owner, 28 Oct 2026, concern 4). Synthetic ids only.
const local = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const item = (id: string, day: number, patch: Partial<ReviewItemRow> = {}): ReviewItemRow => ({
  id, type: "suggestion", title: "Visited a place", eventSource: "location_learning", eventType: "unknown_stay", projectName: null,
  categoryName: null, categoryColor: null, placeName: null, suggestedProjectId: null, suggestedCategoryId: null, suggestedPlaceId: null,
  suggestedStartedAt: local(day, 9), suggestedStoppedAt: local(day, 10), confidence: "medium", status: "open", notes: null, rawPayload: null,
  createdAt: local(day, 12), ...patch
});
const today = new Date(2026, 9, 28).getTime();

describe("the \"?\" that still ask (owner, 28 Oct 2026)", () => {
  it("counts today and the 6 days before, oldest first; an 8-day-old one and answered ones don't count", () => {
    const checks = askingChecks([
      item("today", 28), item("six-days", 22), item("seven-days", 21), item("eight-days", 20), item("answered", 27, { status: "accepted" }),
      item("no-time", 27, { suggestedStartedAt: null, suggestedStoppedAt: null })
    ], today);
    expect(checks.map((check) => check.id)).toEqual(["six-days", "today"]);
  });

  it("counts an outing once, on its stay", () => {
    const stay = item("stay", 27, { rawPayload: { clientSegmentId: "seg-stay", outingKey: "o1", outingRole: "stay" } });
    const there = item("there", 27, { eventType: "commute_detected", suggestedStartedAt: local(27, 8), suggestedStoppedAt: local(27, 9),
      rawPayload: { clientSegmentId: "seg-in", outingKey: "o1", outingRole: "in" } });
    expect(askingChecks([stay, there], today).map((check) => check.id)).toEqual(["stay"]);
  });

  it("links Today's chip to the oldest it is given in Calendar's List, by its day and id", () => {
    const checks = askingChecks([item("later", 27), item("old one", 23)], today);
    expect(oldestCheckHref(checks)).toBe("/timeline?view=list&scope=day&date=2026-10-23&check=old%20one");
    expect(oldestCheckHref([])).toBe("/timeline?view=list&scope=day");
  });

  it("links one \"?\" in the List, on its day when known", () => {
    expect(reviewCheckHref("a b", "2026-10-23")).toBe("/timeline?view=list&scope=day&date=2026-10-23&check=a%20b");
    expect(reviewCheckHref("r1")).toBe("/timeline?view=list&scope=day&check=r1");
  });
});

// Location v4 design §7: a block that ran into a trip is one "?" like any other — counted by the badge, "N to check" and
// Today's chip within the 7 days — but asked on its block, never as a row or span of its own.
describe("a block that ran into a trip asks on its block (design §7)", () => {
  const payload = { timeEntryId: "e1", tripId: "trip-1", tripStartedAt: local(27, 10), tripStoppedAt: local(27, 11), overlapSeconds: 1800 };
  const clash = item("clash", 27, { type: "location_timer_trip_clash", eventSource: "location_learning", eventType: "timer_trip_clash",
    title: "Team sync ran 30m into your trip", suggestedStartedAt: local(27, 8), suggestedStoppedAt: local(27, 10), rawPayload: payload });
  const block = (patch: Partial<TimeEntryRow> = {}): TimeEntryRow => ({
    id: "e1", projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
    placeId: null, placeName: null, source: "manual_app", confidence: "high", reviewStatus: "confirmed", description: "Team sync",
    startedAt: local(27, 8), stoppedAt: local(27, 10), updatedAt: local(27, 10), durationSeconds: 0, tagNames: [], tags: [], ...patch
  });
  const nowMs = new Date(2026, 9, 28, 12).getTime();

  it("is counted once, oldest first, with the others (the badge, N to check, Today's chip)", () => {
    expect(askingChecks([clash, item("stay", 26)], today).map((check) => check.id)).toEqual(["stay", "clash"]);
    expect(checkBlockId(clash)).toBe("e1");
    expect(checkBlockId(item("stay", 27))).toBeNull();
    // Today's chip counts it on the day its trip started.
    expect(todaysChecks(askingChecks([clash], new Date(2026, 9, 27).getTime()), new Date(2026, 9, 27).getTime()).map((check) => check.id)).toEqual(["clash"]);
  });

  it("stops asking past the 7 days, as every \"?\"", () => {
    const old = { ...clash, id: "old", suggestedStartedAt: local(20, 8), suggestedStoppedAt: local(20, 10) };
    expect(askingChecks([old], today).map((check) => check.id)).toEqual([]);
  });

  it("asks only while its block is loaded (#622's rule, web parity), and stops once the block no longer runs into the trip", () => {
    const running = block({ stoppedAt: null });
    // Not loaded here (deleted elsewhere, past the loaded range): not counted until it arrives.
    expect(askingChecks([clash], today, clashBlocksFrom([], []), nowMs)).toEqual([]);
    // Known deleted here (held for Undo): not counted.
    expect(askingChecks([clash], today, new Map([["e1", null]]), nowMs)).toEqual([]);
    // A surface refining the owner's list with its own subset of blocks keeps it.
    expect(clashStillAsks(clash, clashBlocksFrom([], []), nowMs, "asks")).toBe(true);
    expect(askingChecks([clash], today, clashBlocksFrom([running], []), nowMs).map((check) => check.id)).toEqual(["clash"]);
    // Stopped where the trip started (End it, or a Stop at the door), or moved onto a Move activity.
    expect(askingChecks([clash], today, clashBlocksFrom([block({ stoppedAt: local(27, 10) })], []), nowMs)).toEqual([]);
    expect(askingChecks([clash], today, clashBlocksFrom([block({ stoppedAt: null, categoryId: "c" })], [{ id: "c", starterKey: "commute" }]), nowMs))
      .toEqual([]);
  });

  it("is never drawn as a row or span of its own, nor counted as time noticed but not logged", () => {
    expect(drawsAsOwnCheck(clash)).toBe(false);
    expect(drawsAsOwnCheck({ type: undefined as unknown as string, eventType: "timer_trip_clash" })).toBe(false);
    expect(drawsAsOwnCheck(item("stay", 27))).toBe(true);
    const start = new Date(2026, 9, 27).getTime();
    const spans = pendingReviewSpans([clash, item("stay", 27)], start, start + 86_400_000, today + 86_400_000);
    expect(spans.map((span) => span.id)).toEqual(["stay"]);
    expect(pendingReviewSeconds([clash])).toBe(0);
  });
});
