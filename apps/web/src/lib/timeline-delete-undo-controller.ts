import type { TimeEntryRow } from "@/lib/queries";

export const TIMELINE_DELETE_UNDO_DELAY_MS = 5_000;
export const TIMELINE_DELETE_NOTICE_EXIT_MS = 160;

export type TimelineDeleteRequest = {
  entries: readonly TimeEntryRow[];
  label: string;
};

export type TimelineDeleteTransaction = {
  entries: readonly TimeEntryRow[];
  ids: readonly string[];
  label: string;
  token: number;
};

export type TimelineDeleteUndoState = {
  committed: readonly TimelineDeleteTransaction[];
  committing: readonly TimelineDeleteTransaction[];
  error: string | null;
  /** What the server refused, while any of it is still there to delete again (WUI-027). */
  failed: TimelineDeleteRequest | null;
  hiddenEntryIds: ReadonlySet<string>;
  notice: TimelineDeleteNotice | null;
  pending: TimelineDeleteTransaction | null;
};

export type TimelineDeleteNotice = Pick<TimelineDeleteTransaction, "label" | "token"> & {
  isExiting: boolean;
};

type ActiveTransaction = {
  transaction: TimelineDeleteTransaction;
  status: "committing" | "committed";
};

type CommitOptions = { keepalive: boolean };

export type TimelineDeleteCommit = (
  transaction: TimelineDeleteTransaction,
  options: CommitOptions
) => Promise<void>;

/**
 * Owns the one undoable Timeline deletion and any older deletion still waiting
 * for server reconciliation. The controller is framework-neutral so timer and
 * out-of-order response behaviour can be protected with fake-timer tests.
 */
