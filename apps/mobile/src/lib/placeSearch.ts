import * as Location from "expo-location";
import {
  addSearchErrorListener,
  addSuggestionsListener,
  cancel as cancelNativeSearch,
  isAvailable as isNativePlaceSearchAvailable,
  resolveSuggestion as resolveNativeSuggestion,
  setQuery as setNativeQuery,
  type PlaceSearchBias,
  type PlaceSearchErrorResult,
  type PlaceSearchSuggestion,
  type PlaceSearchSuggestionsResult,
  type ResolvedPlaceSearchResult
} from "../../modules/dayframe-place-search";

export const PLACE_SEARCH_MINIMUM_QUERY_LENGTH = 2;
export const PLACE_SEARCH_MAX_VISIBLE_RESULTS = 6;
export const PLACE_SEARCH_DEBOUNCE_MS = 250;
export const PLACE_SEARCH_MAX_LOCATION_AGE_MS = 24 * 60 * 60 * 1000;
export const PLACE_SEARCH_REQUIRED_ACCURACY_METERS = 5_000;

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
