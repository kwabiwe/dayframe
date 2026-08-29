import { isExplicitTimerMutationEventType } from "./timerMutationEvents";

export function durableTimerMutationCounts(input: {
  activityQueue: ReadonlyArray<{ failureKind?: string; type: string }>;
  nativeShortcutCount?: number;
  timeEntryCommandCount: number;
  timerStopCount: number;
}) {
  const timerEventCount = input.activityQueue.filter((event) =>
    isExplicitTimerMutationEventType(event.type) && event.failureKind !== "permanent"
  ).length + Math.max(0, Math.trunc(input.nativeShortcutCount ?? 0));
  return {
    timerEventCount,
    timerMutationCount:
      timerEventCount +
      Math.max(0, Math.trunc(input.timerStopCount)) +
      Math.max(0, Math.trunc(input.timeEntryCommandCount))
  };
}
