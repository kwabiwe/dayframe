import { describe, expect, it } from "vitest";
import {
  DELETION_UNDO_MS,
  createDeletionCoordinator,
  type PendingDeletion
} from "./historyDeletion";

type Entry = { id: string; title: string };
type Snapshot = { entryIds: string[] };

describe("deletion coordinator", () => {
  it("keeps a prepared sheet deletion untimed until visual exit activates it", () => {
    const harness = coordinatorHarness();
    const prepared = harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1"));

    expect(prepared).toMatchObject({
      activatedAt: null,
      expiresAt: null,
      phase: "prepared",
      preparedAt: 1_000
    });
    expect(harness.clock.pendingTimerCount()).toBe(0);

    harness.clock.advanceBy(12_000);
    expect(harness.commits).toEqual([]);
    expect(harness.coordinator.current()).toEqual(prepared);
  });

  it("starts the exact 5,000 ms window at activation, not preparation", () => {
    const harness = coordinatorHarness();
    const prepared = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    harness.clock.advanceBy(2_000);

    expect(harness.coordinator.activate(prepared.token)).toBe(true);
    expect(harness.coordinator.current()).toMatchObject({
      activatedAt: 3_000,
      expiresAt: 3_000 + DELETION_UNDO_MS,
      phase: "active"
    });

    harness.clock.advanceBy(DELETION_UNDO_MS - 1);
    expect(harness.commits).toEqual([]);
    expect(harness.coordinator.current()?.token).toBe(prepared.token);

    harness.clock.advanceBy(1);
    expect(harness.commits.map(({ token }) => token)).toEqual([prepared.token]);
    expect(harness.coordinator.current()).toBeNull();
  });

  it("reschedules an early timer instead of shortening the visible window", () => {
    const harness = coordinatorHarness();
    const prepared = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    harness.coordinator.activate(prepared.token);

    expect(harness.clock.fireNextEarly(4_999)).toBe(true);
    expect(harness.commits).toEqual([]);
    expect(harness.clock.nextDelay()).toBe(1);

    harness.clock.advanceBy(1);
    expect(harness.commits).toHaveLength(1);
  });

  it("allows Undo at 4,999 ms and rejects it at the exact 5,000 ms boundary", () => {
    const beforeBoundary = coordinatorHarness();
    const before = required(beforeBoundary.coordinator.prepare([entry("before")], snapshot("before")));
    beforeBoundary.coordinator.activate(before.token);
    beforeBoundary.clock.advanceBy(4_999);
    expect(beforeBoundary.coordinator.undo(before.token)).toBe(true);
    expect(beforeBoundary.restores).toHaveLength(1);
    expect(beforeBoundary.commits).toEqual([]);

    const atBoundary = coordinatorHarness();
    const exact = required(atBoundary.coordinator.prepare([entry("exact")], snapshot("exact")));
    atBoundary.coordinator.activate(exact.token);
    atBoundary.clock.setNow(6_000);
    expect(atBoundary.coordinator.undo(exact.token)).toBe(false);
    expect(atBoundary.restores).toEqual([]);
    expect(atBoundary.commits.map(({ token }) => token)).toEqual([exact.token]);
  });

  it("restores the exact captured entries and snapshot", () => {
    const harness = coordinatorHarness();
    const entries = [entry("child-1"), entry("child-2")];
    const capturedSnapshot = snapshot("child-1", "child-2");
    const prepared = required(harness.coordinator.prepare(entries, capturedSnapshot));
    harness.coordinator.activate(prepared.token);

    expect(harness.coordinator.undo(prepared.token)).toBe(true);
    expect(harness.restores[0]).toMatchObject({ entries, snapshot: capturedSnapshot });
  });

  it("rejects stale activation, timeout, Undo, commit and invalidation callbacks", () => {
    const harness = coordinatorHarness();
    const first = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    const second = required(harness.coordinator.prepare([entry("entry-2")], snapshot("entry-2")));

    expect(harness.commits.map(({ token }) => token)).toEqual([first.token]);
    expect(harness.coordinator.activate(first.token)).toBe(false);
    expect(harness.coordinator.expire(first.token)).toBe(false);
    expect(harness.coordinator.undo(first.token)).toBe(false);
    expect(harness.coordinator.commit(first.token)).toBe(false);
    expect(harness.coordinator.invalidate(first.token)).toBe(false);
    expect(harness.coordinator.current()).toEqual(second);
  });

  it("commits a distinct prepared deletion before preparing the second", () => {
    const harness = coordinatorHarness();
    const first = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    const second = required(harness.coordinator.prepare([entry("entry-2")], snapshot("entry-2")));

    expect(second.token).toBeGreaterThan(first.token);
    expect(harness.commits).toEqual([first]);
    expect(harness.coordinator.current()).toEqual(second);
    expect(harness.clock.pendingTimerCount()).toBe(0);
  });

  it("commits a distinct active deletion and cancels its timer before the second", () => {
    const harness = coordinatorHarness();
    const first = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    harness.coordinator.activate(first.token);
    const second = required(harness.coordinator.prepare([entry("entry-2")], snapshot("entry-2")));

    expect(harness.commits[0].token).toBe(first.token);
    expect(harness.coordinator.current()).toEqual(second);
    expect(harness.clock.pendingTimerCount()).toBe(0);
    harness.clock.advanceBy(DELETION_UNDO_MS);
    expect(harness.commits).toHaveLength(1);
  });

  it("rejects duplicate entries within one request and overlapping repeated taps", () => {
    const harness = coordinatorHarness();
    expect(harness.coordinator.prepare(
      [entry("entry-1"), entry("entry-1")],
      snapshot("entry-1")
    )).toBeNull();

    const current = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    expect(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1"))).toBeNull();
    expect(harness.coordinator.prepare(
      [entry("entry-1"), entry("entry-2")],
      snapshot("entry-1", "entry-2")
    )).toBeNull();
    expect(harness.coordinator.current()).toEqual(current);
    expect(harness.commits).toEqual([]);
  });

  it("reconciles foreground before and after expiry using expiresAt", () => {
    const beforeExpiry = coordinatorHarness();
    const before = required(beforeExpiry.coordinator.prepare([entry("before")], snapshot("before")));
    beforeExpiry.coordinator.activate(before.token);
    beforeExpiry.clock.pauseTimers();
    beforeExpiry.clock.setNow(5_999);
    expect(beforeExpiry.coordinator.reconcileForeground()).toBe(true);
    expect(beforeExpiry.commits).toEqual([]);
    expect(beforeExpiry.clock.nextDelay()).toBe(1);

    const afterExpiry = coordinatorHarness();
    const after = required(afterExpiry.coordinator.prepare([entry("after")], snapshot("after")));
    afterExpiry.coordinator.activate(after.token);
    afterExpiry.clock.pauseTimers();
    afterExpiry.clock.setNow(6_001);
    expect(afterExpiry.coordinator.reconcileForeground()).toBe(true);
    expect(afterExpiry.commits.map(({ token }) => token)).toEqual([after.token]);
    expect(afterExpiry.coordinator.current()).toBeNull();
  });

  it("exposes pending IDs and accepts a canonical ID alias for refresh filtering", () => {
    const harness = coordinatorHarness();
    const prepared = required(harness.coordinator.prepare([entry("optimistic")], snapshot("optimistic")));

    expect(harness.coordinator.pendingEntryIds()).toEqual(new Set(["optimistic"]));
    expect(harness.coordinator.registerPendingId(prepared.token, "persisted")).toBe(true);
    expect(harness.coordinator.registerPendingId(prepared.token, "persisted")).toBe(false);
    expect(harness.coordinator.registerPendingId(prepared.token + 1, "stale")).toBe(false);
    expect(harness.coordinator.pendingEntryIds()).toEqual(new Set(["optimistic", "persisted"]));
  });

  it("commits a prepared active deletion when bootstrap discovers a different active timer", () => {
    const harness = coordinatorHarness();
    const prepared = required(harness.coordinator.prepare(
      [entry("entry-deleted")],
      snapshot("entry-deleted")
    ));

    const result = harness.coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: "entry-deleted",
      externalActiveEntryId: "entry-external"
    });

    expect(result).toEqual({
      collided: true,
      pendingEntryIds: new Set(["entry-deleted"])
    });
    expect(harness.commits).toEqual([prepared]);
    expect(harness.coordinator.current()).toBeNull();
  });

  it("commits an active Undo when timer polling discovers a different active timer", () => {
    const harness = coordinatorHarness();
    const prepared = required(harness.coordinator.prepare(
      [entry("entry-deleted")],
      snapshot("entry-deleted")
    ));
    harness.coordinator.activate(prepared.token);

    const result = harness.coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: "entry-deleted",
      externalActiveEntryId: "entry-shortcut"
    });

    expect(result.collided).toBe(true);
    expect(harness.commits).toHaveLength(1);
    expect(harness.clock.pendingTimerCount()).toBe(0);
    expect(harness.coordinator.undo(prepared.token)).toBe(false);
  });

  it("does not collide with the deleted timer's original or canonical identity", () => {
    const harness = coordinatorHarness();
    const prepared = required(harness.coordinator.prepare(
      [entry("entry-optimistic")],
      snapshot("entry-optimistic")
    ));
    harness.coordinator.registerPendingId(prepared.token, "entry-canonical");

    expect(harness.coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: "entry-optimistic",
      externalActiveEntryId: "entry-optimistic"
    }).collided).toBe(false);
    expect(harness.coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: "entry-optimistic",
      externalActiveEntryId: "entry-canonical"
    }).collided).toBe(false);
    expect(harness.coordinator.current()?.token).toBe(prepared.token);
    expect(harness.commits).toEqual([]);
  });

  it("commits pending Undo when queued Shortcut reconciliation discovers another active timer", () => {
    const harness = coordinatorHarness();
    const pending = required(harness.coordinator.prepare(
      [entry("entry-deleted")],
      snapshot("entry-deleted")
    ));
    harness.coordinator.activate(pending.token);

    const reconciliation = harness.coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: "entry-deleted",
      externalActiveEntryId: "entry-from-shortcut"
    });

    expect(reconciliation.collided).toBe(true);
    expect(harness.commits.map(({ token }) => token)).toEqual([pending.token]);
    expect(harness.coordinator.undo(pending.token)).toBe(false);
  });

  it("invalidates a matching optimistic start without committing or restoring it", () => {
    const harness = coordinatorHarness();
    const pending = required(harness.coordinator.prepare(
      [entry("optimistic-start")],
      snapshot("optimistic-start")
    ));
    harness.coordinator.activate(pending.token);

    expect(harness.coordinator.invalidatePendingEntry("other-entry")).toBe(false);
    expect(harness.coordinator.invalidatePendingEntry("optimistic-start")).toBe(true);
    expect(harness.coordinator.current()).toBeNull();
    expect(harness.commits).toEqual([]);
    expect(harness.restores).toEqual([]);
    expect(harness.clock.pendingTimerCount()).toBe(0);
    expect(harness.coordinator.undo(pending.token)).toBe(false);
  });

  it("supports explicit commit and invalidation semantics", () => {
    const committed = coordinatorHarness();
    const commitPending = required(committed.coordinator.prepare([entry("commit")], snapshot("commit")));
    expect(committed.coordinator.commit(commitPending.token)).toBe(true);
    expect(committed.commits).toEqual([commitPending]);
    expect(committed.pendingChanges.at(-1)).toBeNull();

    const invalidated = coordinatorHarness();
    const invalidatedPending = required(
      invalidated.coordinator.prepare([entry("invalidate")], snapshot("invalidate"))
    );
    invalidated.coordinator.activate(invalidatedPending.token);
    expect(invalidated.coordinator.invalidate(invalidatedPending.token)).toBe(true);
    expect(invalidated.commits).toEqual([]);
    expect(invalidated.restores).toEqual([]);
    expect(invalidated.clock.pendingTimerCount()).toBe(0);
  });

  it("disposes idempotently without committing or restoring and rejects future work", () => {
    const harness = coordinatorHarness();
    const pending = required(harness.coordinator.prepare([entry("entry-1")], snapshot("entry-1")));
    harness.coordinator.activate(pending.token);

    harness.coordinator.dispose();
    harness.coordinator.dispose();
    harness.clock.advanceBy(DELETION_UNDO_MS);

    expect(harness.commits).toEqual([]);
    expect(harness.restores).toEqual([]);
    expect(harness.coordinator.current()).toBeNull();
    expect(harness.coordinator.prepare([entry("entry-2")], snapshot("entry-2"))).toBeNull();
    expect(harness.coordinator.activate(pending.token)).toBe(false);
    expect(harness.coordinator.undo(pending.token)).toBe(false);
    expect(harness.coordinator.commit(pending.token)).toBe(false);
    expect(harness.coordinator.invalidate(pending.token)).toBe(false);
  });
});

