// Blocks parity step 5b: a thrown Review card is held for the Undo toast before its decision is
// saved. Nothing reaches the outbox until the hold ends, so Undo needs no server contract; leaving
// Review, backgrounding the app or deciding another card ends the hold at once.

export const REVIEW_DECK_UNDO_MS = 4_800;

export type ReviewDeckHeldDecision = {
  token: number;
  key: string;
  itemId: string;
  logged: boolean;
  /** Which way the card was thrown: 1 right (log), -1 left (skip). */
  direction: 1 | -1;
  title: string;
  color: string;
  seconds: number;
  /** What the user saw when they decided (reviewDeckProposalSignature); a change cancels it. */
  proposal: string;
};

/**
 * The parts of a suggestion a decision is about. If a refresh changes any of them while the
 * decision is held, it is not saved: the card comes back to be reviewed again.
 */
export function reviewDeckProposalSignature(item: {
  title?: string | null;
  suggestedStartedAt?: string | null;
  suggestedStoppedAt?: string | null;
  suggestedCategoryId?: string | null;
  suggestedPlaceId?: string | null;
}) {
  return JSON.stringify([
    item.title ?? null,
    item.suggestedStartedAt ? Date.parse(item.suggestedStartedAt) : null,
    item.suggestedStoppedAt ? Date.parse(item.suggestedStoppedAt) : null,
    item.suggestedCategoryId ?? null,
    item.suggestedPlaceId ?? null
  ]);
}

type TimerHandle = unknown;

export function createReviewDeckHold({
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  holdMs = REVIEW_DECK_UNDO_MS,
  onChange,
  onCommit,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs)
}: {
  clearTimer?: (handle: TimerHandle) => void;
  holdMs?: number;
  onChange: (held: ReviewDeckHeldDecision | null) => void;
  onCommit: (held: ReviewDeckHeldDecision) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
}) {
  let held: ReviewDeckHeldDecision | null = null;
  let timer: TimerHandle | null = null;

  function release() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    const current = held;
    held = null;
    return current;
  }

  /** Saves the held decision now (another card decided, Review left, app backgrounded). */
  function flush() {
    const current = release();
    if (!current) return;
    onChange(null);
    onCommit(current);
  }

  return {
    current: () => held,
    flush,
    /** Holds a new decision; one toast at a time, so a decision already held is saved first. */
    hold(decision: ReviewDeckHeldDecision) {
      const previous = release();
      if (previous) onCommit(previous);
      held = decision;
      onChange(decision);
      timer = setTimer(() => {
        if (held?.token !== decision.token) return;
        flush();
      }, holdMs);
    },
    /** Undo: drops the held decision without saving it. Returns it when the token still matches. */
    undo(token: number) {
      if (held?.token !== token) return null;
      const current = release();
      onChange(null);
      return current;
    }
  };
}
