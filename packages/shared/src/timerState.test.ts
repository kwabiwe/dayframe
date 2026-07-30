import { describe, expect, it } from "vitest";
import {
  TIMER_STATE_POLL_INTERVAL_MS,
  timerStateChanged,
  timerStatePollDelay,
  type TimerStateFingerprint
} from "./timerState";

const state = (
  activeEntryId: string | null,
  updatedAt: string | null
): TimerStateFingerprint => ({
  activeEntryId,
  updatedAt,
  serverNow: "2026-07-30T16:00:00.000Z"
});

describe("timer-state reconciliation", () => {
  it("uses the first response as a baseline", () => {
    expect(timerStateChanged(null, state("entry-1", "2026-07-30T15:00:00.000Z"))).toBe(false);
  });

  it("detects starts, stops, replacements and active-entry edits", () => {
    const running = state("entry-1", "2026-07-30T15:00:00.000Z");
    expect(timerStateChanged(state(null, null), running)).toBe(true);
    expect(timerStateChanged(running, state(null, null))).toBe(true);
    expect(timerStateChanged(running, state("entry-2", running.updatedAt))).toBe(true);
    expect(timerStateChanged(running, state("entry-1", "2026-07-30T15:01:00.000Z"))).toBe(true);
  });

  it("ignores server clock movement when timer state is unchanged", () => {
    const previous = state("entry-1", "2026-07-30T15:00:00.000Z");
    expect(timerStateChanged(previous, {
      ...previous,
      serverNow: "2026-07-30T16:00:03.000Z"
    })).toBe(false);
  });

  it("backs failures off and resets to the three-second cadence after success", () => {
    expect(timerStatePollDelay(0)).toBe(TIMER_STATE_POLL_INTERVAL_MS);
    expect(timerStatePollDelay(1)).toBe(6_000);
    expect(timerStatePollDelay(2)).toBe(12_000);
    expect(timerStatePollDelay(3)).toBe(30_000);
    expect(timerStatePollDelay(20)).toBe(30_000);
  });
});
