import {
  historicalSuggestionPatch,
  normalizeTagName,
  type RecentActivitySuggestion
} from "@dayframe/shared";
import type { MobileBootstrap, TimeEntryUpdatePatch } from "./api";
import type { PendingTimerStop } from "./timerStopOutbox";

type ActiveTimerEntry = MobileBootstrap["activeEntry"];
type MobileTimeEntry = MobileBootstrap["entries"][number];

export const OPTIMISTIC_TIMER_ID_PREFIX = "optimistic-active-timer:";
export const MISSING_QUEUED_TIMER_START_MESSAGE =
  "This timer start is no longer available to update.";
export const MISSING_QUEUED_TIMER_DELETE_MESSAGE =
  "The queued timer start could not be found for deletion.";

export type BlankTimerStartClaim = {
  entryId: string | null;
  token: number;
};

export type OptimisticTimerStartPhase =
  | "starting"
  | "queued"
  | "syncing"
  | "persisted"
  | "rejected";

export function createOptimisticTimerStartReconciler() {
  const phases = new Map<string, OptimisticTimerStartPhase>();
  const deferredExternalActiveIds = new Map<string, string>();

  return {
    begin(entryId: string) {
      if (!entryId || phases.has(entryId)) return false;
      phases.set(entryId, "starting");
      return true;
    },
    beginQueueSync(entryId: string) {
      if (phases.get(entryId) !== "queued") return false;
      phases.set(entryId, "syncing");
      return true;
    },
    canRunDependentMutation(entryId: string) {
      return phases.get(entryId) !== "rejected";
    },
    clear() {
      phases.clear();
      deferredExternalActiveIds.clear();
    },
    deferExternalActiveEntry(input: {
      deletedActiveEntryId: string | null;
      externalActiveEntryId: string | null;
      pendingEntryIds: ReadonlySet<string>;
    }) {
      const deletedId = input.deletedActiveEntryId;
      const externalId = input.externalActiveEntryId;
      if (
        !deletedId ||
        !externalId ||
        input.pendingEntryIds.has(externalId) ||
        !input.pendingEntryIds.has(deletedId)
      ) {
        return false;
      }
      const phase = phases.get(deletedId);
      if (phase !== "starting" && phase !== "syncing") return false;
      deferredExternalActiveIds.set(deletedId, externalId);
      return true;
    },
    deferredExternalActiveEntryIds() {
      return new Set(deferredExternalActiveIds.values());
    },
    phase(entryId: string) {
      return phases.get(entryId) ?? null;
    },
    settle(entryId: string, phase: Extract<OptimisticTimerStartPhase, "persisted" | "queued" | "rejected">) {
      const currentPhase = phases.get(entryId);
      if (!currentPhase || currentPhase === "persisted" || currentPhase === "rejected") return null;
      phases.set(entryId, phase);
      const deferredExternalActiveEntryId = deferredExternalActiveIds.get(entryId) ?? null;
      deferredExternalActiveIds.delete(entryId);
      return deferredExternalActiveEntryId;
    }
  };
}

export function createGenerationScopedExitCoordinator<Payload>() {
  let pending: { payload: Payload; presentationId: number } | null = null;
  return {
    complete(presentationId: number) {
      if (!pending || pending.presentationId !== presentationId) return null;
      const completed = pending;
      pending = null;
      return completed.payload;
    },
    current() {
      return pending ? { ...pending } : null;
    },
    schedule(presentationId: number, payload: Payload) {
      if (!Number.isSafeInteger(presentationId) || presentationId <= 0 || pending) return false;
      pending = { payload, presentationId };
      return true;
    }
  };
}

export function createMutationAcceptance(awaitCompletion: boolean) {
  let successful = true;
  return {
    fail() {
      successful = false;
    },
    async result(completion: Promise<unknown>) {
      if (awaitCompletion) await completion;
      return successful;
    }
  };
}

export function shouldAwaitTimerMutationAcceptance(
  phase: OptimisticTimerStartPhase | null
) {
  return phase !== "starting" && phase !== "syncing";
}

/**
 * Keeps timer persistence effects in one canonical order while allowing their
 * optimistic UI acceptance to remain synchronous. In particular, a deletion
 * queued while an offline start POST is in flight must observe that POST's
 * durable local-to-canonical correlation before choosing what to delete.
 */
