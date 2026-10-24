// One claim per suggestion while its answer is being saved, across every surface that answers (the Review
// deck and Calendar › List, location v4 step 14 part 3b): a suggestion one of them is saving is never also
// saved by the other, so the outbox never gets two decisions for it. A held answer is saved in one order on
// both surfaces: claim its suggestions, read the outbox for them (`reviewAnswerStillOpen`), check again and
// write, so a save on the other surface can neither start during the read nor finish unseen before it (a
// surface lets its claim go only once its own write is in the outbox) (Codex r6 on #582).
import type { MobileBootstrap } from "./api";
import { reviewItemIdsDecidedLocally, reviewItemsDecidedLocally } from "./reviewSyncStore";

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
 * The one check both surfaces make, holding the claim, before saving an answer for `ids` (`bootstrap` with
 * any remembered copies added): true while this phone has decided none of them (Codex r2 and r6 on #582).
 */
export async function reviewAnswerStillOpen(bootstrap: MobileBootstrap, ids: readonly string[]) {
  if (!ids.length) return true;
  return !(await reviewItemsDecidedLocally(bootstrap, ids));
}

/**
 * The same read for a batch (the deck's "Skip all"), holding the claims: which of `ids` this phone has
 * already decided, so the batch treats them as resolved (Codex r7 on #582).
 */
export async function reviewAnswersDecided(bootstrap: MobileBootstrap, ids: readonly string[]): Promise<ReadonlySet<string>> {
  if (!ids.length) return new Set();
  return reviewItemIdsDecidedLocally(bootstrap, ids);
}
