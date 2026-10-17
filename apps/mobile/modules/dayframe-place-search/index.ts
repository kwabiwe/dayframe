import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription
} from "expo-modules-core";
import type {
  PlaceSearchQuery,
  PlaceSearchErrorResult,
  PlaceSearchResolutionRequest,
  PlaceSearchSuggestionsResult,
  NearbyPointOfInterestQuery,
  NearbyPointOfInterestResolutionRequest,
  NearbyPointOfInterestResult,
  ResolvedPlaceSearchResult,
  MapKitProbeReport
} from "./src/DayframePlaceSearch.types";

type DayframePlaceSearchEvents = {
  onSuggestionsChanged(result: PlaceSearchSuggestionsResult): void;
  onSearchError(result: PlaceSearchErrorResult): void;
};

declare class DayframePlaceSearchNativeModule extends NativeModule<DayframePlaceSearchEvents> {
  setQuery(request: PlaceSearchQuery): Promise<void>;
  cancel(): Promise<void>;
  resolveSuggestion(
    suggestionId: string,
    requestId: string
  ): Promise<ResolvedPlaceSearchResult>;
  searchNearby(request: NearbyPointOfInterestQuery): Promise<NearbyPointOfInterestResult>;
  resolveNearby(id: string, requestId: string): Promise<ResolvedPlaceSearchResult>;
  cancelNearby(): Promise<void>;
  probeMapKit(latitude: number, longitude: number): Promise<MapKitProbeReport>;
}

const nativeModule = requireOptionalNativeModule<DayframePlaceSearchNativeModule>(
  "DayframePlaceSearch"
);

export const isAvailable = () => nativeModule !== null;

export const setQuery = (request: PlaceSearchQuery) => {
  if (!nativeModule) {
    return Promise.reject(Object.assign(new Error("Place search is unavailable."), {
      code: "search_unavailable"
    }));
  }
  return nativeModule.setQuery(request);
};

export const cancel = () => nativeModule?.cancel() ?? Promise.resolve();

export const resolveSuggestion = (request: PlaceSearchResolutionRequest) => {
  if (!nativeModule) {
    return Promise.reject(Object.assign(new Error("Place search is unavailable."), {
      code: "search_unavailable"
    }));
  }
  return nativeModule.resolveSuggestion(request.suggestionId, request.requestId);
};

export const searchNearby = (request: NearbyPointOfInterestQuery) => {
  if (!nativeModule) {
    return Promise.reject(Object.assign(new Error("Nearby place search is unavailable."), {
      code: "search_unavailable"
    }));
  }
  return nativeModule.searchNearby(request);
};

export const resolveNearby = (request: NearbyPointOfInterestResolutionRequest) => {
  if (!nativeModule) {
    return Promise.reject(Object.assign(new Error("Nearby place search is unavailable."), {
      code: "search_unavailable"
    }));
  }
  return nativeModule.resolveNearby(request.id, request.requestId);
};

export const cancelNearby = () => nativeModule?.cancelNearby() ?? Promise.resolve();

/** The MapKit checks (Settings › Sync help): counts and yes/no answers around one point. */
export const probeMapKit = (latitude: number, longitude: number) => {
  if (!nativeModule) {
    return Promise.reject(Object.assign(new Error("Apple Maps checks are unavailable."), {
      code: "search_unavailable"
    }));
  }
  return nativeModule.probeMapKit(latitude, longitude);
};

export const addSuggestionsListener = (
  listener: (result: PlaceSearchSuggestionsResult) => void
): EventSubscription | null =>
  nativeModule?.addListener("onSuggestionsChanged", listener) ?? null;

export const addSearchErrorListener = (
  listener: (result: PlaceSearchErrorResult) => void
): EventSubscription | null => nativeModule?.addListener("onSearchError", listener) ?? null;

export type {
  MapKitProbeLookupRound,
  MapKitProbeReport,
  PlaceSearchBias,
  NearbyPointOfInterest,
  NearbyPointOfInterestQuery,
  NearbyPointOfInterestResolutionRequest,
  NearbyPointOfInterestResult,
  PlaceSearchErrorResult,
  PlaceSearchQuery,
  PlaceSearchResolutionRequest,
  PlaceSearchSuggestion,
  PlaceSearchSuggestionsResult,
  ResolvedPlaceSearchResult
} from "./src/DayframePlaceSearch.types";
