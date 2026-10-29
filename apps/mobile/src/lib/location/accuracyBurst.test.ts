import { describe, expect, it } from "vitest";
import {
  accuracyBurstArm, accuracyBurstDecision, accuracyBurstDiagnostics, accuracyBurstDue, accuracyBurstSummaryLine,
  accuracyBurstTrialDay, endAccuracyBurst, startAccuracyBurst, startAccuracyBurstTrial, withTrialProgress,
  type AccuracyBurstState
} from "./accuracyBurst";

// Local times on a fixed day, so the trial's local calendar days are what the test reads.
const day = (offset: number, hour = 9, minute = 0, second = 0) => new Date(2026, 10, 1 + offset, hour, minute, second);
const trial = startAccuracyBurstTrial(day(0));

describe("accuracy burst trial (card K, location v4 §10)", () => {
  it("runs 7 days on, 7 days off, then stays off until the owner decides", () => {
    expect([0, 3, 6].map((offset) => accuracyBurstArm(trial, day(offset)))).toEqual(["on", "on", "on"]);
    expect([7, 10, 13].map((offset) => accuracyBurstArm(trial, day(offset)))).toEqual(["off", "off", "off"]);
    expect(accuracyBurstArm(trial, day(14))).toBe("done");
    expect(accuracyBurstTrialDay(trial, day(6, 23, 59))).toBe(6);
  });

  it("never runs again once a day has passed, even with the clock set back (Codex r1 on #619)", () => {
    const reached = withTrialProgress(trial, day(14));
    expect(accuracyBurstArm(reached, day(6))).toBe("done");
    const offDay = withTrialProgress(trial, day(8));
    expect(accuracyBurstArm(offDay, day(2))).toBe("off");
    expect(accuracyBurstDecision(offDay, day(2))).toEqual({ start: false, reason: "trial_off" });
  });

  it("starts a burst on a departure or arrival on an on day, and never on an off day", () => {
    expect(accuracyBurstDecision(trial, day(1))).toEqual({ start: true });
    expect(accuracyBurstDecision(trial, day(8))).toEqual({ start: false, reason: "trial_off" });
    expect(accuracyBurstDecision(trial, day(15))).toEqual({ start: false, reason: "trial_done" });
  });

  it("runs one at a time; a late end counts in full and the cooldown starts when it really ended (Codex r1 on #619)", () => {
    const started = startAccuracyBurst(trial, "departure", day(1, 8, 0));
    expect(started.active).toMatchObject({ kind: "departure", trigger: "saved_exit", endsAt: day(1, 8, 3).toISOString() });
    expect(accuracyBurstDecision(started, day(1, 8, 2))).toEqual({ start: false, reason: "active" });
    // Past its 3 minutes but not yet ended (normal capture not back): still one at a time.
    expect(accuracyBurstDue(started, day(1, 8, 3, 1))).toBe(true);
    expect(accuracyBurstDecision(started, day(1, 8, 3, 1))).toEqual({ start: false, reason: "active" });
    const ended = endAccuracyBurst(started, day(1, 8, 4));
    expect(ended.days["2026-11-02"]).toEqual({ count: 1, seconds: 240, byTrigger: { saved_exit: { count: 1, seconds: 240 } } });
    expect(ended.active).toBeUndefined();
    expect(accuracyBurstDecision(ended, day(1, 8, 8))).toEqual({ start: false, reason: "cooldown" });
    expect(accuracyBurstDecision(ended, day(1, 8, 9))).toEqual({ start: true });
  });

  it("counts a burst ended early (sign-out, location off) for the time it really ran", () => {
    const ended = endAccuracyBurst(startAccuracyBurst(trial, "arrival", day(2, 18, 0)), new Date(day(2, 18, 0).getTime() + 70_000));
    expect(ended.days["2026-11-03"]).toMatchObject({ count: 1, seconds: 70 });
  });

  it("charges each local day its own part of a burst across midnight (Codex r1 on #619)", () => {
    // Best accuracy started with the recording (the lease says so).
    const ended = endAccuracyBurst(startAccuracyBurst(trial, "departure", day(2, 23, 59)), day(3, 0, 2), undefined, day(2, 23, 59).getTime());
    expect(ended.days["2026-11-03"]).toMatchObject({ count: 1, seconds: 60 });
    expect(ended.days["2026-11-04"]).toMatchObject({ count: 0, seconds: 120 });
    // The next day's cap counts the spill: 5 full bursts more leave no room for a sixth's whole 3 minutes.
    let state = ended;
    for (let i = 0; i < 5; i += 1) state = endAccuracyBurst(startAccuracyBurst(state, "departure", day(3, 8 + i)), day(3, 8 + i, 3));
    expect(state.days["2026-11-04"]).toMatchObject({ count: 5, seconds: 17 * 60 });
    expect(accuracyBurstDecision(state, day(3, 20))).toEqual({ start: false, reason: "daily_time" });
  });

  it("counts a burst on the time zone it started in, whatever the zone when it ends (Codex r2 on #619)", () => {
    const started = startAccuracyBurst(trial, "departure", day(2, 12));
    // It started where the clock read 23:59 (an hour behind UTC, say), and ended 3 minutes later in another zone.
    const startedAt = Date.parse("2026-11-03T00:59:00.000Z");
    const elsewhere: AccuracyBurstState = { ...started, days: { "2026-11-02": { count: 1, seconds: 0 } },
      active: { ...started.active!, startedAt: new Date(startedAt).toISOString(), endsAt: new Date(startedAt + 180_000).toISOString(), offsetMinutes: 60 } };
    const ended = endAccuracyBurst(elsewhere, new Date(startedAt + 180_000), undefined, startedAt);
    expect(ended.days["2026-11-02"]).toMatchObject({ count: 1, seconds: 60 });
    expect(ended.days["2026-11-03"]).toMatchObject({ count: 0, seconds: 120 });
    // With no evidence of when best accuracy started, the next day counts it too: its cap is met early, never passed
    // (Codex r17 on #619).
    expect(endAccuracyBurst(elsewhere, new Date(startedAt + 180_000)).days["2026-11-03"]).toMatchObject({ count: 1, seconds: 120 });
  });

  it("caps a day at 6 bursts and 18 minutes, under the 20-minute best-accuracy budget", () => {
    let state: AccuracyBurstState = trial;
    for (let i = 0; i < 6; i += 1) {
      state = endAccuracyBurst(startAccuracyBurst(state, "departure", day(3, 8 + i)), day(3, 8 + i, 3));
    }
    expect(state.days["2026-11-04"]).toMatchObject({ count: 6, seconds: 18 * 60 });
    expect(accuracyBurstDecision(state, day(3, 20))).toEqual({ start: false, reason: "daily_count" });
    const nearly: AccuracyBurstState = { ...trial, days: { "2026-11-04": { count: 5, seconds: 16 * 60 } } };
    expect(accuracyBurstDecision(nearly, day(3, 20))).toEqual({ start: false, reason: "daily_time" });
    expect(accuracyBurstDecision(state, day(4, 8))).toEqual({ start: true });
  });

  it("records what started each burst, and never lets a Visit take the day's last one", () => {
    const visit = endAccuracyBurst(startAccuracyBurst(trial, "departure", day(5, 12), "visit_departure"), day(5, 12, 3));
    expect(visit.days["2026-11-06"]).toEqual({ count: 1, seconds: 180, byTrigger: { visit_departure: { count: 1, seconds: 180 } } });
    const five: AccuracyBurstState = { ...trial, days: { "2026-11-06": { count: 5, seconds: 15 * 60 } } };
    expect(accuracyBurstDecision(five, day(5, 20), "visit_departure")).toEqual({ start: false, reason: "daily_count" });
    expect(accuracyBurstDecision(five, day(5, 20), "visit_arrival")).toEqual({ start: false, reason: "daily_count" });
    expect(accuracyBurstDecision(five, day(5, 20), "saved_exit")).toEqual({ start: true });
    const longDay: AccuracyBurstState = { ...trial, days: { "2026-11-06": { count: 4, seconds: 13 * 60 } } };
    expect(accuracyBurstDecision(longDay, day(5, 20), "visit_departure")).toEqual({ start: false, reason: "daily_time" });
    expect(accuracyBurstDecision(longDay, day(5, 20), "saved_entry")).toEqual({ start: true });
  });

  it("shows the trial in Sync help, and shares every trial day so far, off days and empty days included (Codex r1 on #619)", () => {
    const state = endAccuracyBurst(startAccuracyBurst(trial, "departure", day(2, 8)), day(2, 8, 3));
    expect(accuracyBurstSummaryLine(state, day(2, 12))).toBe("Accuracy trial day 3 of 14 · bursts on · 1 burst today (3m)");
    expect(accuracyBurstSummaryLine(state, day(9, 12))).toBe("Accuracy trial day 10 of 14 · bursts off · 0 bursts today (0m)");
    expect(accuracyBurstSummaryLine(state, day(20))).toBe("Accuracy trial finished");
    expect(accuracyBurstSummaryLine(null, day(0))).toBe("Accuracy trial: not started");
    const shared = accuracyBurstDiagnostics(state, day(8, 12));
    expect(shared.map((row) => [row.day, row.arm, row.count])).toEqual([
      ["2026-11-01", "on", 0], ["2026-11-02", "on", 0], ["2026-11-03", "on", 1], ["2026-11-04", "on", 0],
      ["2026-11-05", "on", 0], ["2026-11-06", "on", 0], ["2026-11-07", "on", 0], ["2026-11-08", "off", 0], ["2026-11-09", "off", 0]
    ]);
    expect(shared[2]).toEqual({ day: "2026-11-03", arm: "on", count: 1, seconds: 180, byTrigger: { saved_exit: { count: 1, seconds: 180 } } });
    expect(accuracyBurstDiagnostics(state, day(30))).toHaveLength(14);
  });

  it("counts a burst from when best accuracy started, on that day, never from its recording (Codex r16 on #619)", () => {
    const reserved = startAccuracyBurst(trial, "departure", day(2, 23, 56));
    const ended = endAccuracyBurst(reserved, day(3, 0, 4), 180_000, day(3, 0, 1).getTime());
    expect(ended.days["2026-11-03"]).toMatchObject({ count: 0, seconds: 0 });
    expect(ended.days["2026-11-04"]).toMatchObject({ count: 1, seconds: 180 });
    // The recorded native start counts when no elapsed time is known (after a relaunch).
    const stored = { ...reserved, active: { ...reserved.active!, nativeStartedAt: day(2, 23, 58).toISOString() } };
    expect(endAccuracyBurst(stored, day(2, 23, 59, 10)).days["2026-11-03"]).toMatchObject({ count: 1, seconds: 70 });
    // One that never started natively runs for no time.
    expect(endAccuracyBurst(reserved, day(2, 23, 58), 0).days["2026-11-03"]).toMatchObject({ count: 1, seconds: 0 });
  });

  it("a clock set back behind a burst's start counts it to its hard stop, never as nothing (Codex r19 on #619)", () => {
    const started = startAccuracyBurst(trial, "departure", day(2, 8, 0));
    const ended = endAccuracyBurst(started, day(2, 7, 8));
    expect(ended.days["2026-11-03"]).toMatchObject({ count: 1, seconds: 8 * 60 });
  });

  it("a clock set back counts a late-starting burst to its own hard stop, from when best accuracy started (Codex r20 on #619)", () => {
    const reserved = startAccuracyBurst(trial, "departure", day(2, 8, 0));
    const late = { ...reserved, active: { ...reserved.active!, nativeStartedAt: day(2, 8, 10).toISOString() } };
    expect(endAccuracyBurst(late, day(2, 7, 18)).days["2026-11-03"]).toMatchObject({ count: 1, seconds: 8 * 60 });
  });
});

