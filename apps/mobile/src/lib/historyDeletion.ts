export const DELETION_UNDO_MS = 5_000;

export type PreparedDeletion<Entry, Snapshot> = {
  activatedAt: null;
  entries: Entry[];
  entryIds: string[];
  expiresAt: null;
  phase: "prepared";
  preparedAt: number;
  snapshot: Snapshot;
  token: number;
};

export type ActiveDeletion<Entry, Snapshot> = {
  activatedAt: number;
  entries: Entry[];
  entryIds: string[];
  expiresAt: number;
  phase: "active";
  preparedAt: number;
  snapshot: Snapshot;
  token: number;
};

export type PendingDeletion<Entry, Snapshot> =
  | PreparedDeletion<Entry, Snapshot>
  | ActiveDeletion<Entry, Snapshot>;

type TimerHandle = unknown;

type DeletionCoordinatorOptions<Entry extends { id: string }, Snapshot> = {
  clearTimer?: (handle: TimerHandle) => void;
  now?: () => number;
  onCommit: (pending: PendingDeletion<Entry, Snapshot>) => void;
  onPendingChange: (pending: PendingDeletion<Entry, Snapshot> | null) => void;
  onRestore: (pending: ActiveDeletion<Entry, Snapshot>) => void;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  undoWindowMs?: number;
};

/**
 * Owns the one deletion lifecycle shared by history rows and entry sheets.
 * A sheet prepares its deletion before dismissing, then activates the visible
 * Undo window only after the sheet reports that its exit has completed.
 */
export function createDeletionCoordinator<Entry extends { id: string }, Snapshot>({
  clearTimer: clearScheduledTimer = (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  now = Date.now,
  onCommit,
  onPendingChange,
  onRestore,
  setTimer: scheduleTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  undoWindowMs = DELETION_UNDO_MS
}: DeletionCoordinatorOptions<Entry, Snapshot>) {
  if (!Number.isFinite(undoWindowMs) || undoWindowMs < 0) {
    throw new Error("undoWindowMs must be a finite non-negative number");
  }

  let disposed = false;
  let nextToken = 0;
  let pending: PendingDeletion<Entry, Snapshot> | null = null;
  let timer: TimerHandle | null = null;

  function cancelTimer() {
    if (timer !== null) clearScheduledTimer(timer);
    timer = null;
  }

  function publish(next: PendingDeletion<Entry, Snapshot> | null) {
    pending = next;
    onPendingChange(next);
  }

  function scheduleExpiry(active: ActiveDeletion<Entry, Snapshot>) {
    cancelTimer();
    const remaining = Math.max(0, active.expiresAt - now());
    timer = scheduleTimer(() => {
      timer = null;
      expire(active.token);
    }, remaining);
  }

  function clearCurrent(token: number | undefined) {
    if (!pending || (token !== undefined && token !== pending.token)) return null;
    const cleared = pending;
    cancelTimer();
    publish(null);
    return cleared;
  }

  function commit(token = pending?.token) {
    if (disposed) return false;
    const committed = clearCurrent(token);
    if (!committed) return false;
    onCommit(committed);
    return true;
  }

  function invalidate(token = pending?.token) {
    if (disposed) return false;
    return Boolean(clearCurrent(token));
  }

  function invalidatePendingEntry(entryId: string) {
    if (disposed || !pending || !pending.entryIds.includes(entryId)) return false;
    return invalidate(pending.token);
  }

  function prepare(entries: Entry[], snapshot: Snapshot) {
    if (disposed || entries.length === 0) return null;

    const entryIds = [...new Set(entries.map((entry) => entry.id))];
    if (entryIds.length !== entries.length) return null;

    if (pending) {
      const pendingIds = new Set(pending.entryIds);
      if (entryIds.some((entryId) => pendingIds.has(entryId))) return null;
      commit(pending.token);
    }

    const prepared: PreparedDeletion<Entry, Snapshot> = {
      activatedAt: null,
      entries: [...entries],
      entryIds,
      expiresAt: null,
      phase: "prepared",
      preparedAt: now(),
      snapshot,
      token: ++nextToken
    };
    publish(prepared);
    return prepared;
  }

  function activate(token: number) {
    if (disposed || !pending || pending.token !== token || pending.phase !== "prepared") {
      return false;
    }
    const activatedAt = now();
    const active: ActiveDeletion<Entry, Snapshot> = {
      ...pending,
      activatedAt,
      expiresAt: activatedAt + undoWindowMs,
      phase: "active"
    };
    publish(active);
    scheduleExpiry(active);
    return true;
  }

  function expire(token: number) {
    if (
      disposed ||
      !pending ||
      pending.token !== token ||
      pending.phase !== "active"
    ) {
      return false;
    }
    if (now() < pending.expiresAt) {
      scheduleExpiry(pending);
      return false;
    }
    return commit(token);
  }

  function undo(token = pending?.token) {
    if (
      disposed ||
      !pending ||
      token !== pending.token ||
      pending.phase !== "active" ||
      now() >= pending.expiresAt
    ) {
      if (pending?.phase === "active" && token === pending.token && now() >= pending.expiresAt) {
        expire(pending.token);
      }
      return false;
    }
    const restored = clearCurrent(token);
    if (!restored || restored.phase !== "active") return false;
    onRestore(restored);
    return true;
  }

  function reconcileForeground() {
    if (disposed || !pending || pending.phase !== "active") return false;
    if (now() >= pending.expiresAt) return expire(pending.token);
    scheduleExpiry(pending);
    return true;
  }

  function registerPendingId(token: number, entryId: string) {
    if (
      disposed ||
      !entryId ||
      !pending ||
      pending.token !== token ||
      pending.entryIds.includes(entryId)
    ) {
      return false;
    }
    const next = { ...pending, entryIds: [...pending.entryIds, entryId] };
    publish(next);
    return true;
  }

  function reconcileExternalActiveEntry({
    deletedActiveEntryId,
    externalActiveEntryId
  }: {
    deletedActiveEntryId: string | null;
    externalActiveEntryId: string | null;
  }) {
    const pendingIds = pendingEntryIds();
    if (
      disposed ||
      !pending ||
      !deletedActiveEntryId ||
      !externalActiveEntryId ||
      !pendingIds.has(deletedActiveEntryId) ||
      pendingIds.has(externalActiveEntryId)
    ) {
      return { collided: false, pendingEntryIds: pendingIds };
    }
    const token = pending.token;
    return {
      collided: commit(token),
      pendingEntryIds: pendingIds
    };
  }

  function current() {
    return pending;
  }

  function pendingEntryIds() {
    return new Set(pending?.entryIds ?? []);
  }

  function dispose() {
    if (disposed) return;
    cancelTimer();
    pending = null;
    disposed = true;
  }

  return {
    activate,
    commit,
    current,
    dispose,
    expire,
    invalidate,
    invalidatePendingEntry,
    pendingEntryIds,
    prepare,
    reconcileExternalActiveEntry,
    reconcileForeground,
    registerPendingId,
    undo
  };
}
