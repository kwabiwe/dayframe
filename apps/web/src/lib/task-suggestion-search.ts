import {
  searchHistoricalSuggestionCandidates,
  type RecentActivitySuggestion,
  type RecentActivitySuggestionCandidate
} from "@dayframe/shared";

/**
 * The Description suggestions a typed query shows: ranked over the bootstrap's whole recent
 * candidate pool (`taskSuggestionCandidates`) with the shared Recent match tiers, never only the
 * compact contextual top 6 (13 Oct: "app testing" found nothing because it sat outside that 6).
 * A bootstrap cached before the pool existed falls back to searching the contextual list.
 * Callers keep their own empty-query branch, which shows the contextual list unchanged.
 */
export function searchTaskSuggestions(
  candidates: RecentActivitySuggestionCandidate[] | undefined,
  contextual: RecentActivitySuggestion[],
  query: string,
  limit: number
): RecentActivitySuggestion[] {
  const pool: RecentActivitySuggestionCandidate[] = Array.isArray(candidates)
    ? candidates
    : contextual.map((suggestion) => ({ ...suggestion, learningTier: 1 }));
  return searchHistoricalSuggestionCandidates(pool, query, { limit });
}
