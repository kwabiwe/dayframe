import { describe, expect, it } from "vitest";
import {
  createTimeEntrySheetMutationTelemetry,
  timeEntrySheetMutationTelemetryReducer
} from "./timeEntrySheetTelemetry";

describe("time-entry sheet cumulative mutation telemetry", () => {
  it("records unique starts and matching finishes without inventing duplicates", () => {
    let state = createTimeEntrySheetMutationTelemetry();
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_started",
      operationToken: 1
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_finished",
      operationToken: 1
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_started",
      operationToken: 2
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_finished",
      operationToken: 2
    });

    expect(state).toEqual({
      activeMutationToken: null,
      duplicateMutationCount: 0,
      lastMutationToken: 2,
      mutationAttemptCount: 2,
      mutationCompletionRejectedCount: 0,
      mutationFinishedCount: 2,
      mutationRejectedCount: 0,
      mutationStartedCount: 2
    });
  });

  it("keeps duplicate attempts and stale finishes cumulative across logical presentations", () => {
    let state = createTimeEntrySheetMutationTelemetry();
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_started",
      operationToken: 7
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_rejected",
      duplicate: true
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_abandoned"
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_finished",
      operationToken: 7
    });
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_started",
      operationToken: 7
    });

    expect(state.duplicateMutationCount).toBe(2);
    expect(state.mutationAttemptCount).toBe(3);
    expect(state.mutationRejectedCount).toBe(2);
    expect(state.mutationCompletionRejectedCount).toBe(2);
    expect(state.mutationStartedCount).toBe(1);
    expect(state.mutationFinishedCount).toBe(0);
    expect(state.lastMutationToken).toBe(7);
  });

  it("distinguishes a non-duplicate gate rejection from a duplicate attempt", () => {
    let state = createTimeEntrySheetMutationTelemetry();
    state = timeEntrySheetMutationTelemetryReducer(state, {
      type: "mutation_rejected",
      duplicate: false
    });

    expect(state.mutationAttemptCount).toBe(1);
    expect(state.mutationRejectedCount).toBe(1);
    expect(state.duplicateMutationCount).toBe(0);
  });
});
