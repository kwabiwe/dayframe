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
export type GoalField = keyof TimeGoalMinutes;
/** Only the goals a person changed: a save never rewrites the other one. */
export type GoalChanges = Partial<TimeGoalMinutes>;

type TimerHandle = unknown;

/**
 * One queue for the whole tab: a save made on a later visit to Settings waits behind one still in
 * flight from an earlier visit, so writes land in the order they were made.
 */
let tabQueue: Promise<unknown> = Promise.resolve();

export function __resetGoalSaveQueueForTests() {
  tabQueue = Promise.resolve();
}

export type GoalSave<Context> = { changes: GoalChanges; context: Context };

/**
 * Saves the goals changed since the last save after a quiet delay (one request at a time, in the
 * tab's queue). Each save carries its caller's context (edit revision, the page data it was made
 * over); every outcome is reported with it, accepted or failed, and `onSettled` tells the caller
 * when its latest save is done.
 */
export function createGoalSaver<Context>({
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  delayMs = GOAL_SAVE_DELAY_MS,
  onAccepted,
  onFailed,
  mergeContext = (_earlier: Context, later: Context) => later,
  onBusyChange,
  save,
  setTimer = (callback, ms) => setTimeout(callback, ms)
}: {
  clearTimer?: (handle: TimerHandle) => void;
  delayMs?: number;
  /** Two taps folded into one save: how their contexts combine (the later one by default). */
  mergeContext?: (earlier: Context, later: Context) => Context;
  onAccepted?: (saved: GoalSave<Context>) => void;
  onFailed: (failed: GoalSave<Context>, error: unknown) => void;
  /**
   * Nothing pending and nothing in flight any more (`busy` false), or work began again (true).
   * `lastAccepted` tells whether the save that finished last was accepted.
   */
  onBusyChange?: (busy: boolean, lastAccepted: boolean) => void;
  save: (changes: GoalChanges) => Promise<void>;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
}) {
  let timer: TimerHandle | null = null;
  let pending: GoalSave<Context> | null = null;
  let inFlight = 0;
  let busy = false;
  let cancelled = false;

  function updateBusy(lastAccepted: boolean) {
    const next = pending !== null || inFlight > 0;
    if (next === busy) return;
    busy = next;
    if (!cancelled) onBusyChange?.(busy, lastAccepted);
  }

  function send(change: GoalSave<Context>) {
    inFlight += 1;
    tabQueue = tabQueue.catch(() => undefined).then(() => save(change.changes).then(
      () => {
        inFlight -= 1;
        onAccepted?.(change);
        updateBusy(true);
      },
      (error: unknown) => {
        inFlight -= 1;
        onFailed(change, error);
        updateBusy(false);
      }
    ));
  }

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return {
    /** A stepper tap: its field joins the pending save, which goes after the quiet delay. */
    schedule(changes: GoalChanges, context: Context) {
      pending = pending
        ? { changes: { ...pending.changes, ...changes }, context: mergeContext(pending.context, context) }
        : { changes, context };
      stopTimer();
      updateBusy(true);
      timer = setTimer(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (next) send(next);
      }, delayMs);
    },
    /**
     * Leaving Settings or the page being hidden: send a pending change now, still in the tab's
     * order. A tab closed while an earlier save is still in flight can lose only the last change.
     */
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
      cancelled = true;
    },
    isBusy: () => busy
  };
}

/**
 * What this tab knows about one goal beyond the page's data: the latest tap not yet settled
 * (`tap`, numbered by `revision`), and the last value the account accepted from this tab with the
 * time it was accepted (`accepted`). Kept for the whole tab, per account, so leaving and reopening
 * Settings never forgets either.
 */
export type GoalDraft = {
  tap?: { value: number; revision: number };
  accepted?: { value: number; at: number };
};
export type GoalDrafts = Readonly<Partial<Record<GoalField, GoalDraft>>>;

const EMPTY_DRAFTS: GoalDrafts = Object.freeze({});
let draftsByUser = new Map<string, GoalDrafts>();
let draftRevision = 0;
const draftListeners = new Set<() => void>();

function updateDrafts(userId: string, update: (current: GoalDrafts) => GoalDrafts) {
  const current = draftsByUser.get(userId) ?? EMPTY_DRAFTS;
  const next = update(current);
  if (next === current) return;
  draftsByUser = new Map(draftsByUser).set(userId, next);
  for (const listener of draftListeners) listener();
}

function withField(drafts: GoalDrafts, field: GoalField, draft: GoalDraft): GoalDrafts {
  const next = { ...drafts };
  if (draft.tap || draft.accepted) next[field] = draft;
  else delete next[field];
  return next;
}

export const goalDrafts = {
  get: (userId: string): GoalDrafts => draftsByUser.get(userId) ?? EMPTY_DRAFTS,
  subscribe(listener: () => void) {
    draftListeners.add(listener);
    return () => {
      draftListeners.delete(listener);
    };
  },
  /** A stepper tap: shown at once, until its save settles. Returns the tap's revision. */
  tap(userId: string, field: GoalField, value: number) {
    const revision = ++draftRevision;
    updateDrafts(userId, (drafts) => withField(drafts, field, { ...drafts[field], tap: { value, revision } }));
    return revision;
  },
  /** A save the account accepted: its values are the account's from `at`; their taps are settled. */
  accept(userId: string, changes: GoalChanges, revisions: Partial<Record<GoalField, number>>, at: number) {
    updateDrafts(userId, (drafts) => {
      let next = drafts;
      for (const [field, value] of Object.entries(changes) as Array<[GoalField, number]>) {
        const draft = next[field] ?? {};
        const settled = draft.tap?.revision === revisions[field];
        next = withField(next, field, { tap: settled ? undefined : draft.tap, accepted: { value, at } });
      }
      return next;
    });
  },
  /** A save that failed: its taps (unless a newer tap replaced them) go, so the goal falls back. */
  fail(userId: string, changes: GoalChanges, revisions: Partial<Record<GoalField, number>>) {
    updateDrafts(userId, (drafts) => {
      let next = drafts;
      for (const field of Object.keys(changes) as GoalField[]) {
        const draft = next[field];
        if (draft?.tap && draft.tap.revision === revisions[field]) next = withField(next, field, { ...draft, tap: undefined });
      }
      return next;
    });
  },
  /** Page data read after an accepted value replaces it: that value is retired. */
  retire(userId: string, dataReadAt: number) {
    updateDrafts(userId, (drafts) => {
      let next = drafts;
      for (const field of Object.keys(drafts) as GoalField[]) {
        const draft = next[field];
        if (draft?.accepted && draft.accepted.at < dataReadAt) next = withField(next, field, { ...draft, accepted: undefined });
      }
      return next;
    });
  }
};

/**
 * The goal Settings shows: the latest tap still being saved; else the account's value as last
 * accepted from this tab, while the page's data was read before that; else the page's data.
 */
export function shownGoal(draft: GoalDraft | undefined, pageValue: number, dataReadAt: number) {
  if (draft?.tap) return draft.tap.value;
  if (draft?.accepted && draft.accepted.at >= dataReadAt) return draft.accepted.value;
  return pageValue;
}

export function __resetGoalDraftsForTests() {
  draftsByUser = new Map();
  draftRevision = 0;
}
