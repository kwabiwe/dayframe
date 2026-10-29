import { describe, expect, it, vi } from "vitest";
import {
  CLASH_PRESENTATION_MAX_PAGES,
  clashPresentationNeeded,
  fetchClashPresentationItems,
  withClashItems
} from "@/lib/clash-presentation";
import { askingChecks, clashBlocksFrom } from "@/lib/calendar-checks";
import { reviewMutationFor } from "@/lib/review-deck";
import type { ReviewItemRow, TimeEntryRow } from "@/lib/queries";

// Web parity with #622: clashes past the bootstrap's 100 items, read from the Review presentation. Synthetic ids only.
const local = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const today = new Date(2026, 9, 28).getTime();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = "d".repeat(64);
const clashRecord = (n: number, patch: Record<string, unknown> = {}) => ({
  kind: "review", reviewItemId: id(n), eventId: id(5_000 + n), locationSegmentId: null, sourceKind: "generic", eventSource: "location_learning",
  eventType: "timer_trip_clash", title: `Block ${n} ran 20m into your trip`, category: { id: null, name: null, color: null },
  place: { id: null, label: null }, interval: { start: local(27, 8), end: local(27, 10) }, confidence: "high", status: "open",
  createdAt: local(27, 11), updatedAt: local(27, 11), proposalHash: HASH, canonicalEntryIds: [], semanticRevision: null,
  timerTripClash: { timeEntryId: id(9_000 + n), tripId: `trip-${n}`, tripStartedAt: local(27, 10), tripStoppedAt: local(27, 11), overlapSeconds: 1_200 },
  ...patch
});
const page = (records: unknown[], nextCursor: string | null, snapshotToken = "snap-1") => ({
  version: 1, scope: { mode: "window", timeZone: "UTC" }, snapshotToken, capturedAt: local(28, 9), nextCursor,
  completeness: { records: !nextCursor, outstandingCounts: true, completedToday: false, partialReason: nextCursor ? "page" : null },
  outstanding: { globalCount: records.length, todayCount: 0, openReviewItemIds: [] }, records, links: [],
  lookup: { reviewItems: [], entries: [] }
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("clashes past the bootstrap's cap on the web (web parity with #622)", () => {
  it("pages with the server's cursor, sending the timer-trip-clash feature, and keeps each clash once", async () => {
    const pages = [page([clashRecord(1), clashRecord(2)], "c2"), page([clashRecord(2), clashRecord(3)], "c3"), page([clashRecord(4)], null)];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return json(pages[body.cursor === "c2" ? 1 : body.cursor === "c3" ? 2 : 0]);
    });
    const items = await fetchClashPresentationItems({ fetcher, todayStartMs: today, timeZone: "UTC", isCurrent: () => true });
    expect(items?.map((item) => item.id)).toEqual([id(1), id(2), id(3), id(4)]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/review/presentation");
    expect((init.headers as Record<string, string>)["x-dayframe-review-features"]).toBe("timer-trip-clash");
    expect(JSON.parse(init.body as string)).toMatchObject({ version: 1, mode: "window", limit: 200 });
    expect(JSON.parse(fetcher.mock.calls[1][1].body as string).cursor).toBe("c2");
  });

  it("stops at its page bound", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => json(page([], `c${++n}`)));
    await expect(fetchClashPresentationItems({ fetcher, todayStartMs: today, timeZone: "UTC", isCurrent: () => true })).rejects.toThrow(/page count/);
    expect(fetcher).toHaveBeenCalledTimes(CLASH_PRESENTATION_MAX_PAGES);
  });

  it("skips a record whose field is invalid or missing (no header, an older server) without failing the page", async () => {
    const noField: Record<string, unknown> = clashRecord(2);
    delete noField.timerTripClash;
    const fetcher = vi.fn(async () => json(page([clashRecord(1, { timerTripClash: { timeEntryId: "nope" } }), noField, clashRecord(3)], null)));
    const items = await fetchClashPresentationItems({ fetcher, todayStartMs: today, timeZone: "UTC", isCurrent: () => true });
    expect(items?.map((item) => item.id)).toEqual([id(3)]);
  });

  it("stops and uses nothing once the owner it read for is no longer signed in (account switch mid-read)", async () => {
    let owner = "w1:u1";
    const fetcher = vi.fn(async () => {
      owner = "w2:u2";
      return json(page([clashRecord(1)], "c2"));
    });
    const items = await fetchClashPresentationItems({ fetcher, todayStartMs: today, timeZone: "UTC", isCurrent: () => owner === "w1:u1" });
    expect(items).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("attaches a recovered clash to its block, counts it only while that block is loaded, and answers End it with the record's hash", async () => {
    const fetcher = vi.fn(async () => json(page([clashRecord(1)], null)));
    const [item] = (await fetchClashPresentationItems({ fetcher, todayStartMs: today, timeZone: "UTC", isCurrent: () => true }))!;
    expect(item).toMatchObject({ type: "location_timer_trip_clash", suggestedStartedAt: local(27, 8), suggestedStoppedAt: local(27, 10),
      proposalHash: HASH, rawPayload: { timeEntryId: id(9_001), tripId: "trip-1" } });
    expect(reviewMutationFor(item, "log", undefined)).toEqual({ action: "accept", expectedProposalHash: HASH });
    const block: TimeEntryRow = {
      id: id(9_001), projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null, categoryName: null, categoryColor: null,
      placeId: null, placeName: null, source: "manual_web", confidence: "high", reviewStatus: "confirmed", description: "Block 1",
      startedAt: local(27, 8), stoppedAt: local(27, 10), updatedAt: local(27, 10), durationSeconds: 0, tagNames: [], tags: []
    };
    const running = { ...block, stoppedAt: null };
    const merged = withClashItems([], [item]);
    expect(askingChecks(merged, today, clashBlocksFrom([], []))).toEqual([]);
    expect(askingChecks(merged, today, clashBlocksFrom([running], [])).map((check) => check.id)).toEqual([id(1)]);
  });

  it("is read only when the bootstrap reached its cap, and merges without duplicates (the bootstrap's copy wins)", () => {
    const bootstrap = Array.from({ length: 100 }, (_, n) => ({ id: id(n), type: "suggestion" }) as ReviewItemRow);
    expect(clashPresentationNeeded(bootstrap.slice(0, 99))).toBe(false);
    expect(clashPresentationNeeded(bootstrap)).toBe(true);
    const again = { id: id(5), type: "location_timer_trip_clash" } as ReviewItemRow;
    const extra = { id: id(500), type: "location_timer_trip_clash" } as ReviewItemRow;
    const merged = withClashItems(bootstrap, [again, extra]);
    expect(merged).toHaveLength(101);
    expect(merged.find((one) => one.id === id(5))).toBe(bootstrap[5]);
  });
});
