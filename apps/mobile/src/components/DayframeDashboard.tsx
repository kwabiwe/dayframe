import { clearLocaleDateFormats, currentTimeZoneId, formatLocaleDate } from "@/lib/localeDateFormat";
import { useAppForeground } from "@/lib/appForeground";
import { useDashboardClockTicks, useLiveTimeInFront } from "@/lib/dashboardClock";
import { DAYFRAME_NATIVE_TABS } from "@/lib/nativeTabs";
import { livePresentationAt } from "@/components/today/liveBlockClock";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import Reanimated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { router, useFocusEffect, useIsFocused, usePathname } from "expo-router";
import { takeDashboardRefresh } from "@/lib/todayRefreshRequest";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  withGoalExclusions,
  paletteColorFor,
  previousEndOffer,
  TIMER_STATE_RECONCILE_INTERVAL_MS,
  timerStateChanged,
  timerStatePollDelay,
  formatClockTime,
  reviewCardCount,
  type ClockFormat,
  type RecentActivitySuggestion,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { DayframeCalendarView } from "../../modules/dayframe-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CalendarListView } from "./calendar/CalendarListView";
import { useCalendarTimelineSnapshot } from "@/lib/useCalendarTimeline";
import { correctionsToShow, projectTimelineCorrections } from "@/lib/timelineCorrectionProjection";
import { useTimelineCorrectionQueue } from "@/lib/useTimelineCorrectionQueue";
import { useLocationCorrections } from "@/components/calendar/useLocationCorrections";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { ConnectivityStatusIndicator, useSyncAttentionCount } from "@/components/ConnectivityStatusStrip";
import { ReportsTab } from "@/components/reports/ReportsTab";
import { DayframeBrand } from "@/components/brand";
import { TodayTimerSurface, type TodayActiveTimerPresentation } from "@/components/accessibility/TodayTimerSurface";
import type { LandingRequest } from "@/lib/blocksMotion";
import { minuteClock, newestShownTimestamp } from "@/lib/frameClock";
import { loadHapticsPreference, playHaptic, useHapticsPreference } from "@/lib/haptics";
import { useClockFormat } from "@/lib/clockFormat";
import { subscribeSavedTimeGoals } from "@/lib/settingsGoals";
import { applySavedActivity, subscribeSavedActivity } from "@/lib/settingsActivities";
import { layoutQuickStartMosaic, rankQuickStartActivities, weeklySecondsByActivity } from "@/lib/quickStartMosaic";
import { TodayReviewPresentationProvider } from "./today/TodayReviewPresentationContext";
import { currentTimeZone, localDayKey, reviewOwner, windowScopeFor } from "./today/useTodayReviewPresentation";
import { bootstrapReviewListMayBeIncomplete, calendarReviewItems, newestCachedReviewWindow, scopedOpenReviewItems } from "@/lib/calendarScopedReview";
import { getReviewItemSyncStates, readReviewPresentationSnapshot, readSuppressedReviewItemIds, subscribeReviewSync } from "@/lib/reviewSyncStore";
import { AccountAvatarButton } from "./today/AccountAvatarButton";
import { TodayGoalFrame } from "./today/TodayGoalFrame";
import { formatLiveClock } from "./today/todayBlocksLayout";
import { freshOpenTrip } from "./today/TodayOpenTripLine";
import { TodaySwitchSheet } from "./today/TodaySwitchSheet";
import { StopFlightOverlay, type StopFlight } from "./today/StopFlightOverlay";
import { useStopFlightExit } from "./today/useStopFlightExit";
import { createStopFlightLedger, type StopFlightLedger } from "./today/stopFlightLedger";
import { TodayPullBlocks } from "./today/TodayPullBlocks";
import { PlayOrb } from "./today/PlayOrb";
import { ReportsSheetPortalContext } from "./reports/ReportsSheetPortal";
import { bloomActivities, playOrbSupported } from "../lib/playOrb";
import { onPlayOrbTap, setPlayOrbRunning } from "../lib/playOrbBridge";

const PLAY_ORB_SUPPORTED = playOrbSupported({
  OS: Platform.OS,
  Version: Platform.Version,
  isPad: Platform.OS === "ios" && Platform.isPad,
});
import { LIVE_FLIGHT_NODE, STOP_FLIGHT, measureFlightNode, rowFlightNode, stopFlightOverlayReady } from "../lib/stopFlight";
import { switchRecents, type SwitchRecent } from "../lib/todaySwitch";
import { TodayChecksChip } from "./today/TodayChecksChip";
import { TodayBlockRows } from "./today/TodayBlockRows";
import { BlocksToast, useBlocksNotice } from "./blocks/BlocksToast";
import { useTripOptOut } from "../lib/useTripOptOut";
import {
  alreadyRecordingToastMessage,
  deletedToastAnnouncement,
  deletedToastMessage,
  startMatchesRunning,
  switchedToastCopy,
  toastAccessibilityText,
  toastSwatchColor,
  undoDeleteAccessibilityLabel,
  type BlocksToastCopy
} from "../lib/blocksToastCopy";
import { EarlierThisWeek } from "./today/EarlierThisWeek";
import { TodayRibbonSection } from "./today/TodayRibbon";
import { buildEarlierThisWeek, EARLIER_DAYS, earlierDayReviewCounts } from "@/lib/earlierThisWeek";
import { buildTodayGoalFrame } from "@/lib/todayGoalFrame";
import { useReviewNudgeCount } from "@/lib/useReviewNudgeCount";
import { withdrawAnswerAfterCorrections } from "@/lib/reviewAnswersAfterCorrections";
import { waitForItemCorrections } from "@/lib/afterCorrections";
import { createReviewClientMutationId } from "@/lib/reviewSyncStore";
import { useAnswersAfterCorrections } from "@/components/calendar/useAnswersAfterCorrections";
import { buildTodayWhereWent } from "@/lib/todayWhereWent";
import type { ReportsRangeRequest } from "@/components/reports/ReportsTab";
import { checkAskingStartMs, checkStillAsks, checksOldestFirst, DAYFRAME_APP_ICONS, listCheckOverlaps, type DayframeGlyph, type ListCheck } from "@dayframe/shared";
import { withPlacesAndLegs } from "@/lib/calendarGridPlaces";
import {
  ActivityNameTakenError,
  AuthRequiredError,
  createManualTimeEntry,
  createCategory,
  createTag,
  enqueueEvent,
  fetchBootstrap,
  fetchLocationTimeline,
  fetchTimerState,
  isQueuedTimerMutationEvent,
  login,
  readQueue,
  pruneTimerEntryIdCorrelations,
  readTimerEntryIdCorrelations,
  resolveTimerEntryIdAfterQueueBarrier,
  requestPasswordReset,
  signup,
  syncQueue,
  type MobileBootstrap,
  type MobileReviewItem,
  type SyncQueueResult,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { useRefusedTimerStartRollback } from "@/lib/useRefusedTimerStartRollback";
import { handleDayframeUrl } from "@/lib/deepLinks";
import { useShortcutStopHandoff } from "@/components/useShortcutStopHandoff";
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
import { friendlyMobileErrorMessage } from "@/lib/friendlyError";
import {
  activateMobileAccount,
  deactivateMobileAccount
} from "@/lib/mobileAccount";
import {
  projectDurableLocalWork
} from "@/lib/durableLocalProjection";
import { readDurableLocalWork, readQueuedAndNativeStops } from "@/lib/durableLocalWork";
import { createWaitingLockScreenStopsApplier } from "@/lib/waitingLockScreenStops";
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
  reprocessExistingHealthReviewItems
} from "@/lib/health";
import { subscribeHealthChanges } from "@/lib/healthBackgroundSync";
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
  enqueueTimeEntryUpdate,
  isTimeEntryCommandRejected,
  releaseTimeEntryCommands,
  removeTimeEntryCommands,
  type TimeEntryCommandHoldLease,
  synchroniseTimeEntryCommands
} from "@/lib/timeEntryOutbox";
import {
  type TimeEntrySheetOpenReason,
  type TimeEntrySheetPresentation
} from "@/lib/timeEntrySheetPresentation";
import {
  createDeletionCoordinator,
  type PendingDeletion
} from "@/lib/historyDeletion";
import {
  canUndoDeletes,
  createUndoHoldLease,
  holdDeletesForOpenedUndoWindow,
  persistUndoableTimeEntryDeletes
} from "@/lib/deletionUndoHold";
import {
  buildHistoryDaySections,
  groupHistoryDayEntries,
  type HistoryEntryGroup
} from "@/lib/historyPresentation";
import {
  pressable,
  useMobileTheme,
  type MobileStyles,
  type MobileTheme
} from "@/lib/mobileTheme";
import { subscribeMobileSignedOut } from "@/lib/mobileSessionTransition";
import { captureSettingsSeedGeneration, publishTodayBootstrapForSettings } from "@/lib/settingsSeed";
import {
  buildNativeCalendarBridgeState,
  routeNativeCalendarOpenEvent,
  routeNativeCalendarRefresh,
  type NativeCalendarActionKind,
  type NativeCalendarEntry
} from "@/lib/nativeCalendarPresentation";
import { isLocationReviewItem, isOpenReviewItem, isReviewNeededEntry } from "@/lib/review";
import { reviewAnswerQuestion } from "@/lib/reviewAnswer";
import { calendarCheckOutings, calendarCheckRoute, useCalendarCheckAnswers } from "@/components/calendar/useCalendarCheckAnswers";
import { useCheckVenueGuess } from "@/components/calendar/useCheckVenueGuess";
import { drainNativeShortcutQueue, syncShortcutCatalog } from "@/lib/shortcuts";
import {
  MOBILE_MOTION,
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useResolvedReduceMotionPreference,
  useReduceTransparencyPreference
} from "@/lib/motion";
import {
  activeTimerElapsedSeconds,
  activeTimerPresentation,
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
  isSameRunningEntry,
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
type AuthView = "login" | "signup" | "reset";
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
  /** False when the block was never on screen (a refused queued Start nobody could see). */
  alert?: boolean;
};

const CALENDAR_LAYOUT_KEY = "dayframe.calendar.layout";
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
      <ConnectivityStatusIndicator isFocused={isFocused} />
      <StagingBadge styles={styles} />
    </View>
  );
}
const RECENT_LAST_STOP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Correlation pruning reads every durable store, so a refresh does it at most this often. */
const TIMER_ID_CORRELATION_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/**
 * The tab that shows a running block's live seconds from the Dashboard's clock: Reports' running totals.
 * Today's live block keeps its own clock (`useLiveBlockElapsed`), so Today in front needs none.
 */
const LIVE_TIME_PATHNAMES = new Set([`/${DAYFRAME_NATIVE_TABS.reports.route}`]);

