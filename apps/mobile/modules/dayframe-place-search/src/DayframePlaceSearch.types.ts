export type PlaceSearchBias = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type PlaceSearchSuggestion = {
  id: string;
  requestId: string;
  title: string;
  subtitle: string | null;
};

export type PlaceSearchSuggestionsResult = {
  requestId: string;
  suggestions: PlaceSearchSuggestion[];
};

export type PlaceSearchErrorResult = {
  requestId: string;
  code: "search_unavailable" | "network_unavailable";
};

export type ResolvedPlaceSearchResult = {
  suggestionId: string;
  title: string;
  subtitle: string | null;
  name: string | null;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
};

export type PlaceSearchQuery = {
  requestId: string;
  query: string;
  bias: PlaceSearchBias | null;
};

export type PlaceSearchResolutionRequest = {
  suggestionId: string;
  requestId: string;
};

export type NearbyPointOfInterestQuery = {
  requestId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** At most this many places (the native side caps it at 8). */
  limit: number;
};

/**
 * One nearby point of interest as it crosses the bridge: an opaque id for this generation, the
 * title, an address line, the rounded distance and its kind of place (Apple's category without its
 * prefix, e.g. "FitnessCenter"; absent from older native builds). The coordinate stays native until
 * the place is picked (`resolveNearby`).
 */
export type NearbyPointOfInterest = {
  id: string;
  requestId: string;
  title: string;
  subtitle: string | null;
  distanceMeters: number;
  category?: string | null;
};

export type NearbyPointOfInterestResult = {
  requestId: string;
  places: NearbyPointOfInterest[];
};

export type NearbyPointOfInterestResolutionRequest = {
  id: string;
  requestId: string;
};

/** What the MapKit checks found: counts, distances, kinds and yes/no only (no names or points). */
export type MapKitProbeReport = {
  osVersion: string;
  radii: { radiusMeters: number; count: number; farthestMeters: number | null; error: string | null }[];
  kindsWithin400m: Record<string, number>;
  areasOfInterest: { answered: boolean; count: number; error: string | null };
  placeIds: {
    supported: boolean;
    places: number;
    withPlaceId: number;
    /** Looked up straight away, then a minute later: found, not found (Apple has no such place) or failed. */
    lookup: MapKitProbeLookupRound | null;
    lookupAMinuteLater: MapKitProbeLookupRound | null;
  };
  rapid: { attempts: number; succeeded: number; firstErrorAt: number | null; firstError: string | null };
};

export type MapKitProbeLookupRound = { found: number; notFound: number; failed: number; failure: string | null };
