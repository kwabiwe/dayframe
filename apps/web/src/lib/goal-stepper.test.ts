import { describe, expect, it, vi } from "vitest";
import { DAILY_GOAL_HOURS, WEEKLY_GOAL_HOURS, canStepGoal, createGoalSaver, nextGoalMinutes } from "./goal-stepper";

describe("goal steppers (UIA-309)", () => {
  it("step by whole hours within the iPhone's limits", () => {
    expect(nextGoalMinutes(480, 1, DAILY_GOAL_HOURS)).toBe(540);
    expect(nextGoalMinutes(480, -1, DAILY_GOAL_HOURS)).toBe(420);
    expect(nextGoalMinutes(60, -1, DAILY_GOAL_HOURS)).toBe(60);
    expect(nextGoalMinutes(14 * 60, 1, DAILY_GOAL_HOURS)).toBe(14 * 60);
    expect(canStepGoal(60, -1, DAILY_GOAL_HOURS)).toBe(false);
    expect(nextGoalMinutes(2400, 1, WEEKLY_GOAL_HOURS)).toBe(2700);
  });

  it("a goal between steps moves to the nearest step in that direction", () => {
    expect(nextGoalMinutes(42 * 60, 1, WEEKLY_GOAL_HOURS)).toBe(45 * 60);
    expect(nextGoalMinutes(42 * 60, -1, WEEKLY_GOAL_HOURS)).toBe(40 * 60);
    expect(nextGoalMinutes(450, 1, DAILY_GOAL_HOURS)).toBe(480);
    expect(nextGoalMinutes(450, -1, DAILY_GOAL_HOURS)).toBe(420);
    // Outside the limits (set before them): back inside.
    expect(nextGoalMinutes(20 * 60, -1, DAILY_GOAL_HOURS)).toBe(14 * 60);
  });

  it("saves only the latest goals after the quiet delay, and only the latest save settles", async () => {
    const timers: Array<() => void> = [];
    const saved: unknown[] = [];
    const save = vi.fn(async () => undefined);
    const saver = createGoalSaver({
      onFailed: () => undefined,
      onSaved: (goals) => saved.push(goals),
      save,
      setTimer: (callback) => { timers.push(callback); return timers.length; },
      clearTimer: () => undefined
    });
    saver.schedule({ dailyGoalMinutes: 540, weeklyGoalMinutes: 2400 });
    saver.schedule({ dailyGoalMinutes: 600, weeklyGoalMinutes: 2400 });
    timers.at(-1)!();
    await vi.waitFor(() => expect(saved).toEqual([{ dailyGoalMinutes: 600, weeklyGoalMinutes: 2400 }]));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush sends a pending change at once; cancel drops it", async () => {
    const save = vi.fn(async () => undefined);
    const saver = createGoalSaver({ onFailed: () => undefined, onSaved: () => undefined, save, setTimer: () => 1, clearTimer: () => undefined });
    saver.schedule({ dailyGoalMinutes: 540, weeklyGoalMinutes: 2400 });
    saver.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    saver.schedule({ dailyGoalMinutes: 600, weeklyGoalMinutes: 2400 });
    saver.cancel();
    saver.flush();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
