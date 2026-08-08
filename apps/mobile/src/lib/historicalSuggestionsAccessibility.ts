import type { RecentActivitySuggestion } from "@dayframe/shared";

export const HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT =
  "Suggestion could not be applied. Your previous timer details were restored.";

export function historicalSuggestionAppliedAnnouncement(
  suggestion: Pick<
    RecentActivitySuggestion,
    "categoryName" | "description" | "tagNames"
  >
) {
  const details = [
    suggestion.categoryName?.trim()
      ? `category ${suggestion.categoryName.trim()}`
      : null,
    suggestion.tagNames.length > 0
      ? `tags ${suggestion.tagNames.map((tag) => tag.trim()).filter(Boolean).join(", ")}`
      : null
  ].filter((detail): detail is string => Boolean(detail));
  return [
    `Applied suggestion: ${suggestion.description.trim()}.`,
    details.length > 0 ? `${details.join("; ")}.` : null
  ].filter(Boolean).join(" ");
}
