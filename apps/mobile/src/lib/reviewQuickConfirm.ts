import type { ReviewMutation, ReviewPresentationResponse, ReviewProposalPresentation } from "@dayframe/shared";
import type {
  CurrentQuickConfirmSource,
  ReviewPresentationOwner,
  ReviewPresentationStoreEffect
} from "./reviewSyncStore";

export type QuickConfirmEligibility =
  | { eligible: true; mutation: ReviewMutation }
  | { eligible: false; reason: string };

export type QuickConfirmInput = {
  owner: ReviewPresentationOwner;
  response: Pick<ReviewPresentationResponse, "scope">;
  reviewItemId: string;
  proposalHash: string;
  onCommitted?: (input: { clientMutationId: string }) => void | Promise<void>;
};

type QuickConfirmStore = {
  createReviewClientMutationId: () => string;
  readCurrentReviewSourceForQuickConfirm: (input: {
    owner: ReviewPresentationOwner;
    response: Pick<ReviewPresentationResponse, "scope">;
    reviewItemId: string;
  }) => Promise<CurrentQuickConfirmSource | null>;
  enqueueReviewMutation: (input: {
    bootstrap: CurrentQuickConfirmSource["bootstrap"];
    item: CurrentQuickConfirmSource["item"];
    mutation: ReviewMutation;
    clientMutationId: string;
    presentation: { backendId: string; scope: ReviewPresentationResponse["scope"] };
  }) => Promise<{ envelope: { clientMutationId: string } }>;
  synchroniseReviewMutations: () => Promise<unknown>;
};

const attempts = new Set<string>();

export class QuickConfirmUnavailableError extends Error {
  constructor(message = "This Review proposal is no longer available. Refresh it before confirming.") {
    super(message);
    this.name = "QuickConfirmUnavailableError";
  }
}

/** Pure policy for the only two unchanged actions that Stage B may shortcut. */
export function quickConfirmEligibility(input: {
  source: Pick<ReviewProposalPresentation, "status" | "sourceKind" | "interval" | "proposalHash">;
  ownerMatches: boolean;
  effect: ReviewPresentationStoreEffect | null;
  localCommitInProgress: boolean;
  requiresCorrection?: boolean;
}): QuickConfirmEligibility {
  if (!input.ownerMatches) return { eligible: false, reason: "This Review source belongs to a different account or backend." };
  if (input.source.status !== "open") return { eligible: false, reason: "This Review proposal is no longer open." };
  if (!validWindow(input.source.interval.start, input.source.interval.end)) {
    return { eligible: false, reason: "This Review proposal needs a complete time range." };
  }
  if (!input.source.proposalHash || !/^[a-f0-9]{64}$/.test(input.source.proposalHash)) {
    return { eligible: false, reason: "Refresh this Review proposal before confirming." };
  }
  if (input.effect || input.localCommitInProgress) {
    return { eligible: false, reason: "A saved Review action already owns this proposal." };
  }
  if (input.requiresCorrection) {
    return { eligible: false, reason: "This Review proposal needs a choice or correction." };
  }
  return {
    eligible: true,
    mutation: input.source.sourceKind === "location_v2"
      ? { action: "confirm", expectedProposalHash: input.source.proposalHash }
      : { action: "accept", expectedProposalHash: input.source.proposalHash }
  };
}

/**
 * Commit one explicit shortcut through the existing durable Review owner.
 * This resolves current cache state before enqueueing and deliberately waits
 * only for SQLite—not for HTTP delivery or a refreshed display read.
 */
export async function saveQuickReviewConfirmation(
  input: QuickConfirmInput,
  dependencyOverride?: QuickConfirmStore
) {
  const attemptKey = `${input.owner.backendId}:${input.owner.workspaceId}:${input.owner.userId}:${input.reviewItemId}`;
  if (attempts.has(attemptKey)) return { saved: false as const, reason: "already_in_progress" as const };
  attempts.add(attemptKey);
  try {
    const store = dependencyOverride ?? await defaultStore();
    const current = await store.readCurrentReviewSourceForQuickConfirm({
      owner: input.owner,
      response: input.response,
      reviewItemId: input.reviewItemId
    });
    if (!current || current.source.proposalHash !== input.proposalHash) {
      throw new QuickConfirmUnavailableError();
    }
    const eligibility = quickConfirmEligibility({
      source: current.source,
      ownerMatches: true,
      effect: current.effect,
      localCommitInProgress: false
    });
    if (!eligibility.eligible) throw new QuickConfirmUnavailableError(eligibility.reason);
    const saved = await store.enqueueReviewMutation({
      bootstrap: current.bootstrap,
      item: current.item,
      mutation: eligibility.mutation,
      clientMutationId: store.createReviewClientMutationId(),
      presentation: {
        backendId: input.owner.backendId,
        scope: input.response.scope
      }
    });
    // A presentation/announcement callback is outside the commit boundary.
    // It must never turn a successfully saved action into a reported failure.
    try {
      await input.onCommitted?.({ clientMutationId: saved.envelope.clientMutationId });
    } catch {
      // The durable store subscription will refresh an active Today surface.
    }
    void store.synchroniseReviewMutations().catch(() => undefined);
    return { saved: true as const, clientMutationId: saved.envelope.clientMutationId };
  } finally {
    attempts.delete(attemptKey);
  }
}

function validWindow(start: string | null, end: string | null) {
  if (!start || !end) return false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

async function defaultStore(): Promise<QuickConfirmStore> {
  const store = await import("./reviewSyncStore");
  return {
    createReviewClientMutationId: store.createReviewClientMutationId,
    readCurrentReviewSourceForQuickConfirm: store.readCurrentReviewSourceForQuickConfirm,
    enqueueReviewMutation: store.enqueueReviewMutation,
    synchroniseReviewMutations: store.synchroniseReviewMutations
  };
}
