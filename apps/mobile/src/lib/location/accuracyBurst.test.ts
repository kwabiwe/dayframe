import { describe, expect, it } from "vitest";
import {
  ACCURACY_BURST_DURATION_MS, accuracyBurstArm, accuracyBurstDecision, accuracyBurstDiagnostics, accuracyBurstDue,
  accuracyBurstSummaryLine, accuracyBurstTrialDay, endAccuracyBurst, startAccuracyBurst, startAccuracyBurstTrial,
  type AccuracyBurstState
} from "./accuracyBurst";

// Local times on a fixed day, so the trial's local calendar days are what the test reads.
const day = (offset: number, hour = 9, minute = 0) => new Date(2026, 10, 1 + offset, hour, minute);
const trial = startAccuracyBurstTrial(day(0));

describe("accuracy burst trial (card K, location v4 §10)", () => {
  it("runs 7 days on, 7 days off, then stays off until the owner decides", () => {
    expect([0, 3, 6].map((offset) => accuracyBurstArm(trial, day(offset)))).toEqual(["on", "on", "on"]);
    expect([7, 10, 13].map((offset) => accuracyBurstArm(trial, day(offset)))).toEqual(["off", "off", "off"]);
    expect(accuracyBurstArm(trial, day(14))).toBe("done");
    expect(accuracyBurstArm(trial, day(-1))).toBe("done");
    expect(accuracyBurstTrialDay(trial, day(6, 23, 59))).toBe(6);
  });

  it("starts a burst on a departure or arrival on an on day, and never on an off day", () => {
    expect(accuracyBurstDecision(trial, day(1))).toEqual({ start: true });
    expect(accuracyBurstDecision(trial, day(8))).toEqual({ start: false, reason: "trial_off" });
    expect(accuracyBurstDecision(trial, day(15))).toEqual({ start: false, reason: "trial_done" });
  });

  it("runs one at a time, for 3 minutes, then waits 5 minutes before the next", () => {
    const started = startAccuracyBurst(trial, "departure", day(1, 8, 0));
    expect(started.active).toMatchObject({ kind: "departure", endsAt: day(1, 8, 3).toISOString() });
    expect(accuracyBurstDecision(started, day(1, 8, 2))).toEqual({ start: false, reason: "active" });
    expect(accuracyBurstDue(started, day(1, 8, 2))).toBe(false);
    expect(accuracyBurstDue(started, day(1, 8, 3))).toBe(true);
    const ended = endAccuracyBurst(started, day(1, 8, 4));
    // Counted up to its 3 minutes, never the extra minute before the next reading came.
    expect(ended.days["2026-11-02"]).toEqual({ count: 1, seconds: ACCURACY_BURST_DURATION_MS / 1000,
      byTrigger: { saved_exit: { count: 1, seconds: 180 } } });
    expect(ended.active).toBeUndefined();
    expect(accuracyBurstDecision(ended, day(1, 8, 7))).toEqual({ start: false, reason: "cooldown" });
    expect(accuracyBurstDecision(ended, day(1, 8, 8))).toEqual({ start: true });
  });

  it("counts a burst ended early (sign-out, location off) for the time it really ran", () => {
    const ended = endAccuracyBurst(startAccuracyBurst(trial, "arrival", day(2, 18, 0)), new Date(day(2, 18, 0).getTime() + 70_000));
    expect(ended.days["2026-11-03"]).toMatchObject({ count: 1, seconds: 70 });
  });

  it("caps a day at 6 bursts and 18 minutes, under the 20-minute best-accuracy budget", () => {
    let state: AccuracyBurstState = trial;
    for (let i = 0; i < 6; i += 1) {
      state = endAccuracyBurst(startAccuracyBurst(state, "departure", day(3, 8 + i)), day(3, 8 + i, 3));
    }
    expect(state.days["2026-11-04"]).toMatchObject({ count: 6, seconds: 18 * 60 });
    expect(accuracyBurstDecision(state, day(3, 20))).toEqual({ start: false, reason: "daily_count" });
    // Five full bursts and a part one leave no room for another whole one.
    const nearly: AccuracyBurstState = { ...trial, days: { "2026-11-04": { count: 5, seconds: 16 * 60 } } };
    expect(accuracyBurstDecision(nearly, day(3, 20))).toEqual({ start: false, reason: "daily_time" });
    // The next day starts fresh.
    expect(accuracyBurstDecision(state, day(4, 8))).toEqual({ start: true });
  });

  it("shows the trial in Sync help and shares counts only", () => {
    const state = endAccuracyBurst(startAccuracyBurst(trial, "departure", day(2, 8)), day(2, 8, 3));
    expect(accuracyBurstSummaryLine(state, day(2, 12))).toBe("Accuracy trial day 3 of 14 · bursts on · 1 burst today (3m)");
    expect(accuracyBurstSummaryLine(state, day(9, 12))).toBe("Accuracy trial day 10 of 14 · bursts off · 0 bursts today (0m)");
    expect(accuracyBurstSummaryLine(state, day(20))).toBe("Accuracy trial finished");
    expect(accuracyBurstSummaryLine(null, day(0))).toBe("Accuracy trial: not started");
    expect(accuracyBurstDiagnostics(state)).toEqual([{ day: "2026-11-03", arm: "on", count: 1, seconds: 180,
      byTrigger: { saved_exit: { count: 1, seconds: 180 } } }]);
  });

  it("records what started each burst, and never lets a Visit take the day's last one (Visit departures for any place)", () => {
    const visit = endAccuracyBurst(startAccuracyBurst(trial, "departure", day(5, 12), "visit_departure"), day(5, 12, 3));
    expect(visit.days["2026-11-06"]).toEqual({ count: 1, seconds: 180, byTrigger: { visit_departure: { count: 1, seconds: 180 } } });
    // Five used: a saved place's exit still gets the sixth, a Visit doesn't.
    const five: AccuracyBurstState = { ...trial, days: { "2026-11-06": { count: 5, seconds: 15 * 60 } } };
    expect(accuracyBurstDecision(five, day(5, 20), "visit_departure")).toEqual({ start: false, reason: "daily_count" });
    expect(accuracyBurstDecision(five, day(5, 20), "visit_arrival")).toEqual({ start: false, reason: "daily_count" });
    expect(accuracyBurstDecision(five, day(5, 20), "saved_exit")).toEqual({ start: true });
    // Time too: with 13 minutes used a Visit's burst would leave no room for an exit's.
    const longDay: AccuracyBurstState = { ...trial, days: { "2026-11-06": { count: 4, seconds: 13 * 60 } } };
    expect(accuracyBurstDecision(longDay, day(5, 20), "visit_departure")).toEqual({ start: false, reason: "daily_time" });
    expect(accuracyBurstDecision(longDay, day(5, 20), "saved_entry")).toEqual({ start: true });
  });
});
