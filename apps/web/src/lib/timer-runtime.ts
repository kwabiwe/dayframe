import { normalizeTagName } from "@dayframe/shared";
import type {
  CalendarEntryCompactPatch,
  CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { startMatchesRunning } from "@/lib/blocks-toast-copy";

export type TimerDraft = {
  categoryId: string;
  description: string;
  tagNames: string[];
};

export type TimerDraftInput = Partial<TimerDraft>;

export type TimerMutationGate = ReturnType<typeof createTimerMutationGate>;

export type TimerMutationOutcome = { ok: true } | { ok: false; error: string };
/**
 * An accepted Start also says what it replaced: the block running when this Start actually ran
 * (not when it was asked for, which a queued Start may outlive) and when the switch happened.
 */
export type TimerStartOutcome =
  | {
      ok: true;
      /** False when a later Start superseded this one: the result is that later Start's. */
      own: boolean;
      /** True when the Start asked for exactly the running block and so changed nothing. */
      alreadyRunning: boolean;
      /** The block left running when the Start was a no-op (alreadyRunning); null otherwise. */
      unchanged: BootstrapData["activeEntry"];
      replaced: BootstrapData["activeEntry"];
      switchedAt: string;
      /** The block this Start put on screen (its optimistic id); absent when it changed nothing. */
      startedEntryId?: string;
      /** The server's id for that block, from the accepted Start (when the server sent one). */
      startedServerId?: string;
    }
  | { ok: false; error: string };

export type TimerStartRequestPayload = {
  mode: "start";
  categoryId?: string;
  description?: string;
  /** A start in the past (Undo of a discarded running block); the server starts now without it. */
  startedAt?: string;
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
  // Callers waiting for the gate to be free (nothing running and nothing queued).
  let idleWaiters: Array<() => void> = [];
  const settleIdle = () => {
    if (activeGeneration !== null || queuedLatest) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

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
      if (!pending) settleIdle();
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
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    },
    /**
     * Resolves once nothing is running or queued: an action that must follow an in-flight Start
     * (a Stop of its optimistic block) waits here, then runs with what that Start settled.
     */
    whenIdle(): Promise<void> {
      if (!enabled || (activeGeneration !== generation && !queuedLatest)) return Promise.resolve();
      return new Promise<void>((resolve) => { idleWaiters.push(resolve); });
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

export type TimerDetailField = "categoryId" | "description" | "tagNames";
export const TIMER_DETAIL_FIELDS: readonly TimerDetailField[] = ["categoryId", "description", "tagNames"];

/**
 * Whether two drafts hold the same value for one field, as the server would store it: the
 * description trimmed (empty is none), no activity as none, tags by normalized name in any order.
 */
export function timerDetailEquivalent(field: TimerDetailField, left: TimerDraft, right: TimerDraft) {
  if (field === "categoryId") return (left.categoryId || null) === (right.categoryId || null);
  if (field === "description") return (left.description.trim() || null) === (right.description.trim() || null);
  return timerTagSetsEqual(left.tagNames, right.tagNames);
}

/**
 * The fields this tab's user changed: the draft compared with the server copy each field's edit
 * was based on (the base), never with whatever server copy is newest.
 */
export function timerDraftEditedFields(draft: TimerDraft, base: TimerDraft): TimerDetailField[] {
  return TIMER_DETAIL_FIELDS.filter((field) => !timerDetailEquivalent(field, draft, base));
}

/** The wire value of one field (as the PATCH sends it and the server stores it). */
export function timerDetailWireValue(field: TimerDetailField, draft: TimerDraft) {
  if (field === "categoryId") return draft.categoryId || null;
  if (field === "description") return draft.description.trim() || null;
  return [...draft.tagNames];
}

/**
 * A running block's details PATCH: only the fields the user edited, each with the value its edit
 * was based on (`expectedDetails`), so the server can refuse to overwrite a newer change made
 * elsewhere (409). Returns null when nothing was edited.
 */
export function timerDetailsPatch(draft: TimerDraft, base: TimerDraft) {
  const fields = timerDraftEditedFields(draft, base);
  if (!fields.length) return null;
  const body: Record<string, unknown> = {};
  const expectedDetails: Record<string, unknown> = {};
  for (const field of fields) {
    body[field] = timerDetailWireValue(field, draft);
    expectedDetails[field] = timerDetailWireValue(field, base);
  }
  return { fields, body: { ...body, expectedDetails } };
}

/** The base once `fields` of `draft` are saved: those fields as the server stores them. */
export function timerDraftBaseAfterSave(base: TimerDraft, draft: TimerDraft, fields: TimerDetailField[]): TimerDraft {
  return {
    categoryId: fields.includes("categoryId") ? draft.categoryId : base.categoryId,
    description: fields.includes("description") ? draft.description.trim() : base.description,
    tagNames: fields.includes("tagNames") ? [...draft.tagNames] : base.tagNames
  };
}

/** `draft` with only `fields` taken from it and every other field from `fallback`. */
export function pickTimerDraftFields(draft: TimerDraft, fallback: TimerDraft, fields: TimerDetailField[]): TimerDraft {
  return {
    categoryId: fields.includes("categoryId") ? draft.categoryId : fallback.categoryId,
    description: fields.includes("description") ? draft.description : fallback.description,
    tagNames: fields.includes("tagNames") ? draft.tagNames : fallback.tagNames
  };
}

/**
 * A newer server copy of the same block meets this tab's draft, field by field:
 * - a field the user has not edited (same as its base) shows the server's value when the server
 *   changed it, and is left exactly as typed otherwise (a trailing space survives a refresh);
 * - a field the user has edited keeps the edit. Its base moves to the server's copy only when the
 *   server did not change that field (or now holds the same value): an edit based on a value the
 *   server has since replaced keeps its old base, so saving it is refused (409) instead of
 *   overwriting the other change.
 * A different block replaces both.
 */
export function reconcileTimerDraftWithBase(
  activeEntryChanged: boolean,
  currentDraft: TimerDraft,
  base: TimerDraft,
  nextCanonicalDraft: TimerDraft
): { draft: TimerDraft; base: TimerDraft } {
  if (activeEntryChanged) return { draft: nextCanonicalDraft, base: nextCanonicalDraft };
  const draft = { ...currentDraft };
  const nextBase = { ...base };
  for (const field of TIMER_DETAIL_FIELDS) {
    const edited = !timerDetailEquivalent(field, currentDraft, base);
    const serverChanged = !timerDetailEquivalent(field, nextCanonicalDraft, base);
    if (!edited) {
      if (serverChanged) assignTimerField(draft, field, nextCanonicalDraft);
      assignTimerField(nextBase, field, nextCanonicalDraft);
    } else if (!serverChanged || timerDetailEquivalent(field, currentDraft, nextCanonicalDraft)) {
      assignTimerField(nextBase, field, nextCanonicalDraft);
    }
  }
  return { draft, base: nextBase };
}

export function reconcileTimerDraft(
  activeEntryChanged: boolean,
  currentDraft: TimerDraft,
  lastCanonicalDraft: TimerDraft,
  nextCanonicalDraft: TimerDraft
) {
  return reconcileTimerDraftWithBase(activeEntryChanged, currentDraft, lastCanonicalDraft, nextCanonicalDraft).draft;
}

function assignTimerField(target: TimerDraft, field: TimerDetailField, source: TimerDraft) {
  if (field === "categoryId") target.categoryId = source.categoryId;
  else if (field === "description") target.description = source.description;
  else target.tagNames = source.tagNames;
}

function timerTagSetsEqual(left: string[], right: string[]) {
  const normalizedLeft = [...new Set(left.map((name) => normalizeTagName(name).normalizedName))].sort();
  const normalizedRight = [...new Set(right.map((name) => normalizeTagName(name).normalizedName))].sort();
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((name, index) => name === normalizedRight[index]);
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

export function timerStartRequestPayload(draft: TimerDraft, startedAt?: string): TimerStartRequestPayload {
  return {
    mode: "start",
    categoryId: draft.categoryId || undefined,
    description: draft.description.trim() || undefined,
    ...(startedAt ? { startedAt } : {}),
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
  onRollback,
  commit,
  setDraft,
  setBusy,
  setError,
  send,
  refresh,
  beforeStart,
  dedupeRunning = false,
  guard,
  startAt
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
  /** Called just before a rejected Start restores the snapshot, with the draft the bar keeps. */
  onRollback?: (keptDraft: TimerDraft, restoredEntryId: string | null) => void;
  commit: (data: BootstrapData) => void;
  setDraft: (draft: TimerDraft) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  /** Sends the Start; may resolve with the server's id for the new block. */
  send: (payload: TimerStartRequestPayload) => Promise<string | void>;
  refresh: () => Promise<void>;
  /**
   * Runs first inside the gate: saves the outgoing block's pending edits before it is replaced. A
   * returned notice (its edits were refused, 409) stays shown through the switch instead of being
   * cleared with the Start's error.
   */
  beforeStart?: () => Promise<{ notice?: string } | void>;
  /**
   * A quick start for exactly the block that is running when this Start runs (not when it was
   * asked for) changes nothing instead of stopping and restarting it.
   */
  dedupeRunning?: boolean;
  /**
   * Checked inside the gate, against the snapshot this Start would replace, before anything is
   * shown: a message refuses the Start (Undo of a discard that would overlap; Codex r1 on #469).
   */
  guard?: (snapshot: BootstrapData) => string | null;
  /** Start at this instant instead of now (Undo of a discarded running block, WUI-008). */
  startAt?: string;
}): Promise<TimerStartOutcome> {
  const result = await gate.runLatest(async (): Promise<TimerStartOutcome> => {
    const carried = beforeStart ? await beforeStart() : undefined;
    const notice = carried ? carried.notice ?? null : null;
    const acceptedSnapshot = getCurrentSnapshot?.() ?? snapshot;
    const refusal = guard?.(acceptedSnapshot);
    if (refusal) return { ok: false, error: refusal } as const;
    const acceptedDraft = getCurrentDraft?.() ?? currentDraft;
    const draft = mergeTimerDraft(acceptedDraft, input);
    const startedAt = startAt ?? now();
    if (dedupeRunning && startMatchesRunning(acceptedSnapshot.activeEntry, { ...draft, categoryId: draft.categoryId || null })) {
      return { ok: true, own: true, alreadyRunning: true, unchanged: acceptedSnapshot.activeEntry, replaced: null, switchedAt: startedAt } as const;
    }
    onAccepted?.();
    setBusy(true);
    setError(notice);
    const startedEntryId = createOptimisticId(startedAt);
    commit(applyOptimisticTimerStart(acceptedSnapshot, draft, startedAt, startedEntryId));
    setDraft(draft);

    try {
      const startedServerId = (await send(timerStartRequestPayload(draft, startAt))) || undefined;
      return {
        ok: true,
        own: true,
        alreadyRunning: false,
        unchanged: null,
        replaced: acceptedSnapshot.activeEntry,
        startedEntryId,
        ...(startedServerId ? { startedServerId } : {}),
        switchedAt: startedAt
      } as const;
    } catch (error) {
      // A failed switch returns to the entry that is still running, with its own details (a
      // draft typed for the rejected entry must not be saved onto it). From idle, keep anything
      // typed while the Start was pending, otherwise what was started, so a retry is one press.
      const latestDraft = getCurrentDraft?.() ?? draft;
      const keptDraft = acceptedSnapshot.activeEntry
        ? timerDraftForEntry(acceptedSnapshot.activeEntry)
        : timerDraftsEqual(latestDraft, draft) ? draft : latestDraft;
      onRollback?.(keptDraft, acceptedSnapshot.activeEntry?.id ?? null);
      commit(acceptedSnapshot);
      setDraft(keptDraft);
      const message = timerStartErrorMessage(error);
      setError(message);
      return { ok: false, error: message } as const;
    } finally {
      setBusy(false);
    }
  });

  if (!result.ran) return { ok: false, error: "The block update was cancelled." };
  if (result.ownsResult && result.value.ok && !result.value.alreadyRunning && !gate.isActive()) await refresh();
  // A superseded waiter is handed the latest Start's result; it is not this Start's to announce.
  return result.value.ok ? { ...result.value, own: result.ownsResult } : result.value;
}

/**
 * Why a discarded running block cannot come back at its own start now (Undo, WUI-008; Codex r1 on
 * #469): something is running, or a block other than the discarded one covers any of the time
 * from its start until now. Null when it can.
 */
export const DISCARD_RESTORE_REFUSALS = [
  "Another block is running now, so the discarded one can't come back.",
  "Another block now covers that time, so the discarded one can't come back."
] as const;

export function discardedBlockRestoreBlocker(snapshot: BootstrapData, discarded: Pick<TimeEntryRow, "id" | "startedAt">, now = Date.now()) {
  if (snapshot.activeEntry) return DISCARD_RESTORE_REFUSALS[0];
  const start = Date.parse(discarded.startedAt);
  const covered = snapshot.entries.some((entry) => entry.id !== discarded.id &&
    Date.parse(entry.startedAt) < now &&
    (entry.stoppedAt ? Date.parse(entry.stoppedAt) : now) > start);
  return covered ? DISCARD_RESTORE_REFUSALS[1] : null;
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
      error: "This block has no description or activity to start."
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
  return "Unable to start the block.";
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

/**
 * A split of the running block the server accepted (owner 28 Oct 2026): it ends at `splitAt`, and its second
 * part, `newEntryId`, runs from there with the same details, until the day's next load confirms it.
 */
export function applyOptimisticTimerSplit(data: BootstrapData, splitAt: string, newEntryId: string) {
  const active = data.activeEntry;
  if (!active) return data;
  const durationSeconds = Math.max(0, Math.floor((Date.parse(splitAt) - Date.parse(active.startedAt)) / 1000));
  const first = { ...active, stoppedAt: splitAt, durationSeconds };
  const second = { ...active, id: newEntryId, startedAt: splitAt, stoppedAt: null, updatedAt: splitAt, durationSeconds: 0 };
  return replaceEntryCollections(replaceEntryCollections({ ...data, activeEntry: second }, first), second);
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
  if (!snapshot.activeEntry) return { ok: false, error: "There is no running block to edit." };
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
    : { ok: false, error: "A block update is already in progress." };
}

export function timerCompactEditErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Block details were not saved. Your previous values were restored.";
}

/** The server's current copy of the running block (a refused save's answer) replaces the shown one. */
export function applyServerActiveEntry(data: BootstrapData, shownId: string, entry: TimeEntryRow) {
  if (data.activeEntry?.id !== shownId || entry.stoppedAt) return data;
  const withoutShown = shownId === entry.id ? data : {
    ...data,
    entries: data.entries.filter((item) => item.id !== shownId),
    historyEntries: data.historyEntries.filter((item) => item.id !== shownId),
    dayEntries: data.dayEntries.filter((item) => item.id !== shownId),
    weekEntries: data.weekEntries.filter((item) => item.id !== shownId)
  };
  return replaceEntryCollections({ ...withoutShown, activeEntry: entry }, entry);
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
