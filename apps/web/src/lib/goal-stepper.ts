// UIA-309: Settings › Your day uses the iPhone's goal steppers (Blocks 6a-1): whole hours, saved to
// the account a moment after the last tap; only the latest save settles the page.

export const DAILY_GOAL_HOURS = { min: 1, max: 14, step: 1 } as const;
export const WEEKLY_GOAL_HOURS = { min: 5, max: 80, step: 5 } as const;
export const GOAL_SAVE_DELAY_MS = 600;

type Limits = { min: number; max: number; step: number };

/**
 * One stepper tap. A goal on the step grid moves by one step; one between steps (set elsewhere,
 * say 42 h a week) moves to the nearest step in that direction (45 h or 40 h). Clamped to the limits.
 */
export function nextGoalMinutes(minutes: number, direction: -1 | 1, limits: Limits) {
  const hours = minutes / 60;
  const next = direction > 0
    ? Math.floor(hours / limits.step + 1e-9) * limits.step + limits.step
    : Math.ceil(hours / limits.step - 1e-9) * limits.step - limits.step;
  return Math.min(limits.max, Math.max(limits.min, next)) * 60;
}

export function canStepGoal(minutes: number, direction: -1 | 1, limits: Limits) {
  return nextGoalMinutes(minutes, direction, limits) !== minutes;
}

export type TimeGoalMinutes = { dailyGoalMinutes: number; weeklyGoalMinutes: number };

type TimerHandle = unknown;

/** Saves the latest goals after a quiet delay, one request at a time, latest wins. */
export function createGoalSaver({
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  delayMs = GOAL_SAVE_DELAY_MS,
  onFailed,
  onSaved,
  save,
  setTimer = (callback, ms) => setTimeout(callback, ms)
}: {
  clearTimer?: (handle: TimerHandle) => void;
  delayMs?: number;
  onFailed: (error: unknown) => void;
  onSaved: (goals: TimeGoalMinutes) => void;
  save: (goals: TimeGoalMinutes) => Promise<void>;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
}) {
  let timer: TimerHandle | null = null;
  let pending: TimeGoalMinutes | null = null;
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();

  function send(goals: TimeGoalMinutes) {
    const mine = ++sequence;
    queue = queue.catch(() => undefined).then(() => (mine === sequence ? save(goals) : undefined)).then(
      () => { if (mine === sequence) onSaved(goals); },
      (error: unknown) => { if (mine === sequence) onFailed(error); }
    );
  }

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return {
    schedule(goals: TimeGoalMinutes) {
      pending = goals;
      stopTimer();
      sequence += 1;
      timer = setTimer(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (next) send(next);
      }, delayMs);
    },
    /** Leaving the page: save a pending change now. */
    flush() {
      if (timer === null || !pending) return;
      stopTimer();
      const next = pending;
      pending = null;
      send(next);
    },
    cancel() {
      stopTimer();
      pending = null;
      sequence += 1;
    }
  };
}
