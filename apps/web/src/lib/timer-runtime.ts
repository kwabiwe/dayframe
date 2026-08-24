import { normalizeTagName } from "@dayframe/shared";
import type {
  CalendarEntryCompactPatch,
  CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

export type TimerDraft = {
  categoryId: string;
  description: string;
  tagNames: string[];
};

export type TimerDraftInput = Partial<TimerDraft>;

export type TimerMutationGate = ReturnType<typeof createTimerMutationGate>;

export type TimerMutationOutcome = { ok: true } | { ok: false; error: string };

export type TimerStartRequestPayload = {
  mode: "start";
  categoryId?: string;
  description?: string;
  tagNames: string[];
};

export type ActiveEntryCompactMutationInput = {
  plan: CalendarEntryCompactSavePlan;
};

export type EntryContinuationDecision =
  | { ok: true; draft: TimerDraft }
  | { ok: false; error: string };

type GateCancellation = { ran: false; cancelled: true };
type GateExecutionResult<T> = { ran: true; value: T } | GateCancellation;
type GateLatestResult<T> =
  | { ran: true; value: T; ownsResult: boolean }
  | (GateCancellation & { ownsResult: false });

export function createTimerMutationGate() {
  let enabled = true;
  let generation = 1;
  let activeGeneration: number | null = null;
  let nextWaiterId = 0;
  let queuedLatest: {
    generation: number;
    mutation: () => Promise<unknown>;
    latestWaiterId: number;
    waiters: Array<{
      id: number;
      resolve: (result: GateLatestResult<unknown>) => void;
      reject: (reason?: unknown) => void;
    }>;
  } | null = null;

  const cancelled = (): GateCancellation => ({ ran: false, cancelled: true });

  const execute = async <T>(
    mutation: () => Promise<T>,
    executionGeneration: number
  ): Promise<GateExecutionResult<T>> => {
    if (!enabled || executionGeneration !== generation) return cancelled();
    activeGeneration = executionGeneration;
    try {
      if (!enabled || executionGeneration !== generation) return cancelled();
      return { ran: true as const, value: await mutation() };
    } finally {
      if (activeGeneration === executionGeneration) activeGeneration = null;
      const pending = enabled && executionGeneration === generation &&
        queuedLatest?.generation === executionGeneration
        ? queuedLatest
        : null;
      if (pending) {
        queuedLatest = null;
        const pendingRun = execute(pending.mutation, executionGeneration);
        void pendingRun.then(
          (result) => {
            for (const waiter of pending.waiters) {
              waiter.resolve(result.ran
                ? {
                    ...result,
                    ownsResult: waiter.id === pending.latestWaiterId
                  }
                : { ...result, ownsResult: false });
            }
          },
          (error) => {
            for (const waiter of pending.waiters) waiter.reject(error);
          }
        );
      }
    }
  };

  const cancelQueuedLatest = () => {
    const pending = queuedLatest;
    queuedLatest = null;
    if (!pending) return;
    for (const waiter of pending.waiters) {
      waiter.resolve({ ran: false, cancelled: true, ownsResult: false });
    }
  };

  return {
    activate() {
      if (enabled) return;
      generation += 1;
      enabled = true;
    },
    dispose() {
      if (!enabled) return;
      enabled = false;
      generation += 1;
      cancelQueuedLatest();
    },
    isActive() {
      return enabled && activeGeneration === generation;
    },
    async run<T>(mutation: () => Promise<T>) {
      if (!enabled) return cancelled();
      if (activeGeneration === generation) return { ran: false as const };
      return execute(mutation, generation);
    },
    async runLatest<T>(mutation: () => Promise<T>): Promise<GateLatestResult<T>> {
      if (!enabled) return { ...cancelled(), ownsResult: false };
      if (activeGeneration !== generation) {
        const result = await execute(mutation, generation);
        return result.ran
          ? { ...result, ownsResult: true }
          : { ...result, ownsResult: false };
      }

      const waiterId = ++nextWaiterId;
      const pending = new Promise<GateLatestResult<unknown>>((resolve, reject) => {
        const waiter = { id: waiterId, resolve, reject };
        if (queuedLatest?.generation === generation) {
          queuedLatest.mutation = mutation as () => Promise<unknown>;
          queuedLatest.latestWaiterId = waiterId;
          queuedLatest.waiters.push(waiter);
        } else {
          queuedLatest = {
            generation,
            mutation: mutation as () => Promise<unknown>,
            latestWaiterId: waiterId,
            waiters: [waiter]
          };
        }
      });
      return pending as Promise<GateLatestResult<T>>;
    }
  };
}

export function timerDraftForEntry(entry: TimeEntryRow | null | undefined): TimerDraft {
  return {
    categoryId: entry?.categoryId ?? "",
    description: entry?.description ?? "",
    tagNames: entry?.tagNames ?? []
  };
}

export function timerDraftsEqual(left: TimerDraft, right: TimerDraft) {
  return left.categoryId === right.categoryId &&
    left.description === right.description &&
    timerTagNamesEqual(left.tagNames, right.tagNames);
}

export function reconcileTimerDraft(
  activeEntryChanged: boolean,
  currentDraft: TimerDraft,
  lastCanonicalDraft: TimerDraft,
  nextCanonicalDraft: TimerDraft
) {
  if (activeEntryChanged) return nextCanonicalDraft;
  return {
    categoryId: currentDraft.categoryId === lastCanonicalDraft.categoryId
      ? nextCanonicalDraft.categoryId
      : currentDraft.categoryId,
    description: currentDraft.description === lastCanonicalDraft.description
      ? nextCanonicalDraft.description
      : currentDraft.description,
    tagNames: timerTagNamesEqual(currentDraft.tagNames, lastCanonicalDraft.tagNames)
      ? nextCanonicalDraft.tagNames
      : currentDraft.tagNames
  };
}

function timerTagNamesEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const normalizedLeft = left.map((name) => normalizeTagName(name).normalizedName).sort();
  const normalizedRight = right.map((name) => normalizeTagName(name).normalizedName).sort();
  return normalizedLeft.every((name, index) => name === normalizedRight[index]);
}

