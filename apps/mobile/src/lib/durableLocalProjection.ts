import { normalizeTagName } from "@dayframe/shared";
import type {
  MobileBootstrap,
  MobileTimeEntry,
  QueuedEvent,
  TimeEntryUpdatePatch
} from "./api";
import {
  mobileAccountOwnersEqual,
  type MobileAccountOwner
} from "./mobileAccount";
import { isPermanentlyFailedQueuedEvent } from "./queuePermanence";
import { projectCompletedEntryCopy } from "./completedEntryCopyProjection";
import type { PendingTimeEntryCommand } from "./timeEntryOutbox";
import type { PendingTimerStop } from "./timerStopOutbox";
import {
  mobileTimeEntryById,
  optimisticDeleteTimeEntry,
  optimisticPatchTimeEntry,
  optimisticSplitTimeEntry,
  optimisticStartTimer
} from "./timerPresentation";

export type DurableLocalWork = {
  owner: MobileAccountOwner;
  activityEvents: readonly QueuedEvent[];
  timeEntryCommands: readonly PendingTimeEntryCommand[];
  timerStops: readonly PendingTimerStop[];
  correlations: ReadonlyMap<string, string>;
};

type ProjectionOperation =
  | { kind: "start"; at: string; sequence: string; event: QueuedEvent }
  | { kind: "edit"; at: string; sequence: string; command: PendingTimeEntryCommand }
  | { kind: "delete"; at: string; sequence: string; command: PendingTimeEntryCommand }
  | { kind: "stop"; at: string; sequence: string; stop: PendingTimerStop }
  | { kind: "queued_stop"; at: string; sequence: string; entryId: string };

export function projectDurableLocalWork(
  serverBootstrap: MobileBootstrap,
  durableWork: DurableLocalWork
): MobileBootstrap {
  let projected: MobileBootstrap = serverBootstrap;
  const operations = projectionOperations(durableWork);
  const resolveProjectedTimerId = projectionTimerIdLookup(durableWork);

  for (const operation of operations) {
    if (operation.kind === "start") {
      const entryId = resolveProjectedTimerId(operation.event.localId);
      projected = optimisticStartTimer(
        projected,
        queuedStartEntry(projected, operation.event, entryId)
      ) as MobileBootstrap;
      continue;
    }

    if (operation.kind === "stop") {
      const target = operation.stop.targetEntryId ?? (
        operation.stop.optimisticEntryId
          ? resolveProjectedTimerId(operation.stop.optimisticEntryId)
          : null
      );
      if (target) projected = projectTargetedStop(projected, target, operation.stop.occurredAt);
      continue;
    }

    if (operation.kind === "queued_stop") {
      // Only a block still running, or one that ended after the tap (a later Start ended it there): a
      // block stopped elsewhere before the tap keeps its end, as the server keeps it (superseded).
      const target = mobileTimeEntryById(projected, operation.entryId);
      if (target && (!target.stoppedAt || Date.parse(target.stoppedAt) > Date.parse(operation.at))) {
        projected = projectTargetedStop(projected, operation.entryId, operation.at);
      }
      continue;
    }

    const target = operation.command.split?.receipt?.firstEntryId ?? operation.command.targetEntryId ?? (
      operation.command.optimisticEntryId
        ? resolveProjectedTimerId(operation.command.optimisticEntryId)
        : null
    );
    if (!target) continue;
    if (operation.command.split) {
      const { splitAt, secondLocalId, receipt } = operation.command.split;
      const secondId = receipt?.secondEntryId ?? resolveProjectedTimerId(secondLocalId);
      const cachedSecond = receipt ? mobileTimeEntryById(projected, secondId) : null;
      if (receipt?.firstRemoved) projected = optimisticDeleteTimeEntry(projected, target) ?? projected;
      if (cachedSecond && receipt?.secondRemoved) {
        projected = optimisticDeleteTimeEntry(projected, secondId) ?? projected;
      } else if (cachedSecond && receipt?.secondStoppedAt && receipt.secondUpdatedAt &&
        Date.parse(cachedSecond.updatedAt ?? "") < Date.parse(receipt.secondUpdatedAt)) {
        projected = projectTargetedStop(projected, secondId, receipt.secondStoppedAt);
      }
      // Bridge only an older copy of the exact source, without overriding newer edits or inventing a second block.
      if (receipt) {
        const staleFirst = receipt.firstUpdatedAt && projected.activeEntry?.id === target &&
          Date.parse(projected.activeEntry.updatedAt ?? "") < Date.parse(receipt.firstUpdatedAt);
        if (!staleFirst) continue;
        const firstEnd = receipt.firstStoppedAt === undefined ? splitAt : receipt.firstStoppedAt;
        if (receipt.secondRemoved || cachedSecond || firstEnd !== splitAt) {
          if (firstEnd) projected = projectTargetedStop(projected, target, firstEnd);
          continue;
        }
      }
      projected = optimisticSplitTimeEntry(projected, target, splitAt, secondId) ?? projected;
      if (receipt?.secondStoppedAt && projected.activeEntry?.id === secondId) {
        projected = projectTargetedStop(projected, secondId, receipt.secondStoppedAt);
      }
      continue;
    }
    if (operation.command.copy) {
      projected = projectCompletedEntryCopy(projected, target, operation.command.copy, {
        acknowledged: operation.command.copyAcknowledged, removedOnServer: operation.command.copyRemovedOnServer
      });
      continue;
    }
    projected = operation.kind === "delete"
      ? optimisticDeleteTimeEntry(projected, target) as MobileBootstrap
      : optimisticPatchTimeEntry(
          projected,
          target,
          operation.command.patch ?? {}
        ) as MobileBootstrap;
  }

  return projected;
}