export function createSerializedMutationQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<Result>(operation: () => Promise<Result>) {
      const result = tail.catch(() => undefined).then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    }
  };
}

/**
 * Remembers the exact state before a failed Stop when a newer optimistic start
 * already owns the active slot. If that newer start also fails, its rollback
 * must restore the original timer rather than the intermediate stopped state.
 */
export function createSupersededStopRollbackTracker() {
  const snapshots = new Map<string, MobileBootstrap>();

  return {
    capture(optimisticStartId: string, snapshot: MobileBootstrap | null) {
      if (
        !snapshot ||
        !optimisticStartId.startsWith(OPTIMISTIC_TIMER_ID_PREFIX) ||
        snapshots.has(optimisticStartId)
      ) {
        return false;
      }
      snapshots.set(optimisticStartId, snapshot);
      return true;
    },
    clear() {
      snapshots.clear();
    },
    consume(
      optimisticStartId: string,
      fallback: MobileBootstrap | null
    ) {
      const snapshot = snapshots.get(optimisticStartId) ?? fallback;
      snapshots.delete(optimisticStartId);
      return snapshot;
    },
    settle(optimisticStartId: string) {
      return snapshots.delete(optimisticStartId);
    }
  };
}

/**
 * A synchronous, generation-aware gate for the one bare Play journey. React
 * state is intentionally not the authority here: two press callbacks can run
 * before React commits the first optimistic entry.
 */
export function createBlankTimerStartGate() {
  let nextToken = 0;
  let claim: BlankTimerStartClaim | null = null;

  return {
    bindEntry(token: number, entryId: string) {
      if (!claim || claim.token !== token || !entryId) return false;
      claim = { entryId, token };
      return true;
    },
    claim() {
      if (claim) return null;
      const token = ++nextToken;
      claim = { entryId: null, token };
      return token;
    },
    current() {
      return claim ? { ...claim } : null;
    },
    release(token: number) {
      if (!claim || claim.token !== token) return false;
      claim = null;
      return true;
    },
    releaseEntry(entryId: string) {
      if (!claim || claim.entryId !== entryId) return false;
      claim = null;
      return true;
    }
  };
}

export type MobileQuickAction = {
  color: string | null;
  description?: string | null;
  id: string | null;
  isUncategorized: boolean;
  key: string;
  name: string;
  subtitle?: string | null;
};

type ActiveTimerElapsedEntry = Pick<
  NonNullable<ActiveTimerEntry>,
  "durationSeconds" | "startedAt"
>;

type RunningTimerSuggestionUpdater = (
  entryId: string,
  patch: TimeEntryUpdatePatch
) => Promise<unknown>;

export function displayTimerDescription(entry: Pick<NonNullable<ActiveTimerEntry>, "description"> | null | undefined) {
  if (!entry?.description) return null;
  return entry.description === "Start activity" ? null : entry.description;
}

export function activeTimerPresentation(entry: ActiveTimerEntry) {
  if (!entry) {
    return {
      categoryLabel: null,
      title: "Start task below"
    };
  }

  const description = displayTimerDescription(entry);
  return {
    categoryLabel: entry.categoryName ?? "Uncategorized",
    title: description ?? "Add a task description"
  };
}

export function dashboardActiveTimerEntry<Entry extends { id: string }>({
  activeEntry,
  pendingDeletionEntryIds,
  presentedEntry
}: {
  activeEntry: Entry | null;
  pendingDeletionEntryIds: ReadonlySet<string>;
  presentedEntry: Entry | null;
}) {
  const candidate = activeEntry ?? presentedEntry;
  if (!candidate || pendingDeletionEntryIds.has(candidate.id)) return null;
  return candidate;
}

export function activeTimerElapsedSeconds(
  entry: ActiveTimerElapsedEntry | null | undefined,
  nowMs: number
) {
  if (!entry) return 0;
  const startedAtMs = Date.parse(entry.startedAt);
  if (!Number.isFinite(startedAtMs)) return Math.max(0, entry.durationSeconds);
  return Math.max(
    0,
    entry.durationSeconds,
    Math.floor((nowMs - startedAtMs) / 1000)
  );
}

