import { describe, expect, it, vi } from "vitest";
import {
  activeTimerElapsedSeconds,
  activeTimerPresentation,
  applySuggestionToRunningTimer,
  buildMobileQuickActions,
  createBlankTimerStartGate,
  createGenerationScopedExitCoordinator,
  createMutationAcceptance,
  createOptimisticTimerStartReconciler,
  createSerializedMutationQueue,
  createSupersededStopRollbackTracker,
  dashboardActiveTimerEntry,
  displayTimerDescription,
  filterPendingDeletedTimeEntries,
  MISSING_QUEUED_TIMER_DELETE_MESSAGE,
  MISSING_QUEUED_TIMER_START_MESSAGE,
  mobileTimeEntryById,
  optimisticDeleteTimeEntry,
  optimisticPatchTimeEntry,
  optimisticRestoreTimeEntries,
  optimisticStartTimer,
  optimisticStopActiveTimer,
  projectPendingTimerStops,
  replaceOptimisticTimeEntryId,
  requireQueuedTimerStartRemoval,
  requireQueuedTimerStartUpdate,
  restoreDeletedTimeEntriesSafely,
  restoreEntriesWithPersistedIds,
  restoreFailedDeletionSafely,
  rollbackOptimisticStopSafely,
  rollbackOptimisticTimeEntryPatch,
  rollbackRejectedOptimisticTimerStart,
  runningTimerSheetElapsedSeconds,
  shouldAwaitTimerMutationAcceptance
} from "./timerPresentation";
import type { MobileBootstrap } from "./api";
import { createDeletionCoordinator } from "./historyDeletion";

