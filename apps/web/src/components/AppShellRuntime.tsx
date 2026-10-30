"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  TIMER_STATE_RECONCILE_INTERVAL_MS,
  timerStateChanged,
  type DayframePaletteKey,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";
import { joinSplitTimeEntries, splitRunningTimeEntry } from "@/lib/time-entry-split";
import { onBeforeSessionChange } from "@/lib/session-change";
import { webTimerStatePollDelay } from "@/lib/timer-state-poll";
import {
  applyPendingTimerDetails,
  clearPendingTimerDetails,
  endPendingTimerDetailsSession,
  fitsKeepalive,
  KEEPALIVE_BODY_LIMIT_BYTES,
  pendingTimerDetailsDecision,
  pendingTimerDetailsGeneration,
  readPendingTimerDetails,
  writePendingTimerDetails
} from "@/lib/timer-draft-store";
import type { BootstrapData, CategoryRow, TimeEntryRow } from "@/lib/queries";
import { projectBlockEnds } from "@/lib/block-end-projection";
import { snapshotFitsViewerZone } from "@/lib/viewer-time-zone";
import { timelineStateFromSearchParams } from "@/lib/timeline-view";
import { goalDrafts } from "@/lib/goal-stepper";
import {
  applyAuthoritativeActiveEntryVersion,
  applyOptimisticActiveEntryPatch,
  applyOptimisticTimerDelete,
  applyServerTimerBlocks,
  applyOptimisticTimerStop,
  applyServerActiveEntry,
  createTimerMutationGate,
  entryContinuationDecision,
  mergeTimerDraft,
  pickTimerDraftFields,
  reconcileTimerDraftWithBase,
  runActiveEntryCompactMutation,
  runTimerStartMutation,
  timerDetailEquivalent,
  timerDetailWireValue,
  timerDetailsPatch,
  timerDraftBaseAfterSave,
  timerDraftEditedFields,
  timerDraftForEntry,
  timerDraftsEqual,
  timerDraftVersion,
  type TimerDetailField,
  type TimerDraft,
  type TimerDraftInput,
  type TimerStartOutcome,
  type ActiveEntryCompactMutationInput
} from "@/lib/timer-runtime";
import {
  reconcileTimerBootstrap,
  type BootstrapCommitSource
} from "@/lib/timer-bootstrap-reconciliation";

type MutationOutcome = { ok: true } | { ok: false; error: string };
export type ActiveSplitOutcome = { ok: true; entryId: string; newEntryId: string; running: boolean } | { ok: false; error: string };
const UNDO_AFTER_EDIT_MESSAGE = "Save your edits to this block first: Undo would lose them.";
type DateLoadOutcome = { ok: true } | { ok: false; error: string };
type CategoryMutationOutcome =
  | { ok: true; category: CategoryRow }
  | { ok: false; error: string };

type ManualEntryInput = {
  categoryId?: string;
  description?: string;
  tagNames: string[];
  startedAt: string;
  stoppedAt: string;
};

type RuntimeContext = {
  clearDateLoadError: () => void;
  clearTimerError: () => void;
  closeManualEntry: () => void;
  createCategory: (name: string, color?: DayframePaletteKey, icon?: string) => Promise<CategoryMutationOutcome>;
  createManualEntry: (input: ManualEntryInput) => Promise<MutationOutcome>;
  deleteActiveTimer: () => Promise<MutationOutcome>;
  /**
   * Splits the running block at `atMs` (owner 28 Oct 2026, as Toggl): it ends there, and its second part
   * keeps running with every detail. The outcome names both blocks, for Undo.
   */
  splitActiveTimer: (atMs: number) => Promise<ActiveSplitOutcome>;
  /** Undo of a split: puts the two blocks back as one (running again when the second part runs). */
  joinSplitTimer: (split: { entryId: string; newEntryId: string; commandId?: string }) => Promise<MutationOutcome>;
  data: BootstrapData | null;
  dateLoadError: string | null;
  hydrate: (data: BootstrapData) => void;
  isDateLoading: boolean;
  isManualEntryOpen: boolean;
  isTimerBusy: boolean;
  /** A Stop is waiting for a save already in flight (at most `STOP_WAIT_DEADLINE_MS`). */
  isStopPending: boolean;
  loadDate: (date: string) => Promise<DateLoadOutcome>;
  openManualEntry: () => void;
  refresh: (options?: { force?: boolean }) => Promise<BootstrapData | null>;
  selectedDate: string;
  setTimerDraft: (draft: TimerDraft | ((current: TimerDraft) => TimerDraft)) => void;
  shellData: BootstrapData | null;
  startEntryAgain: (entry: TimeEntryRow) => Promise<MutationOutcome>;
  startTimer: (
    input?: TimerDraftInput,
    options?: { dedupeRunning?: boolean; guard?: (snapshot: BootstrapData) => string | null; startedAt?: string }
  ) => Promise<TimerStartOutcome>;
  stopTimer: (input?: TimerDraftInput) => Promise<MutationOutcome>;
  timerDraft: TimerDraft;
  /**
   * True when this tab's user has edited the running block's details: the draft differs from the
   * server copy each field's edit was based on. Only then may the bar autosave (never because a
   * newer server copy differs from what this tab shows).
   */
  timerDraftEdited: boolean;
  /**
   * The block the draft belongs to: a fresh token on every genuine change of block (a rollback and
   * a return to an earlier block included); kept only across an accepted Start's handoff.
   */
  timerDraftScope: string;
  timerError: string | null;
  toggleTimer: () => Promise<MutationOutcome>;
  updateActiveDetails: (draft: TimerDraft) => Promise<MutationOutcome>;
  updateActiveEntryFromCalendar: (input: ActiveEntryCompactMutationInput) => Promise<MutationOutcome>;
  /**
   * Moves the running block's start. With `expectedEntryIds` (the ids a Start just reported for its
   * block: optimistic and server) it edits only that block, never one that has replaced it.
   */
  updateActiveStartTime: (startedAt: string, options?: { expectedEntryIds?: readonly string[] }) => Promise<MutationOutcome>;
  /** The blocks as the runtime has them now (newer than the last render after an awaited mutation). */
  readShellData: () => BootstrapData | null;
  /**
   * The shell's data as the server last sent it, without the End it projection below (the "?" owner confirms its
   * projections against it). `data` and `shellData` are projected.
   */
  canonicalShellData?: BootstrapData | null;
  /**
   * End it held, saving or queued for a block that ran into a trip (location v4 design §7), by block id: the trip's
   * start. The timer shows that block ended there — the running one no longer runs, so the bar, Today and the
   * Calendar offer Start, not Stop — until Undo, a refusal or canonical data retires it (Codex r1 on #618).
   */
  setProjectedEnds?: (ends: ReadonlyMap<string, string>) => void;
};


const AppShellRuntimeContext = createContext<RuntimeContext | null>(null);
export const BOOTSTRAP_RECONCILE_INTERVAL_MS = TIMER_STATE_RECONCILE_INTERVAL_MS;
export const BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS = 10_000;
export const DATE_DATA_CACHE_LIMIT = 8;
/** How long a timer action of the user's holds the timer-state poll's answers off at most (a stalled reload). */
export const TIMER_ACTION_SETTLE_LIMIT_MS = 30_000;

