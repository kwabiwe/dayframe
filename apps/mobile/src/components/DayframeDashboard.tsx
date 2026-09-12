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
import Svg, { Circle, Path } from "react-native-svg";
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
import { useIntrinsicTextMeasure } from "@/components/accessibility/IntrinsicTextMeasure";
import { TodayDateHeading } from "@/components/accessibility/TodayDateHeading";
import { TodayLoggedSummary } from "@/components/accessibility/TodayLoggedSummary";
import { recordMobileLayout, recordMobileTextLayout } from "@/components/accessibility/diagnostics";
import type { MobileAccessibilityDiagnostic } from "@/components/accessibility/diagnostics";
import { ReportsTab } from "@/components/reports/ReportsTab";
import { DayframeBrand } from "@/components/brand";
import {
  CompactReplayPlayGlyph,
  PrimaryTimerAction,
  PlusGlyph
} from "@/components/PrimaryTimerAction";
import { TodayTimerSurface } from "@/components/accessibility/TodayTimerSurface";
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
import { DAYFRAME_BACKEND_ID } from "@/lib/backendIdentity";
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
import {
  HISTORY_REPLAY_ACTION_WIDTH,
  historyRowLayout,
  summaryLayout
} from "@/lib/mobileAccessibilityLayout";
import { mobileTextProps } from "@/lib/mobileTypography";
import { subscribeMobileSignedOut } from "@/lib/mobileSessionTransition";
import {
  buildNativeCalendarBridgeState,
  routeNativeCalendarOpenEvent,
  routeNativeCalendarRefresh,
  type NativeCalendarActionKind,
  type NativeCalendarEntry
} from "@/lib/nativeCalendarPresentation";
import { isOpenReviewItem, isReviewNeededEntry } from "@/lib/review";
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
  return <Text testID="staging-environment-badge" maxFontSizeMultiplier={1} numberOfLines={1} accessibilityLabel="Staging environment" style={styles.environmentBadge}>STAGING</Text>;
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
  const [calendarEditEntry, setCalendarEditEntry] = useState<NativeCalendarEntry | null>(null);
  const [calendarEditPresentation, setCalendarEditPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [calendarTransitionDirection, setCalendarTransitionDirection] = useState(1);
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

  const syncHealthKitAndReload = useCallback(async (reason: "foreground" | "observer" = "foreground", changedType?: string) => {
    if (authState !== "authenticated") return;
    if (!await isHealthKitAutomaticSyncEnabled().catch(() => false)) return;
    // Background registration and server reprocess never own source capture.
    void configureHealthKitAutomaticSync().catch(() => undefined);
    const options = { observerChange: reason === "observer" };
    const captures = await Promise.allSettled([
      ...(!changedType || changedType === "HKCategoryTypeIdentifierSleepAnalysis" ? [importHealthKitSleep(options)] : []),
      ...(!changedType || changedType === "HKWorkoutTypeIdentifier" ? [importHealthKitWorkouts(options)] : [])
    ]);
    const captured = captures.some(result => result.status === "fulfilled");
    if (!captured) return;
    try {
      await syncQueuedEvents();
      await reprocessExistingHealthReviewItems(undefined, { force: reason === "observer" });
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) transitionToSignedOut();
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
    void syncHealthKitAndReload("foreground");

    void (async () => {
      const nextSubscription = await startHealthKitChangeObservers((type) => {
        if (mounted) void syncHealthKitAndReload("observer", type);
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

              <TodayDateHeading dateLabel={formatLongDay(currentDate)} styles={styles} />

              <TodayTimerSurface
                active={displayedActiveEntry ? {
                  categoryColor: activeCategoryColor,
                  categoryLabel: activeCategoryLabel,
                  elapsedLabel: formatClockDuration(displayedActiveDurationSeconds),
                  hasLiveActiveTimer,
                  title: activeTitle,
                  titleIsPlaceholder: activeTitleIsPlaceholder,
                } : null}
                activeTimerActionsStyle={activeTimerActionsStyle}
                activeTimerDetailsStyle={activeTimerDetailsStyle}
                onAddTime={openManualEntry}
                onOpenActiveTimer={() => presentActiveEditor("existing_active_timer")}
                onStartBlank={startBlankTask}
                onStartQuickAction={(action) => {
                  void startTask(action.id, action.description ?? "");
                }}
                onStop={() => { void stopActiveTimer(); }}
                quickActions={quickActions}
                styles={styles}
                theme={theme}
              />
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
          contentContainerStyle={[styles.container, styles.reportsScrollContent]}
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

          {data ? (
            <ReportsTab
              key={`${DAYFRAME_BACKEND_ID ?? data.serverBuild?.backendId ?? "unknown-backend"}:${data.workspace.id}:${data.user.id}`}
              data={data}
              isFocused={isFocused}
              nowMs={now}
              styles={styles}
              theme={theme}
            />
          ) : null}
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
  const [measuredHeight, setMeasuredHeight] = useState(minHeight);
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
          minHeight={measuredHeight}
          onDelete={onDelete}
          styles={styles}
          swipeable={swipeable}
          theme={theme}
          translation={translation}
        />
      ) : null}
    >
      <View
        onLayout={(event) => {
          const height = Math.ceil(event.nativeEvent.layout.height);
          setMeasuredHeight((current) => current === height ? current : Math.max(minHeight, height));
        }}
      >
        {children}
      </View>
    </ReanimatedSwipeable>
  );
}

export function HistoryDayCard({
  activeTimerRunning,
  now,
  onDeleteEntries,
  onOpenEntry,
  onOpenReview,
  onReplayEntry,
  reviewCount,
  section,
  styles,
  theme,
  diagnostic
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
  diagnostic?: MobileAccessibilityDiagnostic;
}) {
  const reduceMotion = useReduceMotionPreference();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [availableRowWidth, setAvailableRowWidth] = useState(0);
  const entryGroups = useMemo(() => groupHistoryDayEntries(section.entries), [section.entries]);
  const longestDuration = useMemo(
    () => formatDuration(Math.max(0, ...entryGroups.map((group) => group.totalSeconds))),
    [entryGroups]
  );
  const durationSample = longestDuration.replace(/[0-9]/g, "8");
  const durationMeasure = useIntrinsicTextMeasure(
    [durationSample],
    styles.todayEntryDuration,
    1.2,
    "history-duration-measure"
  );
  const longestGroupCount = Math.max(0, ...entryGroups.map((group) => group.entries.length));
  const groupCountSample = String(longestGroupCount).replace(/[0-9]/g, "8");
  const groupCountMeasure = useIntrinsicTextMeasure(
    [groupCountSample],
    styles.historyGroupCountText,
    1.2,
    "history-group-count-measure"
  );
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
  const noticeLabel = `${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} review`;
  const noticeMeasure = useIntrinsicTextMeasure(
    [noticeLabel, "Open Review"],
    styles.reviewNoteText,
    1.3,
    "history-review-notice-measure"
  );
  const [noticeWidth, setNoticeWidth] = useState(0);
  const noticeStacked = !noticeMeasure.widths[noticeLabel] || !noticeMeasure.widths["Open Review"] ||
    summaryLayout({
      availableWidth: noticeWidth,
      labelWidth: noticeMeasure.widths[noticeLabel] ?? 0,
      valueWidth: noticeMeasure.widths["Open Review"] ?? 0,
      gap: 10,
      padding: 24
    }) === "stacked";
  const loggedValue = formatDuration(historyAnalysis.loggedSeconds);

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
      <Text {...mobileTextProps("sectionHeading")} style={styles.historyDayTitle}>{historyDayLabel(section, now)}</Text>
      <View
        style={styles.todayEntryCard}
        onLayout={(event) => {
          const layout = event?.nativeEvent?.layout;
          if (!layout) return;
          diagnostic?.onLayout?.("history.card", layout);
          const width = Math.max(0, layout.width - 28);
          setAvailableRowWidth((current) => current === width ? current : width);
        }}
      >
        {durationMeasure.probe}
        {groupCountMeasure.probe}
        {section.entries.length === 0 ? (
          <Reanimated.View
            entering={localPresenceEntering(reduceMotion)}
            layout={localLayoutTransition(reduceMotion)}
          >
            <Text {...mobileTextProps("body")} style={styles.todayEmptyText}>No tracked time for this day.</Text>
          </Reanimated.View>
        ) : entryGroups.map((group, index) => {
          const { entry } = group.representative;
          const probeId = group.entries[0].entry.id;
          const grouped = group.entries.length > 1;
          const expanded = grouped && expandedGroups.has(group.key);
          const canReplay = Boolean(entry.categoryId || entry.description?.trim());
          const title = displayEntryTitle(entry);
          const durationWidth = durationMeasure.widths[durationSample];
          const groupCountWidth = groupCountMeasure.widths[groupCountSample];
          const rowLayout = durationWidth === undefined || (grouped && groupCountWidth === undefined)
            ? "stacked"
            : historyRowLayout({
              availableWidth: availableRowWidth,
              countBadgeWidth: grouped ? Math.max(34, groupCountWidth + 16) : 0,
              durationWidth,
              replayWidth: HISTORY_REPLAY_ACTION_WIDTH,
              gap: 10
            });
          const duration = formatDuration(group.totalSeconds);
          const categoryPlace = [entry.categoryName, entry.placeName].filter(Boolean).join(" · ");
          const tagNames = entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? [];
          const timeRange = grouped
            ? `${formatEntryTimeRange(entry, now)} · ${group.entries.length} entries`
            : formatEntryTimeRange(entry, now);
          const hasOverlap = group.entries.some(({ entry: groupedEntry }) =>
            (historyOverlapById.get(groupedEntry.id)?.overlapCount ?? 0) > 0
          );
          const detailContext = [
            timeRange,
            categoryPlace,
            tagNames.length ? `Tags: ${tagNames.join(", ")}` : null,
            hasOverlap ? "Overlaps other tracked time" : null,
            duration
          ].filter(Boolean).join(". ");
          return (
            <Reanimated.View
              key={`${section.key}:${group.key}`}
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
            >
              <SwipeableHistoryEntry
                accessibilityLabel={`${title}. ${detailContext}`}
                enabled={group.entries.every(({ entry: groupedEntry }) => Boolean(groupedEntry.stoppedAt))}
                entry={entry}
                minHeight={56}
                onDelete={() => onDeleteEntries(group.entries.map(({ entry: groupedEntry }) => groupedEntry))}
                styles={styles}
                theme={theme}
              >
                <View style={[
                  styles.todayEntryRow,
                  rowLayout === "stacked" ? styles.historyEntryStackedRow : null,
                  index > 0 ? styles.todayEntryDivider : null
                ]} onLayout={(event) => {
                  recordMobileLayout(diagnostic, `history.row.${probeId}`, event);
                  const staleDurationPrefix = rowLayout === "inline"
                    ? `history.duration-stacked.${probeId}`
                    : `history.duration.${probeId}`;
                  diagnostic?.onRemove?.(`${staleDurationPrefix}.frame`);
                  diagnostic?.onRemove?.(`${staleDurationPrefix}.text`);
                }}>
                  <View style={rowLayout === "stacked" ? styles.historyEntryStackedTop : styles.historyEntryInlineTop}>
                  <Pressable
                  accessibilityLabel={`${grouped
                    ? `${expanded ? "Collapse" : "Expand"} ${group.entries.length} ${title} entries`
                    : `Edit ${title}`}. ${detailContext}`}
                  accessibilityRole="button"
                  accessibilityState={grouped ? { expanded } : undefined}
                  accessibilityActions={group.entries.every(({ entry: groupedEntry }) => Boolean(groupedEntry.stoppedAt))
                    ? [{ name: "delete", label: `Delete ${grouped ? `${group.entries.length} ${title} entries` : title}` }]
                    : undefined}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "delete" && group.entries.every(({ entry: groupedEntry }) => Boolean(groupedEntry.stoppedAt))) {
                      onDeleteEntries(group.entries.map(({ entry: groupedEntry }) => groupedEntry));
                    }
                  }}
                  onPress={() => {
                    if (grouped) toggleGroup(group.key);
                    else onOpenEntry(entry);
                  }}
                  style={({ pressed }) => [styles.historyEntryMain, pressed ? styles.buttonPressed : null]}
                  onLayout={(event) => recordMobileLayout(diagnostic, `history.main.${probeId}`, event)}
                >
                  {grouped ? (
                    <View
                      style={styles.historyGroupCountBadge}
                      onLayout={(event) => recordMobileLayout(diagnostic, `history.count.${probeId}`, event)}
                    >
                      <Text
                        {...mobileTextProps("counter")}
                        style={styles.historyGroupCountText}
                        onLayout={(event) => recordMobileLayout(diagnostic, `history.count-text.${probeId}.frame`, event)}
                        onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.count-text.${probeId}`, event, "counter", styles.historyGroupCountText)}
                      >
                        {group.entries.length}
                      </Text>
                    </View>
                  ) : null}
                  <View style={[styles.todayEntryDot, { backgroundColor: entryCategoryColor(entry, theme.mode) }]} />
                  <View style={styles.todayEntryText}>
                    <Text {...mobileTextProps("itemTitle")} style={styles.todayEntryTitle} numberOfLines={rowLayout === "stacked" ? 2 : 1} onLayout={(event) => recordMobileLayout(diagnostic, `history.title.${probeId}.frame`, event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.title.${probeId}`, event, "itemTitle", styles.todayEntryTitle)}>{title}</Text>
                    <Text {...mobileTextProps("metadata")} style={styles.todayEntryMeta} onLayout={(event) => recordMobileLayout(diagnostic, `history.time.${probeId}.frame`, event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.time.${probeId}`, event, "metadata", styles.todayEntryMeta)}>
                      {timeRange}
                    </Text>
                    {categoryPlace ? (
                      <Text {...mobileTextProps("metadata")} style={styles.todayEntryOptionalMeta} numberOfLines={rowLayout === "stacked" ? 2 : 1}>
                        {categoryPlace}
                      </Text>
                    ) : null}
                    <TagMetadata
                      accessibilityHidden
                      diagnostic={diagnostic}
                      diagnosticPrefix={`history.tags.${probeId}`}
                      styles={styles}
                      tagNames={entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []}
                      theme={theme}
                    />
                    {hasOverlap ? (
                      <Text
                        {...mobileTextProps("metadata")}
                        accessibilityLabel="Overlap"
                        style={[styles.reviewMetaLine, { color: theme.warningText }]}
                      >
                        Overlap
                      </Text>
                    ) : null}
                  </View>
                  </Pressable>
                  <View style={styles.historyEntryActions} onLayout={(event) => recordMobileLayout(diagnostic, `history.actions.${probeId}`, event)}>
                    {rowLayout === "inline" ? (
                    <Text {...mobileTextProps("numeric")} style={styles.todayEntryDuration} onLayout={(event) => recordMobileLayout(diagnostic, `history.duration.${probeId}.frame`, event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.duration.${probeId}`, event, "numeric", styles.todayEntryDuration)}>{duration}</Text>
                    ) : null}
                    <Pressable
                      accessibilityLabel={activeTimerRunning
                        ? `Switch the running timer to ${title}`
                        : `Start ${title} now`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canReplay }}
                      disabled={!canReplay}
                        onPress={() => onReplayEntry(entry)}
                        onLayout={(event) => recordMobileLayout(diagnostic, `history.replay.${probeId}`, event)}
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
                  {rowLayout === "stacked" ? (
                    <Text
                      {...mobileTextProps("numeric")}
                      style={styles.historyEntryStackedDuration}
                      onLayout={(event) => recordMobileLayout(diagnostic, `history.duration-stacked.${probeId}.frame`, event)}
                      onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.duration-stacked.${probeId}`, event, "numeric", styles.historyEntryStackedDuration)}
                    >
                      {duration}
                    </Text>
                  ) : null}
                </View>
              </SwipeableHistoryEntry>
              {expanded ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={[styles.historyGroupChildren, rowLayout === "stacked" ? styles.historyGroupChildrenStacked : null]}
                >
                  {group.entries.map(({ entry: childEntry, overlapSeconds }, childIndex) => (
                    <Reanimated.View
                      key={childEntry.id}
                      entering={localPresenceEntering(reduceMotion)}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                    >
                      <SwipeableHistoryEntry
                        accessibilityLabel={`${displayEntryTitle(childEntry)}, ${formatEntryTimeRange(childEntry, now)}, ${formatDuration(overlapSeconds)}`}
                        enabled={Boolean(childEntry.stoppedAt)}
                        entry={childEntry}
                        minHeight={46}
                        onDelete={(deletedEntry) => onDeleteEntries([deletedEntry])}
                        styles={styles}
                        theme={theme}
                      >
                        <View style={[styles.historyGroupChildDetails, childIndex > 0 ? styles.historyGroupChildDivider : null]}>
                        <Pressable
                          accessibilityLabel={`Edit ${displayEntryTitle(childEntry)}. ${formatEntryTimeRange(childEntry, now)}. ${formatDuration(overlapSeconds)}.${(childEntry.tagNames ?? childEntry.tags?.map((tag) => tag.name) ?? []).length ? ` Tags: ${(childEntry.tagNames ?? childEntry.tags?.map((tag) => tag.name) ?? []).join(", ")}.` : ""}${(historyOverlapById.get(childEntry.id)?.overlapCount ?? 0) > 0 ? " Overlaps other tracked time." : ""}`}
                          accessibilityRole="button"
                          accessibilityActions={Boolean(childEntry.stoppedAt)
                            ? [{ name: "delete", label: `Delete ${displayEntryTitle(childEntry)}` }]
                            : undefined}
                          onAccessibilityAction={(event) => {
                            if (event.nativeEvent.actionName === "delete" && childEntry.stoppedAt) {
                              onDeleteEntries([childEntry]);
                            }
                          }}
                          onPress={() => onOpenEntry(childEntry)}
                          style={({ pressed }) => [
                            styles.historyGroupChild,
                            pressed ? styles.buttonPressed : null
                          ]}
                        >
                          <View style={styles.historyGroupChildMain}>
                            <View style={[styles.todayEntryDot, { backgroundColor: entryCategoryColor(childEntry, theme.mode) }]} />
                            <Text {...mobileTextProps("metadata")} style={styles.historyGroupChildTime} onLayout={(event) => recordMobileLayout(diagnostic, `history.child-time.${probeId}.${childIndex}.frame`, event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.child-time.${probeId}.${childIndex}`, event, "metadata", styles.historyGroupChildTime)}>
                              {formatEntryTimeRange(childEntry, now)}
                            </Text>
                            <Text
                              {...mobileTextProps("numeric")}
                              style={styles.todayEntryDuration}
                              onLayout={(event) => recordMobileLayout(diagnostic, `history.child-duration.${probeId}.${childIndex}.frame`, event)}
                              onTextLayout={(event) => recordMobileTextLayout(diagnostic, `history.child-duration.${probeId}.${childIndex}`, event, "numeric", styles.todayEntryDuration)}
                            >
                              {formatDuration(overlapSeconds)}
                            </Text>
                          </View>
                        </Pressable>
                        <TagMetadata
                          accessibilityHidden
                          diagnostic={diagnostic}
                          diagnosticPrefix={`history.child-tags.${probeId}.${childIndex}`}
                          styles={styles}
                          tagNames={childEntry.tagNames ?? childEntry.tags?.map((tag) => tag.name) ?? []}
                          theme={theme}
                        />
                          {(historyOverlapById.get(childEntry.id)?.overlapCount ?? 0) > 0 ? (
                            <Text
                              {...mobileTextProps("metadata")}
                              accessibilityLabel={`Overlap: ${formatDuration(
                                historyOverlapById.get(childEntry.id)?.uniqueOverlapSeconds ?? 0
                              )} shared with other entries`}
                              style={[styles.reviewMetaLine, { color: theme.warningText }]}
                            >
                              Overlap
                            </Text>
                          ) : null}
                        </View>
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
        <View onLayout={(event) => {
          recordMobileLayout(diagnostic, "review-notice.container", event);
          const width = event?.nativeEvent?.layout?.width;
          if (width === undefined) return;
          setNoticeWidth((current) => current === width ? current : width);
        }}>
        {noticeMeasure.probe}
        <Pressable
          accessibilityLabel={`${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} review. Open Review.`}
          accessibilityRole="button"
          onPress={onOpenReview}
          style={({ pressed }) => [
            styles.reviewNoteButton,
            noticeStacked ? styles.reviewNoteButtonStacked : null,
            pressed ? styles.buttonPressed : null
          ]}
        >
            <Text
            {...mobileTextProps("control")}
            style={[styles.reviewNoteText, noticeStacked ? styles.reviewNoteTextStacked : null]}
            onLayout={(event) => recordMobileLayout(diagnostic, "review-notice.count.frame", event)}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, "review-notice.count", event, "control", styles.reviewNoteText)}
          >
            {noticeLabel}
          </Text>
          <Text {...mobileTextProps("control")} style={styles.reviewNoteAction} onLayout={(event) => recordMobileLayout(diagnostic, "review-notice.action.frame", event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, "review-notice.action", event, "control", styles.reviewNoteAction)}>Open Review</Text>
        </Pressable>
        </View>
      ) : null}
      <TodayLoggedSummary
        value={loggedValue}
        coveredValue={historyAnalysis.additionalOverlapSeconds > 0
          ? `${formatDuration(historyAnalysis.coveredSeconds)} covered`
          : null}
        styles={styles}
        diagnostic={diagnostic}
      />
    </View>
  );
}

function dedupeEntriesById(entries: TimeEntry[]) {
  const byId = new Map<string, TimeEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return Array.from(byId.values());
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

function addDaysToDate(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function sameTimerStopOwner(left: TimerStopOwner, right: TimerStopOwner) {
  return left.userId === right.userId && left.workspaceId === right.workspaceId;
}

function uncategorizedFillColor(mode: MobileTheme["mode"]) {
  return mode === "dark" ? "#323946" : "#EEF2F6";
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