export function runningTimerSheetElapsedSeconds(input: {
  activeElapsedSeconds: number;
  nowMs: number;
  previewStartAt: Date | null;
  startTimeEdited: boolean;
}) {
  if (!input.startTimeEdited || !input.previewStartAt) {
    return input.activeElapsedSeconds;
  }
  const previewStartMs = input.previewStartAt.getTime();
  if (!Number.isFinite(previewStartMs) || previewStartMs > input.nowMs) {
    return input.activeElapsedSeconds;
  }
  return Math.max(0, Math.floor((input.nowMs - previewStartMs) / 1000));
}

export async function applySuggestionToRunningTimer(input: {
  entryId: string;
  suggestion: Pick<RecentActivitySuggestion, "categoryId" | "description" | "tagNames">;
  updateEntry: RunningTimerSuggestionUpdater;
}) {
  const patch: TimeEntryUpdatePatch = historicalSuggestionPatch(input.suggestion);
  await input.updateEntry(input.entryId, patch);
  return patch;
}

export function optimisticPatchTimeEntry(
  data: MobileBootstrap | null,
  entryId: string,
  patch: TimeEntryUpdatePatch
) {
  if (!data) return data;
  const patchEntry = (entry: MobileTimeEntry) =>
    entry.id === entryId ? patchedMobileTimeEntry(entry, patch, data.categories) : entry;
  const optimisticTags = Object.prototype.hasOwnProperty.call(patch, "tagNames")
    ? mergeOptimisticTags(data.tags ?? [], patch.tagNames ?? [])
    : data.tags;
  return {
    ...data,
    tags: optimisticTags,
    activeEntry: data.activeEntry ? patchEntry(data.activeEntry) : null,
    entries: data.entries.map(patchEntry),
    historyEntries: data.historyEntries?.map(patchEntry),
    dayEntries: data.dayEntries?.map(patchEntry),
    weekEntries: data.weekEntries?.map(patchEntry)
  };
}

export function optimisticDeleteTimeEntry(data: MobileBootstrap | null, entryId: string) {
  if (!data) return data;
  const keepOtherEntry = (entry: MobileTimeEntry) => entry.id !== entryId;
  return {
    ...data,
    activeEntry: data.activeEntry?.id === entryId ? null : data.activeEntry,
    entries: data.entries.filter(keepOtherEntry),
    historyEntries: data.historyEntries?.filter(keepOtherEntry),
    dayEntries: data.dayEntries?.filter(keepOtherEntry),
    weekEntries: data.weekEntries?.filter(keepOtherEntry)
  };
}

export function filterPendingDeletedTimeEntries(
  data: MobileBootstrap | null,
  pendingEntryIds: ReadonlySet<string>
) {
  if (!data || pendingEntryIds.size === 0) return data;
  const keepEntry = (entry: MobileTimeEntry) => !pendingEntryIds.has(entry.id);
  return {
    ...data,
    activeEntry: data.activeEntry && keepEntry(data.activeEntry) ? data.activeEntry : null,
    entries: data.entries.filter(keepEntry),
    historyEntries: data.historyEntries?.filter(keepEntry),
    dayEntries: data.dayEntries?.filter(keepEntry),
    weekEntries: data.weekEntries?.filter(keepEntry)
  };
}

export function optimisticRestoreTimeEntries(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryIds: string[]
) {
  if (!data || !snapshot) return data;
  const restoreIds = new Set(entryIds);
  const restoreFrom = (current: MobileTimeEntry[], previous: MobileTimeEntry[] | undefined) => {
    if (!previous) return current;
    const next = dedupeMobileEntries(current);
    for (let snapshotIndex = 0; snapshotIndex < previous.length; snapshotIndex += 1) {
      const restored = previous[snapshotIndex];
      if (!restored || !restoreIds.has(restored.id) || next.some((entry) => entry.id === restored.id)) {
        continue;
      }

      let insertionIndex = -1;
      for (let anchorIndex = snapshotIndex - 1; anchorIndex >= 0; anchorIndex -= 1) {
        const previousAnchor = previous[anchorIndex];
        const currentAnchorIndex = previousAnchor
          ? next.findIndex((entry) => entry.id === previousAnchor.id)
          : -1;
        if (currentAnchorIndex >= 0) {
          insertionIndex = currentAnchorIndex + 1;
          break;
        }
      }
      if (insertionIndex < 0) {
        for (let anchorIndex = snapshotIndex + 1; anchorIndex < previous.length; anchorIndex += 1) {
          const nextAnchor = previous[anchorIndex];
          const currentAnchorIndex = nextAnchor
            ? next.findIndex((entry) => entry.id === nextAnchor.id)
            : -1;
          if (currentAnchorIndex >= 0) {
            insertionIndex = currentAnchorIndex;
            break;
          }
        }
      }
      next.splice(
        insertionIndex >= 0 ? insertionIndex : Math.min(snapshotIndex, next.length),
        0,
        restored
      );
    }
    return next;
  };
  return {
    ...data,
    activeEntry: data.activeEntry ?? (
      snapshot.activeEntry && restoreIds.has(snapshot.activeEntry.id) ? snapshot.activeEntry : null
    ),
    entries: restoreFrom(data.entries, snapshot.entries),
    historyEntries: data.historyEntries
      ? restoreFrom(data.historyEntries, snapshot.historyEntries)
      : data.historyEntries,
    dayEntries: data.dayEntries ? restoreFrom(data.dayEntries, snapshot.dayEntries) : data.dayEntries,
    weekEntries: data.weekEntries ? restoreFrom(data.weekEntries, snapshot.weekEntries) : data.weekEntries
  };
}

