import { OUTING_KEY_PAYLOAD_KEY, OUTING_ROLE_PAYLOAD_KEY } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "./api";

// The Review screen has one owner for its items: the SQLite projection (the cache with local
// decisions applied) decides which moments are listed and in what order. A moment the latest
// bootstrap also returned, with the same proposal, is shown as that richer copy (its visit title and
// reason fields are never cached), so the same card never alternates between two shapes. A result
// identical to what is on screen keeps the same objects, so nothing re-renders (investigation
// 2026-10-12: the deck flipped 34 → 0 → 34 cards and the footnote between two reasons).

export function sameReviewProposal(left: MobileReviewItem, right: MobileReviewItem) {
  return left.id === right.id &&
    left.status === right.status &&
    left.title === right.title &&
    left.eventType === right.eventType &&
    left.suggestedStartedAt === right.suggestedStartedAt &&
    left.suggestedStoppedAt === right.suggestedStoppedAt &&
    left.suggestedCategoryId === right.suggestedCategoryId &&
    left.suggestedPlaceId === right.suggestedPlaceId &&
    left.confidence === right.confidence &&
    left.eventSource === right.eventSource &&
    left.categoryName === right.categoryName &&
    (left.categoryColor ?? null) === (right.categoryColor ?? null) &&
    (left.placeName ?? null) === (right.placeName ?? null);
}

function sameOwner(left: MobileBootstrap, right: MobileBootstrap) {
  return left.workspace.id === right.workspace.id && left.user.id === right.user.id;
}

function sameJson(left: unknown, right: unknown) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/**
 * `base` supplies everything but Review (entries, places, the live bootstrap or what is on screen);
 * `projection` is the cached Review projection; `live` holds the latest bootstrap's open items.
 * `current` is what the screen shows now, reused wherever nothing changed.
 */
export function projectReviewScreenData(input: {
  base: MobileBootstrap;
  projection: MobileBootstrap;
  live: ReadonlyMap<string, MobileReviewItem>;
  current: MobileBootstrap | null;
}): MobileBootstrap {
  const { base, projection, live, current } = input;
  if (!sameOwner(base, projection)) return projection;
  const previous = current && sameOwner(current, projection)
    ? new Map(current.reviewItems.map((item) => [item.id, item]))
    : new Map<string, MobileReviewItem>();
  const reviewItems = projection.reviewItems.map((cached) => {
    const liveItem = live.get(cached.id);
    // The live copy adds what is never cached (visit titles); fields only the store holds (a time-away
    // subtype from a presentation read) stay underneath, so the card keeps its kind.
    const merged = liveItem && sameReviewProposal(liveItem, cached)
      ? cached.rawPayload && Object.keys(cached.rawPayload).some((key) => !(key in (liveItem.rawPayload ?? {})))
        ? { ...liveItem, rawPayload: { ...cached.rawPayload, ...(liveItem.rawPayload ?? {}) } }
        : liveItem
      : cached;
    const chosen = merged === cached ? cached : withCachedOuting(merged, cached);
    const shown = previous.get(chosen.id);
    return shown && sameJson(shown, chosen) ? shown : chosen;
  });
  const stableItems = current && current.reviewItems.length === reviewItems.length &&
    current.reviewItems.every((item, index) => item === reviewItems[index])
    ? current.reviewItems
    : reviewItems;
  const categories = current && sameJson(current.categories, projection.categories) ? current.categories : projection.categories;
  const reviewCount = projection.stats?.reviewCount ?? projection.reviewItems.length;
  // The projection's count of cards has local decisions applied (an outing once, PR 12c).
  const reviewCardCount = projection.stats?.reviewCardCount;
  const next: MobileBootstrap = {
    ...base,
    workspace: projection.workspace,
    categories,
    reviewItems: stableItems,
    stats: base.stats
      ? { ...base.stats, reviewCount, ...(typeof reviewCardCount === "number" ? { reviewCardCount } : {}) }
      : projection.stats
  };
  if (
    current && current === base &&
    stableItems === current.reviewItems &&
    categories === current.categories &&
    sameJson(current.workspace, next.workspace) &&
    current.stats?.reviewCount === next.stats?.reviewCount &&
    current.stats?.reviewCardCount === next.stats?.reviewCardCount
  ) {
    return current;
  }
  return next;
}

/**
 * One card per outing (PRD D19): which outing a card is in comes from the store alone, which takes
 * each read as it lands (a presentation read after a replay clears or moves an outing an earlier
 * bootstrap gave), never from the live bootstrap copy (Codex r1 on #473).
 */
function withCachedOuting(item: MobileReviewItem, cached: MobileReviewItem): MobileReviewItem {
  const key = cached.rawPayload?.[OUTING_KEY_PAYLOAD_KEY];
  const role = cached.rawPayload?.[OUTING_ROLE_PAYLOAD_KEY];
  const payload = item.rawPayload ?? {};
  if (payload[OUTING_KEY_PAYLOAD_KEY] === key && payload[OUTING_ROLE_PAYLOAD_KEY] === role) return item;
  const { [OUTING_KEY_PAYLOAD_KEY]: _key, [OUTING_ROLE_PAYLOAD_KEY]: _role, ...rest } = payload;
  return {
    ...item,
    rawPayload: {
      ...rest,
      ...(key !== undefined ? { [OUTING_KEY_PAYLOAD_KEY]: key } : {}),
      ...(role !== undefined ? { [OUTING_ROLE_PAYLOAD_KEY]: role } : {})
    }
  };
}

export function liveReviewItems(bootstrap: MobileBootstrap) {
  return new Map(bootstrap.reviewItems.filter((item) => item.status === "open").map((item) => [item.id, item]));
}
