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
import {
  analyzeTimeIntervals,
  paletteColorFor,
  TIMER_STATE_RECONCILE_INTERVAL_MS,
  timerStateChanged,
  timerStatePollDelay,
  type RecentActivitySuggestion,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { DayframeCalendarView } from "../../modules/dayframe-calendar";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { ConnectivityStatusIndicator } from "@/components/ConnectivityStatusStrip";
import { TagMetadata } from "@/components/TagMetadata";
import { DayframeBrand } from "@/components/brand";
import {
  CompactReplayPlayGlyph,
  PrimaryTimerAction
} from "@/components/PrimaryTimerAction";
import {
  AuthRequiredError,
  createManualTimeEntry,
  createTag,
  enqueueEvent,
  fetchBootstrap,
  fetchTimerState,
  isQueuedTimerMutationEvent,
  login,
  readQueue,
  readTimerEntryIdCorrelations,
  resolveTimerEntryIdAfterQueueBarrier,
  signup,
  syncQueue,
  type MobileBootstrap,
  type SyncQueueResult,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { handleDayframeUrl } from "@/lib/deepLinks";
import { resolveCalendarManualEntryRequest } from "@/lib/calendarManualEntry";
import { IS_DAYFRAME_STAGING } from "@/lib/config";
import { useConnectivity } from "@/lib/connectivity";
import { refreshConnectivity } from "@/lib/connectivityMonitor";
import {
  createSharedInFlightOperation
} from "@/lib/connectivityRecovery";
import {
  captureDashboardRefreshGuard,
  reconcileDashboardRefreshCandidate,
  type DashboardRefreshGuard
} from "@/lib/dashboardRefresh";
import { subscribeRecoveredDashboardBootstrap } from "@/lib/dashboardBootstrapChannel";
import { refreshGeofencesForPlaces } from "@/lib/geofence";
import {
  configureLocationIntelligence
} from "@/lib/location/runtime";
import { recordLocationStoreError } from "@/lib/location/store";
import { mergePersistedMobileTag } from "@/lib/mobileTags";
import {
  StaleMobileSessionResponseError,
  isRetryableMobileConnectivityFailure
} from "@/lib/mobile-network";
import {
  activateMobileAccount,
  deactivateMobileAccount
} from "@/lib/mobileAccount";
import {
  projectDurableLocalWork
} from "@/lib/durableLocalProjection";
import { readDurableLocalWork } from "@/lib/durableLocalWork";
import { readOwnedAuthenticatedSessionSnapshot } from "@/lib/secure-session";
import {
  shouldDismissExternallyStoppedActiveEditor,
  shouldResetCalendarToTodayOnForeground
} from "@/lib/mobileLifecycle";
import {
  cacheDashboardBootstrap,
  loadCachedDashboardBootstrap
} from "@/lib/reviewSyncStore";
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
  pendingTimerStopsForOwner,
  readPendingTimerStops,
  removePendingTimerStopsForTarget,
  resolvePendingTimerStopTargets,
  type PendingTimerStop,
  type TimerStopOwner
} from "@/lib/timerStopOutbox";
import {
  persistPendingTimerStop,
  synchronisePendingTimerStops
} from "@/lib/timerStopSync";
import { endAllTimerBackgroundExecution } from "@/lib/timerBackgroundExecution";
import {
  enqueueTimeEntryDelete,
  enqueueTimeEntryUpdate,
  releaseTimeEntryCommands,
  removeTimeEntryCommands,
  synchroniseTimeEntryCommands
} from "@/lib/timeEntryOutbox";
import {
  type TimeEntrySheetOpenReason,
  type TimeEntrySheetPresentation
} from "@/lib/timeEntrySheetPresentation";
import {
  createDeletionCoordinator,
  DELETION_UNDO_MS,
  type PendingDeletion
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
import { subscribeMobileSignedOut } from "@/lib/mobileSessionTransition";
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
  useResolvedReduceMotionPreference,
  useReduceTransparencyPreference
} from "@/lib/motion";
import {
  activeTimerElapsedSeconds,
  activeTimerPresentation,
  buildMobileQuickActions,
  createBlankTimerStartGate,
  createGenerationScopedExitCoordinator,
  createOptimisticTimerStartReconciler,
  createSerializedMutationQueue,
  createSupersededStopRollbackTracker,
  dashboardActiveTimerEntry,
  displayTimerDescription,
  filterPendingDeletedTimeEntries,
  mobileTimeEntryById,
  optimisticDeleteTimeEntry,
  optimisticPatchTimeEntry,
  optimisticRestoreTimeEntries,
  optimisticStartTimer,
  optimisticStopActiveTimer,
  OPTIMISTIC_TIMER_ID_PREFIX,
  replaceOptimisticTimeEntryId,
  restoreDeletedTimeEntriesSafely,
  restoreFailedDeletionSafely,
  rollbackRejectedOptimisticTimerStart,
  rollbackOptimisticStopSafely,
  shouldAwaitTimerMutationAcceptance,
  sortMobileCategoriesByUsage
} from "@/lib/timerPresentation";
import { TIMER_CARD_QUICK_ACTION_HIT_SLOP } from "@/lib/timerCardLayout";

type TimeEntry = MobileBootstrap["entries"][number];
type AuthView = "login" | "signup";
type AuthState = "checking" | "opening" | "authenticated" | "signedOut";
type DashboardLoadOptions = {
  preserveAuthFormOnAuthRequired?: boolean;
  silent?: boolean;
  throwOnError?: boolean;
  visibleRefresh?: boolean;
};
type SignedOutTransitionOptions = { preserveAuthPassword?: boolean };
type RejectedOptimisticStart = {
  error: unknown;
  optimisticId: string;
  previousData: MobileBootstrap | null;
};
export type DayframeDashboardTab = "timer" | "calendar" | "reports";

function StagingBadge({ styles }: { styles: MobileStyles }) {
  if (!IS_DAYFRAME_STAGING) return null;
  return <Text style={styles.environmentBadge}>STAGING</Text>;
}

function DashboardBrandLockup({
  isFocused = true,
  styles,
  theme
}: {
  isFocused?: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  return (
    <View style={styles.logoLockup}>
      <DayframeBrand
        layout="horizontal"
        size="md"
        tone={theme.mode === "dark" ? "light" : "dark"}
      />
      <ConnectivityStatusIndicator
        isFocused={isFocused}
        onOpenDiagnostics={() => router.push({
          pathname: "/settings",
          params: { section: "sync" }
        })}
      />
      <StagingBadge styles={styles} />
    </View>
  );
}
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
  const connectivity = useConnectivity();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDateKey(new Date()));
  const [reportRange, setReportRange] = useState<ReportRange>("today");
  const [calendarEditEntry, setCalendarEditEntry] = useState<NativeCalendarEntry | null>(null);
  const [calendarEditPresentation, setCalendarEditPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [calendarTransitionDirection, setCalendarTransitionDirection] = useState(1);
  const [reportChartView, setReportChartView] = useState<ReportChartView>("pie");
  const [authView, setAuthView] = useState<AuthView>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordVisible, setAuthPasswordVisible] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authWorkspace, setAuthWorkspace] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [manualDraftEntry, setManualDraftEntry] = useState<TimeEntry | null>(null);
  const [manualEntryPresentation, setManualEntryPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [manualEntrySaving, setManualEntrySaving] = useState(false);
  const manualEntrySavingRef = useRef(false);
  const authSubmittingRef = useRef(false);
  const [activeEditPresentation, setActiveEditPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [activeEditDismissRequestId, setActiveEditDismissRequestId] = useState<number | null>(null);
  const [presentedActiveEntry, setPresentedActiveEntry] = useState<TimeEntry | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion<
    TimeEntry,
    MobileBootstrap | null
  > | null>(null);
  const [pendingTimerStops, setPendingTimerStops] = useState<PendingTimerStop[]>([]);
  const {
    reduceMotion,
    resolved: reduceMotionPreferenceResolved
  } = useResolvedReduceMotionPreference();
  const reduceTransparency = useReduceTransparencyPreference();
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const queuedEventSync = useRef(
    createSharedInFlightOperation<SyncQueueResult>()
  ).current;
  const healthAutoSyncInFlight = useRef(false);
  const latestData = useRef<MobileBootstrap | null>(null);
  const liveActivityReconciliationDeferred = useRef(false);
  const optimisticTimerIds = useRef(new Map<string, string>());
  const timerIdCorrelationsLoaded = useRef(false);
  const optimisticTimerSequence = useRef(0);
  const optimisticTimerStartReconciler = useRef(createOptimisticTimerStartReconciler());
  const supersededStopRollbackTracker = useRef(createSupersededStopRollbackTracker());
  const rejectedOptimisticStartExit = useRef(
    createGenerationScopedExitCoordinator<RejectedOptimisticStart>()
  );
  const sheetPresentationSequence = useRef(0);
  const activeEditPresentationRef = useRef<TimeEntrySheetPresentation | null>(null);
  const calendarEditPresentationRef = useRef<TimeEntrySheetPresentation | null>(null);
  const manualEntryPresentationRef = useRef<TimeEntrySheetPresentation | null>(null);
  const pendingNativeShortcutLocalIds = useRef<Set<string>>(new Set());
  const timerMutationQueue = useRef(createSerializedMutationQueue());
  const timerMutationCount = useRef(0);
  const queuedTimerStartRecoveryRequested = useRef(false);
  const dashboardMutationRevision = useRef(0);
  const recoveredBootstrapGuards = useRef(new Map<number, DashboardRefreshGuard>());
  const loadRef = useRef<(options?: DashboardLoadOptions) => Promise<void>>(async () => undefined);
  const timerMutationVersions = useRef(new Map<string, number>());
  const timerStateRef = useRef<TimerStateFingerprint | null>(null);
  const timerStatePollInFlight = useRef(false);
  const calendarBackgroundedAt = useRef<number | null>(null);
  const calendarBackgroundedDayKey = useRef<string | null>(null);
  const deletionCoordinator = useRef<ReturnType<typeof createDeletionCoordinator<
    TimeEntry,
    MobileBootstrap | null
  >> | null>(null);
  const deletionCommandIds = useRef(new Map<number, string[]>());
  const deletionPreparationInFlight = useRef(false);
  const activeSheetDeletionToken = useRef<{ presentationId: number; token: number } | null>(null);
  const calendarSheetDeletionToken = useRef<{ presentationId: number; token: number } | null>(null);
  const activeEditorOpenFrame = useRef<number | null>(null);
  const activeEditorEntryId = useRef<string | null>(null);
  const blankTimerStartGate = useRef(createBlankTimerStartGate());
  const entrance = useRef(new Animated.Value(0)).current;
  const activeTimerExpansion = useRef(new Animated.Value(0)).current;
  const authNameRef = useRef<TextInput>(null);
  const authWorkspaceRef = useRef<TextInput>(null);
  const authEmailRef = useRef<TextInput>(null);
  const authPasswordRef = useRef<TextInput>(null);
  const preserveAuthPasswordOnSignedOut = useRef(false);
  const authStateCurrent = useRef<AuthState>(authState);
  const connectivityCurrent = useRef(connectivity);
  authStateCurrent.current = authState;
  connectivityCurrent.current = connectivity;

  const transitionToSignedOut = useCallback((options?: SignedOutTransitionOptions) => {
    void endAllTimerBackgroundExecution("logout");
    authStateCurrent.current = "signedOut";
    const signedOutOwner = latestData.current
      ? timerStopOwner(latestData.current)
      : undefined;
    void deactivateMobileAccount(signedOutOwner);
    if (activeEditorOpenFrame.current !== null) {
      cancelAnimationFrame(activeEditorOpenFrame.current);
      activeEditorOpenFrame.current = null;
    }
    const blankStart = blankTimerStartGate.current.current();
    if (blankStart) blankTimerStartGate.current.release(blankStart.token);
    deletionCoordinator.current?.dispose();
    deletionCoordinator.current = null;
    deletionCommandIds.current.clear();
    deletionPreparationInFlight.current = false;
    activeSheetDeletionToken.current = null;
    calendarSheetDeletionToken.current = null;
    activeEditPresentationRef.current = null;
    activeEditorEntryId.current = null;
    optimisticTimerIds.current.clear();
    optimisticTimerStartReconciler.current.clear();
    supersededStopRollbackTracker.current.clear();
    rejectedOptimisticStartExit.current =
      createGenerationScopedExitCoordinator<RejectedOptimisticStart>();
    timerIdCorrelationsLoaded.current = false;
    calendarEditPresentationRef.current = null;
    manualEntryPresentationRef.current = null;
    dashboardMutationRevision.current += 1;
    recoveredBootstrapGuards.current.clear();
    refreshQueued.current = false;
    queuedTimerStartRecoveryRequested.current = false;
    latestData.current = null;
    timerStateRef.current = null;
    setData(null);
    setRefreshing(false);
    setAuthSubmitting(false);
    authSubmittingRef.current = false;
    if (!options?.preserveAuthPassword) setAuthPassword("");
    setAuthPasswordVisible(false);
    setAuthError(null);
    setAuthNotice(null);
    setAuthView("login");
    setActiveEditPresentation(null);
    setActiveEditDismissRequestId(null);
    setPresentedActiveEntry(null);
    setManualDraftEntry(null);
    setManualEntryPresentation(null);
    setCalendarEditEntry(null);
    setCalendarEditPresentation(null);
    setPendingDeletion(null);
    setPendingTimerStops([]);
    setAuthState("signedOut");
  }, []);

  useEffect(() => subscribeMobileSignedOut(() => transitionToSignedOut({
    preserveAuthPassword: preserveAuthPasswordOnSignedOut.current
  })), [transitionToSignedOut]);

  useEffect(() => subscribeRecoveredDashboardBootstrap((event) => {
    if (event.type === "started") {
      recoveredBootstrapGuards.current.set(
        event.publicationId,
        captureDashboardRefreshGuard({
          currentRevision: dashboardMutationRevision.current,
          timerMutationsInFlight: timerMutationCount.current
        })
      );
      return;
    }
    const guard = recoveredBootstrapGuards.current.get(event.publicationId);
    recoveredBootstrapGuards.current.delete(event.publicationId);
    if (event.type === "abandoned") return;
    if (!guard) {
      queueDashboardRefreshAfterConflict();
      return;
    }
    void applyRecoveredDashboardBootstrap(event.bootstrap, guard);
  }), []);

  async function applyRecoveredDashboardBootstrap(
    bootstrap: MobileBootstrap,
    guard: DashboardRefreshGuard
  ) {
    const current = latestData.current;
    if (
      authStateCurrent.current !== "authenticated" ||
      (current && !sameTimerStopOwner(timerStopOwner(current), timerStopOwner(bootstrap)))
    ) {
      return;
    }
    const reconciled = await reconcileDashboardRefreshCandidate({
      candidate: bootstrap,
      currentRevision: () => dashboardMutationRevision.current,
      guard,
      reconcile: reconcileDashboardDeletionState,
      timerMutationsInFlight: () => timerMutationCount.current
    });
    if (reconciled.action === "refresh") {
      queueDashboardRefreshAfterConflict();
      return;
    }
    const next = reconciled.candidate;
    const latest = latestData.current;
    if (
      authStateCurrent.current !== "authenticated" ||
      (latest && !sameTimerStopOwner(timerStopOwner(latest), timerStopOwner(next)))
    ) {
      return;
    }
    refreshQueued.current = false;
    latestData.current = next;
    setData(next);
    void readOwnedPendingTimerStops(next).then((stops) => {
      const visible = latestData.current;
      if (visible && sameTimerStopOwner(timerStopOwner(visible), timerStopOwner(next))) {
        setPendingTimerStops(stops);
      }
    });
    syncShortcutCatalog(next);
    void refreshLocationServices(next);
    void syncLiveActivityForEntry(next.activeEntry);
  }

  async function reconcileDashboardDeletionState(bootstrap: MobileBootstrap) {
    const pendingDeletionIds = await reconcilePendingActiveDeletionAfterQueueBarrier(
      bootstrap.activeEntry?.id ?? null
    );
    return filterPendingDeletedTimeEntries(bootstrap, pendingDeletionIds) as MobileBootstrap;
  }

  function queueDashboardRefreshAfterConflict() {
    refreshQueued.current = true;
    if (
      timerMutationCount.current > 0 ||
      refreshInFlight.current ||
      connectivityCurrent.current.isOffline
    ) {
      return;
    }
    refreshQueued.current = false;
    void loadRef.current({ silent: true });
  }

  const changeReportRange = useCallback((nextRange: ReportRange) => {
    scheduleLayoutTransition(reduceMotion);
    setReportRange(nextRange);
  }, [reduceMotion]);

  const changeReportChart = useCallback((nextView: ReportChartView) => {
    scheduleLayoutTransition(reduceMotion);
    setReportChartView(nextView);
  }, [reduceMotion]);

  async function hydrateTimerEntryIdCorrelations() {
    if (timerIdCorrelationsLoaded.current) return;
    const correlations = await readTimerEntryIdCorrelations();
    for (const [localId, timeEntryId] of correlations) {
      optimisticTimerIds.current.set(localId, timeEntryId);
    }
    timerIdCorrelationsLoaded.current = true;
  }

  function timerStopOwner(bootstrap: MobileBootstrap): TimerStopOwner {
    return {
      userId: bootstrap.user.id,
      workspaceId: bootstrap.workspace.id
    };
  }

  async function readOwnedPendingTimerStops(bootstrap: MobileBootstrap) {
    const owner = timerStopOwner(bootstrap);
    const resolved = await resolvePendingTimerStopTargets(optimisticTimerIds.current, owner);
    return pendingTimerStopsForOwner(resolved, owner);
  }

  async function deliverOwnedPendingTimerStops(
    bootstrap: MobileBootstrap,
    options: { reloadAfterDelivery?: boolean } = {}
  ) {
    const owner = timerStopOwner(bootstrap);
    const correlations = new Map(await readTimerEntryIdCorrelations(owner));
    for (const [localId, canonicalId] of optimisticTimerIds.current) {
      correlations.set(localId, canonicalId);
    }
    const summary = await synchronisePendingTimerStops({ owner, correlations });
    const current = latestData.current;
    if (!current || !sameTimerStopOwner(timerStopOwner(current), owner)) {
      return summary;
    }
    setPendingTimerStops(summary.remaining);
    if (
      (summary.deliveredCount > 0 || summary.permanentRejectedCount > 0) &&
      options.reloadAfterDelivery !== false
    ) {
      void loadRef.current({ silent: true });
    }
    return summary;
  }

  function settleOptimisticTimerStart(
    optimisticId: string,
    phase: "persisted" | "queued" | "rejected"
  ) {
    const deferredExternalActiveEntryId =
      optimisticTimerStartReconciler.current.settle(optimisticId, phase);
    if (deferredExternalActiveEntryId) {
      reconcilePendingActiveDeletionWithExternalActiveEntry(
        deferredExternalActiveEntryId
      );
    }
  }

  function applyTimerEntryIdCorrelation(localId: string, timeEntryId: string) {
    supersededStopRollbackTracker.current.settle(localId);
    optimisticTimerIds.current.set(localId, timeEntryId);
    const pending = deletionCoordinator.current?.current();
    if (pending?.entryIds.includes(localId)) {
      deletionCoordinator.current?.registerPendingId(pending.token, timeEntryId);
    }
    if (mobileTimeEntryById(latestData.current, localId) || pending) {
      updateDashboardData((current) =>
        mobileTimeEntryById(current, localId)
          ? replaceOptimisticTimeEntryId(current, localId, timeEntryId)
          : current
      );
    }
    settleOptimisticTimerStart(localId, "persisted");
  }

  async function syncQueueWithTimerReconciliation() {
    return serializeTimerPersistence(async (): Promise<SyncQueueResult> => {
      // Read the queue only after earlier mutations finish. A deletion that
      // follows this sync therefore cannot remove a local start while its POST
      // is still capable of creating an untracked canonical timer.
      const queuedTimerStartIds = (await readQueue())
        .filter((event) =>
          event.type === "timer_start" && event.localId.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)
        )
        .map((event) => event.localId);
      const syncingIds = queuedTimerStartIds.filter((entryId) =>
        optimisticTimerStartReconciler.current.beginQueueSync(entryId)
      );
      try {
        const result = await syncQueue();
        const correlatedIds = new Set<string>();
        for (const correlation of result.timerEntryIdCorrelations) {
          correlatedIds.add(correlation.localId);
          applyTimerEntryIdCorrelation(correlation.localId, correlation.timeEntryId);
        }
        for (const entryId of syncingIds) {
          if (!correlatedIds.has(entryId)) settleOptimisticTimerStart(entryId, "queued");
        }
        return result;
      } catch (error) {
        for (const entryId of syncingIds) settleOptimisticTimerStart(entryId, "queued");
        throw error;
      }
    });
  }

  const syncQueuedEvents = useCallback(async () => {
    const runPass = () => queuedEventSync.run(async () => {
      const nativeDrain = await drainNativeShortcutQueue();
      for (const localId of nativeDrain.transferredLocalIds) {
        pendingNativeShortcutLocalIds.current.add(localId);
      }
      const syncResult = await syncQueueWithTimerReconciliation();
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
    });
    const firstResult = await runPass();
    // A Start can become durable while an older foreground activity drain is
    // in flight. Join that owner, then immediately give the new timer intent
    // its own timer-scoped pass instead of mistaking the shared result for it.
    return firstResult.remaining.some(isQueuedTimerMutationEvent)
      ? runPass()
      : firstResult;
  }, [queuedEventSync]);

  function reconcilePendingActiveDeletionWithExternalActiveEntry(
    externalActiveEntryId: string | null
  ) {
    const coordinator = deletionCoordinator.current;
    if (!coordinator) return new Set<string>();
    const pending = coordinator.current();
    const pendingEntryIds = coordinator.pendingEntryIds();
    if (optimisticTimerStartReconciler.current.deferExternalActiveEntry({
      deletedActiveEntryId: pending?.snapshot?.activeEntry?.id ?? null,
      externalActiveEntryId,
      pendingEntryIds
    })) {
      return new Set([
        ...pendingEntryIds,
        ...optimisticTimerStartReconciler.current.deferredExternalActiveEntryIds()
      ]);
    }
    return coordinator.reconcileExternalActiveEntry({
      deletedActiveEntryId: pending?.snapshot?.activeEntry?.id ?? null,
      externalActiveEntryId
    }).pendingEntryIds;
  }

  async function reconcilePendingActiveDeletionAfterQueueBarrier(
    externalActiveEntryId: string | null
  ) {
    const pending = deletionCoordinator.current?.current();
    if (pending) {
      for (const localId of pending.entryIds) {
        if (!localId.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)) continue;
        const durableId = optimisticTimerIds.current.get(localId) ??
          await resolveTimerEntryIdAfterQueueBarrier(localId);
        const currentPending = deletionCoordinator.current?.current();
        if (
          durableId &&
          currentPending?.token === pending.token &&
          !deletionCoordinator.current?.pendingEntryIds().has(durableId)
        ) {
          applyTimerEntryIdCorrelation(localId, durableId);
        }
      }
    }
    return reconcilePendingActiveDeletionWithExternalActiveEntry(
      externalActiveEntryId
    );
  }

  const load = useCallback(async (options?: DashboardLoadOptions) => {
    if (
      connectivityCurrent.current.isOffline &&
      latestData.current !== null &&
      !options?.throwOnError
    ) {
      if (options?.visibleRefresh) {
        setRefreshing(true);
        try {
          await refreshConnectivity();
        } finally {
          setRefreshing(false);
        }
      }
      return;
    }
    if (refreshInFlight.current || timerMutationCount.current > 0) {
      refreshQueued.current = true;
      if (options?.throwOnError) {
        throw new Error("Dayframe is already refreshing. Please try again.");
      }
      return;
    }
    refreshInFlight.current = true;
    const refreshGuard = captureDashboardRefreshGuard({
      currentRevision: dashboardMutationRevision.current,
      timerMutationsInFlight: timerMutationCount.current
    });
    if (options?.visibleRefresh) setRefreshing(true);
    try {
      const date = formatDateKey(new Date());
      await readPendingTimerStops();
      await hydrateTimerEntryIdCorrelations();
      let serverBootstrap = await fetchBootstrap({ date });
      const nativeDrain = await drainNativeShortcutQueue();
      for (const localId of nativeDrain.transferredLocalIds) {
        pendingNativeShortcutLocalIds.current.add(localId);
      }
      if (nativeDrain.transferredCount > 0 || pendingNativeShortcutLocalIds.current.size > 0) {
        liveActivityReconciliationDeferred.current = true;
        const syncResult = await syncQueueWithTimerReconciliation();
        for (const localId of syncResult.synced) {
          pendingNativeShortcutLocalIds.current.delete(localId);
        }
        const hasRemainingShortcutEvents = syncResult.remaining.some((event) => event.source === "shortcut");
        if (pendingNativeShortcutLocalIds.current.size === 0 && !hasRemainingShortcutEvents) {
          serverBootstrap = await fetchBootstrap({ date });
          liveActivityReconciliationDeferred.current = false;
        }
      } else {
        const pendingQueue = await readQueue().catch(() => []);
        liveActivityReconciliationDeferred.current = pendingQueue.some((event) => event.source === "shortcut");
      }
      void cacheDashboardBootstrap(serverBootstrap).catch(() => undefined);
      const owner = timerStopOwner(serverBootstrap);
      const durableWork = await readDurableLocalWork(owner);
      for (const [localId, timeEntryId] of durableWork.correlations) {
        optimisticTimerIds.current.set(localId, timeEntryId);
      }
      let bootstrap = projectDurableLocalWork(serverBootstrap, durableWork);
      const ownedPendingStops = durableWork.timerStops;
      const reconciled = await reconcileDashboardRefreshCandidate({
        candidate: bootstrap,
        currentRevision: () => dashboardMutationRevision.current,
        guard: refreshGuard,
        reconcile: reconcileDashboardDeletionState,
        timerMutationsInFlight: () => timerMutationCount.current
      });
      if (reconciled.action === "refresh") {
        refreshQueued.current = true;
        return;
      }
      bootstrap = reconciled.candidate;
      if (!timerStateRef.current) {
        timerStateRef.current = {
          activeEntryId: bootstrap.activeEntry?.id ?? null,
          updatedAt: null,
          serverNow: new Date().toISOString()
        };
      }
      latestData.current = bootstrap;
      setData(bootstrap);
      setPendingTimerStops([...ownedPendingStops]);
      syncShortcutCatalog(bootstrap);
      setAuthState("authenticated");
      void refreshLocationServices(bootstrap);
      void syncLiveActivityForEntry(bootstrap.activeEntry).finally(() => {
        void deliverOwnedPendingTimerStops(bootstrap).catch((error) => {
          if (error instanceof AuthRequiredError) transitionToSignedOut();
        });
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        transitionToSignedOut({
          preserveAuthPassword: options?.preserveAuthFormOnAuthRequired
        });
        if (options?.throwOnError) throw error;
        return;
      }
      if (options?.throwOnError) throw error;
      const cachedOfflineDashboardAvailable =
        connectivityCurrent.current.isOffline && latestData.current !== null;
      const expectedConnectivityFailure =
        connectivityCurrent.current.isOffline ||
        error instanceof StaleMobileSessionResponseError ||
        isRetryableMobileConnectivityFailure(error);
      if (
        !options?.silent &&
        !options?.visibleRefresh &&
        !cachedOfflineDashboardAvailable &&
        !expectedConnectivityFailure
      ) {
        Alert.alert(
          "Unable to refresh Dayframe",
          "Dayframe could not refresh your data. Try again in a moment."
        );
      }
    } finally {
      refreshInFlight.current = false;
      if (options?.visibleRefresh) setRefreshing(false);
      if (refreshQueued.current && timerMutationCount.current === 0) {
        refreshQueued.current = false;
        void loadRef.current({ silent: true });
      }
    }
  }, [transitionToSignedOut]);
  loadRef.current = load;

  function updateDashboardData(
    update: (current: MobileBootstrap | null) => MobileBootstrap | null
  ) {
    dashboardMutationRevision.current += 1;
    const next = filterPendingDeletedTimeEntries(
      update(latestData.current),
      deletionCoordinator.current?.pendingEntryIds() ?? new Set()
    );
    // Mutation handlers share this ref as their canonical synchronous view.
    // React may batch two Play callbacks before committing component state.
    latestData.current = next;
    setData(next);
  }

  function createSheetPresentation(
    reason: TimeEntrySheetOpenReason,
    requestDescriptionFocus: boolean
  ): TimeEntrySheetPresentation {
    const presentation = {
      allowSuggestionsOnFocus: true,
      id: ++sheetPresentationSequence.current,
      reason,
      requestDescriptionFocus
    };
    return presentation;
  }

  function presentActiveEditor(
    reason: Extract<TimeEntrySheetOpenReason, "blank_timer_started" | "existing_active_timer">,
    requestDescriptionFocus = false
  ) {
    if (rejectedOptimisticStartExit.current.current()) return;
    const entry = latestData.current?.activeEntry;
    activeEditorEntryId.current = entry?.id ?? null;
    if (entry) setPresentedActiveEntry(entry);
    const presentation = createSheetPresentation(reason, requestDescriptionFocus);
    activeEditPresentationRef.current = presentation;
    setActiveEditDismissRequestId(null);
    setActiveEditPresentation(presentation);
  }

  function presentManualEntry(entry: TimeEntry) {
    const presentation = createSheetPresentation("add_past_time", true);
    manualEntryPresentationRef.current = presentation;
    setManualDraftEntry(entry);
    setManualEntryPresentation(presentation);
  }

  function presentCompletedEntry(entry: NativeCalendarEntry) {
    const presentation = createSheetPresentation("completed_entry", false);
    calendarEditPresentationRef.current = presentation;
    setCalendarEditEntry(entry);
    setCalendarEditPresentation(presentation);
  }

  function completeActiveEditorExit(presentationId: number) {
    const rejectedStart = rejectedOptimisticStartExit.current.complete(presentationId);
    if (activeEditPresentationRef.current?.id === presentationId) {
      const blankStart = blankTimerStartGate.current.current();
      if (blankStart) blankTimerStartGate.current.release(blankStart.token);
      activateSheetDeletion(activeSheetDeletionToken, presentationId);
      activeEditPresentationRef.current = null;
      activeEditorEntryId.current = null;
      setActiveEditPresentation((current) => current?.id === presentationId ? null : current);
    }
    setActiveEditDismissRequestId((current) => current === presentationId ? null : current);
    if (rejectedStart) finalizeRejectedOptimisticStart(rejectedStart);
  }

  function completeActiveEditorPresentation(presentationId: number) {
    const presentation = activeEditPresentationRef.current;
    if (
      presentation?.id !== presentationId ||
      presentation.reason !== "blank_timer_started"
    ) {
      return;
    }
    const blankStart = blankTimerStartGate.current.current();
    if (blankStart) blankTimerStartGate.current.release(blankStart.token);
  }

  function completeManualEntryExit(presentationId: number) {
    if (manualEntryPresentationRef.current?.id !== presentationId) return;
    manualEntryPresentationRef.current = null;
    setManualEntryPresentation((current) => current?.id === presentationId ? null : current);
    setManualDraftEntry(null);
  }

  function completeCalendarEntryExit(presentationId: number) {
    if (calendarEditPresentationRef.current?.id !== presentationId) return;
    activateSheetDeletion(calendarSheetDeletionToken, presentationId);
    calendarEditPresentationRef.current = null;
    setCalendarEditPresentation((current) => current?.id === presentationId ? null : current);
    setCalendarEditEntry(null);
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

  async function resolvePersistedTimerEntryId(entryId: string) {
    const knownId = persistedTimerEntryId(entryId);
    if (knownId || !entryId.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)) return knownId;
    const durableId = await resolveTimerEntryIdAfterQueueBarrier(entryId);
    if (durableId) applyTimerEntryIdCorrelation(entryId, durableId);
    return durableId;
  }

  function serializeTimerPersistence<Result>(operation: () => Promise<Result>) {
    return timerMutationQueue.current.enqueue(operation);
  }

  function enqueueTimerMutation(operation: () => Promise<void>) {
    timerMutationCount.current += 1;
    const run = serializeTimerPersistence(operation).catch(() => undefined);
    void run.finally(() => {
      timerMutationCount.current = Math.max(0, timerMutationCount.current - 1);
      if (timerMutationCount.current === 0) {
        queuedTimerStartRecoveryRequested.current = false;
        refreshQueued.current = true;
        void loadRef.current({ silent: true });
      }
    });
    return run;
  }

  const syncQueuedEventsAndReload = useCallback(async () => {
    if (authState !== "authenticated") return;
    try {
      await syncQueuedEvents();
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        transitionToSignedOut();
      }
    }
  }, [authState, load, syncQueuedEvents, transitionToSignedOut]);

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
        transitionToSignedOut();
        return;
      }
      console.warn(friendlyHealthKitError(error, "sync Apple Health"));
    } finally {
      healthAutoSyncInFlight.current = false;
    }
  }, [authState, load, syncQueuedEvents, transitionToSignedOut]);

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
    if (activeEditorOpenFrame.current !== null) {
      cancelAnimationFrame(activeEditorOpenFrame.current);
      activeEditorOpenFrame.current = null;
    }
    const blankStart = blankTimerStartGate.current.current();
    if (blankStart) blankTimerStartGate.current.release(blankStart.token);
    // A provider teardown cannot safely finish an account-scoped mutation. Treat
    // outstanding Undo work as cancelled so the server copy remains recoverable.
    deletionCoordinator.current?.dispose();
  }, []);

  useEffect(() => {
    const openDashboard = async () => {
      const cached = await loadCachedDashboardBootstrap().catch(() => null);
      if (cached && !latestData.current) {
        const owner = timerStopOwner(cached.bootstrap);
        const sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner).catch(() => null);
        if (sessionRead?.status !== "authenticated") {
          await loadRef.current();
          return;
        }
        let filtered = cached.bootstrap;
        let durableWork = null;
        await activateMobileAccount(owner);
        durableWork = await readDurableLocalWork(owner);
        for (const [localId, timeEntryId] of durableWork.correlations) {
          optimisticTimerIds.current.set(localId, timeEntryId);
        }
        timerIdCorrelationsLoaded.current = true;
        filtered = projectDurableLocalWork(cached.bootstrap, durableWork);
        const pendingDeletionIds = await reconcilePendingActiveDeletionAfterQueueBarrier(
          filtered.activeEntry?.id ?? null
        );
        filtered = filterPendingDeletedTimeEntries(
          filtered,
          pendingDeletionIds
        ) as MobileBootstrap;
        latestData.current = filtered;
        setData(filtered);
        setPendingTimerStops([...(durableWork?.timerStops ?? [])]);
        setAuthState("authenticated");
      }
      await loadRef.current();
    };
    if (AppState.currentState === "active") {
      void openDashboard();
      return undefined;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      subscription.remove();
      void openDashboard();
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
    }, [reloadThemePreference])
  );

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (
        authState === "authenticated" &&
        AppState.currentState === "active"
      ) {
        void load({ silent: true });
      }
    }, TIMER_STATE_RECONCILE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [authState, load]);

  useEffect(() => {
    if (authState !== "authenticated") {
      timerStateRef.current = null;
      return undefined;
    }
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      if (cancelled || AppState.currentState !== "active") return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (
        cancelled ||
        AppState.currentState !== "active" ||
        timerStatePollInFlight.current
      ) return;
      timerStatePollInFlight.current = true;
      try {
        const fetched = await fetchTimerState();
        const tombstones = await reconcilePendingActiveDeletionAfterQueueBarrier(
          fetched.activeEntryId
        );
        const next = fetched.activeEntryId && tombstones.has(fetched.activeEntryId)
          ? { ...fetched, activeEntryId: null }
          : fetched;
        const changed = timerStateChanged(timerStateRef.current, next);
        timerStateRef.current = next;
        consecutiveFailures = 0;
        if (changed) await loadRef.current({ silent: true });
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          cancelled = true;
          transitionToSignedOut();
          return;
        }
        consecutiveFailures += 1;
      } finally {
        timerStatePollInFlight.current = false;
        schedule(timerStatePollDelay(consecutiveFailures));
      }
    };

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        schedule(0);
      } else if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    });
    schedule(0);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      subscription.remove();
    };
  }, [authState, transitionToSignedOut]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (calendarBackgroundedAt.current == null) {
          const backgroundedAt = Date.now();
          calendarBackgroundedAt.current = backgroundedAt;
          calendarBackgroundedDayKey.current = formatDateKey(new Date(backgroundedAt));
        }
        return;
      }

      const resumedAt = Date.now();
      const resumedDayKey = formatDateKey(new Date(resumedAt));
      setNow(resumedAt);
      setSelectedDayKey((current) => {
        if (!shouldResetCalendarToTodayOnForeground({
          backgroundedAt: calendarBackgroundedAt.current,
          backgroundedDayKey: calendarBackgroundedDayKey.current,
          resumedAt,
          selectedDayKey: current,
          todayKey: resumedDayKey
        })) {
          return current;
        }
        setCalendarTransitionDirection(
          dateFromKey(resumedDayKey).getTime() >= dateFromKey(current).getTime() ? 1 : -1
        );
        return resumedDayKey;
      });
      calendarBackgroundedAt.current = null;
      calendarBackgroundedDayKey.current = null;

      if (authState === "authenticated") {
        deletionCoordinator.current?.reconcileForeground();
        void syncHealthKitAndReload("foreground");
      }
    });
    return () => subscription.remove();
  }, [authState, syncHealthKitAndReload]);

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
  const activeEntryForDisplay = data?.activeEntry ?? null;
  const activeDurationSeconds = activeTimerElapsedSeconds(activeEntryForDisplay, now);
  const hasLiveActiveTimer = Boolean(activeEntryForDisplay);

  useEffect(() => {
    if (activeEntryForDisplay) {
      activeEditorEntryId.current = activeEditPresentationRef.current
        ? activeEntryForDisplay.id
        : activeEditorEntryId.current;
      setPresentedActiveEntry(activeEntryForDisplay);
      return undefined;
    }

    if (activeEditPresentation && shouldDismissExternallyStoppedActiveEditor({
      activeEntryId: null,
      presentationId: activeEditPresentation.id,
      presentedEntryId: activeEditorEntryId.current,
      timerMutationsInFlight: timerMutationCount.current
    })) {
      setActiveEditDismissRequestId(activeEditPresentation.id);
      return undefined;
    }

    if (activeEditPresentation) return undefined;

    if (reduceMotion) {
      setPresentedActiveEntry(null);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setPresentedActiveEntry(null);
    }, MOBILE_MOTION.layout + 80);
    return () => clearTimeout(timeout);
  }, [activeEditPresentation, activeEntryForDisplay, reduceMotion]);

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
    opacity: activeTimerExpansion
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
  const retainedActiveEntryForSheet = activeEntryForDisplay ?? presentedActiveEntry;
  const pendingDeletionEntryIds = new Set(pendingDeletion?.entryIds ?? []);
  const displayedActiveEntry = dashboardActiveTimerEntry({
    activeEntry: activeEntryForDisplay,
    pendingDeletionEntryIds,
    presentedEntry: presentedActiveEntry
  });
  const displayedActiveDurationSeconds = retainedActiveEntryForSheet && activeEntryForDisplay
    ? activeDurationSeconds
    : activeTimerElapsedSeconds(retainedActiveEntryForSheet, now);
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
  useEffect(() => {
    if (liveActivityReconciliationDeferred.current) return;
    void syncLiveActivityForEntry(data?.activeEntry ?? null);
  }, [data]);

  async function startTask(categoryId?: string | null, description = "", tagNames: string[] = []) {
    const isBlankStart = !categoryId && !description.trim();
    if (isBlankStart && blankTimerStartGate.current.current()) return false;
    if (
      latestData.current?.activeEntry &&
      !isActiveEntryPendingDeletion() &&
      isBlankStart
    ) {
      presentActiveEditor("existing_active_timer");
      return false;
    }
    if (isBlankStart) {
      const blankStartToken = blankTimerStartGate.current.claim();
      if (blankStartToken === null) return false;
      try {
        const accepted = await startTaskWith(
          {
            categoryId: null,
            description: null,
            startedAt: null
          },
          { animateLayout: false, blankStartToken }
        );
        const currentClaim = blankTimerStartGate.current.current();
        if (!accepted || currentClaim?.token !== blankStartToken) {
          blankTimerStartGate.current.release(blankStartToken);
          return false;
        }
        if (activeEditorOpenFrame.current !== null) {
          cancelAnimationFrame(activeEditorOpenFrame.current);
        }
        activeEditorOpenFrame.current = requestAnimationFrame(() => {
          activeEditorOpenFrame.current = null;
          if (blankTimerStartGate.current.current()?.token !== blankStartToken) return;
          presentActiveEditor("blank_timer_started", true);
        });
        return true;
      } catch (error) {
        blankTimerStartGate.current.release(blankStartToken);
        throw error;
      }
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
    presentManualEntry(createManualDraftEntry(Date.now()));
  }

  function openCalendarManualEntry(dayKey: string, startMinute: number) {
    const result = resolveCalendarManualEntryRequest({
      dayKey,
      selectedDayKey,
      startMinute,
      now: Date.now()
    });
    if (!result.ok) {
      if (!result.ignored) Alert.alert("Unable to add time", result.error);
      return;
    }
    presentManualEntry(result.entry);
  }

  async function saveManualEntry(_entryId: string, patch: TimeEntryUpdatePatch) {
    if (!patch.startedAt || !patch.stoppedAt || manualEntrySavingRef.current) return false;
    manualEntrySavingRef.current = true;
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
        transitionToSignedOut();
        return false;
      }
      Alert.alert(
        "Time not added",
        isRetryableMobileConnectivityFailure(error)
          ? "This time needs a connection and was not added. Your draft is still open so you can try again."
          : "Dayframe could not add this time. Check the details and try again."
      );
      return false;
    } finally {
      manualEntrySavingRef.current = false;
      setManualEntrySaving(false);
    }
  }

  async function createTimerSheetTag(name: string) {
    try {
      const response = await createTag(name);
      updateDashboardData((current) => mergePersistedMobileTag(current, response.tag));
      return response.tag;
    } catch (error) {
      if (error instanceof AuthRequiredError) transitionToSignedOut();
      return null;
    }
  }

  async function applyRunningTimerSuggestion(entryId: string, suggestion: RecentActivitySuggestion) {
    const activeEntry = latestData.current?.activeEntry;
    if (!activeEntry || activeEntry.id !== entryId) return false;
    return saveTimeEntryOptimistically(
      entryId,
      {
        categoryId: suggestion.categoryId,
        description: suggestion.description,
        tagNames: suggestion.tagNames
      },
      "Timer not saved"
    );
  }

  async function startTaskWith(input: {
    categoryId?: string | null;
    description?: string | null;
    startedAt?: string | null;
    tagNames?: string[];
  }, options: { animateLayout?: boolean; blankStartToken?: number } = {}) {
    if (!latestData.current) return false;
    commitPendingActiveDeletionBeforeTimerStart();
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
    if (
      options.blankStartToken !== undefined &&
      !blankTimerStartGate.current.bindEntry(options.blankStartToken, optimisticId)
    ) {
      return false;
    }
    const previousData = latestData.current;
    try {
      const queue = await enqueueEvent({
        owner: timerStopOwner(previousData),
        localId: optimisticId,
        source: "mobile_app",
        type: "timer_start",
        occurredAt: new Date(pendingEntry.startedAt),
        categoryId: pendingEntry.categoryId ?? undefined,
        description: pendingEntry.description?.trim() || undefined,
        rawPayload: {
          origin: "mobile_timer_start",
          startedAt: pendingEntry.startedAt,
          tagNames: pendingEntry.tagNames ?? []
        },
        requestImmediateDelivery: connectivityCurrent.current.isOnline
      });
      if (!queue.some((item) => item.localId === optimisticId && item.type === "timer_start")) {
        throw new Error("The offline timer start could not be queued.");
      }
    } catch {
      if (options.blankStartToken !== undefined) {
        blankTimerStartGate.current.release(options.blankStartToken);
      }
      Alert.alert(
        "Timer not started",
        "Dayframe could not save this timer on your iPhone. Check available storage and try again."
      );
      return false;
    }

    optimisticTimerStartReconciler.current.begin(optimisticId);
    settleOptimisticTimerStart(optimisticId, "queued");
    queuedTimerStartRecoveryRequested.current = true;
    nextTimerMutationVersion(optimisticId);
    updateDashboardData((current) => optimisticStartTimer(current, pendingEntry));
    if (options.animateLayout !== false) scheduleLayoutTransition(reduceMotion);
    if (connectivityCurrent.current.isOnline) {
      void syncQueuedEventsAndReload();
    }
    return true;
  }

  function rejectOptimisticTimerStart(
    optimisticId: string,
    previousData: MobileBootstrap | null,
    error: unknown
  ) {
    const rollbackSnapshot = supersededStopRollbackTracker.current.consume(
      optimisticId,
      previousData
    );
    const pending = deletionCoordinator.current?.current();
    if (pending?.entryIds.includes(optimisticId)) {
      clearSheetDeletionToken(pending.token);
      deletionCoordinator.current?.invalidatePendingEntry(optimisticId);
    }

    // Any queued Save/Stop/Delete work captured an older generation and must
    // not restore or mutate an optimistic timer whose start never existed.
    nextTimerMutationVersion(optimisticId);
    optimisticTimerIds.current.delete(optimisticId);
    settleOptimisticTimerStart(optimisticId, "rejected");
    const ownerSource = latestData.current ?? previousData;
    if (ownerSource) {
      void removePendingTimerStopsForTarget(timerStopOwner(ownerSource), {
        optimisticEntryId: optimisticId
      }).then(() => readOwnedPendingTimerStops(ownerSource))
        .then(setPendingTimerStops)
        .catch(() => undefined);
    }

    const blankStart = blankTimerStartGate.current.current();
    if (blankStart?.entryId === optimisticId) {
      if (activeEditorOpenFrame.current !== null) {
        cancelAnimationFrame(activeEditorOpenFrame.current);
        activeEditorOpenFrame.current = null;
      }
      blankTimerStartGate.current.release(blankStart.token);
    }

    const failedPresentation = activeEditPresentationRef.current;
    if (failedPresentation && activeEditorEntryId.current === optimisticId) {
      const scheduled = rejectedOptimisticStartExit.current.schedule(
        failedPresentation.id,
        { error, optimisticId, previousData: rollbackSnapshot }
      );
      if (
        scheduled ||
        rejectedOptimisticStartExit.current.current()?.presentationId === failedPresentation.id
      ) {
        setActiveEditDismissRequestId(failedPresentation.id);
        return;
      }
    }

    finalizeRejectedOptimisticStart({
      error,
      optimisticId,
      previousData: rollbackSnapshot
    });
  }

  function finalizeRejectedOptimisticStart({
    optimisticId,
    previousData
  }: RejectedOptimisticStart) {
    updateDashboardData((current) => rollbackRejectedOptimisticTimerStart(
      current,
      previousData,
      optimisticId
    ));
    Alert.alert(
      "Timer not started",
      "Dayframe could not start this timer because the saved request was rejected. Check Sync and diagnostics for details."
    );
    setPresentedActiveEntry((current) => current?.id === optimisticId ? null : current);
  }

  async function saveActiveTimerEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    return saveTimeEntryOptimistically(
      entryId,
      patch,
      "Timer not saved",
      { awaitPersistence: true }
    );
  }

  async function saveCalendarEntryEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    return saveTimeEntryOptimistically(
      entryId,
      patch,
      "Entry not saved",
      { awaitPersistence: true }
    );
  }

  async function saveTimeEntryOptimistically(
    entryId: string,
    patch: TimeEntryUpdatePatch,
    errorTitle: string,
    _options: { awaitPersistence?: boolean } = {}
  ) {
    const bootstrap = latestData.current;
    if (!bootstrap) return false;
    if (!optimisticTimerStartReconciler.current.canRunDependentMutation(entryId)) {
      return false;
    }
    const owner = timerStopOwner(bootstrap);
    const persistedId = persistedTimerEntryId(entryId);
    try {
      await enqueueTimeEntryUpdate({
        owner,
        target: persistedId
          ? { targetEntryId: persistedId }
          : { optimisticEntryId: entryId },
        patch,
        requestImmediateDelivery: connectivityCurrent.current.isOnline
      });
    } catch {
      Alert.alert(
        errorTitle,
        "Dayframe could not save this change on your iPhone. Check available storage and try again."
      );
      return false;
    }

    nextTimerMutationVersion(entryId);
    updateDashboardData((current) => optimisticPatchTimeEntry(current, entryId, patch));
    queuedTimerStartRecoveryRequested.current = true;

    if (connectivityCurrent.current.isOnline) {
      void (async () => {
        const correlations = await readTimerEntryIdCorrelations(owner);
        const result = await synchroniseTimeEntryCommands({
          owner,
          correlations,
          force: true
        });
        if (result.reason === "authentication_required") {
          transitionToSignedOut();
          return;
        }
        if (result.deliveredCount > 0 || result.needsAttentionCount > 0) {
          await loadRef.current({ silent: true });
        }
        if (result.needsAttentionCount > 0) {
          Alert.alert(
            "Time entry change not applied",
            "The server rejected this change, so Dayframe restored the server version. You can retry or discard the saved diagnostic in Settings > Sync & diagnostics."
          );
        }
      })().catch(() => undefined);
    }
    return true;
  }

  async function deleteCalendarEntry(entryId: string) {
    const presentationId = calendarEditPresentationRef.current?.id;
    if (!presentationId) return false;
    return prepareSheetDeletion(
      entryId,
      calendarEditEntry,
      calendarSheetDeletionToken,
      presentationId
    );
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
    if (!optimisticTimerStartReconciler.current.canRunDependentMutation(activeEntry.id)) return false;
    const bootstrap = latestData.current;
    if (!bootstrap) return false;
    const stoppedAt = new Date().toISOString();
    let pendingStop: PendingTimerStop;
    let stopBackgroundReservation: Promise<void> | null;
    try {
      const persistedId = persistedTimerEntryId(activeEntry.id);
      const persisted = await persistPendingTimerStop({
        owner: timerStopOwner(bootstrap),
        target: persistedId
          ? { targetEntryId: persistedId }
          : { optimisticEntryId: activeEntry.id },
        occurredAt: stoppedAt,
        requestImmediateDelivery: connectivityCurrent.current.isOnline
      });
      pendingStop = persisted.pendingStop;
      stopBackgroundReservation = persisted.backgroundReservation;
    } catch {
      Alert.alert(
        "Timer not stopped",
        "Dayframe could not save this Stop on your iPhone. Check available storage and try again."
      );
      return false;
    }
    if (pendingStop.failureKind === "permanent") {
      Alert.alert(
        "Timer Stop needs attention",
        "Open Settings > Sync & diagnostics to retry or discard the rejected Stop."
      );
      return false;
    }

    setPendingTimerStops((current) => [
      ...current.filter((item) => item.clientEventId !== pendingStop.clientEventId),
      pendingStop
    ]);
    updateDashboardData((current) => optimisticStopActiveTimer(current, pendingStop.occurredAt));
    scheduleLayoutTransition(reduceMotion);

    void (async () => {
      if (!stopBackgroundReservation) return;
      await stopBackgroundReservation;
      if (!pendingStop.targetEntryId && activeEntry.id.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)) {
        const persistedId = await resolvePersistedTimerEntryId(activeEntry.id);
        if (persistedId) {
          const resolved = await resolvePendingTimerStopTargets(
            new Map([[activeEntry.id, persistedId]]),
            timerStopOwner(bootstrap)
          );
          pendingStop = resolved.find((item) => item.clientEventId === pendingStop.clientEventId) ?? pendingStop;
        }
      }
      const summary = await deliverOwnedPendingTimerStops(bootstrap, {
        reloadAfterDelivery: false
      });
      if (summary.permanentRejectedClientEventIds.includes(pendingStop.clientEventId)) {
        updateDashboardData((current) => rollbackOptimisticStopSafely(
          current,
          bootstrap,
          activeEntry.id,
          optimisticTimerIds.current
        ));
        scheduleLayoutTransition(reduceMotion);
      }
      if (summary.deliveredCount > 0 || summary.permanentRejectedCount > 0) {
        void loadRef.current({ silent: true });
      }
    })().catch((error) => {
      if (error instanceof AuthRequiredError) transitionToSignedOut();
    });
    return true;
  }

  async function deleteActiveTimer(entryId: string) {
    const presentationId = activeEditPresentationRef.current?.id;
    if (!presentationId) return false;
    scheduleLayoutTransition(reduceMotion);
    return prepareSheetDeletion(
      entryId,
      presentedActiveEntry,
      activeSheetDeletionToken,
      presentationId
    );
  }

  async function persistPreparedDeletion(
    entries: TimeEntry[],
    snapshot: MobileBootstrap | null,
    token: number
  ) {
    const bootstrap = snapshot ?? latestData.current;
    if (!bootstrap) return false;
    const owner = timerStopOwner(bootstrap);
    const commandIds: string[] = [];
    try {
      for (const entry of entries) {
        const persistedId = persistedTimerEntryId(entry.id);
        const command = await enqueueTimeEntryDelete({
          owner,
          target: persistedId
            ? { targetEntryId: persistedId }
            : { optimisticEntryId: entry.id },
          // A force-quit during Undo keeps the deletion durable. The normal
          // coordinator releases this hold as soon as the Undo window commits.
          deliverAfter: new Date(Date.now() + DELETION_UNDO_MS + 1_000).toISOString()
        });
        commandIds.push(command.clientCommandId);
      }
      deletionCommandIds.current.set(token, commandIds);
      return true;
    } catch {
      await removeTimeEntryCommands(commandIds).catch(() => undefined);
      getDeletionCoordinator().invalidate(token);
      Alert.alert(
        entries.length > 1 ? "Entries not deleted" : "Entry not deleted",
        "Dayframe could not save this deletion on your iPhone. Check available storage and try again."
      );
      return false;
    }
  }

  function commitDeletion(
    entries: TimeEntry[],
    snapshot: MobileBootstrap | null,
    token: number
  ) {
    const versions = new Map(entries.map((entry) => [entry.id, nextTimerMutationVersion(entry.id)]));
    const commandIds = deletionCommandIds.current.get(token) ?? [];
    deletionCommandIds.current.delete(token);
    enqueueTimerMutation(async () => {
      const bootstrap = snapshot ?? latestData.current;
      if (!bootstrap) return;
      const owner = timerStopOwner(bootstrap);
      try {
        await releaseTimeEntryCommands(commandIds, {
          owner,
          requestImmediateDelivery: connectivityCurrent.current.isOnline
        });
      } catch {
        await removeTimeEntryCommands(commandIds).catch(() => undefined);
        const actionableFailures = entries
          .filter((entry) => isCurrentTimerMutation(entry.id, versions.get(entry.id) as number))
        const currentIds = actionableFailures.map((entry) => entry.id);
        if (currentIds.length === 0) return;
        updateDashboardData((current) => restoreFailedDeletionSafely(
          current,
          snapshot,
          currentIds,
          optimisticTimerIds.current
        ));
        Alert.alert(
          currentIds.length > 1 ? "Entries not deleted" : "Entry not deleted",
          "Dayframe could not finish saving this deletion on your iPhone. The time entry was restored; check available storage and try again."
        );
        AccessibilityInfo.announceForAccessibility(
          currentIds.length > 1
            ? "Time entries restored because deletion failed."
            : "Time entry restored because deletion failed."
        );
        return;
      }
      queuedTimerStartRecoveryRequested.current = true;
      if (connectivityCurrent.current.isOnline) {
        const correlations = await readTimerEntryIdCorrelations(owner);
        const result = await synchroniseTimeEntryCommands({
          owner,
          correlations,
          force: true
        });
        if (result.reason === "authentication_required") {
          transitionToSignedOut();
          return;
        }
        if (result.deliveredCount > 0) await loadRef.current({ silent: true });
      }
    });
  }

  function getDeletionCoordinator() {
    if (!deletionCoordinator.current) {
      deletionCoordinator.current = createDeletionCoordinator<
        TimeEntry,
        MobileBootstrap | null
      >({
        onCommit: ({ entries, snapshot, token }) => {
          clearSheetDeletionToken(token);
          commitDeletion(entries, snapshot, token);
        },
        onPendingChange: setPendingDeletion,
        onRestore: ({ entries, snapshot, token }) => {
          const commandIds = deletionCommandIds.current.get(token) ?? [];
          deletionCommandIds.current.delete(token);
          void removeTimeEntryCommands(commandIds).catch(() => undefined);
          updateDashboardData((current) => restoreDeletedTimeEntriesSafely(
            current,
            snapshot,
            entries.map((entry) => entry.id),
            optimisticTimerIds.current
          ));
        }
      });
    }
    return deletionCoordinator.current;
  }

  async function scheduleHistoryDeletion(entries: TimeEntry[]) {
    if (deletionPreparationInFlight.current) return;
    deletionPreparationInFlight.current = true;
    const snapshot = latestData.current;
    const coordinator = getDeletionCoordinator();
    const prepared = coordinator.prepare(entries, snapshot);
    try {
      if (!prepared || !await persistPreparedDeletion(entries, snapshot, prepared.token)) return;
      updateDashboardData((current) => filterPendingDeletedTimeEntries(
        current,
        coordinator.pendingEntryIds()
      ));
      coordinator.activate(prepared.token);
      AccessibilityInfo.announceForAccessibility(
        entries.length > 1
          ? `${entries.length} time entries deleted. Undo available for five seconds.`
          : "Time entry deleted. Undo available for five seconds."
      );
    } finally {
      deletionPreparationInFlight.current = false;
    }
  }

  function undoDeletion() {
    if (!pendingDeletion || pendingDeletion.phase !== "active") return;
    if (getDeletionCoordinator().undo(pendingDeletion.token)) {
      AccessibilityInfo.announceForAccessibility(
        pendingDeletion.entries.length > 1 ? "Time entries restored." : "Time entry restored."
      );
    }
  }

  async function prepareSheetDeletion(
    entryId: string,
    presentedEntry: TimeEntry | null,
    tokenRef: { current: { presentationId: number; token: number } | null },
    presentationId: number
  ) {
    if (tokenRef.current !== null || deletionPreparationInFlight.current) return false;
    deletionPreparationInFlight.current = true;
    const snapshot = latestData.current;
    const entry = mobileTimeEntryById(snapshot, entryId) ?? (
      presentedEntry?.id === entryId ? presentedEntry : null
    );
    if (!entry) {
      deletionPreparationInFlight.current = false;
      return false;
    }

    const coordinator = getDeletionCoordinator();
    const prepared = coordinator.prepare([entry], snapshot);
    try {
      if (!prepared || !await persistPreparedDeletion([entry], snapshot, prepared.token)) return false;
      tokenRef.current = { presentationId, token: prepared.token };
      updateDashboardData((current) => filterPendingDeletedTimeEntries(
        current,
        coordinator.pendingEntryIds()
      ));
      return true;
    } finally {
      deletionPreparationInFlight.current = false;
    }
  }

  function activateSheetDeletion(
    tokenRef: { current: { presentationId: number; token: number } | null },
    presentationId: number
  ) {
    const pendingSheetDeletion = tokenRef.current;
    if (pendingSheetDeletion?.presentationId !== presentationId) return;
    tokenRef.current = null;
    if (!getDeletionCoordinator().activate(pendingSheetDeletion.token)) return;
    const active = getDeletionCoordinator().current();
    AccessibilityInfo.announceForAccessibility(
      active && active.entries.length > 1
        ? `${active.entries.length} time entries deleted. Undo available for five seconds.`
        : "Time entry deleted. Undo available for five seconds."
    );
  }

  function clearSheetDeletionToken(token: number) {
    if (activeSheetDeletionToken.current?.token === token) {
      activeSheetDeletionToken.current = null;
    }
    if (calendarSheetDeletionToken.current?.token === token) {
      calendarSheetDeletionToken.current = null;
    }
  }

  function commitPendingActiveDeletionBeforeTimerStart() {
    const coordinator = deletionCoordinator.current;
    const pending = coordinator?.current();
    if (coordinator && pending && isActiveEntryPendingDeletion()) {
      coordinator.commit(pending.token);
    }
  }

  function isActiveEntryPendingDeletion() {
    const pending = deletionCoordinator.current?.current();
    const deletedActiveId = pending?.snapshot?.activeEntry?.id;
    return Boolean(
      pending &&
      deletedActiveId &&
      pending.entryIds.includes(deletedActiveId)
    );
  }

  async function submitAuth() {
    if (authSubmittingRef.current) return;
    authSubmittingRef.current = true;
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
        setAuthPasswordVisible(false);
        setAuthNotice(auth.message);
        setAuthView("login");
        setAuthState("signedOut");
        return;
      }
      setAuthPasswordVisible(false);
      setAuthState("opening");
      preserveAuthPasswordOnSignedOut.current = true;
      try {
        await load({
          preserveAuthFormOnAuthRequired: true,
          throwOnError: true
        });
      } finally {
        preserveAuthPasswordOnSignedOut.current = false;
      }
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to authenticate");
      setAuthState("signedOut");
    } finally {
      authSubmittingRef.current = false;
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
  if (authState === "opening") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <DashboardBrandLockup styles={styles} theme={theme} />
          </View>
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            style={styles.panel}
          >
            <Text style={styles.sectionTitle}>Opening Dayframe…</Text>
            <Text style={styles.muted}>
              Loading your latest timers and saved activity.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }
  if (authState === "signedOut") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <DashboardBrandLockup styles={styles} theme={theme} />
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
                  onSubmitEditing={() => authWorkspaceRef.current?.focus()}
                  placeholder="Name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoComplete="off"
                  textContentType="none"
                  returnKeyType="next"
                  submitBehavior="submit"
                />
                <TextInput
                  ref={authWorkspaceRef}
                  style={styles.textInput}
                  value={authWorkspace}
                  onChangeText={setAuthWorkspace}
                  onSubmitEditing={() => authEmailRef.current?.focus()}
                  placeholder="Workspace"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoComplete="off"
                  textContentType="none"
                  returnKeyType="next"
                  submitBehavior="submit"
                />
              </>
            ) : null}
            <TextInput
              ref={authEmailRef}
              style={styles.textInput}
              value={authEmail}
              onChangeText={setAuthEmail}
              onSubmitEditing={() => authPasswordRef.current?.focus()}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              keyboardType="email-address"
              spellCheck={false}
              textContentType="none"
              returnKeyType="next"
              submitBehavior="submit"
            />
            <View style={styles.authPasswordField}>
              <View style={styles.authPasswordInputFrame}>
                <TextInput
                  ref={authPasswordRef}
                  style={[
                    styles.textInput,
                    styles.authPasswordInput,
                    authPasswordVisible ? styles.authPasswordInputRevealed : null
                  ]}
                  value={authPassword}
                  onChangeText={setAuthPassword}
                  onSubmitEditing={submitAuth}
                  placeholder="Password"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  caretHidden={authPasswordVisible}
                  returnKeyType="done"
                  secureTextEntry
                  spellCheck={false}
                  submitBehavior="blurAndSubmit"
                  textContentType="none"
                />
                {authPasswordVisible && authPassword ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    style={styles.authPasswordRevealOverlay}
                  >
                    <Text numberOfLines={1} style={styles.authPasswordRevealText}>
                      {authPassword}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Pressable
                accessibilityLabel={authPasswordVisible ? "Hide password" : "Show password"}
                accessibilityRole="button"
                accessibilityState={{ selected: authPasswordVisible }}
                onPress={() => setAuthPasswordVisible((visible) => !visible)}
                style={({ pressed }) => [
                  styles.authPasswordVisibilityButton,
                  pressed ? styles.authPasswordVisibilityPressed : null
                ]}
              >
                <PasswordVisibilityGlyph
                  color={theme.textSecondary}
                  passwordVisible={authPasswordVisible}
                />
              </Pressable>
            </View>
            {authNotice ? <Text style={styles.statusText}>{authNotice}</Text> : null}
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Pressable
              accessibilityState={{ disabled: authSubmitting }}
              disabled={authSubmitting}
              style={pressable(
                [styles.primaryButton, authSubmitting ? styles.buttonDisabled : null],
                styles.buttonPressed
              )}
              onPress={submitAuth}
            >
              <Text style={styles.primaryButtonText}>
                {authSubmitting ? "Working..." : authView === "signup" ? "Create account" : "Log in"}
              </Text>
            </Pressable>
            <Pressable
              style={pressable([styles.secondaryButton, styles.authSecondaryButton], styles.buttonPressed)}
              onPress={() => {
                setAuthError(null);
                setAuthPasswordVisible(false);
                setAuthView(authView === "signup" ? "login" : "signup");
              }}
            >
              <Text style={[styles.secondaryButtonText, styles.authSecondaryButtonText]}>
                {authView === "signup" ? "Use existing account" : "Create account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
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
                <DashboardBrandLockup isFocused={isFocused} styles={styles} theme={theme} />
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
                  onPress={() => presentActiveEditor("existing_active_timer")}
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
                      <PrimaryTimerAction
                        accessibilityLabel="Stop current timer"
                        backgroundColor={theme.accent}
                        glyphColor={theme.onAccent}
                        mode="stop"
                        onPress={(event) => {
                          event.stopPropagation();
                          void stopActiveTimer();
                        }}
                      />
                      <Pressable
                        accessibilityLabel="Add past time"
                        accessibilityRole="button"
                        onPress={(event) => {
                          event.stopPropagation();
                          openManualEntry();
                        }}
                        style={pressable(styles.addPastTimeButton, styles.buttonPressed)}
                        testID="active-timer-add-past-time"
                      >
                        <PlusGlyph color={theme.accentText} />
                      </Pressable>
                    </Animated.View>
                  </View>
                </Pressable>
              ) : (
                <View style={[styles.panel, styles.idleTimerPanel]}>
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
                      <View style={styles.quickActionsGroup}>
                        <Text style={styles.quickCategoryHint}>QUICK ACTIONS</Text>
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
                                hitSlop={{
                                  top: TIMER_CARD_QUICK_ACTION_HIT_SLOP,
                                  bottom: TIMER_CARD_QUICK_ACTION_HIT_SLOP
                                }}
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
                    </View>
                    <View style={styles.startActionColumn}>
                      <PrimaryTimerAction
                        accessibilityLabel="Start task"
                        backgroundColor={theme.accent}
                        glyphColor={theme.onAccent}
                        mode="play"
                        onPress={startBlankTask}
                      />
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
                  presentActiveEditor("existing_active_timer");
                  return;
                }
                presentCompletedEntry({ ...entry, isActive: false });
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
              calendarEditPresentationRef.current = null;
              setCalendarEditEntry(null);
              setCalendarEditPresentation(null);
              presentActiveEditor("existing_active_timer");
            },
            onOpenCompleted: presentCompletedEntry,
            onOpenReview: () => router.push("/review")
          }
        );
      };

      return (
        <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
          <View style={styles.nativeCalendarScreen}>
            <Animated.View style={[styles.nativeCalendarHeader, enteringStyle]}>
              <DashboardBrandLockup isFocused={isFocused} styles={styles} theme={theme} />
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
              onRequestCreateEntry={(event) => {
                openCalendarManualEntry(
                  event.nativeEvent.dayKey,
                  event.nativeEvent.startMinute
                );
              }}
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
            <DashboardBrandLockup isFocused={isFocused} styles={styles} theme={theme} />
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
            coveredTotal={reports.coveredTotal}
            additionalOverlapTotal={reports.additionalOverlapTotal}
            loggedTotal={reports.loggedTotal}
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
      {pendingDeletion?.phase === "active" ? (
        <Reanimated.View
          key={pendingDeletion.token}
          accessibilityLiveRegion="polite"
          entering={localPresenceEntering(reduceMotion, "rise")}
          exiting={localPresenceExiting(reduceMotion)}
          layout={localLayoutTransition(reduceMotion)}
          style={styles.historyDeleteUndoToast}
        >
          <Text style={styles.historyDeleteUndoText}>
            {pendingDeletion.entries.length === 1
              ? "Time entry deleted"
              : `${pendingDeletion.entries.length} time entries deleted`}
          </Text>
          <Pressable
            accessibilityLabel="Undo deleting time entries"
            accessibilityRole="button"
            onPress={undoDeletion}
            style={({ pressed }) => [styles.historyDeleteUndoButton, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.historyDeleteUndoButtonText}>Undo</Text>
          </Pressable>
        </Reanimated.View>
      ) : null}
      {manualEntryPresentation && reduceMotionPreferenceResolved ? <ActiveTimerEditSheet
        categories={sortedCategories}
        descriptionPlaceholder="What have you been working on?"
        elapsedSeconds={manualDraftEntry?.durationSeconds ?? 0}
        entry={manualDraftEntry}
        historicalEntries={historySourceEntries}
        lastStoppedAt={recentStoppedAt}
        mode="add"
        onCancel={completeManualEntryExit}
        onCreateTag={createTimerSheetTag}
        onSave={saveManualEntry}
        presentation={manualEntryPresentation}
        reduceMotion={reduceMotion}
        saving={manualEntrySaving}
        stopping={false}
        styles={styles}
        tags={data?.tags ?? []}
        theme={theme}
        visible={Boolean(manualDraftEntry && manualEntryPresentation)}
      /> : null}
      {activeEditPresentation && reduceMotionPreferenceResolved ? <ActiveTimerEditSheet
        categories={sortedCategories}
        dismissRequestId={activeEditDismissRequestId}
        elapsedSeconds={displayedActiveDurationSeconds}
        entry={retainedActiveEntryForSheet}
        historicalEntries={historySourceEntries}
        lastStoppedAt={recentStoppedAt}
        onApplySuggestion={applyRunningTimerSuggestion}
        onCancel={completeActiveEditorExit}
        onCreateTag={createTimerSheetTag}
        onDelete={deleteActiveTimer}
        onPresented={completeActiveEditorPresentation}
        onSave={saveActiveTimerEdit}
        onStop={stopActiveTimer}
        presentation={activeEditPresentation}
        reduceMotion={reduceMotion}
        deleting={false}
        saving={false}
        stopping={false}
        styles={styles}
        tags={data?.tags ?? []}
        theme={theme}
        visible={Boolean(activeEditPresentation)}
      /> : null}
      {calendarEditPresentation && reduceMotionPreferenceResolved ? <ActiveTimerEditSheet
        categories={sortedCategories}
        elapsedSeconds={calendarEditEntry ? entryDurationSeconds(calendarEditEntry, now) : 0}
        entry={calendarEditEntry}
        historicalEntries={historySourceEntries}
        lastStoppedAt={null}
        mode="entry"
        onCancel={completeCalendarEntryExit}
        onCreateTag={createTimerSheetTag}
        onDelete={deleteCalendarEntry}
        onSave={saveCalendarEntryEdit}
        presentation={calendarEditPresentation}
        reduceMotion={reduceMotion}
        deleting={false}
        saving={false}
        stopping={false}
        styles={styles}
        tags={data?.tags ?? []}
        theme={theme}
        visible={Boolean(calendarEditEntry && calendarEditPresentation)}
      /> : null}
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
  additionalOverlapTotal,
  chartView,
  dailyBars,
  hasSuggestedActivity,
  onChartViewChange,
  onRangeChange,
  range,
  segments,
  styles,
  theme,
  coveredTotal,
  loggedTotal
}: {
  additionalOverlapTotal: number;
  chartView: ReportChartView;
  dailyBars: Array<{ key: string; label: string; seconds: number }>;
  hasSuggestedActivity: boolean;
  onChartViewChange: (view: ReportChartView) => void;
  onRangeChange: (range: ReportRange) => void;
  range: ReportRange;
  segments: SummarySegment[];
  styles: MobileStyles;
  theme: MobileTheme;
  coveredTotal: number;
  loggedTotal: number;
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
            <Text style={styles.label}>Total logged</Text>
            <Text style={styles.reportTotalValue}>{formatDuration(loggedTotal)}</Text>
          </View>
          <View style={styles.reportTotalCard}>
            <Text style={styles.label}>Time covered</Text>
            <Text style={styles.reportTotalValue}>{formatDuration(coveredTotal)}</Text>
          </View>
        </View>
        <Text style={styles.muted}>
          {additionalOverlapTotal > 0
            ? `${formatDuration(additionalOverlapTotal)} additional overlapping activity. Each entry counts in full; covered time counts concurrent entries once.`
            : "Each entry counts in full. Covered time counts concurrent entries once; there are no overlaps in this range."}
        </Text>
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

function PlusGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12h14" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2.2} />
    </Svg>
  );
}

