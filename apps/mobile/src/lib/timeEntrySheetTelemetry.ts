export type TimeEntrySheetMutationTelemetry = {
  activeMutationToken: number | null;
  duplicateMutationCount: number;
  lastMutationToken: number | null;
  mutationAttemptCount: number;
  mutationCompletionRejectedCount: number;
  mutationFinishedCount: number;
  mutationRejectedCount: number;
  mutationStartedCount: number;
};

export type TimeEntrySheetMutationTelemetryEvent =
  | {
      type: "mutation_started";
      operationToken: number;
    }
  | {
      type: "mutation_rejected";
      duplicate: boolean;
    }
  | {
      type: "mutation_finished";
      operationToken: number;
    }
  | {
      type: "mutation_completion_rejected";
    }
  | {
      type: "mutation_abandoned";
    };

export function createTimeEntrySheetMutationTelemetry(): TimeEntrySheetMutationTelemetry {
  return {
    activeMutationToken: null,
    duplicateMutationCount: 0,
    lastMutationToken: null,
    mutationAttemptCount: 0,
    mutationCompletionRejectedCount: 0,
    mutationFinishedCount: 0,
    mutationRejectedCount: 0,
    mutationStartedCount: 0
  };
}

/**
 * Cumulative component-lifetime evidence for the production mutation gate.
 * There is intentionally no presentation-reset event: rapid reopen and stale
 * completion races must remain observable for the whole mounted QA session.
 */
export function timeEntrySheetMutationTelemetryReducer(
  state: TimeEntrySheetMutationTelemetry,
  event: TimeEntrySheetMutationTelemetryEvent
): TimeEntrySheetMutationTelemetry {
  switch (event.type) {
    case "mutation_started": {
      const tokenIsUnique = Number.isSafeInteger(event.operationToken) &&
        event.operationToken > 0 &&
        (state.lastMutationToken === null || event.operationToken > state.lastMutationToken);
      if (!tokenIsUnique || state.activeMutationToken !== null) {
        return {
          ...state,
          duplicateMutationCount: state.duplicateMutationCount + 1,
          mutationAttemptCount: state.mutationAttemptCount + 1,
          mutationRejectedCount: state.mutationRejectedCount + 1
        };
      }
      return {
        ...state,
        activeMutationToken: event.operationToken,
        lastMutationToken: event.operationToken,
        mutationAttemptCount: state.mutationAttemptCount + 1,
        mutationStartedCount: state.mutationStartedCount + 1
      };
    }
    case "mutation_rejected":
      return {
        ...state,
        duplicateMutationCount: state.duplicateMutationCount + (event.duplicate ? 1 : 0),
        mutationAttemptCount: state.mutationAttemptCount + 1,
        mutationRejectedCount: state.mutationRejectedCount + 1
      };
    case "mutation_finished":
      if (state.activeMutationToken !== event.operationToken) {
        return {
          ...state,
          mutationCompletionRejectedCount: state.mutationCompletionRejectedCount + 1
        };
      }
      return {
        ...state,
        activeMutationToken: null,
        mutationFinishedCount: state.mutationFinishedCount + 1
      };
    case "mutation_completion_rejected":
      return {
        ...state,
        mutationCompletionRejectedCount: state.mutationCompletionRejectedCount + 1
      };
    case "mutation_abandoned":
      return {
        ...state,
        activeMutationToken: null,
        mutationCompletionRejectedCount: state.mutationCompletionRejectedCount + 1
      };
    default:
      return state;
  }
}