function entry(id: string): Entry {
  return { id, title: `Entry ${id}` };
}

function snapshot(...entryIds: string[]): Snapshot {
  return { entryIds };
}

function required<T>(value: T | null): T {
  if (!value) throw new Error("Expected a prepared deletion");
  return value;
}

function coordinatorHarness() {
  const clock = createFakeClock(1_000);
  const commits: PendingDeletion<Entry, Snapshot>[] = [];
  const restores: PendingDeletion<Entry, Snapshot>[] = [];
  const pendingChanges: Array<PendingDeletion<Entry, Snapshot> | null> = [];
  const coordinator = createDeletionCoordinator<Entry, Snapshot>({
    clearTimer: clock.clearTimer,
    now: clock.now,
    onCommit: (pending) => commits.push(pending),
    onPendingChange: (pending) => pendingChanges.push(pending),
    onRestore: (pending) => restores.push(pending),
    setTimer: clock.setTimer
  });
  return { clock, commits, coordinator, pendingChanges, restores };
}

function createFakeClock(initialNow: number) {
  let nowMs = initialNow;
  let nextHandle = 0;
  let timersPaused = false;
  const timers = new Map<number, { callback: () => void; dueAt: number }>();

  const runDueTimers = () => {
    if (timersPaused) return;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= nowMs)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) return;
      timers.delete(next[0]);
      next[1].callback();
    }
  };

  return {
    advanceBy(ms: number) {
      nowMs += ms;
      runDueTimers();
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
    fireNextEarly(elapsedMs: number) {
      const next = [...timers.entries()]
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) return false;
      nowMs += elapsedMs;
      timers.delete(next[0]);
      next[1].callback();
      return true;
    },
    nextDelay() {
      const nextDueAt = Math.min(...[...timers.values()].map((timer) => timer.dueAt));
      return Number.isFinite(nextDueAt) ? nextDueAt - nowMs : null;
    },
    now: () => nowMs,
    pauseTimers() {
      timersPaused = true;
      timers.clear();
    },
    pendingTimerCount: () => timers.size,
    setNow(nextNow: number) {
      nowMs = nextNow;
    },
    setTimer(callback: () => void, delayMs: number) {
      const handle = ++nextHandle;
      timers.set(handle, { callback, dueAt: nowMs + delayMs });
      return handle;
    }
  };
}
