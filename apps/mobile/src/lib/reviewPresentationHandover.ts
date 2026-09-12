import {
  REVIEW_PRESENTATION_MAX_IDS,
  type ReviewPresentationRequest,
  type ReviewPresentationSnapshot
} from "@dayframe/shared";
import {
  cacheReviewPresentation,
  readAcknowledgedReviewHandoverLookup,
  type ReviewPresentationOwner
} from "./reviewSyncStore";
import { fetchReviewPresentationSnapshot } from "./reviewPresentationClient";

export type ReviewPresentationHandoverResult = {
  attempted: boolean;
  signature: string | null;
};

/**
 * Cancellable display-proof work for one already acknowledged Review intent.
 * This neither delivers a mutation nor changes outbox ownership. It asks the
 * server for explicit terminal sources first, then follows only explicit
 * source-to-entry links in the same bounded lookup before the existing store
 * can retire the durable handover.
 */
export async function reconcileAcknowledgedReviewPresentationHandover(input: {
  owner: ReviewPresentationOwner;
  timeZone: string;
  signal?: AbortSignal;
}): Promise<ReviewPresentationHandoverResult> {
  const handover = await readAcknowledgedReviewHandoverLookup({ owner: input.owner });
  if (!handover) return { attempted: false, signature: null };

  const firstRequest = lookupRequest({
    timeZone: input.timeZone,
    reviewItemIds: handover.reviewItemIds,
    entryIds: handover.entryIds
  });
  const first = await fetchReviewPresentationSnapshot({
    owner: input.owner,
    request: firstRequest,
    signal: input.signal
  });
  if (!await cacheReviewPresentation({ owner: input.owner, response: first })) {
    return { attempted: true, signature: handover.signature };
  }

  const entryIds = uniqueIds([
    ...handover.entryIds,
    ...linkedAcceptedEntryIds(first, handover.reviewItemIds)
  ]);
  if (entryIds.length === handover.entryIds.length) {
    return { attempted: true, signature: handover.signature };
  }
  if (entryIds.length > REVIEW_PRESENTATION_MAX_IDS) {
    // The server contract bounds every source link. Refuse to invent a
    // partial proof if a malformed response would exceed that contract.
    throw new Error("Review handover result links exceed the bounded lookup limit.");
  }

  const second = await fetchReviewPresentationSnapshot({
    owner: input.owner,
    request: lookupRequest({
      timeZone: input.timeZone,
      reviewItemIds: handover.reviewItemIds,
      entryIds
    }),
    signal: input.signal
  });
  await cacheReviewPresentation({ owner: input.owner, response: second });
  return { attempted: true, signature: handover.signature };
}

function lookupRequest(input: {
  timeZone: string;
  reviewItemIds: string[];
  entryIds: string[];
}): Omit<ReviewPresentationRequest, "cursor"> {
  return {
    version: 1,
    mode: "lookup",
    timeZone: input.timeZone,
    reviewItemIds: input.reviewItemIds,
    ...(input.entryIds.length ? { entryIds: input.entryIds } : {}),
    limit: REVIEW_PRESENTATION_MAX_IDS
  };
}

function linkedAcceptedEntryIds(
  response: ReviewPresentationSnapshot,
  reviewItemIds: readonly string[]
) {
  const requested = new Set(reviewItemIds);
  return response.links.flatMap((link) => (
    requested.has(link.reviewItemId) && link.status === "accepted"
      ? link.entryIds
      : []
  ));
}

function uniqueIds(ids: readonly string[]) {
  return [...new Set(ids)].sort();
}
