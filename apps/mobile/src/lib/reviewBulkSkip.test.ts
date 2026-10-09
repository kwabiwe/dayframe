import { describe, expect, it } from "vitest";
import {
  REVIEW_BULK_SKIP_AGE_MS,
  reviewBulkSkipCandidates,
  reviewBulkSkipConfirmation,
  reviewBulkSkipOwnerMatches,
  reviewBulkSkipToast
} from "./reviewBulkSkip";

const now = Date.parse("2026-10-08T12:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();
const items = [
  { id: "old", suggestedStartedAt: at(now - REVIEW_BULK_SKIP_AGE_MS - 60_000), suggestedStoppedAt: at(now - REVIEW_BULK_SKIP_AGE_MS) },
  { id: "edge", suggestedStartedAt: at(now - REVIEW_BULK_SKIP_AGE_MS), suggestedStoppedAt: at(now - REVIEW_BULK_SKIP_AGE_MS + 60_000) },
  { id: "recent", suggestedStartedAt: at(now - 3_600_000), suggestedStoppedAt: at(now - 1_800_000) },
  { id: "locked", suggestedStartedAt: at(now - 30 * 86_400_000), suggestedStoppedAt: at(now - 30 * 86_400_000 + 60_000) },
  { id: "no-window", suggestedStartedAt: null, suggestedStoppedAt: null }
];
const skippable = (item: { id: string }) => item.id !== "locked";

describe("reviewBulkSkipCandidates", () => {
  it("skips only moments that started more than 7 days ago", () => {
    expect(reviewBulkSkipCandidates(items, { now, scope: "older", skippable }).map((item) => item.id)).toEqual(["old"]);
  });

  it("skips every skippable moment for Skip all, keeping order", () => {
    expect(reviewBulkSkipCandidates(items, { now, scope: "all", skippable }).map((item) => item.id))
      .toEqual(["old", "edge", "recent", "no-window"]);
  });

  it("never includes a card that could not be skipped by itself", () => {
    expect(reviewBulkSkipCandidates(items, { now, scope: "older", skippable }).some((item) => item.id === "locked")).toBe(false);
    expect(reviewBulkSkipCandidates(items, { now, scope: "all", skippable: () => false })).toEqual([]);
  });
});

describe("reviewBulkSkipConfirmation", () => {
  it("states the count once and offers one confirm", () => {
    expect(reviewBulkSkipConfirmation(42, "older", true)).toEqual({
      title: "Skip 42 moments?",
      message: "Moments older than 7 days are skipped; the last week stays to review. You can undo for a few seconds.",
      confirmLabel: "Skip 42"
    });
    expect(reviewBulkSkipConfirmation(1, "all", true).title).toBe("Skip 1 moment?");
  });

  it("says when only loaded moments are included", () => {
    expect(reviewBulkSkipConfirmation(3, "all", false).message).toMatch(/Only moments loaded on this iPhone are included\.$/);
  });

  it("has nothing to confirm when nothing qualifies", () => {
    expect(reviewBulkSkipConfirmation(0, "older", true)).toMatchObject({ title: "Nothing older than 7 days", confirmLabel: null });
    expect(reviewBulkSkipConfirmation(0, "all", true)).toMatchObject({ title: "Nothing to skip", confirmLabel: null });
  });

  it("names the batch on the Undo toast", () => {
    expect(reviewBulkSkipToast(1)).toBe("Skipped 1 moment");
    expect(reviewBulkSkipToast(160)).toBe("Skipped 160 moments");
  });
});

describe("reviewBulkSkipOwnerMatches", () => {
  const owner = { workspaceId: "w1", userId: "u1" };
  it("matches only the account that held the batch", () => {
    expect(reviewBulkSkipOwnerMatches(owner, { workspace: { id: "w1" }, user: { id: "u1" } })).toBe(true);
    expect(reviewBulkSkipOwnerMatches(owner, { workspace: { id: "w2" }, user: { id: "u1" } })).toBe(false);
    expect(reviewBulkSkipOwnerMatches(owner, { workspace: { id: "w1" }, user: { id: "u2" } })).toBe(false);
    expect(reviewBulkSkipOwnerMatches(owner, null)).toBe(false);
  });
});