describe("mobile timer presentation", () => {
  it("uses a task-description prompt instead of Running for blank active timers", () => {
    expect(
      activeTimerPresentation({
        categoryColor: null,
        id: "entry-1",
        categoryId: null,
        categoryName: null,
        clientName: null,
        confidence: "manual",
        description: null,
        durationSeconds: 0,
        placeName: null,
        projectColor: null,
        projectId: null,
        projectName: null,
        reviewStatus: "confirmed",
        source: "manual",
        startedAt: "2026-07-12T12:00:00.000Z",
        stoppedAt: null
      })
    ).toEqual({
      categoryLabel: "Uncategorized",
      title: "Add a task description"
    });
  });

  it("hides the old mobile start-activity placeholder", () => {
    expect(displayTimerDescription({ description: "Start activity" })).toBeNull();
  });

  it("does not expose a presentation-retained deleted timer to the Today card", () => {
    const retained = { id: "entry-running" };
    expect(dashboardActiveTimerEntry({
      activeEntry: null,
      pendingDeletionEntryIds: new Set([retained.id]),
      presentedEntry: retained
    })).toBeNull();
    expect(dashboardActiveTimerEntry({
      activeEntry: null,
      pendingDeletionEntryIds: new Set(),
      presentedEntry: retained
    })).toBe(retained);
  });

  it("uses the same exact active timestamp for the card and running edit sheet", () => {
    const nowMs = Date.parse("2026-07-14T12:35:15.000Z");
    const cardElapsed = activeTimerElapsedSeconds({
      durationSeconds: 0,
      startedAt: "2026-07-14T12:34:47.000Z"
    }, nowMs);

    expect(cardElapsed).toBe(28);
    expect(runningTimerSheetElapsedSeconds({
      activeElapsedSeconds: cardElapsed,
      nowMs,
      previewStartAt: new Date("2026-07-14T12:34:00.000Z"),
      startTimeEdited: false
    })).toBe(cardElapsed);
  });

  it("only previews a minute-level start time after the user explicitly edits it", () => {
    expect(runningTimerSheetElapsedSeconds({
      activeElapsedSeconds: 28,
      nowMs: Date.parse("2026-07-14T12:35:15.000Z"),
      previewStartAt: new Date("2026-07-14T12:34:00.000Z"),
      startTimeEdited: true
    })).toBe(75);
  });

  it("applies only the allowlisted suggestion fields with tags in one update and no timer start", async () => {
    const updateEntry = vi.fn().mockResolvedValue({ ok: true });
    const startTimer = vi.fn();

    await applySuggestionToRunningTimer({
      entryId: "entry-running",
      suggestion: {
        categoryId: "focus",
        description: "Design review",
        tagNames: ["Planning", "Deep work"]
      },
      updateEntry
    });

    expect(updateEntry).toHaveBeenCalledOnce();
    expect(updateEntry).toHaveBeenCalledWith("entry-running", {
      categoryId: "focus",
      description: "Design review",
      tagNames: ["Planning", "Deep work"]
    });
    expect(startTimer).not.toHaveBeenCalled();
  });

  it("updates, stops and deletes a timer optimistically without waiting for a reload", () => {
    const original = bootstrapWithActiveEntry();
    const patched = optimisticPatchTimeEntry(original, "entry-running", {
      categoryId: "focus",
      description: "Architecture review"
    });
    expect(patched?.activeEntry).toMatchObject({
      categoryId: "focus",
      categoryName: "Focus",
      description: "Architecture review"
    });

    const stopped = optimisticStopActiveTimer(patched, "2026-07-16T09:30:00.000Z");
    expect(stopped?.activeEntry).toBeNull();
    expect(stopped?.entries.find((entry) => entry.id === "entry-running")).toMatchObject({
      durationSeconds: 1800,
      stoppedAt: "2026-07-16T09:30:00.000Z"
    });

    const deleted = optimisticDeleteTimeEntry(stopped, "entry-running");
    expect(deleted?.entries.some((entry) => entry.id === "entry-running")).toBe(false);
    expect(deleted?.historyEntries?.some((entry) => entry.id === "entry-running")).toBe(false);
  });

  it("updates normalized tag metadata across every entry pool and leaves the exact snapshot available for rollback", () => {
    const snapshot = bootstrapWithActiveEntry();
    const patched = optimisticPatchTimeEntry(snapshot, "entry-running", {
      description: "Architecture review #planning",
      tagNames: ["Planning"]
    });

    expect(patched?.activeEntry?.tags).toEqual([
      { id: "optimistic-tag:planning", name: "Planning", normalizedName: "planning" }
    ]);
    expect(patched?.historyEntries?.[0].tagNames).toEqual(["Planning"]);
    expect(patched?.tags).toEqual([
      { id: "optimistic-tag:planning", name: "Planning", normalizedName: "planning", usageCount: 0 }
    ]);
    expect(snapshot.activeEntry?.tagNames).toBeUndefined();
    expect(snapshot.historyEntries?.[0].tags).toBeUndefined();
  });

  it("restores an optimistically deleted entry without replacing newer dashboard state", () => {
    const snapshot = bootstrapWithActiveEntry();
    const deleted = optimisticDeleteTimeEntry(snapshot, "entry-running");
    const withNewerState = deleted
      ? { ...deleted, workspace: { ...deleted.workspace, name: "Newer workspace state" } }
      : deleted;
    const restored = optimisticRestoreTimeEntries(withNewerState, snapshot, ["entry-running"]);

    expect(restored?.entries.some((entry) => entry.id === "entry-running")).toBe(true);
    expect(restored?.historyEntries?.some((entry) => entry.id === "entry-running")).toBe(true);
    expect(restored?.workspace.name).toBe("Newer workspace state");
  });

  it("filters original and canonical pending-deletion IDs from every reconciliation pool", () => {
    const original = bootstrapWithActiveEntry();
    const persistedCopy = { ...original.entries[0], id: "entry-server" };
    const withEveryPool: MobileBootstrap = {
      ...original,
      activeEntry: persistedCopy,
      entries: [original.entries[0], persistedCopy],
      historyEntries: [original.entries[0], persistedCopy],
      dayEntries: [original.entries[0], persistedCopy],
      weekEntries: [original.entries[0], persistedCopy]
    };
    const filtered = filterPendingDeletedTimeEntries(
      withEveryPool,
      new Set(["entry-running", "entry-server"])
    );

    expect(filtered?.activeEntry).toBeNull();
    expect(filtered?.entries).toEqual([]);
    expect(filtered?.historyEntries).toEqual([]);
    expect(filtered?.dayEntries).toEqual([]);
    expect(filtered?.weekEntries).toEqual([]);
  });

  it("restores exact entry metadata and active placement into newer surrounding state", () => {
    const snapshot = bootstrapWithActiveEntry();
    snapshot.activeEntry = {
      ...snapshot.activeEntry!,
      categoryId: "focus",
      categoryName: "Focus",
      description: "Exact captured work",
      tagNames: ["Planning"]
    };
    snapshot.entries = [snapshot.activeEntry];
    snapshot.historyEntries = [snapshot.activeEntry];
    const deleted = filterPendingDeletedTimeEntries(snapshot, new Set(["entry-running"]));
    const refreshed = deleted ? {
      ...deleted,
      workspace: { ...deleted.workspace, name: "New workspace name" },
      categories: [...deleted.categories, category({ id: "new", name: "New" })]
    } : null;

    const restored = optimisticRestoreTimeEntries(refreshed, snapshot, ["entry-running"]);

    expect(restored?.activeEntry).toEqual(snapshot.activeEntry);
    expect(restored?.entries).toEqual([snapshot.activeEntry]);
    expect(restored?.historyEntries).toEqual([snapshot.activeEntry]);
    expect(restored?.workspace.name).toBe("New workspace name");
    expect(restored?.categories.at(-1)?.id).toBe("new");
  });

  it("restores exact optimistic metadata under its reconciled persisted ID", () => {
    const snapshot = bootstrapWithActiveEntry();
    snapshot.activeEntry = {
      ...snapshot.activeEntry!,
      id: "optimistic-active-timer:captured",
      description: "Captured before persistence",
      tagNames: ["Exact"]
    };
    snapshot.entries = [snapshot.activeEntry];
    snapshot.historyEntries = [snapshot.activeEntry];
    const deleted = optimisticDeleteTimeEntry(snapshot, snapshot.activeEntry.id);

    const restored = restoreEntriesWithPersistedIds(
      deleted,
      snapshot,
      [snapshot.activeEntry.id],
      new Map([[snapshot.activeEntry.id, "entry-persisted"]])
    );

    expect(restored?.activeEntry).toEqual({
      ...snapshot.activeEntry,
      id: "entry-persisted"
    });
    expect(restored?.entries).toEqual([{ ...snapshot.activeEntry, id: "entry-persisted" }]);
    expect(restored?.historyEntries).toEqual([{ ...snapshot.activeEntry, id: "entry-persisted" }]);
  });

  it("does not restore a failed deleted active timer over a newly started timer", () => {
    const snapshot = bootstrapWithActiveEntry();
    const afterDeletion = optimisticDeleteTimeEntry(snapshot, "entry-running");
    const newActive = { ...snapshot.entries[0], id: "entry-new" };
    const withNewTimer = optimisticStartTimer(afterDeletion, newActive);

    const restored = restoreDeletedTimeEntriesSafely(
      withNewTimer,
      snapshot,
      ["entry-running"],
      new Map()
    );

    expect(restored?.activeEntry?.id).toBe("entry-new");
    expect(restored?.entries.some((entry) => entry.id === "entry-running")).toBe(false);
    expect(restored?.historyEntries?.some((entry) => entry.id === "entry-running")).toBe(false);
  });

  it("rolls back only failed entry fields while preserving a newer active timer", () => {
    const snapshot = bootstrapWithActiveEntry();
    snapshot.activeEntry = {
      ...snapshot.activeEntry!,
      description: "Before edit",
      tagNames: ["Before"]
    };
    snapshot.entries = [snapshot.activeEntry];
    snapshot.historyEntries = [snapshot.activeEntry];
    const patch = {
      description: "Unsaved edit",
      tagNames: ["Unsaved"]
    };
    const optimisticallyPatched = optimisticPatchTimeEntry(
      snapshot,
      "entry-running",
      patch
    );
    const newerTimer = {
      ...snapshot.activeEntry,
      id: "entry-newer-active",
      description: "Newer timer",
      startedAt: "2026-07-16T10:00:00.000Z"
    };
    const withNewerTimer = optimisticStartTimer(optimisticallyPatched, newerTimer);

    const rolledBack = rollbackOptimisticTimeEntryPatch(
      withNewerTimer,
      snapshot,
      "entry-running",
      patch,
      new Map()
    );

    expect(rolledBack?.activeEntry?.id).toBe(newerTimer.id);
    expect(rolledBack?.activeEntry?.description).toBe("Newer timer");
    expect(mobileTimeEntryById(rolledBack, "entry-running")).toMatchObject({
      description: "Before edit",
      stoppedAt: newerTimer.startedAt,
      tagNames: ["Before"]
    });
  });

  it("removes only a failed optimistic new tag while preserving unrelated newer catalog tags", () => {
    const snapshot = bootstrapWithActiveEntry();
    const existingTag = {
      id: "tag-existing",
      name: "Existing",
      normalizedName: "existing",
      usageCount: 3
    };
    const taggedEntry = {
      ...snapshot.activeEntry!,
      tagNames: [existingTag.name],
      tags: [existingTag]
    };
    snapshot.activeEntry = taggedEntry;
    snapshot.entries = [taggedEntry];
    snapshot.historyEntries = [taggedEntry];
    snapshot.tags = [existingTag];
    const patch = { tagNames: [existingTag.name, "Failed New"] };
    const patched = optimisticPatchTimeEntry(snapshot, taggedEntry.id, patch);
    const unrelatedNewTag = {
      id: "tag-unrelated-new",
      name: "Unrelated New",
      normalizedName: "unrelated new",
      usageCount: 1
    };
    const withUnrelatedNewerCatalogState = patched ? {
      ...patched,
      tags: [...(patched.tags ?? []), unrelatedNewTag]
    } : patched;

    const rolledBack = rollbackOptimisticTimeEntryPatch(
      withUnrelatedNewerCatalogState,
      snapshot,
      taggedEntry.id,
      patch,
      new Map()
    );

    expect(rolledBack?.activeEntry?.tagNames).toEqual([existingTag.name]);
    expect(rolledBack?.tags).toEqual([existingTag, unrelatedNewTag]);
  });

  it("does not resurrect a failed optimistic Stop over a newer active timer", () => {
    const snapshot = bootstrapWithActiveEntry();
    const stopped = optimisticStopActiveTimer(snapshot, "2026-07-16T09:30:00.000Z");
    const newerTimer = {
      ...snapshot.activeEntry!,
      id: "entry-newer-after-stop",
      description: "New current timer",
      startedAt: "2026-07-16T09:31:00.000Z"
    };
    const withNewerTimer = optimisticStartTimer(stopped, newerTimer);

    const rolledBack = rollbackOptimisticStopSafely(
      withNewerTimer,
      snapshot,
      "entry-running",
      new Map()
    );

    expect(rolledBack?.activeEntry?.id).toBe(newerTimer.id);
    expect(mobileTimeEntryById(rolledBack, "entry-running")?.stoppedAt)
      .toBe(newerTimer.startedAt);
  });

  it("projects a durable canonical Stop over stale bootstrap before presentation", () => {
    const snapshot = bootstrapWithActiveEntry();
    const projected = projectPendingTimerStops(snapshot, [{
      clientEventId: "mobile-timer-stop:one",
      occurredAt: "2026-07-16T09:30:00.000Z",
      queuedAt: "2026-07-16T09:30:00.100Z",
      targetEntryId: snapshot.activeEntry!.id,
      userId: "user-a",
      workspaceId: "workspace-a"
    }]);

    expect(projected?.activeEntry).toBeNull();
    expect(mobileTimeEntryById(projected, snapshot.activeEntry!.id)?.stoppedAt)
      .toBe("2026-07-16T09:30:00.000Z");
  });

  it("uses a durable optimistic-to-canonical correlation when projecting a pending Stop", () => {
    const snapshot = bootstrapWithActiveEntry();
    const optimisticId = "optimistic-active-timer:pending-stop";
    const projected = projectPendingTimerStops(snapshot, [{
      clientEventId: "mobile-timer-stop:two",
      occurredAt: "2026-07-16T09:31:00.000Z",
      optimisticEntryId: optimisticId,
      queuedAt: "2026-07-16T09:31:00.100Z",
      userId: "user-a",
      workspaceId: "workspace-a"
    }], new Map([[optimisticId, snapshot.activeEntry!.id]]));

    expect(projected?.activeEntry).toBeNull();
  });

  it("does not hide a newer active timer for an older pending Stop", () => {
    const snapshot = bootstrapWithActiveEntry();
    const projected = projectPendingTimerStops(snapshot, [{
      clientEventId: "mobile-timer-stop:three",
      occurredAt: "2026-07-16T09:30:00.000Z",
      queuedAt: "2026-07-16T09:30:00.100Z",
      targetEntryId: "entry-older",
      userId: "user-a",
      workspaceId: "workspace-a"
    }]);

    expect(projected).toBe(snapshot);
    expect(projected?.activeEntry?.id).toBe(snapshot.activeEntry!.id);
  });

  it("keeps the newer timer active and closes the older timer at its exact start when Stop fails", async () => {
    const base = bootstrapWithoutActiveEntry();
    const olderTimer = {
      ...optimisticEntryFrom(base, "optimistic-active-timer:older"),
      startedAt: "2026-07-16T09:00:00.000Z"
    };
    let current: MobileBootstrap | null = optimisticStartTimer(base, olderTimer);
    const beforeStop = current;
    current = optimisticStopActiveTimer(current, "2026-07-16T09:30:00.000Z");
    const newerTimer = {
      ...olderTimer,
      id: "optimistic-active-timer:newer-success",
      startedAt: "2026-07-16T09:31:00.000Z"
    };
    current = optimisticStartTimer(current, newerTimer);

    const queue = createSerializedMutationQueue();
    const tracker = createSupersededStopRollbackTracker();
    const olderStart = deferred<void>();
    const failedStop = deferred<void>();
    const newerStart = deferred<void>();
    const olderStartCompletion = queue.enqueue(() => olderStart.promise);
    const stopCompletion = queue.enqueue(() => failedStop.promise).catch(() => {
      tracker.capture(newerTimer.id, beforeStop);
      current = rollbackOptimisticStopSafely(
        current,
        beforeStop,
        olderTimer.id,
        new Map()
      );
    });
    const newerStartCompletion = queue.enqueue(() => newerStart.promise).then(() => {
      tracker.settle(newerTimer.id);
    });

    olderStart.resolve();
    await olderStartCompletion;
    failedStop.reject(new Error("Stop rejected"));
    await stopCompletion;
    expect(current?.activeEntry?.id).toBe(newerTimer.id);
    expect(mobileTimeEntryById(current, olderTimer.id)).toMatchObject({
      durationSeconds: 1860,
      stoppedAt: newerTimer.startedAt
    });

    newerStart.resolve();
    await newerStartCompletion;
    expect(current?.activeEntry?.id).toBe(newerTimer.id);
    expect(tracker.consume(newerTimer.id, null)).toBeNull();
  });

  it("restores the older timer active when both its Stop and the newer serialized start fail", async () => {
    const base = bootstrapWithoutActiveEntry();
    const olderTimer = {
      ...optimisticEntryFrom(base, "optimistic-active-timer:older-double-failure"),
      startedAt: "2026-07-16T09:00:00.000Z"
    };
    let current: MobileBootstrap | null = optimisticStartTimer(base, olderTimer);
    const beforeStop = current;
    current = optimisticStopActiveTimer(current, "2026-07-16T09:30:00.000Z");
    const beforeNewerStart = current;
    const newerTimer = {
      ...olderTimer,
      id: "optimistic-active-timer:newer-double-failure",
      startedAt: "2026-07-16T09:31:00.000Z"
    };
    current = optimisticStartTimer(current, newerTimer);

    const queue = createSerializedMutationQueue();
    const tracker = createSupersededStopRollbackTracker();
    const olderStart = deferred<void>();
    const failedStop = deferred<void>();
    const failedNewerStart = deferred<void>();
    const olderStartCompletion = queue.enqueue(() => olderStart.promise);
    const stopCompletion = queue.enqueue(() => failedStop.promise).catch(() => {
      tracker.capture(newerTimer.id, beforeStop);
      current = rollbackOptimisticStopSafely(
        current,
        beforeStop,
        olderTimer.id,
        new Map()
      );
    });
    const newerStartCompletion = queue.enqueue(() => failedNewerStart.promise).catch(() => {
      current = rollbackRejectedOptimisticTimerStart(
        current,
        tracker.consume(newerTimer.id, beforeNewerStart),
        newerTimer.id
      );
    });

    olderStart.resolve();
    await olderStartCompletion;
    failedStop.reject(new Error("Stop rejected"));
    await stopCompletion;
    expect(current?.activeEntry?.id).toBe(newerTimer.id);
    expect(mobileTimeEntryById(current, olderTimer.id)?.stoppedAt)
      .toBe(newerTimer.startedAt);

    failedNewerStart.reject(new Error("Newer start rejected"));
    await newerStartCompletion;
    expect(current?.activeEntry).toEqual(olderTimer);
    expect(mobileTimeEntryById(current, olderTimer.id)?.stoppedAt).toBeNull();
    expect(mobileTimeEntryById(current, newerTimer.id)).toBeNull();
    expect(tracker.consume(newerTimer.id, null)).toBeNull();
  });

  it("restores a failed optimistic Stop when no newer timer owns the active slot", () => {
    const snapshot = bootstrapWithActiveEntry();
    const stopped = optimisticStopActiveTimer(snapshot, "2026-07-16T09:30:00.000Z");

    const rolledBack = rollbackOptimisticStopSafely(
      stopped,
      snapshot,
      "entry-running",
      new Map()
    );

    expect(rolledBack?.activeEntry).toEqual(snapshot.activeEntry);
    expect(mobileTimeEntryById(rolledBack, "entry-running")?.stoppedAt).toBeNull();
  });

  it("gates same-tick bare Play acceptance before React can commit state", () => {
    const gate = createBlankTimerStartGate();
    const addOptimisticEntry = vi.fn();
    const enqueueApiMutation = vi.fn();
    const createTimerEvent = vi.fn();

    const pressPlay = () => {
      const token = gate.claim();
      if (token === null) return null;
      addOptimisticEntry();
      enqueueApiMutation();
      createTimerEvent();
      gate.bindEntry(token, `optimistic:${token}`);
      return token;
    };

    const first = pressPlay();
    const second = pressPlay();

    expect(first).toBe(1);
    expect(second).toBeNull();
    expect(addOptimisticEntry).toHaveBeenCalledOnce();
    expect(enqueueApiMutation).toHaveBeenCalledOnce();
    expect(createTimerEvent).toHaveBeenCalledOnce();
    expect(gate.release(99)).toBe(false);
    expect(gate.release(first as number)).toBe(true);
    expect(gate.claim()).toBe(2);
  });

  it("retains the blank Play claim across RAF until that sheet generation is presented", () => {
    const gate = createBlankTimerStartGate();
    const firstToken = requiredDeletion(gate.claim());
    expect(gate.bindEntry(firstToken, "optimistic-active-timer:opening")).toBe(true);

    // The RAF callback has opened the blank presentation, but the modal has
    // not yet intercepted another dashboard Play press.
    const presentationId = 41;
    expect(gate.claim()).toBeNull();
    expect(gate.current()).toEqual({
      entryId: "optimistic-active-timer:opening",
      token: firstToken
    });

    const onPresented = (completedPresentationId: number) => {
      if (completedPresentationId !== presentationId) return false;
      return gate.release(firstToken);
    };
    expect(onPresented(40)).toBe(false);
    expect(gate.claim()).toBeNull();
    expect(onPresented(presentationId)).toBe(true);
    expect(gate.claim()).toBe(2);
  });

  it("defers a canonical active collision until the unresolved start registers its alias", () => {
    const optimisticId = "optimistic-active-timer:poll-before-response";
    const canonicalId = "entry-canonical";
    const base = bootstrapWithoutActiveEntry();
    const optimisticEntry = optimisticEntryFrom(base, optimisticId);
    const snapshot: MobileBootstrap | null = optimisticStartTimer(base, optimisticEntry);
    let current: MobileBootstrap | null = snapshot;
    let now = 1_000;
    let scheduledDelay = -1;
    const commits = vi.fn();
    const reconciler = createOptimisticTimerStartReconciler();
    const coordinator = createDeletionCoordinator<
      MobileBootstrap["entries"][number],
      MobileBootstrap | null
    >({
      clearTimer: () => undefined,
      now: () => now,
      onCommit: commits,
      onPendingChange: () => undefined,
      onRestore: ({ entries, snapshot: captured }) => {
        current = restoreEntriesWithPersistedIds(
          current,
          captured,
          entries.map((entry) => entry.id),
          new Map([[optimisticId, canonicalId]])
        );
      },
      setTimer: (_callback, delay) => {
        scheduledDelay = delay;
        return 1;
      }
    });

    expect(reconciler.begin(optimisticId)).toBe(true);
    const pending = requiredDeletion(coordinator.prepare([optimisticEntry], snapshot));
    current = optimisticDeleteTimeEntry(current, optimisticId);
    expect(coordinator.activate(pending.token)).toBe(true);
    expect(scheduledDelay).toBe(5_000);

    expect(reconciler.deferExternalActiveEntry({
      deletedActiveEntryId: optimisticId,
      externalActiveEntryId: canonicalId,
      pendingEntryIds: coordinator.pendingEntryIds()
    })).toBe(true);
    expect(coordinator.current()?.token).toBe(pending.token);

    const canonicalEntry = { ...optimisticEntry, id: canonicalId };
    const pollBootstrap = current ? {
      ...current,
      activeEntry: canonicalEntry,
      entries: [canonicalEntry],
      historyEntries: [canonicalEntry]
    } : current;
    current = filterPendingDeletedTimeEntries(
      pollBootstrap,
      new Set([
        ...coordinator.pendingEntryIds(),
        ...reconciler.deferredExternalActiveEntryIds()
      ])
    );
    expect(current?.activeEntry).toBeNull();
    expect(mobileTimeEntryById(current, canonicalId)).toBeNull();

    expect(coordinator.registerPendingId(pending.token, canonicalId)).toBe(true);
    expect(reconciler.settle(optimisticId, "persisted")).toBe(canonicalId);
    current = filterPendingDeletedTimeEntries(current, coordinator.pendingEntryIds());
    expect(current?.activeEntry).toBeNull();
    expect(mobileTimeEntryById(current, canonicalId)).toBeNull();
    expect(coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: optimisticId,
      externalActiveEntryId: canonicalId
    })).toEqual({
      collided: false,
      pendingEntryIds: new Set([optimisticId, canonicalId])
    });

    now = 5_999;
    expect(coordinator.undo(pending.token)).toBe(true);
    expect(current?.activeEntry?.id).toBe(canonicalId);
    expect(commits).not.toHaveBeenCalled();
  });

  it("commits pending active deletion for a genuine external timer after start settlement", () => {
    const optimisticId = "optimistic-active-timer:settled";
    const externalId = "entry-external";
    const base = bootstrapWithoutActiveEntry();
    const optimisticEntry = optimisticEntryFrom(base, optimisticId);
    const snapshot = optimisticStartTimer(base, optimisticEntry);
    const commits = vi.fn();
    const reconciler = createOptimisticTimerStartReconciler();
    const coordinator = createDeletionCoordinator<
      MobileBootstrap["entries"][number],
      MobileBootstrap | null
    >({
      onCommit: commits,
      onPendingChange: () => undefined,
      onRestore: () => undefined,
      setTimer: () => 1
    });

    reconciler.begin(optimisticId);
    reconciler.settle(optimisticId, "persisted");
    const pending = requiredDeletion(coordinator.prepare([optimisticEntry], snapshot));
    coordinator.activate(pending.token);

    expect(reconciler.deferExternalActiveEntry({
      deletedActiveEntryId: optimisticId,
      externalActiveEntryId: externalId,
      pendingEntryIds: coordinator.pendingEntryIds()
    })).toBe(false);
    expect(coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: optimisticId,
      externalActiveEntryId: externalId
    }).collided).toBe(true);
    expect(commits).toHaveBeenCalledOnce();
    expect(coordinator.undo(pending.token)).toBe(false);
  });

  it("keeps canonical refresh hidden until expiry durably targets that canonical entry", () => {
    const optimisticId = "optimistic-active-timer:expiry-correlation";
    const canonicalId = "entry-expiry-canonical";
    const base = bootstrapWithoutActiveEntry();
    const optimisticEntry = optimisticEntryFrom(base, optimisticId);
    const snapshot: MobileBootstrap | null = optimisticStartTimer(base, optimisticEntry);
    const canonicalEntry = { ...optimisticEntry, id: canonicalId };
    let current: MobileBootstrap | null = optimisticDeleteTimeEntry(snapshot, optimisticId);
    let serverActiveEntry: MobileBootstrap["activeEntry"] = canonicalEntry;
    let now = 10_000;
    let expiry: (() => void) | null = null;
    const deletedCanonicalIds: string[] = [];
    const reconciler = createOptimisticTimerStartReconciler();
    const coordinator = createDeletionCoordinator<
      MobileBootstrap["entries"][number],
      MobileBootstrap | null
    >({
      clearTimer: () => undefined,
      now: () => now,
      onCommit: ({ entries }) => {
        for (const entry of entries) {
          deletedCanonicalIds.push(entry.id === optimisticId ? canonicalId : entry.id);
        }
        serverActiveEntry = null;
      },
      onPendingChange: () => undefined,
      onRestore: () => undefined,
      setTimer: (callback) => {
        expiry = callback;
        return 1;
      }
    });
    reconciler.begin(optimisticId);
    const pending = requiredDeletion(coordinator.prepare([optimisticEntry], snapshot));
    coordinator.activate(pending.token);

    expect(reconciler.deferExternalActiveEntry({
      deletedActiveEntryId: optimisticId,
      externalActiveEntryId: canonicalId,
      pendingEntryIds: coordinator.pendingEntryIds()
    })).toBe(true);
    current = filterPendingDeletedTimeEntries(
      current ? {
        ...current,
        activeEntry: serverActiveEntry,
        entries: serverActiveEntry ? [serverActiveEntry] : []
      } : current,
      new Set([
        ...coordinator.pendingEntryIds(),
        ...reconciler.deferredExternalActiveEntryIds()
      ])
    );
    expect(current?.activeEntry).toBeNull();

    coordinator.registerPendingId(pending.token, canonicalId);
    reconciler.settle(optimisticId, "persisted");
    now = 15_000;
    const expiryCallback = expiry as (() => void) | null;
    if (!expiryCallback) throw new Error("Expected deletion expiry callback");
    expiryCallback();

    expect(deletedCanonicalIds).toEqual([canonicalId]);
    expect(coordinator.current()).toBeNull();
    const firstRefresh = serverActiveEntry;
    const secondRefresh = serverActiveEntry;
    expect(firstRefresh).toBeNull();
    expect(secondRefresh).toBeNull();
  });

  it("keeps a presented failed start mounted until its matching coordinated exit completes", () => {
    const base = bootstrapWithoutActiveEntry();
    const optimisticId = "optimistic-active-timer:presented-rejection";
    const optimisticEntry = optimisticEntryFrom(base, optimisticId);
    let current: MobileBootstrap | null = optimisticStartTimer(base, optimisticEntry);
    const exit = createGenerationScopedExitCoordinator<{
      optimisticId: string;
      snapshot: MobileBootstrap;
    }>();

    expect(exit.schedule(17, { optimisticId, snapshot: base })).toBe(true);
    expect(current?.activeEntry?.id).toBe(optimisticId);
    expect(exit.complete(16)).toBeNull();
    expect(current?.activeEntry?.id).toBe(optimisticId);

    const completed = exit.complete(17);
    expect(completed?.optimisticId).toBe(optimisticId);
    current = rollbackRejectedOptimisticTimerStart(
      current,
      completed?.snapshot ?? null,
      completed?.optimisticId ?? ""
    );
    expect(current?.activeEntry).toBeNull();
    expect(exit.complete(17)).toBeNull();

    expect(exit.schedule(18, { optimisticId: "new-generation", snapshot: base })).toBe(true);
    expect(exit.complete(17)).toBeNull();
    expect(exit.current()?.presentationId).toBe(18);
  });

  it("keeps a pre-frame permanent rejection from opening a sheet generation", () => {
    const gate = createBlankTimerStartGate();
    const exit = createGenerationScopedExitCoordinator<{ optimisticId: string }>();
    const token = requiredDeletion(gate.claim());
    expect(gate.bindEntry(token, "optimistic-active-timer:pre-frame")).toBe(true);

    expect(gate.release(token)).toBe(true);

    expect(gate.current()).toBeNull();
    expect(exit.current()).toBeNull();
  });

  it.each(["persisted", "queued", "rejected"] as const)(
    "renders suggestion and accepts Stop before an unresolved start settles as %s",
    async (settlement) => {
      const optimisticId = `optimistic-active-timer:${settlement}`;
      const reconciler = createOptimisticTimerStartReconciler();
      const queue = createSerializedMutationQueue();
      const start = deferred<typeof settlement>();
      const updateCanonical = vi.fn().mockResolvedValue(undefined);
      const updateQueued = vi.fn().mockResolvedValue(true);
      const stopCanonical = vi.fn().mockResolvedValue(undefined);
      const stopQueued = vi.fn().mockResolvedValue(undefined);
      const dismiss = vi.fn();
      const applySuggestionLocally = vi.fn();
      const stopLocally = vi.fn();

      reconciler.begin(optimisticId);
      const startCompletion = queue.enqueue(async () => {
        reconciler.settle(optimisticId, await start.promise);
      });

      const suggestionAcceptance = createMutationAcceptance(true);
      applySuggestionLocally();
      const suggestionCompletion = queue.enqueue(async () => {
        if (!reconciler.canRunDependentMutation(optimisticId)) {
          suggestionAcceptance.fail();
          return;
        }
        if (reconciler.phase(optimisticId) === "persisted") await updateCanonical();
        else await requireQueuedTimerStartUpdate(updateQueued);
      });
      const suggestionResult = suggestionAcceptance.result(suggestionCompletion);
      let suggestionSettled = false;
      void suggestionResult.then(() => {
        suggestionSettled = true;
      });

      const stopAcceptance = createMutationAcceptance(
        shouldAwaitTimerMutationAcceptance(reconciler.phase(optimisticId))
      );
      stopLocally();
      dismiss();
      const stopCompletion = queue.enqueue(async () => {
        if (!reconciler.canRunDependentMutation(optimisticId)) return;
        if (reconciler.phase(optimisticId) === "persisted") await stopCanonical();
        else {
          await requireQueuedTimerStartUpdate(updateQueued);
          await stopQueued();
        }
      });

      await expect(stopAcceptance.result(stopCompletion)).resolves.toBe(true);
      expect(applySuggestionLocally).toHaveBeenCalledOnce();
      expect(suggestionSettled).toBe(false);
      expect(stopLocally).toHaveBeenCalledOnce();
      expect(dismiss).toHaveBeenCalledOnce();
      expect(updateCanonical).not.toHaveBeenCalled();
      expect(updateQueued).not.toHaveBeenCalled();
      expect(stopCanonical).not.toHaveBeenCalled();
      expect(stopQueued).not.toHaveBeenCalled();

      start.resolve(settlement);
      await Promise.all([startCompletion, suggestionCompletion, stopCompletion]);
      await expect(suggestionResult).resolves.toBe(settlement !== "rejected");

      if (settlement === "persisted") {
        expect(updateCanonical).toHaveBeenCalledOnce();
        expect(stopCanonical).toHaveBeenCalledOnce();
        expect(updateQueued).not.toHaveBeenCalled();
        expect(stopQueued).not.toHaveBeenCalled();
      } else if (settlement === "queued") {
        expect(updateQueued).toHaveBeenCalledTimes(2);
        expect(stopQueued).toHaveBeenCalledOnce();
        expect(updateCanonical).not.toHaveBeenCalled();
        expect(stopCanonical).not.toHaveBeenCalled();
      } else {
        expect(updateCanonical).not.toHaveBeenCalled();
        expect(updateQueued).not.toHaveBeenCalled();
        expect(stopCanonical).not.toHaveBeenCalled();
        expect(stopQueued).not.toHaveBeenCalled();
      }
    }
  );

  it("rolls sheet suggestion fields back when start persists but its dependent PATCH rejects", async () => {
    const start = deferred<void>();
    const patchRequest = deferred<void>();
    const queue = createSerializedMutationQueue();
    const acceptance = createMutationAcceptance(true);
    let editorDescription = "Accepted suggestion";
    let announcement = "";
    const startCompletion = queue.enqueue(() => start.promise);
    const patchCompletion = queue.enqueue(() => patchRequest.promise)
      .catch(() => {
        acceptance.fail();
      });
    const callbackResult = acceptance.result(patchCompletion);
    let callbackSettled = false;
    void callbackResult.then(() => {
      callbackSettled = true;
    });

    expect(editorDescription).toBe("Accepted suggestion");
    await Promise.resolve();
    expect(callbackSettled).toBe(false);
    start.resolve();
    await startCompletion;
    patchRequest.reject(new Error("PATCH 422"));
    const accepted = await callbackResult;
    if (!accepted) {
      editorDescription = "Before suggestion";
      announcement = "Suggestion not applied. Previous details restored.";
    }

    expect(accepted).toBe(false);
    expect(editorDescription).toBe("Before suggestion");
    expect(announcement).toBe("Suggestion not applied. Previous details restored.");
  });

  it.each(["suggestion", "save", "stop"] as const)(
    "does not acknowledge persisted running %s before deferred persistence succeeds",
    async () => {
      const persistence = deferred<void>();
      const acceptance = createMutationAcceptance(
        shouldAwaitTimerMutationAcceptance(null)
      );
      const result = acceptance.result(persistence.promise);
      let settled = false;
      void result.then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      persistence.resolve();
      await expect(result).resolves.toBe(true);
    }
  );

  it.each(["suggestion", "save", "stop"] as const)(
    "returns false for deferred persisted running %s rejection",
    async () => {
      const persistence = deferred<void>();
      const acceptance = createMutationAcceptance(
        shouldAwaitTimerMutationAcceptance(null)
      );
      const completion = persistence.promise.catch(() => {
        acceptance.fail();
      });
      const result = acceptance.result(completion);

      persistence.reject(new Error("4xx persistence rejection"));
      await expect(result).resolves.toBe(false);
    }
  );

  it.each(["suggestion", "save", "stop"] as const)(
    "returns false for deferred persisted running %s auth rejection",
    async () => {
      const persistence = deferred<void>();
      const acceptance = createMutationAcceptance(
        shouldAwaitTimerMutationAcceptance(null)
      );
      const completion = persistence.promise.catch(() => {
        acceptance.fail();
      });
      const result = acceptance.result(completion);

      persistence.reject(Object.assign(new Error("Login required"), { name: "AuthRequiredError" }));
      await expect(result).resolves.toBe(false);
    }
  );

  it.each(["suggestion", "save", "stop"] as const)(
    "acknowledges queued offline %s only after its local mutation is durable",
    async () => {
      const optimisticId = "optimistic-active-timer:durable-offline-dependent";
      const reconciler = createOptimisticTimerStartReconciler();
      reconciler.begin(optimisticId);
      reconciler.settle(optimisticId, "queued");
      const durableWrite = deferred<boolean>();
      const acceptance = createMutationAcceptance(
        shouldAwaitTimerMutationAcceptance(reconciler.phase(optimisticId))
      );
      const completion = requireQueuedTimerStartUpdate(() => durableWrite.promise)
        .catch(() => acceptance.fail());
      const result = acceptance.result(completion);
      let settled = false;
      void result.then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);
      durableWrite.resolve(true);
      await expect(result).resolves.toBe(true);
    }
  );

  it.each(["suggestion", "save", "stop"] as const)(
    "returns false when rejected start suppresses dependent %s",
    async () => {
      const optimisticId = "optimistic-active-timer:already-rejected";
      const reconciler = createOptimisticTimerStartReconciler();
      reconciler.begin(optimisticId);
      reconciler.settle(optimisticId, "rejected");
      const acceptance = createMutationAcceptance(
        shouldAwaitTimerMutationAcceptance(reconciler.phase(optimisticId))
      );
      const completion = Promise.resolve().then(() => {
        if (!reconciler.canRunDependentMutation(optimisticId)) acceptance.fail();
      });

      await expect(acceptance.result(completion)).resolves.toBe(false);
    }
  );

  it("acknowledges network Stop only after its durable offline event is queued", async () => {
    const serverStop = deferred<void>();
    const durableQueueWrite = deferred<void>();
    const acceptance = createMutationAcceptance(
      shouldAwaitTimerMutationAcceptance(null)
    );
    const completion = (async () => {
      try {
        await serverStop.promise;
      } catch {
        await durableQueueWrite.promise;
      }
    })().catch(() => acceptance.fail());
    const result = acceptance.result(completion);
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    serverStop.reject(new TypeError("offline"));
    await Promise.resolve();
    expect(settled).toBe(false);
    durableQueueWrite.resolve();
    await expect(result).resolves.toBe(true);
  });

  it("awaits completed-entry persistence failure and retains its presentation draft", async () => {
    const persistence = deferred<void>();
    const acceptance = createMutationAcceptance(true);
    const draft = { id: "entry-completed", description: "Edited draft" };
    const dismiss = vi.fn();
    let visibleDraft: typeof draft | null = draft;
    const completion = persistence.promise.catch(() => {
      acceptance.fail();
    });
    const result = acceptance.result(completion);
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(visibleDraft).toBe(draft);
    expect(dismiss).not.toHaveBeenCalled();

    persistence.reject(new Error("save rejected"));
    expect(await result).toBe(false);
    if (await result) {
      visibleDraft = null;
      dismiss();
    }
    expect(visibleDraft).toBe(draft);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("does not treat a missing queued start as durable deletion success", async () => {
    const remove = vi.fn().mockResolvedValue(false);

    await expect(requireQueuedTimerStartRemoval(remove)).rejects.toThrow(
      MISSING_QUEUED_TIMER_DELETE_MESSAGE
    );
    expect(remove).toHaveBeenCalledOnce();
  });

  it("invalidates delete Undo when a deferred optimistic start permanently rejects", async () => {
    const base = bootstrapWithoutActiveEntry();
    const optimisticEntry = optimisticEntryFrom(base, "optimistic:start-reject");
    const beforeStart = base;
    let current: MobileBootstrap | null = optimisticStartTimer(base, optimisticEntry);
    const snapshot = current;
    const restored = vi.fn();
    const coordinator = createDeletionCoordinator<
      MobileBootstrap["entries"][number],
      MobileBootstrap | null
    >({
      clearTimer: () => undefined,
      now: () => 1_000,
      onCommit: () => undefined,
      onPendingChange: () => undefined,
      onRestore: ({ entries, snapshot: captured }) => {
        restored();
        current = restoreDeletedTimeEntriesSafely(
          current,
          captured,
          entries.map((entry) => entry.id),
          new Map()
        );
      },
      setTimer: () => 1
    });
    const pending = requiredDeletion(coordinator.prepare([optimisticEntry], snapshot));
    current = optimisticDeleteTimeEntry(current, optimisticEntry.id);
    coordinator.activate(pending.token);

    const start = deferred<void>();
    const settlement = start.promise.catch(() => {
      coordinator.invalidatePendingEntry(optimisticEntry.id);
      current = rollbackRejectedOptimisticTimerStart(
        current,
        beforeStart,
        optimisticEntry.id
      );
    });
    start.reject(new Error("permanent start rejection"));
    await settlement;

    expect(coordinator.current()).toBeNull();
    expect(coordinator.undo(pending.token)).toBe(false);
    expect(restored).not.toHaveBeenCalled();
    expect(mobileTimeEntryById(current, optimisticEntry.id)).toBeNull();
  });

  it("removes an already-restored optimistic timer when its deferred start rejects", async () => {
    const base = bootstrapWithoutActiveEntry();
    const optimisticEntry = optimisticEntryFrom(base, "optimistic:undo-then-reject");
    const beforeStart = base;
    let current: MobileBootstrap | null = optimisticStartTimer(base, optimisticEntry);
    const snapshot = current;
    const coordinator = createDeletionCoordinator<
      MobileBootstrap["entries"][number],
      MobileBootstrap | null
    >({
      clearTimer: () => undefined,
      now: () => 1_000,
      onCommit: () => undefined,
      onPendingChange: () => undefined,
      onRestore: ({ entries, snapshot: captured }) => {
        current = restoreDeletedTimeEntriesSafely(
          current,
          captured,
          entries.map((entry) => entry.id),
          new Map()
        );
      },
      setTimer: () => 1
    });
    const pending = requiredDeletion(coordinator.prepare([optimisticEntry], snapshot));
    current = optimisticDeleteTimeEntry(current, optimisticEntry.id);
    coordinator.activate(pending.token);
    expect(coordinator.undo(pending.token)).toBe(true);
    expect(current?.activeEntry?.id).toBe(optimisticEntry.id);

    const start = deferred<void>();
    const settlement = start.promise.catch(() => {
      coordinator.invalidatePendingEntry(optimisticEntry.id);
      current = rollbackRejectedOptimisticTimerStart(
        current,
        beforeStart,
        optimisticEntry.id
      );
    });
    start.reject(new Error("permanent start rejection"));
    await settlement;

    expect(current?.activeEntry).toBeNull();
    expect(mobileTimeEntryById(current, optimisticEntry.id)).toBeNull();
    expect(coordinator.undo(pending.token)).toBe(false);
  });

  it("does not report queued Save success after its deferred start rejects", async () => {
    const start = deferred<void>();
    const queuedStartUpdate = vi.fn().mockResolvedValue(false);
    const result = start.promise
      .catch(() => undefined)
      .then(() => requireQueuedTimerStartUpdate(queuedStartUpdate))
      .then(() => true, () => false);

    start.reject(new Error("permanent start rejection"));

    await expect(result).resolves.toBe(false);
    expect(queuedStartUpdate).toHaveBeenCalledOnce();
  });

  it("does not enqueue Stop after its deferred start rejects without a queued dependency", async () => {
    const start = deferred<void>();
    const queuedStartUpdate = vi.fn().mockResolvedValue(false);
    const enqueueStop = vi.fn().mockResolvedValue(undefined);
    const stop = start.promise
      .catch(() => undefined)
      .then(async () => {
        await requireQueuedTimerStartUpdate(queuedStartUpdate);
        await enqueueStop();
      });

    start.reject(new Error("permanent start rejection"));

    await expect(stop).rejects.toThrow(MISSING_QUEUED_TIMER_START_MESSAGE);
    expect(queuedStartUpdate).toHaveBeenCalledOnce();
    expect(enqueueStop).not.toHaveBeenCalled();
  });

  it("still restores a failed completed deletion while a timer is running", () => {
    const base = bootstrapWithActiveEntry();
    const completed = {
      ...base.entries[0],
      id: "entry-completed",
      stoppedAt: "2026-07-16T08:30:00.000Z"
    };
    const snapshot = {
      ...base,
      entries: [base.entries[0], completed],
      historyEntries: [base.entries[0], completed]
    };
    const deleted = optimisticDeleteTimeEntry(snapshot, completed.id);

    const restored = restoreFailedDeletionSafely(
      deleted,
      snapshot,
      [completed.id],
      new Map()
    );

    expect(restored?.activeEntry?.id).toBe("entry-running");
    expect(restored?.entries).toContainEqual(completed);
    expect(restored?.historyEntries).toContainEqual(completed);
  });

  it("rolls back the exact grouped entries after persistence failure", () => {
    const first = bootstrapWithActiveEntry();
    const secondEntry = {
      ...first.entries[0],
      id: "entry-grouped-2",
      startedAt: "2026-07-16T08:00:00.000Z",
      stoppedAt: "2026-07-16T08:30:00.000Z"
    };
    const snapshot = {
      ...first,
      entries: [first.entries[0], secondEntry],
      historyEntries: [first.entries[0], secondEntry]
    };
    const deleted = ["entry-running", "entry-grouped-2"].reduce(
      optimisticDeleteTimeEntry,
      snapshot
    );
    const restored = optimisticRestoreTimeEntries(
      deleted ? { ...deleted, workspace: { ...deleted.workspace, name: "Newer workspace state" } } : deleted,
      snapshot,
      ["entry-running", "entry-grouped-2"]
    );

    expect(restored?.entries).toEqual(snapshot.entries);
    expect(restored?.historyEntries).toEqual(snapshot.historyEntries);
    expect(restored?.workspace.name).toBe("Newer workspace state");
  });

  it("restores a deleted middle row at its snapshot-relative position without dropping newer rows", () => {
    const base = bootstrapWithActiveEntry();
    const first = { ...base.entries[0], id: "entry-first" };
    const middle = {
      ...base.entries[0],
      id: "entry-middle",
      description: "Exact middle metadata",
      tagNames: ["Captured"]
    };
    const last = { ...base.entries[0], id: "entry-last" };
    const newer = { ...base.entries[0], id: "entry-newer" };
    const snapshot = {
      ...base,
      activeEntry: null,
      entries: [first, middle, last],
      historyEntries: [first, middle, last]
    };
    const current = {
      ...snapshot,
      entries: [first, newer, last],
      historyEntries: [first, newer, last]
    };

    const restored = optimisticRestoreTimeEntries(current, snapshot, [middle.id]);

    expect(restored?.entries).toEqual([first, middle, newer, last]);
    expect(restored?.historyEntries).toEqual([first, middle, newer, last]);
    expect(restored?.entries[1]).toBe(middle);
  });

  it("starts one optimistic timer and replaces its local id after persistence", () => {
    const original = bootstrapWithActiveEntry();
    const pending = {
      ...original.activeEntry!,
      id: "optimistic-active-timer:1",
      categoryId: null,
      categoryName: null,
      description: null,
      startedAt: "2026-07-16T10:00:00.000Z"
    };
    const started = optimisticStartTimer(original, pending);

    expect(started?.activeEntry?.id).toBe("optimistic-active-timer:1");
    expect(started?.entries.filter((entry) => entry.id === pending.id)).toHaveLength(1);
    expect(started?.entries.find((entry) => entry.id === "entry-running")?.stoppedAt)
      .toBe("2026-07-16T10:00:00.000Z");

    const persisted = replaceOptimisticTimeEntryId(
      started ? { ...started, historyEntries: [pending] } : started,
      pending.id,
      "entry-server"
    );
    expect(persisted?.activeEntry?.id).toBe("entry-server");
    expect(persisted?.entries.filter((entry) => entry.id === "entry-server")).toHaveLength(1);
    expect(persisted?.historyEntries?.some((entry) => entry.id === pending.id)).toBe(false);
    expect(persisted?.historyEntries?.filter((entry) => entry.id === "entry-server")).toHaveLength(1);
  });

  it("finds a reconciled entry in the historical pool", () => {
    const original = bootstrapWithActiveEntry();
    const historicalOnly = { ...original.entries[0], id: "historical-only" };
    const data = {
      ...original,
      activeEntry: null,
      entries: [],
      historyEntries: [historicalOnly]
    };

    expect(mobileTimeEntryById(data, historicalOnly.id)).toEqual(historicalOnly);
  });

  it("only uses pinned categories for quick actions", () => {
    expect(
      buildMobileQuickActions({
        categories: [
          category({ id: "focus", isPinned: true, name: "Focus" }),
          category({ id: "admin", isPinned: false, name: "Admin" }),
          category({ id: "family", isPinned: true, name: "Family" })
        ]
      }).map((action) => ({ description: action.description, id: action.id, name: action.name, subtitle: action.subtitle }))
    ).toEqual([
      { description: undefined, id: "focus", name: "Focus", subtitle: null },
      { description: undefined, id: "family", name: "Family", subtitle: null }
    ]);
  });

  it("sorts pinned category quick actions by learned category usage", () => {
    expect(
      buildMobileQuickActions({
        categories: [
          category({ id: "family", isPinned: true, name: "Family" }),
          category({ id: "coding", isPinned: true, name: "Coding" }),
          category({ id: "chores", isPinned: true, name: "Chores" })
        ],
        categoryUsage: [
          {
            categoryId: "coding",
            lastSeenAt: "2026-07-10T10:00:00.000Z",
            score: 82,
            totalSeconds: 10_800,
            useCount: 6
          },
          {
            categoryId: "chores",
            lastSeenAt: "2026-07-14T10:00:00.000Z",
            score: 54,
            totalSeconds: 3600,
            useCount: 2
          }
        ]
      }).map((action) => action.name)
    ).toEqual(["Coding", "Chores", "Family"]);
  });
});

