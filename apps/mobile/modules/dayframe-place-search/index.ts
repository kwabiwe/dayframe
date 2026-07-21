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
  ResolvedPlaceSearchResult
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

export const addSuggestionsListener = (
  listener: (result: PlaceSearchSuggestionsResult) => void
): EventSubscription | null =>
  nativeModule?.addListener("onSuggestionsChanged", listener) ?? null;

export const addSearchErrorListener = (
  listener: (result: PlaceSearchErrorResult) => void
): EventSubscription | null => nativeModule?.addListener("onSearchError", listener) ?? null;

export type {
  PlaceSearchBias,
  PlaceSearchErrorResult,
  PlaceSearchQuery,
  PlaceSearchResolutionRequest,
  PlaceSearchSuggestion,
  PlaceSearchSuggestionsResult,
  ResolvedPlaceSearchResult
} from "./src/DayframePlaceSearch.types";
