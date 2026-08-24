import { describe, expect, it } from "vitest";
import {
  EXPLICIT_TIMER_MUTATION_EVENT_TYPES,
  isExplicitTimerMutationEventType
} from "./timerMutationEvents";

describe("explicit timer mutation event classification", () => {
  it("matches every explicit start/stop/switch action supported by event processing", () => {
    expect(EXPLICIT_TIMER_MUTATION_EVENT_TYPES).toEqual([
      "timer_start",
      "timer_stop",
      "timer_switch",
      "quick_action",
      "nfc_action",
      "shortcut_action"
    ]);
    for (const type of EXPLICIT_TIMER_MUTATION_EVENT_TYPES) {
      expect(isExplicitTimerMutationEventType(type)).toBe(true);
    }
  });

  it("keeps Health and Location evidence outside timer background execution", () => {
    for (const type of [
      "health_sleep_import",
      "health_workout_import",
      "geofence_enter",
      "geofence_exit",
      "location_visit",
      "learned_place_visit"
    ]) {
      expect(isExplicitTimerMutationEventType(type)).toBe(false);
    }
  });
});
