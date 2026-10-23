"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  TIMER_STATE_RECONCILE_INTERVAL_MS,
  timerStateChanged,
  timerStatePollDelay,
  type DayframePaletteKey,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";
import { onBeforeSessionChange } from "@/lib/session-change";
import {
  applyPendingTimerDetails,
  clearPendingTimerDetails,
  fitsKeepalive,
  pendingTimerDetailsDecision,
  readPendingTimerDetails,
  writePendingTimerDetails
} from "@/lib/timer-draft-store";
import type { BootstrapData, CategoryRow, TimeEntryRow } from "@/lib/queries";
import { snapshotFitsViewerZone } from "@/lib/viewer-time-zone";
import { timelineStateFromSearchParams } from "@/lib/timeline-view";
import { goalDrafts } from "@/lib/goal-stepper";
import {
  applyAuthoritativeActiveEntryVersion,
  applyOptimisticActiveEntryPatch,
  applyOptimisticTimerDelete,
  applyOptimisticTimerStop,
  applyServerActiveEntry,
  createTimerMutationGate,
  entryContinuationDecision,
  mergeTimerDraft,
  pickTimerDraftFields,
  reconcileTimerDraftWithBase,
  runActiveEntryCompactMutation,
  runTimerStartMutation,
  timerDetailsPatch,
  timerDraftBaseAfterSave,
  timerDraftEditedFields,
  timerDraftForEntry,
  timerDraftsEqual,
  timerDraftVersion,
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
  createCategory: (name: string, color?: DayframePaletteKey) => Promise<CategoryMutationOutcome>;
  createManualEntry: (input: ManualEntryInput) => Promise<MutationOutcome>;
  deleteActiveTimer: () => Promise<MutationOutcome>;
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
};

