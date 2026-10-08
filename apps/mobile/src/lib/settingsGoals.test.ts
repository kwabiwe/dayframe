import { describe, expect, it } from "vitest";
import { createGoalSaver, publishSavedTimeGoals, subscribeSavedTimeGoals, type TimeGoals } from "./settingsGoals";

function harness() {
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const saves: Array<{ goals: TimeGoals; resolve: () => void; reject: (error: unknown) => void }> = [];
  const saved: TimeGoals[] = [];
  const failed: unknown[] = [];
  const saver = createGoalSaver({
    clearTimer: (handle) => timers.delete(handle as number),
    delayMs: 600,
    onFailed: (error) => failed.push(error),
    onSaved: (goals) => saved.push(goals),
    save: (goals) => new Promise<void>((resolve, reject) => saves.push({ goals, resolve, reject })),
    setTimer: (callback) => {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    }
  });
  const fire = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { failed, fire, saved, saver, saves, settle, timers };
}

describe("createGoalSaver", () => {
  it("saves once after the quiet delay with the last value", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.saver.schedule({ daily: 10, weekly: 40 });
    expect(h.saves).toHaveLength(0);
    h.fire();
    await h.settle();
    expect(h.saves.map((save) => save.goals.daily)).toEqual([10]);
  });

  it("lets only the latest save settle the screen (a slow earlier response is ignored)", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.fire();
    await h.settle();
    h.saver.schedule({ daily: 11, weekly: 40 });
    // The first save resolves while the user is still tapping.
    h.saves[0].resolve();
    await h.settle();
    expect(h.saved).toEqual([]);
    h.fire();
    await h.settle();
    h.saves[1].resolve();
    await h.settle();
    expect(h.saved).toEqual([{ daily: 11, weekly: 40 }]);
  });

  it("reports a failure only for the latest save", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.fire();
    await h.settle();
    h.saver.schedule({ daily: 10, weekly: 40 });
    h.fire();
    await h.settle();
    h.saves[0].reject(new Error("old"));
    await h.settle();
    await h.settle();
    h.saves[1].reject(new Error("new"));
    await h.settle();
    expect(h.failed).toEqual([new Error("new")]);
  });

  it("saves a pending change at once when Settings is left", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.saver.flush();
    await h.settle();
    expect(h.saves.map((save) => save.goals.daily)).toEqual([9]);
    expect(h.timers.size).toBe(0);
    h.saver.flush();
    await h.settle();
    expect(h.saves).toHaveLength(1);
  });

  it("drops a pending change and ignores an in-flight save on sign-out", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.fire();
    await h.settle();
    h.saver.schedule({ daily: 10, weekly: 40 });
    h.saver.cancel();
    h.fire();
    await h.settle();
    h.saves[0].reject(new Error("Login required"));
    await h.settle();
    expect(h.saves).toHaveLength(1);
    expect(h.failed).toEqual([]);
  });
});

describe("saved goals channel", () => {
  it("tells subscribers about saved goals until they unsubscribe", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeSavedTimeGoals((event) => seen.push(event.dailyGoalMinutes));
    publishSavedTimeGoals({ userId: "u", dailyGoalMinutes: 540, weeklyGoalMinutes: 2400 });
    unsubscribe();
    publishSavedTimeGoals({ userId: "u", dailyGoalMinutes: 600, weeklyGoalMinutes: 2400 });
    expect(seen).toEqual([540]);
  });
});

describe("createGoalSaver ordering", () => {
  it("sends the next save only after the previous one has settled", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.fire();
    await h.settle();
    h.saver.schedule({ daily: 10, weekly: 40 });
    h.fire();
    await h.settle();
    expect(h.saves.map((save) => save.goals.daily)).toEqual([9]);
    h.saves[0].resolve();
    await h.settle();
    await h.settle();
    expect(h.saves.map((save) => save.goals.daily)).toEqual([9, 10]);
  });

  it("never sends a queued save after sign-out", async () => {
    const h = harness();
    h.saver.schedule({ daily: 9, weekly: 40 });
    h.fire();
    await h.settle();
    h.saver.schedule({ daily: 10, weekly: 40 });
    h.fire();
    h.saver.cancel();
    h.saves[0].reject(new Error("timeout"));
    await h.settle();
    await h.settle();
    expect(h.saves).toHaveLength(1);
    expect(h.saved).toEqual([]);
    expect(h.failed).toEqual([]);
  });
});
