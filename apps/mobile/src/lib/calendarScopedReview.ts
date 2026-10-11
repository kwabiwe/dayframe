import type { MobileReviewItem } from "./api";
import { mobileReviewItemFromPresentation, type ReviewPresentationStoreSnapshot } from "./reviewSyncStore";

/** The bootstrap's open Review list is the newest 100; at that size it may be missing older days. */
export const BOOTSTRAP_REVIEW_ITEM_CAP = 100;

/**
 * Open suggestions from Today's scoped Review snapshot (the cached 60-day window with its own
 * completeness and paging), less any this iPhone has already decided. The Calendar adds them to
 * the bootstrap's list only when that list reached its cap, so a burst of newer suggestions never
 * hides a recent day's Review block (UIA-060).
 */
export function scopedOpenReviewItems(snapshot: ReviewPresentationStoreSnapshot | null): MobileReviewItem[] {
  if (!snapshot) return [];
  const decided = new Set(
    snapshot.effects.filter((effect) => effect.localEffect === "hidden").map((effect) => effect.reviewItemId)
  );
  const byId = new Map<string, MobileReviewItem>();
  for (const record of [...snapshot.response.records, ...snapshot.response.lookup.reviewItems]) {
    if (record.kind !== "review" || record.status !== "open" || decided.has(record.reviewItemId)) continue;
    byId.set(record.reviewItemId, mobileReviewItemFromPresentation(record));
  }
  return [...byId.values()];
}

/** The bootstrap's items, plus scoped ones it lacks once it hit its cap (the bootstrap wins). */
export function calendarReviewItems(
  bootstrapItems: readonly MobileReviewItem[],
  scoped: readonly MobileReviewItem[]
): MobileReviewItem[] {
  if (bootstrapItems.length < BOOTSTRAP_REVIEW_ITEM_CAP || !scoped.length) return [...bootstrapItems];
  const known = new Set(bootstrapItems.map((item) => item.id));
  return [...bootstrapItems, ...scoped.filter((item) => !known.has(item.id))];
}