const AppShellRuntimeContext = createContext<RuntimeContext | null>(null);
export const BOOTSTRAP_RECONCILE_INTERVAL_MS = TIMER_STATE_RECONCILE_INTERVAL_MS;
export const BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS = 10_000;
export const DATE_DATA_CACHE_LIMIT = 8;

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
  const dateDataCacheRef = useRef(new Map<string, BootstrapData>());
  /**
   * A cached day, only when its ranges were built for the zone the browser sends now (Codex r1 on
   * #484): a snapshot from before the zone cookie existed, or from another zone, is fetched again.
   */
  const cachedDateData = useCallback((date: string) => {
    const cached = dateDataCacheRef.current.get(date);
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
  const refreshRequestRef = useRef(0);
  const dateLoadRequestRef = useRef(0);
  const isDateLoadingRef = useRef(false);
  const optimisticIdRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const mutationGateRef = useRef(createTimerMutationGate());
  const timerStateRef = useRef<TimerStateFingerprint | null>(null);
  const timerStatePollInFlightRef = useRef(false);

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
      dateDataCacheRef.current.delete(nextData.dateRange.selectedDate);
      dateDataCacheRef.current.set(nextData.dateRange.selectedDate, nextData);
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
    try {
      const response = await clientFetch(`/api/bootstrap?date=${selectedDate}`, { cache: "no-store" });
      if (!response.ok || requestId !== refreshRequestRef.current) return dataRef.current;
      const payload = (await response.json()) as BootstrapData;
      // A newer load (or a mutation's own data) may have landed while this body was read: an
      // older answer never replaces it.
      if (requestId !== refreshRequestRef.current) return dataRef.current;
      commitData(payload, "canonical");
      return payload;
    } catch {
      return dataRef.current;
    }
  }, [commitData, selectedDate]);

  const loadDate = useCallback(async (date: string): Promise<DateLoadOutcome> => {
    const cached = cachedDateData(date);
    if (cached) {
      setDateLoadError(null);
      commitData(withCurrentSharedBootstrap(cached, dataRef.current), "cache");
      return { ok: true };
    }
    if (isDateLoadingRef.current) {
      return { ok: false, error: "A period is already loading." };
    }

    refreshRequestRef.current += 1;
    const requestId = ++dateLoadRequestRef.current;
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
      commitData(payload, "canonical");
      return { ok: true };
    } catch {
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
    const cached = dateDataCacheRef.current.get(selectedDate);
    if (!cached || !snapshotFitsViewerZone(cached.viewerTimeZone, document.cookie)) return;
    setDateLoadError(null);
    if (dataRef.current?.dateRange.selectedDate !== selectedDate) {
      commitData(withCurrentSharedBootstrap(cached, dataRef.current), "cache");
    }
  }, [commitData, selectedDate]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      const current = dataRef.current;
      const currentFits = current?.dateRange.selectedDate === selectedDate &&
        snapshotFitsViewerZone(current.viewerTimeZone, document.cookie);
      if (!currentFits && !cachedDateData(selectedDate)) {
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

  useEffect(() => {
    let cancelled = false;
    let timeout: number | null = null;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (
        cancelled ||
        document.visibilityState !== "visible" ||
        timerStatePollInFlightRef.current
      ) return;
      timerStatePollInFlightRef.current = true;
      try {
        const response = await clientFetch("/api/timer-state", { cache: "no-store" });
        if (!response.ok) throw new Error(`Unable to check the recording state: ${response.status}`);
        const next = (await response.json()) as TimerStateFingerprint;
        const changed = timerStateChanged(timerStateRef.current, next);
        timerStateRef.current = next;
        consecutiveFailures = 0;
        if (changed) await refresh();
      } catch {
        consecutiveFailures += 1;
      } finally {
        timerStatePollInFlightRef.current = false;
        schedule(timerStatePollDelay(consecutiveFailures));
      }
    };

    const resume = () => {
      if (document.visibilityState !== "visible") {
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
        return;
      }
      schedule(0);
    };

    schedule(0);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);

  const hydrate = useCallback((nextData: BootstrapData) => {
    if (mutationGateRef.current.isActive()) return;
    if (nextData.dateRange.selectedDate !== selectedDate) return;
    // Page props drawn before the zone cookie existed (or for another zone) never replace a copy
    // built for the zone the browser sends now; shown only when nothing better is there, and then
    // fetched again (Codex r2 on #484).
    if (!snapshotFitsViewerZone(nextData.viewerTimeZone, document.cookie)) {
      const current = dataRef.current;
      if (current?.dateRange.selectedDate === selectedDate && snapshotFitsViewerZone(current.viewerTimeZone, document.cookie)) return;
      commitData(nextData, "hydrate");
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

  // The details save in flight (its block and the base it was sent against), and the outcome of
  // the last one: a Stop that waited for it, or gave up waiting, uses both (Codex r1 on #539).
  const detailsInFlightRef = useRef<{ entryId: string; base: TimerDraft } | null>(null);
  const detailsOutcomeRef = useRef<{ seq: number; entryId: string; conflict: boolean; error: string | null }>(
    { seq: 0, entryId: "", conflict: false, error: null }
  );
  const pendingStopRef = useRef<Promise<MutationOutcome> | null>(null);
  const [isStopPending, setIsStopPending] = useState(false);

  // Saves the running block's details; the caller holds the mutation gate. Only the fields the
  // user edited (against `base`, the copy the edit was based on) are sent, with their base values.
  // `keepalive` only for a close-time flush (a foreground save may exceed its 64 KiB budget).
  const saveActiveDetails = useCallback(async (
    snapshot: BootstrapData,
    draft: TimerDraft,
    explicitBase?: TimerDraft,
    options: { keepalive?: boolean } = {}
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
    const sending = pickTimerDraftFields(draft, timerDraftForEntry(activeEntry), patch.fields);
    const optimistic = applyOptimisticActiveEntryPatch(snapshot, sending);
    commitData(optimistic, "optimistic");
    // What is being saved is now the base, so an edit made while the save is pending (even one
    // back to the previous text) is newer and survives its acknowledgement (Codex r7).
    setTimerDraftBase(timerDraftBaseAfterSave(base, draft, patch.fields), activeEntry.id);
    const inFlight = { entryId: activeEntry.id, base };
    detailsInFlightRef.current = inFlight;
    // A save that settles after a Stop went ahead without it (`stopTimer`'s deadline) leaves the
    // stopped block alone: no rollback brings it back and its notice is the Stop's.
    const stillShown = () => dataRef.current?.activeEntry?.id === activeEntry.id;
    const settle = (conflict: boolean, error: string | null) => {
      detailsOutcomeRef.current = { seq: detailsOutcomeRef.current.seq + 1, entryId: activeEntry.id, conflict, error };
    };
    try {
      const body = JSON.stringify(patch.body);
      const response = await clientFetch(`/api/time-entries/${targetId}`, {
        method: "PATCH",
        ...(options.keepalive && fitsKeepalive(body) ? { keepalive: true } : {}),
        headers: { "Content-Type": "application/json" },
        body
      });
      if (response.status === 409) {
        const conflict = await response.json().catch(() => null) as { entry?: TimeEntryRow } | null;
        settle(true, DETAILS_CONFLICT_MESSAGE);
        if (!stillShown()) return { ok: false, error: DETAILS_CONFLICT_MESSAGE } as const;
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
      if (result.updatedAt && dataRef.current) {
        commitData(
          applyAuthoritativeActiveEntryVersion(dataRef.current, activeEntry.id, result.updatedAt),
          "canonical"
        );
      }
      settle(false, null);
      clearPendingTimerDetails(targetId, draft);
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
  }, [adoptServerDetails, baseFor, commitData, serverEntryId, setTimerDraft, setTimerDraftBase]);

  // Leaving the shell: details the running block's real id would still get from autosave are sent
  // now (keepalive, so the request outlives the page). A block whose Start's POST has not come
  // back has no real id yet; those edits are lost, as on any page left mid-request.
  useEffect(() => () => {
    const entry = dataRef.current?.activeEntry;
    const targetId = entry ? serverEntryId(entry.id) : null;
    const patch = entry ? timerDetailsPatch(draftRef.current, baseFor(entry)) : null;
    if (!entry || !targetId || !patch) return;
    const body = JSON.stringify(patch.body);
    void clientFetch(`/api/time-entries/${targetId}`, {
      method: "PATCH",
      ...(fitsKeepalive(body) ? { keepalive: true } : {}),
      headers: { "Content-Type": "application/json" },
      body
    }).catch(() => undefined);
  }, [baseFor, serverEntryId]);

  const startTimer = useCallback(async (
    input: TimerDraftInput = {},
    options: { dedupeRunning?: boolean; guard?: (snapshot: BootstrapData) => string | null; startedAt?: string } = {}
  ): Promise<TimerStartOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot) return { ok: false, error: "Block data is still loading." };
    const outgoing = snapshot.activeEntry;
    if (outgoing && !outgoingDraftsRef.current.has(outgoing.id)) {
      outgoingDraftsRef.current.set(outgoing.id, { draft: draftRef.current, base: baseFor(outgoing) });
    }
    return runTimerStartMutation({
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
  }, [baseFor, commitData, refresh, saveActiveDetails, serverEntryId, setTimerDraft]);

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
        if (left <= 0 && inFlight && inFlight.entryId === requested.id && serverEntryId(requested.id)) {
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
      if (dataRef.current?.activeEntry?.id !== requested.id) {
        return startPending
          ? { ok: false, error: "That block did not start, so there was nothing to stop." }
          : { ok: false, error: "There is no running block to stop." };
      }
    }
    // A details save this Stop waited for and that was refused or failed: its notice is carried
    // into the Stop's own (which otherwise clears it), so the lost edit is never silent.
    const earlier = detailsOutcomeRef.current;
    const carried = earlier.seq > outcomeSeq && earlier.entryId === requested.id && earlier.error ? earlier : null;
    const snapshot = dataRef.current!;
    const activeEntry = snapshot.activeEntry!;
    const targetId = serverEntryId(activeEntry.id);
    if (!targetId) return { ok: false, error: "The block is still starting." };
    const draftSnapshot = draftRef.current;
    const draft = mergeTimerDraft(draftSnapshot, input);
    // Only what this tab's user edited is saved with the Stop (a stale copy never is). Past a hung
    // save, against the base that save was sent from, so its edits go too; then, if the server
    // turns out to hold that save after all (409), once more against what it saved.
    const savedBase = baseFor(activeEntry);
    const patches = [timerDetailsPatch(draft, bypassed?.base ?? savedBase)];
    if (bypassed) patches.push(timerDetailsPatch(draft, savedBase));
    let detailsConflict = false;
    let conflictEntry: TimeEntryRow | null = null;
    const stop = async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticTimerStop(snapshot, new Date().toISOString()), "optimistic");

      try {
        for (const patch of patches) {
          if (!patch) {
            // Nothing newer than the hung save: a conflict only if the server holds something else.
            detailsConflict = Boolean(conflictEntry && timerDraftEditedFields(timerDraftForEntry(conflictEntry), savedBase).length);
            break;
          }
          const updateResponse = await clientFetch(`/api/time-entries/${targetId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch.body)
          });
          // Changed elsewhere since this edit's base: the block stops with the other change.
          if (updateResponse.status === 409) {
            detailsConflict = true;
            conflictEntry = (await updateResponse.json().catch(() => null) as { entry?: TimeEntryRow } | null)?.entry ?? null;
            continue;
          }
          if (!updateResponse.ok) {
            throw new Error(await responseError(updateResponse, `Unable to save the block details: ${updateResponse.status}`));
          }
          detailsConflict = false;
          break;
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
        clearPendingTimerDetails(targetId);
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
  }, [baseFor, commitData, refresh, serverEntryId, setTimerDraft]);

  // One Stop at a time: pressing again while one waits or runs joins it (no stacked waiters).
  const stopTimer = useCallback((input: TimerDraftInput = {}): Promise<MutationOutcome> => {
    if (pendingStopRef.current) return pendingStopRef.current;
    const stopping = stopTimerNow(input).finally(() => {
      if (pendingStopRef.current === stopping) pendingStopRef.current = null;
      setIsStopPending(false);
    });
    pendingStopRef.current = stopping;
    return stopping;
  }, [stopTimerNow]);

  const deleteActiveTimer = useCallback(async (): Promise<MutationOutcome> => {
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
        clearPendingTimerDetails(targetId);
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
  }, [commitData, refresh, serverEntryId, setTimerDraft]);

  const updateActiveDetails = useCallback(async (
    draft: TimerDraft,
    options: { keepalive?: boolean } = {}
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

  // The tab is closing, reloading or going to the background (stability audit WEB-UI-2): edits
  // autosave would send after its 650 ms debounce are first kept in this browser (the pending
  // details store), then sent now. With the gate free this is the ordinary save, keepalive when the
  // body fits, so it outlives the page; its base moves, so the debounce sends nothing again. With a
  // save already in flight nothing is sent beside it (its successor would be checked against a
  // write that may not have committed, and refused; Codex r1 on #539): the store keeps the newer
  // edits, based on either copy, and the next load or the tab's return puts them back for autosave.
  useEffect(() => {
    function flush() {
      const entry = dataRef.current?.activeEntry;
      const targetId = entry ? serverEntryId(entry.id) : null;
      if (!entry || !targetId) return;
      const base = baseFor(entry);
      const draft = draftRef.current;
      if (!timerDetailsPatch(draft, base)) return;
      const inFlight = detailsInFlightRef.current;
      writePendingTimerDetails({
        entryId: targetId,
        draft,
        bases: inFlight?.entryId === entry.id ? [base, inFlight.base] : [base],
        savedAt: Date.now()
      });
      if (!mutationGateRef.current.isActive()) void updateActiveDetails(draft, { keepalive: true });
    }
    const onPageHide = () => flush();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [baseFor, serverEntryId, updateActiveDetails]);

  // Edits a close-time flush could not confirm come back: on load, when the running block's copy
  // changes, and when the tab is shown again. They are put in the draft only while this tab has no
  // edits of its own and the server still holds a copy they were based on; autosave then sends
  // them. Already saved, or overtaken by a change made elsewhere, they are dropped.
  const restorePendingDetails = useCallback(() => {
    const entry = dataRef.current?.activeEntry;
    if (!entry || isOptimisticTimerId(entry.id) || mutationGateRef.current.isActive()) return;
    const record = readPendingTimerDetails();
    if (!record) return;
    if (record.entryId !== entry.id) {
      clearPendingTimerDetails();
      return;
    }
    const decision = pendingTimerDetailsDecision(record, timerDraftForEntry(entry));
    if (decision.kind !== "apply") {
      clearPendingTimerDetails();
      return;
    }
    if (timerDraftEditedFields(draftRef.current, baseFor(entry)).length) return;
    setTimerDraft(applyPendingTimerDetails(record, draftRef.current, decision.fields));
  }, [baseFor, setTimerDraft]);

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
    // Kept text never outlives the session it was typed in.
    const unregister = onBeforeSessionChange(async () => clearPendingTimerDetails());
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onShow);
      unregister();
    };
  }, [restorePendingDetails]);

  const updateActiveEntryFromCalendar = useCallback(async (
    input: ActiveEntryCompactMutationInput
  ): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running block to edit." };
    const draftSnapshot = draftRef.current;
    refreshRequestRef.current += 1;
    return runActiveEntryCompactMutation({
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
  }, [baseFor, commitData, refresh, setTimerDraft, setTimerDraftBase]);

  const readShellData = useCallback(() => dataRef.current, []);

  const updateActiveStartTime = useCallback(async (
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
    color?: DayframePaletteKey
  ): Promise<CategoryMutationOutcome> => {
    try {
      const response = await clientFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color })
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

  const toggleTimer = useCallback(() => (
    dataRef.current?.activeEntry ? stopTimer() : startTimer()
  ), [startTimer, stopTimer]);

  const selectedData = data?.dateRange.selectedDate === selectedDate ? data : null;
  const shownActive = data?.activeEntry ?? null;
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
    shellData: data,
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
    setTimerDraft,
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

  if (
    runtime.data?.workspace.id === initialData.workspace.id &&
    runtime.data.dateRange.selectedDate === runtime.selectedDate
  ) {
    return runtime.data;
  }
  if (initialData.dateRange.selectedDate === runtime.selectedDate) return initialData;
  return runtime.data ?? initialData;
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
