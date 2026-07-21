import type { ResolvedPlaceSearchResult } from "./placeSearch";

export type PlaceEditorSelectionDraft = {
  searchQuery: string;
  selectedResult: ResolvedPlaceSearchResult;
  placeName: string;
  latitudeText: string;
  longitudeText: string;
};

export function resolvedPlaceSelectionDraft(
  result: ResolvedPlaceSearchResult,
  currentName: string,
  nameTouched: boolean
): PlaceEditorSelectionDraft {
  const coordinate = canonicalPlaceCoordinateText(result.latitude, result.longitude);
  return {
    searchQuery: result.title,
    selectedResult: result,
    placeName: nameTouched ? currentName : (result.name || result.title).trim(),
    ...coordinate
  };
}

export function shouldClearResolvedPlace(
  query: string,
  selectedResult: ResolvedPlaceSearchResult | null
) {
  return Boolean(
    selectedResult && query.trim() !== selectedResult.title.trim()
  );
}

export function canonicalPlaceCoordinateText(latitude: number, longitude: number) {
  return {
    latitudeText: formatCoordinate(latitude),
    longitudeText: formatCoordinate(longitude)
  };
}

function formatCoordinate(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(6).replace(/\.?0+$/, "");
}
