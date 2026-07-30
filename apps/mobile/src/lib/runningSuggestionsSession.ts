export type RunningSuggestionsEligibilityInput = {
  dismissedForSession: boolean;
  hasDescription: boolean;
  isRunningMode: boolean;
  suggestionsAvailable: boolean;
  visible: boolean;
};

/**
 * Suggestions are presentation-only completion help for a newly opened running
 * timer editor. Once manual entry begins, a refresh must not recreate them
 * until that editor has closed and a new session has started.
 */
export function shouldShowRunningSuggestions({
  dismissedForSession,
  hasDescription,
  isRunningMode,
  suggestionsAvailable,
  visible
}: RunningSuggestionsEligibilityInput): boolean {
  return (
    visible &&
    isRunningMode &&
    !hasDescription &&
    suggestionsAvailable &&
    !dismissedForSession
  );
}