function PasswordVisibilityGlyph({
  color,
  passwordVisible
}: {
  color: string;
  passwordVisible: boolean;
}) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <Circle cx={12} cy={12} r={2.7} fill="none" stroke={color} strokeWidth={2} />
      {passwordVisible ? (
        <Path
          d="M4 4l16 16"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth={2}
        />
      ) : null}
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
  const historyAnalysis = useMemo(() => {
    const rangeStart = new Date(section.date);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = addDaysToDate(rangeStart, 1);
    return analyzeTimeIntervals(
      section.entries.map(({ entry }) => ({
        id: entry.id,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt
      })),
      { range: { start: rangeStart, end: rangeEnd }, now }
    );
  }, [now, section.date, section.entries]);
  const historyOverlapById = useMemo(
    () => new Map(historyAnalysis.entries.map((entry) => [entry.id, entry])),
    [historyAnalysis.entries]
  );

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
                        : `${formatEntryTimeRange(entry, now)}${entry.categoryName ? ` · ${entry.categoryName}` : ""}${entry.placeName ? ` · ${entry.placeName}` : ""}`}
                    </Text>
                    <TagMetadata
                      styles={styles}
                      tagNames={entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []}
                      theme={theme}
                    />
                    {group.entries.some(({ entry: groupedEntry }) =>
                      (historyOverlapById.get(groupedEntry.id)?.overlapCount ?? 0) > 0
                    ) ? (
                      <Text
                        accessibilityLabel="Overlap"
                        style={[styles.reviewMetaLine, { color: theme.warningText }]}
                      >
                        Overlap
                      </Text>
                    ) : null}
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
                      <CompactReplayPlayGlyph
                        color={canReplay ? theme.accentText : theme.textSecondary}
                      />
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
                          {(historyOverlapById.get(childEntry.id)?.overlapCount ?? 0) > 0 ? (
                            <Text
                              accessibilityLabel={`Overlap: ${formatDuration(
                                historyOverlapById.get(childEntry.id)?.uniqueOverlapSeconds ?? 0
                              )} shared with other entries`}
                              style={[styles.reviewMetaLine, { color: theme.warningText }]}
                            >
                              Overlap
                            </Text>
                          ) : null}
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
        <Text style={styles.todayTrackedLabel}>Logged</Text>
        <View>
          <Text style={styles.todayTrackedValue}>{formatDuration(historyAnalysis.loggedSeconds)}</Text>
          {historyAnalysis.additionalOverlapSeconds > 0 ? (
            <Text style={[styles.reviewMetaLine, { textAlign: "right" }]}>
              {formatDuration(historyAnalysis.coveredSeconds)} covered
            </Text>
          ) : null}
        </View>
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
  const selectedAnalysis = analyzeTimeIntervals(
    confirmedSelectedEntries.map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    })),
    { range: { start: rangeStart, end: rangeEnd }, now }
  );

  return {
    todayTotal,
    weekTotal,
    loggedTotal: selectedAnalysis.loggedSeconds,
    coveredTotal: selectedAnalysis.coveredSeconds,
    additionalOverlapTotal: selectedAnalysis.additionalOverlappingActivitySeconds,
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

function createManualDraftEntry(nowMs: number): TimeEntry {
  const stoppedAt = new Date(nowMs);
  const startedAt = new Date(nowMs - 30 * 60 * 1000);
  return {
    categoryColor: null,
    categoryId: null,
    categoryName: null,
    clientName: null,
    confidence: "manual",
    description: null,
    durationSeconds: 30 * 60,
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

function sameTimerStopOwner(left: TimerStopOwner, right: TimerStopOwner) {
  return left.userId === right.userId && left.workspaceId === right.workspaceId;
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