export function AppShellRuntimeProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const selectedDate = timelineStateFromSearchParams(searchParams).date;
  const [data, setData] = useState<BootstrapData | null>(null);
  const [timerDraft, setTimerDraftState] = useState<TimerDraft>(() => timerDraftForEntry(null));
  const [isTimerBusy, setIsTimerBusy] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [isDateLoading, setIsDateLoading] = useState(false);
  const [dateLoadError, setDateLoadError] = useState<string | null>(null);
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const dataRef = useRef<BootstrapData | null>(null);
  // End it projections (design §7): a running block End it ends shows ended, so the timer's one action is Start.
  const [projectedEnds, setProjectedEndsState] = useState<ReadonlyMap<string, string>>(() => new Map());
  const projectedEndsRef = useRef(projectedEnds);
  useLayoutEffect(() => {
    projectedEndsRef.current = projectedEnds;
  }, [projectedEnds]);
  // Snapshots by workspace and day (dateDataCacheKey). It only ever holds the workspace of the
  // newest commit: a commit for another workspace (a switch) empties it first (WEB-UI-6).
  const dateDataCacheRef = useRef(new Map<string, BootstrapData>());
  const dateDataCacheWorkspaceRef = useRef<string | null>(null);
  // The workspace lifetime: bumped when a commit accepts another workspace (a switch). A load or
  // refresh started in an earlier lifetime never commits, so a late answer from the workspace
  // left never undoes the switch (Codex r1 on #544).
  const workspaceGenerationRef = useRef(0);
  // Polls the timer state now, inside the running poll chain (set by that chain; WEB-UI-4).
  const pollTimerStateNowRef = useRef<(() => void) | null>(null);
  // The user's own timer actions still settling, each until its own reload has (`trackTimerAction`), by
  // sequence: when it started and for which workspace lifetime.
  const timerActionsRef = useRef(new Map<number, { startedAt: number; generation: number }>());
  const timerActionSeqRef = useRef(0);
  /**
   * Whether an action of the user's is still current: retired once a newer action settles (superseded), once
   * the workspace or account changes, and once it has run TIMER_ACTION_SETTLE_LIMIT_MS (a stalled reload),
   * so a stuck action never holds polls off (Codex r2 on #637).
   */
  const hasCurrentTimerAction = useCallback(() => {
    const now = Date.now();
    for (const [seq, action] of timerActionsRef.current) {
      if (action.generation !== workspaceGenerationRef.current || now - action.startedAt >= TIMER_ACTION_SETTLE_LIMIT_MS) {
        timerActionsRef.current.delete(seq);
      }
    }
    return timerActionsRef.current.size > 0;
  }, []);
  // The period the URL shows now, read by `refresh` so it is one stable callback: a refresh asked
  // for (or a Delete's onSynced bound) before a period change loads the period shown when it runs,
  // and an answer for a period left meanwhile is dropped (WEB-UI-3).
  const selectedDateRef = useRef(selectedDate);
  useLayoutEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);
  // The day whose shown copy came from the cache and is not yet confirmed by a fresh load: it is
  // revalidated once it is the URL's period (stale-while-revalidate, WEB-UI-5).
  const cacheShownDateRef = useRef<string | null>(null);
  /**
   * A cached day of the current workspace, only when its ranges were built for the zone the
   * browser sends now (Codex r1 on #484): a snapshot from before the zone cookie existed, or from
   * another zone, is fetched again.
   */
  const cachedDateData = useCallback((date: string) => {
    const workspaceId = dataRef.current?.workspace.id;
    if (!workspaceId) return undefined;
    const cached = dateDataCacheRef.current.get(dateDataCacheKey(workspaceId, date));
    if (!cached) return undefined;
    // A misfit stays until a fresh load of that day replaces it.
    return snapshotFitsViewerZone(cached.viewerTimeZone, typeof document === "undefined" ? null : document.cookie) ? cached : undefined;
  }, []);
  const draftRef = useRef(timerDraft);
  // The base: per field, the server copy this tab's edit of that field is based on (the newest
  // server copy for a field the user has not edited). Autosave sends only the fields that differ
  // from it, each with its base value, so the server refuses to overwrite a newer change (409).
  const canonicalTimerDraftRef = useRef(timerDraftForEntry(null));
  // The block the base belongs to (null: idle).
  const baseEntryIdRef = useRef<string | null>(null);
  const [timerDraftBase, setTimerDraftBaseState] = useState<{ entryId: string | null; draft: TimerDraft }>(
    () => ({ entryId: null, draft: timerDraftForEntry(null) })
  );
  // Details saves in flight: a server copy of the running block that is not newer than the shown
  // (optimistic) one cannot replace it meanwhile, so a period load or a refresh requested before
  // the PATCH and answered while it is pending never brings the old details back.
  const detailsSavesInFlightRef = useRef(0);
  const timerDraftEntryIdRef = useRef<string | null>(null);
  const activeEntryVersionRef = useRef("unhydrated");
  // Set by a rejected Start: the next active-entry identity change keeps this draft instead of
  // resetting the bar to the restored entry's details.
  const rollbackDraftRef = useRef<{ draft: TimerDraft; entryId: string | null } | null>(null);
  // Which block the draft belongs to: a fresh token for every genuine change of block (a new
  // block, going idle, a rejected Start's rollback, a return to an earlier block), so stale
  // completion state can never match it again. Only an accepted Start's handoff from its
  // optimistic block to the real one keeps the token.
  const scopeCounterRef = useRef(0);
  const [timerDraftScope, setTimerDraftScope] = useState("idle#0");
  // Optimistic block id → the real block id its Start's POST returned (Codex r10). Recorded the
  // moment the server accepts the Start, so saves and Stop target the real block straight away,
  // and only that real block is this block's handoff: any other real block arriving supersedes
  // it. Separate from the completion scope; cleared once a real block is running.
  const startHandoffsRef = useRef(new Map<string, string>());
  // The running block's draft at the moment a Start that replaces it was asked for, by block id:
  // its pending edits, saved to its real id before the switch runs (Codex r10).
  const outgoingDraftsRef = useRef(new Map<string, { draft: TimerDraft; base: TimerDraft }>());
  // A running block this tab split → its running second part: a Stop asked for the block while the split
  // ran stops the part that runs now (owner 28 Oct 2026).
  const splitSuccessorsRef = useRef(new Map<string, string>());
  const refreshRequestRef = useRef(0);
  const dateLoadRequestRef = useRef(0);
  const isDateLoadingRef = useRef(false);
  const optimisticIdRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const mutationGateRef = useRef(createTimerMutationGate());
  const timerStateRef = useRef<TimerStateFingerprint | null>(null);

  useEffect(() => {
    const gate = mutationGateRef.current;
    gate.activate();
    return () => gate.dispose();
  }, []);

  const commitData = useCallback((incoming: BootstrapData | null, source: BootstrapCommitSource) => {
    const nextData = incoming
      ? reconcileTimerBootstrap(dataRef.current, incoming, source, {
          keepCurrentActiveOnTie: detailsSavesInFlightRef.current > 0
        })
      : null;
    dataRef.current = nextData;
    lastCommitAtRef.current = nextData ? Date.now() : 0;
    // Every server copy of the goals joins the tab's goal record (kept only if its revision is
    // newer), whether or not Settings is open, so a later stale snapshot never wins (UIA-309).
    if (nextData?.user && typeof nextData.user.goalsRevision === "number") {
      goalDrafts.observe(nextData.user.id, {
        dailyGoalMinutes: nextData.user.dailyGoalMinutes,
        weeklyGoalMinutes: nextData.user.weeklyGoalMinutes,
        goalsRevision: nextData.user.goalsRevision
      });
    }
    if (nextData && source !== "optimistic") {
      timerStateRef.current = {
        activeEntryId: nextData.activeEntry?.id ?? null,
        updatedAt: nextData.activeEntry?.updatedAt ?? null,
        serverNow: new Date().toISOString()
      };
    }
    if (nextData) {
      const cache = dateDataCacheRef.current;
      if (dateDataCacheWorkspaceRef.current !== nextData.workspace.id) {
        if (dateDataCacheWorkspaceRef.current !== null) workspaceGenerationRef.current += 1;
        cache.clear();
        dateDataCacheWorkspaceRef.current = nextData.workspace.id;
      }
      const date = nextData.dateRange.selectedDate;
      // Only a fresh load confirms a day shown from the cache: a page's passive hydrate (its
      // page-load props, often older still) keeps the revalidation due (Codex r1 on #544).
      if (source === "cache") cacheShownDateRef.current = date;
      else if (source === "canonical" && cacheShownDateRef.current === date) cacheShownDateRef.current = null;
      const key = dateDataCacheKey(nextData.workspace.id, date);
      cache.delete(key);
      cache.set(key, nextData);
      while (dateDataCacheRef.current.size > DATE_DATA_CACHE_LIMIT) {
        const oldestDate = dateDataCacheRef.current.keys().next().value as string | undefined;
        if (!oldestDate) break;
        dateDataCacheRef.current.delete(oldestDate);
      }
    }
    setData(nextData);
  }, []);

  const setTimerDraft = useCallback((draft: TimerDraft | ((current: TimerDraft) => TimerDraft)) => {
    if (typeof draft !== "function") draftRef.current = draft;
    setTimerDraftState((current) => {
      const nextDraft = typeof draft === "function" ? draft(current) : draft;
      draftRef.current = nextDraft;
      return nextDraft;
    });
  }, []);

  const setTimerDraftBase = useCallback((base: TimerDraft, entryId: string | null) => {
    canonicalTimerDraftRef.current = base;
    baseEntryIdRef.current = entryId;
    setTimerDraftBaseState({ entryId, draft: base });
  }, []);

  /**
   * The base of `entry`'s details: the tab's base when it belongs to that block, otherwise the
   * block as shown (a block put on screen this instant, such as a Start's optimistic block, was
   * created with exactly those details).
   */
  const baseFor = useCallback((entry: TimeEntryRow) => (
    baseEntryIdRef.current === entry.id ? canonicalTimerDraftRef.current : timerDraftForEntry(entry)
  ), []);

  useEffect(() => {
    const activeEntryVersion = timerDraftVersion(data?.activeEntry);
    if (activeEntryVersionRef.current === activeEntryVersion) return;
    activeEntryVersionRef.current = activeEntryVersion;
    const activeEntryId = data?.activeEntry?.id ?? null;
    const canonicalDraft = timerDraftForEntry(data?.activeEntry);
    const previousEntryId = timerDraftEntryIdRef.current;
    const activeEntryChanged = previousEntryId !== activeEntryId;
    const rollbackDraft = rollbackDraftRef.current;
    rollbackDraftRef.current = null;
    const rolledBack = activeEntryChanged && rollbackDraft?.entryId === activeEntryId;
    // The real block a Start's POST returned replaces its optimistic block: the same block, so
    // edits made meanwhile are reconciled like any other, not reset (Codex r7). Only that exact
    // block counts (Codex r10): another real block (another device, a newer state) supersedes it.
    // A rejected Start's rollback is a genuine change of block (Codex r8). The record outlives
    // later optimistic blocks and rollbacks to its block (Codex r9).
    const handoffId = previousEntryId === null ? undefined : startHandoffsRef.current.get(previousEntryId);
    const startAccepted = activeEntryChanged && !rolledBack && handoffId !== undefined && activeEntryId === handoffId;
    if (activeEntryId !== null && !isOptimisticTimerId(activeEntryId)) startHandoffsRef.current.clear();
    const reconciled = rolledBack
      ? { draft: rollbackDraft!.draft, base: canonicalDraft }
      : reconcileTimerDraftWithBase(activeEntryChanged && !startAccepted, draftRef.current, canonicalTimerDraftRef.current, canonicalDraft);
    if (activeEntryChanged && !startAccepted) {
      scopeCounterRef.current += 1;
      setTimerDraftScope(`${activeEntryId ?? "idle"}#${scopeCounterRef.current}`);
    }
    timerDraftEntryIdRef.current = activeEntryId;
    setTimerDraftBase(reconciled.base, activeEntryId);
    if (!timerDraftsEqual(reconciled.draft, draftRef.current)) setTimerDraft(reconciled.draft);
  }, [data?.activeEntry, setTimerDraft, setTimerDraftBase]);

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && mutationGateRef.current.isActive()) return dataRef.current;
    const requestId = ++refreshRequestRef.current;
    const date = selectedDateRef.current;
    const generation = workspaceGenerationRef.current;
    try {
      const response = await clientFetch(`/api/bootstrap?date=${date}`, { cache: "no-store" });
      if (!response.ok || requestId !== refreshRequestRef.current) return dataRef.current;
      const payload = (await response.json()) as BootstrapData;
      // A newer load (or a mutation's own data) may have landed while this body was read, or the
      // period may have changed: an older answer, or one for a period left, never replaces it.
      if (
        requestId !== refreshRequestRef.current ||
        date !== selectedDateRef.current ||
        generation !== workspaceGenerationRef.current
      ) return dataRef.current;
      commitData(payload, "canonical");
      return payload;
    } catch {
      return dataRef.current;
    }
  }, [commitData]);

  /**
   * The poll's reload, after a changed fingerprint. Unlike `refresh` it supersedes nothing until it has
   * succeeded: a failed one never discards a reload still in flight (an action's), and an answer
   * overtaken by a newer load, a period change, a workspace change or a mutation is dropped. True only
   * when it committed, so the poll keeps its old fingerprint otherwise and the next poll retries
   * (Codex r3 on #637).
   */
  const reconcileFromPoll = useCallback(async (stale: () => boolean = () => false): Promise<boolean> => {
    if (mutationGateRef.current.isActive()) return false;
    const baseline = refreshRequestRef.current;
    const date = selectedDateRef.current;
    const generation = workspaceGenerationRef.current;
    try {
      const response = await clientFetch(`/api/bootstrap?date=${date}`, { cache: "no-store" });
      if (!response.ok) return false;
      const payload = (await response.json()) as BootstrapData;
      if (
        baseline !== refreshRequestRef.current ||
        date !== selectedDateRef.current ||
        generation !== workspaceGenerationRef.current ||
        mutationGateRef.current.isActive() ||
        // The poll that asked is stale (an account or workspace change since, or its chain is gone):
        // nothing from the session left is committed (Codex r4 on #637).
        stale()
      ) return false;
      // Succeeded: now it supersedes the loads still in flight (they started before it).
      refreshRequestRef.current += 1;
      commitData(payload, "canonical");
      return true;
    } catch {
      return false;
    }
  }, [commitData]);

  const loadDate = useCallback(async (date: string): Promise<DateLoadOutcome> => {
    const cached = cachedDateData(date);
    if (cached) {
      setDateLoadError(null);
      // Like a network load, a cache commit supersedes any refresh still in flight.
      refreshRequestRef.current += 1;
      commitData(withCurrentSharedBootstrap(cached, dataRef.current), "cache");
      return { ok: true };
    }
    if (isDateLoadingRef.current) {
      return { ok: false, error: "A period is already loading." };
    }

    refreshRequestRef.current += 1;
    const requestId = ++dateLoadRequestRef.current;
    const generation = workspaceGenerationRef.current;
    isDateLoadingRef.current = true;
    setIsDateLoading(true);
    setDateLoadError(null);
    try {
      const response = await clientFetch(`/api/bootstrap?date=${date}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Unable to load period: ${response.status}`);
      const payload = (await response.json()) as BootstrapData;
      if (requestId !== dateLoadRequestRef.current || payload.dateRange.selectedDate !== date) {
        throw new Error("The period response did not match the requested date.");
      }
      // The workspace changed while this loaded: the period it asked for belongs to the workspace
      // left, so it is dropped quietly (the caller does not navigate).
      if (generation !== workspaceGenerationRef.current) return workspaceChangedOutcome;
      commitData(payload, "canonical");
      return { ok: true };
    } catch {
      // A request from the workspace left that fails after the switch is obsolete too: no error
      // banner for a period the user no longer asked for.
      if (generation !== workspaceGenerationRef.current) return workspaceChangedOutcome;
      const error = "Couldn’t load that period. Your current view is unchanged.";
      setDateLoadError(error);
      return { ok: false, error };
    } finally {
      if (requestId === dateLoadRequestRef.current) {
        isDateLoadingRef.current = false;
        setIsDateLoading(false);
      }
    }
  }, [cachedDateData, commitData]);

  useLayoutEffect(() => {
    // Read inline (not through cachedDateData), the same check, so this stays a ref-driven sync.
    const workspaceId = dataRef.current?.workspace.id;
    const cached = workspaceId ? dateDataCacheRef.current.get(dateDataCacheKey(workspaceId, selectedDate)) : undefined;
    if (!cached || !snapshotFitsViewerZone(cached.viewerTimeZone, document.cookie)) return;
    setDateLoadError(null);
    if (dataRef.current?.dateRange.selectedDate !== selectedDate) {
      refreshRequestRef.current += 1;
      commitData(withCurrentSharedBootstrap(cached, dataRef.current), "cache");
    }
  }, [commitData, selectedDate]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      const current = dataRef.current;
      const currentFits = current?.dateRange.selectedDate === selectedDate &&
        snapshotFitsViewerZone(current.viewerTimeZone, document.cookie);
      // A day shown from the cache is drawn at once and then fetched again, so another device's
      // change to it appears (stale-while-revalidate).
      if ((!currentFits && !cachedDateData(selectedDate)) || cacheShownDateRef.current === selectedDate) {
        void refresh();
      }
    }, 0);
    const reconcileIfVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(reconcileIfVisible, BOOTSTRAP_RECONCILE_INTERVAL_MS);
    const handleFocus = () => {
      if (Date.now() - lastCommitAtRef.current >= BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS) void refresh();
    };
    const handleVisibilityChange = () => reconcileIfVisible();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cachedDateData, commitData, refresh, selectedDate]);

  // One poll chain for the provider's life (`refresh` is stable): a period change never restarts
  // it. The in-flight flag belongs to this chain, and a chain torn down mid-request discards its
  // answer, so a new chain always starts and the old one never acts (WEB-UI-4). Cadence
  // (`webTimerStatePollDelay`, performance.md): 10 s visible and focused, 60 s visible but not
  // focused, none while hidden; focus, a return to visibility and the user's own timer actions poll
  // at once (never beside one in flight); failures back off to 120 s. An account or workspace change
  // drops the answer in flight and the backoff.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let epoch = 0;
    let timeout: number | null = null;
    let consecutiveFailures = 0;

    const hidden = () => document.visibilityState === "hidden";
    const clear = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    const scheduleIn = (delay: number) => {
      clear();
      if (cancelled || hidden()) return;
      timeout = window.setTimeout(() => {
        timeout = null;
        void poll();
      }, delay);
    };
    const scheduleNext = () => scheduleIn(webTimerStatePollDelay({ focused: document.hasFocus(), consecutiveFailures }));
    // One poll now, deduped: a poll in flight already answers it, and requests in a row collapse.
    const pollSoon = () => {
      if (cancelled || hidden() || inFlight) return;
      scheduleIn(0);
    };

    const poll = async () => {
      if (cancelled || hidden() || inFlight) return;
      inFlight = true;
      const pollEpoch = epoch;
      const generation = workspaceGenerationRef.current;
      const stale = () => cancelled || pollEpoch !== epoch || generation !== workspaceGenerationRef.current;
      try {
        const response = await clientFetch("/api/timer-state", { cache: "no-store" });
        if (stale()) return;
        if (!response.ok) throw new Error(`Unable to check the recording state: ${response.status}`);
        const next = (await response.json()) as TimerStateFingerprint;
        if (stale()) return;
        consecutiveFailures = 0;
        // An action of the user's is still settling: its own reload has the newest state, and the
        // poll that follows it confirms. The answer is set aside so it never supersedes that reload.
        if (hasCurrentTimerAction()) return;
        // A changed fingerprint is kept only once its reload has committed (which records the
        // loaded copy's); a failed or overtaken reload leaves the old one, so the next poll retries.
        if (!timerStateChanged(timerStateRef.current, next)) timerStateRef.current = next;
        else await reconcileFromPoll(stale);
      } catch {
        if (!stale()) consecutiveFailures += 1;
      } finally {
        inFlight = false;
        scheduleNext();
      }
    };

    pollTimerStateNowRef.current = pollSoon;

    const resume = () => {
      if (hidden()) {
        clear();
        return;
      }
      pollSoon();
    };
    const unregister = onBeforeSessionChange(async () => {
      epoch += 1;
      consecutiveFailures = 0;
      // Actions of the session left never hold the next session's polls off.
      timerActionsRef.current.clear();
    });

    pollSoon();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      if (pollTimerStateNowRef.current === pollSoon) pollTimerStateNowRef.current = null;
      clear();
      unregister();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [hasCurrentTimerAction, reconcileFromPoll]);

  // The user's own timer actions (start, switch, stop, delete, split, join, an edit of the running
  // block) in progress, each until its own reload has settled. While one is current, a poll's answer
  // is set aside, so a poll never supersedes an action's reload. An action settling retires itself
  // and every older one (superseded: its reload has the newer state). When none is current (and the
  // gate is idle), one timer-state poll confirms them all, never beside a poll already in flight.
  const trackTimerAction = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    const seq = ++timerActionSeqRef.current;
    timerActionsRef.current.set(seq, { startedAt: Date.now(), generation: workspaceGenerationRef.current });
    try {
      return await run();
    } finally {
      for (const older of timerActionsRef.current.keys()) {
        if (older <= seq) timerActionsRef.current.delete(older);
      }
      if (!hasCurrentTimerAction()) {
        void mutationGateRef.current.whenIdle().then(() => {
          if (!hasCurrentTimerAction()) pollTimerStateNowRef.current?.();
        });
      }
    }
  }, [hasCurrentTimerAction]);

  // A period change asks the running chain for one poll now (never a second chain), so another
  // device's Start or Stop shows as soon as the new period does.
  const polledDateRef = useRef(selectedDate);
  useEffect(() => {
    if (polledDateRef.current === selectedDate) return;
    polledDateRef.current = selectedDate;
    pollTimerStateNowRef.current?.();
  }, [selectedDate]);

  const hydrate = useCallback((nextData: BootstrapData) => {
    if (mutationGateRef.current.isActive()) return;
    if (nextData.dateRange.selectedDate !== selectedDate) return;
    // Page props belong to the workspace they were drawn for. Once the runtime has accepted
    // another workspace (a switch, before router.refresh delivers new props), they never replace
    // its data or undo the switch: a fresh load decides which workspace is current.
    const acceptedWorkspace = dateDataCacheWorkspaceRef.current;
    if (acceptedWorkspace !== null && nextData.workspace.id !== acceptedWorkspace) {
      selectedDateRef.current = selectedDate;
      void refresh();
      return;
    }
    // Page props drawn before the zone cookie existed (or for another zone) never replace a copy
    // built for the zone the browser sends now; shown only when nothing better is there, and then
    // fetched again (Codex r2 on #484).
    if (!snapshotFitsViewerZone(nextData.viewerTimeZone, document.cookie)) {
      const current = dataRef.current;
      if (current?.dateRange.selectedDate === selectedDate && snapshotFitsViewerZone(current.viewerTimeZone, document.cookie)) return;
      commitData(nextData, "hydrate");
      // A page's layout effect runs before the provider's: the period it hydrates is current.
      selectedDateRef.current = selectedDate;
      void refresh();
      return;
    }
    commitData(nextData, "hydrate");
  }, [commitData, refresh, selectedDate]);

  /** The server's id for a block: the real id behind an accepted Start's optimistic block. */
  const serverEntryId = useCallback((entryId: string) => (
    isOptimisticTimerId(entryId) ? startHandoffsRef.current.get(entryId) ?? null : entryId
  ), []);

  // A save the server refused because the details changed elsewhere (409): the server's copy is
  // shown and becomes the base, and the refused edit is dropped.
  const adoptServerDetails = useCallback((shownId: string, entry: TimeEntryRow | null | undefined) => {
    const current = dataRef.current;
    if (!entry || !current || current.activeEntry?.id !== shownId || entry.stoppedAt) return false;
    const adopted = timerDraftForEntry(entry);
    setTimerDraftBase(adopted, shownId);
    setTimerDraft(adopted);
    commitData(applyServerActiveEntry(current, shownId, entry), "optimistic");
    return true;
  }, [commitData, setTimerDraft, setTimerDraftBase]);

  // The details save in flight (its block, the base it was sent against, and whether it travels
  // keepalive), and the outcome of the last one: a Stop that waited for it, or gave up waiting,
  // uses both (Codex r1 on #539).
  const detailsInFlightRef = useRef<{
    entryId: string;
    base: TimerDraft;
    fields: TimerDetailField[];
    keepalive: boolean;
    version: string | undefined;
  } | null>(null);
  const detailsOutcomeRef = useRef<{ seq: number; entryId: string; conflict: boolean; error: string | null }>(
    { seq: 0, entryId: "", conflict: false, error: null }
  );
  const pendingStopRef = useRef<Promise<MutationOutcome> | null>(null);
  const [isStopPending, setIsStopPending] = useState(false);
  // Every description write this tab sends is numbered: only the newest may retry after a 409 that
  // only its version caused; an older one (a hung save a Stop went past) is dropped (Codex r3).
  const detailsWriteSeqRef = useRef(0);
  const keepaliveBytesRef = useRef(0);
  // An accepted Start's block, still shown optimistically: its server version, once a details
  // PATCH has returned one (the Start's POST does not). Unknown until then (Codex r4 on #539).
  const handoffVersionsRef = useRef(new Map<string, string>());
  /** The version of the block on screen this tab last had from the server, as ISO; none if unknown. */
  const versionOf = useCallback((entry: TimeEntryRow | null | undefined) => (
    entry && isOptimisticTimerId(entry.id) ? handoffVersionsRef.current.get(entry.id) : entryVersion(entry)
  ), []);
  // The pending-details store's owner and session token (lib/timer-draft-store.ts).
  const pendingStoreSessionRef = useRef<{ owner: string; generation: number } | null>(null);
  const pendingOwner = useCallback((snapshot: BootstrapData | null) => {
    const owner = { userId: snapshot?.user?.id ?? "", workspaceId: snapshot?.workspace?.id ?? "" };
    const key = `${owner.userId}:${owner.workspaceId}`;
    if (pendingStoreSessionRef.current?.owner !== key) {
      pendingStoreSessionRef.current = { owner: key, generation: pendingTimerDetailsGeneration() };
    }
    return { owner, generation: pendingStoreSessionRef.current.generation };
  }, []);

  // Sends one description PATCH. It is keepalive (it outlives the page if the tab closes or
  // reloads) whenever it fits the browser's keepalive budget beside any other keepalive request
  // this tab has in flight (Codex r3 on #539); `onSent` learns which.
  const sendDetailsPatch = useCallback(async (
    targetId: string,
    body: Record<string, unknown>,
    onSent?: (keepalive: boolean) => void
  ) => {
    const text = JSON.stringify(body);
    const bytes = new TextEncoder().encode(text).length;
    const keepalive = keepaliveBytesRef.current + bytes <= KEEPALIVE_BODY_LIMIT_BYTES;
    if (keepalive) keepaliveBytesRef.current += bytes;
    onSent?.(keepalive);
    try {
      return await clientFetch(`/api/time-entries/${targetId}`, {
        method: "PATCH",
        ...(keepalive ? { keepalive: true } : {}),
        headers: { "Content-Type": "application/json" },
        body: text
      });
    } finally {
      if (keepalive) keepaliveBytesRef.current -= bytes;
    }
  }, []);

  // Saves the running block's details; the caller holds the mutation gate. Only the fields the
  // user edited (against `base`, the copy the edit was based on) are sent, with their base values
  // and the version of the block this tab last had from the server (`expectedUpdatedAt`): a write
  // that landed since, whatever it changed, makes this one 409. A 409 its version alone caused (the
  // fields still hold the base) is retried once at the new version, if this is still the newest
  // write for a block still on screen; otherwise it is dropped.
  // A close-time save (`closing`) sends no version, only the field-level `expectedDetails`: the
  // page cannot retry it, so an unrelated change elsewhere (an activity, a start) must not refuse
  // it, while a real conflict on the edited fields still does (Codex r4 on #539).
  const saveActiveDetails = useCallback(async (
    snapshot: BootstrapData,
    draft: TimerDraft,
    explicitBase?: TimerDraft,
    options: { closing?: boolean } = {}
  ): Promise<MutationOutcome> => {
    const activeEntry = snapshot.activeEntry!;
    const base = explicitBase ?? baseFor(activeEntry);
    const targetId = serverEntryId(activeEntry.id);
    if (!targetId) return { ok: false, error: "The block is still starting." };
    const patch = timerDetailsPatch(draft, base);
    if (!patch) return { ok: true };
    setIsTimerBusy(true);
    setTimerError(null);
    refreshRequestRef.current += 1;
    detailsSavesInFlightRef.current += 1;
    const writeSeq = ++detailsWriteSeqRef.current;
    const sending = pickTimerDraftFields(draft, timerDraftForEntry(activeEntry), patch.fields);
    const optimistic = applyOptimisticActiveEntryPatch(snapshot, sending);
    commitData(optimistic, "optimistic");
    // What is being saved is now the base, so an edit made while the save is pending (even one
    // back to the previous text) is newer and survives its acknowledgement (Codex r7).
    setTimerDraftBase(timerDraftBaseAfterSave(base, draft, patch.fields), activeEntry.id);
    const version = options.closing ? undefined : versionOf(activeEntry);
    const inFlight = { entryId: activeEntry.id, base, fields: patch.fields, keepalive: false, version };
    detailsInFlightRef.current = inFlight;
    // A save that settles after a Stop went ahead without it (`stopTimer`'s deadline) leaves the
    // stopped block alone: no rollback brings it back and its notice is the Stop's.
    const stillShown = () => dataRef.current?.activeEntry?.id === activeEntry.id;
    const settle = (conflict: boolean, error: string | null) => {
      detailsOutcomeRef.current = { seq: detailsOutcomeRef.current.seq + 1, entryId: activeEntry.id, conflict, error };
    };
    try {
      let response = await sendDetailsPatch(targetId, withVersion(patch.body, version), (keepalive) => {
        inFlight.keepalive = keepalive;
      });
      let conflict: { entry?: TimeEntryRow } | null = null;
      if (response.status === 409) {
        conflict = await response.json().catch(() => null) as { entry?: TimeEntryRow } | null;
        const current = conflict?.entry;
        if (current && writeSeq === detailsWriteSeqRef.current && stillShown()
          && detailsHold(current, base, patch.fields) && entryVersion(current) !== version) {
          response = await sendDetailsPatch(targetId, withVersion(patch.body, entryVersion(current)));
          conflict = response.status === 409
            ? await response.json().catch(() => null) as { entry?: TimeEntryRow } | null
            : null;
        }
      }
      if (response.status === 409) {
        settle(true, DETAILS_CONFLICT_MESSAGE);
        if (!stillShown() || writeSeq !== detailsWriteSeqRef.current) return { ok: false, error: DETAILS_CONFLICT_MESSAGE } as const;
        if (!adoptServerDetails(activeEntry.id, conflict?.entry)) {
          commitData(snapshot, "optimistic");
          setTimerDraftBase(timerDraftForEntry(snapshot.activeEntry), activeEntry.id);
          setTimerDraft(timerDraftForEntry(snapshot.activeEntry));
        }
        setTimerError(DETAILS_CONFLICT_MESSAGE);
        return { ok: false, error: DETAILS_CONFLICT_MESSAGE } as const;
      }
      if (!response.ok) throw new Error(await responseError(response, `Unable to save the block details: ${response.status}`));
      const result = (await response.json()) as { updatedAt?: string };
      const savedVersion = serverVersion(result.updatedAt);
      if (savedVersion && isOptimisticTimerId(activeEntry.id)) handoffVersionsRef.current.set(activeEntry.id, savedVersion);
      if (result.updatedAt && dataRef.current) {
        commitData(
          applyAuthoritativeActiveEntryVersion(dataRef.current, activeEntry.id, result.updatedAt),
          "canonical"
        );
      }
      settle(false, null);
      clearPendingTimerDetails(pendingOwner(dataRef.current ?? snapshot).owner, targetId, draft);
      return { ok: true } as const;
    } catch {
      const message = DETAILS_FAILED_MESSAGE;
      settle(false, message);
      if (!stillShown()) return { ok: false, error: message } as const;
      commitData(snapshot, "optimistic");
      setTimerDraftBase(timerDraftForEntry(snapshot.activeEntry), activeEntry.id);
      setTimerDraft(timerDraftForEntry(snapshot.activeEntry));
      setTimerError(message);
      return { ok: false, error: message } as const;
    } finally {
      if (detailsInFlightRef.current === inFlight) detailsInFlightRef.current = null;
      detailsSavesInFlightRef.current -= 1;
      setIsTimerBusy(false);
    }
  }, [adoptServerDetails, baseFor, commitData, pendingOwner, sendDetailsPatch, serverEntryId, setTimerDraft, setTimerDraftBase, versionOf]);

  // Leaving the shell: details the running block's real id would still get from autosave are sent
  // now (keepalive when it fits, so the request outlives the page). A block whose Start's POST has
  // not come back has no real id yet; those edits are lost, as on any page left mid-request.
  useEffect(() => () => {
    const entry = dataRef.current?.activeEntry;
    const targetId = entry ? serverEntryId(entry.id) : null;
    const patch = entry ? timerDetailsPatch(draftRef.current, baseFor(entry)) : null;
    if (!entry || !targetId || !patch) return;
    void sendDetailsPatch(targetId, patch.body).catch(() => undefined);
  }, [baseFor, sendDetailsPatch, serverEntryId]);

  const startTimerUntracked = useCallback(async (
    input: TimerDraftInput = {},
    options: { dedupeRunning?: boolean; guard?: (snapshot: BootstrapData) => string | null; startedAt?: string } = {}
  ): Promise<TimerStartOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot) return { ok: false, error: "Block data is still loading." };
    const outgoing = snapshot.activeEntry;
    if (outgoing && !outgoingDraftsRef.current.has(outgoing.id)) {
      outgoingDraftsRef.current.set(outgoing.id, { draft: draftRef.current, base: baseFor(outgoing) });
    }
    const outcome = await runTimerStartMutation({
      beforeStart: async () => {
        // The block this Start replaces gets its pending edits first, at its real id.
        const current = dataRef.current;
        const entry = current?.activeEntry;
        const pending = entry ? outgoingDraftsRef.current.get(entry.id) : undefined;
        outgoingDraftsRef.current.clear();
        if (current && entry && pending && serverEntryId(entry.id)) {
          const outcome = await saveActiveDetails(current, pending.draft, pending.base);
          // Refused because the block changed elsewhere: the switch goes ahead, and the notice
          // that the edit was not kept stays on screen (Codex r1 on #387).
          if (!outcome.ok && outcome.error === DETAILS_CONFLICT_MESSAGE) return { notice: DETAILS_CONFLICT_SWITCH_MESSAGE };
        }
      },
      dedupeRunning: options.dedupeRunning,
      guard: options.guard,
      // Shown ended by an End it held or saving: never "already running" (Codex r2 on #618).
      isShownRunning: (entry) => !projectedEndsRef.current.has(entry.id),
      startAt: options.startedAt,
      gate: mutationGateRef.current,
      snapshot,
      currentDraft: draftRef.current,
      input,
      now: () => new Date().toISOString(),
      createOptimisticId: (startedAt) => `${OPTIMISTIC_TIMER_ID_PREFIX}${startedAt}:${++optimisticIdRef.current}`,
      getCurrentDraft: () => draftRef.current,
      getCurrentSnapshot: () => dataRef.current ?? snapshot,
      onAccepted: () => {
        refreshRequestRef.current += 1;
      },
      onRollback: (draft, entryId) => {
        rollbackDraftRef.current = { draft, entryId };
      },
      commit: (nextData) => commitData(nextData, "optimistic"),
      setDraft: setTimerDraft,
      setBusy: setIsTimerBusy,
      setError: setTimerError,
      send: async (payload) => {
        const response = await clientFetch("/api/time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to start the block: ${response.status}`));
        // Accepted: record which real block the optimistic one on screen is, from the POST itself.
        const result = await response.json().catch(() => null) as { timeEntryId?: unknown } | null;
        const serverId = typeof result?.timeEntryId === "string" ? result.timeEntryId : undefined;
        const snapshot = dataRef.current;
        const optimisticId = snapshot?.activeEntry?.id ?? null;
        if (!snapshot || !optimisticId || !isOptimisticTimerId(optimisticId) || !serverId) return serverId;
        startHandoffsRef.current.set(optimisticId, serverId);
        // Edits made while the POST was in flight had no block to go to: save them to it now,
        // before anything queued behind this Start (a switch, a Stop) runs. A switch asked for
        // meanwhile has already put its own draft on screen, so its capture of this block's edits
        // is what is saved.
        // The real block was created with the optimistic block's details: that is the base.
        const pending = outgoingDraftsRef.current.get(optimisticId)
          ?? { draft: draftRef.current, base: timerDraftForEntry(snapshot.activeEntry) };
        outgoingDraftsRef.current.delete(optimisticId);
        await saveActiveDetails(snapshot, pending.draft, pending.base);
        return serverId;
      },
      refresh: async () => {
        await refresh({ force: true });
      }
    });
    return outcome;
  }, [baseFor, commitData, refresh, saveActiveDetails, serverEntryId, setTimerDraft]);
  const startTimer = useCallback(
    (...args: Parameters<typeof startTimerUntracked>) => trackTimerAction(() => startTimerUntracked(...args)),
    [startTimerUntracked, trackTimerAction]
  );

  const startEntryAgain = useCallback(async (entry: TimeEntryRow): Promise<MutationOutcome> => {
    const decision = entryContinuationDecision(entry);
    if (!decision.ok) return decision;
    return startTimer(decision.draft);
  }, [startTimer]);

  const stopTimerNow = useCallback(async (input: TimerDraftInput): Promise<MutationOutcome> => {
    const requested = dataRef.current?.activeEntry;
    if (!requested) return { ok: false, error: "There is no running block to stop." };
    const gate = mutationGateRef.current;
    const outcomeSeq = detailsOutcomeRef.current.seq;
    // Stop is never turned away by a mutation already in the gate (stability audit WEB-UI-10): it
    // waits for it and then stops the block still on screen, with the edits made since (the patch
    // below is computed after the wait, against the base that save left). A block whose Start is
    // still in flight has no server id yet, so Stop waits behind that Start and then stops the
    // real block (Codex r10). If the Start was rejected, the block it would have stopped is gone,
    // so nothing is stopped. Behind a details save the wait is bounded (Codex r1 on #539): after
    // `STOP_WAIT_DEADLINE_MS` the Stop goes ahead without the gate and carries that save's edits.
    const startPending = !serverEntryId(requested.id);
    let bypassed: { base: TimerDraft } | null = null;
    if (startPending || gate.isActive()) {
      setIsStopPending(true);
      if (startPending) await gate.whenIdle();
      const deadlineAt = Date.now() + STOP_WAIT_DEADLINE_MS;
      // Nothing may slip in between the last check and `run` below: no await separates them.
      while (gate.isActive()) {
        const left = deadlineAt - Date.now();
        const inFlight = detailsInFlightRef.current;
        // Only past a save whose late landing will be refused: one that carries a version, or one
        // without (an accepted Start's first details save, a page-hide save the tab came back
        // from) whose field-level check Stop's text breaks, because it differs from that save's
        // base on a field it sent. A revert to that base behind a save without a version is waited
        // for (Codex r4/r5 on #539).
        const finalDraft = mergeTimerDraft(draftRef.current, input);
        if (left <= 0 && inFlight && inFlight.entryId === requested.id && serverEntryId(requested.id)
          && (inFlight.version || inFlight.fields.some((field) => !timerDetailEquivalent(field, finalDraft, inFlight.base)))) {
          bypassed = { base: inFlight.base };
          break;
        }
        if (left <= 0) {
          await gate.whenIdle();
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          gate.whenIdle(),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, left); })
        ]);
        clearTimeout(timer);
      }
      setIsStopPending(false);
      const nowActiveId = dataRef.current?.activeEntry?.id;
      if (nowActiveId !== requested.id && (!nowActiveId || splitSuccessorsRef.current.get(requested.id) !== nowActiveId)) {
        return startPending
          ? { ok: false, error: "That block did not start, so there was nothing to stop." }
          : { ok: false, error: "There is no running block to stop." };
      }
    }
    // A details save this Stop waited for and that was refused or failed: its notice is carried
    // into the Stop's own (which otherwise clears it), so the lost edit is never silent.
    const earlier = detailsOutcomeRef.current;
    // The block stopped is the one running now: the requested one, or what a split or its Undo moved it to, whose
    // own save's failure is this Stop's to report too (Codex r6 on #607).
    const stoppingId = dataRef.current?.activeEntry?.id ?? requested.id;
    const carried = earlier.seq > outcomeSeq && (earlier.entryId === requested.id || earlier.entryId === stoppingId) && earlier.error ? earlier : null;
    const snapshot = dataRef.current!;
    const activeEntry = snapshot.activeEntry!;
    const targetId = serverEntryId(activeEntry.id);
    if (!targetId) return { ok: false, error: "The block is still starting." };
    const draftSnapshot = draftRef.current;
    const draft = mergeTimerDraft(draftSnapshot, input);
    // Only what this tab's user edited is saved with the Stop (a stale copy never is), at the
    // block's version as this tab last had it. Past a hung save, against the copy that save was
    // sent from, and with every field that save or this tab changed, so the Stop's text (a revert
    // included) is the block's last word whichever lands first (Codex r3 on #539): the hung save,
    // landing later, is refused by the version this write moves on; landing first, it makes this
    // write 409, which is then retried once at the new version, since the block holds only this
    // tab's own text.
    const savedBase = baseFor(activeEntry);
    const base = bypassed?.base ?? savedBase;
    const fields = [...new Set([
      ...timerDraftEditedFields(draft, base),
      ...(bypassed ? timerDraftEditedFields(draft, savedBase) : [])
    ])];
    const detailsBody = (expected: TimerDraft) => {
      const body: Record<string, unknown> = {};
      const expectedDetails: Record<string, unknown> = {};
      for (const field of fields) {
        body[field] = timerDetailWireValue(field, draft);
        expectedDetails[field] = timerDetailWireValue(field, expected);
      }
      return { ...body, expectedDetails };
    };
    let detailsConflict = false;
    const stop = async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticTimerStop(snapshot, new Date().toISOString()), "optimistic");

      try {
        if (fields.length) {
          ++detailsWriteSeqRef.current;
          let updateResponse = await sendDetailsPatch(targetId, withVersion(detailsBody(base), versionOf(activeEntry)));
          if (updateResponse.status === 409) {
            const current = (await updateResponse.json().catch(() => null) as { entry?: TimeEntryRow } | null)?.entry;
            // Only this tab's own text is there (the hung save landed first, or only the version
            // moved): once more at the new version. Anything else was changed elsewhere.
            const own = current && [base, savedBase].find((known) => detailsHold(current, known, fields));
            updateResponse = current && own
              ? await sendDetailsPatch(targetId, withVersion(detailsBody(timerDraftForEntry(current)), entryVersion(current)))
              : updateResponse;
          }
          // Changed elsewhere since this edit's base: the block stops with the other change.
          if (updateResponse.status === 409) detailsConflict = true;
          else if (!updateResponse.ok) {
            throw new Error(await responseError(updateResponse, `Unable to save the block details: ${updateResponse.status}`));
          }
        }
        const response = await clientFetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "manual_app",
            type: "timer_stop",
            occurredAt: new Date().toISOString(),
            clientEventId: `web-timer-stop:${targetId}`,
            rawPayload: {
              origin: "web_timer",
              stopScope: "entry",
              targetEntryId: targetId
            }
          })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to stop the block: ${response.status}`));
        clearPendingTimerDetails(pendingOwner(snapshot).owner, targetId);
        if (detailsConflict || carried?.conflict) setTimerError(DETAILS_CONFLICT_STOP_MESSAGE);
        else if (carried) setTimerError(DETAILS_FAILED_STOP_MESSAGE);
        return { ok: true } as const;
      } catch (error) {
        // The block comes back with the edits it had (the rollback draft), not its saved details.
        rollbackDraftRef.current = { draft: draftSnapshot, entryId: activeEntry.id };
        commitData(snapshot, "optimistic");
        setTimerDraft(draftSnapshot);
        const message = errorMessage(error, "Unable to stop the block.");
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        setIsTimerBusy(false);
      }
    };
    const result = bypassed ? { ran: true as const, value: await stop() } : await gate.run(stop);
    if (result.ran && result.value.ok && !gate.isActive()) {
      await refresh({ force: true });
    }
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [baseFor, commitData, pendingOwner, refresh, sendDetailsPatch, serverEntryId, setTimerDraft, versionOf]);

  // One Stop at a time: pressing again while one waits or runs joins it (no stacked waiters).
  const stopTimer = useCallback((input: TimerDraftInput = {}): Promise<MutationOutcome> => {
    if (pendingStopRef.current) return pendingStopRef.current;
    const stopping = trackTimerAction(() => stopTimerNow(input)).finally(() => {
      if (pendingStopRef.current === stopping) pendingStopRef.current = null;
      setIsStopPending(false);
    });
    pendingStopRef.current = stopping;
    return stopping;
  }, [stopTimerNow, trackTimerAction]);

  const deleteActiveTimerUntracked = useCallback(async (): Promise<MutationOutcome> => {
    const requested = dataRef.current?.activeEntry;
    if (!requested) return { ok: false, error: "There is no running block to delete." };
    // As Stop: a block whose Start is still in flight waits behind it, then the real block (the id
    // its POST returned) is deleted; an optimistic id is never sent. A rejected Start leaves
    // nothing to delete.
    if (!serverEntryId(requested.id)) {
      await mutationGateRef.current.whenIdle();
      if (dataRef.current?.activeEntry?.id !== requested.id) {
        return { ok: false, error: "That block did not start, so there was nothing to delete." };
      }
    }
    const snapshot = dataRef.current!;
    const targetId = serverEntryId(snapshot.activeEntry!.id);
    if (!targetId) return { ok: false, error: "The block is still starting." };
    const draftSnapshot = draftRef.current;
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticTimerDelete(snapshot), "optimistic");
      setTimerDraft(timerDraftForEntry(null));
      try {
        const response = await clientFetch(`/api/time-entries/${targetId}`, {
          method: "DELETE"
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to delete the block: ${response.status}`));
        clearPendingTimerDetails(pendingOwner(snapshot).owner, targetId);
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot, "optimistic");
        setTimerDraft(draftSnapshot);
        const message = errorMessage(error, "Unable to delete the running block.");
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    if (result.ran && result.value.ok && !mutationGateRef.current.isActive()) {
      await refresh({ force: true });
    }
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [commitData, pendingOwner, refresh, serverEntryId, setTimerDraft]);
  const deleteActiveTimer = useCallback(
    (...args: Parameters<typeof deleteActiveTimerUntracked>) => trackTimerAction(() => deleteActiveTimerUntracked(...args)),
    [deleteActiveTimerUntracked, trackTimerAction]
  );

  /**
   * Inside the gate, as a split or its Undo ends: the running block's edits not saved yet are saved now. Its
   * autosave was turned away while the gate was held, and nothing would arm it again (Codex r4, r6 on #607).
   */
  const saveLeftoverEdits = useCallback(async () => {
    const now = dataRef.current;
    const active = now?.activeEntry;
    if (!now || !active || !serverEntryId(active.id)) return;
    if (timerDraftEditedFields(draftRef.current, baseFor(active)).length) await saveActiveDetails(now, draftRef.current);
  }, [baseFor, saveActiveDetails, serverEntryId]);

  /** Runs a split or its Undo (inside the gate), then saves the edits left unsaved whatever its outcome. */
  const endingWithLeftoverEdits = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } finally {
      await saveLeftoverEdits().catch(() => undefined);
    }
  }, [saveLeftoverEdits]);

  const splitActiveTimerUntracked = useCallback(async (atMs: number): Promise<ActiveSplitOutcome> => {
    const requested = dataRef.current?.activeEntry;
    if (!requested) return { ok: false, error: "There is no running block to split." };
    // As Stop and Discard: a block whose Start is still in flight waits behind it, and a rejected Start
    // leaves nothing to split.
    if (!serverEntryId(requested.id)) {
      await mutationGateRef.current.whenIdle();
      if (dataRef.current?.activeEntry?.id !== requested.id) {
        return { ok: false, error: "That block did not start, so there was nothing to split." };
      }
    }
    const result = await mutationGateRef.current.run(() => endingWithLeftoverEdits(async (): Promise<ActiveSplitOutcome> => {
      const before = dataRef.current;
      const entry = before?.activeEntry;
      const targetId = entry ? serverEntryId(entry.id) : null;
      if (!before || !entry || !targetId) return { ok: false, error: "There is no running block to split." };
      // The split copies the block as saved: this tab's edits to it are saved first, so both parts keep them.
      const saved = await saveActiveDetails(before, draftRef.current);
      if (!saved.ok) return saved;
      const current = dataRef.current?.activeEntry;
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      const draftAtSend = draftRef.current;
      try {
        const outcome = await splitRunningTimeEntry(clientFetch, {
          entryId: targetId, atMs, expectedUpdatedAt: current?.id === entry.id ? versionOf(current) : undefined
        });
        if (!outcome.ok) {
          setTimerError(outcome.error);
          if (outcome.changed) await refresh({ force: true });
          return outcome;
        }
        // Whether the second part runs is read from the blocks as the server has them now: one that had stopped
        // by the time the split arrived was split as a finished block, and nothing runs (Codex r1, r2 on #607).
        const newEntryId = outcome.newEntryId;
        const running = newEntryId !== null && outcome.entries.some((block) => block.id === newEntryId && !block.stoppedAt);
        if (running) {
          splitSuccessorsRef.current.set(entry.id, newEntryId);
          splitSuccessorsRef.current.set(targetId, newEntryId);
          // Typed while the split was on its way: the text goes on to the running second part.
          if (!timerDraftsEqual(draftRef.current, draftAtSend)) rollbackDraftRef.current = { draft: draftRef.current, entryId: newEntryId };
        }
        const shown = dataRef.current;
        // A part the answer leaves out is gone (deleted elsewhere meanwhile): never left running on screen (Codex r3 on #607).
        const answered = new Set(outcome.entries.map((block) => block.id));
        const gone = [...new Set([entry.id, targetId, ...(newEntryId ? [newEntryId] : [])])].filter((id) => !answered.has(id));
        if (shown) commitData(applyServerTimerBlocks(shown, outcome.entries, gone), "optimistic");
        // Still inside the gate: a Stop pressed meanwhile waits for this and then stops the running second
        // part, never the first part this split just ended.
        await refresh({ force: true });
        if (!newEntryId) return { ok: false, error: "This block was already split and put back together." };
        return { ok: true, entryId: targetId, newEntryId, running };
      } finally {
        setIsTimerBusy(false);
      }
    }));
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [commitData, endingWithLeftoverEdits, refresh, saveActiveDetails, serverEntryId, versionOf]);
  const splitActiveTimer = useCallback(
    (...args: Parameters<typeof splitActiveTimerUntracked>) => trackTimerAction(() => splitActiveTimerUntracked(...args)),
    [splitActiveTimerUntracked, trackTimerAction]
  );

  const joinSplitTimerUntracked = useCallback(async (split: { entryId: string; newEntryId: string; commandId?: string }): Promise<MutationOutcome> => {
    await mutationGateRef.current.whenIdle();
    const result = await mutationGateRef.current.run(() => endingWithLeftoverEdits(async (): Promise<MutationOutcome> => {
      // Edits typed into the second part and not saved yet would be lost by the join (Codex r2 on #607).
      const shownActive = dataRef.current?.activeEntry;
      if (shownActive && serverEntryId(shownActive.id) === split.newEntryId && timerDraftEditedFields(draftRef.current, baseFor(shownActive)).length) {
        return { ok: false, error: UNDO_AFTER_EDIT_MESSAGE };
      }
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      try {
        const draftAtSend = draftRef.current;
        let carried = false;
        const outcome = await joinSplitTimeEntries(clientFetch, { entryId: split.entryId, splitEntryId: split.newEntryId, commandId: split.commandId });
        if (outcome.ok) {
          // Typed while the Undo was on its way: the text goes on to the joined block (saved as its edit), never
          // reset by the change of block (Codex r3 on #607).
          const typed = draftRef.current;
          carried = !timerDraftsEqual(typed, draftAtSend);
          if (carried) rollbackDraftRef.current = { draft: typed, entryId: split.entryId };
          // A Stop asked for the second part while the Undo ran stops the joined block (Codex r1 on #607).
          splitSuccessorsRef.current.set(split.newEntryId, split.entryId);
          // Shown joined at once, as the server has it, so a failed reload never leaves the gone part running.
          const shown = dataRef.current;
          if (shown) commitData(applyServerTimerBlocks(shown, outcome.entry ? [outcome.entry] : [], [split.newEntryId]), "optimistic");
          // Saved here, inside the gate, so a Stop pressed meanwhile waits for it and stops the block with the
          // text (its autosave may have been turned away while the gate was held) (Codex r4, r5 on #607).
          const joined = dataRef.current;
          if (carried && outcome.entry && joined?.activeEntry?.id === split.entryId) {
            await saveActiveDetails(joined, draftRef.current, timerDraftForEntry(outcome.entry));
          }
        }
        // As the split: the day is loaded again inside the gate, so a Stop behind it targets the joined block.
        if (outcome.ok || outcome.changed) await refresh({ force: true });
        return outcome.ok ? outcome : { ok: false, error: outcome.error };
      } finally {
        setIsTimerBusy(false);
      }
    }));
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [baseFor, commitData, endingWithLeftoverEdits, refresh, saveActiveDetails, serverEntryId]);
  const joinSplitTimer = useCallback(
    (...args: Parameters<typeof joinSplitTimerUntracked>) => trackTimerAction(() => joinSplitTimerUntracked(...args)),
    [joinSplitTimerUntracked, trackTimerAction]
  );

  const updateActiveDetailsUntracked = useCallback(async (
    draft: TimerDraft,
    options: { closing?: boolean } = {}
  ): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running block to edit." };
    // A block whose Start is still in flight keeps its edits in the draft; the Start saves them to
    // the real block as soon as the server accepts it.
    if (!serverEntryId(snapshot.activeEntry.id)) return { ok: false, error: "The block is still starting." };
    const result = await mutationGateRef.current.run(() => saveActiveDetails(snapshot, draft, undefined, options));
    if (result.ran && result.value.ok && !mutationGateRef.current.isActive()) {
      await refresh({ force: true });
    }
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [refresh, saveActiveDetails, serverEntryId]);
  const updateActiveDetails = useCallback(
    (...args: Parameters<typeof updateActiveDetailsUntracked>) => trackTimerAction(() => updateActiveDetailsUntracked(...args)),
    [updateActiveDetailsUntracked, trackTimerAction]
  );

  // The tab is closing, reloading or going to the background (stability audit WEB-UI-2): edits
  // autosave would send after its 650 ms debounce are sent now through the ordinary save, which is
  // keepalive when it fits (nearly always), so it outlives the page; its base moves, so the
  // debounce sends nothing again. With a save already in flight nothing is sent beside it (it is
  // the one description write a tab has in flight). What keepalive cannot carry is kept in this tab
  // instead, best effort (the pending-details store; a reload or restore of this tab puts it back
  // for autosave, a newly opened tab does not have it): a body over the keepalive budget, edits
  // behind a save still in flight, and a save in flight that is not keepalive. Nothing is kept for
  // a session that has ended (Codex r1–r3 on #539).
  useEffect(() => {
    // `leaving`: the page is going away (pagehide), so the save carries no version (see
    // `saveActiveDetails`). Going hidden the tab usually comes back: an ordinary, versioned save,
    // so a Stop after its return can still go past it if it hangs (Codex r5 on #539).
    function flush(leaving: boolean) {
      const snapshot = dataRef.current;
      const entry = snapshot?.activeEntry;
      const targetId = entry ? serverEntryId(entry.id) : null;
      if (!entry || !targetId) return;
      const base = baseFor(entry);
      const draft = draftRef.current;
      const patch = timerDetailsPatch(draft, base);
      const inFlight = detailsInFlightRef.current?.entryId === entry.id ? detailsInFlightRef.current : null;
      const keep = (patch && (inFlight || !fitsKeepalive(JSON.stringify(patch.body))))
        || (inFlight && !inFlight.keepalive);
      if (keep) {
        const { owner, generation } = pendingOwner(snapshot);
        writePendingTimerDetails(owner, {
          entryId: targetId,
          draft,
          bases: inFlight ? [base, inFlight.base] : [base],
          savedAt: Date.now()
        }, generation);
      }
      if (patch && !mutationGateRef.current.isActive()) void updateActiveDetails(draft, { closing: leaving });
    }
    const onPageHide = () => flush(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(false);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [baseFor, pendingOwner, serverEntryId, updateActiveDetails]);

  // Text a close-time flush could not confirm comes back: on load, when the running block's copy
  // changes, and when the tab is shown again. Only that block's own record is read (another
  // block's is never touched). It is put in the draft only while this tab has no edits of its own
  // and the server still holds a copy it was based on; autosave then sends it. Already saved, or
  // overtaken by a change made elsewhere, it is dropped.
  const restorePendingDetails = useCallback(() => {
    const snapshot = dataRef.current;
    const entry = snapshot?.activeEntry;
    if (!entry || isOptimisticTimerId(entry.id) || mutationGateRef.current.isActive()) return;
    const { owner } = pendingOwner(snapshot);
    const record = readPendingTimerDetails(owner, entry.id);
    if (!record) return;
    const decision = pendingTimerDetailsDecision(record, timerDraftForEntry(entry));
    if (decision.kind !== "apply") {
      clearPendingTimerDetails(owner, entry.id);
      return;
    }
    if (timerDraftEditedFields(draftRef.current, baseFor(entry)).length) return;
    setTimerDraft(applyPendingTimerDetails(record, draftRef.current, decision.fields));
  }, [baseFor, pendingOwner, setTimerDraft]);

  const activeEntryRestoreKey = timerDraftVersion(data?.activeEntry);
  useEffect(() => {
    restorePendingDetails();
  }, [activeEntryRestoreKey, restorePendingDetails]);

  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") restorePendingDetails();
    };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onShow);
    // Sign-out or a workspace switch: this session's kept text goes, and its later page exits
    // write nothing (its token is from before the session ended; Codex r2 on #539).
    const unregister = onBeforeSessionChange(async () => {
      pendingOwner(dataRef.current);
      endPendingTimerDetailsSession();
    });
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onShow);
      unregister();
    };
  }, [pendingOwner, restorePendingDetails]);

  const updateActiveEntryFromCalendarUntracked = useCallback(async (
    input: ActiveEntryCompactMutationInput
  ): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running block to edit." };
    const draftSnapshot = draftRef.current;
    refreshRequestRef.current += 1;
    const outcome = await runActiveEntryCompactMutation({
      commit: (nextData) => commitData(nextData, "optimistic"),
      draftSnapshot,
      gate: mutationGateRef.current,
      getCurrentData: () => dataRef.current,
      input,
      refresh: async () => {
        await refresh({ force: true });
      },
      send: async (entryId, payload) => {
        // A same-tab editor save owns the base like the bar's own saves: the fields it writes
        // become the base the moment it is sent, so typing in the bar while it is pending is a
        // newer edit based on the editor's values, never a false conflict (Codex r1 on #387).
        const previousBase = baseFor(snapshot.activeEntry!);
        const resolved = input.plan.resolved;
        setTimerDraftBase({
          categoryId: "categoryId" in payload ? resolved.categoryId ?? "" : previousBase.categoryId,
          description: "description" in payload ? resolved.description ?? "" : previousBase.description,
          tagNames: "tagNames" in payload ? [...resolved.tagNames] : previousBase.tagNames
        }, entryId);
        detailsSavesInFlightRef.current += 1;
        try {
          const response = await clientFetch(`/api/time-entries/${entryId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            throw new Error(await responseError(response, `Unable to save the block details: ${response.status}`));
          }
          return (await response.json()) as { updatedAt?: string };
        } catch (error) {
          setTimerDraftBase(previousBase, entryId);
          throw error;
        } finally {
          detailsSavesInFlightRef.current -= 1;
        }
      },
      setBusy: setIsTimerBusy,
      setDraft: setTimerDraft,
      setError: setTimerError,
      snapshot
    });
    return outcome;
  }, [baseFor, commitData, refresh, setTimerDraft, setTimerDraftBase]);
  const updateActiveEntryFromCalendar = useCallback(
    (...args: Parameters<typeof updateActiveEntryFromCalendarUntracked>) => trackTimerAction(() => updateActiveEntryFromCalendarUntracked(...args)),
    [updateActiveEntryFromCalendarUntracked, trackTimerAction]
  );

  const readShellData = useCallback(() => dataRef.current, []);

  const updateActiveStartTimeUntracked = useCallback(async (
    startedAt: string,
    options: { expectedEntryIds?: readonly string[] } = {}
  ): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running block to edit." };
    const expected = options.expectedEntryIds;
    if (expected?.length) {
      // The running block must be the Start's own, at its optimistic id, the server id the Start
      // reported, or the server id it was handed off to (the hand-off map may already be cleared
      // once the real block has rendered; Codex r6 on #418).
      const activeId = snapshot.activeEntry.id;
      const ownId = expected.includes(activeId) || expected.some((id) => serverEntryId(id) === activeId);
      if (!ownId) return { ok: false, error: "That block is no longer running." };
    }
    const draft = draftRef.current;
    const base = baseFor(snapshot.activeEntry);
    // The new start time, plus only the details this tab's user edited (with their base values).
    const patch = timerDetailsPatch(draft, base);
    const sending = patch ? pickTimerDraftFields(draft, timerDraftForEntry(snapshot.activeEntry), patch.fields) : timerDraftForEntry(snapshot.activeEntry);
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      detailsSavesInFlightRef.current += 1;
      commitData(applyOptimisticActiveEntryPatch(snapshot, sending, startedAt), "optimistic");
      if (patch) setTimerDraftBase(timerDraftBaseAfterSave(base, draft, patch.fields), snapshot.activeEntry!.id);
      try {
        // A block shown at its optimistic id right after an accepted Start is edited at its real id
        // ("← From 10:15" edits the start straight after starting).
        const response = await clientFetch(`/api/time-entries/${serverEntryId(snapshot.activeEntry!.id) ?? snapshot.activeEntry!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // No `stoppedAt`: this tab's copy says "running", and echoing that would reopen a block
          // another device stopped meanwhile; the server checks the start against the row's own end
          // (stability audit 22 Oct 2026, Codex on #527).
          body: JSON.stringify({
            ...(patch?.body ?? {}),
            startedAt
          })
        });
        if (response.status === 409) {
          const conflict = await response.json().catch(() => null) as { entry?: TimeEntryRow } | null;
          if (!adoptServerDetails(snapshot.activeEntry!.id, conflict?.entry)) {
            commitData(snapshot, "optimistic");
            setTimerDraftBase(base, snapshot.activeEntry!.id);
          }
          setTimerError(DETAILS_CONFLICT_MESSAGE);
          return { ok: false, error: DETAILS_CONFLICT_MESSAGE } as const;
        }
        if (!response.ok) throw new Error(await responseError(response, `Unable to update start time: ${response.status}`));
        const result = (await response.json()) as { updatedAt?: string };
        if (result.updatedAt && dataRef.current) {
          commitData(
            applyAuthoritativeActiveEntryVersion(dataRef.current, snapshot.activeEntry!.id, result.updatedAt),
            "canonical"
          );
        }
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot, "optimistic");
        setTimerDraftBase(base, snapshot.activeEntry!.id);
        const message = errorMessage(error, "Unable to update the start time.");
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        detailsSavesInFlightRef.current -= 1;
        setIsTimerBusy(false);
      }
    });
    if (result.ran && result.value.ok && !mutationGateRef.current.isActive()) {
      await refresh({ force: true });
    }
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [adoptServerDetails, baseFor, commitData, refresh, serverEntryId, setTimerDraftBase]);
  const updateActiveStartTime = useCallback(
    (...args: Parameters<typeof updateActiveStartTimeUntracked>) => trackTimerAction(() => updateActiveStartTimeUntracked(...args)),
    [updateActiveStartTimeUntracked, trackTimerAction]
  );

  const createManualEntry = useCallback(async (input: ManualEntryInput): Promise<MutationOutcome> => {
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      try {
        const response = await clientFetch("/api/time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "manual", ...input })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to add the block: ${response.status}`));
        return { ok: true } as const;
      } catch (error) {
        return { ok: false, error: errorMessage(error, "Unable to add this block.") } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    if (result.ran && result.value.ok && !mutationGateRef.current.isActive()) {
      await refresh({ force: true });
    }
    return result.ran ? result.value : { ok: false, error: "A block update is already in progress." };
  }, [refresh]);

  const createCategory = useCallback(async (
    name: string,
    color?: DayframePaletteKey,
    icon?: string
  ): Promise<CategoryMutationOutcome> => {
    try {
      const response = await clientFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, icon })
      });
      if (!response.ok) {
        return {
          ok: false,
          error: await responseError(response, `Unable to create activity: ${response.status}`)
        };
      }
      const payload = (await response.json()) as { category?: CategoryRow };
      if (!payload.category) {
        return { ok: false, error: "The activity was created, but its details could not be loaded. Refresh and try again." };
      }
      const current = dataRef.current;
      if (current) {
        const categories = current.categories.some((category) => category.id === payload.category!.id)
          ? current.categories
          : [...current.categories, payload.category].sort(compareCategories);
        commitData({ ...current, categories }, "optimistic");
      }
      return { ok: true, category: payload.category };
    } catch {
      return { ok: false, error: "Unable to create this activity. Check your connection and try again." };
    }
  }, [commitData]);

  const setProjectedEnds = useCallback((ends: ReadonlyMap<string, string>) => setProjectedEndsState((current) =>
    current.size === ends.size && [...ends].every(([id, at]) => current.get(id) === at) ? current : ends), []);
  const toggleTimer = useCallback(() => {
    const active = dataRef.current?.activeEntry;
    // Shown ended (End it held or saving): Start, which ends it on the server as any Start does; End it then sets its end.
    return active && !projectedEndsRef.current.has(active.id) ? stopTimer() : startTimer();
  }, [startTimer, stopTimer]);

  const shownData = useMemo(() => projectBlockEnds(data, projectedEnds), [data, projectedEnds]);
  const selectedData = shownData?.dateRange.selectedDate === selectedDate ? shownData : null;
  const shownActive = shownData?.activeEntry ?? null;
  const timerDraftEdited = shownActive !== null && timerDraftEditedFields(
    timerDraft,
    timerDraftBase.entryId === shownActive.id ? timerDraftBase.draft : timerDraftForEntry(shownActive)
  ).length > 0;

  const value = useMemo<RuntimeContext>(() => ({
    clearDateLoadError: () => setDateLoadError(null),
    clearTimerError: () => setTimerError(null),
    closeManualEntry: () => setIsManualEntryOpen(false),
    createCategory,
    createManualEntry,
    deleteActiveTimer,
    joinSplitTimer,
    splitActiveTimer,
    data: selectedData,
    dateLoadError,
    hydrate,
    isDateLoading,
    isManualEntryOpen,
    isStopPending,
    isTimerBusy,
    loadDate,
    openManualEntry: () => setIsManualEntryOpen(true),
    refresh,
    selectedDate,
    setTimerDraft,
    shellData: shownData,
    canonicalShellData: data,
    setProjectedEnds,
    startEntryAgain,
    startTimer,
    stopTimer,
    timerDraft,
    timerDraftEdited,
    timerDraftScope,
    timerError,
    toggleTimer,
    updateActiveDetails,
    updateActiveEntryFromCalendar,
    updateActiveStartTime,
    readShellData
  }), [
    createCategory,
    createManualEntry,
    deleteActiveTimer,
    joinSplitTimer,
    splitActiveTimer,
    data,
    dateLoadError,
    hydrate,
    isDateLoading,
    isManualEntryOpen,
    isStopPending,
    isTimerBusy,
    loadDate,
    refresh,
    selectedData,
    selectedDate,
    setProjectedEnds,
    setTimerDraft,
    shownData,
    startEntryAgain,
    startTimer,
    stopTimer,
    timerDraft,
    timerDraftEdited,
    timerDraftScope,
    timerError,
    toggleTimer,
    updateActiveDetails,
    updateActiveEntryFromCalendar,
    updateActiveStartTime,
    readShellData
  ]);

  return <AppShellRuntimeContext.Provider value={value}>{children}</AppShellRuntimeContext.Provider>;
}

