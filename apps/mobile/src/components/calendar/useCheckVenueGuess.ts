import { useCallback, useEffect, useRef, useState } from "react";
import { visitedGuess } from "@dayframe/shared";
import type { MobileReviewItem } from "../../lib/api";
import { useAppForeground } from "../../lib/appForeground";
import { revalidateLocationReviewEvidence } from "../../lib/locationReviewEvidenceCache";
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
 * picks a place when it is confident (design §6.3), or, failing that, its top destination within 50 m (PRD D23). Searched only for the question that is open, while
 * the app is in front and the Calendar is on screen, once per version of the suggestion (kept for this run of
 * the app), and cancelled when it closes. Coordinates go only to Apple; nothing is sent to Dayframe until Yes,
 * which records the place's name and Place ID once.
 */

type Owner = { userId: string; workspaceId: string };
// The guesses for the account signed in, oldest first; bounded, and emptied when the account changes (Codex
// r1 on #600).
const guesses = new Map<string, ReviewAnswerVenue | null>();
const GUESSES_KEPT = 50;
let guessesOwnerKey: string | null = null;

function keepGuess(key: string, venue: ReviewAnswerVenue | null) {
  guesses.delete(key);
  guesses.set(key, venue);
  while (guesses.size > GUESSES_KEPT) guesses.delete(guesses.keys().next().value!);
}


/** Forgets every guess unless they are this account's. */
function guessesFor(ownerKey: string | null) {
  if (ownerKey === guessesOwnerKey) return;
  guesses.clear();
  guessesOwnerKey = ownerKey;
}

/**
 * The version of the suggestion a guess describes: a replay moves an open suggestion's window or segment in
 * place, and the guess for the old one must not answer the new one (Codex r1 on #600).
 */
function proposalOf(item: MobileReviewItem) {
  const segmentId = typeof item.rawPayload?.clientSegmentId === "string" ? item.rawPayload.clientSegmentId : "";
  return `${segmentId}|${item.suggestedStartedAt ?? ""}|${item.suggestedStoppedAt ?? ""}`;
}

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

/**
 * `release` stops the search at once and holds it until the Calendar is back on screen: the editor's Nearby
 * search uses the same native search, so the question gives it up before the editor opens (Codex r1 on #600).
 */
export function useCheckVenueGuess({ item, outing, owner, onScreen = true }: {
  item: MobileReviewItem | null;
  outing: boolean;
  owner: Owner | null;
  /** Whether the Calendar is the screen in front. */
  onScreen?: boolean;
}) {
  const ownerKey = owner ? `${owner.workspaceId}:${owner.userId}` : null;
  guessesFor(ownerKey);
  const inFront = useAppForeground();
  const eligible = venueGuessEligible(item, outing);
  const proposal = item ? proposalOf(item) : "";
  const key = eligible && item && ownerKey ? `${ownerKey}:${item.id}:${proposal}` : null;
  const [found, setFound] = useState<{ key: string; venue: ReviewAnswerVenue | null } | null>(null);
  // The question given up for the editor, until the Calendar leaves the screen.
  const [heldKey, setHeldKey] = useState<string | null>(null);
  if (heldKey && !onScreen) setHeldKey(null);
  const held = heldKey != null && heldKey === key;
  const stop = useRef<(() => void) | null>(null);
  const searchable = key != null && inFront && onScreen && !held;
  const itemId = item?.id ?? null;
  const userId = owner?.userId ?? null;
  const workspaceId = owner?.workspaceId ?? null;
  const startedAt = item?.suggestedStartedAt ?? null;
  const stoppedAt = item?.suggestedStoppedAt ?? null;

  useEffect(() => {
    if (!searchable || !key || !itemId || !userId || !workspaceId || guesses.has(key)) return;
    const controller = new AbortController();
    let nearby: NearbyPointOfInterestController | null = null;
    let settled = false;
    const finish = (venue: ReviewAnswerVenue | null, keep: boolean) => {
      if (controller.signal.aborted || settled) return;
      settled = true;
      // An answer from Apple (a place or none) is kept; a failed search is tried again next time it opens.
      if (keep) keepGuess(key, venue);
      setFound({ key, venue });
    };
    void (async () => {
      try {
        // The evidence is read from the server, never from what the phone kept, and never by joining a read
        // begun earlier: the phone cannot tell which version of the suggestion kept evidence describes (a
        // replay can move its window or its segment), and the guess is searched once per version. Evidence
        // whose times are not the question's gives no guess (Codex r1–r3 on #600).
        const { evidence } = await revalidateLocationReviewEvidence(
          { reviewItemId: itemId, userId, workspaceId, signal: controller.signal }, { fresh: true });
        if (controller.signal.aborted) return;
        if (Date.parse(evidence.segment.startedAt) !== Date.parse(startedAt ?? "") ||
          Date.parse(evidence.segment.stoppedAt ?? "") !== Date.parse(stoppedAt ?? "")) {
          finish(null, false);
          return;
        }
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
          // The strict suggestion, else the near guess (PRD D23): a destination within 50 m of the visit.
          const pick = state.places.find((place) => place.suggested) ?? state.places.find((place) => place.guessed);
          finish(pick ? { name: pick.title.trim(), street: streetOf(pick.subtitle), applePlaceId: pick.placeId ?? null } : null, true);
        }, () => [], () => venueStayFromEvidence(evidence));
        await nearby.load({ latitude: centre.coordinates[1], longitude: centre.coordinates[0] });
        // Another search took the native search over (it is cancelled without a word): no guess this time,
        // and it is tried again when the question is next searched for (Codex r1 on #600).
        finish(null, false);
      } catch {
        finish(null, false);
      }
    })();
    const end = () => {
      controller.abort();
      nearby?.dispose();
    };
    stop.current = end;
    return () => {
      if (stop.current === end) stop.current = null;
      end();
    };
  }, [searchable, key, itemId, userId, workspaceId, startedAt, stoppedAt, proposal]);

  const release = useCallback(() => {
    stop.current?.();
    stop.current = null;
    setHeldKey(key);
  }, [key]);

  if (!key) return { venue: null, searching: false, release };
  if (guesses.has(key)) return { venue: guesses.get(key) ?? null, searching: false, release };
  if (found?.key === key) return { venue: found.venue, searching: false, release };
  return { venue: null, searching: searchable, release };
}

export function __resetCheckVenueGuessesForTests() {
  guesses.clear();
  guessesOwnerKey = null;
}
