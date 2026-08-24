import { describe, expect, it } from "vitest";
import { durableTimerMutationCounts } from "./durableWorkCounts";

describe("durable timer mutation counts", () => {
  it("counts retryable Start, Switch, Stop, Edit, and Delete work", () => {
    expect(durableTimerMutationCounts({
      activityQueue: [
        { type: "timer_start" },
        { type: "timer_start", failureKind: "network" },
        { type: "timer_start", failureKind: "permanent" },
        { type: "timer_stop" },
        { type: "timer_switch" },
        { type: "quick_action" },
        { type: "nfc_action" },
        { type: "shortcut_action" },
        { type: "health_workout" }
      ],
      nativeShortcutCount: 1,
      timeEntryCommandCount: 2,
      timerStopCount: 1
    })).toEqual({
      timerEventCount: 8,
      timerMutationCount: 11
    });
  });

  it("never lets defensive negative diagnostics create timer work", () => {
    expect(durableTimerMutationCounts({
      activityQueue: [],
      timeEntryCommandCount: -4,
      timerStopCount: -2
    })).toEqual({ timerEventCount: 0, timerMutationCount: 0 });
  });
});