function category(input: Partial<MobileBootstrap["categories"][number]>): MobileBootstrap["categories"][number] {
  return {
    color: "blue",
    id: "category-id",
    isPinned: false,
    name: "Category",
    ...input
  };
}

function bootstrapWithActiveEntry(): MobileBootstrap {
  const activeEntry: NonNullable<MobileBootstrap["activeEntry"]> = {
    categoryColor: null,
    categoryId: null,
    categoryName: null,
    clientName: null,
    confidence: "manual",
    description: null,
    durationSeconds: 0,
    id: "entry-running",
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "mobile_app",
    startedAt: "2026-07-16T09:00:00.000Z",
    stoppedAt: null
  };
  return {
    activeEntry,
    categories: [category({ id: "focus", name: "Focus" })],
    entries: [activeEntry],
    historyEntries: [activeEntry]
  } as MobileBootstrap;
}

function bootstrapWithoutActiveEntry(): MobileBootstrap {
  const bootstrap = bootstrapWithActiveEntry();
  return {
    ...bootstrap,
    activeEntry: null,
    entries: [],
    historyEntries: []
  };
}

function optimisticEntryFrom(
  _bootstrap: MobileBootstrap,
  id: string
): MobileBootstrap["entries"][number] {
  return {
    ...bootstrapWithActiveEntry().entries[0],
    id,
    startedAt: "2026-07-16T10:00:00.000Z",
    stoppedAt: null
  };
}

function requiredDeletion<T>(value: T | null): T {
  if (!value) throw new Error("Expected a prepared deletion");
  return value;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
