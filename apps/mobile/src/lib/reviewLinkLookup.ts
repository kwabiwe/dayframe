import { REVIEW_PRESENTATION_VERSION } from "@dayframe/shared";
import { fetchReviewPresentationPage } from "./reviewPresentationClient";
import type { ReviewPresentationOwner } from "./reviewSyncStore";

/** A Review item an old link names, as the server has it now. */
export type ReviewLinkItem = { startedAt: string | null; stoppedAt: string | null; open: boolean };

/**
 * The Review item an old link names (location v4 step 15; Codex r1 and r4 on #615): one owner-scoped read of the
 * Review presentation's lookup mode, which answers for any of the account's items, decided or open, and for one the
 * bootstrap's 100 open items leave out. `open` is whether it is still an open question (a block that ran into a trip
 * included: it opens on its block). Null when it is missing; a failed read fails.
 */
export async function lookupReviewLinkItem(owner: ReviewPresentationOwner, reviewItemId: string, timeZone: string, signal?: AbortSignal): Promise<ReviewLinkItem | null> {
  const page = await fetchReviewPresentationPage({
    owner,
    request: { version: REVIEW_PRESENTATION_VERSION, mode: "lookup", timeZone, reviewItemIds: [reviewItemId], limit: 1 },
    signal
  });
  const found = page.lookup.reviewItems.find((item) => item.reviewItemId === reviewItemId);
  if (!found || found.kind !== "review") return null;
  return { startedAt: found.interval.start ?? null, stoppedAt: found.interval.end ?? null, open: found.status === "open" };
}
