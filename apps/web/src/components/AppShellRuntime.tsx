"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { timelineStateFromSearchParams } from "@/lib/timeline-view";
import {
  applyOptimisticActiveEntryPatch,
  applyOptimisticTimerStart,
  applyOptimisticTimerStop,
  createTimerMutationGate,
  entryContinuationDecision,
  timerStartErrorMessage,
  timerDraftForEntry,
  type TimerDraft,
  type TimerDraftInput
} from "@/lib/timer-runtime";

type MutationOutcome = { ok: true } | { ok: false; error: string };
type DateLoadOutcome = { ok: true } | { ok: false; error: string };

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
  createManualEntry: (input: ManualEntryInput) => Promise<MutationOutcome>;
  data: BootstrapData | null;
  dateLoadError: string | null;
  hydrate: (data: BootstrapData) => void;
  isDateLoading: boolean;
  isManualEntryOpen: boolean;
  isTimerBusy: boolean;
  loadDate: (date: string) => Promise<DateLoadOutcome>;
  openManualEntry: () => void;
  refresh: (options?: { force?: boolean }) => Promise<BootstrapData | null>;
  selectedDate: string;
  setTimerDraft: (draft: TimerDraft | ((current: TimerDraft) => TimerDraft)) => void;
  shellData: BootstrapData | null;
  startEntryAgain: (entry: TimeEntryRow) => Promise<MutationOutcome>;
  startTimer: (input?: TimerDraftInput) => Promise<MutationOutcome>;
  stopTimer: (input?: TimerDraftInput) => Promise<MutationOutcome>;
  timerDraft: TimerDraft;
  timerError: string | null;
  toggleTimer: () => Promise<MutationOutcome>;
  updateActiveDetails: (draft: TimerDraft) => Promise<MutationOutcome>;
  updateActiveStartTime: (startedAt: string) => Promise<MutationOutcome>;
};

