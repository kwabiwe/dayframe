import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORY_DELETION_UNDO_MS,
  createHistoryDeletionCoordinator,
  type PendingHistoryDeletion
} from "./historyDeletion";

type Entry = { id: string };
type Snapshot = { entryIds: string[] };

describe("Today history deletion coordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the current deletion undoable for exactly five seconds", () => {
    const harness = coordinatorHarness();
    harness.coordinator.begin([{ id: "entry-1" }], { entryIds: ["entry-1"] });

    vi.advanceTimersByTime(HISTORY_DELETION_UNDO_MS - 1);
    expect(harness.commits).toEqual([]);
    expect(harness.coordinator.current()?.entries).toEqual([{ id: "entry-1" }]);

    vi.advanceTimersByTime(1);
    expect(harness.commits.map((pending) => pending.entries)).toEqual([[{ id: "entry-1" }]]);
    expect(harness.coordinator.current()).toBeNull();
  });

  it("restores the exact individual or grouped payload captured for Undo", () => {
    const harness = coordinatorHarness();
    const entries = [{ id: "group-child-1" }, { id: "group-child-2" }];
    const snapshot = { entryIds: entries.map((entry) => entry.id) };
    const pending = harness.coordinator.begin(entries, snapshot);

    expect(harness.coordinator.undo(pending.token)).toBe(true);
    expect(harness.restores).toEqual([{ entries, snapshot, token: pending.token }]);
    expect(harness.commits).toEqual([]);
  });

  it("commits an older deletion before giving a rapid second deletion a new window", () => {
    const harness = coordinatorHarness();
    const first = harness.coordinator.begin([{ id: "entry-1" }], { entryIds: ["entry-1"] });
    const second = harness.coordinator.begin([{ id: "entry-2" }], { entryIds: ["entry-2"] });

    expect(second.token).toBeGreaterThan(first.token);
    expect(harness.commits).toEqual([first]);
    expect(harness.coordinator.current()).toEqual(second);
    expect(harness.coordinator.undo(second.token)).toBe(true);
    expect(harness.restores).toEqual([second]);
  });

  it("restores only the latest deletion after rapid optimistic state updates", () => {
    let visibleIds = ["entry-1", "entry-2"];
    const commits: string[][] = [];
    const coordinator = createHistoryDeletionCoordinator<Entry, Snapshot>({
      onCommit: ({ entries }) => commits.push(entries.map((entry) => entry.id)),
      onPendingChange: () => undefined,
      onRestore: ({ snapshot }) => {
        visibleIds = snapshot.entryIds;
      }
    });

    const firstSnapshot = { entryIds: [...visibleIds] };
    visibleIds = visibleIds.filter((id) => id !== "entry-1");
    coordinator.begin([{ id: "entry-1" }], firstSnapshot);

    const secondSnapshot = { entryIds: [...visibleIds] };
    visibleIds = visibleIds.filter((id) => id !== "entry-2");
    const second = coordinator.begin([{ id: "entry-2" }], secondSnapshot);
    coordinator.undo(second.token);

    expect(commits).toEqual([["entry-1"]]);
    expect(visibleIds).toEqual(["entry-2"]);
  });

  it("ignores stale timeouts and callbacks from an older Undo state", () => {
    const harness = coordinatorHarness();
    const first = harness.coordinator.begin([{ id: "entry-1" }], { entryIds: ["entry-1"] });
    const second = harness.coordinator.begin([{ id: "entry-2" }], { entryIds: ["entry-2"] });

    expect(harness.coordinator.expire(first.token)).toBe(false);
    expect(harness.coordinator.undo(first.token)).toBe(false);
    expect(harness.coordinator.current()).toEqual(second);
  });
});

function coordinatorHarness() {
  const commits: PendingHistoryDeletion<Entry, Snapshot>[] = [];
  const restores: PendingHistoryDeletion<Entry, Snapshot>[] = [];
  const pendingChanges: Array<PendingHistoryDeletion<Entry, Snapshot> | null> = [];
  const coordinator = createHistoryDeletionCoordinator<Entry, Snapshot>({
    onCommit: (pending) => commits.push(pending),
    onPendingChange: (pending) => pendingChanges.push(pending),
    onRestore: (pending) => restores.push(pending)
  });
  return { commits, coordinator, pendingChanges, restores };
}
