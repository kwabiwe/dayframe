import { outingRoleOf, visitedGuess } from "@dayframe/shared";
import type { MobileReviewItem } from "./api";
import { hasSuggestedTimeWindow, hasV2LocationEvidence, isLocationReviewItem } from "./review";

/**
 * Whether a "?" may take a guess from Apple Maps (card B part 2; PRD D23): an unnamed visit with its whole window,
 * an outing's stay included (`confirm_outing` keeps its venue since #642), never a trip or an outing's Move. A question already titled with a name (a learned or saved one, "Bread run?") never
 * takes one, so its name is never replaced. The one rule for the Calendar's own guess (`useCheckVenueGuess`) and the
 * place sheet's Nearby guess (Codex r5 on #620).
 */
export function venueGuessEligible(item: MobileReviewItem | null | undefined) {
  const role = item ? outingRoleOf(item) : null;
  return Boolean(item && (role === null || role === "stay") && isLocationReviewItem(item) && hasV2LocationEvidence(item) &&
    item.eventType !== "commute_detected" && hasSuggestedTimeWindow(item) && visitedGuess(item.title) == null);
}

/**
 * The guess an answer can really keep: `confirm_outing` needs the venue's Apple Place ID, so an outing's stay never
 * offers a guess without one (no "Visited X?"; it asks "Where were you?" as any unguessed visit does).
 */
export function keepableVenue<T extends { applePlaceId: string | null }>(venue: T | null | undefined, outing: boolean): T | null {
  return venue && (!outing || venue.applePlaceId) ? venue : null;
}
