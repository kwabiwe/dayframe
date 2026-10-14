import { afterAll, describe, expect, it, vi } from "vitest";
import { REVIEW_BULK_SKIP_AGE_MS } from "./reviewBulkSkip";
import {
  formatReviewDeckSegmentCount,
  legacyEntryMoment,
  mergeReviewDeckChronology,
  parseReviewDeckSegmentParam,
  reviewDeckOlderThanWeek,
  reviewDeckSegmentAccessibilityLabel,
  reviewDeckSegmentCounts,
  reviewDeckSegmentDimmed,
  reviewDeckSegmentFor,
  reviewDeckSegmentFramedCopy,
  reviewDeckSegmentView,
  reviewDeckToday,
  reviewDeckTodayCovered,
  reviewItemMoment,
  switchReviewDeckSegment
} from "./reviewDeckSegments";

// Local days matter here (midnight, and the clock change on 25 Oct 2026), so pin the zone before
// any describe body builds a date.
const originalZone = process.env.TZ;
process.env.TZ = "Europe/London";
afterAll(() => {
  process.env.TZ = originalZone;
});

const local = (day: number, hour: number, minute = 0, month = 9) => new Date(2026, month, day, hour, minute).toISOString();
const window = (start: string | null, stop: string | null, createdAt: string | null = null) =>
  reviewItemMoment({ suggestedStartedAt: start, suggestedStoppedAt: stop, createdAt });

describe("reviewDeckToday", () => {
  it("runs from local midnight to the next local midnight", () => {
    const today = reviewDeckToday(new Date(2026, 9, 14, 15, 30).getTime());
    expect(today.startMs).toBe(new Date(2026, 9, 14).getTime());
    expect(today.endMs).toBe(new Date(2026, 9, 15).getTime());
    expect(today.endMs - today.startMs).toBe(24 * 3_600_000);
  });

  it("is 25 hours on the day the clocks go back and 23 when they go forward", () => {
    const autumn = reviewDeckToday(new Date(2026, 9, 25, 12).getTime());
    expect(autumn.endMs - autumn.startMs).toBe(25 * 3_600_000);
    const spring = reviewDeckToday(new Date(2026, 2, 29, 12).getTime());
    expect(spring.endMs - spring.startMs).toBe(23 * 3_600_000);
  });
});

