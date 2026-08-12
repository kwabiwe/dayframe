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
};

export type NearbyPointOfInterest = {
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
};

export type NearbyPointOfInterestResult = {
  requestId: string;
  places: NearbyPointOfInterest[];
};