function projectionTimerIdLookup(work: DurableLocalWork) {
  // The receipt can reach disk ahead of the transport correlation. Use its exact second ID for
  // display immediately while keeping the transport map untouched.
  const splitIds = new Map<string, string>();
  for (const command of work.timeEntryCommands) {
    const split = command.split;
    if (!split?.receipt || command.failureKind === "permanent" ||
      !mobileAccountOwnersEqual(command, work.owner)) continue;
    splitIds.set(split.secondLocalId, split.receipt.secondEntryId);
  }
  return (localId: string) => splitIds.get(localId) ?? work.correlations.get(localId) ?? localId;
}

function projectionOperations(work: DurableLocalWork): ProjectionOperation[] {
  const starts: ProjectionOperation[] = work.activityEvents
    .filter((event) =>
      mobileAccountOwnersEqual(event, work.owner) &&
      event.type === "timer_start" &&
      event.failureKind !== "permanent"
    )
    .map((event) => ({
      kind: "start",
      at: event.occurredAt.toISOString(),
      sequence: `0:${event.queuedAt}:${event.localId}`,
      event
    }));
  const commands: ProjectionOperation[] = work.timeEntryCommands
    .filter((command) =>
      mobileAccountOwnersEqual(command, work.owner) &&
      command.failureKind !== "permanent"
    )
    .map((command, index) => command.operation === "delete"
      ? {
          kind: "delete" as const,
          at: command.createdAt,
          sequence: `3:${command.createdAt}:${command.clientCommandId}`,
          command
        }
      : {
          kind: "edit" as const,
          at: command.createdAt,
          // Storage order breaks ties between a sheet Edit and the Split it precedes.
          sequence: `1:${String(index).padStart(8, "0")}`,
          command
        });
  const stops: ProjectionOperation[] = work.timerStops
    .filter((stop) =>
      mobileAccountOwnersEqual(stop, work.owner) &&
      stop.failureKind !== "permanent"
    )
    .map((stop) => ({
      kind: "stop",
      at: stop.occurredAt,
      sequence: `2:${stop.queuedAt}:${stop.clientEventId}`,
      stop
    }));
  // A Lock Screen Stop waiting in the queue, the app's or still the native one (owner decision 24 Oct
  // 2026, option A): its Live Activity has already ended, so the block shows stopped here too until the
  // server answers. One the server refused for good (the queue's own rule) is not projected, so the block
  // shows running again, with its Activity.
  const queuedStops: ProjectionOperation[] = work.activityEvents
    .flatMap((event) => mobileAccountOwnersEqual(event, work.owner) && isWaitingLockScreenStop(event)
      ? [{
          kind: "queued_stop" as const,
          at: event.occurredAt.toISOString(),
          sequence: `2:${event.queuedAt}:${event.localId}`,
          entryId: event.rawPayload!.targetEntryId as string
        }]
      : []);
  const chronological = [...starts, ...commands, ...stops, ...queuedStops].sort((left, right) =>
    Date.parse(left.at) - Date.parse(right.at) || left.sequence.localeCompare(right.sequence)
  );
  const splits = new Map<string, ProjectionOperation>();
  const producers = new Map<string, ProjectionOperation>();
  for (const operation of commands) {
    if (operation.kind === "edit" && operation.command.split) {
      splits.set(operation.command.clientCommandId, operation);
      producers.set(operation.command.split.secondLocalId, operation);
    }
  }
  if (!splits.size) return chronological;
  for (const operation of starts) {
    if (operation.kind === "start") producers.set(operation.event.localId, operation);
  }
  const ordered: ProjectionOperation[] = [];
  const emitted = new Set<ProjectionOperation>();
  function emit(operation: ProjectionOperation) {
    if (emitted.has(operation)) return;
    emitted.add(operation);
    if (operation.kind === "start") {
      for (const id of operation.event.afterRunningSplitIds ?? []) {
        const predecessor = splits.get(id);
        if (predecessor) emit(predecessor);
      }
    } else if (operation.kind === "edit" && operation.command.split && operation.command.optimisticEntryId) {
      const predecessor = producers.get(operation.command.optimisticEntryId);
      if (predecessor) emit(predecessor);
    }
    ordered.push(operation);
  }
  // A clock tie or adjustment cannot put a later Switch ahead of the Split it waits for.
  for (const operation of chronological) emit(operation);
  return ordered;
}

