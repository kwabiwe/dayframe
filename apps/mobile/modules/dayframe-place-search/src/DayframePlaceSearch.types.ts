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
