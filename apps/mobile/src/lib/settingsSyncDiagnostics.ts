export function deviceSyncAttentionStatus(input: {
  timeEntryNeedsAttentionCount: number | null | undefined;
  timerStopNeedsAttentionCount: number | null | undefined;
}) {
  const timerStops = nonNegativeCount(input.timerStopNeedsAttentionCount);
  const timeEntries = nonNegativeCount(input.timeEntryNeedsAttentionCount);
  const messages = [
    timerStops > 0
      ? `${timerStops} timer ${timerStops === 1 ? "Stop" : "Stops"}`
      : null,
    timeEntries > 0
      ? `${timeEntries} time entry ${timeEntries === 1 ? "change" : "changes"}`
      : null
  ].filter((message): message is string => Boolean(message));

  if (messages.length === 0) return null;
  return `${messages.join(" and ")} ${timerStops + timeEntries === 1 ? "needs" : "need"} attention`;
}

function nonNegativeCount(value: number | null | undefined) {
  return Math.max(0, Math.trunc(value ?? 0));
}
