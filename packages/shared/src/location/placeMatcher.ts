import type { LocationEngineConfig } from "./config";
import { distanceMeters } from "./geo";
import type {
  LearnedPlaceForMatching,
  LocationMatchClass,
  PlaceMatch,
  PlaceMatchCandidate,
  SavedPlaceForMatching
} from "./types";

type MatchInput = {
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number | null;
  activePlaceId?: string | null;
  savedPlaceIdHint?: string | null;
};

function matchClass(distance: number, radius: number, allowance: number): LocationMatchClass {
  if (distance <= radius || distance + allowance <= radius + 25) return "strong";
  if (distance - allowance <= radius + 25) return "plausible";
  return "outside";
}

function classRank(value: LocationMatchClass) {
  return value === "strong" ? 0 : value === "plausible" ? 1 : 2;
}

export function matchLocationToPlaces(
  input: MatchInput,
  savedPlaces: SavedPlaceForMatching[],
  learnedPlaces: LearnedPlaceForMatching[],
  config: LocationEngineConfig
): PlaceMatch {
  const accuracyAllowance = Math.min(
    Math.max(0, input.horizontalAccuracyMeters ?? 0),
    config.maxAccuracyAllowanceMeters
  );
  const candidates: PlaceMatchCandidate[] = [
    ...savedPlaces.map((place) => ({ ...place, source: "saved" as const })),
    ...learnedPlaces.map((place) => ({ ...place, source: "learned" as const }))
  ].map((place) => {
    const distance = distanceMeters(input, place);
    return {
      id: place.id,
      source: place.source,
      matchClass: matchClass(distance, Math.max(20, place.radiusMeters), accuracyAllowance),
      distanceMeters: distance,
      radiusMeters: Math.max(20, place.radiusMeters),
      priority: (place.priority ?? 0) + (place.correctionScore ?? 0)
    };
  });

  candidates.sort((a, b) => {
    const classDifference = classRank(a.matchClass) - classRank(b.matchClass);
    if (classDifference !== 0) return classDifference;
    const hintA = a.id === input.savedPlaceIdHint ? 1 : 0;
    const hintB = b.id === input.savedPlaceIdHint ? 1 : 0;
    if (hintA !== hintB) return hintB - hintA;
    const activeA = a.id === input.activePlaceId && a.matchClass !== "outside" ? 1 : 0;
    const activeB = b.id === input.activePlaceId && b.matchClass !== "outside" ? 1 : 0;
    if (activeA !== activeB) return activeB - activeA;
    const normalisedDifference = a.distanceMeters / a.radiusMeters - b.distanceMeters / b.radiusMeters;
    if (Math.abs(normalisedDifference) > 0.05) return normalisedDifference;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.source !== b.source) return a.source === "saved" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const plausible = candidates.filter((candidate) => candidate.matchClass !== "outside");
  if (plausible.length === 0) return { kind: "unknown", placeId: null, candidates };

  const top = plausible[0];
  const second = plausible[1];
  const similarlyPlausible =
    second &&
    top.matchClass === second.matchClass &&
    Math.abs(top.distanceMeters / top.radiusMeters - second.distanceMeters / second.radiusMeters) <= 0.12 &&
    Math.abs(top.priority - second.priority) < 3 &&
    top.source === "saved" &&
    second.source === "saved" &&
    input.savedPlaceIdHint !== top.id &&
    input.savedPlaceIdHint !== second.id;
  if (similarlyPlausible) {
    return { kind: "ambiguous", placeId: null, candidates: plausible.slice(0, 4) };
  }

  return {
    kind: top.source,
    placeId: top.id,
    candidates: plausible.slice(0, 4)
  };
}