export function restoreEntriesWithPersistedIds(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryIds: string[],
  persistedIds: ReadonlyMap<string, string>
) {
  let restored = optimisticRestoreTimeEntries(data, snapshot, entryIds);
  for (const entryId of entryIds) {
    const persistedId = persistedIds.get(entryId);
    if (persistedId) {
      restored = replaceOptimisticTimeEntryId(restored, entryId, persistedId);
    }
  }
  return restored;
}

export function restoreFailedDeletionSafely(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryIds: string[],
  persistedIds: ReadonlyMap<string, string>
) {
  return restoreDeletedTimeEntriesSafely(data, snapshot, entryIds, persistedIds);
}

export function restoreDeletedTimeEntriesSafely(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryIds: string[],
  persistedIds: ReadonlyMap<string, string>
) {
  const deletedActiveId = snapshot?.activeEntry?.id ?? null;
  const currentActiveId = data?.activeEntry?.id ?? null;
  const safeEntryIds = entryIds.filter((entryId) =>
    entryId !== deletedActiveId || !currentActiveId || currentActiveId === entryId
  );
  return restoreEntriesWithPersistedIds(data, snapshot, safeEntryIds, persistedIds);
}

/**
 * Removes a rejected optimistic start without replacing newer dashboard data.
 * If this was a timer switch, the exact previously-active entry is restored
 * only when no newer active timer has appeared.
 */
export function rollbackRejectedOptimisticTimerStart(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  optimisticId: string
) {
  const withoutRejectedStart = optimisticDeleteTimeEntry(data, optimisticId);
  const previousActive = snapshot?.activeEntry ?? null;
  if (!withoutRejectedStart || !snapshot || !previousActive || withoutRejectedStart.activeEntry) {
    return withoutRejectedStart;
  }

  const restored = optimisticRestoreTimeEntries(
    withoutRejectedStart,
    snapshot,
    [previousActive.id]
  );
  if (!restored) return restored;

  const restoreExactEntry = (
    entries: MobileTimeEntry[] | undefined,
    snapshotEntries: MobileTimeEntry[] | undefined
  ) => {
    if (!entries || !snapshotEntries) return entries;
    const exact = snapshotEntries.find((entry) => entry.id === previousActive.id);
    if (!exact) return entries;
    return entries.map((entry) => entry.id === previousActive.id ? exact : entry);
  };

  return {
    ...restored,
    activeEntry: previousActive,
    entries: restoreExactEntry(restored.entries, snapshot.entries) ?? restored.entries,
    historyEntries: restoreExactEntry(restored.historyEntries, snapshot.historyEntries),
    dayEntries: restoreExactEntry(restored.dayEntries, snapshot.dayEntries),
    weekEntries: restoreExactEntry(restored.weekEntries, snapshot.weekEntries)
  };
}

