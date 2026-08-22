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
import type { PendingTimeEntryCommand } from "./timeEntryOutbox";
import type { PendingTimerStop } from "./timerStopOutbox";
import {
  mobileTimeEntryById,
  optimisticDeleteTimeEntry,
  optimisticPatchTimeEntry,
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
  | { kind: "stop"; at: string; sequence: string; stop: PendingTimerStop };

export function projectDurableLocalWork(
  serverBootstrap: MobileBootstrap,
  durableWork: DurableLocalWork
): MobileBootstrap {
  let projected: MobileBootstrap = serverBootstrap;
  const operations = projectionOperations(durableWork);

  for (const operation of operations) {
    if (operation.kind === "start") {
      const localId = operation.event.localId;
      const entryId = durableWork.correlations.get(localId) ?? localId;
      projected = optimisticStartTimer(
        projected,
        queuedStartEntry(projected, operation.event, entryId)
      ) as MobileBootstrap;
      continue;
    }

    if (operation.kind === "stop") {
      const target = operation.stop.targetEntryId ?? (
        operation.stop.optimisticEntryId
          ? durableWork.correlations.get(operation.stop.optimisticEntryId) ?? operation.stop.optimisticEntryId
          : null
      );
      if (target) projected = projectTargetedStop(projected, target, operation.stop.occurredAt);
      continue;
    }

    const target = operation.command.targetEntryId ?? (
      operation.command.optimisticEntryId
        ? durableWork.correlations.get(operation.command.optimisticEntryId) ?? operation.command.optimisticEntryId
        : null
    );
    if (!target) continue;
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
    .filter((command) => mobileAccountOwnersEqual(command, work.owner))
    .map((command) => command.operation === "delete"
      ? {
          kind: "delete" as const,
          at: command.createdAt,
          sequence: `3:${command.createdAt}:${command.clientCommandId}`,
          command
        }
      : {
          kind: "edit" as const,
          at: command.createdAt,
          sequence: `1:${command.createdAt}:${command.clientCommandId}`,
          command
        });
  const stops: ProjectionOperation[] = work.timerStops
    .filter((stop) => mobileAccountOwnersEqual(stop, work.owner))
    .map((stop) => ({
      kind: "stop",
      at: stop.occurredAt,
      sequence: `2:${stop.queuedAt}:${stop.clientEventId}`,
      stop
    }));
  return [...starts, ...commands, ...stops].sort((left, right) =>
    Date.parse(left.at) - Date.parse(right.at) || left.sequence.localeCompare(right.sequence)
  );
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
