import { describe, expect, it } from "vitest";
import type { MobileBootstrap, QueuedEvent } from "./api";
import { projectDurableLocalWork, type DurableLocalWork } from "./durableLocalProjection";
import { rollbackRejectedCompletedCopy } from "./completedEntryCopyProjection";
import { optimisticPatchTimeEntry } from "./timerPresentation";
import type { PendingTimeEntryCommand } from "./timeEntryOutbox";
import type { PendingTimerStop } from "./timerStopOutbox";

const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
const LOCAL_ID = "optimistic-active-timer:offline-start";
const STARTED_AT = "2026-08-22T10:00:00.000Z";

describe("durable dashboard projection", () => {
  it("keeps a queued Start visible when the server bootstrap does not contain it", () => {
    const projected = projectDurableLocalWork(bootstrap(), work({
      activityEvents: [queuedStart()]
    }));
    expect(projected.activeEntry?.id).toBe(LOCAL_ID);
    expect(projected.entries.filter((entry) => entry.id === LOCAL_ID)).toHaveLength(1);
  });

  it("uses a confirmed correlation without rendering local and canonical copies", () => {
    const canonicalId = "canonical-entry";
    const server = bootstrap({
      activeEntry: entry(canonicalId),
      entries: [entry(canonicalId)]
    });
    const projected = projectDurableLocalWork(server, work({
      activityEvents: [queuedStart()],
      correlations: new Map([[LOCAL_ID, canonicalId]])
    }));
    expect(projected.activeEntry?.id).toBe(canonicalId);
    expect(projected.entries.filter((item) => item.id === canonicalId)).toHaveLength(1);
    expect(projected.entries.some((item) => item.id === LOCAL_ID)).toBe(false);
  });

  it("projects offline Start, Edit, and Stop as one stopped entry with final values", () => {
    const projected = projectDurableLocalWork(bootstrap(), work({
      activityEvents: [queuedStart()],
      timeEntryCommands: [editCommand()],
      timerStops: [pendingStop()]
    }));
    const completed = projected.entries.find((item) => item.id === LOCAL_ID);
    expect(projected.activeEntry).toBeNull();
    expect(completed).toMatchObject({
      categoryId: "category-b",
      categoryName: "Deep work",
      description: "Final offline description",
      stoppedAt: "2026-08-22T10:25:00.000Z"
    });
  });

  it("layers persisted-entry Edit and Delete commands over every server snapshot", () => {
    const edited = entry("persisted-edit");
    const deleted = entry("persisted-delete");
    const projected = projectDurableLocalWork(bootstrap({
      activeEntry: edited,
      entries: [edited, deleted]
    }), work({
      timeEntryCommands: [
        {
          ...OWNER,
          clientCommandId: "edit-persisted",
          operation: "update",
          targetEntryId: edited.id,
          patch: { description: "Retained offline edit" },
          createdAt: "2026-08-22T10:05:00.000Z",
          updatedAt: "2026-08-22T10:05:00.000Z",
          attemptCount: 0
        },
        {
          ...OWNER,
          clientCommandId: "delete-persisted",
          operation: "delete",
          targetEntryId: deleted.id,
          deliverAfter: "2026-08-22T10:10:00.000Z",
          createdAt: "2026-08-22T10:06:00.000Z",
          updatedAt: "2026-08-22T10:06:00.000Z",
          attemptCount: 0
        }
      ]
    }));
    expect(projected.activeEntry?.description).toBe("Retained offline edit");
    expect(projected.entries.find((item) => item.id === edited.id)?.description)
      .toBe("Retained offline edit");
    expect(projected.entries.some((item) => item.id === deleted.id)).toBe(false);
  });

  it("projects a duplicate across midnight once and retires it on canonical or changed-source reads", () => {
    const updatedAt = "2026-08-22T23:30:00.000Z";
    const original = {
      ...entry("finished"), startedAt: "2026-08-22T23:20:00.000Z", stoppedAt: "2026-08-22T23:50:00.000Z",
      updatedAt, tagNames: ["writing"], locationGroup: { key: "trip", name: "Trip" }
    };
    const copyId = "e99b1dae-3711-8125-8a38-a05709a63d52";
    const copy: PendingTimeEntryCommand = {
      ...OWNER, clientCommandId: "copy-1", operation: "copy", targetEntryId: original.id,
      copy: { action: { kind: "duplicate" }, copyId, expectedUpdatedAt: updatedAt },
      createdAt: updatedAt, updatedAt, attemptCount: 0
    };
    const data = bootstrap({
      entries: [original], dayEntries: [], weekEntries: [original],
      dateRange: {
        selectedDate: "2026-08-23", previousDate: "2026-08-22", nextDate: "2026-08-24",
        dayStart: "2026-08-23T00:00:00.000Z", dayEnd: "2026-08-24T00:00:00.000Z",
        weekStart: "2026-08-17T00:00:00.000Z", weekEnd: "2026-08-24T00:00:00.000Z"
      }
    });
    const durable = work({ timeEntryCommands: [copy] });
    const first = projectDurableLocalWork(data, durable);
    expect(first.dayEntries).toHaveLength(1);
    expect(first.dayEntries?.[0]).toMatchObject({
      id: copyId, startedAt: "2026-08-22T23:50:00.000Z", stoppedAt: "2026-08-23T00:20:00.000Z",
      tagNames: ["writing"], source: "manual_app", locationGroup: undefined
    });
    expect(projectDurableLocalWork(first, durable)).toBe(first);
    const afterRemoval = { ...data, entries: [{ ...original, updatedAt: "2026-08-22T23:59:00.000Z" }] };
    expect(projectDurableLocalWork(afterRemoval, durable)).toBe(afterRemoval);
    expect(projectDurableLocalWork(data, work({ timeEntryCommands: [{ ...copy, failureKind: "permanent" }] }))).toBe(data);
  });

  it("projects a split without changing the running timer or showing an empty half in the next day", () => {
    const running = entry("live");
    const splitAt = "2026-08-23T00:00:00.000Z";
    const original = {
      ...entry("finished"), startedAt: "2026-08-22T23:30:00.000Z", stoppedAt: "2026-08-23T00:30:00.000Z",
      updatedAt: "2026-08-23T01:00:00.000Z", durationSeconds: 3600
    };
    const copy: PendingTimeEntryCommand = {
      ...OWNER, clientCommandId: "split-1", operation: "copy", targetEntryId: original.id,
      copy: { action: { kind: "split", splitAt }, copyId: "split-half", expectedUpdatedAt: original.updatedAt },
      createdAt: original.updatedAt, updatedAt: original.updatedAt, attemptCount: 0
    };
    const data = bootstrap({
      entries: [running, original], activeEntry: running, dayEntries: [original],
      dateRange: {
        selectedDate: "2026-08-23", previousDate: "2026-08-22", nextDate: "2026-08-24",
        dayStart: splitAt, dayEnd: "2026-08-24T00:00:00.000Z",
        weekStart: "2026-08-17T00:00:00.000Z", weekEnd: "2026-08-24T00:00:00.000Z"
      }
    });
    const projected = projectDurableLocalWork(data, work({ timeEntryCommands: [copy] }));
    expect(projected.activeEntry).toBe(running);
    expect(projected.entries.find((candidate) => candidate.id === original.id)).toMatchObject({ stoppedAt: splitAt, durationSeconds: 1800 });
    expect(projected.dayEntries).toEqual([expect.objectContaining({ id: "split-half", startedAt: splitAt, durationSeconds: 1800 })]);
    const removed = work({ timeEntryCommands: [{ ...copy, copyAcknowledged: true, copyRemovedOnServer: true }] });
    for (const snapshot of [data, projected]) {
      const settled = projectDurableLocalWork(snapshot, removed);
      expect(settled.activeEntry).toBe(running);
      expect(settled.entries.find((candidate) => candidate.id === original.id)).toMatchObject({ stoppedAt: splitAt });
      expect(settled.entries.some((candidate) => candidate.id === "split-half")).toBe(false);
      expect(settled.dayEntries).toEqual([]);
    }
  });

  it("fences a pre-split source in one bootstrap list even when a different list has the canonical split", () => {
    const splitAt = "2026-08-22T10:30:00.000Z";
    const original = {
      ...entry("source"), startedAt: "2026-08-22T10:00:00.000Z", stoppedAt: "2026-08-22T11:00:00.000Z",
      updatedAt: "2026-08-22T11:00:00.000Z"
    };
    const first = { ...original, stoppedAt: splitAt, updatedAt: "2026-08-22T11:30:00.000Z" };
    const second = { ...first, id: "second", startedAt: splitAt, stoppedAt: original.stoppedAt };
    const command: PendingTimeEntryCommand = {
      ...OWNER, clientCommandId: "split-mixed-read", operation: "copy", targetEntryId: original.id,
      copy: { action: { kind: "split", splitAt }, copyId: second.id, expectedUpdatedAt: original.updatedAt },
      createdAt: first.updatedAt, updatedAt: first.updatedAt, attemptCount: 0, copyAcknowledged: true
    };
    const durable = work({ timeEntryCommands: [command] });
    for (const head of [original, first]) {
      const mixed = bootstrap({ entries: [head], dayEntries: [original], weekEntries: [first, second] });
      const projected = projectDurableLocalWork(mixed, durable);
      expect(projected.dayEntries).toEqual([expect.objectContaining({ id: original.id, pendingCompletedCopy: true })]);
      expect(projected.weekEntries).toBe(mixed.weekEntries);
    }
    const coherent = bootstrap({ entries: [first, second], dayEntries: [first, second], weekEntries: [first, second] });
    expect(projectDurableLocalWork(coherent, durable)).toBe(coherent);
    const changed = { ...first, stoppedAt: "2026-08-22T10:15:00.000Z" };
    const older = { ...original, updatedAt: "2026-08-22T10:59:00.000Z" };
    const afterDeletion = bootstrap({ entries: [original], dayEntries: [older], weekEntries: [changed] });
    const guarded = projectDurableLocalWork(afterDeletion, durable);
    expect(guarded.dayEntries).toEqual([expect.objectContaining({ id: original.id, pendingCompletedCopy: true })]);
    expect(guarded.weekEntries).toBe(afterDeletion.weekEntries);
    expect(guarded.entries.some((candidate) => candidate.id === second.id)).toBe(false);
    const duplicate = work({
      timeEntryCommands: [{ ...command, copy: { ...command.copy!, action: { kind: "duplicate" } } }]
    });
    expect(projectDurableLocalWork(afterDeletion, duplicate)).toBe(afterDeletion);
  });

  it("rolls back a refused split immediately against cached server truth while retaining a later edit", () => {
    const splitAt = "2026-08-23T00:00:00.000Z";
    const original = {
      ...entry("finished"), startedAt: "2026-08-22T23:30:00.000Z", stoppedAt: "2026-08-23T00:30:00.000Z",
      updatedAt: "2026-08-23T01:00:00.000Z", durationSeconds: 3600
    };
    const copy: PendingTimeEntryCommand = {
      ...OWNER, clientCommandId: "refused-split", operation: "copy", targetEntryId: original.id,
      copy: { action: { kind: "split", splitAt }, copyId: "provisional-half", expectedUpdatedAt: original.updatedAt, originalStoppedAt: original.stoppedAt },
      createdAt: original.updatedAt, updatedAt: original.updatedAt, attemptCount: 0
    };
    const baseline = bootstrap({
      entries: [original], dayEntries: [original],
      dateRange: {
        selectedDate: "2026-08-23", previousDate: "2026-08-22", nextDate: "2026-08-24",
        dayStart: splitAt, dayEnd: "2026-08-24T00:00:00.000Z",
        weekStart: "2026-08-17T00:00:00.000Z", weekEnd: "2026-08-24T00:00:00.000Z"
      }
    });
    const projected = projectDurableLocalWork(baseline, work({ timeEntryCommands: [copy] }));
    const afterEdit = optimisticPatchTimeEntry(projected, original.id, { description: "Later local edit" })!;
    const rollback = rollbackRejectedCompletedCopy(afterEdit, baseline, original.id, copy.copy!, false);
    expect(rollback.dayEntries).toEqual([expect.objectContaining({
      id: original.id, stoppedAt: original.stoppedAt, durationSeconds: 3600, description: "Later local edit"
    })]);
    expect(rollback.entries.some((candidate) => candidate.id === "provisional-half")).toBe(false);
    expect(rollbackRejectedCompletedCopy(rollback, baseline, original.id, copy.copy!, false)).toBe(rollback);
    const newerBaseline = { ...baseline, entries: [{ ...original, updatedAt: "2026-08-23T01:01:00.000Z" }] };
    for (const unavailable of [null, newerBaseline]) {
      const fallback = rollbackRejectedCompletedCopy(afterEdit, unavailable, original.id, copy.copy!, false);
      expect(fallback.dayEntries).toEqual([expect.objectContaining({
        id: original.id, stoppedAt: original.stoppedAt, description: "Later local edit"
      })]);
    }
  });

  it("restores server truth instead of projecting a permanently rejected edit", () => {
    const persisted = entry("persisted-edit");
    const projected = projectDurableLocalWork(bootstrap({
      activeEntry: persisted,
      entries: [persisted]
    }), work({
      timeEntryCommands: [{
        ...OWNER,
        clientCommandId: "rejected-edit",
        operation: "update",
        targetEntryId: persisted.id,
        patch: { description: "Rejected ghost edit" },
        createdAt: "2026-08-22T10:05:00.000Z",
        updatedAt: "2026-08-22T10:06:00.000Z",
        attemptCount: 1,
        failureKind: "permanent",
        lastStatusCode: 404,
        lastError: "Entry not found"
      }]
    }));

    expect(projected.activeEntry?.description).toBe("Initial description");
    expect(projected.entries[0]?.description).toBe("Initial description");
  });

  it("restores a server entry instead of projecting a permanently rejected delete", () => {
    const persisted = entry("persisted-delete");
    const projected = projectDurableLocalWork(bootstrap({
      entries: [persisted]
    }), work({
      timeEntryCommands: [{
        ...OWNER,
        clientCommandId: "rejected-delete",
        operation: "delete",
        targetEntryId: persisted.id,
        createdAt: "2026-08-22T10:05:00.000Z",
        updatedAt: "2026-08-22T10:06:00.000Z",
        attemptCount: 1,
        failureKind: "permanent",
        lastStatusCode: 422,
        lastError: "Entry cannot be deleted"
      }]
    }));

    expect(projected.entries).toEqual([persisted]);
  });

  it("restores the running server timer instead of projecting a permanently rejected Stop", () => {
    const running = entry("rejected-stop-target");
    const projected = projectDurableLocalWork(bootstrap({
      activeEntry: running,
      entries: [running]
    }), work({
      timerStops: [{
        ...OWNER,
        clientEventId: "rejected-stop",
        targetEntryId: running.id,
        occurredAt: "2026-08-22T10:25:00.000Z",
        queuedAt: "2026-08-22T10:25:00.000Z",
        failureCount: 1,
        failureKind: "permanent",
        failedAt: "2026-08-22T10:25:01.000Z",
        lastStatusCode: 422,
        lastError: "Invalid target"
      }]
    }));

    expect(projected.activeEntry).toEqual(running);
    expect(projected.entries).toEqual([running]);
    expect(projected.activeEntry?.stoppedAt).toBeNull();
  });

  it("shows a Lock Screen Stop waiting in the queue as stopped, and a refused one as running (option A, 24 Oct)", () => {
    const running = entry("live-activity-target");
    const server = bootstrap({ activeEntry: running, entries: [running] });
    const waiting = lockScreenStop(running.id);

    const projected = projectDurableLocalWork(server, work({ activityEvents: [waiting] }));
    expect(projected.activeEntry).toBeNull();
    expect(projected.entries[0]?.stoppedAt).toBe("2026-08-22T10:25:00.000Z");

    const refused = projectDurableLocalWork(server, work({
      activityEvents: [{ ...waiting, failureKind: "permanent", failedAt: "2026-08-22T10:26:00.000Z", lastStatusCode: 422 }]
    }));
    expect(refused.activeEntry).toEqual(running);

    // The queue's own permanence rule: a refusal recorded only by its status counts too (Codex r1 on #578).
    const refusedByStatus = projectDurableLocalWork(server, work({
      activityEvents: [{ ...waiting, failureKind: "server", failedAt: "2026-08-22T10:26:00.000Z", lastStatusCode: 422 }]
    }));
    expect(refusedByStatus.activeEntry).toEqual(running);

    // Only an entry-scoped Stop with its block named, and only this account's.
    const unscoped = { ...waiting, rawPayload: { origin: "ios_app_shortcut", stopScope: "running_at" } };
    expect(projectDurableLocalWork(server, work({ activityEvents: [unscoped] })).activeEntry).toEqual(running);
    const otherAccount = { ...waiting, userId: "someone-else" };
    expect(projectDurableLocalWork(server, work({ activityEvents: [otherAccount] })).activeEntry).toEqual(running);
    // A waiting Stop for an older block never hides the block running now (Codex r2 on #578).
    const older = { ...entry("older-block"), stoppedAt: "2026-08-22T10:20:00.000Z" };
    const newer = entry("newer-block");
    const current = bootstrap({ activeEntry: newer, entries: [newer, older] });
    const withOldStop = projectDurableLocalWork(current, work({ activityEvents: [lockScreenStop(older.id)] }));
    expect(withOldStop.activeEntry).toEqual(newer);
    // That older block, stopped elsewhere before the tap, keeps its own end.
    expect(withOldStop.entries.find((item) => item.id === older.id)?.stoppedAt).toBe("2026-08-22T10:20:00.000Z");
    // One a later Start ended after the tap shows the tap's end.
    const endedLater = { ...entry("ended-later"), stoppedAt: "2026-08-22T11:00:00.000Z" };
    const laterProjected = projectDurableLocalWork(bootstrap({ activeEntry: newer, entries: [newer, endedLater] }),
      work({ activityEvents: [lockScreenStop(endedLater.id)] }));
    expect(laterProjected.entries.find((item) => item.id === endedLater.id)?.stoppedAt).toBe("2026-08-22T10:25:00.000Z");
    // A Stop for a block the snapshot no longer has changes nothing.
    expect(projectDurableLocalWork(server, work({ activityEvents: [lockScreenStop("gone")] }))).toEqual(server);
  });

  it("shows a block's own waiting Stop over a snapshot where the next Start ended it later (iphone-timer-sync-2)", () => {
    // Offline Start A 10:00, Stop A 10:25, Start B 12:00: the queue delivered both Starts, so the server
    // ended A at 12:00 until A's own Stop arrives and pulls it back (#531).
    const a = { ...entry("canonical-a"), stoppedAt: "2026-08-22T12:00:00.000Z", durationSeconds: 7200 };
    const b = { ...entry("canonical-b"), startedAt: "2026-08-22T12:00:00.000Z" };
    const waiting = projectDurableLocalWork(bootstrap({ activeEntry: b, entries: [b, a] }), work({
      timerStops: [{ ...pendingStop(), targetEntryId: a.id }],
      correlations: new Map([[LOCAL_ID, a.id]])
    }));
    expect(waiting.activeEntry?.id).toBe(b.id);
    expect(waiting.entries.find((item) => item.id === a.id)).toMatchObject({
      stoppedAt: "2026-08-22T10:25:00.000Z",
      durationSeconds: 1500
    });

    // Once the Stop is delivered it leaves the outbox and the server's own end shows unchanged.
    const settledA = { ...a, stoppedAt: "2026-08-22T10:25:00.000Z", durationSeconds: 1500 };
    const settledServer = bootstrap({ activeEntry: b, entries: [b, settledA] });
    expect(projectDurableLocalWork(settledServer, work({ correlations: new Map([[LOCAL_ID, a.id]]) })))
      .toEqual(settledServer);
  });

  it("is deterministic and idempotent for cached relaunch restoration", () => {
    const durable = work({
      activityEvents: [queuedStart()],
      timeEntryCommands: [editCommand()],
      timerStops: [pendingStop()]
    });
    const first = projectDurableLocalWork(bootstrap(), durable);
    const second = projectDurableLocalWork(first, durable);
    expect(second).toEqual(first);
  });

  it("never projects another account's commands", () => {
    const projected = projectDurableLocalWork(bootstrap(), work({
      activityEvents: [{ ...queuedStart(), userId: "user-b" }],
      timeEntryCommands: [{ ...editCommand(), userId: "user-b" }],
      timerStops: [{ ...pendingStop(), userId: "user-b" }]
    }));
    expect(projected.activeEntry).toBeNull();
    expect(projected.entries).toEqual([]);
  });
});

