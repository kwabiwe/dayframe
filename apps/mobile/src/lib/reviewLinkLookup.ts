import { REVIEW_PRESENTATION_VERSION } from "@dayframe/shared";
import { fetchReviewPresentationPage } from "./reviewPresentationClient";
import type { ReviewPresentationOwner } from "./reviewSyncStore";

/**
 * When the Review item an old link names starts (location v4 step 15; Codex r1 on #615): one owner-scoped read of the
 * Review presentation's lookup mode, which answers for any of the account's items, decided or open, and for one the
 * bootstrap's 100 open items leave out. Null when it is missing, has no start, or the read fails.
 */
export async function lookupReviewItemStart(owner: ReviewPresentationOwner, reviewItemId: string, timeZone: string, signal?: AbortSignal) {
  const page = await fetchReviewPresentationPage({
    owner,
    request: { version: REVIEW_PRESENTATION_VERSION, mode: "lookup", timeZone, reviewItemIds: [reviewItemId], limit: 1 },
    signal
  });
  const found = page.lookup.reviewItems.find((item) => item.reviewItemId === reviewItemId);
  return found && found.kind === "review" ? found.interval.start ?? null : null;
}
