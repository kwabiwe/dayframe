import { describe, expect, it } from "vitest";
import type { MobileBootstrap, QueuedEvent } from "./api";
import { projectDurableLocalWork, type DurableLocalWork } from "./durableLocalProjection";
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
