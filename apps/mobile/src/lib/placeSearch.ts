import * as Location from "expo-location";
import { distanceMeters, rankVenues, venueNamedLikeArea, type LocationReviewEvidenceDto, type VenueKind, type VenueStay } from "@dayframe/shared";
import {
  addSearchErrorListener,
  addSuggestionsListener,
  cancelNearby as cancelNativeNearbySearch,
  cancel as cancelNativeSearch,
  isAvailable as isNativePlaceSearchAvailable,
  resolveNearby as resolveNativeNearby,
  resolveSuggestion as resolveNativeSuggestion,
  searchNearby as searchNativeNearby,
  setQuery as setNativeQuery,
  type PlaceSearchBias,
  type PlaceSearchErrorResult,
  type PlaceSearchSuggestion,
  type PlaceSearchSuggestionsResult,
  type NearbyPointOfInterest,
  type NearbyPointOfInterestResult,
  type ResolvedPlaceSearchResult
} from "../../modules/dayframe-place-search";

export const PLACE_SEARCH_MINIMUM_QUERY_LENGTH = 2;
export const PLACE_SEARCH_MAX_VISIBLE_RESULTS = 6;
export const PLACE_SEARCH_DEBOUNCE_MS = 250;
export const PLACE_SEARCH_MAX_LOCATION_AGE_MS = 24 * 60 * 60 * 1000;
export const PLACE_SEARCH_REQUIRED_ACCURACY_METERS = 5_000;
/** A small circle around the visit: the places someone was most likely at. */
export const NEARBY_POI_RADIUS_METERS = 400;
/** Location evidence lists at most five nearby places under the empty search field. */
export const NEARBY_POI_MAX_VISIBLE_RESULTS = 5;
/**
 * How many places the native search hands over for ranking: MapKit answers with the nearest ~50
 * whatever the radius (owner's iOS 27.2 checks, 21 Oct 2026), plus the site and area searches.
 */
export const NEARBY_POI_CANDIDATE_LIMIT = 60;

/** A nearby place as Location evidence lists it, after the venue ranker (location v3 PR 7). */
export type NearbyVenue = NearbyPointOfInterest & {
  /** Places inside it (a shop in a centre, a counter in a supermarket), most likely first. */
  inside: string[];
  /** Its share of the evidence among the listed venues (0–1). */
  share: number;
  /** The ranker is confident the visit was here (design §6.3). */
  suggested: boolean;
  /** The ranker's near guess (PRD D23): the suggestion, or the top destination within 50 m when none is clear. */
  guessed: boolean;
  /** Named like an area of interest the visit lies in: listed however far Apple's pin for it is. */
  inArea: boolean;
  /** The ranker's kind of place ("station", "supermarket", …); the transit guess reads it. */
  kind: VenueKind;
};

const normalisePlaceName = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/**
 * Orders the native list with the venue ranker (`rankVenues`, design §6): the place you were at
 * first, at the scale you'd say it, with the places inside it folded under it. Without a stay
 * (no times) it still folds and ranks, with length and time of day left out.
 */
export function rankedNearbyPlaces(
  places: readonly NearbyPointOfInterest[],
  areasOfInterest: readonly string[] = [],
  stay: VenueStay | null = null
): NearbyVenue[] {
  const now = new Date();
  // Only places that can be listed take part, so nothing folds into a parent that is then hidden
  // for distance (Codex r2 on #517): within 400 m, or named like the area the visit lies in.
  const listable = places.filter((place) => isNearbyRow(place) &&
    (place.distanceMeters <= NEARBY_POI_RADIUS_METERS || venueNamedLikeArea(place.title, areasOfInterest)));
  const ranking = rankVenues(listable, stay
    ? { ...stay, areasOfInterest: stay.areasOfInterest ?? areasOfInterest }
    : { startedAt: now.toISOString(), stoppedAt: now.toISOString(), now, areasOfInterest });
  const byId = new Map(places.map((place) => [place.id, place]));
  return ranking.venues.map((venue) => ({
    ...byId.get(venue.candidate.id)!,
    inside: venue.children.map((child) => child.title),
    share: venue.share,
    suggested: ranking.suggestion?.candidate.id === venue.candidate.id,
    guessed: ranking.guess?.candidate.id === venue.candidate.id,
    inArea: venue.insideArea,
    kind: venue.kind
  }));
}

