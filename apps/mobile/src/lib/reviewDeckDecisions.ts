import type { LocationReviewAction } from "@dayframe/shared";

// Blocks parity step 5a (D7): Edit before logging opens Location evidence, which decides the item
// itself. The deck counts that decision ("N of M", "All framed") from this in-memory hand-off,
// drained when Review regains focus. It never changes what is saved: the outbox owns that.

export type ReviewDeckDecision = { itemId: string; logged: boolean };

const pending: ReviewDeckDecision[] = [];

/** Whether an evidence action decides the item: logged, skipped, or neither (null). */
export function reviewDeckDecisionForAction(action: LocationReviewAction["action"]): boolean | null {
  // Classified by outcome so a new "…_and_confirm" or "record_…" action counts without a change here.
  const name: string = action;
  if (name === "accept" || name === "confirm" || name.endsWith("_and_confirm") || name.startsWith("record_")) return true;
  if (name.startsWith("ignore") || name === "always_ignore_source") return false;
  return null;
}

// Only a Review deck that is open beneath Location evidence collects decisions; evidence opened
// from Today's ribbon must not count toward a later deck visit.
let activeDeckVisits = 0;

/** The deck registers while it is mounted; anything left from before it opened is discarded. */
export function beginReviewDeckVisit() {
  activeDeckVisits += 1;
  if (activeDeckVisits === 1) pending.splice(0, pending.length);
  return () => {
    activeDeckVisits = Math.max(0, activeDeckVisits - 1);
    if (activeDeckVisits === 0) pending.splice(0, pending.length);
  };
}

export function recordReviewDeckEvidenceDecision(itemId: string, action: LocationReviewAction["action"]) {
  if (activeDeckVisits === 0) return;
  const logged = reviewDeckDecisionForAction(action);
  if (logged === null) return;
  pending.push({ itemId, logged });
}

export function takeReviewDeckEvidenceDecisions(): ReviewDeckDecision[] {
  return pending.splice(0, pending.length);
}