describe("reviewDeckSegmentFor (overlaps today, as the server's todayCount and the ribbon)", () => {
  const today = reviewDeckToday(new Date(2026, 9, 14, 15, 0).getTime());

  it("puts a moment that overlaps today under Today and anything before it under Earlier", () => {
    expect(reviewDeckSegmentFor(window(local(14, 9), local(14, 10)), today)).toBe("today");
    expect(reviewDeckSegmentFor(window(local(13, 21, 19), local(13, 21, 26)), today)).toBe("earlier");
    expect(reviewDeckSegmentFor(window(local(5, 9), local(5, 10)), today)).toBe("earlier");
  });

  it("keeps overnight sleep that ends this morning under Today", () => {
    expect(reviewDeckSegmentFor(window(local(13, 23, 10), local(14, 7, 5)), today)).toBe("today");
  });

  it("uses a half-open boundary at midnight, like the server", () => {
    // Ends exactly at midnight: it does not overlap today.
    expect(reviewDeckSegmentFor(window(local(13, 22), local(14, 0)), today)).toBe("earlier");
    // Ends a minute after midnight: it does.
    expect(reviewDeckSegmentFor(window(local(13, 22), local(14, 0, 1)), today)).toBe("today");
    // Starts at tomorrow's midnight: not today.
    expect(reviewDeckSegmentFor(window(local(15, 0), local(15, 1)), today)).toBe("earlier");
    // Starts just before tomorrow's midnight: today.
    expect(reviewDeckSegmentFor(window(local(14, 23, 59), local(15, 0, 30)), today)).toBe("today");
  });

  it("places a moment without a complete window by when it was detected", () => {
    expect(reviewDeckSegmentFor(window(local(14, 9), null, local(14, 9, 2)), today)).toBe("today");
    expect(reviewDeckSegmentFor(window(null, null, local(13, 23, 59)), today)).toBe("earlier");
    expect(reviewDeckSegmentFor(window(null, null, null), today)).toBe("earlier");
  });

  it("follows the clock change: the 25-hour day still ends at the next local midnight", () => {
    const autumn = reviewDeckToday(new Date(2026, 9, 25, 12).getTime());
    // 00:30 BST and 01:30 GMT on 25 Oct are both today.
    expect(reviewDeckSegmentFor(window("2026-10-24T23:30:00.000Z", "2026-10-24T23:45:00.000Z"), autumn)).toBe("today");
    expect(reviewDeckSegmentFor(window("2026-10-25T01:30:00.000Z", "2026-10-25T01:45:00.000Z"), autumn)).toBe("today");
    // 23:30 BST on the 24th is the day before.
    expect(reviewDeckSegmentFor(window("2026-10-24T22:30:00.000Z", "2026-10-24T22:45:00.000Z"), autumn)).toBe("earlier");
    // 23:30 GMT on the 25th is still today; midnight GMT is tomorrow.
    expect(reviewDeckSegmentFor(window("2026-10-25T23:30:00.000Z", "2026-10-25T23:45:00.000Z"), autumn)).toBe("today");
    expect(reviewDeckSegmentFor(window("2026-10-26T00:00:00.000Z", "2026-10-26T00:10:00.000Z"), autumn)).toBe("earlier");
  });

  it("places a legacy needs-review entry by its own interval, or its start while it has no stop", () => {
    expect(reviewDeckSegmentFor(legacyEntryMoment({ startedAt: local(13, 23), stoppedAt: local(14, 1) }), today)).toBe("today");
    expect(reviewDeckSegmentFor(legacyEntryMoment({ startedAt: local(12, 9), stoppedAt: local(12, 10) }), today)).toBe("earlier");
    expect(reviewDeckSegmentFor(legacyEntryMoment({ startedAt: local(14, 9), stoppedAt: null }), today)).toBe("today");
  });
});

describe("mergeReviewDeckChronology (item 5: legacy entries in date order)", () => {
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
  type Dated = { id: string; at: number };
  const startOf = { review: (item: Dated) => item.at, legacy: (entry: Dated) => entry.at };

  it("places each legacy entry among the review items by when it began, newest first", () => {
    const reviews = [{ id: "r1", at: at(14, 9) }, { id: "r2", at: at(13, 9) }, { id: "r3", at: at(10, 9) }];
    const legacy = [{ id: "old", at: at(1, 9) }, { id: "mid", at: at(12, 9) }, { id: "new", at: at(14, 12) }];
    expect(mergeReviewDeckChronology(reviews, legacy, startOf).map((source) => source.value.id))
      .toEqual(["new", "r1", "r2", "mid", "r3", "old"]);
  });

  it("keeps the review items in the order they came in, and a tie puts the review item first", () => {
    // The review items' own order is never changed, even when it is not strictly by time.
    const unordered = [{ id: "b", at: at(13, 9) }, { id: "a", at: at(14, 9) }];
    expect(mergeReviewDeckChronology(unordered, [], startOf).map((source) => source.value.id)).toEqual(["b", "a"]);
    const reviews = [{ id: "a", at: at(14, 9) }, { id: "b", at: at(13, 9) }];
    const legacy = [{ id: "tie", at: at(13, 9) }];
    expect(mergeReviewDeckChronology(reviews, legacy, startOf).map((source) => source.value.id)).toEqual(["a", "b", "tie"]);
  });

  it("puts a legacy entry without a usable start last", () => {
    expect(mergeReviewDeckChronology([{ id: "r", at: at(1, 9) }], [{ id: "x", at: Number.NaN }], startOf).map((source) => source.kind))
      .toEqual(["review", "legacy"]);
  });
});

