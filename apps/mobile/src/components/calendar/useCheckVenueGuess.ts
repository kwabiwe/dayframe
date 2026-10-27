import { useEffect, useState } from "react";
import { visitedGuess } from "@dayframe/shared";
import type { MobileReviewItem } from "../../lib/api";
import { readLocationReviewEvidence } from "../../lib/locationReviewEvidenceCache";
import {
  createNativeNearbyPointOfInterestProvider,
  NearbyPointOfInterestController,
  venueStayFromEvidence
} from "../../lib/placeSearch";
import { hasSuggestedTimeWindow, hasV2LocationEvidence, isLocationReviewItem } from "../../lib/review";
import type { ReviewAnswerVenue } from "../../lib/reviewAnswer";

/**
 * Card B part 2 (owner feedback, 25 Oct 2026): the best guess for an unnamed visit's "?" when it opens in
 * Calendar › List. A saved or named place is already the server's guess ("Visited Office?"); with none, the
 * iPhone asks Apple Maps what is nearby (the editor's Nearby search, foreground only) and the venue ranker
 * picks a place only when it is confident (design §6.3). Searched only for the question that is open, once
 * per suggestion (kept for this run of the app), and cancelled when it closes. Coordinates go only to Apple;
 * nothing is sent to Dayframe until Yes, which records the place's name and Place ID once.
 */

type Owner = { userId: string; workspaceId: string };
const guesses = new Map<string, ReviewAnswerVenue | null>();

/** The street from Apple's address line ("12 High Street, Town, AB1 2CD" → "12 High Street"). */
export function streetOf(subtitle: string | null | undefined) {
  const street = subtitle?.split(",")[0]?.trim();
  return street ? street : null;
}

/** Whether a question can take a guess from Apple Maps: an unnamed visit with its whole window, not an outing. */
export function venueGuessEligible(item: MobileReviewItem | null | undefined, outing: boolean) {
  return Boolean(item && !outing && isLocationReviewItem(item) && hasV2LocationEvidence(item) &&
    item.eventType !== "commute_detected" && hasSuggestedTimeWindow(item) && visitedGuess(item.title) == null);
}

export function useCheckVenueGuess({ item, outing, owner }: { item: MobileReviewItem | null; outing: boolean; owner: Owner | null }) {
  const eligible = venueGuessEligible(item, outing);
  const key = eligible && item && owner ? `${owner.workspaceId}:${owner.userId}:${item.id}` : null;
  const [found, setFound] = useState<{ key: string; venue: ReviewAnswerVenue | null } | null>(null);
  const itemId = item?.id ?? null;
  const userId = owner?.userId ?? null;
  const workspaceId = owner?.workspaceId ?? null;

  useEffect(() => {
    if (!key || !itemId || !userId || !workspaceId || guesses.has(key)) return;
    const controller = new AbortController();
    let nearby: NearbyPointOfInterestController | null = null;
    const finish = (venue: ReviewAnswerVenue | null, keep: boolean) => {
      if (controller.signal.aborted) return;
      // An answer from Apple (a place or none) is kept; a failed search is tried again next time it opens.
      if (keep) guesses.set(key, venue);
      setFound({ key, venue });
    };
    void (async () => {
      try {
        const { evidence } = await readLocationReviewEvidence({ reviewItemId: itemId, userId, workspaceId, signal: controller.signal });
        const centre = evidence.map.centre;
        const provider = createNativeNearbyPointOfInterestProvider();
        if (controller.signal.aborted) return;
        if (evidence.segment.kind !== "stay" || !centre || !provider) {
          finish(null, true);
          return;
        }
        nearby = new NearbyPointOfInterestController(provider, (state) => {
          if (state.status === "error") finish(null, false);
          if (state.status !== "results" && state.status !== "no-results") return;
          const pick = state.places.find((place) => place.suggested);
          finish(pick ? { name: pick.title.trim(), street: streetOf(pick.subtitle), applePlaceId: pick.placeId ?? null } : null, true);
        }, () => [], () => venueStayFromEvidence(evidence));
        await nearby.load({ latitude: centre.coordinates[1], longitude: centre.coordinates[0] });
      } catch {
        finish(null, false);
      }
    })();
    return () => {
      controller.abort();
      nearby?.dispose();
    };
  }, [key, itemId, userId, workspaceId]);

  if (!key) return { venue: null, searching: false };
  if (guesses.has(key)) return { venue: guesses.get(key) ?? null, searching: false };
  if (found?.key === key) return { venue: found.venue, searching: false };
  return { venue: null, searching: true };
}

export function __resetCheckVenueGuessesForTests() {
  guesses.clear();
}