export function rollbackOptimisticTimeEntryPatch(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryId: string,
  patch: TimeEntryUpdatePatch,
  persistedIds: ReadonlyMap<string, string>
) {
  if (!data || !snapshot) return data;
  const persistedId = persistedIds.get(entryId) ?? null;
  const targetIds = new Set([entryId, ...(persistedId ? [persistedId] : [])]);
  const captured = mobileTimeEntryById(snapshot, entryId);
  if (!captured) return data;

  const restorePatchedFields = (entry: MobileTimeEntry) => {
    if (!targetIds.has(entry.id)) return entry;
    const restored = { ...entry };
    if (Object.prototype.hasOwnProperty.call(patch, "categoryId")) {
      restored.categoryId = captured.categoryId;
      restored.categoryName = captured.categoryName;
      restored.categoryColor = captured.categoryColor;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "description")) {
      restored.description = captured.description;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "startedAt")) {
      restored.startedAt = captured.startedAt;
      restored.durationSeconds = captured.durationSeconds;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "stoppedAt")) {
      restored.stoppedAt = captured.stoppedAt;
      restored.durationSeconds = captured.durationSeconds;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "tagNames")) {
      restored.tagNames = captured.tagNames;
      restored.tags = captured.tags;
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, "startedAt") ||
      Object.prototype.hasOwnProperty.call(patch, "stoppedAt")
    ) {
      const startedAtMs = Date.parse(restored.startedAt);
      const stoppedAtMs = restored.stoppedAt ? Date.parse(restored.stoppedAt) : NaN;
      restored.durationSeconds = Number.isFinite(startedAtMs) && Number.isFinite(stoppedAtMs)
        ? Math.max(0, Math.floor((stoppedAtMs - startedAtMs) / 1000))
        : captured.durationSeconds;
    }
    return restored;
  };

  const restoredData: MobileBootstrap = {
    ...data,
    activeEntry: data.activeEntry ? restorePatchedFields(data.activeEntry) : null,
    entries: data.entries.map(restorePatchedFields),
    historyEntries: data.historyEntries?.map(restorePatchedFields),
    dayEntries: data.dayEntries?.map(restorePatchedFields),
    weekEntries: data.weekEntries?.map(restorePatchedFields)
  };
  if (!Object.prototype.hasOwnProperty.call(patch, "tagNames") || !restoredData.tags) {
    return restoredData;
  }

  const normalizedNamesIn = (source: MobileBootstrap, includeCatalog: boolean) => {
    const normalizedNames = new Set(
      includeCatalog ? (source.tags ?? []).map((tag) => tag.normalizedName) : []
    );
    const entries = [
      ...(source.activeEntry ? [source.activeEntry] : []),
      ...source.entries,
      ...(source.historyEntries ?? []),
      ...(source.dayEntries ?? []),
      ...(source.weekEntries ?? [])
    ];
    for (const entry of entries) {
      for (const name of entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []) {
        normalizedNames.add(normalizeTagName(name).normalizedName);
      }
    }
    return normalizedNames;
  };
  const snapshotNames = normalizedNamesIn(snapshot, true);
  const restoredNames = normalizedNamesIn(restoredData, false);
  const failedNewNames = new Set(
    (patch.tagNames ?? [])
      .map((name) => normalizeTagName(name).normalizedName)
      .filter((name) => !snapshotNames.has(name))
  );

  return {
    ...restoredData,
    tags: restoredData.tags.filter((tag) =>
      !failedNewNames.has(tag.normalizedName) || restoredNames.has(tag.normalizedName)
    )
  };
}

export function rollbackOptimisticStopSafely(
  data: MobileBootstrap | null,
  snapshot: MobileBootstrap | null,
  entryId: string,
  persistedIds: ReadonlyMap<string, string>
) {
  if (!data || !snapshot) return data;
  const persistedId = persistedIds.get(entryId) ?? null;
  const targetIds = new Set([entryId, ...(persistedId ? [persistedId] : [])]);
  if (data.activeEntry && !targetIds.has(data.activeEntry.id)) {
    // A newer timer owns the active slot. Its start semantically supersedes
    // this failed Stop, so the older timer ends at the exact switch boundary.
    const stoppedAt = data.activeEntry.startedAt;
    const stopAtSwitch = (entry: MobileTimeEntry) => {
      if (!targetIds.has(entry.id)) return entry;
      const startedAtMs = Date.parse(entry.startedAt);
      const stoppedAtMs = Date.parse(stoppedAt);
      return {
        ...entry,
        stoppedAt,
        durationSeconds: Number.isFinite(startedAtMs) && Number.isFinite(stoppedAtMs)
          ? Math.max(0, Math.floor((stoppedAtMs - startedAtMs) / 1000))
          : entry.durationSeconds
      };
    };
    return {
      ...data,
      entries: data.entries.map(stopAtSwitch),
      historyEntries: data.historyEntries?.map(stopAtSwitch),
      dayEntries: data.dayEntries?.map(stopAtSwitch),
      weekEntries: data.weekEntries?.map(stopAtSwitch)
    };
  }
  const restored = rollbackOptimisticTimeEntryPatch(
    data,
    snapshot,
    entryId,
    { stoppedAt: snapshot.activeEntry?.stoppedAt ?? null },
    persistedIds
  );
  const capturedActive = snapshot.activeEntry;
  if (!restored || !capturedActive || capturedActive.id !== entryId) return restored;
  const restoredEntry = mobileTimeEntryById(restored, persistedId ?? entryId);
  return restoredEntry ? { ...restored, activeEntry: restoredEntry } : restored;
}

