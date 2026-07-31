import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIMELINE_DELETE_NOTICE_EXIT_MS,
  TIMELINE_DELETE_UNDO_DELAY_MS,
  TimelineDeleteUndoController,
  type TimelineDeleteCommit,
  type TimelineDeleteTransaction
} from "@/lib/timeline-delete-undo-controller";
import type { TimeEntryRow } from "@/lib/queries";

function entry(id: string, description = "Planning"): TimeEntryRow {
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "work",
    categoryName: "Work",
    categoryColor: "blue",
    description,
    startedAt: "2026-07-31T09:00:00.000Z",
    stoppedAt: "2026-07-31T09:30:00.000Z",
    updatedAt: "2026-07-31T09:30:00.000Z",
    durationSeconds: 1800,
    placeId: null,
    placeName: null,
    source: "manual",
    confidence: "high",
    reviewStatus: "confirmed",
    tagNames: [],
    tags: []
  };
}

function request(entries: TimeEntryRow[]) {
  return { entries, label: `${entries.length} entries deleted` };
}

function deferred<T>() {
  let reject: (reason?: unknown) => void = () => undefined;
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function successfulCommit() {
  return vi.fn<TimelineDeleteCommit>(() => Promise.resolve());
}

describe("TimelineDeleteUndoController", () => {
  afterEach(() => vi.useRealTimers());

  it("stages one deletion for exactly five seconds before committing", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one")]));
    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["one"]));
    expect(commit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TIMELINE_DELETE_UNDO_DELAY_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect((commit.mock.calls[0]?.[0] as TimelineDeleteTransaction).ids).toEqual(["one"]);
  });

  it("undoes a pending deletion without sending a request", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one")]));
    controller.undoPendingDelete();
    await vi.advanceTimersByTimeAsync(TIMELINE_DELETE_UNDO_DELAY_MS);

    expect(controller.getState().hiddenEntryIds).toEqual(new Set());
    expect(controller.getState().pending).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps the Undo notice present only for its short exit after restoration", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one")]));
    expect(controller.getState().notice).toMatchObject({ isExiting: false, token: 1 });

    controller.undoPendingDelete();
    expect(controller.getState().notice).toMatchObject({ isExiting: true, token: 1 });
    await vi.advanceTimersByTimeAsync(TIMELINE_DELETE_NOTICE_EXIT_MS - 1);
    expect(controller.getState().notice).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().notice).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it("uses one transaction with every ID for a grouped deletion", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one"), entry("two"), entry("three")]));
    await vi.advanceTimersByTimeAsync(TIMELINE_DELETE_UNDO_DELAY_MS);

    expect(commit).toHaveBeenCalledTimes(1);
    expect((commit.mock.calls[0]?.[0] as TimelineDeleteTransaction).ids).toEqual(["one", "two", "three"]);
  });

  it("finalises the prior deletion once and keeps the newer one undoable", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("older")]));
    controller.requestDelete(request([entry("newer")]));

    expect(commit).toHaveBeenCalledTimes(1);
    expect((commit.mock.calls[0]?.[0] as TimelineDeleteTransaction).ids).toEqual(["older"]);
    expect(controller.getState().pending?.ids).toEqual(["newer"]);
    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["older", "newer"]));

    controller.undoPendingDelete();
    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["older"]));
  });

  it("does not let an older successful completion dismiss a newer notice", async () => {
    vi.useFakeTimers();
    const older = deferred<void>();
    const newer = deferred<void>();
    const commit = vi.fn((transaction: TimelineDeleteTransaction) => transaction.ids[0] === "older"
      ? older.promise
      : newer.promise);
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("older")]));
    controller.requestDelete(request([entry("newer")]));
    older.resolve();
    await Promise.resolve();

    expect(controller.getState().pending?.ids).toEqual(["newer"]);
    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["older", "newer"]));
  });

  it("restores only an older failed deletion while preserving the newer Undo window", async () => {
    vi.useFakeTimers();
    const older = deferred<void>();
    const commit = vi.fn((transaction: TimelineDeleteTransaction) => transaction.ids[0] === "older"
      ? older.promise
      : Promise.resolve());
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("older")]));
    controller.requestDelete(request([entry("newer")]));
    older.reject(new Error("Delete service unavailable"));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().pending?.ids).toEqual(["newer"]);
    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["newer"]));
    expect(controller.getState().error).toBe("Delete service unavailable");
  });

  it("ignores a stale timeout after a replacement", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("older")]));
    await vi.advanceTimersByTimeAsync(1_000);
    controller.requestDelete(request([entry("newer")]));
    await vi.advanceTimersByTimeAsync(4_000);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(controller.getState().pending?.ids).toEqual(["newer"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(commit).toHaveBeenCalledTimes(2);
    expect((commit.mock.calls[1]?.[0] as TimelineDeleteTransaction).ids).toEqual(["newer"]);
  });

  it("finalises a pending deletion exactly once during cleanup", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one")]));
    controller.finalizePendingDelete();
    controller.finalizePendingDelete();
    await Promise.resolve();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[1]).toEqual({ keepalive: true });
  });

  it("finalises a pending deletion exactly once when the Timeline unmounts", async () => {
    vi.useFakeTimers();
    const commit = successfulCommit();
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one")]));
    controller.dispose();
    controller.dispose();
    await Promise.resolve();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[1]).toEqual({ keepalive: true });
  });

  it("restores an exact failed group without restoring unrelated hidden IDs", async () => {
    vi.useFakeTimers();
    const first = deferred<void>();
    const commit = vi.fn((transaction: TimelineDeleteTransaction) => transaction.ids.includes("one")
      ? first.promise
      : Promise.resolve());
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one"), entry("two")]));
    controller.requestDelete(request([entry("three")]));
    first.reject(new Error("Group delete failed"));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["three"]));
    expect(controller.getState().error).toBe("Group delete failed");

    controller.requestDelete(request([entry("four")]));
    expect(controller.getState().error).toBeNull();
  });

  it("keeps a successful deletion hidden until refreshed entries reconcile", async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => undefined);
    const controller = new TimelineDeleteUndoController(commit, () => undefined);

    controller.requestDelete(request([entry("one")]));
    await vi.advanceTimersByTimeAsync(TIMELINE_DELETE_UNDO_DELAY_MS);
    await Promise.resolve();

    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["one"]));
    controller.reconcileEntryIds(new Set(["one"]));
    expect(controller.getState().hiddenEntryIds).toEqual(new Set(["one"]));
    controller.reconcileEntryIds(new Set());
    expect(controller.getState().hiddenEntryIds).toEqual(new Set());
  });
});
