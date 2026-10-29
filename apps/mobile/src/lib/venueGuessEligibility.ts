import { visitedGuess } from "@dayframe/shared";
import type { MobileReviewItem } from "./api";
import { hasSuggestedTimeWindow, hasV2LocationEvidence, isLocationReviewItem } from "./review";

/**
 * Whether a "?" may take a guess from Apple Maps (card B part 2; PRD D23): an unnamed visit with its whole window,
 * not an outing and not a trip. A question already titled with a name (a learned or saved one, "Bread run?") never
 * takes one, so its name is never replaced. The one rule for the Calendar's own guess (`useCheckVenueGuess`) and the
 * place sheet's Nearby guess (Codex r5 on #620).
 */
export function venueGuessEligible(item: MobileReviewItem | null | undefined, outing: boolean) {
  return Boolean(item && !outing && isLocationReviewItem(item) && hasV2LocationEvidence(item) &&
    item.eventType !== "commute_detected" && hasSuggestedTimeWindow(item) && visitedGuess(item.title) == null);
}
