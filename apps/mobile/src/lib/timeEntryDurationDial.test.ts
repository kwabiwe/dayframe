import { describe, expect, it } from "vitest";
import {
  adjustTimeEntryDial,
  formatTimeEntryDialDuration,
  mergeTimeEntryDialLocalDateTime,
  normalizeTimeEntryDialInterval,
  roundTimeEntryDialDuration,
  roundTimeEntryDialStop,
  timeEntryDialHapticLevel,
  timeEntryDialMinuteDeltaForRadians,
  unwrapTimeEntryDialAngle,
  TIME_ENTRY_DIAL_FULL_TURN_RADIANS,
  TIME_ENTRY_DIAL_MAX_DURATION_MS,
  TIME_ENTRY_DIAL_MIN_DURATION_MS
} from "./timeEntryDurationDial";

const minute = 60_000;

describe("time entry duration dial", () => {
  it("preserves seconds while one or many revolutions adjust a handle", () => {
    const startMs = new Date(2026, 7, 8, 9, 10, 37).getTime();
    const endMs = new Date(2026, 7, 8, 10, 10, 37).getTime();

    expect(adjustTimeEntryDial({
      handle: "start",
      interval: { startMs, endMs },
      minuteDelta: -125,
      mode: "stopped"
    })).toEqual({ startMs: startMs - 125 * minute, endMs });
  });

  it("locks the running end to now and disables range/end semantics", () => {
    const nowMs = new Date(2026, 7, 8, 12, 0, 19).getTime();
    const interval = { startMs: nowMs - 30 * minute, endMs: nowMs - 5_000 };

    expect(adjustTimeEntryDial({
      handle: "end",
      interval,
      minuteDelta: 15,
      mode: "running",
      nowMs
    })).toEqual({ startMs: interval.startMs, endMs: nowMs });
    expect(adjustTimeEntryDial({
      handle: "start",
      interval,
      minuteDelta: 15,
      mode: "running",
      nowMs
    })).toEqual({ startMs: interval.startMs + 15 * minute, endMs: nowMs });
  });

  it("allows one-second entries and clamps every handle to exactly 24 hours", () => {
    const startMs = 1_000_000;
    expect(adjustTimeEntryDial({
      handle: "end",
      interval: { startMs, endMs: startMs + minute },
      minuteDelta: -99,
      mode: "stopped"
    }).endMs).toBe(startMs + TIME_ENTRY_DIAL_MIN_DURATION_MS);

    expect(adjustTimeEntryDial({
      handle: "start",
      interval: { startMs, endMs: startMs + minute },
      minuteDelta: -2_000,
      mode: "stopped"
    }).startMs).toBe(startMs + minute - TIME_ENTRY_DIAL_MAX_DURATION_MS);
  });

  it("moves a completed interval across dates without changing duration", () => {
    const interval = {
      startMs: new Date(2026, 7, 8, 23, 45, 23).getTime(),
      endMs: new Date(2026, 7, 9, 0, 15, 23).getTime()
    };
    const shifted = adjustTimeEntryDial({
      handle: "range",
      interval,
      minuteDelta: 30,
      mode: "stopped"
    });
    expect(new Date(shifted.startMs).getDate()).toBe(9);
    expect(shifted.endMs - shifted.startMs).toBe(interval.endMs - interval.startMs);
  });

  it("unwraps the zero-angle boundary and maps each full turn to 60 minutes", () => {
    expect(unwrapTimeEntryDialAngle(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(unwrapTimeEntryDialAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(timeEntryDialMinuteDeltaForRadians(TIME_ENTRY_DIAL_FULL_TURN_RADIANS)).toBe(60);
    expect(timeEntryDialMinuteDeltaForRadians(TIME_ENTRY_DIAL_FULL_TURN_RADIANS * 2)).toBe(120);
  });

  it("rounds stop and duration to five minutes with exact midpoints upward", () => {
    const startMs = new Date(2026, 7, 8, 9, 0, 0).getTime();
    const endMs = new Date(2026, 7, 8, 9, 12, 30).getTime();
    expect(new Date(roundTimeEntryDialStop({ startMs, endMs }).endMs).getMinutes()).toBe(15);
    expect(roundTimeEntryDialDuration({ startMs, endMs }, "stopped").endMs - startMs)
      .toBe(15 * minute);
  });

  it("rounds a running duration by moving Start while End remains now", () => {
    const nowMs = new Date(2026, 7, 8, 9, 12, 30).getTime();
    const rounded = roundTimeEntryDialDuration({
      startMs: new Date(2026, 7, 8, 9, 0, 0).getTime(),
      endMs: nowMs
    }, "running", nowMs);
    expect(rounded.endMs).toBe(nowMs);
    expect(rounded.endMs - rounded.startMs).toBe(15 * minute);
  });

  it("formats an unambiguous 24-hour centre duration", () => {
    expect(formatTimeEntryDialDuration(0)).toBe("00:00:00");
    expect(formatTimeEntryDialDuration(3_661_999)).toBe("01:01:01");
    expect(formatTimeEntryDialDuration(TIME_ENTRY_DIAL_MAX_DURATION_MS)).toBe("24:00:00");
  });

  it("merges typed date/time fields without erasing seconds or milliseconds", () => {
    const baseTimestampMs = new Date(2026, 7, 8, 9, 10, 37, 456).getTime();
    const merged = mergeTimeEntryDialLocalDateTime({
      baseTimestampMs,
      dateText: "2026-08-09",
      timeText: "11:42"
    });
    expect(merged.error).toBeNull();
    expect(new Date(merged.timestampMs ?? 0)).toEqual(new Date(2026, 7, 9, 11, 42, 37, 456));
  });

  it("normalizes invalid/reversed intervals and grades haptics deterministically", () => {
    expect(normalizeTimeEntryDialInterval({ startMs: 20_000, endMs: 10_000 }))
      .toEqual({ startMs: 20_000, endMs: 21_000 });
    expect(timeEntryDialHapticLevel(0, 1)).toBe("minute");
    expect(timeEntryDialHapticLevel(4, 5)).toBe("five_minutes");
    expect(timeEntryDialHapticLevel(59, 60)).toBe("hour");
    expect(timeEntryDialHapticLevel(60, 60)).toBeNull();
  });
});