export async function requireQueuedTimerStartUpdate(
  update: () => Promise<boolean>
) {
  if (!(await update())) {
    throw new Error(MISSING_QUEUED_TIMER_START_MESSAGE);
  }
}

export async function requireQueuedTimerStartRemoval(
  remove: () => Promise<boolean>
) {
  if (!(await remove())) {
    throw new Error(MISSING_QUEUED_TIMER_DELETE_MESSAGE);
  }
}

export function optimisticStopActiveTimer(data: MobileBootstrap | null, stoppedAt: string) {
  if (!data?.activeEntry) return data;
  const completed = patchedMobileTimeEntry(data.activeEntry, { stoppedAt }, data.categories);
  return {
    ...data,
    activeEntry: null,
    entries: upsertMobileEntry(data.entries, completed),
    dayEntries: data.dayEntries ? upsertMobileEntry(data.dayEntries, completed) : data.dayEntries,
    weekEntries: data.weekEntries ? upsertMobileEntry(data.weekEntries, completed) : data.weekEntries
  };
}

export function projectPendingTimerStops(
  data: MobileBootstrap | null,
  pendingStops: readonly PendingTimerStop[],
  correlations: ReadonlyMap<string, string> = new Map()
) {
  if (!data?.activeEntry || pendingStops.length === 0) return data;
  const activeEntryId = data.activeEntry.id;
  const pendingStop = pendingStops.find((item) => {
    if (item.failureKind === "permanent") return false;
    if (item.targetEntryId === activeEntryId || item.optimisticEntryId === activeEntryId) return true;
    return Boolean(
      item.optimisticEntryId && correlations.get(item.optimisticEntryId) === activeEntryId
    );
  });
  return pendingStop
    ? optimisticStopActiveTimer(data, pendingStop.occurredAt)
    : data;
}

export function optimisticStartTimer(data: MobileBootstrap | null, pendingEntry: MobileTimeEntry) {
  if (!data) return data;
  const replaced = data.activeEntry
    ? patchedMobileTimeEntry(data.activeEntry, { stoppedAt: pendingEntry.startedAt }, data.categories)
    : null;
  const withReplacement = (entries: MobileTimeEntry[]) => {
    const next = replaced ? upsertMobileEntry(entries, replaced) : entries;
    return upsertMobileEntry(next, pendingEntry);
  };
  return {
    ...data,
    activeEntry: pendingEntry,
    entries: withReplacement(data.entries),
    dayEntries: data.dayEntries ? withReplacement(data.dayEntries) : data.dayEntries,
    weekEntries: data.weekEntries ? withReplacement(data.weekEntries) : data.weekEntries
  };
}

export function replaceOptimisticTimeEntryId(
  data: MobileBootstrap | null,
  optimisticId: string,
  persistedId: string
) {
  if (!data) return data;
  const replaceId = (entry: MobileTimeEntry) =>
    entry.id === optimisticId ? { ...entry, id: persistedId } : entry;
  return {
    ...data,
    activeEntry: data.activeEntry ? replaceId(data.activeEntry) : null,
    entries: dedupeMobileEntries(data.entries.map(replaceId)),
    historyEntries: data.historyEntries
      ? dedupeMobileEntries(data.historyEntries.map(replaceId))
      : data.historyEntries,
    dayEntries: data.dayEntries ? dedupeMobileEntries(data.dayEntries.map(replaceId)) : data.dayEntries,
    weekEntries: data.weekEntries ? dedupeMobileEntries(data.weekEntries.map(replaceId)) : data.weekEntries
  };
}