export function quickActionTimerDraft(categoryId: string | null | undefined): TimerDraft {
  return {
    categoryId: categoryId ?? "",
    description: "",
    tagNames: []
  };
}

export function timerStartRequestPayload(draft: TimerDraft): TimerStartRequestPayload {
  return {
    mode: "start",
    categoryId: draft.categoryId || undefined,
    description: draft.description.trim() || undefined,
    tagNames: draft.tagNames
  };
}

export async function runTimerStartMutation({
  gate,
  snapshot,
  currentDraft,
  input,
  now,
  createOptimisticId,
  getCurrentDraft,
  getCurrentSnapshot,
  onAccepted,
  commit,
  setDraft,
  setBusy,
  setError,
  send,
  refresh
}: {
  gate: TimerMutationGate;
  snapshot: BootstrapData;
  currentDraft: TimerDraft;
  input: TimerDraftInput;
  now: () => string;
  createOptimisticId: (startedAt: string) => string;
  getCurrentDraft?: () => TimerDraft;
  getCurrentSnapshot?: () => BootstrapData;
  onAccepted?: () => void;
  commit: (data: BootstrapData) => void;
  setDraft: (draft: TimerDraft) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  send: (payload: TimerStartRequestPayload) => Promise<void>;
  refresh: () => Promise<void>;
}): Promise<TimerMutationOutcome> {
  const result = await gate.runLatest(async () => {
    const acceptedSnapshot = getCurrentSnapshot?.() ?? snapshot;
    const acceptedDraft = getCurrentDraft?.() ?? currentDraft;
    const draft = mergeTimerDraft(acceptedDraft, input);
    const startedAt = now();
    onAccepted?.();
    setBusy(true);
    setError(null);
    commit(applyOptimisticTimerStart(acceptedSnapshot, draft, startedAt, createOptimisticId(startedAt)));
    setDraft(draft);

    try {
      await send(timerStartRequestPayload(draft));
      return { ok: true } as const;
    } catch (error) {
      commit(acceptedSnapshot);
      setDraft(timerDraftForEntry(acceptedSnapshot.activeEntry));
      const message = timerStartErrorMessage(error);
      setError(message);
      return { ok: false, error: message } as const;
    } finally {
      setBusy(false);
    }
  });

  if (!result.ran) return { ok: false, error: "Timer update was cancelled." };
  if (result.ownsResult && result.value.ok && !gate.isActive()) await refresh();
  return result.value;
}