const AppShellRuntimeContext = createContext<RuntimeContext | null>(null);
export const BOOTSTRAP_RECONCILE_INTERVAL_MS = 30_000;
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
  const draftRef = useRef(timerDraft);
  const activeEntryIdRef = useRef<string | null>(null);
  const refreshRequestRef = useRef(0);
  const dateLoadRequestRef = useRef(0);
  const isDateLoadingRef = useRef(false);
  const optimisticIdRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const mutationGateRef = useRef(createTimerMutationGate());

  const commitData = useCallback((nextData: BootstrapData | null) => {
    dataRef.current = nextData;
    lastCommitAtRef.current = nextData ? Date.now() : 0;
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
    setTimerDraftState((current) => {
      const nextDraft = typeof draft === "function" ? draft(current) : draft;
      draftRef.current = nextDraft;
      return nextDraft;
    });
  }, []);

  useEffect(() => {
    const activeEntryId = data?.activeEntry?.id ?? null;
    if (activeEntryIdRef.current === activeEntryId) return;
    activeEntryIdRef.current = activeEntryId;
    setTimerDraft(timerDraftForEntry(data?.activeEntry));
  }, [data?.activeEntry, setTimerDraft]);

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && mutationGateRef.current.isActive()) return dataRef.current;
    const requestId = ++refreshRequestRef.current;
    try {
      const response = await clientFetch(`/api/bootstrap?date=${selectedDate}`, { cache: "no-store" });
      if (!response.ok || requestId !== refreshRequestRef.current) return dataRef.current;
      const payload = (await response.json()) as BootstrapData;
      commitData(payload);
      return payload;
    } catch {
      return dataRef.current;
    }
  }, [commitData, selectedDate]);

  const loadDate = useCallback(async (date: string): Promise<DateLoadOutcome> => {
    const cached = dateDataCacheRef.current.get(date);
    if (cached) {
      setDateLoadError(null);
      commitData(withCurrentSharedBootstrap(cached, dataRef.current));
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
      commitData(payload);
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
  }, [commitData]);

  useLayoutEffect(() => {
    const cached = dateDataCacheRef.current.get(selectedDate);
    if (!cached) return;
    setDateLoadError(null);
    if (dataRef.current?.dateRange.selectedDate !== selectedDate) {
      commitData(withCurrentSharedBootstrap(cached, dataRef.current));
    }
  }, [commitData, selectedDate]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      if (
        !dateDataCacheRef.current.has(selectedDate) &&
        dataRef.current?.dateRange.selectedDate !== selectedDate
      ) {
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
  }, [commitData, refresh, selectedDate]);

  const hydrate = useCallback((nextData: BootstrapData) => {
    if (mutationGateRef.current.isActive()) return;
    if (nextData.dateRange.selectedDate !== selectedDate) return;
    commitData(nextData);
  }, [commitData, selectedDate]);

  const startTimer = useCallback(async (input: TimerDraftInput = {}): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot) return { ok: false, error: "Timer data is still loading." };
    const draft = mergeDraft(draftRef.current, input);
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      const startedAt = new Date().toISOString();
      const optimisticId = `optimistic-timer:${startedAt}:${++optimisticIdRef.current}`;
      commitData(applyOptimisticTimerStart(snapshot, draft, startedAt, optimisticId));
      setTimerDraft(draft);

      try {
        const response = await clientFetch("/api/time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "start",
            categoryId: draft.categoryId || undefined,
            description: draft.description.trim() || undefined,
            tagNames: draft.tagNames
          })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to start timer: ${response.status}`));
        await refresh({ force: true });
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot);
        setTimerDraft(timerDraftForEntry(snapshot.activeEntry));
        const message = timerStartErrorMessage(error);
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    return result.ran ? result.value : { ok: false, error: "A timer update is already in progress." };
  }, [commitData, refresh, setTimerDraft]);

  const startEntryAgain = useCallback(async (entry: TimeEntryRow): Promise<MutationOutcome> => {
    const decision = entryContinuationDecision(entry);
    if (!decision.ok) return decision;
    return startTimer(decision.draft);
  }, [startTimer]);

  const stopTimer = useCallback(async (input: TimerDraftInput = {}): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running timer to stop." };
    const draftSnapshot = draftRef.current;
    const draft = mergeDraft(draftSnapshot, input);
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticTimerStop(snapshot, new Date().toISOString()));

      try {
        const updateResponse = await clientFetch(`/api/time-entries/${snapshot.activeEntry!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: draft.categoryId || null,
            placeId: snapshot.activeEntry!.placeId,
            description: draft.description.trim() || null,
            tagNames: draft.tagNames,
            startedAt: snapshot.activeEntry!.startedAt,
            stoppedAt: snapshot.activeEntry!.stoppedAt
          })
        });
        if (!updateResponse.ok) {
          throw new Error(await responseError(updateResponse, `Unable to save timer details: ${updateResponse.status}`));
        }
        const response = await clientFetch("/api/time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "stop" })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to stop timer: ${response.status}`));
        await refresh({ force: true });
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot);
        setTimerDraft(draftSnapshot);
        const message = errorMessage(error, "Unable to stop the timer.");
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    return result.ran ? result.value : { ok: false, error: "A timer update is already in progress." };
  }, [commitData, refresh, setTimerDraft]);

  const updateActiveDetails = useCallback(async (draft: TimerDraft): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running timer to edit." };
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticActiveEntryPatch(snapshot, draft));
      try {
        const response = await clientFetch(`/api/time-entries/${snapshot.activeEntry!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: draft.categoryId || null,
            placeId: snapshot.activeEntry!.placeId,
            description: draft.description.trim() || null,
            tagNames: draft.tagNames
          })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to save timer details: ${response.status}`));
        await refresh({ force: true });
        return { ok: true } as const;
      } catch {
        commitData(snapshot);
        setTimerDraft(timerDraftForEntry(snapshot.activeEntry));
        const message = "Timer details were not saved. Your previous values were restored.";
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    return result.ran ? result.value : { ok: false, error: "A timer update is already in progress." };
  }, [commitData, refresh, setTimerDraft]);

  const updateActiveStartTime = useCallback(async (startedAt: string): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running timer to edit." };
    const draft = draftRef.current;
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticActiveEntryPatch(snapshot, draft, startedAt));
      try {
        const response = await clientFetch(`/api/time-entries/${snapshot.activeEntry!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: draft.categoryId || null,
            placeId: snapshot.activeEntry!.placeId,
            description: draft.description.trim() || null,
            tagNames: draft.tagNames,
            startedAt,
            stoppedAt: snapshot.activeEntry!.stoppedAt
          })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to update start time: ${response.status}`));
        await refresh({ force: true });
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot);
        const message = errorMessage(error, "Unable to update the start time.");
        setTimerError(message);
        return { ok: false, error: message } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    return result.ran ? result.value : { ok: false, error: "A timer update is already in progress." };
  }, [commitData, refresh]);

  const createManualEntry = useCallback(async (input: ManualEntryInput): Promise<MutationOutcome> => {
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      try {
        const response = await clientFetch("/api/time-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "manual", ...input })
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to add entry: ${response.status}`));
        await refresh({ force: true });
        return { ok: true } as const;
      } catch (error) {
        return { ok: false, error: errorMessage(error, "Unable to add this time entry.") } as const;
      } finally {
        setIsTimerBusy(false);
      }
    });
    return result.ran ? result.value : { ok: false, error: "A timer update is already in progress." };
  }, [refresh]);

  const toggleTimer = useCallback(() => (
    dataRef.current?.activeEntry ? stopTimer() : startTimer()
  ), [startTimer, stopTimer]);

  const selectedData = data?.dateRange.selectedDate === selectedDate ? data : null;

  const value = useMemo<RuntimeContext>(() => ({
    clearDateLoadError: () => setDateLoadError(null),
    clearTimerError: () => setTimerError(null),
    closeManualEntry: () => setIsManualEntryOpen(false),
    createManualEntry,
    data: selectedData,
    dateLoadError,
    hydrate,
    isDateLoading,
    isManualEntryOpen,
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
    timerError,
    toggleTimer,
    updateActiveDetails,
    updateActiveStartTime
  }), [
    createManualEntry,
    data,
    dateLoadError,
    hydrate,
    isDateLoading,
    isManualEntryOpen,
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
    timerError,
    toggleTimer,
    updateActiveDetails,
    updateActiveStartTime
  ]);

  return <AppShellRuntimeContext.Provider value={value}>{children}</AppShellRuntimeContext.Provider>;
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
    taskSuggestions: current.taskSuggestions
  };
}

function mergeDraft(current: TimerDraft, input: TimerDraftInput): TimerDraft {
  return {
    categoryId: input.categoryId ?? current.categoryId,
    description: input.description ?? current.description,
    tagNames: input.tagNames ?? current.tagNames
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