export function mobileTimeEntryById(data: MobileBootstrap | null, entryId: string) {
  if (!data) return null;
  if (data.activeEntry?.id === entryId) return data.activeEntry;
  return [
    ...data.entries,
    ...(data.historyEntries ?? []),
    ...(data.dayEntries ?? []),
    ...(data.weekEntries ?? [])
  ]
    .find((entry) => entry.id === entryId) ?? null;
}

function patchedMobileTimeEntry(
  entry: MobileTimeEntry,
  patch: TimeEntryUpdatePatch,
  categories: MobileBootstrap["categories"]
): MobileTimeEntry {
  const next: MobileTimeEntry = { ...entry, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "categoryId")) {
    const category = patch.categoryId
      ? categories.find((candidate) => candidate.id === patch.categoryId)
      : null;
    next.categoryId = patch.categoryId ?? null;
    next.categoryName = category?.name ?? null;
    next.categoryColor = category?.color ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "tagNames")) {
    const names = patch.tagNames ?? [];
    next.tagNames = names;
    next.tags = names.map((name) => {
      const tag = normalizeTagName(name);
      return {
        id: `optimistic-tag:${tag.normalizedName}`,
        name: tag.name,
        normalizedName: tag.normalizedName
      };
    });
  }
  const startedAtMs = Date.parse(next.startedAt);
  const stoppedAtMs = next.stoppedAt ? Date.parse(next.stoppedAt) : NaN;
  if (Number.isFinite(startedAtMs) && Number.isFinite(stoppedAtMs)) {
    next.durationSeconds = Math.max(0, Math.floor((stoppedAtMs - startedAtMs) / 1000));
  }
  return next;
}

function mergeOptimisticTags(
  current: NonNullable<MobileBootstrap["tags"]>,
  names: string[]
) {
  const byNormalizedName = new Map(current.map((tag) => [tag.normalizedName, tag]));
  for (const name of names) {
    const tag = normalizeTagName(name);
    if (!byNormalizedName.has(tag.normalizedName)) {
      byNormalizedName.set(tag.normalizedName, {
        id: `optimistic-tag:${tag.normalizedName}`,
        name: tag.name,
        normalizedName: tag.normalizedName,
        usageCount: 0
      });
    }
  }
  return [...byNormalizedName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function upsertMobileEntry(entries: MobileTimeEntry[], nextEntry: MobileTimeEntry) {
  const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);
  if (existingIndex < 0) return [nextEntry, ...entries];
  return entries.map((entry, index) => index === existingIndex ? nextEntry : entry);
}

function dedupeMobileEntries(entries: MobileTimeEntry[]) {
  const byId = new Map<string, MobileTimeEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return [...byId.values()];
}

export function buildMobileQuickActions(
  data: Pick<MobileBootstrap, "categories" | "categoryUsage"> | null
): MobileQuickAction[] {
  if (!data) return [];

  return sortMobileCategoriesByUsage(data.categories, data.categoryUsage)
    .filter(({ category }) => category.isPinned)
    .map(({ category }) => ({
      color: category.color ?? null,
      id: category.id,
      isUncategorized: false,
      key: `category:${category.id}`,
      name: category.name,
      subtitle: null
    }));
}

export function sortMobileCategoriesByUsage(
  categories: MobileBootstrap["categories"],
  categoryUsage: MobileBootstrap["categoryUsage"] = []
) {
  const usageByCategory = new Map((categoryUsage ?? []).map((rank) => [rank.categoryId, rank]));

  return categories
    .map((category, index) => ({ category, index, usage: usageByCategory.get(category.id) }))
    .sort((a, b) =>
      (b.usage?.score ?? 0) - (a.usage?.score ?? 0) ||
      (b.usage?.useCount ?? 0) - (a.usage?.useCount ?? 0) ||
      Date.parse(b.usage?.lastSeenAt ?? "1970-01-01T00:00:00.000Z") -
        Date.parse(a.usage?.lastSeenAt ?? "1970-01-01T00:00:00.000Z") ||
      a.index - b.index ||
      a.category.name.localeCompare(b.category.name)
    );
}