describe("reviewDeckSegmentCounts", () => {
  it("counts each segment from the deck once the whole backlog is loaded", () => {
    expect(reviewDeckSegmentCounts({ today: 3, earlier: 9, backlogComplete: true, todayCovered: false, serverRemaining: null }))
      .toEqual({ today: { value: 3, exact: true }, earlier: { value: 9, exact: true } });
  });

  it("derives Earlier from the server's exact total once Today is covered", () => {
    expect(reviewDeckSegmentCounts({ today: 3, earlier: 97, backlogComplete: false, todayCovered: true, serverRemaining: 340 }))
      .toEqual({ today: { value: 3, exact: true }, earlier: { value: 337, exact: true } });
  });

  it("never claims fewer than the loaded cards", () => {
    expect(reviewDeckSegmentCounts({ today: 3, earlier: 97, backlogComplete: false, todayCovered: true, serverRemaining: 50 }).earlier)
      .toEqual({ value: 97, exact: true });
  });

  it("marks counts \"at least\" while pages are still to load", () => {
    expect(reviewDeckSegmentCounts({ today: 3, earlier: 97, backlogComplete: false, todayCovered: false, serverRemaining: 340 }))
      .toEqual({ today: { value: 3, exact: false }, earlier: { value: 97, exact: false } });
    expect(reviewDeckSegmentCounts({ today: 3, earlier: 97, backlogComplete: false, todayCovered: true, serverRemaining: null }).earlier)
      .toEqual({ value: 97, exact: false });
  });
});

describe("reviewDeckTodayCovered", () => {
  const today = reviewDeckToday(new Date(2026, 9, 14, 15).getTime());
  it("is covered by a complete backlog, or loaded pages that reach a week before today", () => {
    expect(reviewDeckTodayCovered({ backlogComplete: true, oldestLoadedStartMs: Number.NaN, today })).toBe(true);
    expect(reviewDeckTodayCovered({ backlogComplete: false, oldestLoadedStartMs: today.startMs - REVIEW_BULK_SKIP_AGE_MS - 1, today })).toBe(true);
    expect(reviewDeckTodayCovered({ backlogComplete: false, oldestLoadedStartMs: today.startMs - REVIEW_BULK_SKIP_AGE_MS, today })).toBe(false);
    expect(reviewDeckTodayCovered({ backlogComplete: false, oldestLoadedStartMs: Number.NaN, today })).toBe(false);
  });
});

describe("segment labels", () => {
  it("shows an exact count, \"9+\" while not exact, and nothing for an unknown zero", () => {
    expect(formatReviewDeckSegmentCount({ value: 3, exact: true })).toBe("3");
    expect(formatReviewDeckSegmentCount({ value: 0, exact: true })).toBe("0");
    expect(formatReviewDeckSegmentCount({ value: 9, exact: false })).toBe("9+");
    expect(formatReviewDeckSegmentCount({ value: 0, exact: false })).toBe("");
  });

  it("reads as a tab: \"Earlier, 9 moments\" (the system adds \"selected\")", () => {
    expect(reviewDeckSegmentAccessibilityLabel("earlier", { value: 9, exact: true })).toBe("Earlier, 9 moments");
    expect(reviewDeckSegmentAccessibilityLabel("today", { value: 1, exact: true })).toBe("Today, 1 moment");
    expect(reviewDeckSegmentAccessibilityLabel("today", { value: 0, exact: true })).toBe("Today, no moments");
    expect(reviewDeckSegmentAccessibilityLabel("earlier", { value: 9, exact: false })).toBe("Earlier, at least 9 moments");
    expect(reviewDeckSegmentAccessibilityLabel("earlier", { value: 0, exact: false })).toBe("Earlier");
  });

  it("dims only a segment that is certainly empty", () => {
    expect(reviewDeckSegmentDimmed({ value: 0, exact: true })).toBe(true);
    expect(reviewDeckSegmentDimmed({ value: 0, exact: false })).toBe(false);
    expect(reviewDeckSegmentDimmed({ value: 2, exact: true })).toBe(false);
  });

  it("reads the nudge's route parameter", () => {
    expect(parseReviewDeckSegmentParam("earlier")).toBe("earlier");
    expect(parseReviewDeckSegmentParam("today")).toBe("today");
    expect(parseReviewDeckSegmentParam(["earlier"])).toBeNull();
    expect(parseReviewDeckSegmentParam("all")).toBeNull();
    expect(parseReviewDeckSegmentParam(undefined)).toBeNull();
  });
});

