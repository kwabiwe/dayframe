import type { LocationReviewAction } from "@dayframe/shared";

// Blocks parity step 5a (D7): Edit before logging opens Location evidence, which decides the item
// itself. The deck counts that decision ("N of M", "All framed") from this in-memory hand-off,
// drained when Review regains focus. It never changes what is saved: the outbox owns that.

export type ReviewDeckDecision = { itemId: string; logged: boolean };

const pending: ReviewDeckDecision[] = [];

/** Whether an evidence action decides the item: logged, skipped, or neither (null). */
export function reviewDeckDecisionForAction(action: LocationReviewAction["action"]): boolean | null {
  switch (action) {
    case "confirm":
    case "merge_and_confirm":
    case "record_once":
    case "record_poi_once":
    case "save_place_and_confirm":
    case "split_and_confirm":
      return true;
    case "ignore":
    case "ignore_once":
    case "ignore_once_location":
      return false;
    default:
      return null;
  }
}

export function recordReviewDeckEvidenceDecision(itemId: string, action: LocationReviewAction["action"]) {
  const logged = reviewDeckDecisionForAction(action);
  if (logged === null) return;
  pending.push({ itemId, logged });
}

export function takeReviewDeckEvidenceDecisions(): ReviewDeckDecision[] {
  return pending.splice(0, pending.length);
}