function isNearbyRow(place: NearbyPointOfInterest) {
  return typeof place.id === "string" && place.id.length > 0 &&
    typeof place.title === "string" && place.title.trim().length > 0 &&
    Number.isFinite(place.distanceMeters) && place.distanceMeters >= 0;
}

/** "Inside: Freshway Pharmacy, Bean & Bar +12" (design §6.2), or null with nothing inside. */
export function nearbyInsideLine(inside: readonly string[]) {
  if (!inside.length) return null;
  const shown = inside.slice(0, 2).join(", ");
  return inside.length > 2 ? `Inside: ${shown} +${inside.length - 2}` : `Inside: ${shown}`;
}

/**
 * Presentation-only filtering of the ranked list (already in order): drops malformed rows,
 * anything outside the radius (except an area of interest the visit lies in, whose pin can be
 * farther, however it was found), repeated names and names already on screen as saved places (`hiddenNames`), and keeps
 * at most five. Never changes saved radii or engine matching.
 */
export function visibleNearbyPlaces<T extends NearbyPointOfInterest & { inArea?: boolean }>(
  places: readonly T[],
  hiddenNames: readonly string[] = []
) {
  const seen = new Set(hiddenNames.map(normalisePlaceName).filter(Boolean));
  const unique: T[] = [];
  for (const place of places) {
    if (
      !isNearbyRow(place) ||
      // The area the visit lies in stays, however it was found (Codex r1 on #517).
      (!place.inArea && place.source !== "area" && place.distanceMeters > NEARBY_POI_RADIUS_METERS)
    ) continue;
    const key = normalisePlaceName(place.title);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
    if (unique.length === NEARBY_POI_MAX_VISIBLE_RESULTS) break;
  }
  return unique;
}

export type PlaceSearchCoordinate = {
  latitude: number;
  longitude: number;
};

export type PlaceSearchProvider = {
  search(
    query: string,
    options: { requestId: string; bias: PlaceSearchBias | null }
  ): Promise<void>;
  subscribe(listener: (result: PlaceSearchSuggestionsResult) => void): () => void;
  subscribeErrors(listener: (result: PlaceSearchErrorResult) => void): () => void;
  resolve(
    suggestion: Pick<PlaceSearchSuggestion, "id" | "requestId">
  ): Promise<ResolvedPlaceSearchResult>;
  cancel(): Promise<void>;
};

export type NearbyPointOfInterestProvider = {
  search(options: {
    requestId: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    limit: number;
  }): Promise<NearbyPointOfInterestResult>;
  /** The picked place's name, address and coordinate, from the current generation only. */
  resolve(place: Pick<NearbyPointOfInterest, "id" | "requestId">): Promise<ResolvedPlaceSearchResult>;
  cancel(): Promise<void>;
};

export type NearbyPointOfInterestState = {
  requestId: string | null;
  status: "idle" | "loading" | "results" | "no-results" | "error";
  places: NearbyVenue[];
  message: string | null;
};

export type PlaceSearchState = {
  requestId: string | null;
  query: string;
  status: "idle" | "typing" | "loading" | "results" | "no-results" | "error" | "resolved";
  suggestions: PlaceSearchSuggestion[];
  message: string | null;
};

export type PlaceSearchBiasInputs = {
  selectedCoordinate?: PlaceSearchCoordinate | null;
  existingCoordinate?: PlaceSearchCoordinate | null;
  cachedCoordinate?: PlaceSearchCoordinate | null;
  savedPlaceCoordinates?: PlaceSearchCoordinate[];
};

type LastKnownLocation = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  };
  timestamp: number;
};

type LocationBiasSource = {
  getForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getLastKnownPositionAsync(options: {
    maxAge: number;
    requiredAccuracy: number;
  }): Promise<LastKnownLocation | null>;
};

const initialState = (): PlaceSearchState => ({
  requestId: null,
  query: "",
  status: "idle",
  suggestions: [],
  message: null
});

export class PlaceSearchController {
  private readonly provider: PlaceSearchProvider;
  private readonly onStateChange: (state: PlaceSearchState) => void;
  private readonly debounceMs: number;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeErrors: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requestSequence = 0;
  private state = initialState();
  private disposed = false;

