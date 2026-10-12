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
export function scopedOpenReviewItems(
  snapshot: ReviewPresentationStoreSnapshot | null,
  /** Items the store already suppresses (hidden by a local decision, or terminal in a newer read). */
  suppressed: ReadonlySet<string> = new Set()
): MobileReviewItem[] {
  if (!snapshot) return [];
  const decided = new Set([
    ...snapshot.effects.filter((effect) => effect.localEffect === "hidden").map((effect) => effect.reviewItemId),
    ...suppressed
  ]);
  // The snapshot's own linkage (links, and older needs-review entries naming their suggestion), so
  // a suggestion and the entry created from it still draw once (as the bootstrap's linkedEntryIds).
  const linked = new Map<string, Set<string>>();
  const link = (reviewItemId: string, entryId: string) => {
    const set = linked.get(reviewItemId) ?? new Set<string>();
    set.add(entryId);
    linked.set(reviewItemId, set);
  };
  for (const entry of snapshot.response.links ?? []) for (const entryId of entry.entryIds) link(entry.reviewItemId, entryId);
  for (const record of snapshot.response.records) {
    if (record.kind === "legacy_review_entry" && record.linkedReviewItemId) link(record.linkedReviewItemId, record.entryId);
  }
  const byId = new Map<string, MobileReviewItem>();
  for (const record of [...snapshot.response.records, ...snapshot.response.lookup.reviewItems]) {
    if (record.kind !== "review" || record.status !== "open" || decided.has(record.reviewItemId)) continue;
    const entryIds = [...(linked.get(record.reviewItemId) ?? []), ...record.canonicalEntryIds];
    byId.set(record.reviewItemId, {
      ...mobileReviewItemFromPresentation(record),
      ...(entryIds.length ? { linkedEntryIds: [...new Set(entryIds)] } : {})
    });
  }
  return [...byId.values()];
}

/**
 * Whether the bootstrap's open list may be missing items: it reached its cap, or the server's open
 * count says there are more than it lists (a cached bootstrap with items decided here offline is
 * shorter than the cap but still incomplete).
 */
export function bootstrapReviewListMayBeIncomplete(bootstrap: { reviewItems?: readonly unknown[]; stats?: { reviewCount?: number } } | null) {
  if (!bootstrap) return false;
  const listed = bootstrap.reviewItems?.length ?? 0;
  return listed >= BOOTSTRAP_REVIEW_ITEM_CAP || (bootstrap.stats?.reviewCount ?? 0) > listed;
}

/** Today's Review window spans this many days before today (windowScopeFor). */
export const REVIEW_WINDOW_DAYS_BEFORE = 59;

/**
 * The newest cached Review window for this owner that still overlaps today's: today's, else the
 * newest earlier one. After midnight, or days offline or in the background, Today may not have
 * cached a new window yet; an earlier 60-day window still covers the older days the Calendar shows,
 * so the Calendar keeps its suggestions meanwhile. Each try is one indexed read, and earlier tries
 * happen only while the newer windows are missing.
 */
export async function newestCachedReviewWindow<T>(
  dayKey: string,
  read: (dayKey: string) => Promise<T | null>,
  daysBack = REVIEW_WINDOW_DAYS_BEFORE
): Promise<T | null> {
  const [year, month, day] = dayKey.split("-").map(Number);
  for (let back = 0; back <= daysBack; back += 1) {
    const date = new Date(year, month - 1, day - back);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const snapshot = await read(key);
    if (snapshot) return snapshot;
  }
  return null;
}

/** The bootstrap's items, plus scoped ones it lacks while it may be incomplete (the bootstrap wins). */
export function calendarReviewItems(
  bootstrapItems: readonly MobileReviewItem[],
  scoped: readonly MobileReviewItem[],
  mayBeIncomplete = bootstrapItems.length >= BOOTSTRAP_REVIEW_ITEM_CAP
): MobileReviewItem[] {
  if (!mayBeIncomplete || !scoped.length) return [...bootstrapItems];
  const known = new Set(bootstrapItems.map((item) => item.id));
  return [...bootstrapItems, ...scoped.filter((item) => !known.has(item.id))];
}
