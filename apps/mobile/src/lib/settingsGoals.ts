// Blocks parity step 6a-1: Settings › Your day. The steppers change at once; the goals are saved to
// the account a moment after the last tap. Only the latest save may settle the screen, leaving
// Settings saves a pending change at once, and signing out drops it.

export type TimeGoals = { daily: number; weekly: number };

type TimerHandle = unknown;

export function createGoalSaver({
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  delayMs,
  onFailed,
  onSaved,
  save,
  setTimer = (callback, ms) => setTimeout(callback, ms)
}: {
  clearTimer?: (handle: TimerHandle) => void;
  delayMs: number;
  /** The latest save failed: roll the draft back and tell the user. */
  onFailed: (error: unknown) => void;
  /** The latest save landed. */
  onSaved: (goals: TimeGoals) => void;
  save: (goals: TimeGoals) => Promise<void>;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
}) {
  let timer: TimerHandle | null = null;
  let pending: TimeGoals | null = null;
  let sequence = 0;

  function send(goals: TimeGoals) {
    const mine = ++sequence;
    save(goals).then(
      () => {
        if (mine === sequence) onSaved(goals);
      },
      (error: unknown) => {
        if (mine === sequence) onFailed(error);
      }
    );
  }

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return {
    /** A stepper tap: remember the goals and save them after the quiet delay. */
    schedule(goals: TimeGoals) {
      pending = goals;
      stopTimer();
      // Any earlier save still in flight can no longer settle the screen.
      sequence += 1;
      timer = setTimer(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (next) send(next);
      }, delayMs);
    },
    /** Leaving Settings or the app going to the background: save a pending change now. */
    flush() {
      if (timer === null || !pending) return;
      stopTimer();
      const next = pending;
      pending = null;
      send(next);
    },
    /** Signing out: drop a pending change and ignore any save still in flight. */
    cancel() {
      stopTimer();
      pending = null;
      sequence += 1;
    },
    hasPending: () => timer !== null
  };
}

/** Lets Today pick up goals saved in Settings without waiting for its next bootstrap. */
type GoalsListener = (event: { userId: string; dailyGoalMinutes: number; weeklyGoalMinutes: number }) => void;
const goalsListeners = new Set<GoalsListener>();

export function publishSavedTimeGoals(event: Parameters<GoalsListener>[0]) {
  for (const listener of goalsListeners) listener(event);
}

export function subscribeSavedTimeGoals(listener: GoalsListener) {
  goalsListeners.add(listener);
  return () => {
    goalsListeners.delete(listener);
  };
}