  constructor(
    provider: PlaceSearchProvider,
    onStateChange: (state: PlaceSearchState) => void,
    debounceMs = PLACE_SEARCH_DEBOUNCE_MS
  ) {
    this.provider = provider;
    this.onStateChange = onStateChange;
    this.debounceMs = debounceMs;
    this.unsubscribe = provider.subscribe((result) => this.receive(result));
    this.unsubscribeErrors = provider.subscribeErrors((result) => this.receiveError(result));
  }

  getState() {
    return this.state;
  }

  updateQuery(query: string, bias: PlaceSearchBias | null) {
    if (this.disposed) return;
    this.clearTimer();
    const normalizedQuery = query.trim();
    const requestId = `place-${++this.requestSequence}`;

    if (normalizedQuery.length < PLACE_SEARCH_MINIMUM_QUERY_LENGTH) {
      this.state = {
        requestId,
        query,
        status: normalizedQuery.length === 0 ? "idle" : "typing",
        suggestions: [],
        message: null
      };
      this.emit();
      void this.provider.cancel();
      return;
    }

    this.state = {
      requestId,
      query,
      status: "typing",
      suggestions: [],
      message: null
    };
    this.emit();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || this.state.requestId !== requestId) return;
      this.state = { ...this.state, status: "loading" };
      this.emit();
      void this.provider.search(normalizedQuery, { requestId, bias }).catch((error: unknown) => {
        if (this.disposed || this.state.requestId !== requestId) return;
        this.state = {
          ...this.state,
          status: "error",
          suggestions: [],
          message: friendlyPlaceSearchError(error)
        };
        this.emit();
      });
    }, this.debounceMs);
  }

  async resolve(suggestion: PlaceSearchSuggestion) {
    if (this.disposed || suggestion.requestId !== this.state.requestId) {
      throw Object.assign(new Error("That place result is no longer current."), {
        code: "stale_suggestion"
      });
    }
    const result = await this.provider.resolve(suggestion);
    if (this.disposed || suggestion.requestId !== this.state.requestId) {
      throw Object.assign(new Error("That place result is no longer current."), {
        code: "stale_suggestion"
      });
    }
    this.state = {
      ...this.state,
      status: "resolved",
      suggestions: [],
      message: null
    };
    this.emit();
    return result;
  }

  cancel() {
    if (this.disposed) return Promise.resolve();
    this.clearTimer();
    this.requestSequence += 1;
    this.state = initialState();
    this.emit();
    return this.provider.cancel();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.unsubscribe();
    this.unsubscribeErrors();
    void this.provider.cancel();
  }

  private receive(result: PlaceSearchSuggestionsResult) {
    if (this.disposed || result.requestId !== this.state.requestId) return;
    const suggestions = result.suggestions.slice(0, PLACE_SEARCH_MAX_VISIBLE_RESULTS);
    this.state = {
      ...this.state,
      status: suggestions.length > 0 ? "results" : "no-results",
      suggestions,
      message: suggestions.length > 0
        ? null
        : "No nearby matches. Try a fuller address or place name."
    };
    this.emit();
  }

  private receiveError(result: PlaceSearchErrorResult) {
    if (this.disposed || result.requestId !== this.state.requestId) return;
    this.state = {
      ...this.state,
      status: "error",
      suggestions: [],
      message: friendlyPlaceSearchError({ code: result.code })
    };
    this.emit();
  }

  private emit() {
    this.onStateChange(this.state);
  }

  private clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Nearby request ids are unique across every controller in the process, so a reopened screen never
 * reuses one (the native side also keeps its own generation; Codex r1 on #358).
 */
let nearbyRequestCounter = 0;
function nextNearbyRequestId() {
  nearbyRequestCounter += 1;
  return `nearby-${nearbyRequestCounter}`;
}

export class NearbyPointOfInterestController {
  private currentRequestId: string | null = null;
  private disposed = false;

  constructor(
    private readonly provider: NearbyPointOfInterestProvider,
    private readonly onStateChange: (state: NearbyPointOfInterestState) => void,
    private readonly hiddenNames: () => readonly string[] = () => [],
    /** The visit being named: its times, accuracy and spread feed the venue ranker. */
    private readonly stay: () => VenueStay | null = () => null
  ) {}

  async load(center: PlaceSearchCoordinate) {
    if (this.disposed || !isCoordinate(center)) return;
    const requestId = nextNearbyRequestId();
    this.currentRequestId = requestId;
    this.onStateChange({ requestId, status: "loading", places: [], message: null });
    try {
      const result = await this.provider.search({
        requestId,
        latitude: center.latitude,
        longitude: center.longitude,
        radiusMeters: NEARBY_POI_RADIUS_METERS,
        limit: NEARBY_POI_CANDIDATE_LIMIT
      });
      if (this.disposed || result.requestId !== requestId || !this.isCurrent(requestId)) return;
      const ranked = rankedNearbyPlaces(
        result.places.filter((place) => place.requestId === requestId),
        Array.isArray(result.areasOfInterest) ? result.areasOfInterest.filter((name) => typeof name === "string") : [],
        this.stay()
      );
      const places = visibleNearbyPlaces(ranked, this.hiddenNames());
      this.onStateChange({
        requestId,
        status: places.length > 0 ? "results" : "no-results",
        places,
        message: places.length > 0 ? null : "Nothing found nearby. Search for the place instead."
      });
    } catch (error) {
      if (this.disposed || !this.isCurrent(requestId)) return;
      const message = friendlyPlaceSearchError(error);
      if (!message) return;
      this.onStateChange({
        requestId,
        status: "error",
        places: [],
        message: "Nearby places aren't available right now. You can still search."
      });
    }
  }

  /** Resolves a place from the list on screen; a place from an older list is refused. */
  async resolve(place: NearbyPointOfInterest) {
    if (this.disposed || !this.isCurrent(place.requestId)) throw staleNearbyPlace();
    const result = await this.provider.resolve(place);
    if (this.disposed || !this.isCurrent(place.requestId)) throw staleNearbyPlace();
    return result;
  }

  cancel() {
    if (this.disposed) return Promise.resolve();
    this.currentRequestId = null;
    this.onStateChange({ requestId: null, status: "idle", places: [], message: null });
    return this.provider.cancel();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.currentRequestId = null;
    void this.provider.cancel();
  }

  private isCurrent(requestId: string) {
    return requestId === this.currentRequestId;
  }
}

function staleNearbyPlace() {
  return Object.assign(new Error("That place is no longer current."), { code: "stale_suggestion" });
}

export function createNativePlaceSearchProvider(): PlaceSearchProvider | null {
  if (!isNativePlaceSearchAvailable()) return null;
  return {
    search: (query, options) => setNativeQuery({ query, ...options }),
    subscribe: (listener) => {
      const subscription = addSuggestionsListener(listener);
      return () => subscription?.remove();
    },
    subscribeErrors: (listener) => {
      const subscription = addSearchErrorListener(listener);
      return () => subscription?.remove();
    },
    resolve: ({ id, requestId }) => resolveNativeSuggestion({
      suggestionId: id,
      requestId
    }),
    cancel: cancelNativeSearch
  };
}

export function createNativeNearbyPointOfInterestProvider(): NearbyPointOfInterestProvider | null {
  if (!isNativePlaceSearchAvailable()) return null;
  return {
    search: searchNativeNearby,
    resolve: ({ id, requestId }) => resolveNativeNearby({ id, requestId }),
    cancel: cancelNativeNearbySearch
  };
}

export async function resolvePlaceSearchBias(
  inputs: Omit<PlaceSearchBiasInputs, "cachedCoordinate">,
  locationSource: LocationBiasSource = Location
): Promise<PlaceSearchBias | null> {
  if (isCoordinate(inputs.selectedCoordinate)) {
    return placeSearchBiasFromCoordinate(inputs.selectedCoordinate);
  }
  if (isCoordinate(inputs.existingCoordinate)) {
    return placeSearchBiasFromCoordinate(inputs.existingCoordinate);
  }

  let cachedCoordinate: PlaceSearchCoordinate | null = null;
  try {
    const permission = await locationSource.getForegroundPermissionsAsync();
    if (permission.granted) {
      const cached = await locationSource.getLastKnownPositionAsync({
        maxAge: PLACE_SEARCH_MAX_LOCATION_AGE_MS,
        requiredAccuracy: PLACE_SEARCH_REQUIRED_ACCURACY_METERS
      });
      if (isSuitableLastKnownLocation(cached)) {
        cachedCoordinate = {
          latitude: cached.coords.latitude,
          longitude: cached.coords.longitude
        };
      }
    }
  } catch {
    // Bias is a ranking enhancement. Search must remain usable without it.
  }

  return selectPlaceSearchBias({ ...inputs, cachedCoordinate });
}

export function selectPlaceSearchBias(inputs: PlaceSearchBiasInputs): PlaceSearchBias | null {
  const direct = [
    inputs.selectedCoordinate,
    inputs.existingCoordinate,
    inputs.cachedCoordinate
  ].find(isCoordinate);
  if (direct) return placeSearchBiasFromCoordinate(direct);

  const centre = robustCoordinateMedian(inputs.savedPlaceCoordinates ?? []);
  return centre ? placeSearchBiasFromCoordinate(centre) : null;
}

export function robustCoordinateMedian(
  coordinates: PlaceSearchCoordinate[]
): PlaceSearchCoordinate | null {
  const valid = coordinates.filter(isCoordinate);
  if (valid.length === 0) return null;
  const latitudes = valid.map((coordinate) => coordinate.latitude).sort((a, b) => a - b);
  const longitudes = valid.map((coordinate) => coordinate.longitude).sort((a, b) => a - b);
  return {
    latitude: median(latitudes),
    longitude: median(longitudes)
  };
}

export function isSuitableLastKnownLocation(
  location: LastKnownLocation | null,
  now = Date.now()
): location is LastKnownLocation {
  if (!location || !isCoordinate(location.coords)) return false;
  const age = now - location.timestamp;
  const accuracy = location.coords.accuracy;
  return age >= 0 &&
    age <= PLACE_SEARCH_MAX_LOCATION_AGE_MS &&
    typeof accuracy === "number" &&
    Number.isFinite(accuracy) &&
    accuracy <= PLACE_SEARCH_REQUIRED_ACCURACY_METERS;
}

export function friendlyPlaceSearchError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : "";
  if (code.includes("network_unavailable")) {
    return "Place search is offline. Check your connection, or use Current location or Advanced coordinates.";
  }
  if (code.includes("no_resolved_result")) {
    return "That result could not be located. Try another match.";
  }
  if (code.includes("stale_suggestion")) {
    return "That result is no longer current. Search again and choose a new match.";
  }
  if (code.includes("cancelled")) return "";
  return "Place search is unavailable. Check your connection, use Current location, or open Advanced coordinates.";
}