export function mergeTimerDraft(current: TimerDraft, input: TimerDraftInput): TimerDraft {
  return {
    categoryId: input.categoryId ?? current.categoryId,
    description: input.description ?? current.description,
    tagNames: input.tagNames ?? current.tagNames
  };
}

export function timerDraftVersion(entry: TimeEntryRow | null | undefined) {
  return entry ? `${entry.id}:${entry.updatedAt}` : "idle";
}

export function entryContinuationDecision(
  entry: TimeEntryRow
): EntryContinuationDecision {
  const description = entry.description?.trim() ?? "";
  if (!entry.categoryId && !description) {
    return {
      ok: false,
      error: "This entry does not have a task or category to start."
    };
  }

  return {
    ok: true,
    draft: {
      categoryId: entry.categoryId ?? "",
      description,
      tagNames: [...entry.tagNames]
    }
  };
}

export function timerStartErrorMessage(error: unknown) {
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return "Unable to start right now. Check your connection and try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unable to start the timer.";
}

export function applyOptimisticTimerStart(
  data: BootstrapData,
  draft: TimerDraft,
  startedAt: string,
  id: string
) {
  const replacementBase = data.activeEntry
    ? applyOptimisticTimerStop(data, startedAt)
    : data;
  const category = replacementBase.categories.find((item) => item.id === draft.categoryId) ?? null;
  const tags = draft.tagNames.map((name) => {
    const normalizedName = normalizeTagName(name).normalizedName;
    const existing = replacementBase.tags.find((tag) => tag.normalizedName === normalizedName);
    return {
      id: existing?.id ?? `optimistic-tag:${normalizedName}`,
      name: existing?.name ?? name,
      normalizedName
    };
  });
  const entry: TimeEntryRow = {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: draft.description.trim() || null,
    startedAt,
    stoppedAt: null,
    updatedAt: startedAt,
    durationSeconds: 0,
    tagNames: draft.tagNames,
    tags
  };

  return replaceEntryCollections({ ...replacementBase, activeEntry: entry }, entry);
}

export function applyOptimisticTimerStop(data: BootstrapData, stoppedAt: string) {
  if (!data.activeEntry) return data;
  const durationSeconds = Math.max(
    data.activeEntry.durationSeconds,
    Math.floor((new Date(stoppedAt).getTime() - new Date(data.activeEntry.startedAt).getTime()) / 1000)
  );
  const entry = { ...data.activeEntry, stoppedAt, updatedAt: stoppedAt, durationSeconds };
  return replaceEntryCollections({ ...data, activeEntry: null }, entry);
}

export function applyOptimisticTimerDelete(data: BootstrapData) {
  if (!data.activeEntry) return data;
  const activeId = data.activeEntry.id;
  return {
    ...data,
    activeEntry: null,
    entries: data.entries.filter((entry) => entry.id !== activeId),
    historyEntries: data.historyEntries.filter((entry) => entry.id !== activeId),
    dayEntries: data.dayEntries.filter((entry) => entry.id !== activeId),
    weekEntries: data.weekEntries.filter((entry) => entry.id !== activeId)
  };
}

export function applyOptimisticActiveEntryPatch(
  data: BootstrapData,
  draft: TimerDraft,
  startedAt = data.activeEntry?.startedAt
) {
  if (!data.activeEntry) return data;
  const category = data.categories.find((item) => item.id === draft.categoryId) ?? null;
  const entry: TimeEntryRow = {
    ...data.activeEntry,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    description: draft.description.trim() || null,
    startedAt: startedAt ?? data.activeEntry.startedAt,
    durationSeconds: startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : data.activeEntry.durationSeconds,
    tagNames: draft.tagNames,
    tags: draft.tagNames.map((name) => {
      const normalizedName = normalizeTagName(name).normalizedName;
      const existing = data.tags.find((tag) => tag.normalizedName === normalizedName);
      return {
        id: existing?.id ?? `optimistic-tag:${normalizedName}`,
        name: existing?.name ?? name,
        normalizedName
      };
    })
  };
  return replaceEntryCollections({ ...data, activeEntry: entry }, entry);
}

