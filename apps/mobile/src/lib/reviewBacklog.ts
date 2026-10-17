import { foldedOutingMemberIds, type ReviewPresentationResponse } from "@dayframe/shared";
import type { MobileTimeEntry } from "./api";
import { legacyReviewPresentationToMobileEntry } from "./reviewFocus";

export type ReviewBacklogPage = {
  snapshotToken: string;
  nextCursor: string | null;
  globalCount: number;
  recordsComplete: boolean;
  recordKeys: string[];
  reviewItemIds: string[];
  legacyEntries: MobileTimeEntry[];
  /** The loaded records' outings (PRD D19), so "Loaded N of M" counts cards as `globalCount` does. */
  outings?: { id: string; rawPayload: { outingKey: string; outingRole: string } }[];
};

export type ReviewBacklogState = ReviewBacklogPage;

/**
 * Keep Review's pageable backlog separate from the Today snapshot. The page
 * only contains whitelisted display data; Review's existing SQLite owner
 * remains responsible for caching open proposal sources and local effects.
 */
export function projectReviewBacklogPage(
  response: ReviewPresentationResponse
): ReviewBacklogPage {
  if (response.scope.mode !== "backlog") {
    throw new Error("Expected a Review backlog page.");
  }
  const legacyById = new Map<string, MobileTimeEntry>();
  const recordKeys: string[] = [];
  const reviewItemIds: string[] = [];
  const outings: NonNullable<ReviewBacklogPage["outings"]> = [];
  for (const record of response.records) {
    if (record.kind === "review") {
      recordKeys.push(`review:${record.reviewItemId}`);
      reviewItemIds.push(record.reviewItemId);
      if (record.outing) outings.push({ id: record.reviewItemId, rawPayload: { outingKey: record.outing.key, outingRole: record.outing.role } });
      continue;
    }
    if (record.kind === "legacy_review_entry") {
      recordKeys.push(`legacy:${record.entryId}`);
      const entry = legacyReviewPresentationToMobileEntry(record);
      if (entry) legacyById.set(entry.id, entry);
    }
  }
  return {
    snapshotToken: response.snapshotToken,
    nextCursor: response.nextCursor,
    globalCount: response.outstanding.globalCount,
    recordsComplete: response.completeness.records,
    recordKeys: [...new Set(recordKeys)],
    reviewItemIds: [...new Set(reviewItemIds)],
    legacyEntries: [...legacyById.values()],
    outings
  };
}

/**
 * Returns null instead of joining pages from different immutable snapshots.
 * The caller restarts one bounded foreground generation rather than appending
 * a changed page to an old Review list.
 */
export function mergeReviewBacklogPage(
  current: ReviewBacklogState | null,
  page: ReviewBacklogPage,
  reset: boolean
): ReviewBacklogState | null {
  if (reset || !current) return page;
  if (
    current.snapshotToken !== page.snapshotToken ||
    current.globalCount !== page.globalCount
  ) {
    return null;
  }
  const legacyById = new Map(current.legacyEntries.map((entry) => [entry.id, entry]));
  for (const entry of page.legacyEntries) legacyById.set(entry.id, entry);
  return {
    snapshotToken: page.snapshotToken,
    nextCursor: page.nextCursor,
    globalCount: page.globalCount,
    recordsComplete: page.recordsComplete,
    recordKeys: [...new Set([...current.recordKeys, ...page.recordKeys])],
    reviewItemIds: [...new Set([...current.reviewItemIds, ...page.reviewItemIds])],
    legacyEntries: [...legacyById.values()],
    outings: [...new Map([...current.outings ?? [], ...page.outings ?? []].map((outing) => [outing.id, outing])).values()]
  };
}

/** How many cards the loaded records show as: an outing once (PRD D19, PR 12c), like `globalCount`. */
export function loadedReviewBacklogCards(backlog: Pick<ReviewBacklogState, "recordKeys" | "outings">) {
  return backlog.recordKeys.length - foldedOutingMemberIds(backlog.outings ?? []).size;
}
