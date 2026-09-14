import { describe, expect, it, vi } from "vitest";
import {
  QuickConfirmUnavailableError,
  quickConfirmEligibility,
  saveQuickReviewConfirmation
} from "./reviewQuickConfirm";

const hash = "a".repeat(64);
const owner = {
  backendId: "staging-fixture",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001"
};
const source = {
  kind: "review" as const,
  reviewItemId: "30000000-0000-4000-8000-000000000001",
  status: "open" as const,
  sourceKind: "generic" as const,
  interval: { start: "2026-09-12T08:00:00.000Z", end: "2026-09-12T08:30:00.000Z" },
  proposalHash: hash
};

describe("quickConfirmEligibility", () => {
  it("selects only exact unchanged generic or V2 Location actions", () => {
    expect(quickConfirmEligibility({ source, ownerMatches: true, effect: null, localCommitInProgress: false }))
      .toEqual({ eligible: true, mutation: { action: "accept", expectedProposalHash: hash } });
    expect(quickConfirmEligibility({
      source: { ...source, sourceKind: "location_v2" },
      ownerMatches: true,
      effect: null,
      localCommitInProgress: false
    })).toEqual({ eligible: true, mutation: { action: "confirm", expectedProposalHash: hash } });
  });

  it.each([
    { source: { ...source, interval: { start: source.interval.start, end: null } }, ownerMatches: true, effect: null, localCommitInProgress: false },
    { source: { ...source, proposalHash: null }, ownerMatches: true, effect: null, localCommitInProgress: false },
    { source, ownerMatches: false, effect: null, localCommitInProgress: false },
    { source, ownerMatches: true, effect: { state: "pending" }, localCommitInProgress: false },
    { source, ownerMatches: true, effect: null, localCommitInProgress: true }
  ])("rejects incomplete, stale or already-owned source", (input) => {
    expect(quickConfirmEligibility(input as never).eligible).toBe(false);
  });
});

describe("saveQuickReviewConfirmation", () => {
  it("waits only for local persistence and does not misreport a later callback failure", async () => {
    const enqueue = vi.fn().mockResolvedValue({ envelope: { clientMutationId: "persisted-id" } });
    const sync = vi.fn().mockResolvedValue(undefined);
    const current = {
      source,
      item: { id: source.reviewItemId },
      bootstrap: {},
      effect: null
    };
    const result = await saveQuickReviewConfirmation({
      owner,
      response: { scope: { mode: "lookup", timeZone: "Europe/London" } },
      reviewItemId: source.reviewItemId,
      proposalHash: hash,
      onCommitted: () => { throw new Error("announcement unavailable"); }
    }, {
      createReviewClientMutationId: () => "new-id",
      readCurrentReviewSourceForQuickConfirm: vi.fn().mockResolvedValue(current),
      enqueueReviewMutation: enqueue,
      synchroniseReviewMutations: sync
    } as never);

    expect(result).toEqual({ saved: true, clientMutationId: "persisted-id" });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      clientMutationId: "new-id",
      mutation: { action: "accept", expectedProposalHash: hash },
      presentation: { backendId: owner.backendId, scope: { mode: "lookup", timeZone: "Europe/London" } }
    }));
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());
  });

  it("rejects a changed displayed hash before asking the durable owner to enqueue", async () => {
    const enqueue = vi.fn();
    await expect(saveQuickReviewConfirmation({
      owner,
      response: { scope: { mode: "lookup", timeZone: "Europe/London" } },
      reviewItemId: source.reviewItemId,
      proposalHash: "b".repeat(64)
    }, {
      createReviewClientMutationId: () => "new-id",
      readCurrentReviewSourceForQuickConfirm: vi.fn().mockResolvedValue({ source, item: {}, bootstrap: {}, effect: null }),
      enqueueReviewMutation: enqueue,
      synchroniseReviewMutations: vi.fn()
    } as never)).rejects.toBeInstanceOf(QuickConfirmUnavailableError);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