export class TimelineDeleteUndoController {
  private active = new Map<number, ActiveTransaction>();
  private disposed = false;
  private error: string | null = null;
  /** The delete the server refused, so the error toast can offer Try again (WUI-027). */
  private failed: TimelineDeleteRequest | null = null;
  private notice: TimelineDeleteNotice | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: TimelineDeleteTransaction | null = null;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly commit: TimelineDeleteCommit,
    private readonly onStateChange: (state: TimelineDeleteUndoState) => void
  ) {}

  getState(): TimelineDeleteUndoState {
    const committing: TimelineDeleteTransaction[] = [];
    const committed: TimelineDeleteTransaction[] = [];
    const hiddenEntryIds = new Set<string>();

    if (this.pending) {
      for (const id of this.pending.ids) hiddenEntryIds.add(id);
    }

    for (const { transaction, status } of this.active.values()) {
      for (const id of transaction.ids) hiddenEntryIds.add(id);
      if (status === "committing") committing.push(transaction);
      else committed.push(transaction);
    }

    return {
      failed: this.failed,
      committed,
      committing,
      error: this.error,
      hiddenEntryIds,
      notice: this.notice,
      pending: this.pending
    };
  }

  requestDelete(request: TimelineDeleteRequest) {
    if (this.disposed) return;
    const entries = uniqueEntries(request.entries);
    if (!entries.length) return;

    this.clearTimer();
    if (this.pending) this.startCommit(this.pending, { keepalive: false });

    const transaction: TimelineDeleteTransaction = {
      entries,
      ids: entries.map((entry) => entry.id),
      label: request.label,
      token: ++this.sequence
    };
    this.error = null;
    this.failed = null;
    this.pending = transaction;
    this.clearNoticeTimer();
    this.notice = { label: transaction.label, token: transaction.token, isExiting: false };
    this.timer = setTimeout(() => {
      if (this.pending?.token !== transaction.token) return;
      this.startCommit(transaction, { keepalive: false });
    }, TIMELINE_DELETE_UNDO_DELAY_MS);
    this.emit();
  }

  /** Deletes again what the server refused (it is on screen again), with its own Undo. */
  retryFailedDelete() {
    const failed = this.failed;
    if (!failed) return;
    this.requestDelete(failed);
  }

  /** Puts the error away without retrying. */
  dismissError() {
    if (this.error === null && this.failed === null) return;
    this.error = null;
    this.failed = null;
    this.emit();
  }

  undoPendingDelete() {
    if (this.disposed || !this.pending) return;
    const transaction = this.pending;
    this.clearTimer();
    this.pending = null;
    this.startNoticeExit(transaction);
    this.emit();
  }

  /** Commit a pending transaction once when navigation or unmount interrupts Undo. */
  finalizePendingDelete() {
    if (this.disposed || !this.pending) return;
    this.clearTimer();
    this.startCommit(this.pending, { keepalive: true });
  }

  /**
   * Keeps a successfully committed deletion hidden until fresh Timeline data no
   * longer includes its exact IDs. This prevents a stale bootstrap snapshot
   * from briefly flashing the deleted row or block back into view.
   */
  reconcileEntryIds(entryIds: ReadonlySet<string>) {
    if (this.disposed) return;
    let changed = false;
    // A refused delete's blocks that a refresh no longer shows are not deleted again (the batch
    // would refuse them all); with none left there is nothing to retry (Codex r1 on #491).
    if (this.failed) {
      const remaining = this.failed.entries.filter((entry) => entryIds.has(entry.id));
      if (remaining.length !== this.failed.entries.length) {
        this.failed = remaining.length ? { ...this.failed, entries: remaining } : null;
        changed = true;
      }
    }
    for (const [token, active] of this.active) {
      if (active.status !== "committed") continue;
      if (active.transaction.ids.every((id) => !entryIds.has(id))) {
        this.active.delete(token);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  dispose() {
    if (this.disposed) return;
    const pending = this.pending;
    this.clearTimer();
    this.clearNoticeTimer();
    this.pending = null;
    this.disposed = true;
    if (pending && !this.active.has(pending.token)) {
      this.active.set(pending.token, { transaction: pending, status: "committing" });
      this.runCommit(pending, { keepalive: true });
    }
  }

  private startCommit(transaction: TimelineDeleteTransaction, options: CommitOptions) {
    if (this.disposed || this.active.has(transaction.token)) return;
    if (this.pending?.token === transaction.token) {
      this.pending = null;
      this.clearTimer();
      this.startNoticeExit(transaction);
    }
    this.active.set(transaction.token, { transaction, status: "committing" });
    this.emit();

    this.runCommit(transaction, options);
  }

  private runCommit(transaction: TimelineDeleteTransaction, options: CommitOptions) {
    void this.commit(transaction, options)
      .then(() => {
        if (this.disposed) return;
        const active = this.active.get(transaction.token);
        if (!active || active.status !== "committing") return;
        this.active.set(transaction.token, { ...active, status: "committed" });
        this.emit();
      })
      .catch((error: unknown) => {
        if (this.disposed || !this.active.has(transaction.token)) return;
        this.active.delete(transaction.token);
        this.error = friendlyDeleteError(error);
        this.failed = { entries: transaction.entries, label: transaction.label };
        this.emit();
      });
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private clearNoticeTimer() {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  private startNoticeExit(transaction: TimelineDeleteTransaction) {
    if (this.notice?.token !== transaction.token || this.notice.isExiting) return;
    this.notice = { ...this.notice, isExiting: true };
    this.clearNoticeTimer();
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      if (this.notice?.token !== transaction.token) return;
      this.notice = null;
      this.emit();
    }, TIMELINE_DELETE_NOTICE_EXIT_MS);
  }

  private emit() {
    if (!this.disposed) this.onStateChange(this.getState());
  }
}

export function initialTimelineDeleteUndoState(): TimelineDeleteUndoState {
  return {
    committed: [],
    committing: [],
    error: null,
    failed: null,
    hiddenEntryIds: new Set(),
    notice: null,
    pending: null
  };
}

function uniqueEntries(entries: readonly TimeEntryRow[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function friendlyDeleteError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unable to delete this block. It has been restored.";
}