export function applyOptimisticActiveEntryCompactPatch(
  data: BootstrapData,
  plan: CalendarEntryCompactSavePlan
) {
  if (!data.activeEntry) return data;
  const category = data.categories.find((item) => item.id === plan.resolved.categoryId) ?? null;
  const entry: TimeEntryRow = {
    ...data.activeEntry,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    description: plan.resolved.description,
    startedAt: plan.resolved.startedAt,
    stoppedAt: plan.resolved.stoppedAt,
    durationSeconds: plan.durationSeconds,
    tagNames: [...plan.resolved.tagNames],
    tags: plan.resolved.tagNames.map((name) => {
      const normalizedName = normalizeTagName(name).normalizedName;
      const existing = data.tags.find((tag) => tag.normalizedName === normalizedName);
      return {
        id: existing?.id ?? `optimistic-tag:${normalizedName}`,
        name: existing?.name ?? name,
        normalizedName
      };
    })
  };
  return replaceEntryCollections({ ...data, activeEntry: entry }, entry);
}

export async function runActiveEntryCompactMutation({
  commit,
  draftSnapshot,
  gate,
  getCurrentData,
  input,
  refresh,
  send,
  setBusy,
  setDraft,
  setError,
  snapshot
}: {
  commit: (data: BootstrapData) => void;
  draftSnapshot: TimerDraft;
  gate: TimerMutationGate;
  getCurrentData: () => BootstrapData | null;
  input: ActiveEntryCompactMutationInput;
  refresh: () => Promise<void>;
  send: (entryId: string, payload: CalendarEntryCompactPatch) => Promise<{ updatedAt?: string }>;
  setBusy: (busy: boolean) => void;
  setDraft: (draft: TimerDraft) => void;
  setError: (error: string | null) => void;
  snapshot: BootstrapData;
}): Promise<TimerMutationOutcome> {
  if (!snapshot.activeEntry) return { ok: false, error: "There is no running timer to edit." };
  const activeEntry = snapshot.activeEntry;
  const nextDraft: TimerDraft = {
    categoryId: input.plan.resolved.categoryId ?? "",
    description: input.plan.resolved.description ?? "",
    tagNames: [...input.plan.resolved.tagNames]
  };
  const result = await gate.run(async () => {
    setBusy(true);
    setError(null);
    commit(applyOptimisticActiveEntryCompactPatch(snapshot, input.plan));
    setDraft(nextDraft);
    try {
      const response = await send(activeEntry.id, input.plan.payload);
      const current = getCurrentData();
      if (response.updatedAt && current) {
        commit(applyAuthoritativeActiveEntryVersion(current, activeEntry.id, response.updatedAt));
      }
      return { ok: true } as const;
    } catch (error) {
      commit(snapshot);
      setDraft(draftSnapshot);
      const message = timerCompactEditErrorMessage(error);
      setError(message);
      return { ok: false, error: message } as const;
    } finally {
      setBusy(false);
    }
  });
  if (result.ran && result.value.ok && !gate.isActive()) await refresh();
  return result.ran
    ? result.value
    : { ok: false, error: "A timer update is already in progress." };
}

export function timerCompactEditErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Timer details were not saved. Your previous values were restored.";
}

export function applyAuthoritativeActiveEntryVersion(
  data: BootstrapData,
  entryId: string,
  updatedAt: string
) {
  if (data.activeEntry?.id !== entryId) return data;
  const entry = { ...data.activeEntry, updatedAt };
  return replaceEntryCollections({ ...data, activeEntry: entry }, entry);
}

function replaceEntryCollections(data: BootstrapData, entry: TimeEntryRow) {
  return {
    ...data,
    entries: replaceEntry(data.entries, entry),
    historyEntries: replaceEntry(data.historyEntries, entry),
    dayEntries: entryOverlaps(entry, data.dateRange.dayStart, data.dateRange.dayEnd)
      ? replaceEntry(data.dayEntries, entry)
      : data.dayEntries.filter((item) => item.id !== entry.id),
    weekEntries: entryOverlaps(entry, data.dateRange.weekStart, data.dateRange.weekEnd)
      ? replaceEntry(data.weekEntries, entry)
      : data.weekEntries.filter((item) => item.id !== entry.id)
  };
}

function replaceEntry(entries: TimeEntryRow[], entry: TimeEntryRow) {
  const withoutEntry = entries.filter((item) => item.id !== entry.id);
  return [entry, ...withoutEntry].sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

function entryOverlaps(entry: TimeEntryRow, rangeStart: string, rangeEnd: string) {
  const startedAt = new Date(entry.startedAt).getTime();
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : Date.now();
  return startedAt < new Date(rangeEnd).getTime() && stoppedAt > new Date(rangeStart).getTime();
}