type DashboardContextValue = {
  renderTab: (tab: DayframeDashboardTab, isFocused: boolean) => ReactNode;
  /** Things to check today and the 7 days before: the Calendar tab's badge (location v4 step 14). */
  checkCount: number;
  /** Owner item A (28 Oct 2026): opens the oldest question that still asks (the Calendar tab's badge). */
  openOldestCheck: () => void;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

// Native tabs mount their routes eagerly. Keep sync, HealthKit and timer state in one shared owner.
export function DayframeDashboardProvider({ children }: { children: ReactNode }) {
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const connectivity = useConnectivity();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  // The last bootstrap a load, a recovered refresh or the cached launch committed: the commit that
  // brings it is "quiet", so Today's "Where today went" strip never fades in on hydration or a
  // refresh (motion.md), only when it appears mid-session.
  const loadedBootstrap = useRef<MobileBootstrap | null>(null);
  const previousTodayData = useRef<MobileBootstrap | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Today's "Where today went" opens Reports on Today: a tokenised, in-memory request that
  // ReportsTab applies once and acknowledges (Reports still opens on Week otherwise, D9).
  const [reportsRangeRequest, setReportsRangeRequest] = useState<ReportsRangeRequest | null>(null);
  const reportsRangeRequestToken = useRef(0);
  const [todayPresentationRefreshGeneration, setTodayPresentationRefreshGeneration] = useState(0);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDateKey(new Date()));
  const [calendarEditEntry, setCalendarEditEntry] = useState<NativeCalendarEntry | null>(null);
  const [calendarEditPresentation, setCalendarEditPresentation] = useState<TimeEntrySheetPresentation | null>(null);
  const [calendarEditDismissRequestId, setCalendarEditDismissRequestId] = useState<number | null>(null);
  const [calendarTransitionDirection, setCalendarTransitionDirection] = useState(1);
  // Calendar › Grid or List (location v4 step 9), remembered on this phone.
  const [calendarLayout, setCalendarLayout] = useState<"grid" | "list">("grid");
  const [calendarHeaderHeight, setCalendarHeaderHeight] = useState<number | null>(null);
  // A layout the person picked here wins over the stored one, however late that read lands (Codex r1 on #570).
  const calendarLayoutChosen = useRef(false);
  // The evening reminder's tap lands in an effect set up once: it reads the current opener.
  const openTodayChecksRef = useRef<() => void>(() => undefined);
  const [reportsScrubbing, setReportsScrubbing] = useState(false);
  // A rejected change badges the avatar, which then opens Settings › Sync help.
  const syncAttentionCount = useSyncAttentionCount();
  // Each tab's avatar names its tab, so the pushed page's back button says where it returns to.
  const openAccountFrom = useCallback((from: "today" | "calendar" | "reports") => (target: "settings" | "sync") => {
    if (target === "sync") router.push({ pathname: "/settings", params: { from, section: "sync" } });
    else router.push({ pathname: "/settings", params: { from } });
  }, []);
  const openAccountFromToday = useMemo(() => openAccountFrom("today"), [openAccountFrom]);
  const openAccountFromCalendar = useMemo(() => openAccountFrom("calendar"), [openAccountFrom]);
  const openAccountFromReports = useMemo(() => openAccountFrom("reports"), [openAccountFrom]);
  const [authView, setAuthView] = useState<AuthView>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordVisible, setAuthPasswordVisible] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const appIsForeground = useAppForeground();
  // Reports' running totals read the Dashboard's seconds; coming back to Reports reads the time in that render.
  const liveTimeInFront = useLiveTimeInFront(LIVE_TIME_PATHNAMES.has(usePathname()), setNow);
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
  // One automatic Move deleted: its toast offers "Don't log trips like this" (PRD D19, A4).
  const tripOptOut = useTripOptOut(
    pendingDeletion?.phase === "active" && pendingDeletion.entries.length === 1 ? pendingDeletion.entries[0].automaticMoveEventId : null,
    pendingDeletion?.phase === "active" ? pendingDeletion.token : null
  );
  const [pendingTimerStops, setPendingTimerStops] = useState<PendingTimerStop[]>([]);
  const {
    reduceMotion,
    resolved: reduceMotionPreferenceResolved
  } = useResolvedReduceMotionPreference();
  // Today's notices without an action (UIA-004: "Switched to …", "Already recording …"). They share
  // the delete Undo toast's place; that Undo toast always wins it.
  const todayNotice = useBlocksNotice();
  const clearTodayNotice = todayNotice.clear;
  // Notices belong to the session that raised them: a sign-out bumps this, so a start that is
  // accepted after the account left never shows its "Switched to …" over sign-in or another account.
  const noticeSessionGeneration = useRef(0);
  const reduceTransparency = useReduceTransparencyPreference();
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const queuedEventSync = useRef(
    createSharedInFlightOperation<SyncQueueResult>()
  ).current;
  const latestData = useRef<MobileBootstrap | null>(null);
  // Goals saved in Settings › Your day reach Today's goal frame at once (same account only). The
  // canonical ref changes with the state so a later timer mutation keeps the new goals.
  useEffect(() => subscribeSavedTimeGoals((event) => {
    const current = latestData.current;
    if (!current || current.user.id !== event.userId) return;
    const next = {
      ...current,
      user: { ...current.user, dailyGoalMinutes: event.dailyGoalMinutes, weeklyGoalMinutes: event.weeklyGoalMinutes }
    };
    // A bootstrap already in flight carries the old goals: treat this like a mutation so it is
    // reconciled instead of applied over the new ones.
    dashboardMutationRevision.current += 1;
    publishDashboardData(next);
  }), []);
  // An activity saved in Settings (name, colour, icon or "Counts toward goal") reaches Today's goal
  // frame and Reports at once, for the same account and workspace only; an older answer never
  // replaces a newer one (applySavedActivity).
  const appliedSavedActivities = useRef(new Map<string, number>());
  useEffect(() => subscribeSavedActivity((event) => {
    const current = latestData.current;
    if (!current) return;
    const next = applySavedActivity(current, event, appliedSavedActivities.current);
    if (next === current) return;
    // A bootstrap already in flight may predate this change: reconcile it like a mutation.
    dashboardMutationRevision.current += 1;
    publishDashboardData(next);
  }), []);
  const liveActivityReconciliationDeferred = useRef(false);
  const optimisticTimerIds = useRef(new Map<string, string>());
  const timerIdCorrelationsLoaded = useRef(false);
  const lastTimerIdCorrelationPruneAt = useRef(0);
  const optimisticTimerSequence = useRef(0);
  const optimisticTimerStartReconciler = useRef(createOptimisticTimerStartReconciler());
  const supersededStopRollbackTracker = useRef(createSupersededStopRollbackTracker());
  const rejectedOptimisticStartExit = useRef(
    createGenerationScopedExitCoordinator<RejectedOptimisticStart>()
  );
  const sheetPresentationSequence = useRef(0);
  const activeEditPresentationRef = useRef<TimeEntrySheetPresentation | null>(null);
  const calendarEditPresentationRef = useRef<TimeEntrySheetPresentation | null>(null);
  const calendarEditEntryRef = useRef<NativeCalendarEntry | null>(null);
  calendarEditEntryRef.current = calendarEditEntry;
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
  // The deletion coordinator's lifetime: ending it drops every Undo hold, even mid-write (Codex r1 on #540).
  const deletionHoldLease = useRef<TimeEntryCommandHoldLease | null>(null);
  const deletionPreparationInFlight = useRef(false);
  const activeSheetDeletionToken = useRef<{ presentationId: number; token: number } | null>(null);
  const calendarSheetDeletionToken = useRef<{ presentationId: number; token: number } | null>(null);
  const activeEditorOpenFrame = useRef<number | null>(null);
  const activeEditorEntryId = useRef<string | null>(null);
  const blankTimerStartGate = useRef(createBlankTimerStartGate());
  const entrance = useRef(new Animated.Value(0)).current;
  const activeTimerExpansion = useRef(new Animated.Value(0)).current;
  const activeTimerExpansionTarget = useRef(0);
  // Blocks landings (motion.md): issued only by committed Start/Stop/Undo handlers, never by refresh.
  const landingSequence = useRef(0);
  const [liveLanding, setLiveLanding] = useState<LandingRequest | null>(null);
  // The Switch sheet's list, taken when it opens, so it never reshuffles under the finger or while it leaves.
  const [switchSheetRecents, setSwitchSheetRecents] = useState<SwitchRecent[] | null>(null);
  const todayScrollY = useSharedValue(0);
  const todayScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      todayScrollY.value = event.contentOffset.y;
    },
  });
  const [stopFlight, setStopFlight] = useState<StopFlight | null>(null);
  // The flight that may still finish, updated synchronously with every set, clear, rollback or restoring
  // publication, so a queued completion can never land on a block that is running again (stopFlightLedger).
  const stopFlightLedgerRef = useRef<StopFlightLedger | null>(null);
  stopFlightLedgerRef.current ??= createStopFlightLedger((entryId) => timerEntryIdentity(entryId));
  const stopFlightLedger = stopFlightLedgerRef.current;
  function dropCancelledStopFlight(token: number | null) {
    if (token !== null) setStopFlight((current) => (current?.token === token ? null : current));
  }
  /**
   * Every publication of dashboard data except sign-out's clear goes through here. Mutation handlers share latestData as
   * their canonical synchronous view, and a publication that shows a flown block running again cancels its
   * flight before React renders it.
   */
  function publishDashboardData(next: MobileBootstrap | null) {
    dropCancelledStopFlight(stopFlightLedger.published(latestData.current?.activeEntry?.id, next?.activeEntry?.id));
    latestData.current = next;
    setData(next);
  }
  const [rowPop, setRowPop] = useState<LandingRequest | null>(null);
  const stopFlightSequence = useRef(0);
  const pendingStartAgain = useRef<Pick<TimeEntryUpdatePatch, "categoryId" | "description" | "tagNames"> | null>(null);
  const todayTabFocused = useRef(false);
  const reportsSheetPortal = useContext(ReportsSheetPortalContext);
  const stopFlightMeasuring = useRef(false);
  const [rowLanding, setRowLanding] = useState<LandingRequest | null>(null);

  useEffect(() => {
    void loadHapticsPreference();
  }, []);
  const authNameRef = useRef<TextInput>(null);
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
    noticeSessionGeneration.current += 1;
    clearTodayNotice();
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
    deletionHoldLease.current?.end();
    deletionHoldLease.current = null;
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
    pendingStartAgain.current = null;
    manualEntryPresentationRef.current = null;
    dashboardMutationRevision.current += 1;
    recoveredBootstrapGuards.current.clear();
    refreshQueued.current = false;
    queuedTimerStartRecoveryRequested.current = false;
    latestData.current = null;
    loadedBootstrap.current = null;
    timerStateRef.current = null;
    setData(null);
    setReportsRangeRequest(null);
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
    setSwitchSheetRecents(null);
    // Today's motion requests belong to the session that made them.
    stopFlightLedger.clear();
    setStopFlight(null);
    setRowPop(null);
    setRowLanding(null);
    setLiveLanding(null);
    setPendingTimerStops([]);
    setAuthState("signedOut");
  }, [clearTodayNotice]);

  // A queued Start the server refused (stability audit 22 Oct 2026, iphone-timer-sync-3): its Stops and
  // Edits are already settled by the sync layer; here the block shown for it is rolled back and Today
  // refreshes from the server. The rollback restores nothing from the Start's own time (it may be hours
  // old): server truth replaces it.
  useRefusedTimerStartRollback({
    describe: ({ localId, owner }) => {
      const current = latestData.current;
      return {
        localId,
        ownerMatches: Boolean(current && sameTimerStopOwner(timerStopOwner(current), owner)),
        shown: Boolean(current && (optimisticTimerIds.current.has(localId) || current.activeEntry?.id === localId ||
          current.entries.some((entry) => entry.id === localId))),
        deletionPending: Boolean(deletionCoordinator.current?.current()?.entryIds.includes(localId)),
        // Only an editor still on screen counts (its row may already be gone after a refresh).
        calendarEditorEntryId: calendarEditPresentationRef.current ? calendarEditEntryRef.current?.id ?? null : null
      };
    },
    // Leaves by its own exit (motion and Reduce Motion as for Cancel); its Delete can't run on a
    // block that was never saved.
    dismissCalendarEditor: () => {
      const presentation = calendarEditPresentationRef.current;
      if (presentation) setCalendarEditDismissRequestId(presentation.id);
    },
    reject: (localId, error, alert) => rejectOptimisticTimerStart(localId, null, error, alert),
    refresh: () => queueDashboardRefreshAfterConflict()
  });

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
    loadedBootstrap.current = next;
    publishDashboardData(next);
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

  /**
   * Bounds the correlation store and this screen's copy of it (stability audit 22 Oct 2026,
   * iphone-timer-sync-7). Optimistic IDs still on screen, in an open editor or in a pending deletion
   * are kept.
   */
  async function pruneTimerIdCorrelationsAfterLoad(bootstrap: MobileBootstrap) {
    const nowMs = Date.now();
    if (nowMs - lastTimerIdCorrelationPruneAt.current < TIMER_ID_CORRELATION_PRUNE_INTERVAL_MS) return;
    lastTimerIdCorrelationPruneAt.current = nowMs;
    const owner = timerStopOwner(bootstrap);
    const onScreen = new Set<string>();
    for (const data of [bootstrap, latestData.current]) {
      if (!data) continue;
      for (const entry of [
        data.activeEntry,
        ...data.entries,
        ...(data.historyEntries ?? []),
        ...(data.dayEntries ?? []),
        ...(data.weekEntries ?? [])
      ]) {
        if (entry?.id.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)) onScreen.add(entry.id);
      }
    }
    for (const entryId of deletionCoordinator.current?.current()?.entryIds ?? []) onScreen.add(entryId);
    // Open editors keep the entry they opened with, which may still carry its optimistic ID (Codex r1
    // on #552).
    for (const entryId of [calendarEditEntryRef.current?.id, activeEditorEntryId.current]) {
      if (entryId?.startsWith(OPTIMISTIC_TIMER_ID_PREFIX)) onScreen.add(entryId);
    }
    const removed = await pruneTimerEntryIdCorrelations({ owner, retainLocalIds: onScreen })
      .catch(() => [] as string[]);
    const current = latestData.current;
    if (!current || !sameTimerStopOwner(timerStopOwner(current), owner)) return;
    for (const localId of removed) optimisticTimerIds.current.delete(localId);
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

  // A Lock Screen Stop made while Dayframe was away, shown before any refresh lands (Codex r1–r3 on #578).
  const waitingLockScreenStops = useRef<(() => Promise<void>) | null>(null);
  waitingLockScreenStops.current ??= createWaitingLockScreenStopsApplier({
    shown: () => latestData.current,
    ownerOf: (bootstrap) => timerStopOwner(bootstrap),
    readStops: readQueuedAndNativeStops,
    revision: () => dashboardMutationRevision.current,
    publishAsMutation: (next) => {
      dashboardMutationRevision.current += 1;
      publishDashboardData(next);
    }
  });
  const applyWaitingLockScreenStops = useCallback(() => waitingLockScreenStops.current!(), []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void applyWaitingLockScreenStops();
    });
    return () => subscription.remove();
  }, [applyWaitingLockScreenStops]);

  const load = useCallback(async (options?: DashboardLoadOptions) => {
    await applyWaitingLockScreenStops();
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
    const settingsSeedGeneration = captureSettingsSeedGeneration();
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
      publishTodayBootstrapForSettings(serverBootstrap, settingsSeedGeneration);
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
      loadedBootstrap.current = bootstrap;
      publishDashboardData(bootstrap);
      setPendingTimerStops([...ownedPendingStops]);
      void pruneTimerIdCorrelationsAfterLoad(bootstrap);
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
  }, [applyWaitingLockScreenStops, transitionToSignedOut]);
  loadRef.current = load;

  const refreshTodayPresentation = useCallback(() => {
    // An explicit Today pull-to-refresh is also an explicit foreground retry
    // for the read-only presentation. It uses the existing owner and lets the
    // hook coalesce with an in-flight read; it does not start a poll or queue.
    setTodayPresentationRefreshGeneration((current) => current + 1);
    void load({ visibleRefresh: true });
  }, [load]);

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
    publishDashboardData(next);
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
    // A Start again from an earlier sheet that never finished leaving must not fire later.
    pendingStartAgain.current = null;
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
    setCalendarEditDismissRequestId((current) => current === presentationId ? null : current);
    activateSheetDeletion(calendarSheetDeletionToken, presentationId);
    calendarEditPresentationRef.current = null;
    setCalendarEditPresentation((current) => current?.id === presentationId ? null : current);
    setCalendarEditEntry(null);
    const startAgain = pendingStartAgain.current;
    pendingStartAgain.current = null;
    if (startAgain) startAgainFromSheet(startAgain);
  }

  // "Start again" from a stopped block's sheet, after that sheet has left. A described block or one
  // with an activity starts (or switches) like a row's Start again; a bare block starts directly,
  // without opening the blank-timer editor, so no sheet is presented on its way out.
  function startAgainFromSheet(values: Pick<TimeEntryUpdatePatch, "categoryId" | "description" | "tagNames">) {
    const categoryId = values.categoryId ?? null;
    const description = values.description?.trim() ?? "";
    const tagNames = values.tagNames ?? [];
    if (categoryId || description) {
      startFromToday(categoryId, description, tagNames);
      return;
    }
    void startTaskWith({ categoryId: null, description: "", startedAt: null, tagNames }).then((accepted) => {
      if (!accepted) return;
      playHaptic("start");
      setLiveLanding(nextLandingRequest());
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

  /** One identity for a block across its optimistic and canonical IDs (a Start reconciled mid-Stop). */
  function timerEntryIdentity(entryId: string) {
    return persistedTimerEntryId(entryId) ?? entryId;
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
    // A native-driver fade leaves the JS value at 0, so a header that mounts after it (or whose
    // view detached mid-flight) would stay invisible; settle the value at 1 whatever the outcome.
    Animated.timing(entrance, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start(() => entrance.setValue(1));
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
    deletionHoldLease.current?.end();
  }, []);

  useEffect(() => {
    const openDashboard = async () => {
      const settingsSeedGeneration = captureSettingsSeedGeneration();
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
        publishTodayBootstrapForSettings(cached.bootstrap, settingsSeedGeneration);
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
        loadedBootstrap.current = filtered;
        publishDashboardData(filtered);
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
    void syncHealthKitAndReload("foreground");
    // The background Health pass (healthBackgroundSync) captures and uploads every wake; in front,
    // Today also sends the rest of the queue, reprocesses Review and reloads what it shows.
    return subscribeHealthChanges((type) => {
      if (AppState.currentState === "active") void syncHealthKitAndReload("observer", type);
    });
  }, [authState, syncHealthKitAndReload]);

  useFocusEffect(
    useCallback(() => {
      void reloadThemePreference();
      // Another page changed what Today shows (setup's quick starts): read it now.
      if (takeDashboardRefresh() && authState === "authenticated") void load({ silent: true });
    }, [authState, load, reloadThemePreference])
  );


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

  // A `dayframe://action/stop` link stops the block shown as running, once timer state is loaded,
  // through the same targeted Stop as the button (a request that waits too long, or that arrived for
  // another account lifetime, is dropped).
  const stopActiveTimerRef = useRef<() => Promise<boolean>>(async () => false);
  useShortcutStopHandoff(authState === "authenticated" && data !== null, () => stopActiveTimerRef.current());

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

  // Tapping the evening Review reminder opens Review, but only for the account it was scheduled for.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    const isCurrentAccount = async (accountKey: string | null) => {
      const { mobileAccountKey, readActiveMobileAccount } = await import("@/lib/mobileAccount");
      const owner = await readActiveMobileAccount();
      return Boolean(owner && accountKey === mobileAccountKey(owner));
    };
    void import("@/lib/reviewNudgeNative").then(({ installReviewNudgeForegroundHandler, subscribeReviewNudgeOpens }) => {
      if (cancelled) return;
      installReviewNudgeForegroundHandler(isCurrentAccount);
      unsubscribe = subscribeReviewNudgeOpens((accountKey) => {
        void isCurrentAccount(accountKey).then((current) => {
          // "N things to check" opens Calendar › List on the latest day with one, at its first "?" (location v4 step 14).
          if (!cancelled && current) openTodayChecksRef.current();
        }).catch(() => undefined);
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

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

  // A layout effect, so an instant value lands before the live block's first paint.
  useLayoutEffect(() => {
    const toValue = hasLiveActiveTimer ? 1 : 0;
    // Nothing to animate (for example an idle mount): skip the no-op native animation.
    if (activeTimerExpansionTarget.current === toValue) return undefined;
    activeTimerExpansionTarget.current = toValue;
    // On Start the live block's own crossfade and landing own the entrance, so the details and
    // actions appear at rest; this value only fades them out during the retained Stop exit.
    if (reduceMotion || hasLiveActiveTimer) {
      activeTimerExpansion.setValue(toValue);
      return undefined;
    }
    const animation = Animated.timing(activeTimerExpansion, {
      toValue,
      duration: MOBILE_MOTION.layout,
      easing: Easing.out(Easing.cubic),
      // UI thread: Stop also writes the outbox and re-renders the dashboard on the JS thread.
      useNativeDriver: true
    });
    animation.start();
    return () => {
      // An interrupted fade settles at its target, so the skip above never strands it midway.
      animation.stop();
      activeTimerExpansion.setValue(toValue);
    };
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
  // The Dashboard's clock (`useDashboardClockTicks`): whole seconds only while a block runs (or its
  // sheet or a running Calendar entry is open), otherwise on the minute; nothing in the background.
  // Whole seconds re-render the Dashboard only while it shows them: a running block with Reports in
  // front, or a running entry's sheet. Today's live block has its own clock (`useLiveBlockElapsed`).
  // Each tick re-rendered all three tabs: about 150 ms of JS a second on the iPhone 17 (13 Oct).
  const minuteFloorNow = Math.floor(now / 60_000) * 60_000;
  // Reports memoises its range and day labels: a new time zone rebuilds them (selections and cached
  // totals stay).
  const timeZoneId = currentTimeZoneId(minuteFloorNow);
  const runningCalendarEdit = Boolean(calendarEditEntry && !calendarEditEntry.stoppedAt);
  const needsSecondClock = Boolean(retainedActiveEntryForSheet) || runningCalendarEdit;
  const secondsShown = Boolean(retainedActiveEntryForSheet && liveTimeInFront) ||
    Boolean(activeEditPresentation) || runningCalendarEdit;
  useDashboardClockTicks({ foreground: appIsForeground, needsSecondClock, secondsShown, setNow });
  // New data (a block finished elsewhere, a refresh) is shown against the time it arrived, not the
  // last minute tick, so nothing it holds is clipped away until the next minute.
  useEffect(() => {
    if (appIsForeground) setNow(Date.now());
  }, [appIsForeground, data]);
  useEffect(() => {
    if (appIsForeground) clearLocaleDateFormats();
  }, [appIsForeground]);
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
  // Whole-minute consumers (history, day cards, native Calendar) rebuild once a minute, but never
  // fall behind a start or stop already shown, so a block from this minute is never clipped away.
  const newestShownMs = useMemo(
    () => newestShownTimestamp(historySourceEntries, Date.now()),
    [historySourceEntries]
  );
  const minuteNow = minuteClock(now, newestShownMs);
  // Logged entries only: Review-needed time never counts on Today. Memoised so the per-second
  // render does not hand the Review presentation (and the ribbon behind it) a new array.
  const loggedSourceEntries = useMemo(
    () => historySourceEntries.filter((entry) => !isReviewNeededEntry(entry)),
    [historySourceEntries]
  );
  // Today shows today's blocks and the six days before it; Calendar holds everything older.
  const historySections = useMemo(
    () => buildHistoryDaySections({
      days: EARLIER_DAYS + 1,
      entries: loggedSourceEntries,
      nowMs: minuteNow
    }),
    [loggedSourceEntries, minuteNow]
  );
  const todaySections = useMemo(() => historySections.filter((section) => section.isToday), [historySections]);
  // Day totals read the hero's entries (every positive clip), rebuilt on the minute clock only.
  const earlierDays = useMemo(
    () => buildEarlierThisWeek(historySections, minuteNow, loggedSourceEntries),
    [historySections, loggedSourceEntries, minuteNow]
  );
  const todayRibbonEntries = useMemo(
    () => (todaySections[0]?.entries ?? []).map(({ entry }) => entry),
    [todaySections]
  );
  const categoryIconById = useMemo(
    () => new Map((data?.categories ?? []).map((category) => [category.id, category.icon ?? null])),
    [data?.categories]
  );
  // Sized by the last seven calendar days of completed time; recomputed when entries or the day
  // change, never on a timer tick.
  const quickStartColumns = useMemo(() => {
    const pinned = sortedCategories
      .filter((category) => category.isPinned)
      .map((category) => ({ color: category.color ?? null, icon: category.icon ?? null, id: category.id, name: category.name }));
    const weekly = weeklySecondsByActivity(
      historySourceEntries.filter((entry) => !isReviewNeededEntry(entry)),
      Date.now()
    );
    return layoutQuickStartMosaic(rankQuickStartActivities(pinned, weekly));
    // todayKey moves the seven-day window at midnight.
  }, [historySourceEntries, sortedCategories, todayKey]);
  // The Play orb's bloom: pinned activities first, then the most used over the last seven days.
  const bloomActivityList = useMemo(() => {
    const recent = weeklySecondsByActivity(
      historySourceEntries.filter((entry) => !isReviewNeededEntry(entry)),
      Date.now()
    );
    return bloomActivities(
      sortedCategories.map((category) => ({
        color: category.color ?? null,
        icon: category.icon ?? null,
        id: category.id,
        name: category.name,
        pinned: category.isPinned,
      })),
      recent
    );
    // todayKey moves the seven-day window at midnight.
  }, [historySourceEntries, sortedCategories, todayKey]);
  // Counted in cards, an outing once (PRD D19, PR 12c).
  const openReviewCount = useMemo(
    () => reviewCardCount((data?.reviewItems ?? []).filter(isOpenReviewItem)),
    [data?.reviewItems]
  );
  // Whole minutes only, so the goal frame reads the per-minute clock (investigation 2026-10-07).
  const todayGoalFrame = useMemo(
    () => buildTodayGoalFrame({
      categories: withGoalExclusions(data?.categories, data?.goalExcludedCategoryIds),
      entries: loggedSourceEntries,
      goalMinutes: data?.user.dailyGoalMinutes,
      nowMs: minuteNow,
    }),
    [data?.categories, data?.goalExcludedCategoryIds, data?.user.dailyGoalMinutes, loggedSourceEntries, minuteNow]
  );
  // "Where today went" (D15): covered time per activity on the same per-minute clock and entries as
  // the goal frame, so it adds up to the hero; never rebuilt on the 1 s tick.
  const todayWhereWent = useMemo(
    () => buildTodayWhereWent({ entries: loggedSourceEntries, nowMs: minuteNow }),
    [loggedSourceEntries, minuteNow]
  );
  const todayWhereWentQuiet = data !== previousTodayData.current && data === loadedBootstrap.current;
  useEffect(() => {
    previousTodayData.current = data;
  }, [data]);
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
  // The bloom's "Now:" line names the block: its description, else its activity, never the
  // live card's "Add a description" prompt (Codex r1 on #592).
  const bloomRunningTitle = activeTitleIsPlaceholder ? displayedActiveEntry?.categoryName || "Untitled" : activeTitle;
  const stopFlightExit = useStopFlightExit({
    displayedEntryId: displayedActiveEntry?.id ?? null,
    flightEntryId: stopFlight?.entryId ?? null,
    hasLiveActiveTimer,
    resolveEntryId: timerEntryIdentity,
  });
  const clockFormat = useClockFormat();
  const todayLivePresentation: TodayActiveTimerPresentation | null = displayedActiveEntry ? {
    categoryColor: displayedActiveEntry.categoryName
      ? displayedActiveEntry.categoryColor ?? displayedActiveEntry.categoryId ?? null
      : null,
    categoryIcon: displayedActiveEntry.categoryId
      ? categoryIconById.get(displayedActiveEntry.categoryId) ?? null
      : null,
    categoryLabel: displayedActiveEntry.categoryName ? activeCategoryLabel : null,
    elapsedLabel: formatLiveClock(displayedActiveDurationSeconds),
    elapsedSeconds: displayedActiveDurationSeconds,
    durationSeconds: displayedActiveEntry.durationSeconds,
    hasLiveActiveTimer,
    startedAt: displayedActiveEntry.startedAt,
    startedLabel: `Started ${formatTimeOfDay(new Date(displayedActiveEntry.startedAt), clockFormat)}`,
    title: activeTitle,
    titleIsPlaceholder: activeTitleIsPlaceholder,
  } : null;
  // While a Stop flight's ghost holds the block's place (Stop being saved), the orb's ring holds the
  // ghost's time; a refused or rolled-back Stop clears the flight and the ring counts on (Codex r1 on #439).
  const orbHeldSeconds =
    hasLiveActiveTimer &&
    stopFlight &&
    displayedActiveEntry &&
    timerEntryIdentity(stopFlight.entryId) === timerEntryIdentity(displayedActiveEntry.id)
      ? stopFlight.presentation.elapsedSeconds
      : undefined;
  const recentStoppedAt = useMemo(
    () => recentStoppedEntryTime(data?.entries ?? [], data?.activeEntry ?? null),
    [data?.activeEntry, data?.entries]
  );
  // PRD D16 (owner idea 1, 14 Oct 2026): the running block's sheet offers to start it where
  // today's last finished block ended, when that was 1 min–4 h before the block started.
  const previousEndForSheet = useMemo(() => {
    const active = retainedActiveEntryForSheet;
    if (!active) return null;
    const startMs = Date.parse(active.startedAt);
    if (!Number.isFinite(startMs)) return null;
    const day = new Date(startMs);
    day.setHours(0, 0, 0, 0);
    // Only the blocks already loaded (owner: no new query or field); keyed to the running block's
    // start, so it never changes with the clock.
    return previousEndOffer(data?.entries ?? [], { dayStartMs: day.getTime(), excludeId: active.id, startMs });
  }, [data?.entries, retainedActiveEntryForSheet]);
  const hapticsEnabled = useHapticsPreference();
  // UIA-060: once the bootstrap's open Review list is at its cap, the Calendar also draws open
  // suggestions from Today's cached scoped Review window (60 days, its own completeness), so a
  // burst of newer suggestions never hides a recent day's Review block.
  const [scopedReviewItems, setScopedReviewItems] = useState<MobileReviewItem[]>([]);
  const reviewListAtCap = bootstrapReviewListMayBeIncomplete(data);
  const scopedOwner = useMemo(() => reviewOwner(data), [data]);
  const scopedOwnerKey = scopedOwner ? `${scopedOwner.backendId}:${scopedOwner.workspaceId}:${scopedOwner.userId}` : null;
  const scopedDayKey = localDayKey(minuteNow);
  useEffect(() => {
    if (!reviewListAtCap || !scopedOwner) {
      setScopedReviewItems([]);
      return;
    }
    const timeZone = currentTimeZone();
    if (!timeZone) return;
    let current = true;
    let sequence = 0;
    // Re-read whenever Review's cache or local decisions change (Today caching a newer window, a
    // decision made here), always for today's window scope.
    const read = () => {
      const mine = ++sequence;
      Promise.all([
        // Today's window, or the day before's until Today caches the new one (midnight, offline).
        newestCachedReviewWindow(scopedDayKey, (dayKey) =>
          readReviewPresentationSnapshot({ owner: scopedOwner, response: { scope: windowScopeFor(dayKey, timeZone) } })),
        readSuppressedReviewItemIds(scopedOwner)
      ])
        .then(([snapshot, suppressed]) => {
          if (current && mine === sequence) setScopedReviewItems(scopedOpenReviewItems(snapshot, suppressed));
        })
        .catch(() => undefined);
    };
    read();
    const unsubscribe = subscribeReviewSync(read);
    return () => {
      current = false;
      unsubscribe();
    };
    // scopedOwner is keyed by scopedOwnerKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewListAtCap, scopedOwnerKey, scopedDayKey]);
  // Suggestions decided on this phone (held, queued or saved, not yet in a refreshed bootstrap), for this
  // account only: the List's "?", the Calendar badge and Today's chip leave them at once.
  // With them, the suggestions with a waiting or rejected change of their own, which never fold into an
  // outing (the deck's eligibility, Codex r2 on #582).
  const [locallyDecided, setLocallyDecided] = useState<{ owner: string; ids: ReadonlySet<string>; syncStateIds: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    if (!scopedOwner || !scopedOwnerKey) return;
    let current = true;
    let sequence = 0;
    const read = () => {
      const mine = ++sequence;
      Promise.all([readSuppressedReviewItemIds(scopedOwner), getReviewItemSyncStates()])
        .then(([ids, states]) => {
          if (current && mine === sequence) setLocallyDecided({ owner: scopedOwnerKey, ids: new Set(ids), syncStateIds: new Set(states.keys()) });
        })
        .catch(() => undefined);
    };
    read();
    const unsubscribe = subscribeReviewSync(read);
    return () => {
      current = false;
      unsubscribe();
    };
    // scopedOwner is keyed by scopedOwnerKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedOwnerKey]);
  const locallyDecidedIds = useMemo<ReadonlySet<string>>(
    () => locallyDecided && locallyDecided.owner === scopedOwnerKey ? locallyDecided.ids : new Set(),
    [locallyDecided, scopedOwnerKey]
  );
  const reviewSyncStateIds = useMemo<ReadonlySet<string>>(
    () => locallyDecided && locallyDecided.owner === scopedOwnerKey ? locallyDecided.syncStateIds : new Set(),
    [locallyDecided, scopedOwnerKey]
  );
  const calendarData = useMemo(
    () => data && reviewListAtCap
      ? { ...data, reviewItems: calendarReviewItems(data.reviewItems ?? [], scopedReviewItems, true) }
      : data,
    [data, reviewListAtCap, scopedReviewItems]
  );
  // Answers in Calendar › List (location v4 step 14, iPhone part 3b): the deck's "Log it" and "Skip", held
  // for Undo and then saved with the deck's own mutation; held and saving answers leave the List at once.
  // Location timeline corrections still on the phone (step 12), this account's.
  const correctionOwner = useMemo(() => authState === "authenticated" && data ? { userId: data.user.id, workspaceId: data.workspace.id } : null,
    [authState, data]);
  const correctionQueue = useTimelineCorrectionQueue(correctionOwner);
  const checkAnswers = useCalendarCheckAnswers({
    data: calendarData,
    locallyDecidedIds,
    // The backend, workspace and user. A build without a backend identity has none: its List offers no answers
    // (Codex r8 and r9 on #582).
    ownerKey: scopedOwnerKey ?? null,
    syncStateIds: reviewSyncStateIds
  });
  // What the Calendar shows: its data, plus answers brought back (Undo, a failed save) for suggestions a
  // refresh paged out, until the next read replaces it (Codex r2 on #582).
  const shownCalendarData = checkAnswers.data;
  // Things to check (location v4 step 14, iPhone part 3a): the open suggestions the Calendar draws, an
  // outing once on its stay, as "?" in Calendar › List; the Calendar tab's badge counts today and the 7 days
  // before, and Today's chip counts today, from the same list, so a decision here moves them at once.
  // The open suggestions the List asks about, and the outings it folds (their trips asked with their stay).
  // Answers from a sheet waiting for its corrections (Codex r2 on #610): released into the Review outbox once the
  // server has them; their "?" stay out of the List and Grid meanwhile.
  const answersAfterCorrections = useAnswersAfterCorrections({ data: shownCalendarData, owner: correctionOwner,
    // Dropped (its change refused): its "?" comes back at once, not at the Review outbox's next read (Codex r3 on #610).
    onDropped: (reviewItemIds) => checkAnswers.restoreAnswered(reviewItemIds) });
  // "?" the server resolved with an acknowledged correction: a Logs as on a place with an open "?" resolves them in
  // the same transaction, as their own "Not now" (#609), so they leave at once, until the day is read again.
  const resolvedByCorrections = useMemo(() => new Set(correctionQueue.acknowledged.flatMap((item) => item.resolvedReviewItemIds ?? [])),
    [correctionQueue.acknowledged]);
  const calendarCheckBase = useMemo(() => {
    // Suggestions decided on this phone and not yet synced leave at once (Codex r1 on #573), and so do
    // answers held for Undo or saving (part 3b), waiting for corrections, or resolved by one.
    const open = (shownCalendarData?.reviewItems ?? []).filter((item) => isOpenReviewItem(item) && !locallyDecidedIds.has(item.id)
      && !checkAnswers.hiddenIds.has(item.id) && !resolvedByCorrections.has(item.id)
      // Hidden while a waiting record (held, committing or committed) answers it, the stay or an outing's trip; an
      // abandoned record never hides it (Codex r11 on #610).
      && !answersAfterCorrections.waitingIds.has(item.id)
      && !(typeof item.rawPayload?.clientSegmentId === "string" && answersAfterCorrections.waitingSegments.has(item.rawPayload.clientSegmentId)));
    return { open, ...calendarCheckOutings(open, reviewSyncStateIds) };
  }, [shownCalendarData?.reviewItems, checkAnswers.hiddenIds, answersAfterCorrections.waitingIds,
    answersAfterCorrections.waitingSegments,
    locallyDecidedIds, resolvedByCorrections, reviewSyncStateIds]);
  // Card B part 2: the "?" whose question is open, and the Apple place guessed nearby for it.
  const [openCalendarCheckId, setOpenCalendarCheckId] = useState<string | null>(null);
  const openCalendarCheck = openCalendarCheckId
    ? shownCalendarData?.reviewItems.find((item) => item.id === openCalendarCheckId) ?? null
    : null;
  // Whether the Calendar tab is the screen in front, as its render last said (the search runs only then).
  const [calendarOnScreen, setCalendarOnScreen] = useState(false);
  const openCheckVenue = useCheckVenueGuess({
    item: openCalendarCheck,
    outing: Boolean(openCalendarCheck?.id && calendarCheckBase.outings.has(openCalendarCheck.id)),
    owner: authState === "authenticated" && data ? { userId: data.user.id, workspaceId: data.workspace.id } : null,
    onScreen: calendarOnScreen
  });
  const calendarChecks = useMemo(() => {
    // An outing is folded, asked once on its stay, counted and saved by one map: the deck's grouping and
    // eligibility (Codex r2 on #582).
    const { open, outings, folded } = calendarCheckBase;
    // A suggestion without a start still sits on its place's row; it has no row, or count, of its own.
    const items = open.filter((item) => !folded.has(item.id) && (item.suggestedStartedAt || typeof item.rawPayload?.clientSegmentId === "string"));
    return {
      checks: items.map((item): ListCheck => ({
        id: item.id,
        segmentId: typeof item.rawPayload?.clientSegmentId === "string" ? item.rawPayload.clientSegmentId : null,
        startedAt: item.suggestedStartedAt,
        stoppedAt: item.suggestedStoppedAt
      })),
      titles: new Map(items.map((item) => [item.id, item.title] as const)),
      // What each "?" is about, for which have a sheet (Codex r2 on #610): Apple Health's; a location suggestion's
      // place or trip by its segment; anything else (a legacy location suggestion from before location v2, which
      // has no segment) "none", asked under its row.
      kinds: new Map(items.map((item) => [item.id, calendarCheckKind(item)] as const)),
      // Owner, 28 Oct 2026 (concern 1): each "?" row's own icon — a trip's route, Apple Health's heart, a place's pin.
      glyphs: new Map(items.map((item) => [item.id, (item.eventType === "commute_detected" ? DAYFRAME_APP_ICONS.openTrip
        : item.eventType?.startsWith("health_") || item.eventSource?.startsWith("health_") ? DAYFRAME_APP_ICONS.sourceHealth
          : DAYFRAME_APP_ICONS.places) as DayframeGlyph] as const)),
      questions: new Map(items.map((item) => [item.id, reviewAnswerQuestion(item, clockFormat, {
        outing: outings.has(item.id),
        pendingChange: reviewSyncStateIds.has(item.id),
        venue: item.id === openCalendarCheckId ? openCheckVenue.venue : null
      })] as const))
    };
  }, [calendarCheckBase, clockFormat, reviewSyncStateIds, openCalendarCheckId, openCheckVenue.venue]);
  // Counted by the List's own rule (listCheckOverlaps), so a count always matches its "?" (Codex r1 on #573);
  // both windows run to the end of today, so later today counts as the List shows it (Codex r5 on #573).
  // Owner, 28 Oct 2026 (concern 4): only "?" from today and the 6 days before ask; the badge, the List's
  // "N to check" and the reminder count and step through them oldest first, across days. Older ones stop asking:
  // their places stay plain rows you can still correct.
  const askingChecks = useMemo(() => {
    const fromMs = checkAskingStartMs(dateFromKey(todayKey).getTime());
    return checksOldestFirst(calendarChecks.checks.filter((check) => check.startedAt && checkStillAsks(check, fromMs)));
  }, [calendarChecks, todayKey]);
  // `week` is the 7-day count (the Calendar badge, the List's "N to check" and the reminder). `today` is Today's
  // own "N to check today" chip, today-only on purpose (owner-approved; kept so after Codex r1 on #610): it counts
  // today's "?" and opens today's oldest; earlier days are the badge's.
  const checkCounts = useMemo(() => {
    const todayStart = dateFromKey(todayKey).getTime();
    const tomorrowStart = addDaysToDate(dateFromKey(todayKey), 1).getTime();
    return { week: askingChecks.length, today: askingChecks.filter((check) => listCheckOverlaps(check, todayStart, tomorrowStart)).length };
  }, [askingChecks, todayKey]);
  // Owner item 13 (28 Oct 2026): the end-of-day reminder counts the badge's "?", for this account, noted again on
  // each return to the front and each new day so the one-shot reminder is renewed (Codex r1 on #610).
  const nudgeOwner = useMemo(() => authState === "authenticated" && data ? { userId: data.user.id, workspaceId: data.workspace.id } : null,
    [authState, data]);
  useReviewNudgeCount(nudgeOwner, askingChecks.length, { dayKey: todayKey, foreground: appIsForeground });
  // Today's chip opens Calendar › List on today and scrolls it to the first "?".
  const [calendarCheckScroll, setCalendarCheckScroll] = useState(0);
  // Every request a new number, even after a used one was cleared to 0, so the List knows it is new (Codex r1 on #582).
  const calendarCheckRequests = useRef(0);
  // Quick win (b): the hatched count chip on Earlier this week rows, from the same open Review
  // items the Calendar draws (the bootstrap's list, plus Today's scoped window when it is capped).
  const earlierDayReviewCountMap = useMemo(
    () => {
      // An outing's Moves are part of its card (PRD D19, PR 12c): a day counts the card once.
      // The same outings the deck and Calendar › List fold (Codex r2 on #582).
      const open = (shownCalendarData?.reviewItems ?? []).filter(isOpenReviewItem);
      const { folded } = calendarCheckOutings(open, reviewSyncStateIds);
      return earlierDayReviewCounts(earlierDays, open.filter((item) => !folded.has(item.id)));
    },
    [shownCalendarData?.reviewItems, earlierDays, reviewSyncStateIds]
  );
  // Owner, 28 Oct 2026: the Grid draws only the "?" that still ask, outings folded, as the List does, so an expired
  // or folded suggestion is never a dashed block there; onOpenReview's lookup (calendarChecks) covers every one drawn.
  const gridReviewItemIds = useMemo(() => new Set(askingChecks.map((check) => check.id)), [askingChecks]);
  const nativeCalendarBridge = useMemo(
    () => buildNativeCalendarBridgeState({
      clockFormat,
      data: shownCalendarData,
      reviewItemIds: gridReviewItemIds,
      hapticsEnabled,
      // Whole minutes are all the Calendar shows; a per-second model made SwiftUI republish every second.
      now: minuteNow,
      reduceMotion,
      reduceTransparency,
      refreshing,
      selectedDayKey,
      theme,
      transitionDirection: calendarTransitionDirection
    }),
    [
      calendarTransitionDirection,
      shownCalendarData,
      gridReviewItemIds,
      clockFormat,
      hapticsEnabled,
      minuteNow,
      reduceMotion,
      reduceTransparency,
      refreshing,
      selectedDayKey,
      theme
    ]
  );
  // Stable objects, so DayframeCalendarView re-serialises only when the model or refresh state changes.
  const nativeCalendarModel = useMemo(
    () => ({ ...nativeCalendarBridge.model, layout: calendarLayout, refreshing: false }),
    [calendarLayout, nativeCalendarBridge.model]
  );
  const nativeCalendarModelRefreshing = useMemo(
    () => ({ ...nativeCalendarBridge.model, layout: calendarLayout, refreshing: true }),
    [calendarLayout, nativeCalendarBridge.model]
  );
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CALENDAR_LAYOUT_KEY).then((stored) => {
      if (!cancelled && !calendarLayoutChosen.current && stored === "list") setCalendarLayout("list");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const changeCalendarLayout = useCallback((layout: "grid" | "list") => {
    calendarLayoutChosen.current = true;
    setCalendarLayout(layout);
    void AsyncStorage.setItem(CALENDAR_LAYOUT_KEY, layout).catch(() => undefined);
  }, []);
  // The List's places and trips: the selected day's timeline for this account, read again after each refresh.
  // Location timeline corrections still on the phone (step 12) show over the List's timeline at once; each
  // time the queue shrinks (delivered) the timeline is read again (correctionQueue, above).
  // A request for one "?" reads its day again too, so a read from before it never decides that its item is missing
  // (Codex r3 on #610).
  const [checkTimelineReads, setCheckTimelineReads] = useState(0);
  const calendarTimelineRefreshKey = useMemo(
    () => ({ calendarData, delivered: correctionQueue.delivered, checkTimelineReads }),
    [calendarData, correctionQueue.delivered, checkTimelineReads]
  );
  const serverCalendarSnapshot = useCalendarTimelineSnapshot({
    dayKey: selectedDayKey,
    // The Grid reads the day's places too (its Places lane and trip legs, steps 16–17).
    enabled: true,
    fetchTimeline: fetchLocationTimeline,
    owner: authState === "authenticated" && data ? `${data.workspace.id}:${data.user.id}` : null,
    refreshKey: calendarTimelineRefreshKey
  });
  // Acknowledged corrections stay shown until a timeline asked for after them lands, so nothing flickers back.
  const { timeline: serverCalendarTimeline, requestedAt: calendarTimelineRequestedAt } = serverCalendarSnapshot;
  const calendarTimeline = useMemo(() => projectTimelineCorrections(serverCalendarTimeline,
    correctionsToShow(correctionQueue.acknowledged, correctionQueue.pending, calendarTimelineRequestedAt)),
  [serverCalendarTimeline, calendarTimelineRequestedAt, correctionQueue.acknowledged, correctionQueue.pending]);
  // Steps 16–17: the Grid's Places lane and trip leg strips, from the same timeline.
  const gridModel = useMemo(() => calendarLayout === "grid"
    ? withPlacesAndLegs(nativeCalendarModel, calendarTimeline, askingChecks, (ms) => formatClockTime(new Date(ms), clockFormat))
    : nativeCalendarModel,
  [askingChecks, calendarLayout, calendarTimeline, clockFormat, nativeCalendarModel]);
  const gridModelRefreshing = useMemo(() => gridModel === nativeCalendarModel ? nativeCalendarModelRefreshing : { ...gridModel, refreshing: true },
    [gridModel, nativeCalendarModel, nativeCalendarModelRefreshing]);
  // The List's place, trip and leg correction sheets (step 12).
  const locationCorrections = useLocationCorrections({
    acknowledged: correctionQueue.acknowledged,
    clockFormat,
    data: authState === "authenticated" ? data : null,
    // A place logged with Logs as: its blocks come with the next read of the day.
    onLogged: () => { void load(); },
    pending: correctionQueue.pending,
    // Owner items A, B, I (28 Oct 2026): a sheet opened from a row or the Grid asks its item's "?" on top.
    questionFor: (kind, itemId) => {
      const check = askingChecks.find((each) => each.segmentId === itemId);
      const question = check ? calendarChecks.questions.get(check.id) : undefined;
      if (!check || !question || !scopedOwnerKey) return null;
      return {
        text: question.question,
        // The row and the sheet already say the times; only words that add something stay.
        detail: question.detail && !/\d:\d\d/.test(question.detail) ? question.detail : null,
        yesLabel: question.logLabel ?? null,
        noLabel: question.skipLabel ?? "Not now",
        // No changes in the sheet: checkAnswers.answer is the one gated entry point, so it never goes ahead of a
        // correction queued for its place or trip from an earlier Done (Codex r6 and r7 on #610).
        onAnswer: (yes) => { checkAnswers.answer(check.id, yes, check.id === openCalendarCheckId ? openCheckVenue.venue : null); },
        // One tap with the sheet's own changes (owner, 28 Oct 2026; Codex r2 on #610): the answer is kept on the phone
        // before the corrections are queued — with every one already queued for its place or trip (Codex r6) — and goes
        // to the Review outbox only once the server has every one of them. No Apple place with it: the corrections say
        // where it was.
        answerAfter: async (yes, ids) => {
          if (!correctionOwner || !check.segmentId) throw new Error("No account.");
          const id = createReviewClientMutationId();
          // The account it is registered for: its start checks it is still this one (Codex r14 on #610), and every write
          // to its record is for that account (r15).
          const registeredFor = scopedOwnerKey;
          const registeredOwner = correctionOwner;
          const record = await waitForItemCorrections(correctionOwner, { id, itemId: check.segmentId, newIds: ids,
            action: { kind: "answer", reviewItemId: check.id, logged: yes } });
          if (!record) throw new Error("Nothing to wait for.");
          return {
            start: () => {
              // The one completion path: withdrawn, settled quietly, or held for Undo (Codex r14 on #610).
              checkAnswers.startAfterCorrections(check.id, yes, id, registeredFor, registeredOwner);
            },
            cancel: () => withdrawAnswerAfterCorrections(registeredOwner, id)
          };
        }
      };
    },
    reduceMotion,
    showNotice: (message) => showTodayNotice(message, null),
    theme,
    timeline: calendarTimeline
  });
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
          { blankStartToken }
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

  function nextLandingRequest(entryIds?: readonly string[]): LandingRequest {
    landingSequence.current += 1;
    return { entryIds, requestedAt: Date.now(), token: landingSequence.current };
  }

  // Today's Start/Stop: haptic and landing only after the local action is accepted (motion.md).
  // A start that replaces a running block says so ("Switched to …", no Undo: there is no un-switch
  // contract); a start of exactly what is recording does nothing but say "Already recording".
  function startFromToday(categoryId: string | null, description = "", tagNames: string[] = []) {
    const running = isActiveEntryPendingDeletion() ? null : latestData.current?.activeEntry ?? null;
    if (running && startMatchesRunning(running, { categoryId, description, tagNames })) {
      showTodayNotice(alreadyRecordingToastMessage(running), toastSwatchColor(running, theme.mode));
      return;
    }
    const switching = Boolean(running) && Boolean(categoryId || description.trim());
    const category = categoryId ? latestData.current?.categories.find((item) => item.id === categoryId) ?? null : null;
    const noticeOwner = todayNoticeOwner();
    void startTask(categoryId, description, tagNames).then((accepted) => {
      if (!accepted) return;
      playHaptic("start");
      setLiveLanding(nextLandingRequest());
      if (!switching || !running) return;
      // Dropped when the account or session changed while the start was being accepted.
      if (!todayNoticeOwnerStill(noticeOwner)) return;
      const nextName = description.trim() || category?.name || "No activity";
      showTodayNotice(
        switchedToastCopy(nextName, running, Date.now()),
        category ? toastSwatchColor({ categoryColor: category.color, categoryId: category.id, categoryName: category.name }, theme.mode) : null
      );
    });
  }

  function todayNoticeOwner() {
    const current = latestData.current;
    return {
      generation: noticeSessionGeneration.current,
      userId: current?.user.id ?? null,
      workspaceId: current?.workspace.id ?? null
    };
  }

  function todayNoticeOwnerStill(owner: ReturnType<typeof todayNoticeOwner>) {
    const current = latestData.current;
    return authStateCurrent.current === "authenticated" &&
      owner.generation === noticeSessionGeneration.current &&
      owner.userId !== null &&
      owner.userId === (current?.user.id ?? null) &&
      owner.workspaceId === (current?.workspace.id ?? null);
  }

  function showTodayNotice(copy: string | BlocksToastCopy, swatchColor: string | null) {
    if (authStateCurrent.current !== "authenticated") return;
    // The delete Undo toast holds the place: VoiceOver still hears the notice, nothing is drawn.
    if (deletionCoordinator.current?.current()?.phase === "active") {
      AccessibilityInfo.announceForAccessibility(toastAccessibilityText(copy));
      return;
    }
    todayNotice.show(copy, swatchColor);
  }

  function stopFromToday() {
    const entryId = latestData.current?.activeEntry?.id;
    // The ghost shows the time the block stopped at (the Dashboard itself moves on the minute).
    const presentation = todayLivePresentation && livePresentationAt(todayLivePresentation, Date.now());
    // No flight under Reduce Motion, or before the overlay that draws the ghost has measured itself.
    if (reduceMotion || !entryId || !presentation || !stopFlightOverlayReady()) {
      runStopFromToday(entryId, null);
      return;
    }
    // The Stop flight (motion.md): measure the live block and its row first, so the ghost takes the
    // block's place in the same frame the block hides and can fly the moment Stop is accepted.
    // A second tap while measuring is the same Stop.
    if (stopFlightMeasuring.current) return;
    stopFlightMeasuring.current = true;
    const token = ++stopFlightSequence.current;
    const generation = noticeSessionGeneration.current;
    void Promise.all([measureFlightNode(LIVE_FLIGHT_NODE), measureFlightNode(rowFlightNode(entryId))]).then(([from, to]) => {
      stopFlightMeasuring.current = false;
      // The Stop belongs to the account and block it was pressed for: a sign-out or account switch, or a
      // block that changed while measuring, drops it (Codex r1 on #415).
      const current = latestData.current?.activeEntry?.id;
      if (
        generation !== noticeSessionGeneration.current ||
        !current ||
        timerEntryIdentity(current) !== timerEntryIdentity(entryId)
      ) return;
      if (from) {
        stopFlightLedger.begin(token, entryId);
        setStopFlight({ entryId, flying: false, from, presentation, to: to ?? "none", token });
      }
      runStopFromToday(entryId, from ? token : null, Boolean(to));
    });
  }

  // The Play orb (step 3): tap starts a bare block (which opens it) or stops the running one; on
  // Today the Stop flies the live block into its row, elsewhere it stops in place.
  function tapPlayOrb() {
    const entryId = latestData.current?.activeEntry?.id;
    if (!entryId) {
      startFromToday(null);
      return;
    }
    if (todayTabFocused.current) stopFromToday();
    else runStopFromToday(entryId, null);
  }

  // A bloom pick starts that activity, or switches to it; the running activity opens its editor
  // instead of starting a duplicate, as its mosaic tile does.
  function chooseFromPlayOrb(activityId: string) {
    const active = latestData.current?.activeEntry;
    if (active && active.categoryId === activityId) {
      presentActiveEditor("existing_active_timer");
      return;
    }
    startFromToday(activityId);
  }

  function runStopFromToday(entryId: string | undefined, flightToken: number | null, flightHasRow = false) {
    // A refused, failed or rejected Stop keeps the live block: the ghost leaves without flying.
    const dropFlight = () => {
      if (flightToken === null) return;
      stopFlightLedger.clear(flightToken);
      setStopFlight((current) => (current?.token === flightToken ? null : current));
    };
    const generation = noticeSessionGeneration.current;
    void stopActiveTimer().then((accepted) => {
      // Signed out or switched account meanwhile: the flight and its feedback were already cleared.
      if (generation !== noticeSessionGeneration.current) return;
      if (!accepted || !entryId) {
        dropFlight();
        return;
      }
      // Rolled back before this acceptance ran (delivery rejected at once): the block is live again and
      // its flight was already cancelled, so nothing flies, lands or plays.
      if (flightToken !== null && !stopFlightLedger.isLive(flightToken)) return;
      playHaptic("stop", flightToken !== null ? { stopLandingDelayMs: STOP_FLIGHT.durationMs } : undefined);
      // A rolled-back Stop remounts the live block; it must not replay the Start landing.
      setLiveLanding(null);
      if (flightToken === null || !flightHasRow) {
        // Without a flight, or with no row to land on (the ghost fades where it is), the row lands.
        setRowLanding(nextLandingRequest([entryId]));
        if (flightToken === null) return;
      }
      setStopFlight((current) => (current?.token === flightToken ? { ...current, flying: true } : current));
      if (!flightHasRow) return;
      // The idle card is shorter than the live block, so the row moves up once Stop commits:
      // measure it again and let the ghost chase it.
      requestAnimationFrame(() => {
        void measureFlightNode(rowFlightNode(entryId)).then((to) => {
          if (!to) return;
          setStopFlight((current) => (current?.token === flightToken && current.to !== "none" ? { ...current, to } : current));
        });
      });
    }, dropFlight);
  }

  // A Stop rolled back while its ghost is still flying (delivery rejected) brings the live block
  // back at once: the ghost leaves without landing, so nothing pops on a row that is running again.
  // The rollback cancels the flight synchronously (cancelStopFlightFor), and so does any publication
  // that shows the flown block running again (publishDashboardData, Codex r4 on #415), so neither a
  // queued completion nor a later acceptance can act on it; this effect then clears the ghost.
  function cancelStopFlightFor(entryId: string) {
    dropCancelledStopFlight(stopFlightLedger.cancelFor(entryId));
  }
  const stopFlightCommitted = useRef<number | null>(null);
  useEffect(() => {
    if (!stopFlight?.flying) return;
    const activeId = data?.activeEntry?.id ?? null;
    if (!activeId || timerEntryIdentity(activeId) !== timerEntryIdentity(stopFlight.entryId)) {
      stopFlightCommitted.current = stopFlight.token;
      return;
    }
    if (stopFlightCommitted.current === stopFlight.token) {
      stopFlightLedger.clear(stopFlight.token);
      setStopFlight(null);
    }
  }, [data?.activeEntry?.id, stopFlight]);

  // The native tab item under the orb (VoiceOver's way in) reports presses here and reads the
  // running state for its label.
  const tapPlayOrbRef = useRef(tapPlayOrb);
  tapPlayOrbRef.current = tapPlayOrb;
  useEffect(() => onPlayOrbTap(() => tapPlayOrbRef.current()), []);
  useEffect(() => {
    setPlayOrbRunning(hasLiveActiveTimer);
  }, [hasLiveActiveTimer]);
  // The coral orb needs a session and the tab bar's trailing slot (iPhone, iOS 26 or later).
  const playOrbAvailable = authState === "authenticated" && PLAY_ORB_SUPPORTED;
  // Stable callbacks that always run this render's actions: the orb is memoised, so it must never
  // hold an older render's closures (an old live presentation would reach the Stop flight).
  const chooseFromPlayOrbRef = useRef(chooseFromPlayOrb);
  chooseFromPlayOrbRef.current = chooseFromPlayOrb;
  const onPlayOrbTapStable = useCallback(() => tapPlayOrbRef.current(), []);
  const onPlayOrbChooseStable = useCallback((activityId: string) => chooseFromPlayOrbRef.current(activityId), []);

  // Stable, so the flight's ghost is not re-rendered by the Dashboard's 1 s tick handing it a new callback.
  const finishStopFlight = useCallback((token: number, landed: boolean, entryId: string) => {
    // Only the live flight finishes, once; one already replaced or cleared (logout) does nothing.
    if (!stopFlightLedger.finish(token)) return;
    setStopFlight((current) => (current?.token === token ? null : current));
    // The row block pops and the row lights up as the ghost lands on it.
    // nextLandingRequest reads only refs, so the first render's copy stays correct.
    if (landed) setRowPop(nextLandingRequest([entryId]));
  }, []);

  function switchToRecent(entry: TimeEntry) {
    startFromToday(
      entry.categoryId,
      entry.description ?? "",
      entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []
    );
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

  // The entry sheet's All-activities picker creates an activity with the icon its Create row shows
  // (the server picks its colour) and
  // adds it to the cached bootstrap so the sheet can select it at once.
  async function createSheetActivity(name: string, icon?: string): Promise<{ id: string } | { error: string }> {
    try {
      const response = await createCategory(name, icon ? { icon } : {});
      updateDashboardData((current) => current
        ? { ...current, categories: [...current.categories.filter((category) => category.id !== response.category.id), response.category] }
        : current);
      return { id: response.category.id };
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        transitionToSignedOut();
        return { error: "Sign in again to create activities." };
      }
      if (error instanceof ActivityNameTakenError) {
        // Created elsewhere since the last refresh: refresh so it appears in the list to pick.
        void load();
        return { error: `${error.message} It will appear in the list in a moment.` };
      }
      return { error: `Couldn't create "${name}". Check your connection and try again.` };
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
    if (!activeEntry || !isSameRunningEntry(activeEntry.id, entryId, persistedTimerEntryId)) return false;
    // Save against the id the dashboard holds now (the sheet may still hold the optimistic one).
    return saveTimeEntryOptimistically(
      activeEntry.id,
      {
        categoryId: suggestion.categoryId,
        description: suggestion.description,
        tagNames: suggestion.tagNames
      },
      "Block not saved"
    );
  }

  async function startTaskWith(input: {
    categoryId?: string | null;
    description?: string | null;
    startedAt?: string | null;
    tagNames?: string[];
  }, options: { blankStartToken?: number } = {}) {
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
        throw new Error("The block couldn't be saved on this iPhone to send later.");
      }
    } catch {
      if (options.blankStartToken !== undefined) {
        blankTimerStartGate.current.release(options.blankStartToken);
      }
      Alert.alert(
        "Block not started",
        "Dayframe could not save this block on your iPhone. Check available storage and try again."
      );
      return false;
    }

    optimisticTimerStartReconciler.current.begin(optimisticId);
    settleOptimisticTimerStart(optimisticId, "queued");
    queuedTimerStartRecoveryRequested.current = true;
    nextTimerMutationVersion(optimisticId);
    updateDashboardData((current) => optimisticStartTimer(current, pendingEntry));
    if (connectivityCurrent.current.isOnline) {
      void syncQueuedEventsAndReload();
    }
    return true;
  }

  function rejectOptimisticTimerStart(
    optimisticId: string,
    previousData: MobileBootstrap | null,
    error: unknown,
    alert = true
  ) {
    const rollbackSnapshot = supersededStopRollbackTracker.current.consume(
      optimisticId,
      previousData
    );
    // Only this block leaves a pending deletion; any saved blocks deleted with it keep their Undo
    // (Codex r2 on #532). A deletion left with nothing to delete releases its sheet token.
    const pending = deletionCoordinator.current?.current();
    if (pending && deletionCoordinator.current?.removePendingEntry(optimisticId) === "invalidated") {
      clearSheetDeletionToken(pending.token);
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
        { error, optimisticId, previousData: rollbackSnapshot, alert }
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
      previousData: rollbackSnapshot,
      alert
    });
  }

  function finalizeRejectedOptimisticStart({
    optimisticId,
    previousData,
    alert = true
  }: RejectedOptimisticStart) {
    updateDashboardData((current) => rollbackRejectedOptimisticTimerStart(
      current,
      previousData,
      optimisticId
    ));
    if (alert) Alert.alert(
      "Block not started",
      "Dayframe could not start this block because the saved request was rejected. Check Settings › Sync help for details."
    );
    setPresentedActiveEntry((current) => current?.id === optimisticId ? null : current);
  }

  async function saveActiveTimerEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    return saveTimeEntryOptimistically(
      entryId,
      patch,
      "Block not saved",
      { awaitPersistence: true }
    );
  }

  async function saveCalendarEntryEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    return saveTimeEntryOptimistically(
      entryId,
      patch,
      "Block not saved",
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
    let clientCommandId: string;
    try {
      ({ clientCommandId } = await enqueueTimeEntryUpdate({
        owner,
        target: persistedId
          ? { targetEntryId: persistedId }
          : { optimisticEntryId: entryId },
        patch,
        requestImmediateDelivery: connectivityCurrent.current.isOnline
      }));
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
        // Feedback belongs to the account that made the edit, checked again after every wait.
        const ownerCurrent = () => {
          const current = latestData.current;
          return Boolean(current && sameTimerStopOwner(timerStopOwner(current), owner));
        };
        if (!ownerCurrent()) return;
        // Any rejection reloads, so its block returns as it was; only this edit's own rejection
        // alerts, as older sync issues stay in Settings › Sync help.
        const rejected = await isTimeEntryCommandRejected(owner, clientCommandId);
        if (!ownerCurrent()) return;
        if (result.deliveredCount > 0 || result.needsAttentionCount > 0 || rejected) {
          await loadRef.current({ silent: true });
        }
        if (rejected && ownerCurrent()) {
          Alert.alert(
            "Change not saved",
            "Dayframe couldn't save this change, so the block is back as it was. Try again or discard it in Settings › Sync help."
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
  // Today's chip and the evening reminder open Calendar › List on today, scrolled to the first "?".
  const openChecksOn = useCallback((dayKey: string) => {
    changeCalendarLayout("list");
    selectCalendarDay(dayKey);
    // A new request each time (a used one was cleared to 0).
    calendarCheckRequests.current += 1;
    setCalendarCheckScroll(calendarCheckRequests.current);
    router.navigate("/(tabs)/calendar");
  }, [changeCalendarLayout, selectCalendarDay]);
  // Owner, 28 Oct 2026 (concern 4): open one "?" by its id — Calendar › List on its day, scrolled to it, its question
  // open. Used by "N to check" (the next one, oldest first), the badge, Today's chip, the reminder and the Grid's "?".
  const [calendarCheckTarget, setCalendarCheckTarget] = useState<{ id: string; request: number; at: number } | null>(null);
  const openCheckOn = useCallback((checkId: string) => {
    const check = calendarChecks.checks.find((each) => each.id === checkId);
    const startedAtMs = check?.startedAt ? Date.parse(check.startedAt) : NaN;
    if (!Number.isFinite(startedAtMs)) return false;
    changeCalendarLayout("list");
    selectCalendarDay(formatDateKey(new Date(startedAtMs)));
    calendarCheckRequests.current += 1;
    setCalendarCheckTarget({ id: checkId, request: calendarCheckRequests.current, at: Date.now() });
    setCheckTimelineReads((count) => count + 1);
    router.navigate("/(tabs)/calendar");
    return true;
  }, [calendarChecks, changeCalendarLayout, selectCalendarDay]);
  const openNextCheck = useCallback((currentId: string | null) => {
    if (!askingChecks.length) return;
    const at = currentId ? askingChecks.findIndex((check) => check.id === currentId) : -1;
    openCheckOn(askingChecks[(at + 1) % askingChecks.length].id);
  }, [askingChecks, openCheckOn]);
  const openOldestCheck = useCallback(() => {
    if (askingChecks[0]) openCheckOn(askingChecks[0].id);
  }, [askingChecks, openCheckOn]);
  // Today's chip: today's oldest "?" only, by design (see checkCounts); the badge opens the 7-day oldest.
  const openTodayChecks = useCallback(() => {
    const todayStart = dateFromKey(formatDateKey(new Date())).getTime();
    const first = askingChecks.find((check) => Date.parse(check.stoppedAt ?? check.startedAt ?? "") > todayStart);
    if (first && openCheckOn(first.id)) return;
    openChecksOn(formatDateKey(new Date()));
  }, [askingChecks, openCheckOn, openChecksOn]);
  useEffect(() => {
    // The reminder opens the oldest question that still asks (no Review page, step 15).
    openTodayChecksRef.current = () => askingChecks[0] ? openCheckOn(askingChecks[0].id) : openChecksOn(formatDateKey(new Date()));
  }, [askingChecks, openCheckOn, openChecksOn]);

  // One stable handler for Today's rows and ribbon, so the per-second header render does not
  // re-render the memoised ribbon. The latest editors are read through the ref.
  const openTodayEntryRef = useRef<(entry: TimeEntry) => void>(() => undefined);
  openTodayEntryRef.current = (entry: TimeEntry) => {
    if (!entry.stoppedAt) {
      presentActiveEditor("existing_active_timer");
      return;
    }
    presentCompletedEntry({ ...entry, isActive: false });
  };
  const openTodayEntry = useCallback((entry: TimeEntry) => openTodayEntryRef.current(entry), []);

  // "Earlier this week" on Today opens that day in the Calendar tab (same provider state).
  const openCalendarDay = useCallback((dayKey: string) => {
    playHaptic("tick");
    selectCalendarDay(dayKey);
    router.navigate("/(tabs)/calendar");
  }, [selectCalendarDay]);

  // "Where today went" opens Reports on Today. A tap while a request is still waiting reuses it.
  const openReportsToday = useCallback(() => {
    playHaptic("tick");
    setReportsRangeRequest((current) => {
      if (current) return current;
      reportsRangeRequestToken.current += 1;
      return { choice: "today", token: reportsRangeRequestToken.current };
    });
    router.navigate("/(tabs)/reports");
  }, []);
  const acknowledgeReportsRangeRequest = useCallback((token: number) => {
    setReportsRangeRequest((current) => (current?.token === token ? null : current));
  }, []);

  const shiftSelectedCalendarWeek = useCallback((weeks: number) => {
    shiftSelectedCalendarDay(weeks * 7);
  }, [shiftSelectedCalendarDay]);

  stopActiveTimerRef.current = stopActiveTimer;
  async function stopActiveTimer() {
    const activeEntry = latestData.current?.activeEntry;
    if (!activeEntry) return false;
    if (!optimisticTimerStartReconciler.current.canRunDependentMutation(activeEntry.id)) return false;
    const bootstrap = latestData.current;
    if (!bootstrap) return false;
    const generation = noticeSessionGeneration.current;
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
        "Block not stopped",
        "Dayframe could not save this Stop on your iPhone. Check available storage and try again."
      );
      return false;
    }
    if (pendingStop.failureKind === "permanent") {
      Alert.alert(
        "Stop needs attention",
        "Open Settings › Sync help to retry or discard the Stop."
      );
      return false;
    }

    // The Stop is durable for the block it was pressed for. If the account or the running block changed
    // while it was saved, it must not stop or annotate what is showing now; the outbox still delivers it
    // for that account (Codex r2 on #415).
    const showing = latestData.current?.activeEntry?.id;
    if (
      generation !== noticeSessionGeneration.current ||
      !showing ||
      timerEntryIdentity(showing) !== timerEntryIdentity(activeEntry.id)
    ) {
      return false;
    }
    setPendingTimerStops((current) => [
      ...current.filter((item) => item.clientEventId !== pendingStop.clientEventId),
      pendingStop
    ]);
    updateDashboardData((current) => optimisticStopActiveTimer(current, pendingStop.occurredAt));

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
      if (
        summary.permanentRejectedClientEventIds.includes(pendingStop.clientEventId) &&
        generation === noticeSessionGeneration.current
      ) {
        cancelStopFlightFor(activeEntry.id);
        updateDashboardData((current) => rollbackOptimisticStopSafely(
          current,
          bootstrap,
          activeEntry.id,
          optimisticTimerIds.current
        ));
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
    // Captured now: a sign-out or teardown during the writes ends this lease, not a later one.
    getDeletionCoordinator();
    const lease = deletionHoldLease.current as TimeEntryCommandHoldLease;
    try {
      // Held until the Undo window, which may open only after the sheet has left, closes
      // (stability audit timer-1). A force-quit keeps the deletion durable.
      const commandIds = await persistUndoableTimeEntryDeletes({
        lease,
        owner,
        targets: entries.map((entry) => {
          const persistedId = persistedTimerEntryId(entry.id);
          return persistedId ? { targetEntryId: persistedId } : { optimisticEntryId: entry.id };
        })
      });
      // Its owner went away during the writes: the deletes stand, unheld, and nothing is shown.
      if (lease.ended) return false;
      deletionCommandIds.current.set(token, commandIds);
      return true;
    } catch {
      if (lease.ended) return false;
      getDeletionCoordinator().invalidate(token);
      Alert.alert(
        entries.length > 1 ? "Blocks not deleted" : "Block not deleted",
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
          currentIds.length > 1 ? "Blocks not deleted" : "Block not deleted",
          `Dayframe could not finish saving this deletion on your iPhone. ${currentIds.length > 1 ? "The blocks were" : "The block was"} restored; check available storage and try again.`
        );
        AccessibilityInfo.announceForAccessibility(
          currentIds.length > 1
            ? "Blocks restored because they couldn't be deleted."
            : "Block restored because it couldn't be deleted."
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
      deletionHoldLease.current?.end();
      // A hold ran out its bound (an Undo that never opened or closed): that Undo closes as if it
      // expired, before the delete is delivered.
      deletionHoldLease.current = createUndoHoldLease((clientCommandId) => {
        for (const [token, ids] of deletionCommandIds.current) {
          if (ids.includes(clientCommandId)) deletionCoordinator.current?.commit(token);
        }
      });
      deletionCoordinator.current = createDeletionCoordinator<
        TimeEntry,
        MobileBootstrap | null
      >({
        canRestore: ({ token }) => canUndoDeletes(deletionCommandIds.current.get(token) ?? []),
        onActivate: ({ activatedAt, token }) => {
          void holdDeletesForOpenedUndoWindow(
            deletionCommandIds.current.get(token) ?? [],
            activatedAt
          ).catch(() => undefined);
        },
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
        },
        // The delete already reached the server (it can't while held; belt and braces): no ghost.
        onRestoreRefused: ({ entries }) => {
          AccessibilityInfo.announceForAccessibility(
            entries.length > 1 ? "Blocks already deleted." : "Block already deleted."
          );
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
      if (coordinator.activate(prepared.token)) playHaptic("delete");
      todayNotice.clear();
      AccessibilityInfo.announceForAccessibility(deletedToastAnnouncement(entries));
    } finally {
      deletionPreparationInFlight.current = false;
    }
  }

  function undoDeletion() {
    if (!pendingDeletion || pendingDeletion.phase !== "active") return;
    if (getDeletionCoordinator().undo(pendingDeletion.token)) {
      playHaptic("undoRestore");
      setRowLanding(nextLandingRequest(pendingDeletion.entries.map((entry) => entry.id)));
      AccessibilityInfo.announceForAccessibility(
        pendingDeletion.entries.length > 1 ? "Blocks restored." : "Block restored."
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
    playHaptic("delete");
    todayNotice.clear();
    const active = getDeletionCoordinator().current();
    if (active) AccessibilityInfo.announceForAccessibility(deletedToastAnnouncement(active.entries));
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

  // First sign-in setup (Blocks 8-1c): offered once per account on this phone, right after signing
  // in, and only when nothing is set up yet. Never on launch, refresh or an update.
  async function offerOnboardingAfterSignIn() {
    const signedIn = latestData.current;
    if (!signedIn?.user?.id || !signedIn.workspace?.id) return;
    const owner = { userId: signedIn.user.id, workspaceId: signedIn.workspace.id };
    try {
      const [{ claimOnboardingOffer }, { isHealthKitAutomaticSyncEnabled }, { getLocationVisitDiagnostics }] = await Promise.all([
        import("@/lib/onboardingGate"),
        import("@/lib/health"),
        import("@/lib/geofence")
      ]);
      const offer = await claimOnboardingOffer(owner, async () => ({
        savedPlaces: signedIn.places.length,
        healthConnected: await isHealthKitAutomaticSyncEnabled().catch(() => false),
        locationSuggestionsOn: (await getLocationVisitDiagnostics()).locationLearningEnabled === true
      }));
      const { mobileAccountOwnersEqual, readActiveMobileAccount } = await import("@/lib/mobileAccount");
      if (offer && mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) router.push("/onboarding");
    } catch {
      // Setup stays one tap away in Settings.
    }
  }

  async function submitAuth() {
    if (authSubmittingRef.current) return;
    authSubmittingRef.current = true;
    setAuthError(null);
    setAuthNotice(null);
    setAuthSubmitting(true);
    try {
      if (authView === "reset") {
        // Forgot password (UIA-317): the same reply for any address; the reset page is on the web.
        setAuthNotice(await requestPasswordReset(authEmail.trim()));
        return;
      }
      const auth = authView === "signup"
        ? await signup(authEmail, authPassword, authName.trim() || undefined)
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
      void offerOnboardingAfterSignIn();
    } catch (error) {
      // A native offline exception is never shown on the sign-in screen (staging feedback B2 sweep).
      setAuthError(friendlyMobileErrorMessage(error, "Dayframe couldn't sign you in. Check your connection and try again."));
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
          {/* The sign-in card's own look while the account loads (UIA-320). */}
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            style={styles.authCard}
          >
            <Text accessibilityRole="header" style={styles.authTitle}>Opening Dayframe…</Text>
            <Text style={styles.authBody}>Getting your blocks, places and Apple Health ready.</Text>
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
          {/* One motion owner (Reanimated layout animations): the card resizes, the Name and Password
              groups and the notice/error lines fade in and out, and everything below them moves with
              the card. Reduce Motion: fades only, no movement. */}
          <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.authCard}>
            <Text accessibilityRole="header" style={styles.authTitle}>
              {authView === "signup" ? "Create account" : authView === "reset" ? "Reset password" : "Log in"}
            </Text>
            <Text style={styles.authBody}>
              {authView === "signup"
                ? "Create your Dayframe account."
                : authView === "reset"
                  ? "We'll email you a link to choose a new password."
                  : "Sign in to sync your blocks, places and Apple Health."}
            </Text>
            {authView === "signup" ? (
              <Reanimated.View
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
                style={styles.authGroup}
              >
                <Text style={styles.authLabel}>Name</Text>
                <TextInput
                  ref={authNameRef}
                  accessibilityLabel="Name"
                  style={[styles.textInput, styles.authInput]}
                  value={authName}
                  onChangeText={setAuthName}
                  onSubmitEditing={() => authEmailRef.current?.focus()}
                  placeholder="Your name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  submitBehavior="submit"
                />
              </Reanimated.View>
            ) : null}
            <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.authGroup}>
            <Text style={styles.authLabel}>Email</Text>
            <TextInput
              ref={authEmailRef}
              accessibilityLabel="Email"
              style={[styles.textInput, styles.authInput]}
              value={authEmail}
              onChangeText={setAuthEmail}
              onSubmitEditing={() => (authView === "reset" ? submitAuth() : authPasswordRef.current?.focus())}
              placeholder="you@example.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              // Password AutoFill and Keychain suggestions are on (UIA-321, owner): re-check the
              // keyboard on a physical iPhone for the #160 frame change.
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              spellCheck={false}
              textContentType="username"
              returnKeyType={authView === "reset" ? "send" : "next"}
              submitBehavior={authView === "reset" ? "blurAndSubmit" : "submit"}
            />
            </Reanimated.View>
            {authView === "reset" ? null : (
            <Reanimated.View
              entering={localPresenceEntering(reduceMotion)}
              exiting={localPresenceExiting(reduceMotion)}
              layout={localLayoutTransition(reduceMotion)}
              style={styles.authGroup}
            >
            <Text style={styles.authLabel}>Password</Text>
            <View style={styles.authPasswordField}>
              <View style={styles.authPasswordInputFrame}>
                <TextInput
                  ref={authPasswordRef}
                  accessibilityHint={authView === "signup" ? "At least 8 characters" : undefined}
                  accessibilityLabel="Password"
                  style={[
                    styles.textInput,
                    styles.authInput,
                    styles.authPasswordInput,
                    authPasswordVisible ? styles.authPasswordInputRevealed : null
                  ]}
                  value={authPassword}
                  onChangeText={setAuthPassword}
                  onSubmitEditing={submitAuth}
                  placeholder={authView === "signup" ? "At least 8 characters" : "Password"}
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoComplete={authView === "signup" ? "new-password" : "current-password"}
                  autoCorrect={false}
                  caretHidden={authPasswordVisible}
                  returnKeyType="done"
                  secureTextEntry
                  spellCheck={false}
                  submitBehavior="blurAndSubmit"
                  textContentType={authView === "signup" ? "newPassword" : "password"}
                />
                {authPasswordVisible && authPassword ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    style={styles.authPasswordRevealOverlay}
                  >
                    <Text numberOfLines={1} style={[styles.authPasswordRevealText, styles.authInput]}>
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
            {authView === "signup" ? <Text style={styles.authHint}>At least 8 characters.</Text> : null}
            {authView === "login" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: authSubmitting }}
                disabled={authSubmitting}
                onPress={() => {
                  setAuthError(null);
                  setAuthNotice(null);
                  setAuthPasswordVisible(false);
                  setAuthView("reset");
                }}
                style={pressable(styles.authTextLink, styles.buttonPressed)}
              >
                <Text style={styles.authTextLinkText}>Forgot password?</Text>
              </Pressable>
            ) : null}
            </Reanimated.View>
            )}
            {authNotice ? (
              <Reanimated.Text
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
                style={styles.statusText}
              >
                {authNotice}
              </Reanimated.Text>
            ) : null}
            {authError ? (
              <Reanimated.Text
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
                style={styles.errorText}
              >
                {authError}
              </Reanimated.Text>
            ) : null}
            <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.authGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: authSubmitting, disabled: authSubmitting }}
              disabled={authSubmitting}
              style={pressable(
                [styles.primaryButton, styles.authPrimaryButton, authSubmitting ? styles.buttonDisabled : null],
                styles.buttonPressed
              )}
              onPress={submitAuth}
            >
              <Text style={[styles.primaryButtonText, styles.authPrimaryButtonText]}>
                {authSubmitting
                  ? authView === "signup" ? "Creating account…" : authView === "reset" ? "Sending…" : "Logging in…"
                  : authView === "signup" ? "Create account" : authView === "reset" ? "Send reset link" : "Log in"}
              </Text>
            </Pressable>
            <View style={styles.authSwitchRow}>
              <Text style={styles.authSwitchText}>
                {authView === "login" ? "New to Dayframe?" : authView === "reset" ? "Remembered it?" : "Already have an account?"}
              </Text>
              <Pressable
                accessibilityLabel={authView === "login" ? "Create an account" : "Log in with an existing account"}
                accessibilityRole="button"
                // A request in flight belongs to the view that sent it: the view cannot change under it.
                accessibilityState={{ disabled: authSubmitting }}
                disabled={authSubmitting}
                style={pressable(styles.authSwitchLink, styles.buttonPressed)}
                onPress={() => {
                  setAuthError(null);
                  setAuthNotice(null);
                  setAuthPasswordVisible(false);
                  setAuthView(authView === "login" ? "signup" : "login");
                }}
              >
                <Text style={styles.authSwitchLinkText}>{authView === "login" ? "Create one" : "Log in"}</Text>
              </Pressable>
            </View>
            </Reanimated.View>
          </Reanimated.View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  function renderTodayTab(isFocused: boolean) {
    todayTabFocused.current = isFocused;
    const currentDate = new Date(now);
    return (
      <TodayReviewPresentationProvider
        bootstrap={data}
        dashboardEntries={historySourceEntries}
        manualProjectedEntries={loggedSourceEntries}
        isFocused={isFocused}
        nowMs={minuteFloorNow}
        refreshGeneration={todayPresentationRefreshGeneration}
      >
      <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
        {/* Behind the list: the blocks show in the gap a pull opens above Today. */}
        <TodayPullBlocks
          refreshing={isFocused && refreshing}
          reduceMotion={reduceMotion}
          scrollY={todayScrollY}
          theme={theme}
        />
        <Reanimated.FlatList
          contentContainerStyle={[styles.container, styles.todayListContent]}
          onScroll={todayScrollHandler}
          scrollEventThrottle={16}
          data={todaySections}
          itemLayoutAnimation={localLayoutTransition(reduceMotion)}
          keyExtractor={(section) => section.key}
          refreshControl={
            <RefreshControl
              refreshing={isFocused && refreshing}
              onRefresh={refreshTodayPresentation}
              // The native control owns the pull and the held gap; the blocks above replace its spinner.
              tintColor="transparent"
              colors={["transparent"]}
            />
          }
          ListHeaderComponent={(
            <Animated.View style={[styles.contentStack, enteringStyle, styles.todayListHeader]}>
              <View style={styles.header}>
                <DashboardBrandLockup isFocused={isFocused} styles={styles} theme={theme} />
                <AccountAvatarButton
                  attentionCount={syncAttentionCount}
                  email={data?.user.email}
                  name={data?.user.name}
                  onPress={openAccountFromToday}
                  theme={theme}
                />
              </View>

              <TodayGoalFrame dateLabel={formatEyebrowDay(currentDate)} theme={theme} {...todayGoalFrame} />

              <TodayTimerSurface
                // While the Stop flight's ghost holds the block's place, the block is hidden; once Stop
                // commits the idle card comes in at once instead of waiting for the retained exit, and
                // the stopped block never comes back after the ghost has gone (useStopFlightExit).
                active={stopFlightExit.showIdle ? null : todayLivePresentation}
                clockFormat={clockFormat}
                liveHidden={stopFlightExit.liveHidden}
                openTrip={freshOpenTrip(data?.openTrip, minuteNow)}
                motionPaused={!isFocused}
                activeTimerActionsStyle={activeTimerActionsStyle}
                activeTimerDetailsStyle={activeTimerDetailsStyle}
                liveLanding={liveLanding}
                onAddTime={openManualEntry}
                onOpenActiveTimer={() => presentActiveEditor("existing_active_timer")}
                onStartActivity={(activityId) => startFromToday(activityId)}
                onStartBlank={() => startFromToday(null)}
                onStop={stopFromToday}
                onSwitch={() => setSwitchSheetRecents(switchRecents(loggedSourceEntries, data?.activeEntry ?? null))}
                quickStartColumns={quickStartColumns}
                reduceMotion={reduceMotion}
                runningActivityId={displayedActiveEntry?.categoryId ?? null}
                theme={theme}
              />
              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
                <TodayRibbonSection
                  entries={todayRibbonEntries}
                  nowMs={minuteNow}
                  onOpenEntry={openTodayEntry}
                  onOpenWhereWent={openReportsToday}
                  reduceMotion={reduceMotion}
                  theme={theme}
                  whereWent={todayWhereWent}
                  whereWentQuiet={todayWhereWentQuiet}
                />
              </Reanimated.View>
              {/* Moves with the timer card and mosaic above it (Reanimated owns Today motion). */}
              <Reanimated.View layout={localLayoutTransition(reduceMotion)}>
                {/* Location v4 step 14: the Review card is now one quiet chip, opening Calendar › List at the first "?". */}
                <TodayChecksChip count={checkCounts.today} onOpen={openTodayChecks} reduceMotion={reduceMotion} theme={theme} />
              </Reanimated.View>
            </Animated.View>
          )}
          renderItem={({ item }) => (
            <TodayBlockRows
              activeTimerRunning={Boolean(displayedActiveEntry)}
              activityIconFor={(categoryId) => (categoryId ? categoryIconById.get(categoryId) ?? null : null)}
              groups={groupHistoryDayEntries(item.entries)}
              nowMs={minuteNow}
              onDeleteEntries={scheduleHistoryDeletion}
              onOpenEntry={openTodayEntry}
              onReplayEntry={(entry) => {
                startFromToday(
                  entry.categoryId,
                  entry.description ?? "",
                  entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? []
                );
              }}
              reduceMotion={reduceMotion}
              rowLanding={rowLanding}
              rowPop={rowPop}
              theme={theme}
            />
          )}
          ListFooterComponent={(
            // The footer is not a FlatList cell, so it owns its own layout transition and moves
            // with the rows above it rather than popping (motion.md).
            <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.todayListFooter}>
              <EarlierThisWeek days={earlierDays} onOpenDay={openCalendarDay} reviewCounts={earlierDayReviewCountMap} theme={theme} />
            </Reanimated.View>
          )}
          ItemSeparatorComponent={() => <View style={styles.historyDayGap} />}
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
      </TodayReviewPresentationProvider>
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
            // UIA-063: that suggestion on top of the deck, as a ribbon tap opens it; a crowd of
            // only older needs-review entries ("") opens the Review list.
            onOpenReview: (reviewItemId) => {
              // Step 15: a "?" on the Grid never opens Review. Owner item A (28 Oct 2026): a Grid "?" or Places lane
              // item opens its own sheet (its "?" asked at the top); Apple Health's, which has no sheet, opens its
              // question in the List.
              const segmentId = reviewItemId?.startsWith("lane:") ? reviewItemId.slice(5)
                : calendarChecks.checks.find((check) => check.id === reviewItemId)?.segmentId ?? null;
              const item = segmentId ? calendarTimeline?.items.find((each) => each.id === segmentId) : undefined;
              if (item?.kind === "place") {
                locationCorrections.openPlace(item, item.name ?? (item.matchKind === "ambiguous" ? "Unclear place" : "Unknown place"));
                return;
              }
              if (item?.kind === "trip") {
                locationCorrections.openTripLeg(item, null);
                return;
              }
              if (!reviewItemId || reviewItemId.startsWith("lane:") || !openCheckOn(reviewItemId)) changeCalendarLayout("list");
            }
          }
        );
      };

      return (
        <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
          <View style={styles.nativeCalendarScreen}>
            <ScreenFocusReporter focused={isFocused} onChange={setCalendarOnScreen} />
            <Animated.View style={[styles.nativeCalendarHeader, enteringStyle]}>
              <DashboardBrandLockup isFocused={isFocused} styles={styles} theme={theme} />
              <AccountAvatarButton
                attentionCount={syncAttentionCount}
                email={data?.user.email}
                name={data?.user.name}
                onPress={openAccountFromCalendar}
                theme={theme}
              />
            </Animated.View>
            <DayframeCalendarView
              model={isFocused && refreshing ? gridModelRefreshing : gridModel}
              onChangeLayout={(event) => changeCalendarLayout(event.nativeEvent.layout === "list" ? "list" : "grid")}
              onHeaderHeight={(event) => setCalendarHeaderHeight(Math.ceil(event.nativeEvent.height))}
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
              // In List the native view is only its header and week strip, at the height it reports.
              style={calendarLayout === "list" && calendarHeaderHeight
                ? [styles.nativeCalendarView, { flex: 0, height: calendarHeaderHeight }]
                : styles.nativeCalendarView}
            />
            {calendarLayout === "list" ? (
              // The one owner of the Grid ↔ List handoff (Codex r1 on #570): the List fades in over the
              // header's new height and out over the Grid, which the native view switches at once beneath it.
              <Reanimated.View
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                style={{ flex: 1 }}
              >
                <CalendarListView
                  checkGlyphs={calendarChecks.glyphs}
                  checkKinds={calendarChecks.kinds}
                  checkQuestions={calendarChecks.questions}
                  checks={askingChecks}
                  checkTitles={calendarChecks.titles}
                  checkTotal={askingChecks.length}
                  onNextCheck={openNextCheck}
                  onSwipeDay={shiftSelectedCalendarDay}
                  openCheckRequest={calendarCheckTarget}
                  timelineReadAt={calendarTimelineRequestedAt}
                  onRequestFreshRead={() => setCheckTimelineReads((count) => count + 1)}
                  clockFormat={clockFormat}
                  dayEndMs={nativeCalendarModel.dayEndMs}
                  dayStartMs={nativeCalendarModel.dayStartMs}
                  entries={nativeCalendarModel.entries}
                  loggedLabel={nativeCalendarModel.loggedLabel}
                  nowMs={minuteNow}
                  // A "?" is answered in place (step 14, part 3b); "More…" opens it on its own screen to pick a place.
                  // Without a backend identity the outbox's record is not read here, so an answer could never
                  // hand over: there a "?" opens the suggestion instead (Codex r9 on #582).
                  onAnswerCheck={scopedOwnerKey
                    // Yes to "Visited {Apple place}?" records it there once (card B part 2). The row's Yes and its question go
                  // through checkAnswers.answer, the one gated entry point (Codex r7 on #610).
                    ? (id, logged) => checkAnswers.answer(id, logged, id === openCalendarCheckId ? openCheckVenue.venue : null)
                    : undefined}
                  onOpenCheckChange={setOpenCalendarCheckId}
                  // Only a question's own "More…" / "Open it" (under its row) opens a suggestion on its own screen: a
                  // place's evidence on its details screen, anything else on the deck, focused on it (Codex r10 on #582).
                  // A place's or trip's "?" opens its sheet in the List itself (onOpenPlace, onOpenTripLeg), or asks under
                  // its row when the day lacks its item: never this fallback (step 15; Codex r2 on #610). The editor's
                  // Nearby search takes the native search over from the question first (Codex r1 on #600).
                  onOpenCheck={(reviewItemId) => {
                    openCheckVenue.release();
                    const reviewItem = shownCalendarData?.reviewItems.find((item) => item.id === reviewItemId);
                    router.push(calendarCheckRoute(reviewItem, reviewItemId) as never);
                  }}
                  onOpenEntry={(entry) => routeOpenEvent(entry.isActive ? "active" : "completed", entry.entryId)}
                  onOpenPlace={locationCorrections.openPlace}
                  onOpenTripLeg={locationCorrections.openTripLeg}
                  onScrolledToFirstCheck={() => setCalendarCheckScroll(0)}
                  scrollToFirstCheck={calendarCheckScroll}
                  onRefresh={() => routeNativeCalendarRefresh(() => { void load({ visibleRefresh: true }); })}
                  reduceMotion={reduceMotion}
                  refreshing={isFocused && refreshing}
                  theme={theme}
                  timeline={calendarTimeline}
                />
                {locationCorrections.sheet}
              </Reanimated.View>
            ) : null}
            {/* Owner item A (28 Oct 2026): the Grid's items open the same sheets, over the Grid. */}
            {calendarLayout !== "list" ? locationCorrections.sheet : null}
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView collapsable={false} edges={["top", "left", "right"]} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={[styles.container, styles.reportsScrollContent]}
          directionalLockEnabled
          // Scrubbing the Reports donut owns the finger; iOS cancels the page pan when this turns off.
          scrollEnabled={!reportsScrubbing}
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
            <AccountAvatarButton
              attentionCount={syncAttentionCount}
              email={data?.user.email}
              name={data?.user.name}
              onPress={openAccountFromReports}
              theme={theme}
            />
          </View>

          {data ? (
            <ReportsTab
              key={`${DAYFRAME_BACKEND_ID ?? data.serverBuild?.backendId ?? "unknown-backend"}:${data.workspace.id}:${data.user.id}`}
              data={data}
              isFocused={isFocused}
              // The exact time while Reports is on screen (it floors to the minute itself unless a block
              // or its just-stopped contribution is live); minute time behind it, so the memoised tab
              // skips the Dashboard's other ticks.
              nowMs={isFocused ? now : minuteFloorNow}
              onScrubbingChange={setReportsScrubbing}
              timeZoneId={timeZoneId}
              // Today's "Where today went" asks for Today once (D15); Reports acknowledges it.
              onRangeRequestApplied={acknowledgeReportsRangeRequest}
              rangeRequest={reportsRangeRequest}
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
    <DashboardContext.Provider value={{ renderTab: renderDashboardTab, checkCount: checkCounts.week, openOldestCheck }}>
      {children}
      {/* Today's toast place, one column anchored above the tab bar (Codex r2 on #582): an answer in Calendar ›
          List sits above a delete's or a notice, each as tall as it measures (a trip opt-out row, wrapped
          text), so neither covers the other. Always mounted, so a toast leaving plays its exit; the one left
          moves to its new place with its own layout transition (at once under Reduce Motion). */}
      <View pointerEvents="box-none" style={[styles.todayToast, styles.todayToastStack]} testID="today-toast-stack">
        {checkAnswers.held ? (
          // An answer in Calendar › List, held for Undo (step 14 part 3b): the hold owns the 4.8 s window and
          // its token re-mounts the toast, so a second answer replaces it (the first is saved).
          <BlocksToast
            key={`check-${checkAnswers.held.token}`}
            actionAccessibilityLabel={`Undo ${checkAnswers.held.logged ? "logging" : "skipping"} ${checkAnswers.held.title}`}
            actionLabel="Undo"
            actionTestID="calendar-check-undo"
            message={`${checkAnswers.held.logged ? "Logged" : "Skipped"} ${checkAnswers.held.title}`}
            onAction={() => {
              checkAnswers.undo();
              playHaptic("undoRestore");
            }}
            reduceMotion={reduceMotion}
            testID="calendar-check-toast"
            theme={theme}
          />
        ) : null}
        {locationCorrections.heldLog ? (
          // Logs as from a place's correction sheet (step 12 part 4c), held for Undo as an answer is.
          <BlocksToast
            key={`log-place-${locationCorrections.heldLog.token}`}
            actionAccessibilityLabel={`Undo logging ${locationCorrections.heldLog.title}`}
            actionLabel="Undo"
            actionTestID="location-log-undo"
            message={`Logged ${locationCorrections.heldLog.title}`}
            onAction={() => {
              locationCorrections.undoLog();
              playHaptic("undoRestore");
            }}
            reduceMotion={reduceMotion}
            testID="location-log-toast"
            theme={theme}
          />
        ) : null}
        {pendingDeletion?.phase === "active" ? (
          // The shared Blocks toast (UIA-003): "Deleted Deep work" with its swatch and a neutral
          // 44-point Undo. The deletion coordinator owns the 5 s window; the token re-mounts it.
          <BlocksToast
            key={`deleted-${pendingDeletion.token}`}
            actionAccessibilityLabel={undoDeleteAccessibilityLabel(pendingDeletion.entries)}
            actionLabel="Undo"
            actionTestID="today-delete-undo"
            message={deletedToastMessage(pendingDeletion.entries)}
            onAction={undoDeletion}
            reduceMotion={reduceMotion}
            secondary={tripOptOut ? { ...tripOptOut, testID: "today-delete-trip-opt-out" } : null}
            swatchColor={pendingDeletion.entries.length === 1 ? toastSwatchColor(pendingDeletion.entries[0], theme.mode) : null}
            testID="today-delete-toast"
            theme={theme}
          />
        ) : todayNotice.notice && authState === "authenticated" ? (
          <BlocksToast
            key={`notice-${todayNotice.notice.token}`}
            accessibilityLabel={todayNotice.notice.accessibilityLabel}
            detail={todayNotice.notice.detail}
            message={todayNotice.notice.message}
            reduceMotion={reduceMotion}
            swatchColor={todayNotice.notice.swatchColor}
            testID="today-notice-toast"
            theme={theme}
          />
        ) : null}
      </View>
      <PlayOrb
        activities={bloomActivityList}
        hidden={!playOrbAvailable || (reportsSheetPortal?.isPresented ?? false)}
        onChoose={onPlayOrbChooseStable}
        onTap={onPlayOrbTapStable}
        reduceMotion={reduceMotion}
        running={hasLiveActiveTimer}
        runningActivityId={hasLiveActiveTimer ? displayedActiveEntry?.categoryId ?? null : null}
        runningTitle={hasLiveActiveTimer ? bloomRunningTitle : undefined}
        runningDurationSeconds={hasLiveActiveTimer ? todayLivePresentation?.durationSeconds : undefined}
        runningElapsedSeconds={hasLiveActiveTimer ? todayLivePresentation?.elapsedSeconds : undefined}
        runningHeldSeconds={orbHeldSeconds}
        runningStartedAt={hasLiveActiveTimer ? todayLivePresentation?.startedAt : undefined}
        theme={theme}
      />
      <StopFlightOverlay flight={stopFlight} onFinished={finishStopFlight} theme={theme} />
      {switchSheetRecents && reduceMotionPreferenceResolved ? (
        <TodaySwitchSheet
          activityIconFor={(categoryId) => (categoryId ? categoryIconById.get(categoryId) ?? null : null)}
          nowMs={minuteNow}
          onClose={() => setSwitchSheetRecents(null)}
          onPick={switchToRecent}
          recents={switchSheetRecents}
          running={Boolean(data?.activeEntry)}
          reduceMotion={reduceMotion}
          styles={styles}
          theme={theme}
        />
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
        onCreateActivity={createSheetActivity}
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
        previousEnd={previousEndForSheet}
        onCancel={completeActiveEditorExit}
        onCreateActivity={createSheetActivity}
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
        dismissRequestId={calendarEditDismissRequestId}
        onCancel={completeCalendarEntryExit}
        onCreateActivity={createSheetActivity}
        onCreateTag={createTimerSheetTag}
        onDelete={deleteCalendarEntry}
        onSave={saveCalendarEntryEdit}
        onStartAgain={(values) => {
          // Start once this sheet has finished leaving: a second sheet presented while one is
          // still on screen is refused by iOS (see completeCalendarEntryExit).
          pendingStartAgain.current = values;
        }}
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
    await refreshGeofencesForPlaces(bootstrap.places, { userId: bootstrap.user.id, workspaceId: bootstrap.workspace.id });
  } catch (error) {
    await recordLocationStoreError(error);
  }
}

/** Tells the provider whether a tab is the screen in front, and that it is not once the tab unmounts. */
function ScreenFocusReporter({ focused, onChange }: { focused: boolean; onChange: (focused: boolean) => void }) {
  useEffect(() => {
    onChange(focused);
  }, [focused, onChange]);
  useEffect(() => () => onChange(false), [onChange]);
  return null;
}

/** The Calendar tab's badge: things to check today and the 7 days before (location v4 step 14). */
export function useDashboardCheckCount() {
  return useContext(DashboardContext)?.checkCount ?? 0;
}

/** Owner, 28 Oct 2026 (concern 4): the Calendar tab's badge opens the oldest question that still asks (concern 4). */
export function useDashboardOpenOldestCheck() {
  return useContext(DashboardContext)?.openOldestCheck;
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



/** Today's eyebrow (Blocks prototype): weekday, day and month, without the year. */
function formatEyebrowDay(date: Date) {
  return formatLocaleDate(date, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function formatTimeOfDay(date: Date, clockFormat: ClockFormat) {
  if (Number.isNaN(date.getTime())) return "--:--";
  return formatClockTime(date, clockFormat);
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

/** What a "?" is about (Codex r2 on #610): only "health" and "none" have no sheet in Calendar › List. */
function calendarCheckKind(item: MobileReviewItem): "health" | "place" | "trip" | "none" {
  if (item.eventType?.startsWith("health_") || item.eventSource?.startsWith("health_")) return "health";
  const segmentId = typeof item.rawPayload?.clientSegmentId === "string" ? item.rawPayload.clientSegmentId : null;
  if (isLocationReviewItem(item) && segmentId) return item.eventType === "commute_detected" ? "trip" : "place";
  return "none";
}
