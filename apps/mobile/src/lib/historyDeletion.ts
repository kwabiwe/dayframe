export const HISTORY_DELETION_UNDO_MS = 5_000;

export type PendingHistoryDeletion<Entry, Snapshot> = {
  entries: Entry[];
  snapshot: Snapshot;
  token: number;
};

type HistoryDeletionTimer = ReturnType<typeof setTimeout>;

export function createHistoryDeletionCoordinator<Entry, Snapshot>({
  onCommit,
  onPendingChange,
  onRestore,
  undoWindowMs = HISTORY_DELETION_UNDO_MS
}: {
  onCommit: (pending: PendingHistoryDeletion<Entry, Snapshot>) => void;
  onPendingChange: (pending: PendingHistoryDeletion<Entry, Snapshot> | null) => void;
  onRestore: (pending: PendingHistoryDeletion<Entry, Snapshot>) => void;
  undoWindowMs?: number;
}) {
  let nextToken = 0;
  let pending: PendingHistoryDeletion<Entry, Snapshot> | null = null;
  let timer: HistoryDeletionTimer | null = null;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function expire(token: number) {
    if (!pending || pending.token !== token) return false;
    const expired = pending;
    pending = null;
    clearTimer();
    onPendingChange(null);
    onCommit(expired);
    return true;
  }

  function begin(entries: Entry[], snapshot: Snapshot) {
    if (pending) {
      const replaced = pending;
      pending = null;
      clearTimer();
      onCommit(replaced);
    }

    const next = {
      entries,
      snapshot,
      token: ++nextToken
    };
    pending = next;
    onPendingChange(next);
    timer = setTimeout(() => {
      expire(next.token);
    }, undoWindowMs);
    return next;
  }

  function undo(token = pending?.token) {
    if (!pending || token !== pending.token) return false;
    const restored = pending;
    pending = null;
    clearTimer();
    onPendingChange(null);
    onRestore(restored);
    return true;
  }

  function current() {
    return pending;
  }

  function dispose() {
    clearTimer();
    pending = null;
  }

  return { begin, current, dispose, expire, undo };
}
