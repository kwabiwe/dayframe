// One claim per suggestion while its answer is being saved, across every surface that answers (the Review
// deck and Calendar › List, location v4 step 14 part 3b): a suggestion one of them is saving is never also
// saved by the other, so the outbox never gets two decisions for it.

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
