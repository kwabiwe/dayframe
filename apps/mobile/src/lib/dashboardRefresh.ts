export function shouldApplyDashboardRefresh(input: {
  startedRevision: number;
  currentRevision: number;
  timerMutationsInFlight: number;
}) {
  return (
    input.startedRevision === input.currentRevision &&
    input.timerMutationsInFlight === 0
  );
}