describe("reviewDeckSegmentView", () => {
  const exact = (value: number) => ({ value, exact: true });

  it("shows \"All framed\" only when both segments are empty", () => {
    expect(reviewDeckSegmentView({ selected: "today", selectedCards: 0, otherCards: 0, selectedCount: exact(0), allFinished: true })).toBe("finished");
    expect(reviewDeckSegmentView({ selected: "today", selectedCards: 0, otherCards: 9, selectedCount: exact(0), allFinished: false })).toBe("segment_framed");
  });

  it("shows \"Today is framed\" only when Today is certainly empty", () => {
    expect(reviewDeckSegmentView({ selected: "today", selectedCards: 0, otherCards: 9, selectedCount: { value: 0, exact: false }, allFinished: false })).toBe("waiting");
    expect(reviewDeckSegmentView({ selected: "earlier", selectedCards: 0, otherCards: 3, selectedCount: exact(0), allFinished: false })).toBe("segment_framed");
  });

  it("shows the cards while the selected segment has any, and waits when nothing is loaded", () => {
    expect(reviewDeckSegmentView({ selected: "earlier", selectedCards: 2, otherCards: 0, selectedCount: exact(2), allFinished: false })).toBe("cards");
    expect(reviewDeckSegmentView({ selected: "today", selectedCards: 0, otherCards: 0, selectedCount: exact(0), allFinished: false })).toBe("waiting");
  });

  it("names the other segment's count and its switch", () => {
    expect(reviewDeckSegmentFramedCopy("today", exact(9))).toEqual({
      title: "Today is framed",
      detail: "9 earlier moments to review.",
      action: "Review earlier",
      actionAccessibilityLabel: "Review earlier, 9 moments"
    });
    expect(reviewDeckSegmentFramedCopy("today", { value: 100, exact: false }).detail).toBe("100+ earlier moments to review.");
    expect(reviewDeckSegmentFramedCopy("earlier", exact(1))).toMatchObject({
      title: "Earlier is framed",
      detail: "1 moment from today to review.",
      action: "Review today"
    });
  });
});

describe("switchReviewDeckSegment", () => {
  it("saves a held decision before the deck changes", () => {
    const calls: string[] = [];
    const switched = switchReviewDeckSegment("today", "earlier", {
      flushHeld: () => calls.push("flush"),
      select: (segment) => calls.push(`select:${segment}`)
    });
    expect(switched).toBe(true);
    expect(calls).toEqual(["flush", "select:earlier"]);
  });

  it("does nothing when the selected segment is tapped", () => {
    const flushHeld = vi.fn();
    const select = vi.fn();
    expect(switchReviewDeckSegment("earlier", "earlier", { flushHeld, select })).toBe(false);
    expect(flushHeld).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("reviewDeckOlderThanWeek", () => {
  const now = new Date(2026, 9, 14, 15).getTime();
  it("marks an Earlier card that began more than 7 days ago (the bulk skip's line)", () => {
    expect(reviewDeckOlderThanWeek(window(new Date(now - REVIEW_BULK_SKIP_AGE_MS - 60_000).toISOString(), local(7, 16)), now)).toBe(true);
    expect(reviewDeckOlderThanWeek(window(new Date(now - REVIEW_BULK_SKIP_AGE_MS + 60_000).toISOString(), local(7, 16)), now)).toBe(false);
    expect(reviewDeckOlderThanWeek(window(null, null, local(1, 9)), now)).toBe(true);
    expect(reviewDeckOlderThanWeek(window(null, null, null), now)).toBe(false);
  });
});
