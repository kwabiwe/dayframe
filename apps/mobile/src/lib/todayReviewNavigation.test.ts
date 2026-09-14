import { describe, expect, it } from "vitest";
import { todayReviewNavigationTarget } from "./todayReviewNavigation";
import type { TodayActivity } from "./todayReviewPresentation";

const id = "10000000-0000-4000-8000-000000000001";

describe("todayReviewNavigationTarget", () => {
  it("routes each source to its exact existing destination", () => {
    expect(todayReviewNavigationTarget(activity({ source: { kind: "review", reviewItemId: id }, reviewSourceKind: "generic" })))
      .toEqual({ kind: "generic_review", pathname: "/review", params: { focusReviewId: id } });
    expect(todayReviewNavigationTarget(activity({ source: { kind: "review", reviewItemId: id }, reviewSourceKind: "location_v2" })))
      .toEqual({ kind: "location_evidence", pathname: "/review/[id]", params: { id } });
    expect(todayReviewNavigationTarget(activity({ source: { kind: "legacy_review_entry", entryId: id } })))
      .toEqual({ kind: "legacy_entry", pathname: "/review", params: { focusEntryId: id } });
  });

  it("keeps unresolved saved intent in existing diagnostics and never guesses an invalid ID", () => {
    expect(todayReviewNavigationTarget(activity({ state: "accepted_locally" })))
      .toMatchObject({ kind: "sync_diagnostics" });
    expect(todayReviewNavigationTarget(activity({ source: { kind: "review", reviewItemId: "not-an-id" } })))
      .toBeNull();
  });
});

function activity(overrides: Partial<TodayActivity> = {}): TodayActivity {
  return {
    presentationKey: `owner:review:${id}:day`,
    ownerKey: "owner",
    source: { kind: "review", reviewItemId: id },
    state: "needs_review",
    canonicalEntryIds: [],
    interval: { startMs: 1, endMs: 2 },
    clippedInterval: { startMs: 1, endMs: 2 },
    detectedAtMs: 1,
    reviewSourceKind: "generic",
    title: "Synthetic activity",
    category: null,
    placeLabel: null,
    awaitingDecision: true,
    countsAsLogged: false,
    quickConfirm: { eligible: false, reason: "Synthetic" },
    resolution: "none",
    ...overrides
  };
}
