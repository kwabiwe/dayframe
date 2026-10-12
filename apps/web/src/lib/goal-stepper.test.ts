import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_GOAL_HOURS, WEEKLY_GOAL_HOURS, __resetGoalDraftsForTests, __resetGoalSaveQueueForTests, canStepGoal, createGoalSaver, goalDrafts, nextGoalMinutes, shownGoal } from "./goal-stepper";

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

describe("the tab's goal drafts (Codex r7, r9)", () => {
  beforeEach(() => __resetGoalDraftsForTests());
  const goals = (daily: number, revision: number) => ({ dailyGoalMinutes: daily, weeklyGoalMinutes: 2400, goalsRevision: revision });

  it("shows a tap, then the newest server copy by revision, whichever way it arrived", () => {
    const tap = goalDrafts.tap("user-1", "dailyGoalMinutes", 540);
    expect(shownGoal(goalDrafts.get("user-1"), "dailyGoalMinutes", goals(480, 1))).toBe(540);
    goalDrafts.accept("user-1", { dailyGoalMinutes: 540 }, { dailyGoalMinutes: tap }, goals(540, 2));
    expect(goalDrafts.get("user-1").taps.dailyGoalMinutes).toBeUndefined();
    // An older page (revision 1) still shows the accepted 9h; a newer one (revision 3), the page's.
    expect(shownGoal(goalDrafts.get("user-1"), "dailyGoalMinutes", goals(480, 1))).toBe(540);
    expect(shownGoal(goalDrafts.get("user-1"), "dailyGoalMinutes", goals(720, 3))).toBe(720);
    goalDrafts.observe("user-1", goals(720, 3));
    // A stale page after that keeps the newest (Codex r9).
    expect(shownGoal(goalDrafts.get("user-1"), "dailyGoalMinutes", goals(480, 1))).toBe(720);
  });

  it("a reply older than what the tab already knows never replaces it (Codex r9)", () => {
    const tap = goalDrafts.tap("user-1", "dailyGoalMinutes", 540);
    goalDrafts.observe("user-1", goals(720, 3)); // changed elsewhere after the save was stored at 2
    goalDrafts.accept("user-1", { dailyGoalMinutes: 540 }, { dailyGoalMinutes: tap }, goals(540, 2));
    expect(goalDrafts.get("user-1").known).toEqual(goals(720, 3));
    expect(shownGoal(goalDrafts.get("user-1"), "dailyGoalMinutes", goals(480, 1))).toBe(720);
  });

  it("a failure drops only its own tap; a newer tap and the newest server copy stay", () => {
    const first = goalDrafts.tap("user-1", "dailyGoalMinutes", 540);
    goalDrafts.accept("user-1", { dailyGoalMinutes: 540 }, { dailyGoalMinutes: first }, goals(540, 2));
    const second = goalDrafts.tap("user-1", "dailyGoalMinutes", 600);
    const third = goalDrafts.tap("user-1", "dailyGoalMinutes", 660);
    goalDrafts.fail("user-1", { dailyGoalMinutes: 600 }, { dailyGoalMinutes: second });
    expect(goalDrafts.get("user-1").taps.dailyGoalMinutes?.value).toBe(660);
    goalDrafts.fail("user-1", { dailyGoalMinutes: 660 }, { dailyGoalMinutes: third });
    expect(shownGoal(goalDrafts.get("user-1"), "dailyGoalMinutes", goals(480, 1))).toBe(540);
  });

  it("keeps each account's drafts apart and tells listeners about changes", () => {
    const listener = vi.fn();
    const unsubscribe = goalDrafts.subscribe(listener);
    goalDrafts.tap("user-1", "weeklyGoalMinutes", 2700);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(goalDrafts.get("user-2")).toEqual({ taps: {} });
    unsubscribe();
    goalDrafts.tap("user-1", "weeklyGoalMinutes", 3000);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