function work(overrides: Partial<DurableLocalWork> = {}): DurableLocalWork {
  return {
    owner: OWNER,
    activityEvents: [],
    timeEntryCommands: [],
    timerStops: [],
    correlations: new Map(),
    ...overrides
  };
}

function queuedStart(): QueuedEvent {
  return {
    ...OWNER,
    source: "mobile_app",
    type: "timer_start",
    occurredAt: new Date(STARTED_AT),
    localId: LOCAL_ID,
    queuedAt: STARTED_AT,
    categoryId: "category-a",
    description: "Initial description",
    rawPayload: { tagNames: ["Offline"] }
  };
}

function lockScreenStop(targetEntryId: string): QueuedEvent {
  return {
    ...OWNER,
    source: "shortcut",
    type: "timer_stop",
    occurredAt: new Date("2026-08-22T10:25:00.000Z"),
    localId: "ios-live-activity-stop-1",
    queuedAt: "2026-08-22T10:25:01.000Z",
    rawPayload: { origin: "ios_live_activity", stopScope: "entry", targetActivityId: "activity-1", targetEntryId }
  };
}

function editCommand(): PendingTimeEntryCommand {
  return {
    ...OWNER,
    clientCommandId: "edit-1",
    operation: "update",
    optimisticEntryId: LOCAL_ID,
    patch: {
      categoryId: "category-b",
      description: "Final offline description"
    },
    createdAt: "2026-08-22T10:05:00.000Z",
    updatedAt: "2026-08-22T10:05:00.000Z",
    attemptCount: 0
  };
}

function pendingStop(): PendingTimerStop {
  return {
    ...OWNER,
    clientEventId: "stop-1",
    optimisticEntryId: LOCAL_ID,
    occurredAt: "2026-08-22T10:25:00.000Z",
    queuedAt: "2026-08-22T10:25:00.000Z"
  };
}

function bootstrap(overrides: Partial<MobileBootstrap> = {}): MobileBootstrap {
  return {
    user: { id: OWNER.userId, email: "a@example.com", name: "A" },
    workspace: { id: OWNER.workspaceId, name: "A" },
    activeEntry: null,
    projects: [],
    categories: [
      { id: "category-a", name: "General", color: "green", isPinned: true },
      { id: "category-b", name: "Deep work", color: "amber", isPinned: true }
    ],
    entries: [],
    places: [],
    reviewItems: [],
    ...overrides
  };
}

function entry(id: string): MobileBootstrap["entries"][number] {
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "category-a",
    categoryName: "General",
    categoryColor: "green",
    placeName: null,
    source: "mobile_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Initial description",
    startedAt: STARTED_AT,
    stoppedAt: null,
    durationSeconds: 0,
    tagNames: []
  };
}
