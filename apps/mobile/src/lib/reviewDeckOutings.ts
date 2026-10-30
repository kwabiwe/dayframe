// One Review card per outing on iPhone (location v3 PR 12b, PRD D19): an unknown Stay's card and
// the Move cards either side of it are one deck card, decided together with one durable outbox row
// (`confirm_outing` / `ignore_outing`, sent on the Stay's card). Web Review groups the same way
// (shared `groupOutings`).
import { groupOutings, outingKeyOf, outingTravelWords, type CardOuting, type ReviewMutation } from "@dayframe/shared";
import type { MobileReviewItem } from "./api";
import { formatReviewDeckDuration } from "./reviewDeck";
import { reviewItemDurationSeconds } from "./review";

export type ReviewDeckOuting = CardOuting<MobileReviewItem>;

/**
 * The deck's outings among the open cards. `eligible` keeps a card out of every outing: one whose
 * own change is waiting or needs attention (its badge and Retry stay on its own card), one without
 * a complete window (it cannot be decided), or one that is no location card.
 */
export function reviewDeckOutings(items: readonly MobileReviewItem[], eligible: (item: MobileReviewItem) => boolean) {
  const outings = groupOutings(items, eligible);
  const anchorByMember = new Map<string, string>();
  for (const [anchorId, outing] of outings) {
    for (const member of outing.members) anchorByMember.set(member.id, anchorId);
  }
  return { outings, anchorByMember };
}

/** The card's travel line under its time: "Drives there and back · 11m". */
export function reviewDeckOutingLine(outing: ReviewDeckOuting, now: number) {
  const seconds = outingTravelSeconds(outing, now);
  return `${outingTravelWords(outing.members)}${seconds >= 60 ? ` · ${formatReviewDeckDuration(seconds)}` : ""}`;
}

/** The Moves' time, which a logged outing adds to the day with its Stay. */
export function outingTravelSeconds(outing: Pick<ReviewDeckOuting, "members">, now: number) {
  return outing.members.reduce((sum, member) => sum + reviewItemDurationSeconds(member, now), 0);
}

/** Log it / Skip on the grouped card: every part together; "Log as" and a guessed venue apply to the Stay (#642). */
export function reviewDeckOutingMutation(
  memberReviewItemIds: readonly string[],
  logged: boolean,
  edit: Extract<ReviewMutation, { memberReviewItemIds: string[] }>["edit"] | null,
  venue: { name: string; applePlaceId: string } | null = null
): ReviewMutation {
  if (!logged) return { action: "ignore_outing", memberReviewItemIds: [...memberReviewItemIds] };
  return { action: "confirm_outing", memberReviewItemIds: [...memberReviewItemIds], ...(edit ? { edit } : {}), ...(venue ? { venue } : {}) };
}

export type HeldOutingMember = { key: string; itemId: string; proposal: string };

/**
 * Whether a held outing is still what the person decided when its hold ends: every Move still open,
 * unchanged (`signature`) and still in the Stay's outing. Anything else saves nothing and brings the
 * cards back to be reviewed again, as a single changed card does.
 */
export function heldOutingStillSame(
  members: readonly HeldOutingMember[],
  outingKey: string | null,
  openItem: (itemId: string) => MobileReviewItem | undefined,
  signature: (item: MobileReviewItem) => string
) {
  if (!outingKey) return null;
  const items: MobileReviewItem[] = [];
  for (const member of members) {
    const item = openItem(member.itemId);
    if (!item || signature(item) !== member.proposal || outingKeyOf(item) !== outingKey) return null;
    items.push(item);
  }
  return items;
}

/**
 * A focus placed on a Move before its outing was known (cached data without the outing, or without
 * its Stay) follows the Move into its outing's card when the grouping arrives: the segment to move
 * to, or null (Codex r2 on #473). Only while the person is still in the segment the focus opened.
 */
export function outingFocusSegment<Segment extends string>(input: {
  placed: { itemId: string; segment: Segment } | null;
  currentSegment: Segment;
  anchorByMember: ReadonlyMap<string, string>;
  openItems: readonly MobileReviewItem[];
  segmentFor: (item: MobileReviewItem) => Segment;
}): Segment | null {
  const { placed } = input;
  if (!placed || input.currentSegment !== placed.segment) return null;
  const anchorId = input.anchorByMember.get(placed.itemId);
  const anchor = anchorId ? input.openItems.find((item) => item.id === anchorId) : undefined;
  if (!anchor) return null;
  const segment = input.segmentFor(anchor);
  return segment === placed.segment ? null : segment;
}
