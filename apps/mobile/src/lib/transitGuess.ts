import { distanceMeters, type LocationReviewEvidenceDto } from "@dayframe/shared";
import {
  NEARBY_POI_CANDIDATE_LIMIT,
  NEARBY_POI_RADIUS_METERS,
  rankedNearbyPlaces,
  type NearbyPointOfInterestProvider,
  type PlaceSearchCoordinate
} from "./placeSearch";

// Transit, a best guess only (location v3, owner decision 21 Oct 2026, option A): Core Motion reads
// trains and buses as driving, and the server keeps no Apple categories, so the iPhone checks a
// vehicle Move's two ends against Apple's places while Location evidence is open. When both ends
// are stations, the editor says "Looks like public transport" and offers a chip; nothing changes
// until the person taps it, and nothing is stored but what they then record.

/** A station counts only this close to the trip's end (its platforms, not the street outside). */
export const TRANSIT_STATION_RADIUS_METERS = 150;
/** Shorter trips are not checked: a train between stations under this is unlikely. */
export const TRANSIT_MINIMUM_TRIP_METERS = 500;

type Point = { latitude: number; longitude: number };

/**
 * The two ends of a vehicle Move worth checking, or null: a journey (not time away) driven or of
 * unknown mode, from its route's first and last points (else the straight line between its stays),
 * at least TRANSIT_MINIMUM_TRIP_METERS apart.
 */
export function transitGuessEndpoints(
  evidence: Pick<LocationReviewEvidenceDto, "segment" | "map">
): { start: Point; end: Point } | null {
  const { segment, map } = evidence;
  if (segment.kind !== "commute" || segment.timeAway) return null;
  if (segment.travelMode && segment.travelMode !== "automotive") return null;
  const line = map.route?.coordinates ?? map.straightLineFallback?.coordinates ?? null;
  if (!line || line.length < 2) return null;
  const [first, last] = [line[0], line[line.length - 1]];
  const start = { latitude: first[1], longitude: first[0] };
  const end = { latitude: last[1], longitude: last[0] };
  if (![start.latitude, start.longitude, end.latitude, end.longitude].every(Number.isFinite)) return null;
  return distanceMeters(start, end) >= TRANSIT_MINIMUM_TRIP_METERS ? { start, end } : null;
}

/** The station the trip most likely started or ended at: the best-ranked station within reach. */
async function stationNear(provider: NearbyPointOfInterestProvider, point: PlaceSearchCoordinate, requestId: string) {
  const result = await provider.search({
    requestId,
    latitude: point.latitude,
    longitude: point.longitude,
    radiusMeters: NEARBY_POI_RADIUS_METERS,
    limit: NEARBY_POI_CANDIDATE_LIMIT
  });
  if (result.requestId !== requestId) return null;
  const ranked = rankedNearbyPlaces(
    result.places.filter((place) => place.requestId === requestId),
    Array.isArray(result.areasOfInterest) ? result.areasOfInterest : []
  );
  return ranked.find((place) => place.kind === "station" && place.distanceMeters <= TRANSIT_STATION_RADIUS_METERS)?.title ?? null;
}

let transitRequestCounter = 0;

/**
 * Checks both ends, one search at a time (the native search serves one at a time); stops after the
 * first end when it is no station. Null when either end isn't one, or when `isCurrent` turns false.
 */
export async function guessTransit(
  provider: NearbyPointOfInterestProvider,
  endpoints: { start: Point; end: Point },
  isCurrent: () => boolean
): Promise<{ from: string; to: string } | null> {
  const from = await stationNear(provider, endpoints.start, `transit-${++transitRequestCounter}`);
  if (!from || !isCurrent()) return null;
  const to = await stationNear(provider, endpoints.end, `transit-${++transitRequestCounter}`);
  if (!to || !isCurrent()) return null;
  return { from, to };
}

/** "Looks like public transport · Exampleton Station → Kelp Station". */
export function transitGuessLine(guess: { from: string; to: string }) {
  return `Looks like public transport · ${guess.from} → ${guess.to}`;
}

/** The name the chip fills in, logged under the "Getting around" activity (owner, 21 Oct 2026). */
export const TRANSIT_NAME = "Public transport";
