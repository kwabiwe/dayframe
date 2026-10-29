export type DashboardRefreshGuard = {
  startedRevision: number;
  timerMutationWasInFlight: boolean;
};

export function captureDashboardRefreshGuard(input: {
  currentRevision: number;
  timerMutationsInFlight: number;
}): DashboardRefreshGuard {
  return {
    startedRevision: input.currentRevision,
    timerMutationWasInFlight: input.timerMutationsInFlight > 0
  };
}

export function shouldApplyDashboardRefresh(input: {
  startedRevision: number;
  currentRevision: number;
  timerMutationsInFlight: number;
  timerMutationWasInFlight?: boolean;
}) {
  return (
    input.timerMutationWasInFlight !== true &&
    input.startedRevision === input.currentRevision &&
    input.timerMutationsInFlight === 0
  );
}

export async function reconcileDashboardRefreshCandidate<Snapshot>(input: {
  candidate: Snapshot;
  currentRevision: () => number;
  guard: DashboardRefreshGuard;
  reconcile: (candidate: Snapshot) => Promise<Snapshot>;
  timerMutationsInFlight: () => number;
  /**
   * Told once, only when the guard accepted the reconciled candidate (it is about to be published): what settles
   * against applied server data waits for this, never for a read the guard discards (Codex r3 on #618).
   */
  onApplied?: (candidate: Snapshot) => void;
}): Promise<
  | { action: "apply"; candidate: Snapshot }
  | { action: "refresh" }
> {
  if (!guardAllowsRefresh(input.guard, input)) return { action: "refresh" };
  const candidate = await input.reconcile(input.candidate);
  if (!guardAllowsRefresh(input.guard, input)) return { action: "refresh" };
  input.onApplied?.(candidate);
  return { action: "apply", candidate };
}

function guardAllowsRefresh(
  guard: DashboardRefreshGuard,
  input: {
    currentRevision: () => number;
    timerMutationsInFlight: () => number;
  }
) {
  return shouldApplyDashboardRefresh({
    startedRevision: guard.startedRevision,
    currentRevision: input.currentRevision(),
    timerMutationsInFlight: input.timerMutationsInFlight(),
    timerMutationWasInFlight: guard.timerMutationWasInFlight
  });
}
