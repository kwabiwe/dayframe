// One claim per suggestion while its answer is being saved, across every surface that answers (the Review
// deck and Calendar › List, location v4 step 14 part 3b): a suggestion one of them is saving is never also
// saved by the other, so the outbox never gets two decisions for it. A claim covers the save itself; an
// answer held for Undo on one surface while the other decides the same suggestion is caught when it is
// saved: a listed suggestion has left its surface's open list, and a copy remembered for one a refresh left
// out is saved only when this phone has not decided it meanwhile (`rememberedReviewAnswerStillOpen`).
import type { MobileBootstrap } from "./api";
import { reviewItemsDecidedLocally } from "./reviewSyncStore";

const claimed = new Map<string, number>();

/** Claims every id, or none when any is already claimed. */
export function claimReviewAnswer(ids: readonly string[]) {
  if (ids.some((id) => claimed.has(id))) return false;
  for (const id of ids) claimed.set(id, 1);
  return true;
}

export function releaseReviewAnswer(ids: readonly string[]) {
  for (const id of ids) claimed.delete(id);
}

export function isReviewAnswerClaimed(id: string) {
  return claimed.has(id);
}

/**
 * The one check both surfaces make before saving remembered copies (`ids`, those a refresh left out of
 * `bootstrap`): true while this phone has decided none of them (Codex r2 on #582).
 */
export async function rememberedReviewAnswerStillOpen(bootstrap: MobileBootstrap, ids: readonly string[]) {
  if (!ids.length) return true;
  return !(await reviewItemsDecidedLocally(bootstrap, ids));
}
