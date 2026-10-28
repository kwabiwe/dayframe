import { describe, expect, it } from "vitest";
import { askingChecks, oldestCheckHref } from "@/lib/calendar-checks";
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

  it("links the badge to the oldest in Calendar's List, by its day and id", () => {
    const checks = askingChecks([item("later", 27), item("old one", 23)], today);
    expect(oldestCheckHref(checks)).toBe("/timeline?view=list&scope=day&date=2026-10-23&check=old%20one");
    expect(oldestCheckHref([])).toBe("/timeline?view=list&scope=day");
  });
});
