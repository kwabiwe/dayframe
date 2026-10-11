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

  const stubTimers = { setTimer: () => 1, clearTimer: () => undefined };

  it("folds taps into one save of only the changed goals, after the quiet delay", async () => {
    const timers: Array<() => void> = [];
    const save = vi.fn(async () => undefined);
    const accepted: unknown[] = [];
    const saver = createGoalSaver<number>({
      onAccepted: ({ changes }) => accepted.push(changes),
      onFailed: () => undefined,
      save,
      setTimer: (callback) => { timers.push(callback); return timers.length; },
      clearTimer: () => undefined
    });
    saver.schedule({ dailyGoalMinutes: 540 }, 1);
    saver.schedule({ dailyGoalMinutes: 600 }, 2);
    saver.schedule({ weeklyGoalMinutes: 2700 }, 3);
    timers.at(-1)!();
    await vi.waitFor(() => expect(accepted).toEqual([{ dailyGoalMinutes: 600, weeklyGoalMinutes: 2700 }]));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ dailyGoalMinutes: 600, weeklyGoalMinutes: 2700 });
  });

  it("flush sends a pending change now; cancel drops it", async () => {
    const save = vi.fn(async () => undefined);
    const saver = createGoalSaver<number>({ onAccepted: () => undefined, onFailed: () => undefined, save, ...stubTimers });
    saver.schedule({ dailyGoalMinutes: 540 }, 1);
    saver.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    saver.schedule({ dailyGoalMinutes: 600 }, 2);
    saver.cancel();
    saver.flush();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("two savers (two visits to Settings) share one queue in the tab", async () => {
    let release: () => void = () => undefined;
    let started = false;
    const order: unknown[] = [];
    const first = createGoalSaver<number>({
      onAccepted: () => undefined, onFailed: () => undefined, ...stubTimers,
      save: async (changes) => {
        started = true;
        await new Promise<void>((resolve) => { release = resolve; });
        order.push(changes);
      }
    });
    const second = createGoalSaver<number>({
      onAccepted: () => undefined, onFailed: () => undefined, ...stubTimers,
      save: async (changes) => { order.push(changes); }
    });
    first.schedule({ dailyGoalMinutes: 540 }, 1);
    first.flush();
    await vi.waitFor(() => expect(started).toBe(true));
    second.schedule({ weeklyGoalMinutes: 2700 }, 1);
    second.flush();
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    // In order, and each only its own goal: the later visit never rewrites the daily goal.
    await vi.waitFor(() => expect(order).toEqual([{ dailyGoalMinutes: 540 }, { weeklyGoalMinutes: 2700 }]));
  });

  it("reports each failure with its context, and goes idle once nothing is pending or in flight", async () => {
    const accepted: number[] = [];
    const failed: number[] = [];
    const busy: Array<[boolean, boolean]> = [];
    const save = vi.fn()
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => { throw new Error("offline"); });
    const saver = createGoalSaver<number>({
      onAccepted: ({ context }) => accepted.push(context),
      onFailed: ({ context }) => failed.push(context),
      onBusyChange: (isBusy, lastAccepted) => busy.push([isBusy, lastAccepted]),
      save, ...stubTimers
    });
    saver.schedule({ dailyGoalMinutes: 540 }, 1);
    saver.flush();
    saver.schedule({ weeklyGoalMinutes: 2700 }, 2);
    saver.flush();
    await vi.waitFor(() => expect(failed).toEqual([2]));
    expect(accepted).toEqual([1]);
    // Busy from the first tap until both saves are done; the last one failed.
    expect(busy).toEqual([[true, true], [false, false]]);
    expect(saver.isBusy()).toBe(false);
  });
});
