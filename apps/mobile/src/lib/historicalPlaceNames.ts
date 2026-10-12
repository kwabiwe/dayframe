import type { MobileBootstrap } from "./api";

/**
 * Saved and learned place names from the bootstrap, for the entry sheet's Recent list: a
 * description from a visit confirmed in Review is never offered when it names one of them.
 */
export function historicalPlaceNames(data: Pick<MobileBootstrap, "places" | "learnedPlaces"> | null | undefined): string[] {
  if (!data) return [];
  const names = new Set<string>();
  for (const place of [...(data.places ?? []), ...(data.learnedPlaces ?? [])]) {
    const name = typeof place?.name === "string" ? place.name.trim() : "";
    if (name) names.add(name);
  }
  return [...names];
}
