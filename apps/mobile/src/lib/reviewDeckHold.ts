// Blocks parity step 5b: a thrown Review card is held for the Undo toast before its decision is
// saved. Nothing reaches the outbox until the hold ends, so Undo needs no server contract; leaving
// Review, backgrounding the app or deciding another card ends the hold at once.

export const REVIEW_DECK_UNDO_MS = 4_800;

export type ReviewDeckHeldDecision = {
  kind: "single";
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
 * Step 5f: "Skip older than 7 days" / "Skip all" hold every chosen card as one decision with one
 * Undo. Each item keeps the proposal the user confirmed, so one changed by a refresh is not saved.
 */
export type ReviewDeckHeldBatch = {
  kind: "batch";
  token: number;
  /** The account that held it: nothing is saved or put back for any other. */
  owner: { workspaceId: string; userId: string };
  items: { key: string; itemId: string; proposal: string }[];
};

export type ReviewDeckHeld = ReviewDeckHeldDecision | ReviewDeckHeldBatch;

/** The deck keys a hold keeps out of the deck. */
export function reviewDeckHeldKeys(held: ReviewDeckHeld | null): string[] {
  if (!held) return [];
  return held.kind === "batch" ? held.items.map((item) => item.key) : [held.key];
}

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
  onChange: (held: ReviewDeckHeld | null) => void;
  onCommit: (held: ReviewDeckHeld) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
}) {
  let held: ReviewDeckHeld | null = null;
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
    hold(decision: ReviewDeckHeld) {
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
