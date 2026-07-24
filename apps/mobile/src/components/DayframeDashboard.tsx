import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  Easing,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from "react-native-svg";
import { router, useFocusEffect, useIsFocused } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { paletteColorFor, type RecentActivitySuggestion } from "@dayframe/shared";
import { DayframeCalendarView } from "../../modules/dayframe-calendar";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { TagMetadata } from "@/components/TagMetadata";
import { DayframeBrand } from "@/components/brand";
import { useKeyboardAccessory, type KeyboardAccessoryField } from "@/components/KeyboardAccessory";
import {
  AuthRequiredError,
  createManualTimeEntry,
  deleteTimeEntry,
  enqueueEvent,
  fetchBootstrap,
  isNetworkTimerError,
  login,
  queueStopTimer,
  readQueue,
  removeQueuedEvent,
  signup,
  startTimer,
  stopTimer,
  syncQueue,
  updateQueuedTimerStart,
  updateTimeEntry,
  type MobileBootstrap,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { handleDayframeUrl } from "@/lib/deepLinks";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import { configureLocationIntelligence } from "@/lib/location/runtime";
import { recordLocationStoreError } from "@/lib/location/store";
import {
  configureHealthKitAutomaticSync,
  friendlyHealthKitError,
  importHealthKitSleep,
  importHealthKitWorkouts,
  isHealthKitAutomaticSyncEnabled,
  reprocessExistingHealthReviewItems,
  startHealthKitChangeObservers,
  type HealthKitChangeSubscription
} from "@/lib/health";
import { syncLiveActivityForEntry } from "@/lib/liveActivity";
import {
  createHistoryDeletionCoordinator
} from "@/lib/historyDeletion";
import {
  buildHistoryDaySections,
  groupHistoryDayEntries,
  historyDayLabel,
  type HistoryDaySection
} from "@/lib/historyPresentation";
import {
  pressable,
  useMobileTheme,
  type MobileStyles,
  type MobileTheme
} from "@/lib/mobileTheme";
import {
  buildNativeCalendarBridgeState,
  routeNativeCalendarOpenEvent,
  routeNativeCalendarRefresh,
  type NativeCalendarActionKind,
  type NativeCalendarEntry
} from "@/lib/nativeCalendarPresentation";
import {
  REVIEW_COPY,
  hasReviewNeededActivityForRange,
  isOpenReviewItem,
  isReviewNeededEntry
} from "@/lib/review";
import { drainNativeShortcutQueue, syncShortcutCatalog } from "@/lib/shortcuts";
import {
  MOBILE_MOTION,
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  scheduleLayoutTransition,
  useReduceMotionPreference,
  useReduceTransparencyPreference
} from "@/lib/motion";
import {
  activeTimerElapsedSeconds,
  activeTimerPresentation,
  applySuggestionToRunningTimer,
  buildMobileQuickActions,
  displayTimerDescription,
  mobileTimeEntryById,
  optimisticDeleteTimeEntry,
  optimisticPatchTimeEntry,
  optimisticRestoreTimeEntries,
  optimisticStartTimer,
  optimisticStopActiveTimer,
  OPTIMISTIC_TIMER_ID_PREFIX,
  replaceOptimisticTimeEntryId,
  sortMobileCategoriesByUsage
} from "@/lib/timerPresentation";

type TimeEntry = MobileBootstrap["entries"][number];
type AuthView = "login" | "signup";
type AuthState = "checking" | "authenticated" | "signedOut";
export type DayframeDashboardTab = "timer" | "calendar" | "reports";
type ReportRange = "today" | "week";
type ReportChartView = "pie" | "bars";
type SummarySegment = {
  key: string;
  categoryName: string;
  seconds: number;
  share: number;
  color: string;
  isUncategorized: boolean;
};
const AUTH_KEYBOARD_ACCESSORY_ID = "dayframe-auth-keyboard-accessory";
const RECENT_LAST_STOP_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_DELETE_ACTION_BUTTON_WIDTH = 64;
const HISTORY_DELETE_ACTION_GAP = 14;
const HISTORY_DELETE_ACTION_WIDTH = HISTORY_DELETE_ACTION_BUTTON_WIDTH + HISTORY_DELETE_ACTION_GAP;

type DashboardContextValue = {
  renderTab: (tab: DayframeDashboardTab, isFocused: boolean) => ReactNode;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

// Native tabs mount their routes eagerly. Keep sync, HealthKit and timer state in one shared owner.
export function DayframeDashboardProvider({ children }: { children: ReactNode }) {
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDateKey(new Date()));
  const [reportRange, setReportRange] = useState<ReportRange>("today");
  const [calendarEditEntry, setCalendarEditEntry] = useState<NativeCalendarEntry | null>(null);
  const [calendarTransitionDirection, setCalendarTransitionDirection] = useState(1);
  const [reportChartView, setReportChartView] = useState<ReportChartView>("pie");
  const [authView, setAuthView] = useState<AuthView>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authWorkspace, setAuthWorkspace] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [manualDraftEntry, setManualDraftEntry] = useState<TimeEntry | null>(null);
  const [manualEntrySaving, setManualEntrySaving] = useState(false);
  const [activeEditVisible, setActiveEditVisible] = useState(false);
  const [presentedActiveEntry, setPresentedActiveEntry] = useState<TimeEntry | null>(null);
  const [pendingHistoryDeletion, setPendingHistoryDeletion] = useState<{
    entries: TimeEntry[];
    snapshot: MobileBootstrap | null;
    token: number;
  } | null>(null);
  const reduceMotion = useReduceMotionPreference();
  const reduceTransparency = useReduceTransparencyPreference();
  const refreshInFlight = useRef(false);
  const queueSyncInFlight = useRef(false);
  const healthAutoSyncInFlight = useRef(false);
  const latestData = useRef<MobileBootstrap | null>(null);
  const liveActivityReconciliationDeferred = useRef(false);
  const optimisticTimerIds = useRef(new Map<string, string>());
  const optimisticTimerSequence = useRef(0);
  const pendingNativeShortcutLocalIds = useRef<Set<string>>(new Set());
  const timerMutationChain = useRef<Promise<void>>(Promise.resolve());
  const timerMutationCount = useRef(0);
  const timerMutationVersions = useRef(new Map<string, number>());
  const historyDeletionCoordinator = useRef<ReturnType<typeof createHistoryDeletionCoordinator<
    TimeEntry,
    MobileBootstrap | null
  >> | null>(null);
  const activeEditorOpenFrame = useRef<number | null>(null);
  const entrance = useRef(new Animated.Value(0)).current;
  const activeTimerExpansion = useRef(new Animated.Value(0)).current;
  const authNameRef = useRef<TextInput>(null);
  const authWorkspaceRef = useRef<TextInput>(null);
  const authEmailRef = useRef<TextInput>(null);
  const authPasswordRef = useRef<TextInput>(null);

  const changeReportRange = useCallback((nextRange: ReportRange) => {
    scheduleLayoutTransition(reduceMotion);
    setReportRange(nextRange);
  }, [reduceMotion]);

  const changeReportChart = useCallback((nextView: ReportChartView) => {
    scheduleLayoutTransition(reduceMotion);
    setReportChartView(nextView);
  }, [reduceMotion]);

  const syncQueuedEvents = useCallback(async () => {
    if (queueSyncInFlight.current) return null;
    queueSyncInFlight.current = true;
    try {
      const nativeDrain = await drainNativeShortcutQueue();
      for (const localId of nativeDrain.transferredLocalIds) {
        pendingNativeShortcutLocalIds.current.add(localId);
      }
      const syncResult = await syncQueue();
      for (const localId of syncResult.synced) {
        pendingNativeShortcutLocalIds.current.delete(localId);
      }
      const hasRemainingShortcutEvents = syncResult.remaining.some((event) => event.source === "shortcut");
      if (hasRemainingShortcutEvents) {
        liveActivityReconciliationDeferred.current = true;
      } else if (pendingNativeShortcutLocalIds.current.size === 0) {
        liveActivityReconciliationDeferred.current = false;
      }
      return syncResult;
    } finally {
      queueSyncInFlight.current = false;
    }
  }, []);

  const load = useCallback(async (options?: { silent?: boolean; visibleRefresh?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (options?.visibleRefresh) setRefreshing(true);
    try {
      const date = formatDateKey(new Date());
      let bootstrap = await fetchBootstrap({ date });
      const nativeDrain = await drainNativeShortcutQueue();
      for (const localId of nativeDrain.transferredLocalIds) {
        pendingNativeShortcutLocalIds.current.add(localId);
      }
      if (nativeDrain.transferredCount > 0 || pendingNativeShortcutLocalIds.current.size > 0) {
        liveActivityReconciliationDeferred.current = true;
        const syncResult = await syncQueue();
        for (const localId of syncResult.synced) {
          pendingNativeShortcutLocalIds.current.delete(localId);
        }
        const hasRemainingShortcutEvents = syncResult.remaining.some((event) => event.source === "shortcut");
        if (pendingNativeShortcutLocalIds.current.size === 0 && !hasRemainingShortcutEvents) {
          bootstrap = await fetchBootstrap({ date });
          liveActivityReconciliationDeferred.current = false;
        }
      } else {
        const pendingQueue = await readQueue().catch(() => []);
        liveActivityReconciliationDeferred.current = pendingQueue.some((event) => event.source === "shortcut");
      }
      latestData.current = bootstrap;
      setData(bootstrap);
      syncShortcutCatalog(bootstrap);
      setAuthState("authenticated");
      void refreshLocationServices(bootstrap);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setData(null);
        setAuthState("signedOut");
        return;
      }
      if (!options?.silent && !options?.visibleRefresh) {
        Alert.alert("Dayframe API", error instanceof Error ? error.message : "Unable to load API");
      }
    } finally {
      refreshInFlight.current = false;
      if (options?.visibleRefresh) setRefreshing(false);
    }
  }, []);

  function updateDashboardData(
    update: (current: MobileBootstrap | null) => MobileBootstrap | null
  ) {
    setData((current) => {
      const next = update(current);
      latestData.current = next;
      return next;
    });
  }

  function nextTimerMutationVersion(entryId: string) {
    const next = (timerMutationVersions.current.get(entryId) ?? 0) + 1;
    timerMutationVersions.current.set(entryId, next);
    return next;
  }

  function isCurrentTimerMutation(entryId: string, version: number) {
    return timerMutationVersions.current.get(entryId) === version;
  }

  function persistedTimerEntryId(entryId: string) {
    if (!entryId.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)) return entryId;
    return optimisticTimerIds.current.get(entryId) ?? null;
  }

  function enqueueTimerMutation(operation: () => Promise<void>) {
    timerMutationCount.current += 1;
    const run = timerMutationChain.current
      .catch(() => undefined)
      .then(operation)
      .catch(() => undefined);
    timerMutationChain.current = run;
    void run.finally(() => {
      timerMutationCount.current = Math.max(0, timerMutationCount.current - 1);
      if (timerMutationCount.current === 0) void load({ silent: true });
    });
  }

  const syncQueuedEventsAndReload = useCallback(async () => {
    if (authState !== "authenticated") return;
    try {
      await syncQueuedEvents();
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setData(null);
        setAuthState("signedOut");
      }
    }
  }, [authState, load, syncQueuedEvents]);

  const syncHealthKitAndReload = useCallback(async (reason: "foreground" | "observer" = "foreground") => {
    if (authState !== "authenticated" || healthAutoSyncInFlight.current) return;

    let enabled = await isHealthKitAutomaticSyncEnabled().catch(() => false);
    if (!enabled) {
      enabled = await configureHealthKitAutomaticSync().catch(() => false);
    }
    if (!enabled) return;

    healthAutoSyncInFlight.current = true;
    try {
      await importHealthKitSleep();
      await importHealthKitWorkouts();
      await syncQueuedEvents();
      await reprocessExistingHealthReviewItems(undefined, { force: reason === "observer" });
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setData(null);
        setAuthState("signedOut");
        return;
      }
      console.warn(friendlyHealthKitError(error, "sync Apple Health"));
    } finally {
      healthAutoSyncInFlight.current = false;
    }
  }, [authState, load, syncQueuedEvents]);

  useEffect(() => {
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [entrance, reduceMotion]);

  useEffect(() => () => {
    if (activeEditorOpenFrame.current !== null) cancelAnimationFrame(activeEditorOpenFrame.current);
    historyDeletionCoordinator.current?.dispose();
  }, []);

  useEffect(() => {
    if (AppState.currentState === "active") {
      void load();
      return undefined;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      subscription.remove();
      void load();
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    if (authState !== "authenticated") return undefined;
    let mounted = true;
    let subscription: HealthKitChangeSubscription | null = null;

    void (async () => {
      await syncHealthKitAndReload("foreground");
      if (!mounted) return;

      const nextSubscription = await startHealthKitChangeObservers((_type, errorMessage) => {
        if (errorMessage) console.warn(`HealthKit observer update failed: ${errorMessage}`);
        void syncHealthKitAndReload("observer");
      });
      if (!mounted) {
        nextSubscription?.remove();
        return;
      }
      subscription = nextSubscription;
    })()
      .catch(() => undefined);

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [authState, syncHealthKitAndReload]);

  useFocusEffect(
    useCallback(() => {
      void reloadThemePreference();
      if (AppState.currentState !== "active") return;
      if (authState === "authenticated") {
        void syncQueuedEventsAndReload();
      } else {
        void load({ silent: true });
      }
    }, [authState, load, reloadThemePreference, syncQueuedEventsAndReload])
  );

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (authState !== "signedOut") void load({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, [authState, load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && authState === "authenticated") {
        void syncHealthKitAndReload("foreground");
        void syncQueuedEventsAndReload();
      }
    });
    return () => subscription.remove();
  }, [authState, syncHealthKitAndReload, syncQueuedEventsAndReload]);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", async ({ url }) => {
      await handleDayframeUrl(url);
    });
    Linking.getInitialURL().then(async (url) => {
      if (!url) return;
      await handleDayframeUrl(url);
    });
    return () => subscription.remove();
  }, []);

  const quickActions = useMemo(() => buildMobileQuickActions(data), [data]);
  const sortedCategories = useMemo(
    () => sortMobileCategoriesByUsage(data?.categories ?? [], data?.categoryUsage ?? []).map(({ category }) => category),
    [data?.categories, data?.categoryUsage]
  );
  const authKeyboardFields = useMemo<KeyboardAccessoryField[]>(() => (
    authView === "signup"
      ? [
        { id: "auth-name", ref: authNameRef },
        { id: "auth-workspace", ref: authWorkspaceRef },
        { id: "auth-email", ref: authEmailRef },
        { id: "auth-password", ref: authPasswordRef }
      ]
      : [
        { id: "auth-email", ref: authEmailRef },
        { id: "auth-password", ref: authPasswordRef }
      ]
  ), [authView]);
  const authKeyboard = useKeyboardAccessory({
    nativeID: AUTH_KEYBOARD_ACCESSORY_ID,
    fields: authKeyboardFields,
    theme
  });
  const activeEntryForDisplay = data?.activeEntry ?? null;
  const activeDurationSeconds = activeTimerElapsedSeconds(activeEntryForDisplay, now);
  const hasLiveActiveTimer = Boolean(activeEntryForDisplay);

  useEffect(() => {
    if (activeEntryForDisplay) {
      setPresentedActiveEntry(activeEntryForDisplay);
      return undefined;
    }

    if (reduceMotion) {
      setPresentedActiveEntry(null);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setPresentedActiveEntry(null);
    }, MOBILE_MOTION.layout + 80);
    return () => clearTimeout(timeout);
  }, [activeEntryForDisplay, reduceMotion]);

  useEffect(() => {
    const toValue = hasLiveActiveTimer ? 1 : 0;
    if (reduceMotion) {
      activeTimerExpansion.setValue(toValue);
      return undefined;
    }
    const animation = Animated.timing(activeTimerExpansion, {
      toValue,
      duration: MOBILE_MOTION.layout,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    });
    animation.start();
    return () => animation.stop();
  }, [activeTimerExpansion, hasLiveActiveTimer, reduceMotion]);

  const activeTimerDetailsStyle = {
    opacity: activeTimerExpansion,
    maxHeight: activeTimerExpansion.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 96]
    })
  };
  const activeTimerActionsStyle = {
    opacity: activeTimerExpansion,
    transform: [
      {
        scale: activeTimerExpansion.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1]
        })
      }
    ]
  };
  const displayedActiveEntry = activeEntryForDisplay ?? presentedActiveEntry;
  const displayedActiveDurationSeconds = displayedActiveEntry && activeEntryForDisplay
    ? activeDurationSeconds
    : activeTimerElapsedSeconds(displayedActiveEntry, now);
  const todayKey = useMemo(() => formatDateKey(new Date(now)), [now]);
  const historySourceEntries = useMemo(() => {
    if (!data) return [];
    return mergeActiveEntry(
      dedupeEntriesById([
        ...(data.historyEntries ?? data.entries ?? []),
        ...(data.entries ?? []),
        ...(data.weekEntries ?? []),
        ...(data.dayEntries ?? [])
      ]),
      data.activeEntry
    );
  }, [data]);
  const historySections = useMemo(
    () => buildHistoryDaySections({
      entries: historySourceEntries.filter((entry) => !isReviewNeededEntry(entry)),
      nowMs: now
    }),
    [historySourceEntries, now]
  );
  const openReviewCount = useMemo(
    () => (data?.reviewItems ?? []).filter(isOpenReviewItem).length,
    [data?.reviewItems]
  );
  const activeCategoryColor = displayedActiveEntry?.categoryName
    ? paletteColorFor(
        displayedActiveEntry.categoryColor ?? displayedActiveEntry.categoryId,
        displayedActiveEntry.categoryName,
        theme.mode
      )
    : null;
  const activeTimerCopy = activeTimerPresentation(displayedActiveEntry ?? null);
  const activeCategoryLabel = activeTimerCopy.categoryLabel;
  const activeTitle = activeTimerCopy.title;
  const activeTitleIsPlaceholder = Boolean(displayedActiveEntry) && !displayTimerDescription(displayedActiveEntry);
  const recentStoppedAt = useMemo(
    () => recentStoppedEntryTime(data?.entries ?? [], data?.activeEntry ?? null),
    [data?.activeEntry, data?.entries]
  );
  const nativeCalendarBridge = useMemo(
    () => buildNativeCalendarBridgeState({
      data,
      now,
      reduceMotion,
      reduceTransparency,
      refreshing,
      selectedDayKey,
      theme,
      transitionDirection: calendarTransitionDirection
    }),
    [
      calendarTransitionDirection,
      data,
      now,
      reduceMotion,
      reduceTransparency,
      refreshing,
      selectedDayKey,
      theme
    ]
  );
  const reports = useMemo(
    () => buildReports(data, reportRange, todayKey, now, theme.mode),
    [data, now, reportRange, theme.mode, todayKey]
  );
  const compactTaskSuggestions = useMemo(
    () => (data?.taskSuggestions ?? []).slice(0, 6),
    [data?.taskSuggestions]
  );
  useEffect(() => {
    if (!activeEntryForDisplay && activeEditVisible) {
      setActiveEditVisible(false);
    }
  }, [activeEditVisible, activeEntryForDisplay]);

  useEffect(() => {
    if (liveActivityReconciliationDeferred.current) return;
    void syncLiveActivityForEntry(data?.activeEntry ?? null);
  }, [data]);

  async function startTask(categoryId?: string | null, description = "", tagNames: string[] = []) {
    if (latestData.current?.activeEntry && !categoryId && !description.trim()) {
      setActiveEditVisible(true);
      return false;
    }
    if (!categoryId && !description.trim()) {
      const ok = await startTaskWith(
        {
          categoryId: null,
          description: null,
          startedAt: null
        },
        { animateLayout: false }
      );
      if (ok) {
        if (activeEditorOpenFrame.current !== null) {
          cancelAnimationFrame(activeEditorOpenFrame.current);
        }
        activeEditorOpenFrame.current = requestAnimationFrame(() => {
          activeEditorOpenFrame.current = null;
          setActiveEditVisible(true);
        });
      }
      return ok;
    }
    return startTaskWith({
      categoryId: categoryId ?? null,
      description,
      startedAt: null,
      tagNames
    });
  }

  function startBlankTask() {
    void startTask(null);
  }

  function openManualEntry() {
    if (latestData.current?.activeEntry) {
      setActiveEditVisible(true);
      return;
    }
    setManualDraftEntry(createManualDraftEntry(recentStoppedAt, now));
  }

  async function saveManualEntry(_entryId: string, patch: TimeEntryUpdatePatch) {
    if (!patch.startedAt || !patch.stoppedAt || manualEntrySaving) return false;
    setManualEntrySaving(true);
    try {
      await createManualTimeEntry({
        categoryId: patch.categoryId ?? null,
        description: patch.description ?? null,
        startedAt: patch.startedAt,
        stoppedAt: patch.stoppedAt,
        tagNames: patch.tagNames
      });
      await load({ silent: true });
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        latestData.current = null;
        setAuthState("signedOut");
        setData(null);
        return false;
      }
      Alert.alert(
        "Time not added",
        error instanceof Error ? error.message : "Unable to add this time entry."
      );
      return false;
    } finally {
      setManualEntrySaving(false);
    }
  }

  async function applyRunningTimerSuggestion(entryId: string, suggestion: RecentActivitySuggestion) {
    const activeEntry = latestData.current?.activeEntry;
    if (!activeEntry || activeEntry.id !== entryId) return false;
    const patch: TimeEntryUpdatePatch = {
      categoryId: suggestion.categoryId,
      description: suggestion.description
    };
    const previousData = latestData.current;
    const version = nextTimerMutationVersion(entryId);
    updateDashboardData((current) => optimisticPatchTimeEntry(current, entryId, patch));
    enqueueTimerMutation(async () => {
      try {
        const persistedId = persistedTimerEntryId(entryId);
        if (persistedId) {
          await applySuggestionToRunningTimer({
            entryId: persistedId,
            suggestion,
            updateEntry: updateTimeEntry
          });
        } else {
          await updateQueuedTimerStart(entryId, patch);
        }
      } catch (error) {
        if (isCurrentTimerMutation(entryId, version)) {
          latestData.current = previousData;
          setData(previousData);
        }
        if (error instanceof AuthRequiredError) {
          latestData.current = null;
          setAuthState("signedOut");
          setData(null);
          return;
        }
        Alert.alert(
          "Timer not saved",
          isNetworkTimerError(error)
            ? "Your timer details were not saved. Check your connection and try again."
            : error instanceof Error ? error.message : "Unable to save this timer."
        );
      }
    });
    return true;
  }

  async function startTaskWith(input: {
    categoryId?: string | null;
    description?: string | null;
    startedAt?: string | null;
    tagNames?: string[];
  }, options: { animateLayout?: boolean } = {}) {
    const trimmedDescription = input.description?.trim() ?? "";
    const startedAt = input.startedAt ?? new Date().toISOString();
    optimisticTimerSequence.current += 1;
    const optimisticId = `${OPTIMISTIC_TIMER_ID_PREFIX}${Date.now()}:${optimisticTimerSequence.current}`;
    const pendingEntry = {
      ...pendingEntryFromStartInput({
        categories: latestData.current?.categories ?? [],
        categoryId: input.categoryId ?? null,
        description: trimmedDescription || null,
        startedAt,
        tagNames: input.tagNames ?? []
      }),
      id: optimisticId
    };
    const previousData = latestData.current;
    nextTimerMutationVersion(optimisticId);
    updateDashboardData((current) => optimisticStartTimer(current, pendingEntry));
    if (options.animateLayout !== false) scheduleLayoutTransition(reduceMotion);

    enqueueTimerMutation(async () => {
      try {
        const result = await startTimer(
          input.categoryId ?? null,
          trimmedDescription,
          input.startedAt ?? undefined,
          input.tagNames
        );
        if (result.timeEntryId) {
          optimisticTimerIds.current.set(optimisticId, result.timeEntryId);
          updateDashboardData((current) =>
            replaceOptimisticTimeEntryId(current, optimisticId, result.timeEntryId as string)
          );
        }
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          latestData.current = null;
          setAuthState("signedOut");
          setData(null);
          return;
        }
        if (!isNetworkTimerError(error)) {
          latestData.current = previousData;
          setData(previousData);
          Alert.alert("Timer not started", error instanceof Error ? error.message : "Unable to start this timer.");
          return;
        }
        const queuedEntry = mobileTimeEntryById(latestData.current, optimisticId) ?? pendingEntry;
        await enqueueEvent({
          localId: optimisticId,
          source: "mobile_app",
          type: "timer_start",
          occurredAt: new Date(queuedEntry.startedAt),
          categoryId: queuedEntry.categoryId ?? undefined,
          description: queuedEntry.description?.trim() || undefined,
          rawPayload: {
            origin: "mobile_custom_start_fallback",
            startedAt: queuedEntry.startedAt,
            tagNames: queuedEntry.tagNames ?? queuedEntry.tags?.map((tag) => tag.name) ?? []
          }
        });
      }
    });
    return true;
  }

  async function saveActiveTimerEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    return saveTimeEntryOptimistically(entryId, patch, "Timer not saved");
  }

  async function saveCalendarEntryEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    return saveTimeEntryOptimistically(entryId, patch, "Entry not saved");
  }

  async function saveTimeEntryOptimistically(
    entryId: string,
    patch: TimeEntryUpdatePatch,
    errorTitle: string
  ) {
    const previousData = latestData.current;
    const version = nextTimerMutationVersion(entryId);
    updateDashboardData((current) => optimisticPatchTimeEntry(current, entryId, patch));
    enqueueTimerMutation(async () => {
      try {
        const persistedId = persistedTimerEntryId(entryId);
        if (persistedId) await updateTimeEntry(persistedId, patch);
        else await updateQueuedTimerStart(entryId, patch);
      } catch (error) {
        if (isCurrentTimerMutation(entryId, version)) {
          latestData.current = previousData;
          setData(previousData);
        }
        if (error instanceof AuthRequiredError) {
          latestData.current = null;
          setAuthState("signedOut");
          setData(null);
          return;
        }
        Alert.alert(
          errorTitle,
          isNetworkTimerError(error)
            ? "Your changes were not saved. Check your connection and try again."
            : error instanceof Error ? error.message : "Unable to save this entry."
        );
      }
    });
    return true;
  }

  async function deleteCalendarEntry(entryId: string) {
    return deleteTimeEntryOptimistically(entryId, "Entry not deleted");
  }

  const shiftSelectedCalendarDay = useCallback((days: number) => {
    if (days !== 0) setCalendarTransitionDirection(days > 0 ? 1 : -1);
    setSelectedDayKey((current) => formatDateKey(addDaysToDate(dateFromKey(current), days)));
  }, []);

  const selectCalendarDay = useCallback((dayKey: string) => {
    setSelectedDayKey((current) => {
      const currentTime = dateFromKey(current).getTime();
      const nextTime = dateFromKey(dayKey).getTime();
      if (nextTime !== currentTime) setCalendarTransitionDirection(nextTime > currentTime ? 1 : -1);
      return dayKey;
    });
  }, []);

  const shiftSelectedCalendarWeek = useCallback((weeks: number) => {
    shiftSelectedCalendarDay(weeks * 7);
  }, [shiftSelectedCalendarDay]);

  async function stopActiveTimer() {
    const activeEntry = latestData.current?.activeEntry;
    if (!activeEntry) return false;
    const previousData = latestData.current;
    const version = nextTimerMutationVersion(activeEntry.id);
    updateDashboardData((current) => optimisticStopActiveTimer(current, new Date().toISOString()));
    scheduleLayoutTransition(reduceMotion);
    enqueueTimerMutation(async () => {
      try {
        const persistedId = persistedTimerEntryId(activeEntry.id);
        if (activeEntry.id.startsWith(OPTIMISTIC_TIMER_ID_PREFIX) && !persistedId) {
          await queueStopTimer();
        } else {
          await stopTimer();
        }
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          latestData.current = null;
          setActiveEditVisible(false);
          setAuthState("signedOut");
          setData(null);
          return;
        }
        if (isNetworkTimerError(error)) {
          await queueStopTimer();
          return;
        }
        if (isCurrentTimerMutation(activeEntry.id, version)) {
          latestData.current = previousData;
          setData(previousData);
        }
        Alert.alert("Timer not stopped", error instanceof Error ? error.message : "Unable to stop this timer.");
      }
    });
    return true;
  }

  async function deleteActiveTimer(entryId: string) {
    scheduleLayoutTransition(reduceMotion);
    return deleteTimeEntryOptimistically(entryId, "Timer not deleted");
  }

  async function deleteTimeEntryOptimistically(entryId: string, errorTitle: string) {
    const previousData = latestData.current;
    const version = nextTimerMutationVersion(entryId);
    updateDashboardData((current) => optimisticDeleteTimeEntry(current, entryId));
    enqueueTimerMutation(async () => {
      try {
        const persistedId = persistedTimerEntryId(entryId);
        if (persistedId) await deleteTimeEntry(persistedId);
        else await removeQueuedEvent(entryId);
      } catch (error) {
        if (isCurrentTimerMutation(entryId, version)) {
          latestData.current = previousData;
          setData(previousData);
        }
        if (error instanceof AuthRequiredError) {
          latestData.current = null;
          setAuthState("signedOut");
          setData(null);
          return;
        }
        Alert.alert(errorTitle, error instanceof Error ? error.message : "Unable to delete this entry.");
      }
    });
    return true;
  }

  function commitHistoryDeletion(entries: TimeEntry[], snapshot: MobileBootstrap | null) {
    const versions = new Map(entries.map((entry) => [entry.id, nextTimerMutationVersion(entry.id)]));
    enqueueTimerMutation(async () => {
      try {
        for (const entry of entries) {
          const persistedId = persistedTimerEntryId(entry.id);
          if (persistedId) await deleteTimeEntry(persistedId);
          else await removeQueuedEvent(entry.id);
        }
      } catch (error) {
        const currentIds = entries
          .filter((entry) => isCurrentTimerMutation(entry.id, versions.get(entry.id) as number))
          .map((entry) => entry.id);
        updateDashboardData((current) => optimisticRestoreTimeEntries(current, snapshot, currentIds));
        if (error instanceof AuthRequiredError) {
          latestData.current = null;
          setAuthState("signedOut");
          setData(null);
          return;
        }
        Alert.alert(
          entries.length > 1 ? "Entries not deleted" : "Entry not deleted",
          error instanceof Error ? error.message : "Unable to delete the selected time entries."
        );
        AccessibilityInfo.announceForAccessibility(
          entries.length > 1 ? "Time entries restored because deletion failed." : "Time entry restored because deletion failed."
        );
      }
    });
  }

  function getHistoryDeletionCoordinator() {
    if (!historyDeletionCoordinator.current) {
      historyDeletionCoordinator.current = createHistoryDeletionCoordinator<
        TimeEntry,
        MobileBootstrap | null
      >({
        onCommit: ({ entries, snapshot }) => commitHistoryDeletion(entries, snapshot),
        onPendingChange: setPendingHistoryDeletion,
        onRestore: ({ entries, snapshot }) => {
          updateDashboardData((current) => optimisticRestoreTimeEntries(
            current,
            snapshot,
            entries.map((entry) => entry.id)
          ));
        }
      });
    }
    return historyDeletionCoordinator.current;
  }

  function scheduleHistoryDeletion(entries: TimeEntry[]) {
    const snapshot = latestData.current;
    const entryIds = entries.map((entry) => entry.id);
    const optimisticData = entryIds.reduce(optimisticDeleteTimeEntry, snapshot);
    latestData.current = optimisticData;
    setData(optimisticData);
    getHistoryDeletionCoordinator().begin(entries, snapshot);
    AccessibilityInfo.announceForAccessibility(
      entries.length > 1
        ? `${entries.length} time entries deleted. Undo available for five seconds.`
        : "Time entry deleted. Undo available for five seconds."
    );
  }

  function undoHistoryDeletion() {
    if (!pendingHistoryDeletion) return;
    if (getHistoryDeletionCoordinator().undo(pendingHistoryDeletion.token)) {
      AccessibilityInfo.announceForAccessibility(
        pendingHistoryDeletion.entries.length > 1 ? "Time entries restored." : "Time entry restored."
      );
    }
  }

  async function submitAuth() {
    setAuthError(null);
    setAuthNotice(null);
    setAuthSubmitting(true);
    try {
      const auth = authView === "signup"
        ? await signup(
          authEmail,
          authPassword,
          authName.trim() || undefined,
          authWorkspace.trim() || undefined
        )
        : await login(authEmail, authPassword);
      if ("requiresEmailConfirmation" in auth) {
        setAuthPassword("");
        setAuthNotice(auth.message);
        setAuthView("login");
        setAuthState("signedOut");
        return;
      }
      setAuthPassword("");
      await load();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate");
      setAuthState("signedOut");
    } finally {
      setAuthSubmitting(false);
    }
  }

  const enteringStyle = {
    opacity: entrance,
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0]
        })
      }
    ]
  };
  if (authState === "signedOut") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logoLockup}>
              <DayframeBrand
                layout="horizontal"
                size="md"
                tone={theme.mode === "dark" ? "light" : "dark"}
              />
            </View>
          </View>
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{authView === "signup" ? "Create account" : "Log in"}</Text>
            <Text style={styles.muted}>
              Use your Dayframe account to sync timers, location events and Apple Health imports with your workspace.
            </Text>
            {authView === "signup" ? (
              <>
                <TextInput
                  ref={authNameRef}
                  style={styles.textInput}
                  value={authName}
                  onChangeText={setAuthName}
                  onSubmitEditing={authKeyboard.focusNext}
                  placeholder="Name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  {...authKeyboard.getTextInputProps("auth-name")}
                />
                <TextInput
                  ref={authWorkspaceRef}
                  style={styles.textInput}
                  value={authWorkspace}
                  onChangeText={setAuthWorkspace}
                  onSubmitEditing={authKeyboard.focusNext}
                  placeholder="Workspace"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  {...authKeyboard.getTextInputProps("auth-workspace")}
                />
              </>
            ) : null}
            <TextInput
              ref={authEmailRef}
              style={styles.textInput}
              value={authEmail}
              onChangeText={setAuthEmail}
              onSubmitEditing={authKeyboard.focusNext}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              blurOnSubmit={false}
              {...authKeyboard.getTextInputProps("auth-email")}
            />
            <TextInput
              ref={authPasswordRef}
              style={styles.textInput}
              value={authPassword}
              onChangeText={setAuthPassword}
              onSubmitEditing={submitAuth}
              placeholder="Password"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              secureTextEntry
              textContentType={authView === "signup" ? "newPassword" : "password"}
              {...authKeyboard.getTextInputProps("auth-password")}
            />
            {authNotice ? <Text style={styles.statusText}>{authNotice}</Text> : null}
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Pressable style={pressable(styles.primaryButton, styles.buttonPressed)} onPress={submitAuth}>
              <Text style={styles.primaryButtonText}>
                {authSubmitting ? "Working..." : authView === "signup" ? "Create account" : "Log in"}
              </Text>
            </Pressable>
            <Pressable
              style={pressable([styles.secondaryButton, styles.authSecondaryButton], styles.buttonPressed)}
              onPress={() => {
                setAuthError(null);
                setAuthView(authView === "signup" ? "login" : "signup");
              }}
            >
              <Text style={[styles.secondaryButtonText, styles.authSecondaryButtonText]}>
                {authView === "signup" ? "Use existing account" : "Create account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        {authKeyboard.accessory}
      </SafeAreaView>
    );
  }

  function renderTodayTab(isFocused: boolean) {
    const currentDate = new Date(now);
    return (
      <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
        <Reanimated.FlatList
          contentContainerStyle={[styles.container, styles.todayListContent]}
          data={historySections}
          itemLayoutAnimation={localLayoutTransition(reduceMotion)}
          keyExtractor={(section) => section.key}
          refreshControl={
            <RefreshControl
              refreshing={isFocused && refreshing}
              onRefresh={() => load({ visibleRefresh: true })}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
          ListHeaderComponent={(
            <Animated.View style={[styles.contentStack, enteringStyle, styles.todayListHeader]}>
              <View style={styles.header}>
                <View style={styles.logoLockup}>
                  <DayframeBrand
                    layout="horizontal"
                    size="md"
                    tone={theme.mode === "dark" ? "light" : "dark"}
                  />
                </View>
                <Pressable
                  accessibilityLabel="Open settings"
                  accessibilityRole="button"
                  style={pressable(styles.iconButton, styles.buttonPressed)}
                  onPress={() => router.push("/settings")}
                >
                  <SettingsGlyph color={theme.accent} />
                </Pressable>
              </View>

              <View style={styles.todayHeading}>
                <Text style={styles.todayTitle}>Today</Text>
                <Text style={styles.todaySubtitle}>{formatLongDay(currentDate)}</Text>
              </View>

              {displayedActiveEntry ? (
                <Pressable
                  accessibilityLabel={hasLiveActiveTimer ? "Edit running timer" : undefined}
                  accessibilityRole={hasLiveActiveTimer ? "button" : undefined}
                  disabled={!hasLiveActiveTimer}
                  onPress={() => setActiveEditVisible(true)}
                  style={({ pressed }) => [
                    styles.timerPanel,
                    pressed && hasLiveActiveTimer ? styles.buttonPressed : null
                  ]}
                >
                  {activeCategoryColor ? (
                    <View
                      pointerEvents="none"
                      style={[styles.activeTimerAccentRail, { backgroundColor: activeCategoryColor }]}
                    />
                  ) : null}
                  <View style={styles.activeTimerHeader}>
                    <View style={styles.activeTimerTextStack}>
                      <View style={styles.activeTitleRow}>
                        {activeCategoryColor ? (
                          <View style={[styles.colorDot, { backgroundColor: activeCategoryColor }]} />
                        ) : null}
                        <Text
                          style={[
                            styles.timerText,
                            styles.activeTitleText,
                            activeTitleIsPlaceholder ? styles.activeTitlePlaceholderText : null
                          ]}
                          numberOfLines={2}
                        >
                          {activeTitle}
                        </Text>
                      </View>
                      <Animated.View style={[styles.activeTimerExpandedContent, activeTimerDetailsStyle]}>
                        {activeCategoryLabel ? (
                          <Text style={styles.activeDescription}>{activeCategoryLabel}</Text>
                        ) : null}
                        <Text style={styles.activeElapsed}>{formatClockDuration(displayedActiveDurationSeconds)}</Text>
                      </Animated.View>
                    </View>
                    <Animated.View
                      pointerEvents={hasLiveActiveTimer ? "auto" : "none"}
                      style={[styles.activeTimerActions, activeTimerActionsStyle]}
                    >
                      <Pressable
                        accessibilityLabel="Stop current timer"
                        accessibilityRole="button"
                        style={pressable(styles.stopButton, styles.buttonPressed)}
                        onPress={(event) => {
                          event.stopPropagation();
                          void stopActiveTimer();
                        }}
                      >
                        <StopGlyph color={theme.onAccent} />
                      </Pressable>
                    </Animated.View>
                  </View>
                </Pressable>
              ) : (
                <View style={styles.panel}>
                  <View style={styles.startInputRow}>
                    <View style={styles.startComposerMain}>
                      <Pressable
                        accessibilityLabel="Start timer and add details"
                        accessibilityRole="button"
                        style={pressable([styles.textInput, styles.startInput], styles.buttonPressed)}
                        onPress={startBlankTask}
                      >
                        <Text style={styles.startInputText} numberOfLines={1}>What are you working on?</Text>
                      </Pressable>
                      <ScrollView
                        accessibilityLabel="Quick actions"
                        horizontal
                        keyboardShouldPersistTaps="handled"
                        showsHorizontalScrollIndicator={false}
                        style={styles.quickActionsInline}
                        contentContainerStyle={styles.compactCategoryScroller}
                      >
                        {quickActions.map((action) => {
                          const categoryColor = action.isUncategorized
                            ? null
                            : paletteColorFor(action.color, action.subtitle ?? action.name, theme.mode);
                          return (
                            <Pressable
                              key={action.key}
                              accessibilityRole="button"
                              accessibilityLabel={`Start ${action.name}`}
                              style={pressable(styles.categoryPillTouch, styles.buttonPressed)}
                              onPress={() => {
                                void startTask(action.id, action.description ?? "");
                              }}
                            >
                              <View
                                style={[
                                  styles.categoryPill,
                                  categoryColor
                                    ? { backgroundColor: colorWithAlpha(categoryColor, theme.mode === "dark" ? 0.18 : 0.13) }
                                    : styles.categoryPillMuted
                                ]}
                              >
                                <View
                                  style={[
                                    styles.colorDot,
                                    categoryColor ? { backgroundColor: categoryColor } : styles.colorDotMuted
                                  ]}
                                />
                                <Text style={styles.categoryPillText} numberOfLines={1}>{action.name}</Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                    <View style={styles.startActionColumn}>
                      <Pressable
                        accessibilityLabel="Start task"
                        accessibilityRole="button"
                        style={pressable(styles.playButton, styles.buttonPressed)}
                        onPress={startBlankTask}
                      >
                        <PlayGlyph color={theme.onAccent} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel="Add past time"
                        accessibilityRole="button"
                        style={pressable(styles.addPastTimeButton, styles.buttonPressed)}
                        onPress={openManualEntry}
                      >
                        <PlusGlyph color={theme.accentText} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}
            </Animated.View>
          )}
          renderItem={({ item }) => (
            <HistoryDayCard
              activeTimerRunning={Boolean(displayedActiveEntry)}
              now={now}
              onDeleteEntries={scheduleHistoryDeletion}
              onOpenEntry={(entry) => {
                if (!entry.stoppedAt) {
                  setActiveEditVisible(true);
                  return;
                }
                setCalendarEditEntry({ ...entry, isActive: false });
              }}
              onOpenReview={() => router.push("/review")}
              onReplayEntry={(entry) => {
                void startTask(
                  entry.categoryId,
                  entry.description ?? "",
                  entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []
                );
              }}
              reviewCount={item.isToday ? openReviewCount : 0}
              section={item}
              styles={styles}
              theme={theme}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.historyDayGap} />}
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    );
  }

  function renderDashboardTab(tab: DayframeDashboardTab, isFocused: boolean) {
    if (tab === "timer") return renderTodayTab(isFocused);
    if (tab === "calendar") {
      const routeOpenEvent = (kind: NativeCalendarActionKind, actionId: string) => {
        routeNativeCalendarOpenEvent(
          { actionId, kind },
          nativeCalendarBridge.actionEntries,
          {
            onOpenActive: () => {
              setCalendarEditEntry(null);
              setActiveEditVisible(true);
            },
            onOpenCompleted: setCalendarEditEntry,
            onOpenReview: () => router.push("/review")
          }
        );
      };

      return (
        <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
          <View style={styles.nativeCalendarScreen}>
            <Animated.View style={[styles.nativeCalendarHeader, enteringStyle]}>
              <View style={styles.logoLockup}>
                <DayframeBrand
                  layout="horizontal"
                  size="md"
                  tone={theme.mode === "dark" ? "light" : "dark"}
                />
              </View>
              <Pressable
                accessibilityLabel="Open settings"
                accessibilityRole="button"
                style={pressable(styles.iconButton, styles.buttonPressed)}
                onPress={() => router.push("/settings")}
              >
                <SettingsGlyph color={theme.accent} />
              </Pressable>
            </Animated.View>
            <DayframeCalendarView
              model={{
                ...nativeCalendarBridge.model,
                refreshing: isFocused && refreshing
              }}
              onChangeDay={(event) => shiftSelectedCalendarDay(event.nativeEvent.days)}
              onChangeWeek={(event) => shiftSelectedCalendarWeek(event.nativeEvent.weeks)}
              onOpenActiveTimer={(event) => routeOpenEvent("active", event.nativeEvent.entryId)}
              onOpenCompletedEntry={(event) => routeOpenEvent("completed", event.nativeEvent.entryId)}
              onOpenReviewItem={(event) => routeOpenEvent("review", event.nativeEvent.reviewItemId)}
              onRequestRefresh={() => {
                routeNativeCalendarRefresh(() => {
                  void load({ visibleRefresh: true });
                });
              }}
              onSelectDay={(event) => selectCalendarDay(event.nativeEvent.dayKey)}
              style={styles.nativeCalendarView}
            />
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.container}
          directionalLockEnabled
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isFocused && refreshing}
              onRefresh={() => load({ visibleRefresh: true })}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
        >
          <Animated.View style={[styles.contentStack, enteringStyle]}>
          <View style={styles.header}>
            <View style={styles.logoLockup}>
              <DayframeBrand
                layout="horizontal"
                size="md"
                tone={theme.mode === "dark" ? "light" : "dark"}
              />
            </View>
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => router.push("/settings")}
            >
              <SettingsGlyph color={theme.accent} />
            </Pressable>
          </View>

          <ReportsTab
            chartView={reportChartView}
            dailyBars={reports.dailyBars}
            range={reportRange}
            segments={reports.segments}
            hasSuggestedActivity={reports.hasSuggestedActivity}
            onChartViewChange={changeReportChart}
            styles={styles}
            theme={theme}
            todayTotal={reports.todayTotal}
            weekTotal={reports.weekTotal}
            onRangeChange={changeReportRange}
          />
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <DashboardContext.Provider value={{ renderTab: renderDashboardTab }}>
      {children}
      {pendingHistoryDeletion ? (
        <Reanimated.View
          key={pendingHistoryDeletion.token}
          accessibilityLiveRegion="polite"
          entering={localPresenceEntering(reduceMotion, "rise")}
          exiting={localPresenceExiting(reduceMotion)}
          layout={localLayoutTransition(reduceMotion)}
          style={styles.historyDeleteUndoToast}
        >
          <Text style={styles.historyDeleteUndoText}>
            {pendingHistoryDeletion.entries.length === 1
              ? "Time entry deleted"
              : `${pendingHistoryDeletion.entries.length} time entries deleted`}
          </Text>
          <Pressable
            accessibilityLabel="Undo deleting time entries"
            accessibilityRole="button"
            onPress={undoHistoryDeletion}
            style={({ pressed }) => [styles.historyDeleteUndoButton, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.historyDeleteUndoButtonText}>Undo</Text>
          </Pressable>
        </Reanimated.View>
      ) : null}
      <ActiveTimerEditSheet
        categories={sortedCategories}
        descriptionPlaceholder="What have you been working on?"
        elapsedSeconds={manualDraftEntry?.durationSeconds ?? 0}
        entry={manualDraftEntry}
        lastStoppedAt={recentStoppedAt}
        mode="add"
        onCancel={() => {
          setManualDraftEntry(null);
        }}
        onSave={saveManualEntry}
        saving={manualEntrySaving}
        stopping={false}
        styles={styles}
        tags={data?.tags ?? []}
        theme={theme}
        visible={Boolean(manualDraftEntry)}
      />
      <ActiveTimerEditSheet
        categories={sortedCategories}
        elapsedSeconds={activeDurationSeconds}
        entry={activeEntryForDisplay ?? null}
        lastStoppedAt={recentStoppedAt}
        onApplySuggestion={applyRunningTimerSuggestion}
        onCancel={() => {
          setActiveEditVisible(false);
        }}
        onDelete={deleteActiveTimer}
        onSave={saveActiveTimerEdit}
        onStop={stopActiveTimer}
        deleting={false}
        saving={false}
        stopping={false}
        styles={styles}
        suggestions={compactTaskSuggestions}
        tags={data?.tags ?? []}
        theme={theme}
        visible={activeEditVisible}
      />
      <ActiveTimerEditSheet
        categories={sortedCategories}
        elapsedSeconds={calendarEditEntry ? entryDurationSeconds(calendarEditEntry, now) : 0}
        entry={calendarEditEntry}
        lastStoppedAt={null}
        mode="entry"
        onCancel={() => setCalendarEditEntry(null)}
        onDelete={deleteCalendarEntry}
        onSave={saveCalendarEntryEdit}
        deleting={false}
        saving={false}
        stopping={false}
        styles={styles}
        tags={data?.tags ?? []}
        theme={theme}
        visible={Boolean(calendarEditEntry)}
      />
    </DashboardContext.Provider>
  );
}

async function refreshLocationServices(bootstrap: MobileBootstrap) {
  try {
    await configureLocationIntelligence(bootstrap);
    await refreshGeofencesForPlaces(bootstrap.places);
  } catch (error) {
    await recordLocationStoreError(error);
  }
}

export function DayframeDashboardScreen({ tab }: { tab: DayframeDashboardTab }) {
  const dashboard = useContext(DashboardContext);
  const isFocused = useIsFocused();
  if (!dashboard) throw new Error("DayframeDashboardScreen must be used within DayframeDashboardProvider");
  return dashboard.renderTab(tab, isFocused);
}

function ReportsTab({
  chartView,
  dailyBars,
  hasSuggestedActivity,
  onChartViewChange,
  onRangeChange,
  range,
  segments,
  styles,
  theme,
  todayTotal,
  weekTotal
}: {
  chartView: ReportChartView;
  dailyBars: Array<{ key: string; label: string; seconds: number }>;
  hasSuggestedActivity: boolean;
  onChartViewChange: (view: ReportChartView) => void;
  onRangeChange: (range: ReportRange) => void;
  range: ReportRange;
  segments: SummarySegment[];
  styles: MobileStyles;
  theme: MobileTheme;
  todayTotal: number;
  weekTotal: number;
}) {
  const maxSegmentSeconds = Math.max(1, ...segments.map((segment) => segment.seconds));
  const maxDailySeconds = Math.max(1, ...dailyBars.map((bar) => bar.seconds));

  return (
    <View style={styles.tabScreenStack}>
      <View style={styles.panel}>
        <Text style={styles.reportScreenTitle}>Reports</Text>
        <View style={styles.reportRangeRow}>
          {(["today", "week"] as const).map((option) => {
            const selected = option === range;
            return (
              <Pressable
                key={option}
                accessibilityLabel={`Show ${option === "today" ? "today" : "this week"} reports`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onRangeChange(option)}
                style={({ pressed }) => [
                  styles.reportRangeChip,
                  selected ? styles.reportRangeChipSelected : null,
                  pressed ? styles.buttonPressed : null
                ]}
              >
                <Text style={[
                  styles.reportRangeChipText,
                  selected ? styles.reportRangeChipTextSelected : null
                ]}>
                  {option === "today" ? "Today" : "Week"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.reportTotalsRow}>
          <View style={styles.reportTotalCard}>
            <Text style={styles.label}>Today total</Text>
            <Text style={styles.reportTotalValue}>{formatDuration(todayTotal)}</Text>
          </View>
          <View style={styles.reportTotalCard}>
            <Text style={styles.label}>This week</Text>
            <Text style={styles.reportTotalValue}>{formatDuration(weekTotal)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.lifecyclePanel}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.label}>Category breakdown</Text>
            <Text style={styles.sectionTitle}>{range === "today" ? "Today" : "This week"}</Text>
          </View>
        </View>
        {hasSuggestedActivity ? (
          <Text style={styles.reviewNote}>{REVIEW_COPY.suggestedNote}</Text>
        ) : null}

        {segments.length === 0 ? (
          <Text style={styles.muted}>No tracked time yet.</Text>
        ) : (
          <>
            <View style={styles.reportChartSwitchRow}>
              {(["pie", "bars"] as const).map((option) => {
                const selected = option === chartView;
                return (
                  <Pressable
                    key={option}
                    accessibilityLabel={`Show category ${option === "pie" ? "pie chart" : "bar chart"}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onChartViewChange(option)}
                    style={({ pressed }) => [
                      styles.reportChartSwitchButton,
                      selected ? styles.reportChartSwitchButtonSelected : null,
                      pressed ? styles.buttonPressed : null
                    ]}
                  >
                    <Text style={[
                      styles.reportChartSwitchText,
                      selected ? styles.reportChartSwitchTextSelected : null
                    ]}>
                      {option === "pie" ? "Pie" : "Bars"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {chartView === "pie" ? (
              <>
                <View style={styles.chartWrap}>
                  <DonutChart progress={1} segments={segments} styles={styles} theme={theme} total={segments.reduce((sum, segment) => sum + segment.seconds, 0)} />
                </View>
                <View style={styles.legendList}>
                  {segments.map((segment) => (
                    <View key={segment.key} style={styles.legendRow}>
                      <SegmentSwatch segment={segment} styles={styles} theme={theme} variant="legend" />
                      <View style={styles.legendText}>
                        <Text style={styles.legendPlace} numberOfLines={1}>{segment.categoryName}</Text>
                        <Text style={styles.legendProject}>Category</Text>
                      </View>
                      <View style={styles.legendNumbers}>
                        <Text style={styles.legendDuration}>{formatDuration(segment.seconds)}</Text>
                        <Text style={styles.legendShare}>{segment.share}%</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.reportCategoryList}>
                {segments.map((segment) => (
                  <View key={segment.key} style={styles.reportCategoryRow}>
                    <SegmentSwatch segment={segment} styles={styles} theme={theme} variant="report" />
                    <View style={styles.reportCategoryBody}>
                      <View style={styles.reportCategoryHeader}>
                        <Text style={styles.legendPlace} numberOfLines={1}>{segment.categoryName}</Text>
                        <Text style={styles.legendDuration}>{formatDuration(segment.seconds)}</Text>
                      </View>
                      <View style={styles.reportBarTrack}>
                        <View
                          style={[
                            styles.reportBarFill,
                            segment.isUncategorized ? styles.reportBarFillUncategorized : null,
                            {
                              backgroundColor: segment.color,
                              width: `${Math.max(4, Math.round((segment.seconds / maxSegmentSeconds) * 100))}%`
                            }
                          ]}
                        />
                      </View>
                      <Text style={styles.legendShare}>{segment.share}%</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      <View style={styles.panel}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.label}>Daily bars</Text>
            <Text style={styles.sectionTitle}>Current week</Text>
          </View>
        </View>
        <View style={styles.reportDailyChart}>
          {dailyBars.map((bar) => (
            <View
              key={bar.key}
              accessibilityLabel={`${bar.label}: ${formatDuration(bar.seconds)}`}
              accessible
              style={styles.reportDailySlot}
            >
              <View style={styles.reportDailyTrack}>
                <View
                  style={[
                    styles.reportDailyFill,
                    {
                      height: `${Math.max(4, Math.round((bar.seconds / maxDailySeconds) * 100))}%`,
                      backgroundColor: bar.seconds > 0 ? theme.accent : theme.borderStrong
                    }
                  ]}
                />
              </View>
              <Text style={styles.reportDailyLabel}>{bar.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function SettingsGlyph({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        d="M4 7h8"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
      />
      <Circle cx={16} cy={7} r={2.5} fill="none" stroke={color} strokeWidth={2} />
      <Path
        d="M20 17h-8"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2}
      />
      <Circle cx={8} cy={17} r={2.5} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function PlayGlyph({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 4v16l13-8L7 4Z" fill={color} />
    </Svg>
  );
}

function PlusGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12h14" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.2} />
    </Svg>
  );
}

function StopGlyph({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Path d="M6 6h12v12H6V6Z" fill={color} />
    </Svg>
  );
}

function TrashGlyph({ color }: { color: string }) {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      <Path d="M4 7h16M10 11v6M14 11v6M9 7l1-2h4l1 2M6 7l1 13h10l1-13" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </Svg>
  );
}

function SwipeDeleteAction({
  accessibilityLabel,
  entry,
  minHeight,
  onDelete,
  styles,
  swipeable,
  theme,
  translation
}: {
  accessibilityLabel: string;
  entry: TimeEntry;
  minHeight: number;
  onDelete: (entry: TimeEntry) => void;
  styles: MobileStyles;
  swipeable: SwipeableMethods;
  theme: MobileTheme;
  translation: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{
      translateX: interpolate(
        translation.value,
        [-HISTORY_DELETE_ACTION_WIDTH, 0],
        [0, HISTORY_DELETE_ACTION_WIDTH],
        Extrapolation.CLAMP
      )
    }]
  }));

  return (
    <Reanimated.View
      style={[
        { minHeight, width: HISTORY_DELETE_ACTION_WIDTH },
        animatedStyle
      ]}
    >
      <Pressable
        accessibilityLabel={`Delete ${accessibilityLabel}`}
        accessibilityRole="button"
        onPress={() => {
          swipeable.close();
          onDelete(entry);
        }}
        style={({ pressed }) => [
          styles.historySwipeDeleteActionPressable,
          {
            backgroundColor: theme.danger,
            marginLeft: HISTORY_DELETE_ACTION_GAP,
            width: HISTORY_DELETE_ACTION_BUTTON_WIDTH
          },
          pressed ? styles.buttonPressed : null
        ]}
      >
        <TrashGlyph color={theme.onDanger} />
      </Pressable>
    </Reanimated.View>
  );
}

function SwipeableHistoryEntry({
  accessibilityLabel,
  children,
  enabled = true,
  entry,
  minHeight,
  onDelete,
  styles,
  theme
}: {
  accessibilityLabel: string;
  children: ReactNode;
  enabled?: boolean;
  entry: TimeEntry;
  minHeight: number;
  onDelete: (entry: TimeEntry) => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  return (
    <ReanimatedSwipeable
      enabled={enabled}
      friction={1}
      overshootRight={false}
      rightThreshold={HISTORY_DELETE_ACTION_WIDTH / 2}
      renderRightActions={(_progress, translation, swipeable) => enabled ? (
        <SwipeDeleteAction
          accessibilityLabel={accessibilityLabel}
          entry={entry}
          minHeight={minHeight}
          onDelete={onDelete}
          styles={styles}
          swipeable={swipeable}
          theme={theme}
          translation={translation}
        />
      ) : null}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

function HistoryDayCard({
  activeTimerRunning,
  now,
  onDeleteEntries,
  onOpenEntry,
  onOpenReview,
  onReplayEntry,
  reviewCount,
  section,
  styles,
  theme
}: {
  activeTimerRunning: boolean;
  now: number;
  onDeleteEntries: (entries: TimeEntry[]) => void;
  onOpenEntry: (entry: TimeEntry) => void;
  onOpenReview: () => void;
  onReplayEntry: (entry: TimeEntry) => void;
  reviewCount: number;
  section: HistoryDaySection;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const reduceMotion = useReduceMotionPreference();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const entryGroups = useMemo(() => groupHistoryDayEntries(section.entries), [section.entries]);

  function toggleGroup(groupKey: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  return (
    <View style={styles.todaySummaryBlock}>
      <Text style={styles.historyDayTitle}>{historyDayLabel(section, now)}</Text>
      <View style={styles.todayEntryCard}>
        {section.entries.length === 0 ? (
          <Reanimated.View
            entering={localPresenceEntering(reduceMotion)}
            layout={localLayoutTransition(reduceMotion)}
          >
            <Text style={styles.todayEmptyText}>No tracked time for this day.</Text>
          </Reanimated.View>
        ) : entryGroups.map((group, index) => {
          const { entry } = group.representative;
          const grouped = group.entries.length > 1;
          const expanded = grouped && expandedGroups.has(group.key);
          const canReplay = Boolean(entry.categoryId || entry.description?.trim());
          const title = displayEntryTitle(entry);
          return (
            <Reanimated.View
              key={`${section.key}:${group.key}`}
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
            >
              <SwipeableHistoryEntry
                accessibilityLabel={title}
                enabled={group.entries.every(({ entry: groupedEntry }) => Boolean(groupedEntry.stoppedAt))}
                entry={entry}
                minHeight={56}
                onDelete={() => onDeleteEntries(group.entries.map(({ entry: groupedEntry }) => groupedEntry))}
                styles={styles}
                theme={theme}
              >
                <View
                  style={[
                    styles.todayEntryRow,
                    index > 0 ? styles.todayEntryDivider : null
                  ]}
                >
                  <Pressable
                  accessibilityLabel={grouped
                    ? `${expanded ? "Collapse" : "Expand"} ${group.entries.length} ${title} entries`
                    : `Edit ${title}`}
                  accessibilityRole="button"
                  accessibilityState={grouped ? { expanded } : undefined}
                  onPress={() => {
                    if (grouped) toggleGroup(group.key);
                    else onOpenEntry(entry);
                  }}
                  style={({ pressed }) => [styles.historyEntryMain, pressed ? styles.buttonPressed : null]}
                >
                  {grouped ? (
                    <View style={styles.historyGroupCountBadge}>
                      <Text style={styles.historyGroupCountText}>{group.entries.length}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.todayEntryDot, { backgroundColor: entryCategoryColor(entry, theme.mode) }]} />
                  <View style={styles.todayEntryText}>
                    <Text style={styles.todayEntryTitle} numberOfLines={1}>{title}</Text>
                    <Text style={styles.todayEntryMeta} numberOfLines={1}>
                      {grouped
                        ? historyGroupMeta(entry, group.entries.length)
                        : `${formatEntryTimeRange(entry, now)}${entry.categoryName ? ` · ${entry.categoryName}` : ""}`}
                    </Text>
                    <TagMetadata
                      styles={styles}
                      tagNames={entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []}
                      theme={theme}
                    />
                  </View>
                  </Pressable>
                  <View style={styles.historyEntryActions}>
                    <Text style={styles.todayEntryDuration}>{formatDuration(group.totalSeconds)}</Text>
                    <Pressable
                      accessibilityLabel={activeTimerRunning
                        ? `Switch the running timer to ${title}`
                        : `Start ${title} now`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canReplay }}
                      disabled={!canReplay}
                      onPress={() => onReplayEntry(entry)}
                      style={({ pressed }) => [
                        styles.historyReplayButton,
                        !canReplay ? styles.buttonDisabled : null,
                        pressed && canReplay ? styles.buttonPressed : null
                      ]}
                    >
                      <PlayGlyph color={canReplay ? theme.accentText : theme.textSecondary} size={14} />
                    </Pressable>
                  </View>
                </View>
              </SwipeableHistoryEntry>
              {expanded ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={styles.historyGroupChildren}
                >
                  {group.entries.map(({ entry: childEntry, overlapSeconds }, childIndex) => (
                    <Reanimated.View
                      key={childEntry.id}
                      entering={localPresenceEntering(reduceMotion)}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                    >
                      <SwipeableHistoryEntry
                        accessibilityLabel={displayEntryTitle(childEntry)}
                        enabled={Boolean(childEntry.stoppedAt)}
                        entry={childEntry}
                        minHeight={46}
                        onDelete={(deletedEntry) => onDeleteEntries([deletedEntry])}
                        styles={styles}
                        theme={theme}
                      >
                        <Pressable
                          accessibilityLabel={`Edit ${displayEntryTitle(childEntry)} from ${formatEntryTimeRange(childEntry, now)}`}
                          accessibilityRole="button"
                          onPress={() => onOpenEntry(childEntry)}
                          style={({ pressed }) => [
                            styles.historyGroupChild,
                            childIndex > 0 ? styles.historyGroupChildDivider : null,
                            pressed ? styles.buttonPressed : null
                          ]}
                        >
                          <View style={[styles.todayEntryDot, { backgroundColor: entryCategoryColor(childEntry, theme.mode) }]} />
                          <Text style={styles.historyGroupChildTime} numberOfLines={1}>
                            {formatEntryTimeRange(childEntry, now)}
                          </Text>
                          <Text style={styles.todayEntryDuration}>{formatDuration(overlapSeconds)}</Text>
                        </Pressable>
                      </SwipeableHistoryEntry>
                    </Reanimated.View>
                  ))}
                </Reanimated.View>
              ) : null}
            </Reanimated.View>
          );
        })}
      </View>
      {reviewCount > 0 ? (
        <Pressable
          accessibilityLabel={`${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} review. Open Review.`}
          accessibilityRole="button"
          onPress={onOpenReview}
          style={({ pressed }) => [
            styles.reviewNoteButton,
            pressed ? styles.buttonPressed : null
          ]}
        >
          <Text style={styles.reviewNoteText}>
            {reviewCount} {reviewCount === 1 ? "item needs" : "items need"} review
          </Text>
          <Text style={styles.reviewNoteAction}>Open Review</Text>
        </Pressable>
      ) : null}
      <View style={styles.todayTrackedRow}>
        <Text style={styles.todayTrackedLabel}>Tracked</Text>
        <Text style={styles.todayTrackedValue}>{formatDuration(section.totalSeconds)}</Text>
      </View>
    </View>
  );
}

function historyGroupMeta(entry: TimeEntry, count: number) {
  const title = displayEntryTitle(entry).trim().toLocaleLowerCase();
  const category = entry.categoryName?.trim();
  if (!category || category.toLocaleLowerCase() === title) return `${count} entries`;
  return `${count} entries · ${category}`;
}

function DonutChart({
  progress,
  segments,
  styles,
  theme,
  total
}: {
  progress: number;
  segments: SummarySegment[];
  styles: MobileStyles;
  theme: MobileTheme;
  total: number;
}) {
  const size = 184;
  const center = size / 2;
  const outerRadius = 84;
  const innerRadius = 57;
  let cursor = 0;

  return (
    <View
      accessibilityLabel={`Tracked time total ${formatDuration(total)}. Category details follow the chart.`}
      accessibilityRole="image"
      accessible
      style={styles.chartBox}
    >
      <Svg
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <Defs>
          <Pattern id="uncategorizedHatch" patternUnits="userSpaceOnUse" width={8} height={8}>
            <Rect width={8} height={8} fill={uncategorizedFillColor(theme.mode)} />
            <Path
              d="M-2 8 8 -2M2 10 10 2"
              stroke={uncategorizedStripeColor(theme.mode)}
              strokeLinecap="round"
              strokeWidth={1.4}
            />
          </Pattern>
        </Defs>
        <Circle cx={center} cy={center} r={outerRadius} fill={theme.chartTrack} />
        <Circle cx={center} cy={center} r={innerRadius} fill={theme.surfaceRaised} />
        <G>
          {total > 0
            ? segments.map((segment) => {
                const fullSweep = (segment.seconds / total) * 360;
                const start = cursor;
                const gap = fullSweep > 8 ? 2 : 0;
                const end = start + Math.max(0, fullSweep * progress - gap);
                cursor += fullSweep;
                if (end <= start) return null;

                return (
                  <Path
                    key={segment.key}
                    d={donutSlicePath(center, center, outerRadius, innerRadius, start, end)}
                    fill={segment.isUncategorized ? "url(#uncategorizedHatch)" : segment.color}
                    stroke={segment.isUncategorized ? uncategorizedStripeColor(theme.mode) : undefined}
                    strokeOpacity={segment.isUncategorized ? 0.65 : undefined}
                    strokeWidth={segment.isUncategorized ? 0.75 : undefined}
                  />
                );
              })
            : null}
        </G>
      </Svg>
      <View style={styles.chartCenter}>
        <Text style={styles.chartCenterLabel}>Total</Text>
        <Text style={styles.chartCenterValue}>{formatDuration(total)}</Text>
      </View>
    </View>
  );
}

function SegmentSwatch({
  segment,
  styles,
  theme,
  variant
}: {
  segment: SummarySegment;
  styles: MobileStyles;
  theme: MobileTheme;
  variant: "legend" | "report";
}) {
  const swatchStyle = variant === "legend" ? styles.legendSwatch : styles.reportCategorySwatch;
  if (!segment.isUncategorized) {
    return <View style={[swatchStyle, { backgroundColor: segment.color }]} />;
  }

  const width = 12;
  const height = variant === "legend" ? 32 : 36;
  return (
    <View style={[swatchStyle, styles.uncategorizedSwatch]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Rect width={width} height={height} fill={uncategorizedFillColor(theme.mode)} />
        {Array.from({ length: 8 }, (_, index) => (
          <Path
            key={index}
            d={`M${index * 6 - height} ${height} L${index * 6} 0`}
            stroke={uncategorizedStripeColor(theme.mode)}
            strokeWidth={1.4}
          />
        ))}
      </Svg>
    </View>
  );
}

function dedupeEntriesById(entries: TimeEntry[]) {
  const byId = new Map<string, TimeEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return Array.from(byId.values());
}

function buildReports(
  data: MobileBootstrap | null,
  range: ReportRange,
  todayKey: string,
  now: number,
  mode: MobileTheme["mode"]
) {
  const weekStart = data?.dateRange?.weekStart ? new Date(data.dateRange.weekStart) : startOfWeekDate(new Date(now));
  const weekEnd = addDaysToDate(weekStart, 7);
  const todayStart = dateFromKey(todayKey);
  const todayEnd = addDaysToDate(todayStart, 1);
  const dayEntries = data
    ? mergeActiveEntry(data.dayEntries ?? data.entries, data.activeEntry)
    : [];
  const weekEntries = data
    ? mergeActiveEntry(data.weekEntries ?? data.entries, data.activeEntry)
    : [];
  const selectedEntries = range === "today" ? dayEntries : weekEntries;
  const rangeStart = range === "today" ? todayStart : weekStart;
  const rangeEnd = range === "today" ? todayEnd : weekEnd;
  const confirmedDayEntries = dayEntries.filter((entry) => !isReviewNeededEntry(entry));
  const confirmedWeekEntries = weekEntries.filter((entry) => !isReviewNeededEntry(entry));
  const confirmedSelectedEntries = selectedEntries.filter((entry) => !isReviewNeededEntry(entry));
  const todayTotal = sumRangeSeconds(confirmedDayEntries, todayStart, todayEnd, now);
  const weekTotal = sumRangeSeconds(confirmedWeekEntries, weekStart, weekEnd, now);

  return {
    todayTotal,
    weekTotal,
    segments: buildCategorySegments(confirmedSelectedEntries, rangeStart, rangeEnd, now, mode),
    dailyBars: buildDailyBars(confirmedWeekEntries, weekStart, now),
    hasSuggestedActivity: hasReviewNeededActivityForRange({
      entries: selectedEntries,
      now,
      rangeEnd,
      rangeStart,
      reviewItems: data?.reviewItems ?? []
    })
  };
}

function mergeActiveEntry(entries: TimeEntry[], activeEntry: MobileBootstrap["activeEntry"]) {
  const byId = new Map<string, TimeEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  if (activeEntry) {
    byId.set(activeEntry.id, {
      ...(byId.get(activeEntry.id) ?? {}),
      ...activeEntry,
      stoppedAt: null
    });
  }
  return Array.from(byId.values());
}

function pendingEntryFromStartInput(input: {
  categories: MobileBootstrap["categories"];
  categoryId: string | null;
  description: string | null;
  startedAt?: string | null;
  tagNames?: string[];
}): TimeEntry {
  const category = input.categoryId
    ? input.categories.find((candidate) => candidate.id === input.categoryId)
    : null;

  return {
    categoryColor: category?.color ?? null,
    categoryId: category?.id ?? input.categoryId,
    categoryName: category?.name ?? null,
    clientName: null,
    confidence: "high",
    description: input.description,
    durationSeconds: 0,
    id: "pending-active-timer",
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "mobile_app",
    startedAt: input.startedAt ?? new Date().toISOString(),
    stoppedAt: null,
    tagNames: input.tagNames ?? [],
    tags: []
  };
}

function createManualDraftEntry(lastStoppedAt: string | null, nowMs: number): TimeEntry {
  const stoppedAt = new Date(nowMs);
  const lastStopMs = lastStoppedAt ? Date.parse(lastStoppedAt) : Number.NaN;
  const useLastStop = Number.isFinite(lastStopMs) && lastStopMs < nowMs && nowMs - lastStopMs <= RECENT_LAST_STOP_WINDOW_MS;
  const startedAt = new Date(useLastStop ? lastStopMs : nowMs - 30 * 60 * 1000);
  return {
    categoryColor: null,
    categoryId: null,
    categoryName: null,
    clientName: null,
    confidence: "manual",
    description: null,
    durationSeconds: Math.max(60, Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000)),
    id: `manual-draft:${nowMs}`,
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "manual_app",
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
    tagNames: [],
    tags: []
  };
}

function buildCategorySegments(
  entries: TimeEntry[],
  rangeStart: Date,
  rangeEnd: Date,
  now: number,
  mode: MobileTheme["mode"]
): SummarySegment[] {
  const totals = new Map<string, Omit<SummarySegment, "share">>();

  for (const entry of entries) {
    const seconds = entryOverlapSeconds(entry, rangeStart, rangeEnd, now);
    if (seconds <= 0) continue;
    const categoryName = entry.categoryName ?? "Uncategorized";
    const key = entry.categoryId ?? "uncategorized";
    const isUncategorized = !entry.categoryId && !entry.categoryName;
    const current = totals.get(key);
    totals.set(key, {
      key,
      categoryName,
      seconds: (current?.seconds ?? 0) + seconds,
      color: current?.color ?? entryCategoryColor(entry, mode),
      isUncategorized: current?.isUncategorized ?? isUncategorized
    });
  }

  const total = Array.from(totals.values()).reduce((sum, segment) => sum + segment.seconds, 0);
  return Array.from(totals.values())
    .map((segment) => ({
      ...segment,
      share: total > 0 ? Math.round((segment.seconds / total) * 100) : 0
    }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 8);
}

function buildDailyBars(entries: TimeEntry[], weekStart: Date, now: number) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDaysToDate(weekStart, index);
    const key = formatDateKey(day);
    return {
      key,
      label: formatWeekday(day),
      seconds: sumStartedInDaySeconds(entries, key, now)
    };
  });
}

function sumStartedInDaySeconds(entries: TimeEntry[], dayKey: string, now: number) {
  return entries.reduce((sum, entry) => {
    if (formatDateKey(new Date(entry.startedAt)) !== dayKey) return sum;
    return sum + entryDurationSeconds(entry, now);
  }, 0);
}

function sumRangeSeconds(entries: TimeEntry[], rangeStart: Date, rangeEnd: Date, now: number) {
  return entries.reduce((sum, entry) => {
    return sum + entryOverlapSeconds(entry, rangeStart, rangeEnd, now);
  }, 0);
}

function entryOverlapSeconds(entry: TimeEntry, rangeStart: Date, rangeEnd: Date, now: number) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) return 0;
  const overlapStart = Math.max(startedAt.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(stoppedAt.getTime(), rangeEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / 1000);
}

function entryDurationSeconds(entry: TimeEntry, now: number) {
  const startedAt = new Date(entry.startedAt).getTime();
  if (entry.stoppedAt) return Math.max(0, entry.durationSeconds);
  if (Number.isNaN(startedAt)) return Math.max(0, entry.durationSeconds);
  return Math.max(entry.durationSeconds, Math.floor((now - startedAt) / 1000));
}

function entryCategoryColor(entry: TimeEntry, mode: MobileTheme["mode"]) {
  if (!entry.categoryId && !entry.categoryName) return uncategorizedFillColor(mode);
  return paletteColorFor(
    entry.categoryColor ?? entry.categoryId,
    entry.categoryName ?? "Uncategorized",
    mode
  );
}

function displayEntryTitle(entry: TimeEntry) {
  return displayTimerDescription(entry) ?? entry.categoryName ?? "Uncategorized";
}

function formatEntryTimeRange(entry: TimeEntry, now: number) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  return `${formatTimeOfDay(startedAt)}-${entry.stoppedAt ? formatTimeOfDay(stoppedAt) : "now"}`;
}

function formatLongDay(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatWeekday(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function formatTimeOfDay(date: Date) {
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateFromKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateKey(date: Date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-");
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function startOfWeekDate(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDaysToDate(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function colorWithAlpha(hex: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function uncategorizedFillColor(mode: MobileTheme["mode"]) {
  return mode === "dark" ? "#323946" : "#EEF2F6";
}

function uncategorizedStripeColor(mode: MobileTheme["mode"]) {
  return mode === "dark" ? "#8792A3" : "#98A4B3";
}

function recentStoppedEntryTime(entries: TimeEntry[], activeEntry: MobileBootstrap["activeEntry"]) {
  if (!activeEntry) return null;
  const activeStart = new Date(activeEntry.startedAt).getTime();
  if (Number.isNaN(activeStart)) return null;

  let recentStop: string | null = null;
  let recentStopTime = 0;
  for (const entry of entries) {
    if (!entry.stoppedAt) continue;
    const stoppedAt = new Date(entry.stoppedAt).getTime();
    if (
      Number.isNaN(stoppedAt) ||
      stoppedAt > activeStart ||
      activeStart - stoppedAt > RECENT_LAST_STOP_WINDOW_MS ||
      stoppedAt <= recentStopTime
    ) {
      continue;
    }
    recentStop = entry.stoppedAt;
    recentStopTime = stoppedAt;
  }

  return recentStop;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function donutSlicePath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
) {
  const safeEndAngle = Math.min(endAngle, startAngle + 359.99);
  const outerStart = polarToCartesian(cx, cy, outerRadius, safeEndAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, safeEndAngle);
  const largeArcFlag = safeEndAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z"
  ].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

function formatClockDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours === 0) {
    return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
