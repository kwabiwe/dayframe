import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_GOAL_HOURS, WEEKLY_GOAL_HOURS, __resetGoalSaveQueueForTests, canStepGoal, createGoalSaver, nextGoalMinutes } from "./goal-stepper";

beforeEach(() => __resetGoalSaveQueueForTests());

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

  it("a flush keeps saves in the order they were made, behind one still in flight", async () => {
    let release: () => void = () => undefined;
    const order: number[] = [];
    const save = vi.fn()
      .mockImplementationOnce(async (goals: { dailyGoalMinutes: number }) => { await new Promise<void>((resolve) => { release = resolve; }); order.push(goals.dailyGoalMinutes); })
      .mockImplementation(async (goals: { dailyGoalMinutes: number }) => { order.push(goals.dailyGoalMinutes); });
    const saved: number[] = [];
    const saver = createGoalSaver({ onFailed: () => undefined, onSaved: (_goals, revision) => saved.push(revision), save, setTimer: () => 1, clearTimer: () => undefined });
    saver.schedule({ dailyGoalMinutes: 540, weeklyGoalMinutes: 2400 }, 1);
    saver.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    saver.schedule({ dailyGoalMinutes: 600, weeklyGoalMinutes: 2400 }, 2);
    saver.flush();
    expect(save).toHaveBeenCalledTimes(1); // waits its turn
    release();
    await vi.waitFor(() => expect(order).toEqual([540, 600]));
    await vi.waitFor(() => expect(saved).toEqual([2]));
  });

  it("two savers (two visits to Settings) share one queue in the tab (Codex r3)", async () => {
    let release: () => void = () => undefined;
    let started = false;
    const order: number[] = [];
    const first = createGoalSaver({
      onFailed: () => undefined, onSaved: () => undefined, setTimer: () => 1, clearTimer: () => undefined,
      save: async (goals) => {
        started = true;
        await new Promise<void>((resolve) => { release = resolve; });
        order.push(goals.dailyGoalMinutes);
      }
    });
    const second = createGoalSaver({
      onFailed: () => undefined, onSaved: () => undefined, setTimer: () => 1, clearTimer: () => undefined,
      save: async (goals) => { order.push(goals.dailyGoalMinutes); }
    });
    first.schedule({ dailyGoalMinutes: 540, weeklyGoalMinutes: 2400 }, 1);
    first.flush();
    // The first visit's save is in flight before the second visit saves.
    await vi.waitFor(() => expect(started).toBe(true));
    second.schedule({ dailyGoalMinutes: 420, weeklyGoalMinutes: 2400 }, 1);
    second.flush();
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await vi.waitFor(() => expect(order).toEqual([540, 420]));
  });

  it("a failed later save does not undo an earlier accepted one (Codex r3)", async () => {
    const accepted: number[] = [];
    const failed: number[] = [];
    const save = vi.fn()
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => { throw new Error("offline"); });
    const saver = createGoalSaver({
      onAccepted: (goals) => accepted.push(goals.dailyGoalMinutes),
      onFailed: (_error, revision) => failed.push(revision),
      onSaved: () => undefined,
      save, setTimer: () => 1, clearTimer: () => undefined
    });
    saver.schedule({ dailyGoalMinutes: 540, weeklyGoalMinutes: 2400 }, 1);
    saver.flush();
    await vi.waitFor(() => expect(accepted).toEqual([540]));
    saver.schedule({ dailyGoalMinutes: 540, weeklyGoalMinutes: 2700 }, 2);
    saver.flush();
    await vi.waitFor(() => expect(failed).toEqual([2]));
    expect(accepted).toEqual([540]);
  });
});