/** A Lock Screen Stop still waiting to reach the server: entry-scoped, its block named, not refused. */
export function isWaitingLockScreenStop(event: QueuedEvent) {
  const entryId = event.rawPayload?.targetEntryId;
  return event.type === "timer_stop" &&
    event.rawPayload?.stopScope === "entry" &&
    typeof entryId === "string" && entryId.length > 0 &&
    !isPermanentlyFailedQueuedEvent(event);
}

function queuedStartEntry(
  bootstrap: MobileBootstrap,
  event: QueuedEvent,
  entryId: string
): MobileTimeEntry {
  const category = event.categoryId
    ? bootstrap.categories.find((candidate) => candidate.id === event.categoryId)
    : null;
  const tagNames = Array.isArray(event.rawPayload?.tagNames)
    ? event.rawPayload.tagNames.filter((name): name is string => typeof name === "string")
    : [];
  return {
    id: entryId,
    projectId: event.projectId ?? null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: event.categoryId ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    placeName: null,
    source: String(event.source),
    confidence: "high",
    reviewStatus: "confirmed",
    description: event.description?.trim() || null,
    startedAt: event.occurredAt.toISOString(),
    stoppedAt: null,
    durationSeconds: 0,
    tagNames,
    tags: tagNames.map((name) => {
      const tag = normalizeTagName(name);
      return {
        id: `optimistic-tag:${tag.normalizedName}`,
        name: tag.name,
        normalizedName: tag.normalizedName
      };
    })
  };
}

function projectTargetedStop(
  bootstrap: MobileBootstrap,
  entryId: string,
  stoppedAt: string
) {
  if (!mobileTimeEntryById(bootstrap, entryId)) return bootstrap;
  const patched = optimisticPatchTimeEntry(
    bootstrap,
    entryId,
    { stoppedAt } satisfies TimeEntryUpdatePatch
  ) as MobileBootstrap;
  if (patched.activeEntry?.id !== entryId) return patched;
  return { ...patched, activeEntry: null };
}
