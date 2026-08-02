"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  TIMER_STATE_RECONCILE_INTERVAL_MS,
  timerStateChanged,
  timerStatePollDelay,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { clientFetch } from "@/lib/client-auth-fetch";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { timelineStateFromSearchParams } from "@/lib/timeline-view";
import {
  applyAuthoritativeActiveEntryVersion,
  applyOptimisticActiveEntryPatch,
  applyOptimisticTimerDelete,
  applyOptimisticTimerStop,
  createTimerMutationGate,
  entryContinuationDecision,
  mergeTimerDraft,
  runActiveEntryCompactMutation,
  runTimerStartMutation,
  timerDraftForEntry,
  timerDraftVersion,
  type TimerDraft,
  type TimerDraftInput,
  type ActiveEntryCompactMutationInput
} from "@/lib/timer-runtime";
import {
  reconcileTimerBootstrap,
  type BootstrapCommitSource
} from "@/lib/timer-bootstrap-reconciliation";

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
  deleteActiveTimer: () => Promise<MutationOutcome>;
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
  updateActiveEntryFromCalendar: (input: ActiveEntryCompactMutationInput) => Promise<MutationOutcome>;
  updateActiveStartTime: (startedAt: string) => Promise<MutationOutcome>;
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
  const draftRef = useRef(timerDraft);
  const activeEntryVersionRef = useRef("unhydrated");
  const refreshRequestRef = useRef(0);
  const dateLoadRequestRef = useRef(0);
  const isDateLoadingRef = useRef(false);
  const optimisticIdRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const mutationGateRef = useRef(createTimerMutationGate());
  const timerStateRef = useRef<TimerStateFingerprint | null>(null);
  const timerStatePollInFlightRef = useRef(false);

  const commitData = useCallback((incoming: BootstrapData | null, source: BootstrapCommitSource) => {
    const nextData = incoming
      ? reconcileTimerBootstrap(dataRef.current, incoming, source)
      : null;
    dataRef.current = nextData;
    lastCommitAtRef.current = nextData ? Date.now() : 0;
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
    setTimerDraftState((current) => {
      const nextDraft = typeof draft === "function" ? draft(current) : draft;
      draftRef.current = nextDraft;
      return nextDraft;
    });
  }, []);

  useEffect(() => {
    const activeEntryVersion = timerDraftVersion(data?.activeEntry);
    if (activeEntryVersionRef.current === activeEntryVersion) return;
    activeEntryVersionRef.current = activeEntryVersion;
    setTimerDraft(timerDraftForEntry(data?.activeEntry));
  }, [data?.activeEntry, setTimerDraft]);

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    if (!force && mutationGateRef.current.isActive()) return dataRef.current;
    const requestId = ++refreshRequestRef.current;
    try {
      const response = await clientFetch(`/api/bootstrap?date=${selectedDate}`, { cache: "no-store" });
      if (!response.ok || requestId !== refreshRequestRef.current) return dataRef.current;
      const payload = (await response.json()) as BootstrapData;
      commitData(payload, "canonical");
      return payload;
    } catch {
      return dataRef.current;
    }
  }, [commitData, selectedDate]);

  const loadDate = useCallback(async (date: string): Promise<DateLoadOutcome> => {
    const cached = dateDataCacheRef.current.get(date);
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
  }, [commitData]);

  useLayoutEffect(() => {
    const cached = dateDataCacheRef.current.get(selectedDate);
    if (!cached) return;
    setDateLoadError(null);
    if (dataRef.current?.dateRange.selectedDate !== selectedDate) {
      commitData(withCurrentSharedBootstrap(cached, dataRef.current), "cache");
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
        if (!response.ok) throw new Error(`Unable to check timer state: ${response.status}`);
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
    commitData(nextData, "hydrate");
  }, [commitData, selectedDate]);

  const startTimer = useCallback(async (input: TimerDraftInput = {}): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot) return { ok: false, error: "Timer data is still loading." };
    return runTimerStartMutation({
      gate: mutationGateRef.current,
      snapshot,
      currentDraft: draftRef.current,
      input,
      now: () => new Date().toISOString(),
      createOptimisticId: (startedAt) => `optimistic-timer:${startedAt}:${++optimisticIdRef.current}`,
      onAccepted: () => {
        refreshRequestRef.current += 1;
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
        if (!response.ok) throw new Error(await responseError(response, `Unable to start timer: ${response.status}`));
      },
      refresh: async () => {
        await refresh({ force: true });
      }
    });
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
    const draft = mergeTimerDraft(draftSnapshot, input);
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticTimerStop(snapshot, new Date().toISOString()), "optimistic");

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
        commitData(snapshot, "optimistic");
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

  const deleteActiveTimer = useCallback(async (): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running timer to delete." };
    const draftSnapshot = draftRef.current;
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticTimerDelete(snapshot), "optimistic");
      setTimerDraft(timerDraftForEntry(null));
      try {
        const response = await clientFetch(`/api/time-entries/${snapshot.activeEntry!.id}`, {
          method: "DELETE"
        });
        if (!response.ok) throw new Error(await responseError(response, `Unable to delete timer: ${response.status}`));
        await refresh({ force: true });
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot, "optimistic");
        setTimerDraft(draftSnapshot);
        const message = errorMessage(error, "Unable to delete the running timer.");
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
      commitData(applyOptimisticActiveEntryPatch(snapshot, draft), "optimistic");
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
        const result = (await response.json()) as { updatedAt?: string };
        if (result.updatedAt && dataRef.current) {
          commitData(
            applyAuthoritativeActiveEntryVersion(dataRef.current, snapshot.activeEntry!.id, result.updatedAt),
            "canonical"
          );
        }
        await refresh({ force: true });
        return { ok: true } as const;
      } catch {
        commitData(snapshot, "optimistic");
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

  const updateActiveEntryFromCalendar = useCallback(async (
    input: ActiveEntryCompactMutationInput
  ): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running timer to edit." };
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
        const response = await clientFetch(`/api/time-entries/${entryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(await responseError(response, `Unable to save timer details: ${response.status}`));
        }
        return (await response.json()) as { updatedAt?: string };
      },
      setBusy: setIsTimerBusy,
      setDraft: setTimerDraft,
      setError: setTimerError,
      snapshot
    });
  }, [commitData, refresh, setTimerDraft]);

  const updateActiveStartTime = useCallback(async (startedAt: string): Promise<MutationOutcome> => {
    const snapshot = dataRef.current;
    if (!snapshot?.activeEntry) return { ok: false, error: "There is no running timer to edit." };
    const draft = draftRef.current;
    const result = await mutationGateRef.current.run(async () => {
      setIsTimerBusy(true);
      setTimerError(null);
      refreshRequestRef.current += 1;
      commitData(applyOptimisticActiveEntryPatch(snapshot, draft, startedAt), "optimistic");
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
        const result = (await response.json()) as { updatedAt?: string };
        if (result.updatedAt && dataRef.current) {
          commitData(
            applyAuthoritativeActiveEntryVersion(dataRef.current, snapshot.activeEntry!.id, result.updatedAt),
            "canonical"
          );
        }
        await refresh({ force: true });
        return { ok: true } as const;
      } catch (error) {
        commitData(snapshot, "optimistic");
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
    deleteActiveTimer,
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
    updateActiveEntryFromCalendar,
    updateActiveStartTime
  }), [
    createManualEntry,
    deleteActiveTimer,
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
    updateActiveEntryFromCalendar,
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