const OPTIMISTIC_TIMER_ID_PREFIX = "optimistic-timer:";

/**
 * A server timestamp as ISO. The first page's data arrives from the server component with `Date`
 * values, later bootstraps as JSON strings; both become the same ISO string (Codex r4 on #539).
 */
function serverVersion(value: unknown) {
  const time = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/** The version of a block as the server gave it; none for a block still shown optimistically. */
function entryVersion(entry: TimeEntryRow | null | undefined) {
  return entry && !entry.id.startsWith(OPTIMISTIC_TIMER_ID_PREFIX) ? serverVersion(entry.updatedAt) : undefined;
}

function withVersion(body: Record<string, unknown>, version: string | undefined) {
  return version ? { ...body, expectedUpdatedAt: version } : body;
}

/** Whether `entry` still holds `base` for `fields` (a 409 then came from its version alone). */
function detailsHold(entry: TimeEntryRow, base: TimerDraft, fields: TimerDetailField[]) {
  const stored = timerDraftForEntry(entry);
  return fields.every((field) => timerDetailEquivalent(field, stored, base));
}
const DETAILS_CONFLICT_MESSAGE = "This block was changed in another window or device, so its latest details are shown.";
const DETAILS_CONFLICT_SWITCH_MESSAGE = "Switched. The block you left was changed in another window or device, so your edit to it was not saved.";
const DETAILS_CONFLICT_STOP_MESSAGE = "Stopped. This block was changed in another window or device, so it kept those details.";
const DETAILS_FAILED_MESSAGE = "Block details were not saved. Your previous values were restored.";
const DETAILS_FAILED_STOP_MESSAGE = "Stopped. Its latest details could not be saved, so it kept its previous details.";
/** How long a Stop waits for a save already in flight before it goes ahead and carries the edits itself. */
export const STOP_WAIT_DEADLINE_MS = 3_000;

function isOptimisticTimerId(id: string | null) {
  return id?.startsWith(OPTIMISTIC_TIMER_ID_PREFIX) ?? false;
}

/** True inside the signed-in shell (which supplies the page's <main>), false on bare pages. */
export function useInsideAppShell() {
  return useContext(AppShellRuntimeContext) !== null;
}

export function useAppShellRuntime() {
  const context = useContext(AppShellRuntimeContext);
  if (!context) throw new Error("useAppShellRuntime must be used inside AppShellRuntimeProvider.");
  return context;
}

export function useRuntimePageData(initialData: BootstrapData) {
  const runtime = useAppShellRuntime();
  const { hydrate } = runtime;
  useLayoutEffect(() => {
    hydrate(initialData);
  }, [hydrate, initialData]);

  // Page props drawn for another workspace than the runtime's are never shown (see `hydrate`).
  const shell = runtime.shellData;
  if (shell && shell.workspace.id !== initialData.workspace.id) return runtime.data ?? shell;
  if (
    runtime.data?.workspace.id === initialData.workspace.id &&
    runtime.data.dateRange.selectedDate === runtime.selectedDate
  ) {
    return runtime.data;
  }
  if (initialData.dateRange.selectedDate === runtime.selectedDate) return initialData;
  return runtime.data ?? initialData;
}

const workspaceChangedOutcome: DateLoadOutcome = { ok: false, error: "The workspace changed while that period loaded." };

function dateDataCacheKey(workspaceId: string, date: string) {
  return `${workspaceId}|${date}`;
}

function withCurrentSharedBootstrap(
  cached: BootstrapData,
  current: BootstrapData | null
): BootstrapData {
  if (!current || current.workspace.id !== cached.workspace.id) return cached;
  return {
    ...cached,
    user: current.user,
    workspace: current.workspace,
    workspaces: current.workspaces,
    clients: current.clients,
    categories: current.categories,
    projects: current.projects,
    tags: current.tags,
    places: current.places,
    learnedPlaces: current.learnedPlaces,
    automationRules: current.automationRules,
    entries: current.entries,
    activeEntry: current.activeEntry,
    reviewItems: current.reviewItems,
    activityEvents: current.activityEvents,
    categoryUsage: current.categoryUsage,
    taskSuggestions: current.taskSuggestions,
    taskSuggestionCandidates: current.taskSuggestionCandidates
  };
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function compareCategories(left: CategoryRow, right: CategoryRow) {
  if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}
