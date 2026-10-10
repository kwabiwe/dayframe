import type { ReviewMutation } from "@dayframe/shared";
import type { ReviewDecisionKind } from "@/lib/review-deck";

// Web Review (Blocks parity step 13): Log it / Skip are held for Undo before anything is sent, as
// on the iPhone deck, so Undo needs no server contract. Modelled on TimelineDeleteUndoController:
// one decision is pending at a time, a new decision saves the held one first, and leaving the page
// saves it at once.

export const REVIEW_DECISION_UNDO_MS = 5_000;
export const REVIEW_DECISION_NOTICE_EXIT_MS = 160;

export type ReviewDecision = {
  token: number;
  itemId: string;
  kind: ReviewDecisionKind;
  mutation: ReviewMutation;
  /** The suggestion as the user saw it (`reviewProposalSignature`). */
  signature: string;
  label: string;
  /** For "All framed": how long the logged block is and its activity colour. */
  durationMs: number;
  color: unknown;
  colorName: string;
  clientMutationId: string;
};

export type ReviewDecisionRequest = Omit<ReviewDecision, "token" | "clientMutationId">;

export type ReviewDecisionNotice = {
  token: number;
  label: string;
  color: unknown;
  colorName: string;
  isExiting: boolean;
};

/** What the save found: saved, the item already gone (decided elsewhere), or the suggestion changed. */
export type ReviewDecisionCommitResult = "saved" | "gone" | "changed";

export type ReviewDecisionCommit = (
  decision: ReviewDecision,
  options: { keepalive: boolean }
) => Promise<ReviewDecisionCommitResult>;

export type ReviewDecisionState = {
  /** Items held, saving or saved here and not yet gone from the data. */
  hiddenIds: ReadonlySet<string>;
  /** This visit's decisions that are held, saving or saved (Undo and failures take them out). */
  decided: readonly ReviewDecision[];
  notice: ReviewDecisionNotice | null;
  error: string | null;
  /** Bumped when Undo or a failed save brings an item back, so the page can select it. */
  restored: { itemId: string; sequence: number } | null;
};

/** "gone": decided elsewhere; hidden until the data drops it, but not this visit's decision. */
type Active = { decision: ReviewDecision; status: "saving" | "saved" | "gone" };

export class ReviewDecisionController {
  private active = new Map<number, Active>();
  private error: string | null = null;
  private notice: ReviewDecisionNotice | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: ReviewDecision | null = null;
  private restored: ReviewDecisionState["restored"] = null;
  private restoreSequence = 0;
  private sequence = 0;
  /** Saved decisions whose item has left the data: still this visit's, for "All framed". */
  private settled: ReviewDecision[] = [];
  private inFlight = new Set<Promise<unknown>>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private commit: ReviewDecisionCommit = async () => {
    throw new Error("Review isn’t ready to save yet.");
  };