function placeSearchBiasFromCoordinate(coordinate: PlaceSearchCoordinate): PlaceSearchBias {
  const latitudeDelta = 0.45;
  const longitudeScale = Math.max(0.45, Math.cos((coordinate.latitude * Math.PI) / 180));
  return {
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta,
    longitudeDelta: Math.min(1.2, latitudeDelta / longitudeScale)
  };
}

function isCoordinate(value: unknown): value is PlaceSearchCoordinate {
  if (!value || typeof value !== "object") return false;
  const coordinate = value as PlaceSearchCoordinate;
  return Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180;
}

function median(values: number[]) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

export type {
  PlaceSearchBias,
  PlaceSearchErrorResult,
  PlaceSearchSuggestion,
  PlaceSearchSuggestionsResult,
  ResolvedPlaceSearchResult
};

/**
 * The stay as the venue ranker weighs it: times, the typical reading accuracy and how far the
 * readings spread from the centre (their median distance; not the stay's matching radius, which
 * is a fixed 120 m for an unknown place, Codex r1 on #517).
 */
export function venueStayFromEvidence(evidence: Pick<LocationReviewEvidenceDto, "segment" | "map" | "venue">): VenueStay {
  const median = (values: number[]) => {
    const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const centre = evidence.map.centre;
  // Venues you picked for this stay or near it before count four times (location v3 PR 8).
  const picked = new Set([...(evidence.venue?.historyPlaceIds ?? []), ...(evidence.venue?.confirmedPlaceId ? [evidence.venue.confirmedPlaceId] : [])]);
  return {
    ...(picked.size ? { pickedBefore: (candidate: { placeId?: string | null }) => Boolean(candidate.placeId && picked.has(candidate.placeId)) } : {}),
    startedAt: evidence.segment.startedAt,
    stoppedAt: evidence.segment.stoppedAt,
    now: new Date(),
    accuracyMeters: median(evidence.map.acceptedSamples
      .map((sample) => sample.accuracyMeters)
      .filter((value): value is number => typeof value === "number")),
    spreadMeters: centre ? median(evidence.map.acceptedSamples.map((sample) => distanceMeters(
      { latitude: centre.coordinates[1], longitude: centre.coordinates[0] },
      { latitude: sample.point.coordinates[1], longitude: sample.point.coordinates[0] }
    ))) : null
  };
}