  constructor(
    private readonly onStateChange: (state: ReviewDecisionState) => void,
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  /** The page's save, which reads its newest data; replaced whenever that data changes. */
  setCommit(commit: ReviewDecisionCommit) {
    this.commit = commit;
  }

  getState(): ReviewDecisionState {
    const hiddenIds = new Set<string>();
    const decided: ReviewDecision[] = [...this.settled];
    for (const { decision, status } of this.active.values()) {
      hiddenIds.add(decision.itemId);
      if (status !== "gone") decided.push(decision);
    }
    if (this.pending) {
      hiddenIds.add(this.pending.itemId);
      decided.push(this.pending);
    }
    decided.sort((a, b) => a.token - b.token);
    return { hiddenIds, decided, notice: this.notice, error: this.error, restored: this.restored };
  }

  /** Holds a decision; false when this item already has one held or saving. */
  decide(request: ReviewDecisionRequest) {
    
    if (this.pending?.itemId === request.itemId) return false;
    for (const { decision, status } of this.active.values()) {
      if (decision.itemId === request.itemId && status === "saving") return false;
    }
    this.clearTimer();
    if (this.pending) this.startCommit(this.pending, { keepalive: false });

    const decision: ReviewDecision = { ...request, token: ++this.sequence, clientMutationId: this.createId() };
    this.error = null;
    this.pending = decision;
    this.clearNoticeTimer();
    this.notice = { token: decision.token, label: decision.label, color: decision.color, colorName: decision.colorName, isExiting: false };
    this.timer = setTimeout(() => {
      if (this.pending?.token !== decision.token) return;
      this.startCommit(decision, { keepalive: false });
    }, REVIEW_DECISION_UNDO_MS);
    this.emit();
    return true;
  }

  undo() {
    if (!this.pending) return;
    const decision = this.pending;
    this.clearTimer();
    this.pending = null;
    this.startNoticeExit(decision.token);
    this.markRestored(decision.itemId);
    this.emit();
  }

  /** Saves the held decision now (leaving or hiding the page). */
  flush() {
    if (!this.pending) return;
    this.clearTimer();
    this.startCommit(this.pending, { keepalive: true });
  }

  /** Saves the held decision and waits for every save in flight (before the session changes). */
  async flushAndSettle() {
    this.flush();
    await Promise.allSettled([...this.inFlight]);
  }

  clearError() {
    if (this.error === null) return;
    this.error = null;
    this.emit();
  }

  /**
   * A saved decision stays hidden until fresh data no longer lists its item, so a stale snapshot
   * never flashes the card back.
   */
  reconcileItemIds(openIds: ReadonlySet<string>) {
        let changed = false;
    for (const [token, active] of this.active) {
      if (active.status !== "saving" && !openIds.has(active.decision.itemId)) {
        this.active.delete(token);
        // A saved decision is still this visit's for "All framed": keep it counted.
        if (active.status === "saved") this.settled.push(active.decision);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private startCommit(decision: ReviewDecision, options: { keepalive: boolean }) {
    if (this.active.has(decision.token)) return;
    if (this.pending?.token === decision.token) {
      this.pending = null;
      this.clearTimer();
      this.startNoticeExit(decision.token);
    }
    this.active.set(decision.token, { decision, status: "saving" });
    this.emit();
    const saving = this.commit(decision, options)
      .then((result) => {
        if (this.active.get(decision.token)?.status !== "saving") return;
        if (result === "saved") {
          this.active.set(decision.token, { decision, status: "saved" });
        } else if (result === "gone") {
          // Decided elsewhere while held: not this visit's decision, and nothing to bring back.
          this.active.set(decision.token, { decision, status: "gone" });
        } else {
          this.active.delete(decision.token);
          this.error = `“${decision.label.replace(/^(Logged|Skipped) /, "")}” changed, so it was not saved. Review it again.`;
          this.markRestored(decision.itemId);
        }
        this.emit();
      })
      .catch((error: unknown) => {
        if (!this.active.has(decision.token)) return;
        this.active.delete(decision.token);
        this.error = error instanceof Error && error.message
          ? `${error.message} It’s back in the queue.`
          : "Couldn’t save that decision. It’s back in the queue.";
        this.markRestored(decision.itemId);
        this.emit();
      })
      .finally(() => {
        this.inFlight.delete(saving);
      });
    this.inFlight.add(saving);
  }

  private markRestored(itemId: string) {
    this.restored = { itemId, sequence: ++this.restoreSequence };
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearNoticeTimer() {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  private startNoticeExit(token: number) {
    if (this.notice?.token !== token || this.notice.isExiting) return;
    this.notice = { ...this.notice, isExiting: true };
    this.clearNoticeTimer();
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      if (this.notice?.token !== token) return;
      this.notice = null;
      this.emit();
    }, REVIEW_DECISION_NOTICE_EXIT_MS);
  }

  private emit() {
    this.onStateChange(this.getState());
  }
}

export function initialReviewDecisionState(): ReviewDecisionState {
  return { hiddenIds: new Set(), decided: [], notice: null, error: null, restored: null };
}
