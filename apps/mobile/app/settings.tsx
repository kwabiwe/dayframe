import { readOwnedAuthenticatedSessionSnapshot, isAuthenticatedSessionSnapshotCurrent } from "@/lib/secure-session";
import { mobileBuildDiagnostics } from "@/lib/mobileBuildDiagnostics";
import { supportQueueDiagnostics } from "@/lib/supportSyncDiagnostics";
import { readActiveMobileAccount, mobileAccountOwnersEqual, type MobileAccountOwner } from "@/lib/mobileAccount";
import {
  REVIEW_NUDGE_MINUTES,
  formatReviewNudgeTime,
  readReviewNudgeState,
  setReviewNudgeEnabled,
  setReviewNudgeMinutes,
  type ReviewNudgeState
} from "@/lib/reviewNudge";
import type { ReviewNudgePermission } from "@/lib/reviewNudgeNative";
import { synchroniseDeviceNow, getLastManualSyncResult } from "@/lib/manualSyncRuntime";
import { createOwnerSyncCoalescer } from "@/lib/ownerSyncCoalescer";
import { subscribeRecoveredDashboardBootstrap } from "@/lib/dashboardBootstrapChannel";
import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import Reanimated from "react-native-reanimated";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle
} from "@/components/SwipeDismissSheet";
import {
  localLayoutTransition,
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference
} from "@/lib/motion";
import { ActivityPickerSheet } from "@/components/ActivityPickerSheet";
import { ActivityEditorSheet, type ActivityEditorDraft } from "@/components/settings/ActivityEditorSheet";
import { ActivityIcon, DayframeIcon } from "@/components/icons/DayframeIcon";
import {
  ACTIVITY_CHANGE_BUSY_MESSAGE,
  QUICK_START_PIN_LIMIT,
  activitiesPageGroups,
  createActivityChangeGate,
  createArchivedReadGate,
  activityWeekSeconds as activityWeekSecondsFor,
  formatActivityWeek,
  pinLimitReached
} from "@/lib/activitiesPage";
import { healthSyncNote, mergeHealthStatuses } from "@/lib/healthSyncNote";
import { setHapticsEnabled, useHapticsPreference } from "@/lib/haptics";
import {
  DAYFRAME_PALETTE,
  DAYFRAME_APP_ICONS,
  blockColorsFor,
  paletteColorFor,
  type DayframePaletteKey,
  type HealthAutoLogMapping,
  type HealthAutoLogMappings,
  type HealthImportPreferenceKey,
  type HealthImportPreferences
} from "@dayframe/shared";
import {
  AuthRequiredError,
  archiveCategory,
  listArchivedCategories,
  restoreCategory,
  clearFailedQueuedEvents,
  createCategory,
  deleteRecentLocationEvidence,
  ensureAutomaticLoggingCategories,
  fetchBootstrap,
  getQueueDiagnostics,
  logout,
  readQueue,
  retryFailedQueuedEvents,
  subscribeActivityQueue,
  updateCategory,
  updateTimeGoals,
  type MobileBootstrap,
  type QueueDiagnostics,
  type QueuedEvent,
  type SyncQueueResult
} from "@/lib/api";
import {
  getLocationVisitDiagnostics,
  requestLocationAccess,
  refreshGeofencesForPlaces,
  setLocationLearningEnabled,
  startGeofences,
  type LocationVisitDiagnostics
} from "@/lib/geofence";
import {
  friendlyHealthKitError,
  exportHealthDebugSnapshot,
  getHealthImportPreferences,
  getHealthImportStatus,
  HEALTH_IMPORT_PREFERENCE_OPTIONS,
  isHealthKitAutomaticSyncEnabled,
  reprocessExistingHealthReviewItems,
  requestHealthKitPermissions,
  setHealthImportPreference,
  type HealthImportStatus
} from "@/lib/health";
import {
  pressable,
  useMobileTheme,
  type MobileStyles,
  type MobileTheme
} from "@/lib/mobileTheme";
import { isRetryableMobileConnectivityFailure } from "@/lib/mobile-network";
import { publishMobileSignedOut, subscribeMobileSignedOut } from "@/lib/mobileSessionTransition";
import { REVIEW_COPY, isOpenReviewItem, isReviewNeededEntry } from "@/lib/review";
import {
  SETTINGS_HEALTH_SNAPSHOT_TTL_MS,
  SETTINGS_SNAPSHOT_TTL_MS,
  shouldRefreshSettingsSnapshot,
  shouldShowSettingsRefreshSpinner
} from "@/lib/settingsRefresh";
import { clampSettingsScrollOffset, settingsScrollNeedsClamp } from "@/lib/settingsScroll";
import { BlocksNavHeader, usePreviousScreenLabel } from "@/components/BlocksNavHeader";
import { BlocksConfirmHost, useBlocksConfirm, type BlocksConfirmRequest } from "@/components/blocks/BlocksConfirmSheet";
import { bindConfirmToSession, captureConfirmAuthority, captureLogoutRecovery, confirmAuthorityStillCurrent, logoutRecoveryStillCurrent, type ConfirmAuthority } from "@/lib/confirmAuthority";
import { BlocksToast, useBlocksNotice } from "@/components/blocks/BlocksToast";
import { BlocksInfoSheet, type BlocksInfoRow } from "@/components/blocks/BlocksInfoSheet";
import { blocksNavOrigin, settingsBackLabel, settingsSectionTitle } from "@/lib/blocksNav";
import { mobileTextProps } from "@/lib/mobileTypography";
import { createGoalSaver, publishSavedTimeGoals, type TimeGoals } from "@/lib/settingsGoals";
import { beginSavedActivityChange, publishSavedActivity } from "@/lib/settingsActivities";
import Constants from "expo-constants";
import {
  SettingsAccountCard,
  SettingsActivityStrip,
  SettingsBlockGroup,
  SettingsBlockRow,
  SettingsIssueRow,
  SettingsPillButton,
  SettingsSegmented,
  SettingsStatusDot,
  SettingsStepper,
  SettingsSwitch
} from "@/components/settings/SettingsBlocks";
import { drainNativeShortcutQueue, syncShortcutCatalog } from "@/lib/shortcuts";
import {
  configureLocationIntelligence,
  getNativeLocationIntelligenceStatus
} from "@/lib/location/runtime";
import {
  getLocationStoreDiagnostics,
  recordLocationStoreError
} from "@/lib/location/store";
import { getLocationReviewEvidencePrefetchDiagnostics } from "@/lib/locationReviewEvidenceCache";
import { motionFitnessPresentation, readMotionFitnessStatus, requestMotionFitness } from "@/lib/location/motionPermission";
import type { DayframeMotionAuthorizationStatus } from "../modules/dayframe-motion-activity";
import {
  discardReviewSyncIssue,
  getReviewSyncDiagnostics,
  listReviewSyncDiagnosticMutations,
  listReviewSyncIssues,
  subscribeReviewSync,
  synchroniseReviewMutations,
  type ReviewSyncDiagnostics
} from "@/lib/reviewSyncStore";
import {
  clearDeviceTimeEntryOutboxQuarantine,
  clearTimeEntryOutboxQuarantine,
  discardTimeEntrySyncIssue,
  getTimeEntryOutboxDiagnostics,
  listTimeEntrySyncIssues,
  retryTimeEntrySyncIssue,
  subscribeTimeEntryOutbox
} from "@/lib/timeEntryOutbox";
import {
  discardTimerStopSyncIssue,
  getTimerStopOutboxDiagnostics,
  listTimerStopSyncIssues,
  retryTimerStopSyncIssue,
  subscribeTimerStopOutbox
} from "@/lib/timerStopOutbox";
import { syncHelpStatus } from "@/lib/settingsSyncDiagnostics";
import { DAYFRAME_API_BASE } from "@/lib/config";
import { healthMappingWriter } from "@/lib/healthMappingOwner";

type Category = MobileBootstrap["categories"][number];
// Settings › Your day goal ranges (hours): daily in 1 h steps, weekly in 5 h steps.
const DAILY_GOAL_HOURS = { min: 1, max: 14, step: 1 } as const;
const WEEKLY_GOAL_HOURS = { min: 5, max: 80, step: 5 } as const;
const GOAL_SAVE_DELAY_MS = 600;
const ACCOUNT_CHANGED_NOTICE = "Your account changed, so nothing was changed.";
const SIGN_IN_UNREADABLE_NOTICE = "Unlock your iPhone and try again.";
// D1: the same theme names on iPhone and web.
const SETTINGS_THEME_OPTIONS = [
  { label: "Midnight", value: "dark" },
  { label: "Daylight", value: "light" },
  { label: "System", value: "system" }
] as const;

type SettingsSection = "index" | "profile" | "categories" | "automations" | "health" | "sync";

function healthAutomaticCategoryKinds(preferences: HealthImportPreferences) {
  const kinds: Array<"sleep" | "health"> = [];
  if (preferences.sleep) kinds.push("sleep");
  if (Object.entries(preferences).some(([type, enabled]) => type !== "sleep" && enabled)) {
    kinds.push("health");
  }
  return kinds;
}

type SettingsSnapshot = {
  data: MobileBootstrap | null;
  queue: QueuedEvent[];
  lastSyncResult: SyncQueueResult | null;
  locationStatus: string;
  locationDiagnostics: LocationVisitDiagnostics | null;
  healthStatus: HealthImportStatus[];
  healthImportPreferences: HealthImportPreferences | null;
  healthAutoLogMappings: HealthAutoLogMappings;
  updatedAt: number;
  healthUpdatedAt: number;
};

let cachedSettingsSnapshot: SettingsSnapshot | null = null;

function defaultSettingsSnapshot(): SettingsSnapshot {
  return {
    data: null,
    queue: [],
    lastSyncResult: null,
    locationStatus: "Not requested",
    locationDiagnostics: null,
    healthStatus: [],
    healthImportPreferences: null,
    healthAutoLogMappings: {},
    updatedAt: 0,
    healthUpdatedAt: 0
  };
}

function readSettingsSnapshot() {
  return cachedSettingsSnapshot;
}

function updateSettingsSnapshot(patch: Partial<SettingsSnapshot>) {
  cachedSettingsSnapshot = {
    ...(cachedSettingsSnapshot ?? defaultSettingsSnapshot()),
    ...patch
  };
}

// Advances whenever an activity change gets its answer, applied or not (in any Settings visit).
// A refresh fetched before the latest answer is not published, and pin capacity counts as fresh
// only when no answer arrived since this visit's last published refresh.
let activityAnswerEpoch = 0;

function clearSettingsSnapshot() {
  cachedSettingsSnapshot = null;
}

// Any sign-out (Settings, Today's own 401 handling) drops the cached account, so the next account
// never sees, or edits, the previous one's settings.
subscribeMobileSignedOut(() => clearSettingsSnapshot());

function isSettingsSnapshotFresh(now = Date.now()) {
  return !shouldRefreshSettingsSnapshot(cachedSettingsSnapshot?.updatedAt, now, SETTINGS_SNAPSHOT_TTL_MS);
}

function isSettingsHealthSnapshotFresh(now = Date.now()) {
  return !shouldRefreshSettingsSnapshot(
    cachedSettingsSnapshot?.healthUpdatedAt,
    now,
    SETTINGS_HEALTH_SNAPSHOT_TTL_MS
  );
}

function resolveStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function" ? (action as (value: T) => T)(current) : action;
}

export default function SettingsScreen() {
  const reduceMotion = useReduceMotionPreference();
  const {
    reloadThemePreference,
    setThemePreference,
    styles,
    theme,
    themePreference
  } = useMobileTheme();
  const hapticsEnabled = useHapticsPreference();
  // UIA-005/003: destructive confirmations use the Blocks confirm sheet; notices are toasts.
  const confirmSheet = useBlocksConfirm();
  const settingsNotice = useBlocksNotice();
  // A notice raised while the activity editor's modal is up waits for the editor to leave, so its
  // 5 s start when it can be seen.
  const activityEditorOpen = useRef(false);
  const noticeAfterActivityEditor = useRef<{ message: string; swatchColor: string | null } | null>(null);
  function showAfterActivityEditor(message: string, swatchColor: string | null) {
    if (activityEditorOpen.current) noticeAfterActivityEditor.current = { message, swatchColor };
    else settingsNotice.show(message, swatchColor);
  }
  function activityEditorClosed() {
    activityEditorOpen.current = false;
    const pending = noticeAfterActivityEditor.current;
    noticeAfterActivityEditor.current = null;
    if (pending) settingsNotice.show(pending.message, pending.swatchColor);
  }
  const params = useLocalSearchParams<{ from?: string | string[]; section?: string | string[] }>();
  const routeSettingsSection = normalizeSettingsSection(params.section);
  const settingsSection = routeSettingsSection;
  const cachedSnapshot = readSettingsSnapshot();
  const [data, setData] = useState<MobileBootstrap | null>(cachedSnapshot?.data ?? null);
  const [queue, setQueue] = useState<QueuedEvent[]>(cachedSnapshot?.queue ?? []);
  const [lastSyncResult, setLastSyncResult] = useState<SyncQueueResult | null>(cachedSnapshot?.lastSyncResult ?? null);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [reviewSyncDiagnostics, setReviewSyncDiagnostics] =
    useState<ReviewSyncDiagnostics | null>(null);
  const [reviewSyncIssues, setReviewSyncIssues] = useState<
    Awaited<ReturnType<typeof listReviewSyncIssues>>
  >([]);
  const [timeEntrySyncDiagnostics, setTimeEntrySyncDiagnostics] = useState<
    Awaited<ReturnType<typeof getTimeEntryOutboxDiagnostics>> | null
  >(null);
  const [timeEntrySyncIssues, setTimeEntrySyncIssues] = useState<
    Awaited<ReturnType<typeof listTimeEntrySyncIssues>>
  >([]);
  const [timerStopSyncDiagnostics, setTimerStopSyncDiagnostics] = useState<
    Awaited<ReturnType<typeof getTimerStopOutboxDiagnostics>> | null
  >(null);
  const [timerStopSyncIssues, setTimerStopSyncIssues] = useState<
    Awaited<ReturnType<typeof listTimerStopSyncIssues>>
  >([]);
  const [locationInfoSheet, setLocationInfoSheet] = useState<"suggestions" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [locationStatus, setLocationStatus] = useState(cachedSnapshot?.locationStatus ?? "Not requested");
  const [locationDiagnostics, setLocationDiagnostics] = useState<LocationVisitDiagnostics | null>(
    cachedSnapshot?.locationDiagnostics ?? null
  );
  const [motionFitnessStatus, setMotionFitnessStatus] = useState<DayframeMotionAuthorizationStatus | null>(null);
  const [nativeLocationStatus, setNativeLocationStatus] = useState<{
    authorizationStatus: string;
    accuracyAuthorization: string;
    locationServicesEnabled: boolean;
    backgroundRefreshStatus: string;
    pendingSignalCount: number;
    monitoringVisits: boolean;
    monitoringSignificantChanges: boolean;
    restoredForLocationRelaunch: boolean;
    nativeStoreErrorCode?: string | null;
  } | null>(null);
  const [healthStatus, setHealthStatus] = useState<HealthImportStatus[]>(cachedSnapshot?.healthStatus ?? []);
  const [healthImportPreferences, setHealthImportPreferences] = useState<HealthImportPreferences | null>(
    cachedSnapshot?.healthImportPreferences ?? null
  );
  const [healthAutoLogMappings, setHealthAutoLogMappings] = useState<HealthAutoLogMappings>(
    cachedSnapshot?.healthAutoLogMappings ?? {}
  );
  // Settings › Apple Health: the last Sync now result (never cached).
  const [healthSyncNoteText, setHealthSyncNote] = useState<string | null>(null);
  const [healthAccessGranted, setHealthAccessGranted] = useState<boolean | null>(null);
  const [exportingHealthDebug, setExportingHealthDebug] = useState(false);
  const refreshes = useRef(createOwnerSyncCoalescer<void>());
  const settingsScrollRef = useRef<ScrollView>(null);
  const settingsScrollOffsetRef = useRef(0);
  const settingsScrollContentHeightRef = useRef(0);
  const settingsScrollViewportHeightRef = useRef(0);
  const signingOutRef = useRef(false);
  const signedOutNavigationScheduledRef = useRef(false);

  const finishSignedOutNavigation = useCallback(() => {
    if (signedOutNavigationScheduledRef.current) return;
    signedOutNavigationScheduledRef.current = true;
    clearSettingsSnapshot();
    publishMobileSignedOut();
    requestAnimationFrame(() => {
      if (router.canDismiss()) router.dismissAll();
      else router.replace("/(tabs)/today");
    });
  }, []);

  const clampSettingsScroll = useCallback(() => {
    const offset = settingsScrollOffsetRef.current;
    const contentHeight = settingsScrollContentHeightRef.current;
    const viewportHeight = settingsScrollViewportHeightRef.current;
    if (!settingsScrollNeedsClamp(offset, contentHeight, viewportHeight)) return;
    const nextOffset = clampSettingsScrollOffset(offset, contentHeight, viewportHeight);
    settingsScrollOffsetRef.current = nextOffset;
    settingsScrollRef.current?.scrollTo({ y: nextOffset, animated: false });
  }, []);

  useEffect(() => {
    Keyboard.dismiss();
    setLocationInfoSheet(null);
    settingsScrollOffsetRef.current = 0;
    const frame = requestAnimationFrame(() => {
      settingsScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [settingsSection]);

  const setDataAndCache = useCallback((action: SetStateAction<MobileBootstrap | null>) => {
    setData((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ data: next });
      return next;
    });
  }, []);

  const setQueueAndCache = useCallback((action: SetStateAction<QueuedEvent[]>) => {
    setQueue((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ queue: next });
      return next;
    });
  }, []);

  const setLastSyncResultAndCache = useCallback((action: SetStateAction<SyncQueueResult | null>) => {
    setLastSyncResult((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ lastSyncResult: next });
      return next;
    });
  }, []);


  const setHealthStatusAndCache = useCallback((action: SetStateAction<HealthImportStatus[]>) => {
    setHealthStatus((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ healthStatus: next, healthUpdatedAt: Date.now() });
      return next;
    });
  }, []);

  const setHealthImportPreferencesAndCache = useCallback((action: SetStateAction<HealthImportPreferences | null>) => {
    setHealthImportPreferences((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ healthImportPreferences: next, healthUpdatedAt: Date.now() });
      return next;
    });
  }, []);

  const setHealthAutoLogMappingsAndCache = useCallback((action: SetStateAction<HealthAutoLogMappings>) => {
    setHealthAutoLogMappings((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ healthAutoLogMappings: next, healthUpdatedAt: Date.now() });
      return next;
    });
  }, []);

  const refreshReviewDiagnostics = useCallback(async () => {
    const [diagnostics, issues] = await Promise.all([
      getReviewSyncDiagnostics(),
      listReviewSyncIssues()
    ]);
    setReviewSyncDiagnostics(diagnostics);
    setReviewSyncIssues(issues);
  }, []);

  const refreshTimeEntryDiagnostics = useCallback(async () => {
    const [diagnostics, issues] = await Promise.all([
      getTimeEntryOutboxDiagnostics(),
      listTimeEntrySyncIssues()
    ]);
    setTimeEntrySyncDiagnostics(diagnostics);
    setTimeEntrySyncIssues(issues);
  }, []);

  const refreshTimerStopDiagnostics = useCallback(async () => {
    const [diagnostics, issues] = await Promise.all([
      getTimerStopOutboxDiagnostics(),
      listTimerStopSyncIssues()
    ]);
    setTimerStopSyncDiagnostics(diagnostics);
    setTimerStopSyncIssues(issues);
  }, []);

  // Queue reads: the latest one started wins (load() and the live subscription share the
  // sequence), and a read never lands after Settings closed or the account changed.
  const queueReadSequence = useRef(0);
  const queueMounted = useRef(false);
  async function refreshQueueLatest() {
    const mine = ++queueReadSequence.current;
    try {
      const owner = await readActiveMobileAccount();
      const queued = await readQueue();
      if (!queueMounted.current || mine !== queueReadSequence.current || !owner) return;
      const stillOwner = await readActiveMobileAccount();
      // Re-checked right before publishing: Settings may have closed during the owner read.
      if (!queueMounted.current || !stillOwner || !mobileAccountOwnersEqual(owner, stillOwner) || mine !== queueReadSequence.current) return;
      setQueueAndCache(queued);
    } catch {
      // A failed local read leaves the last known queue in place.
    }
  }

  const load = useCallback((options?: { silent?: boolean; trigger?: "navigation" | "focus" | "pull" }) => refreshes.current.run("settings", true, async () => {
    const showRefreshIndicator = shouldShowSettingsRefreshSpinner(options?.trigger ?? "navigation");
    if (showRefreshIndicator) setRefreshing(true);
    let staleActivityRefresh = false;
    // The local queue has one guarded reader (refreshQueueLatest): it publishes whether or not the
    // bootstrap below succeeds, and never after Settings closed or the account changed.
    void refreshQueueLatest();
    try {
      const loadOwner = await readActiveMobileAccount();
      await drainNativeShortcutQueue();
      const epochAtFetch = activityAnswerEpoch;
      const [bootstrap, location] = await Promise.all([
        fetchBootstrap(),
        getLocationVisitDiagnostics()
      ]);
      // Published only while Settings is open for the account that asked: a refresh finishing
      // after a sign-out or an account switch never refills the cleared snapshot or this screen.
      const publishOwner = await readActiveMobileAccount();
      if (!queueMounted.current || !loadOwner || !mobileAccountOwnersEqual(loadOwner, publishOwner)) return;
      // Fetched before an activity change's answer: it may miss that change, so it is not shown;
      // a fresh refresh follows.
      if (epochAtFetch !== activityAnswerEpoch) {
        staleActivityRefresh = true;
        return;
      }
      const nextLocationStatus = locationStatusText(location);
      updateSettingsSnapshot({
        data: bootstrap,
        locationDiagnostics: location,
        locationStatus: nextLocationStatus,
        updatedAt: Date.now()
      });
      // The activity gate counts the refreshed activities before any awaiting change continues.
      activityCategoriesRef.current = bootstrap.categories;
      activityFreshEpoch.current = epochAtFetch;
      setData(bootstrap);
      await configureLocationIntelligence(bootstrap);
      syncShortcutCatalog(bootstrap);
      setLocationDiagnostics(location);
      setLocationStatus(nextLocationStatus);
      await refreshLocationV2Diagnostics();
      await refreshReviewDiagnostics();
      await refreshTimeEntryDiagnostics();
      await refreshTimerStopDiagnostics();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      if (!options?.silent && !isRetryableMobileConnectivityFailure(error)) {
        Alert.alert(
          "Unable to refresh Settings",
          "Dayframe could not refresh Settings. Try again in a moment."
        );
      }
    } finally {
      if (showRefreshIndicator) setRefreshing(false);
      // A refresh skipped for being older than an activity answer is fetched again, after this
      // run has finished (so it is a new fetch, not this one joined).
      if (staleActivityRefresh && queueMounted.current) setTimeout(() => void goalReload.current?.({ silent: true }), 0);
    }
  }, async () => {}), [
    finishSignedOutNavigation,
    refreshReviewDiagnostics,
    refreshTimeEntryDiagnostics,
    refreshTimerStopDiagnostics
  ]);

  // The activity queue changes outside Settings (timer actions while offline); keep its count live so
  // the Help row and Sync help never say "up to date" with something waiting.
  useEffect(() => {
    queueMounted.current = true;
    // Read once on opening (a timer action may have queued while Settings was closed) and on
    // every change after.
    void refreshQueueLatest();
    const unsubscribe = subscribeActivityQueue(() => {
      void refreshQueueLatest();
    });
    return () => {
      queueMounted.current = false;
      // Any read still in flight can no longer publish.
      queueReadSequence.current += 1;
      unsubscribe();
    };
    // refreshQueueLatest only reads refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apple Health mappings have one app-wide writer (UIA-085, healthMappingWriter): Logs as, Use
  // default and Name queue per type and merge into the saved mapping when they run. This screen
  // shows its mappings (saved, with queued changes laid over them) while it is open.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => healthMappingWriter.subscribe({
    show: setHealthAutoLogMappingsAndCache,
    failed: (error) => {
      Alert.alert("Apple Health", error instanceof Error ? error.message : "Unable to save Health mapping.");
    },
    settled: () => void loadRef.current({ silent: true })
  }), [setHealthAutoLogMappingsAndCache]);

  // A reconnect bootstrap is held to the same rule as load(): one fetched before an activity
  // answer may miss that change (a rename), so it is not shown; a fresh refresh follows instead.
  const recoveryEpochs = useRef(new Map<number, number>());
  useEffect(() => subscribeRecoveredDashboardBootstrap(event => {
    if (event.type === "started") {
      recoveryEpochs.current.set(event.publicationId, activityAnswerEpoch);
      return;
    }
    const startedAt = recoveryEpochs.current.get(event.publicationId);
    // Every ending (completed, failed, cancelled) forgets its record, so the map never grows.
    recoveryEpochs.current.delete(event.publicationId);
    if (event.type !== "completed") return;
    if (startedAt === undefined || startedAt !== activityAnswerEpoch) {
      void goalReload.current?.({ silent: true });
      return;
    }
    activityCategoriesRef.current = event.bootstrap.categories;
    setDataAndCache(event.bootstrap);
  }), [setDataAndCache]);

  useEffect(() => {
    if (!isSettingsSnapshotFresh()) void load({ silent: true });
  }, [load]);

  useEffect(() => {
    void refreshReviewDiagnostics();
    return subscribeReviewSync(() => {
      void refreshReviewDiagnostics();
    });
  }, [refreshReviewDiagnostics]);

  useEffect(() => {
    void refreshTimeEntryDiagnostics();
    return subscribeTimeEntryOutbox(() => {
      void refreshTimeEntryDiagnostics();
    });
  }, [refreshTimeEntryDiagnostics]);

  useEffect(() => {
    void refreshTimerStopDiagnostics();
    return subscribeTimerStopOutbox(() => {
      void refreshTimerStopDiagnostics();
    });
  }, [refreshTimerStopDiagnostics]);

  // The evening Review reminder: this account's choice plus the iOS notification permission,
  // re-read whenever the app returns (the permission is changed in iOS Settings).
  const [reviewNudge, setReviewNudge] = useState<ReviewNudgeState | null>(null);
  const [nudgePermission, setNudgePermission] = useState<ReviewNudgePermission | null>(null);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const refreshReviewNudge = useCallback(async () => {
    const owner = await readActiveMobileAccount();
    if (!owner) return;
    const [state, permission] = await Promise.all([
      readReviewNudgeState(owner),
      import("@/lib/reviewNudgeNative").then(({ readReviewNudgePermission }) => readReviewNudgePermission()).catch(() => null)
    ]);
    if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return;
    setReviewNudge(state);
    setNudgePermission(permission);
  }, []);
  useEffect(() => {
    void refreshReviewNudge();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void refreshReviewNudge(); });
    return () => subscription.remove();
  }, [refreshReviewNudge]);

  const reviewNudgeOn = Boolean(reviewNudge?.enabled) && nudgePermission === "granted";

  async function changeReviewNudge(change: (owner: MobileAccountOwner) => Promise<ReviewNudgeState>) {
    if (nudgeBusy) return;
    setNudgeBusy(true);
    try {
      const owner = await readActiveMobileAccount();
      if (!owner) return;
      const next = await change(owner);
      if (mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) setReviewNudge(next);
    } catch {
      Alert.alert("Evening reminder", "The reminder couldn't be changed. Try again.");
    } finally {
      setNudgeBusy(false);
    }
  }

  async function toggleReviewNudge(enabled: boolean) {
    if (!enabled) {
      await changeReviewNudge((owner) => setReviewNudgeEnabled(owner, false));
      return;
    }
    // iOS asks once; after that the choice lives in iPhone Settings.
    const nativeModule = await import("@/lib/reviewNudgeNative").catch(() => null);
    if (!nativeModule) return;
    let permission = await nativeModule.readReviewNudgePermission().catch(() => "denied" as const);
    if (permission === "undetermined") permission = await nativeModule.requestReviewNudgePermission().catch(() => "denied" as const);
    setNudgePermission(permission);
    if (permission !== "granted") return;
    // Plans from the latest count the reminder heard (with its time), never this page's cache.
    await changeReviewNudge((owner) => setReviewNudgeEnabled(owner, true));
  }

  // Motion & Fitness is changed in iOS Settings: re-read it whenever the app returns.
  useEffect(() => {
    const refreshMotion = () => void readMotionFitnessStatus().then(setMotionFitnessStatus);
    refreshMotion();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refreshMotion(); });
    return () => subscription.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadThemePreference();
      // Activities always refreshes on open: pins are only counted from this visit's own data.
      if (!isSettingsSnapshotFresh() || settingsSection === "categories") void load({ silent: true, trigger: "focus" });
      if (settingsSection === "categories") void refreshArchivedActivities();
    }, [load, reloadThemePreference, settingsSection])
  );

  useEffect(() => {
    if (settingsSection !== "index" && settingsSection !== "health") return;
    if (settingsSection === "index" && isSettingsHealthSnapshotFresh()) return;

    // Availability is re-read here; the connection record from Connect is kept (mergeHealthStatuses).
    getHealthImportStatus()
      .then((statuses) => setHealthStatusAndCache((current) => mergeHealthStatuses(current, statuses)))
      .catch(() => {
        setHealthStatusAndCache((current) => mergeHealthStatuses(current, [
          {
            provider: "healthkit",
            status: "error",
            notes: "Unable to check Apple Health status."
          }
        ]));
      });
    // iOS never reveals read access, so "Connected" means Dayframe's access request was accepted.
    isHealthKitAutomaticSyncEnabled().then(setHealthAccessGranted).catch(() => undefined);
    getHealthImportPreferences().then(setHealthImportPreferencesAndCache).catch(() => undefined);
    void healthMappingWriter.refresh();
  }, [
    setHealthAutoLogMappingsAndCache,
    setHealthImportPreferencesAndCache,
    setHealthStatusAndCache,
    settingsSection
  ]);

  useEffect(() => {
    if (settingsSection !== "index" && settingsSection !== "automations") return;

    if (!data?.places.length) {
      void refreshLocationDiagnostics();
      return;
    }
    refreshGeofencesForPlaces(data.places, { userId: data.user.id, workspaceId: data.workspace.id })
      .then((count) => {
        void refreshLocationDiagnostics(count > 0 ? `Monitoring ${count} saved ${count === 1 ? "place" : "places"}.` : undefined);
      })
      .catch(async (error) => {
        await recordLocationStoreError(error);
        await refreshLocationDiagnostics("Location monitoring could not be refreshed. Open diagnostics for details.");
      });
  }, [data?.places, settingsSection]);

  const healthAvailability =
    healthStatus.find((item) => item.provider === "healthkit" && item.kind === "availability") ??
    healthStatus.find((item) => item.provider === "healthkit");
  const healthPermissionStatus = healthStatus.find(
    (item) => item.provider === "healthkit" && item.kind === "permissions"
  );
  const queueDiagnostics = getQueueDiagnostics(queue);
  const reviewNeededEntryIds = new Set([
    ...(data?.dayEntries ?? []),
    ...(data?.weekEntries ?? []),
    ...(data?.entries ?? [])
  ].filter(isReviewNeededEntry).map((entry) => entry.id));
  const openReviewCount = (data?.reviewItems ?? []).filter(isOpenReviewItem).length + reviewNeededEntryIds.size;
  const canRetryFailed = queueDiagnostics.failedCount > 0;
  const canClearFailed = queueDiagnostics.clearableFailedCount > 0;

  const locationMonitoringAllowed = locationDiagnostics?.backgroundPermission === "granted";
  const locationCaptureNeedsRetry = locationDiagnostics?.locationLearningEnabled === true &&
    locationDiagnostics.locationLearningCaptureState === "inactive";
  const locationActionLabel = locationCaptureNeedsRetry ? "Restart location" : locationMonitoringAllowed
    ? "Refresh"
    : locationDiagnostics?.foregroundPermission === "denied"
      ? "Review access"
      : "Enable";
  const motionFitness = motionFitnessStatus
    ? motionFitnessPresentation(motionFitnessStatus, locationDiagnostics?.locationLearningEnabled === true)
    : null;
  const settingsTitle = settingsSectionTitle(settingsSection);
  const backLabel = usePreviousScreenLabel() ?? settingsBackLabel(settingsSection, blocksNavOrigin(params.from));
  const categoryCount = data?.categories.length ?? 0;
  const workspaceLabel = data?.workspace?.name ?? "Default workspace";
  const pinnedCategoryCount = (data?.categories ?? []).filter((category) => category.isPinned).length;
  // Settings › Your day: shown at once, saved to the account a moment after the last tap.
  const [goalDraft, setGoalDraft] = useState<TimeGoals | null>(null);
  // The account whose goals are on screen (Today is told only about the same account).
  const goalUserId = useRef<string | null>(null);
  goalUserId.current = data?.user.id ?? null;
  const goalReload = useRef<((options: { silent: boolean }) => unknown) | null>(null);
  goalReload.current = load;
  const goalSaver = useRef(createGoalSaver({
    delayMs: GOAL_SAVE_DELAY_MS,
    save: (goals) => updateTimeGoals({ dailyGoalMinutes: goals.daily * 60, weeklyGoalMinutes: goals.weekly * 60 }),
    onSaved: (goals) => {
      const userId = goalUserId.current;
      const withGoals = (currentData: MobileBootstrap | null) => currentData && currentData.user.id === userId
        ? { ...currentData, user: { ...currentData.user, dailyGoalMinutes: goals.daily * 60, weeklyGoalMinutes: goals.weekly * 60 } }
        : currentData;
      // The module snapshot is updated directly, so reopening Settings shows the saved goals even
      // when this save finished after Settings closed.
      const snapshotData = readSettingsSnapshot()?.data ?? null;
      if (snapshotData) updateSettingsSnapshot({ data: withGoals(snapshotData) });
      setDataAndCache(withGoals);
      setGoalDraft(null);
      if (userId) publishSavedTimeGoals({ userId, dailyGoalMinutes: goals.daily * 60, weeklyGoalMinutes: goals.weekly * 60 });
    },
    onFailed: (error) => {
      setGoalDraft(null);
      if (error instanceof AuthRequiredError) return;
      // An earlier save may have landed: show what the account really holds.
      void goalReload.current?.({ silent: true });
      Alert.alert(
        "Your day",
        isRetryableMobileConnectivityFailure(error)
          ? "Your goal was not saved. Try again when you're online."
          : error instanceof Error ? error.message : "Your goal was not saved. Try again."
      );
    }
  })).current;
  const dailyGoalHours = goalDraft?.daily ?? Math.round((data?.user.dailyGoalMinutes ?? 480) / 60);
  const weeklyGoalHours = goalDraft?.weekly ?? Math.round((data?.user.weeklyGoalMinutes ?? 2400) / 60);
  const locationAccessSummary = locationDiagnostics?.locationLearningCaptureState === "logout_cleanup"
    ? "Paused while signing out"
    : locationMonitoringAllowed
      ? "Always"
      : locationDiagnostics?.foregroundPermission === "granted"
        ? "Needs Always access"
        : locationDiagnostics?.foregroundPermission === "denied"
          ? "Off in iPhone Settings"
          : "Not set up";
  const locationSuggestionsSummary = locationCaptureNeedsRetry
    ? "Paused. Open Location to restart it."
    : locationDiagnostics?.locationLearningEnabled && !locationMonitoringAllowed
      ? "Needs Always location access"
      : "Anything uncertain waits in Review";
  const healthWorkoutKeys = HEALTH_IMPORT_PREFERENCE_OPTIONS.filter((option) => option.key !== "sleep");
  const healthWorkoutSummary = healthImportPreferences
    ? `${healthWorkoutKeys.filter((option) => healthImportPreferences[option.key]).length} of ${healthWorkoutKeys.length}`
    : null;
  // Settings › Location: the consent switch's plain state, kept apart from the iOS permission.
  const locationSuggestionsDetail = locationDiagnostics?.locationLearningCaptureState === "logout_cleanup"
    ? "Paused while signing out. Sign out again to finish."
    : locationCaptureNeedsRetry
      ? "Paused. Tap Restart location above to start it again."
      : locationDiagnostics?.locationLearningEnabled && !locationMonitoringAllowed
        ? "On, but needs Always location access"
        : locationDiagnostics?.locationLearningActive
          ? "On. Anything uncertain waits in Review."
          : "Off";
  // Settings › Apple Health: one plain access line (the notes behind it stay in the details).
  const healthConnected = healthAccessGranted === true || healthPermissionStatus?.status === "available";
  const healthAccessSummary = healthAvailability?.status === "unavailable"
    ? "Apple Health isn't available on this iPhone"
    : healthConnected
      ? "Connected"
      : healthPermissionStatus
        ? "Allow Dayframe in the Health app"
        : "Not connected yet";
  const [healthPickerKey, setHealthPickerKey] = useState<HealthImportPreferenceKey | null>(null);
  const [healthDetailKey, setHealthDetailKey] = useState<HealthImportPreferenceKey | null>(null);
  const [activityEditor, setActivityEditor] = useState<{ activity: Category | null } | null>(null);
  activityEditorOpen.current = activityEditor !== null;
  // Settings › Activities › Archived (Blocks 6b-2): read from the server when the page opens.
  const [archivedActivities, setArchivedActivities] = useState<Category[] | null>(null);
  const archivedReads = useRef(createArchivedReadGate()).current;
  // One activity change at a time on the Activities page (pins, saves, creates, archives).
  const activityChanges = useRef(createActivityChangeGate()).current;
  // The activities the gate reads: kept current at once by applyActivityCategories, and
  // re-synced from each committed load.
  const activityCategoriesRef = useRef<Category[]>([]);
  // The answer epoch this visit's last published refresh was fetched at (-1: none yet). Pins
  // count as fresh only while no activity answer has arrived since.
  const activityFreshEpoch = useRef(-1);
  const activityPinsFresh = () => activityFreshEpoch.current === activityAnswerEpoch;
  const lastSyncedCategories = useRef<Category[] | undefined>(undefined);
  if (data?.categories !== lastSyncedCategories.current) {
    lastSyncedCategories.current = data?.categories;
    activityCategoriesRef.current = data?.categories ?? [];
  }
  // Settings › Activities: each row's last seven days, from the same lists as Today's quick start.
  const activityWeekSeconds = activityWeekSecondsFor(
    [data?.historyEntries, data?.entries, data?.weekEntries, data?.dayEntries],
    Date.now(),
    isReviewNeededEntry
  );

  // Sync help: a short note about the page's own last action (never cached), cleared whenever the
  // page opens or what it lists changes, so it can't contradict the status above it.
  const [syncHelpNote, setSyncHelpNote] = useState<string | null>(null);
  const syncHelpIssueKey = [
    ...timerStopSyncIssues.map((issue) => issue.clientEventId),
    ...timeEntrySyncIssues.map((issue) => issue.clientCommandId),
    ...reviewSyncIssues.map((issue) => `${issue.clientMutationId}:${issue.resolutionStatus}`),
    `failed:${queueDiagnostics.permanentFailedCount}`,
    `quarantine:${timeEntrySyncDiagnostics?.quarantinedCount ?? 0}:${timeEntrySyncDiagnostics?.deviceQuarantinedCount ?? 0}`
  ].join("|");
  useEffect(() => {
    setSyncHelpNote(null);
  }, [settingsSection, syncHelpIssueKey]);
  // Sync help and the Settings Help row: one plain status (settingsSyncDiagnostics.syncHelpStatus).
  const syncStatus = syncHelpStatus({
    timerStopIssueCount: timerStopSyncIssues.length,
    timeEntryIssueCount: timeEntrySyncIssues.length,
    reviewIssueCount: reviewSyncIssues.length,
    permanentFailedCount: queueDiagnostics.permanentFailedCount,
    quarantinedCount: timeEntrySyncDiagnostics?.quarantinedCount ?? 0,
    deviceQuarantinedCount: timeEntrySyncDiagnostics?.deviceQuarantinedCount ?? 0,
    queuedCount: queueDiagnostics.queuedCount,
    timerStopPendingCount: timerStopSyncDiagnostics?.pendingCount ?? 0,
    timeEntryPendingCount: timeEntrySyncDiagnostics?.pendingCount ?? 0,
    reviewWaitingCount: reviewSyncDiagnostics?.waitingCount ?? 0,
    reviewSignInCount: reviewSyncDiagnostics?.authenticationRequiredCount ?? 0
  });
  const syncNeedsAttention = syncStatus.kind === "attention";

  function changeGoal(kind: "daily" | "weekly", direction: -1 | 1) {
    if (!data) return;
    const limits = kind === "daily" ? DAILY_GOAL_HOURS : WEEKLY_GOAL_HOURS;
    const current = { daily: dailyGoalHours, weekly: weeklyGoalHours };
    const nextValue = Math.min(limits.max, Math.max(limits.min, current[kind] + direction * limits.step));
    if (nextValue === current[kind]) return;
    const next = { ...current, [kind]: nextValue };
    setGoalDraft(next);
    goalSaver.schedule(next);
  }
  // Leaving Settings (or the app going to the background) saves a pending goal change at once.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") goalSaver.flush();
    });
    return () => {
      subscription.remove();
      goalSaver.flush();
    };
  }, [goalSaver]);

  function goBack() {
    router.back();
  }

  function openSettingsSection(section: Exclude<SettingsSection, "index">) {
    router.push({ pathname: "/settings", params: { section } });
  }

  // Settings › Activities (Blocks 6b-1): the editor sheet for New activity or one activity.
  async function saveActivityFromEditor(activity: Category | null, draft: ActivityEditorDraft) {
    // Every activity change waits its turn (createActivityChangeGate): an older answer never
    // lands on top of a newer change.
    const change = await activityChanges.run(async () => {
      const owner = await readActiveMobileAccount();
      // A pin asked for when the sheet opened is checked against quick start as it is now.
      const pinnedNow = activityCategoriesRef.current.filter((item) => item.isPinned).length;
      // Only counted from this visit's own refresh: an older cached copy may be missing a pin.
      const pinned = !activity && draft.isPinned && activityPinsFresh() && pinnedNow < QUICK_START_PIN_LIMIT;
      const sequence = beginSavedActivityChange();
      const result = activity
        ? await updateCategory(activity.id, { name: draft.name, color: draft.color, icon: draft.icon, countsTowardGoal: draft.countsTowardGoal })
        : await createCategory(draft.name, { color: draft.color, icon: draft.icon, isPinned: pinned, countsTowardGoal: draft.countsTowardGoal });
      // Today and Reports (the Dashboard's bootstrap) pick it up too, e.g. a "Counts toward goal"
      // change, whenever the account and workspace are unchanged, even if Settings closed meanwhile.
      const ownerNow = await readActiveMobileAccount();
      if (owner && ownerNow && mobileAccountOwnersEqual(owner, ownerNow)) {
        publishSavedActivity({ userId: owner.userId, workspaceId: owner.workspaceId, category: result.category, sequence });
      }
      // Settings' own state only while Settings is still open for that account.
      if (!(await activityOwnerStill(owner))) return;
      if (!activity && pinned && !result.category.isPinned) {
        // The server's own quick-start cap won (another device pinned one meanwhile).
        // Shown once the editor has left (its modal would hide it); see showAfterActivityEditor.
        showAfterActivityEditor(`Quick start is full. ${result.category.name} was created but not pinned.`, paletteColorFor(result.category.color, result.category.name, theme.mode));
      }
      // The accepted activity shows at once, even if the refresh below fails.
      applyActivityCategories((categories) => categories.some((item) => item.id === result.category.id)
        ? categories.map((item) => item.id === result.category.id ? { ...item, ...result.category } : item)
        : [...categories, result.category]);
      await load({ silent: true });
    }).catch((error: unknown) => ({ ran: true as const, error }));
    if (!change.ran) return ACTIVITY_CHANGE_BUSY_MESSAGE;
    if (!("error" in change)) return null;
    if (change.error instanceof AuthRequiredError) {
      finishSignedOutNavigation();
      return null;
    }
    return change.error instanceof Error ? change.error.message : "Couldn't save the activity. Try again.";
  }

  async function archiveActivityFromEditor(activity: { id: string }) {
    const change = await activityChanges.run(async () => {
      const owner = await readActiveMobileAccount();
      await archiveCategory(activity.id);
      if (!(await activityOwnerStill(owner))) return;
      // Archived: it leaves every list (and quick start) at once, even if the refresh fails.
      applyActivityCategories((categories) => categories.filter((item) => item.id !== activity.id));
      archivedReads.changed();
      void refreshArchivedActivities();
      await load({ silent: true });
    }).catch((error: unknown) => ({ ran: true as const, error }));
    if (!change.ran) return ACTIVITY_CHANGE_BUSY_MESSAGE;
    if (!("error" in change)) return null;
    if (change.error instanceof AuthRequiredError) {
      finishSignedOutNavigation();
      return null;
    }
    return change.error instanceof Error ? change.error.message : "Couldn't archive the activity. Try again.";
  }

  async function refreshArchivedActivities() {
    const read = archivedReads.begin();
    const owner = await readActiveMobileAccount();
    try {
      const archived = await listArchivedCategories();
      // A read that was out while an archive or restore landed (or behind a newer read) is dropped.
      if (archivedReads.current(read) && (await activityOwnerStillQuiet(owner)) && archivedReads.current(read)) {
        setArchivedActivities(archived);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) finishSignedOutNavigation();
      // Otherwise the Archived section simply stays as it was (or hidden).
    }
  }

  async function restoreArchivedActivity(activity: Category) {
    if (activityChanges.busy()) {
      settingsNotice.show(ACTIVITY_CHANGE_BUSY_MESSAGE);
      return;
    }
    const change = await activityChanges.run(async () => {
      const owner = await readActiveMobileAccount();
      const result = await restoreCategory(activity.id);
      if (!(await activityOwnerStill(owner))) return;
      // Back in its group at once (unpinned), and out of Archived.
      applyActivityCategories((categories) => categories.some((item) => item.id === result.category.id)
        ? categories
        : [...categories, result.category]);
      setArchivedActivities((current) => current?.filter((item) => item.id !== activity.id) ?? current);
      archivedReads.changed();
      AccessibilityInfo.announceForAccessibility(`${result.category.name} restored.`);
      void refreshArchivedActivities();
      await load({ silent: true });
    }).catch((error: unknown) => ({ ran: true as const, error }));
    if ("error" in change) {
      if (change.error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      Alert.alert("Activities", change.error instanceof Error ? change.error.message : "Couldn't restore the activity. Try again.");
    }
  }

  async function toggleCategoryPin(category: Category) {
    // Pins share the one-change-at-a-time gate: an unpin still saving never frees a slot for
    // another pin or a pinned create (if it failed, quick start would end with seven).
    if (activityChanges.busy()) {
      // Visible (and spoken by VoiceOver): the tap did not change the pin.
      settingsNotice.show(ACTIVITY_CHANGE_BUSY_MESSAGE);
      return;
    }
    // Pins are counted from this visit's own refresh, never from an older cached copy.
    if (!activityPinsFresh()) {
      settingsNotice.show("Still loading your activities. Try again in a moment.");
      void load({ silent: true });
      return;
    }
    if (pinLimitReached(activityCategoriesRef.current, category.id)) {
      settingsNotice.show(`Quick start holds ${QUICK_START_PIN_LIMIT}. Unpin one first.`, paletteColorFor(category.color, category.name, theme.mode));
      return;
    }
    const nextPinned = !category.isPinned;
    await activityChanges.run(async () => {
      const owner = await readActiveMobileAccount();
      patchCategory(category.id, { isPinned: nextPinned });
      try {
        const result = await updateCategory(category.id, { isPinned: nextPinned });
        if (!(await activityOwnerStill(owner))) return;
        if (result.category.isPinned !== nextPinned) {
          throw new Error("Dayframe couldn't save the pin. Try again in a moment.");
        }
        await load({ silent: true });
      } catch (error) {
        if (!(await activityOwnerStill(owner))) return;
        patchCategory(category.id, { isPinned: category.isPinned });
        if (error instanceof AuthRequiredError) {
          finishSignedOutNavigation();
          return;
        }
        Alert.alert("Activities", error instanceof Error ? error.message : "Unable to update activity.");
      }
    });
  }

  async function syncAndReload() {
    setSyncingQueue(true);
    try {
      const result = await synchroniseDeviceNow({ date: data?.dateRange?.selectedDate });
      await refreshQueueLatest();
      await Promise.all([refreshReviewDiagnostics(), refreshLocationV2Diagnostics(), refreshTimeEntryDiagnostics(), refreshTimerStopDiagnostics()]);
      return result;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return null;
      }
      return null;
    } finally {
      setSyncingQueue(false);
    }
  }

  function confirmDiscardReviewIssue(clientMutationId: string) {
    void confirmForSession({
      eyebrow: "Sync help",
      title: "Discard this change?",
      message: "Only this change is removed. Anything still sending is kept.",
      confirmLabel: "Discard",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void discardReviewSyncIssue(clientMutationId).then(
          () => { void refreshReviewDiagnostics().catch(() => undefined); },
          () => setSyncHelpNote("Couldn't discard that change. Nothing was removed.")
        );
      }
    });
  }

  function confirmDiscardTimeEntryIssue(clientCommandId: string) {
    void confirmForSession({
      eyebrow: "Sync help",
      title: "Discard this block change?",
      message: "Your account already shows the earlier version. Only this change is removed from this iPhone.",
      confirmLabel: "Discard",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void discardTimeEntrySyncIssue(clientCommandId).then(
          () => { void refreshTimeEntryDiagnostics().catch(() => undefined); },
          () => setSyncHelpNote("Couldn't discard that change. Nothing was removed.")
        );
      }
    });
  }

  function retryTimeEntryIssue(clientCommandId: string) {
    // Only the retry itself failing gets the note; a failed refresh afterwards is retried by the
    // diagnostics subscription.
    void retryTimeEntrySyncIssue(clientCommandId).then(
      (retried) => {
        void refreshTimeEntryDiagnostics().catch(() => undefined);
      },
      () => setSyncHelpNote("Couldn't retry that change. It's still saved on this iPhone.")
    );
  }

  function confirmDiscardTimerStopIssue(clientEventId: string) {
    void confirmForSession({
      eyebrow: "Sync help",
      title: "Discard this Stop?",
      message: "The timer stays as your account has it. Only this Stop is removed from this iPhone.",
      confirmLabel: "Discard Stop",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void discardTimerStopSyncIssue(clientEventId).then(
          () => { void refreshTimerStopDiagnostics().catch(() => undefined); },
          () => setSyncHelpNote("Couldn't discard that Stop. Nothing was removed.")
        );
      }
    });
  }

  function retryTimerStopIssue(clientEventId: string) {
    // Only the retry itself failing gets the note; a failed refresh afterwards is retried by the
    // diagnostics subscription.
    void retryTimerStopSyncIssue(clientEventId).then(
      (retried) => {
        void refreshTimerStopDiagnostics().catch(() => undefined);
      },
      () => setSyncHelpNote("Couldn't retry that Stop. It's still saved on this iPhone.")
    );
  }

  function confirmClearTimeEntryQuarantine() {
    void confirmForSession({
      eyebrow: "Sync help",
      title: "Clear unreadable changes?",
      message: "Dayframe couldn't read these changes, so they can't be sent. Clearing removes only them.",
      confirmLabel: "Clear",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void clearTimeEntryOutboxQuarantine().then(
          () => { void refreshTimeEntryDiagnostics().catch(() => undefined); },
          () => setSyncHelpNote("Couldn't clear those records. Nothing was removed.")
        );
      }
    });
  }

  function confirmClearDeviceTimeEntryQuarantine() {
    void confirmForSession({
      eyebrow: "Sync help",
      title: "Clear unreadable changes on this iPhone?",
      message: "These changes couldn't be read, and Dayframe can't tell which account they belong to, so they can't be sent. Clearing removes only them.",
      confirmLabel: "Clear",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void clearDeviceTimeEntryOutboxQuarantine().then(
          () => { void refreshTimeEntryDiagnostics().catch(() => undefined); },
          () => setSyncHelpNote("Couldn't clear those records. Nothing was removed.")
        );
      }
    });
  }

  async function retryFailedAndReload() {
    setSyncingQueue(true);
    try {
      const result = await retryFailedQueuedEvents();
      await refreshQueueLatest();
      setLastSyncResultAndCache(result);
      // Network failures and rejections come back in the result, not as errors.
      if (result.failedCount > 0 || result.firstError) {
        setSyncHelpNote("Some items still couldn't be sent. They're kept on this iPhone.");
      }
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      setSyncHelpNote("Couldn't retry those items. They're still saved on this iPhone.");
    } finally {
      setSyncingQueue(false);
    }
  }

  function confirmClearFailedQueue() {
    void confirmForSession({
      eyebrow: "Sync help",
      title: "Clear changes that can't be sent?",
      message: "Dayframe can't send these changes, so they'll be removed from this iPhone. Anything still sending is kept.",
      confirmLabel: "Clear",
      confirmHint: "This can't be undone.",
      onConfirm: () => {
        void clearFailedQueue();
      }
    });
  }

  async function clearFailedQueue() {
    try {
      const result = await clearFailedQueuedEvents();
      await refreshQueueLatest();
      setLastSyncResultAndCache(null);
      setSyncHelpNote(`Cleared ${result.removedCount} ${result.removedCount === 1 ? "item" : "items"} from this iPhone.`);
      await load({ silent: true });
    } catch (error) {
      setSyncHelpNote("Couldn't clear those items. Nothing was removed.");
    }
  }

  async function exportQueueDiagnostics() {
    try {
      const owner = await readActiveMobileAccount();
      const [
        latestQueue, latestReviewDiagnostics, reviewMutations, location, native, health, manual,
        timeEntryDiagnostics, timeEntryIssues, timerStopDiagnostics, timerStopIssues
      ] = await Promise.all([
        readQueue(), getReviewSyncDiagnostics(), listReviewSyncDiagnosticMutations(),
        getLocationStoreDiagnostics(), getNativeLocationIntelligenceStatus().catch(() => null),
        getHealthImportStatus(), getLastManualSyncResult(),
        getTimeEntryOutboxDiagnostics(), listTimeEntrySyncIssues(),
        getTimerStopOutboxDiagnostics(), listTimerStopSyncIssues()
      ]);
      if (!owner || !mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return;
      const snapshot = {
        exportedAt: new Date().toISOString(),
        build: mobileBuildDiagnostics(),
        lastObservedServerBuild: data?.serverBuild ?? null,
        owner: { workspace: owner.workspaceId.slice(0, 8), user: owner.userId.slice(0, 8) },
        activity: supportQueueDiagnostics(latestQueue),
        health,
        reviewSync: { diagnostics: latestReviewDiagnostics, mutations: reviewMutations },
        // Rejected Edits/Deletes and Stops: status codes and errors left the Sync help screen, so
        // support still gets them here (IDs shortened as elsewhere).
        timeEntrySync: {
          diagnostics: { ...timeEntryDiagnostics, lastError: timeEntryDiagnostics.lastError?.slice(0, 120) ?? null },
          issues: timeEntryIssues.map((issue) => ({
            operation: issue.operation,
            entry: (issue.targetEntryId ?? issue.optimisticEntryId ?? "").slice(0, 8) || null,
            command: issue.clientCommandId.slice(0, 8),
            statusCode: issue.lastStatusCode ?? null,
            // Bounded: enough to tell a 404 from a validation message, never a long free-text body.
            error: issue.lastError ? issue.lastError.slice(0, 120) : null,
            updatedAt: issue.updatedAt
          }))
        },
        timerStopSync: {
          diagnostics: { ...timerStopDiagnostics, lastError: timerStopDiagnostics.lastError?.slice(0, 120) ?? null },
          issues: timerStopIssues.map((issue) => ({
            event: issue.clientEventId.slice(0, 8),
            queuedAt: issue.queuedAt,
            failedAt: issue.failedAt ?? null
          }))
        },
        location,
        nativeLocation: native ? {
          pendingSignalCount: native.pendingSignalCount,
          locationServicesEnabled: native.locationServicesEnabled,
          accuracyAuthorization: native.accuracyAuthorization,
          backgroundRefreshStatus: native.backgroundRefreshStatus,
          monitoringVisits: native.monitoringVisits,
          monitoringSignificantChanges: native.monitoringSignificantChanges,
          nativeStoreErrorCode: native.nativeStoreErrorCode
        } : null,
        presentationCache: getLocationReviewEvidencePrefetchDiagnostics(),
        manualSync: manual,
        selectedDate: data?.dateRange?.selectedDate ?? null,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
      await Share.share({
        title: `Dayframe sync diagnostics ${snapshot.exportedAt}`,
        message: JSON.stringify(snapshot, null, 2)
      });
      await refreshQueueLatest();
    } catch (error) {
      setSyncHelpNote("Couldn't prepare the support details. Try again.");
    }
  }

  async function enableLocation() {
    if (locationCaptureNeedsRetry) {
      await toggleLocationLearning(true);
      return;
    }
    if (locationMonitoringAllowed && data) {
      await startGeofences(data.places, { userId: data.user.id, workspaceId: data.workspace.id });
      await refreshLocationDiagnostics();
      return;
    }

    const status = await requestLocationAccess();
    updateSettingsSnapshot({ locationStatus: status });
    setLocationStatus(status);
    if (status.startsWith("Always allowed") && data) {
      await startGeofences(data.places, { userId: data.user.id, workspaceId: data.workspace.id });
      await refreshLocationDiagnostics();
    } else {
      await refreshLocationDiagnostics(status);
    }
  }

  async function handleMotionFitnessAction() {
    if (motionFitness?.action?.kind === "request") {
      setMotionFitnessStatus(await requestMotionFitness());
    } else if (motionFitness?.action?.kind === "open_settings") {
      await Linking.openSettings();
    }
  }

  async function toggleLocationLearning(enabled: boolean) {
    if (enabled && !locationMonitoringAllowed) {
      const status = await requestLocationAccess();
      updateSettingsSnapshot({ locationStatus: status });
      setLocationStatus(status);
      if (!status.startsWith("Always allowed")) {
        await refreshLocationDiagnostics(status);
        return;
      }
    }

    try {
      if (enabled) await ensureAutomaticLoggingCategories(["commute"]);
      const status = await setLocationLearningEnabled(enabled, data?.places ?? [], data ? { userId: data.user.id, workspaceId: data.workspace.id } : undefined);
      // An enable result can already have been overtaken by a later off. Show
      // the current effective projection, rather than replaying its on copy.
      await refreshLocationDiagnostics(enabled ? undefined : status);
      if (enabled) await load({ silent: true });
    } catch (error) {
      // Activation may have saved consent without completing capture. Refresh
      // the effective state even on failure so the retry remains reachable.
      await refreshLocationDiagnostics().catch(() => undefined);
      Alert.alert(
        "Location suggestions",
        error instanceof Error ? error.message : "Unable to enable commute logging."
      );
    }
  }

  async function refreshLocationDiagnostics(fallbackStatus?: string) {
    const diagnostics = await getLocationVisitDiagnostics();
    const nextLocationStatus = fallbackStatus ?? locationStatusText(diagnostics);
    updateSettingsSnapshot({
      locationDiagnostics: diagnostics,
      locationStatus: nextLocationStatus
    });
    setLocationDiagnostics(diagnostics);
    setLocationStatus(nextLocationStatus);
    await refreshLocationV2Diagnostics();
  }

  async function refreshLocationV2Diagnostics() {
    try {
      const owner = await readActiveMobileAccount();
      const session = owner ? await readOwnedAuthenticatedSessionSnapshot(owner) : null;
      const [, native] = await Promise.all([
        getLocationStoreDiagnostics(),
        getNativeLocationIntelligenceStatus().catch(() => null)
      ]);
      if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return;
      if (session?.status === "authenticated" && !isAuthenticatedSessionSnapshotCurrent(session.snapshot)) return;
      setNativeLocationStatus(native);
    } catch (error) {
      await recordLocationStoreError(error);
    }
  }

  function confirmDeleteLocationEvidence() {
    void confirmForSession({
      eyebrow: "Location history",
      title: "Clear recent location history?",
      message: "Removes recent location points from this iPhone and from your account. Logged blocks, saved places and Review items stay.",
      confirmLabel: "Clear history",
      confirmHint: "This can't be undone.",
      onConfirm: () => { void removeLocationEvidence(); }
    });
  }

  async function removeLocationEvidence() {
    try {
      const result = await deleteRecentLocationEvidence();
      await refreshLocationV2Diagnostics();
      // A success notice, not a failure: the Blocks toast says what went (UIA-005).
      settingsNotice.show(
        `Cleared ${result.localDeletedEvidenceCount} local and ${result.deletedEvidenceCount} account location points. Logged blocks stay.`
      );
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      Alert.alert("Location evidence", error instanceof Error ? error.message : "Unable to delete evidence.");
    }
  }

  async function shareLocationDiagnostics() {
    const owner = await readActiveMobileAccount();
    if (!owner) return;
    const session = await readOwnedAuthenticatedSessionSnapshot(owner);
    if (session.status !== "authenticated") return;
    const [local, native] = await Promise.all([getLocationStoreDiagnostics(), getNativeLocationIntelligenceStatus().catch(() => null)]);
    if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount()) || !isAuthenticatedSessionSnapshotCurrent(session.snapshot)) return;
    await Share.share({
      title: "Dayframe location diagnostics",
      message: JSON.stringify({
        exportedAt: new Date().toISOString(),
        rolloutMode: local.rolloutMode,
        engineVersion: local.engineVersion,
        accountConfigured: local.accountConfigured,
        savedPlaceCatalogueCount: local.savedPlaceCatalogueCount,
        pendingEvidenceCount: local.pendingEvidenceCount,
        acknowledgedEvidenceCount: local.acknowledgedEvidenceCount,
        outboxCount: local.outboxCount,
        segmentCount: local.segmentCount,
        oldestEvidenceAt: local.oldestEvidenceAt,
        oldestUnsynchronisedAt: local.oldestUnsynchronisedAt,
        lastAcceptedEvidenceAt: local.lastAcceptedEvidenceAt,
        lastEngineState: local.lastEngineState,
        activeProvisionalSegmentKind: local.activeProvisionalSegmentKind,
        lastGapDurationSeconds: local.lastGapDurationSeconds,
        rejectedEvidenceCounts: local.rejectedEvidenceCounts,
        uploadAttempt: local.uploadAttempt,
        replayAttempt: local.replayAttempt,
        lastUploadAt: local.lastUploadAt,
        lastServerReplayVersion: local.lastServerReplayVersion,
        lastServerReplayAt: local.lastServerReplayAt,
        lastServerReplayStatus: local.lastServerReplayStatus,
        lastServerReplayFinalisedCount: local.lastServerReplayFinalisedCount,
        lastServerReplaySemanticCount: local.lastServerReplaySemanticCount,
        lastServerReplayError: local.lastServerReplayError,
        lastUploadError: local.lastUploadError,
        droppedEvidenceCount: local.droppedEvidenceCount,
        retentionCleanupDeletedCount: local.retentionCleanupDeletedCount,
        retentionCleanupAt: local.retentionCleanupAt,
        foregroundPermission: locationDiagnostics?.foregroundPermission,
        backgroundPermission: locationDiagnostics?.backgroundPermission,
        registeredGeofenceCount: locationDiagnostics?.activeMonitorCount,
        excludedGeofenceCount: locationDiagnostics?.excludedMonitorCount,
        nativePendingSignalCount: native?.pendingSignalCount ?? null,
        locationServicesEnabled: native?.locationServicesEnabled ?? null,
        accuracyAuthorization: native?.accuracyAuthorization ?? null,
        backgroundRefreshStatus: native?.backgroundRefreshStatus ?? null,
        nativeVisitMonitoring: native?.monitoringVisits ?? false,
        nativeSignificantChangeMonitoring: native?.monitoringSignificantChanges ?? false,
        restoredForLocationRelaunch: native?.restoredForLocationRelaunch ?? false,
        nativeStoreErrorCode: native?.nativeStoreErrorCode ?? null
      }, null, 2)
    });
  }

  async function connectAppleHealth() {
    try {
      const permissions = await requestHealthKitPermissions();
      updateHealthStatus(permissions);
      if (permissions.status === "available") setHealthAccessGranted(true);
      if (permissions.status === "available") {
        const preferences = healthImportPreferences ?? await getHealthImportPreferences();
        const kinds = healthAutomaticCategoryKinds(preferences);
        if (kinds.length > 0) await ensureAutomaticLoggingCategories(kinds);
        await syncAppleHealth({ silent: true, connected: true });
      }
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health permission"));
    }
  }

  async function syncAppleHealth(options?: { silent?: boolean; connected?: boolean }) {
    setHealthSyncNote(null);
    try {
      const result = await syncAndReload();
      const statuses = await getHealthImportStatus();
      setHealthStatusAndCache((current) => mergeHealthStatuses(current, statuses));
      // A returned result is not a successful one: the Health lanes say what this tap did.
      // Connect passes connected: its grant is not yet in this render's healthConnected.
      setHealthSyncNote(healthSyncNote(result, { connected: options?.connected ?? healthConnected }));
    } catch (error) {
      if (error instanceof AuthRequiredError) return;
      const message = friendlyHealthKitError(error, "sync Apple Health");
      setHealthSyncNote(message);
      if (!options?.silent) {
        Alert.alert("Apple Health", message);
      }
    }
  }

  async function updateHealthImportPreference(type: HealthImportPreferenceKey, enabled: boolean) {
    const current = healthImportPreferences ?? await getHealthImportPreferences();
    const optimistic = { ...current, [type]: enabled };
    setHealthImportPreferencesAndCache(optimistic);
    try {
      if (enabled) {
        await ensureAutomaticLoggingCategories([
          type === "sleep" ? "sleep" : "health"
        ]);
      }
      const saved = await setHealthImportPreference(type, enabled);
      setHealthImportPreferencesAndCache(saved);
      await reprocessExistingHealthReviewItems(saved, { force: true, mappings: healthAutoLogMappings });
      await load({ silent: true });
    } catch (error) {
      setHealthImportPreferencesAndCache(current);
      Alert.alert("Apple Health", error instanceof Error ? error.message : "Unable to save Health preference.");
    }
  }

  /** Saves a Health type's mapping change; true once it is saved (a failure shows the saved mapping and alerts). */
  function updateHealthAutoLogMapping(type: HealthImportPreferenceKey, patch: HealthAutoLogMapping): Promise<boolean> {
    return healthMappingWriter.patch(type, patch);
  }

  async function exportAppleHealthDebug() {
    setExportingHealthDebug(true);
    setSyncHelpNote("Preparing Apple Health details…");
    try {
      const snapshot = await exportHealthDebugSnapshot();
      const summary =
        `${snapshot.healthKit.sleep.sampleCount} sleep samples, ` +
        `${snapshot.healthKit.sleep.sessions.length} sleep sessions and ` +
        `${snapshot.healthKit.workouts.sampleCount} workouts exported.`;
      await Share.share({
        title: `Dayframe Health debug ${snapshot.exportedAt}`,
        message: JSON.stringify(snapshot, null, 2)
      });
      setSyncHelpNote(summary);
    } catch (error) {
      const message = friendlyHealthKitError(error, "export Health debug data");
      setSyncHelpNote(message);
      Alert.alert("Apple Health", message);
    } finally {
      setExportingHealthDebug(false);
    }
  }

  // Settings › Apple Health › Sleep: the first switch-on asks for Apple Health access, so the
  // switch never reads "on" while nothing can be imported.
  async function setSleepImport(enabled: boolean) {
    if (enabled && healthPermissionStatus?.status !== "available") {
      try {
        const permissions = await requestHealthKitPermissions();
        updateHealthStatus(permissions);
        if (permissions.status !== "available") {
          Alert.alert("Apple Health", permissions.notes || "Allow Dayframe to read sleep in the Health app, then try again.");
          return;
        }
      } catch (error) {
        Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health permission"));
        return;
      }
    }
    await updateHealthImportPreference("sleep", enabled);
  }

  function updateHealthStatus(status: HealthImportStatus) {
    setHealthStatusAndCache((current) => [
      status,
      ...current.filter((item) => !(item.provider === status.provider && item.kind === status.kind))
    ]);
  }

  function patchCategory(id: string, patch: Partial<Category>) {
    applyActivityCategories((categories) => categories.map((category) =>
      category.id === id ? { ...category, ...patch } : category
    ));
  }

  // An activity change applies its answer only while Settings is open for the account it started
  // with: a late answer after signing out or switching account never writes the old account's
  // activities into this screen or its cached snapshot.
  /** The same owner check for a plain read, without counting as an activity answer. */
  async function activityOwnerStillQuiet(owner: Awaited<ReturnType<typeof readActiveMobileAccount>>) {
    const now = await readActiveMobileAccount();
    return Boolean(queueMounted.current && owner && now && mobileAccountOwnersEqual(owner, now));
  }

  async function activityOwnerStill(owner: Awaited<ReturnType<typeof readActiveMobileAccount>>) {
    // An answer arrived: every Settings visit's refreshes fetched before now are out of date.
    activityAnswerEpoch += 1;
    const now = await readActiveMobileAccount();
    if (queueMounted.current && owner && now && mobileAccountOwnersEqual(owner, now)) return true;
    // The answer is not applied here, so the cached activities may be behind the server (a pin
    // the server accepted): the next Settings visit refreshes before it trusts them.
    if (owner && now && mobileAccountOwnersEqual(owner, now)) updateSettingsSnapshot({ updatedAt: 0 });
    return false;
  }

  // Changes the page's activities and, at once, the copy the activity gate reads, so a change
  // (an unpin rolled back, a create, an archive) counts before the next one can start, not only
  // after React commits it.
  function applyActivityCategories(change: (categories: Category[]) => Category[]) {
    activityCategoriesRef.current = change(activityCategoriesRef.current);
    setDataAndCache((current) => current ? { ...current, categories: change(current.categories) } : current);
  }

  /** Opens a Dayframe web page in Safari; a failure says so instead of doing nothing. */
  async function openOnWeb(path: string) {
    try {
      await Linking.openURL(`${DAYFRAME_API_BASE}${path}`);
    } catch {
      settingsNotice.show("Couldn't open Safari. Try again.");
    }
  }

  async function signOut() {
    // Log out is never a silent no-op: a sign-in that can't be read (the Keychain locked or
    // failing) says so and how to retry.
    try {
      await signOutChecked();
    } catch {
      settingsNotice.show(SIGN_IN_UNREADABLE_NOTICE);
    }
  }

  async function signOutChecked() {
    // Consent to log out is for this account's session only: pinned before anything is read.
    const authority = await captureConfirmAuthority();
    if (!authority) {
      // Finish a logout that failed partway, or go to sign-in.
      await offerLogoutRecovery();
      return;
    }
    // A goal change still waiting is saved while the session is valid.
    goalSaver.flush();
    const diagnostics = await getReviewSyncDiagnostics();
    const unsynchronisedCount =
      diagnostics.waitingCount + diagnostics.needsAttentionCount;
    const reviewWarning = unsynchronisedCount > 0
      ? `${unsynchronisedCount} Review ${unsynchronisedCount === 1 ? "choice" : "choices"} Dayframe hasn't confirmed yet will be removed from this iPhone. `
      : "";
    void confirmForSession({
      eyebrow: "Account",
      title: "Sign out?",
      message: `${reviewWarning}Location points not yet sent from this iPhone will be removed. Everything already synced stays in your account.`,
      confirmLabel: "Sign out",
      confirmHint: "Changes not yet synced can't be recovered.",
      onConfirm: () => { void completeSignOut(); }
    }, authority);
  }

  /**
   * No live session could be pinned for Log out. A logout whose Keychain deletion failed leaves
   * this process signed out (or, after a restart, a session whose account was already removed)
   * while the sign-in is still stored: offer to finish it through the same logout path, bound to
   * that state so it can never log out a session that signed in since. With nothing left to clean
   * up, go to sign-in.
   */
  async function offerLogoutRecovery() {
    const recovery = await captureLogoutRecovery();
    if (!recovery) {
      settingsNotice.show("Your sign-in is changing. Try Sign out again in a moment.");
      return;
    }
    if (recovery.kind === "signed_out") {
      finishSignedOutNavigation();
      return;
    }
    confirmSheet.confirm({
      eyebrow: "Account",
      title: "Finish signing out?",
      message: "Dayframe couldn't finish signing out. This removes the sign-in still saved on this iPhone and anything not yet sent. Everything already synced stays in your account.",
      confirmLabel: "Sign out",
      confirmHint: "Changes not yet synced can't be recovered.",
      onConfirm: () => {
        void logoutRecoveryStillCurrent(recovery).then(
          (current) => {
            if (current) void completeSignOut();
            else settingsNotice.show(ACCOUNT_CHANGED_NOTICE);
          },
          () => settingsNotice.show(ACCOUNT_CHANGED_NOTICE)
        );
      }
    });
  }

  /**
   * Every destructive Settings confirmation is bound to the account and session it was asked in:
   * pinned when it opens and checked again once the sheet has left, so consent given for one
   * account never clears, discards or logs out another (a sign-out or account switch while the
   * sheet is up voids it).
   */
  async function confirmForSession(request: BlocksConfirmRequest, captured?: ConfirmAuthority) {
    let authority: ConfirmAuthority | null | undefined = captured;
    try {
      authority ??= await captureConfirmAuthority();
      if (!authority || !(await confirmAuthorityStillCurrent(authority))) {
        // The tap is voided because the session changed while it was being prepared: say so.
        settingsNotice.show(ACCOUNT_CHANGED_NOTICE);
        return false;
      }
    } catch {
      settingsNotice.show(SIGN_IN_UNREADABLE_NOTICE);
      return false;
    }
    return confirmSheet.confirm(bindConfirmToSession(request, authority, {
      onStale: () => settingsNotice.show(ACCOUNT_CHANGED_NOTICE)
    }));
  }

  async function completeSignOut() {
    goalSaver.cancel();
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    try {
      await logout();
      finishSignedOutNavigation();
    } catch (error) {
      signingOutRef.current = false;
      setSigningOut(false);
      Alert.alert(
        "Couldn't sign out",
        error instanceof Error ? error.message : "Dayframe couldn't finish signing out."
      );
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ gestureEnabled: !signingOut }} />
      <BlocksNavHeader backDisabled={signingOut} backLabel={backLabel} onBack={goBack} title={settingsTitle} />
      <ScrollView
        key={settingsSection}
        ref={settingsScrollRef}
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(_width, height) => {
          settingsScrollContentHeightRef.current = height;
          requestAnimationFrame(clampSettingsScroll);
        }}
        onLayout={(event) => {
          settingsScrollViewportHeightRef.current = event.nativeEvent.layout.height;
          requestAnimationFrame(clampSettingsScroll);
        }}
        onScroll={(event) => {
          settingsScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              if (settingsSection === "categories") void refreshArchivedActivities();
              return load({ trigger: "pull" });
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.contentStack}>
          {settingsSection === "index" ? (
            <View style={styles.settingsBlocksStack}>
              <SettingsAccountCard
                email={data?.user.email ?? ""}
                name={data?.user.name ?? ""}
                onPress={() => openSettingsSection("profile")}
                theme={theme}
                workspace={workspaceLabel}
              />

              <SettingsBlockGroup theme={theme} title="Your day">
                <SettingsBlockRow
                  control={
                    <SettingsStepper
                      canDecrease={data !== null && dailyGoalHours > DAILY_GOAL_HOURS.min}
                      canIncrease={data !== null && dailyGoalHours < DAILY_GOAL_HOURS.max}
                      hint={`From ${DAILY_GOAL_HOURS.min} to ${DAILY_GOAL_HOURS.max} hours`}
                      label="daily goal"
                      onDecrease={() => changeGoal("daily", -1)}
                      onIncrease={() => changeGoal("daily", 1)}
                      theme={theme}
                      value={`${dailyGoalHours}h`}
                    />
                  }
                  divider={false}
                  subtitle="Fills the hour cells on Today"
                  testID="settings-daily-goal"
                  theme={theme}
                  title="Daily goal"
                />
                <SettingsBlockRow
                  control={
                    <SettingsStepper
                      canDecrease={data !== null && weeklyGoalHours > WEEKLY_GOAL_HOURS.min}
                      canIncrease={data !== null && weeklyGoalHours < WEEKLY_GOAL_HOURS.max}
                      hint={`From ${WEEKLY_GOAL_HOURS.min} to ${WEEKLY_GOAL_HOURS.max} hours, in steps of ${WEEKLY_GOAL_HOURS.step}`}
                      label="weekly goal"
                      onDecrease={() => changeGoal("weekly", -1)}
                      onIncrease={() => changeGoal("weekly", 1)}
                      theme={theme}
                      value={`${weeklyGoalHours}h`}
                    />
                  }
                  testID="settings-weekly-goal"
                  theme={theme}
                  title="Weekly goal"
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup theme={theme} title="Activities">
                <SettingsBlockRow
                  divider={false}
                  onPress={() => openSettingsSection("categories")}
                  subtitle={`${pinnedCategoryCount} in quick start`}
                  testID="settings-activities"
                  theme={theme}
                  title="Activities"
                  value={String(categoryCount)}
                />
                <SettingsActivityStrip activities={data?.categories ?? []} theme={theme} />
              </SettingsBlockGroup>

              <SettingsBlockGroup
                foot="Dayframe only logs on its own at places you trust."
                theme={theme}
                title="Automatic tracking"
              >
                <SettingsBlockRow
                  divider={false}
                  onPress={() => openSettingsSection("automations")}
                  subtitle={locationAccessSummary}
                  testID="settings-location"
                  theme={theme}
                  title="Location"
                />
                <SettingsBlockRow
                  control={
                    <SettingsSwitch
                      accessibilityHint="Saves your choice for this account. Location access is set separately."
                      disabled={locationDiagnostics === null}
                      label="Suggest visits and commutes"
                      onValueChange={toggleLocationLearning}
                      theme={theme}
                      value={locationDiagnostics?.locationLearningEnabled ?? false}
                    />
                  }
                  subtitle={locationSuggestionsSummary}
                  testID="settings-location-suggestions"
                  theme={theme}
                  title="Suggest visits and commutes"
                />
                {/* UIA-086: Motion & Fitness is a status with its own action, not a page. */}
                <SettingsBlockRow
                  control={motionFitness?.action ? (
                    <SettingsPillButton
                      label={motionFitness.action.label}
                      onPress={() => void handleMotionFitnessAction()}
                      theme={theme}
                    />
                  ) : undefined}
                  subtitle={motionFitness?.label ?? "Checking…"}
                  testID="settings-motion"
                  theme={theme}
                  title="Motion & Fitness"
                />
                <SettingsBlockRow
                  onPress={() => router.push("./places")}
                  testID="settings-places"
                  theme={theme}
                  title="Saved places"
                  value={String(data?.places.length ?? 0)}
                />
                <SettingsBlockRow
                  control={nudgePermission === "denied" ? (
                    <SettingsPillButton
                      accessibilityLabel="Open iPhone Settings to allow notifications"
                      label="Open Settings"
                      onPress={() => void Linking.openSettings()}
                      theme={theme}
                    />
                  ) : (
                    <SettingsSwitch
                      disabled={reviewNudge === null || nudgeBusy}
                      label="Evening reminder"
                      onValueChange={(enabled) => void toggleReviewNudge(enabled)}
                      theme={theme}
                      value={reviewNudgeOn}
                    />
                  )}
                  subtitle={nudgePermission === "denied" ? "Notifications are off in iPhone Settings" : "When suggestions are waiting"}
                  testID="settings-review-nudge"
                  theme={theme}
                  title="Evening reminder"
                />
                {reviewNudgeOn && reviewNudge ? (
                  <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
                    <SettingsBlockRow
                      control={
                        <SettingsStepper
                          canDecrease={!nudgeBusy && reviewNudge.minutes > REVIEW_NUDGE_MINUTES.min}
                          canIncrease={!nudgeBusy && reviewNudge.minutes < REVIEW_NUDGE_MINUTES.max}
                          hint={`From ${formatReviewNudgeTime(REVIEW_NUDGE_MINUTES.min)} to ${formatReviewNudgeTime(REVIEW_NUDGE_MINUTES.max)}, in half hours`}
                          label="reminder time"
                          onDecrease={() => void changeReviewNudge((owner) => setReviewNudgeMinutes(owner, reviewNudge.minutes - REVIEW_NUDGE_MINUTES.step))}
                          onIncrease={() => void changeReviewNudge((owner) => setReviewNudgeMinutes(owner, reviewNudge.minutes + REVIEW_NUDGE_MINUTES.step))}
                          theme={theme}
                          value={formatReviewNudgeTime(reviewNudge.minutes)}
                        />
                      }
                      testID="settings-review-nudge-time"
                      theme={theme}
                      title="Time"
                    />
                  </Reanimated.View>
                ) : null}
              </SettingsBlockGroup>

              <SettingsBlockGroup theme={theme} title="Apple Health">
                <SettingsBlockRow
                  control={
                    <SettingsSwitch
                      disabled={healthImportPreferences === null || healthAvailability?.status === "unavailable"}
                      label="Sleep"
                      onValueChange={(enabled) => void setSleepImport(enabled)}
                      theme={theme}
                      value={healthImportPreferences?.sleep ?? false}
                    />
                  }
                  divider={false}
                  subtitle={healthAvailability?.status === "unavailable"
                    ? "Apple Health isn't available on this device"
                    : healthImportPreferences?.sleep && healthPermissionStatus && healthPermissionStatus.status !== "available"
                      ? "Allow sleep in the Health app to import it"
                      : "Becomes a Sleep block you confirm"}
                  testID="settings-health-sleep"
                  theme={theme}
                  title="Sleep"
                />
                <SettingsBlockRow
                  onPress={() => openSettingsSection("health")}
                  subtitle="Choose which ones become blocks"
                  testID="settings-health-workouts"
                  theme={theme}
                  title="Workouts and walks"
                  value={healthWorkoutSummary}
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup theme={theme} title="Appearance">
                <SettingsBlockRow
                  control={
                    <SettingsSegmented
                      label="Theme"
                      onChange={setThemePreference}
                      options={SETTINGS_THEME_OPTIONS}
                      theme={theme}
                      value={themePreference}
                    />
                  }
                  divider={false}
                  testID="settings-theme"
                  theme={theme}
                  title="Theme"
                />
                <SettingsBlockRow
                  control={
                    <SettingsSwitch
                      label="Haptics"
                      onValueChange={(enabled) => {
                        void setHapticsEnabled(enabled).catch(() => undefined);
                      }}
                      theme={theme}
                      value={hapticsEnabled}
                    />
                  }
                  testID="settings-haptics"
                  theme={theme}
                  title="Haptics"
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup
                foot="Health and precise location stay private to your account."
                theme={theme}
                title="Privacy and data"
              >
                {/* UIA-080: export lives on the web (every block, activity and place as a file). */}
                <SettingsBlockRow
                  accessibilityHint="Opens Dayframe's export in Safari"
                  divider={false}
                  onPress={() => void openOnWeb("/settings#privacy-data")}
                  subtitle="Every block, activity and place"
                  testID="settings-export-data"
                  theme={theme}
                  title="Export your data"
                />
                <SettingsBlockRow
                  danger
                  onPress={confirmDeleteLocationEvidence}
                  subtitle="Recent location points. Logged blocks stay."
                  testID="settings-clear-location"
                  theme={theme}
                  title="Clear recent location history"
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup theme={theme} title="Help">
                <SettingsBlockRow
                  control={<SettingsStatusDot attention={syncNeedsAttention} theme={theme} />}
                  divider={false}
                  // The same plain status as Sync help: never queue internals or a past action's text.
                  subtitle={syncStatus.indexDetail}
                  testID="settings-sync-status"
                  theme={theme}
                  title={syncStatus.indexTitle}
                />
                <SettingsBlockRow
                  onPress={() => openSettingsSection("sync")}
                  testID="settings-sync-help"
                  theme={theme}
                  title="Something not syncing?"
                />
                <SettingsBlockRow
                  accessibilityHint="Walks through location, motion and the other permissions again"
                  onPress={() => router.push({ pathname: "/onboarding", params: { from: "settings" } })}
                  testID="settings-setup-again"
                  theme={theme}
                  title="Set up Dayframe again"
                />
              </SettingsBlockGroup>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: signingOut, busy: signingOut }}
                disabled={signingOut}
                onPress={signOut}
                style={({ pressed }) => [styles.settingsSignOut, pressed ? styles.buttonPressed : null]}
                testID="settings-sign-out"
              >
                <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.signOut} size={18} />
                <Text {...mobileTextProps("control")} style={styles.settingsSignOutText}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </Text>
              </Pressable>
              <Text {...mobileTextProps("metadata")} style={styles.settingsFooter}>
                Dayframe {Constants.expoConfig?.version ?? ""} · {workspaceLabel}
              </Text>
            </View>
          ) : null}

          {settingsSection === "categories" ? (
            <View style={styles.settingsBlocksStack}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setActivityEditor({ activity: null })}
                style={({ pressed }) => [styles.settingsNewActivity, pressed ? styles.buttonPressed : null]}
                testID="activities-new"
              >
                <DayframeIcon color={theme.onAccent} glyph={DAYFRAME_APP_ICONS.add} size={18} />
                <Text {...mobileTextProps("control")} style={styles.settingsNewActivityText}>New activity</Text>
              </Pressable>

              {activitiesPageGroups(data?.categories ?? []).map((group) => (
                <SettingsBlockGroup key={group.key} theme={theme} title={group.title}>
                  {group.rows.map((category, index) => {
                    const colors = blockColorsFor(category.color, theme.mode, category.name);
                    const week = formatActivityWeek(activityWeekSeconds.get(category.id) ?? 0);
                    return (
                      <View
                        key={category.id}
                        style={[styles.settingsActivityRow, index > 0 ? styles.settingsActivityRowDivider : null]}
                      >
                        <Pressable
                          accessibilityHint="Edits this activity"
                          accessibilityLabel={`${category.name}, ${week}`}
                          accessibilityRole="button"
                          onPress={() => setActivityEditor({ activity: category })}
                          style={({ pressed }) => [styles.settingsActivityOpen, pressed ? styles.buttonPressed : null]}
                          testID={`activities-row-${category.id}`}
                        >
                          <View style={[styles.settingsActivityBlock, { backgroundColor: colors.fill }]}>
                            <ActivityIcon color={colors.text} icon={category.icon} name={category.name} size={18} />
                          </View>
                          <View style={styles.settingsActivityText}>
                            <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{category.name}</Text>
                            <Text {...mobileTextProps("metadata")} style={styles.settingsActivityMeta}>{week}</Text>
                          </View>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={category.isPinned ? `Remove ${category.name} from quick start` : `Add ${category.name} to quick start`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: category.isPinned }}
                          onPress={() => void toggleCategoryPin(category)}
                          style={({ pressed }) => [
                            styles.settingsActivityPin,
                            category.isPinned ? styles.settingsActivityPinOn : null,
                            pressed ? styles.buttonPressed : null
                          ]}
                          testID={`activities-pin-${category.id}`}
                        >
                          <DayframeIcon
                            color={category.isPinned ? theme.textPrimary : theme.textMuted}
                            glyph={DAYFRAME_APP_ICONS.pin}
                            size={18}
                          />
                        </Pressable>
                      </View>
                    );
                  })}
                </SettingsBlockGroup>
              ))}
              {archivedActivities?.length ? (
                <SettingsBlockGroup foot="Archived activities keep their history. Restoring brings one back unpinned." theme={theme} title="Archived">
                  {archivedActivities.map((category, index) => {
                    const colors = blockColorsFor(category.color, theme.mode, category.name);
                    return (
                      <View
                        key={category.id}
                        style={[styles.settingsActivityRow, index > 0 ? styles.settingsActivityRowDivider : null]}
                        testID={`activities-archived-${category.id}`}
                      >
                        <View style={styles.settingsActivityOpen}>
                          <View style={[styles.settingsActivityBlock, styles.settingsActivityBlockArchived, { backgroundColor: colors.fill }]}>
                            <ActivityIcon color={colors.text} icon={category.icon} name={category.name} size={18} />
                          </View>
                          <View style={styles.settingsActivityText}>
                            <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={styles.settingsActivityName}>{category.name}</Text>
                            <Text {...mobileTextProps("metadata")} style={styles.settingsActivityMeta}>History kept</Text>
                          </View>
                        </View>
                        <SettingsPillButton
                          accessibilityLabel={`Restore ${category.name}`}
                          label="Restore"
                          onPress={() => void restoreArchivedActivity(category)}
                          theme={theme}
                        />
                      </View>
                    );
                  })}
                </SettingsBlockGroup>
              ) : null}
              <Text {...mobileTextProps("metadata")} style={styles.settingsFooter}>
                Pinned activities fill the Start tiles on Today. Quick start holds {QUICK_START_PIN_LIMIT}.
              </Text>
            </View>
          ) : null}

          {settingsSection === "profile" ? (
            <View style={styles.settingsBlocksStack}>
              <SettingsBlockGroup
                foot="Edit your name, password or workspace on the web."
                theme={theme}
                title="Signed in as"
              >
                <SettingsBlockRow
                  divider={false}
                  subtitle={data?.user.email ?? null}
                  testID="settings-account-user"
                  theme={theme}
                  title={data?.user.name || data?.user.email || "Your account"}
                />
                <SettingsBlockRow
                  // A row without onPress shows no value column, so the name is the subtitle.
                  subtitle={workspaceLabel}
                  testID="settings-account-workspace"
                  theme={theme}
                  title="Workspace"
                />
                {/* UIA-084: the footnote's "on the web" is one tap away. */}
                <SettingsBlockRow
                  accessibilityHint="Opens Dayframe in Safari"
                  onPress={() => void openOnWeb("/settings")}
                  testID="settings-account-open-web"
                  theme={theme}
                  title="Open Dayframe on the web"
                />
              </SettingsBlockGroup>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: signingOut, busy: signingOut }}
                disabled={signingOut}
                onPress={signOut}
                style={({ pressed }) => [styles.settingsSignOut, pressed ? styles.buttonPressed : null]}
                testID="settings-account-sign-out"
              >
                <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.signOut} size={18} />
                <Text {...mobileTextProps("control")} style={styles.settingsSignOutText}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {settingsSection === "sync" ? (
            <View style={styles.settingsBlocksStack}>
              <SettingsBlockGroup theme={theme} title="Status">
                <SettingsBlockRow
                  control={<SettingsStatusDot attention={syncNeedsAttention} theme={theme} />}
                  divider={false}
                  subtitle={syncHelpNote || syncStatus.detail}
                  testID="sync-help-status"
                  theme={theme}
                  title={syncStatus.title}
                />
              </SettingsBlockGroup>

              {syncStatus.issueCount > 0 ? (
                <SettingsBlockGroup
                  foot="Try again resends it. Discard keeps your account as it is."
                  theme={theme}
                  title="Needs attention"
                >
                  {timerStopSyncIssues.map((issue, index) => (
                    <SettingsIssueRow
                      detail={`Stopped ${formatQueueTime(issue.failedAt ?? issue.queuedAt)}. Dayframe couldn't save the Stop, so your account still shows the timer running.`}
                      divider={index > 0}
                      key={issue.clientEventId}
                      theme={theme}
                      title="Couldn't stop the timer"
                    >
                      <SettingsPillButton accessibilityLabel="Try stopping the timer again" label="Try again" onPress={() => retryTimerStopIssue(issue.clientEventId)} theme={theme} />
                      <SettingsPillButton accessibilityLabel="Discard this Stop" danger label="Discard" onPress={() => confirmDiscardTimerStopIssue(issue.clientEventId)} theme={theme} />
                    </SettingsIssueRow>
                  ))}
                  {timeEntrySyncIssues.map((issue, index) => (
                    <SettingsIssueRow
                      detail={`From ${formatQueueTime(issue.updatedAt)}. Dayframe couldn't save it, so your account keeps the earlier version.`}
                      divider={timerStopSyncIssues.length + index > 0}
                      key={issue.clientCommandId}
                      theme={theme}
                      title={issue.operation === "delete" ? "Couldn't delete a block" : "Couldn't save an edit"}
                    >
                      <SettingsPillButton accessibilityLabel={`Try the ${issue.operation === "delete" ? "delete" : "edit"} again`} label="Try again" onPress={() => retryTimeEntryIssue(issue.clientCommandId)} theme={theme} />
                      <SettingsPillButton accessibilityLabel={`Discard this ${issue.operation === "delete" ? "delete" : "edit"}`} danger label="Discard" onPress={() => confirmDiscardTimeEntryIssue(issue.clientCommandId)} theme={theme} />
                    </SettingsIssueRow>
                  ))}
                  {reviewSyncIssues.map((issue, index) => (
                    <SettingsIssueRow
                      detail={issue.resolutionStatus === "resolution_unknown"
                        ? `Saved ${formatQueueTime(issue.createdAt)}. Dayframe is still checking whether it reached your account; your choice is kept.`
                        : `From ${formatQueueTime(issue.createdAt)}. Dayframe couldn't save it.`}
                      divider={timerStopSyncIssues.length + timeEntrySyncIssues.length + index > 0}
                      key={issue.clientMutationId}
                      theme={theme}
                      title={issue.resolutionStatus === "resolution_unknown"
                        ? `${formatReviewMutationAction(issue.action)} · checking`
                        : `Couldn't ${formatReviewMutationAction(issue.action).toLowerCase()}`}
                    >
                      <SettingsPillButton
                        accessibilityLabel="Try this Review choice again"
                        label="Try again"
                        onPress={() => void synchroniseReviewMutations({ force: true, clientMutationId: issue.clientMutationId })
                          .then((result) => {
                            if (result.outcome === "transport_failure" || result.outcome === "server_busy") {
                              setSyncHelpNote("Couldn't check yet. Your choice is kept.");
                            }
                            return refreshReviewDiagnostics();
                          })
                          .catch(() => setSyncHelpNote("Couldn't check yet. Your choice is kept."))}
                        theme={theme}
                      />
                      {issue.resolutionStatus !== "resolution_unknown" ? (
                        <SettingsPillButton accessibilityLabel="Discard this Review choice" danger label="Discard" onPress={() => confirmDiscardReviewIssue(issue.clientMutationId)} theme={theme} />
                      ) : null}
                    </SettingsIssueRow>
                  ))}
                  {queueDiagnostics.permanentFailedCount > 0 ? (
                    <SettingsIssueRow
                      // Items still retrying on their own are only "waiting" (background, AGENTS rule);
                      // this row is for items the server will not accept as they are.
                      detail={`${queueDiagnostics.permanentFailedCount} ${queueDiagnostics.permanentFailedCount === 1 ? "item" : "items"} from this iPhone couldn't be saved. Updating Dayframe and trying again may help; clearing removes ${queueDiagnostics.permanentFailedCount === 1 ? "it" : "them"} from this iPhone.`}
                      divider={timerStopSyncIssues.length + timeEntrySyncIssues.length + reviewSyncIssues.length > 0}
                      theme={theme}
                      title="Couldn't be sent"
                    >
                      <SettingsPillButton accessibilityLabel="Try sending these again" disabled={!canRetryFailed} label="Try again" onPress={retryFailedAndReload} theme={theme} />
                      <SettingsPillButton accessibilityLabel="Clear items that can't be sent" danger disabled={!canClearFailed} label="Clear" onPress={confirmClearFailedQueue} theme={theme} />
                    </SettingsIssueRow>
                  ) : null}
                  {(timeEntrySyncDiagnostics?.quarantinedCount ?? 0) > 0 || (timeEntrySyncDiagnostics?.deviceQuarantinedCount ?? 0) > 0 ? (
                    <SettingsIssueRow
                      detail="Some saved changes on this iPhone couldn't be read, so Dayframe set them aside. Clearing them removes only those unreadable copies."
                      divider={timerStopSyncIssues.length + timeEntrySyncIssues.length + reviewSyncIssues.length + (queueDiagnostics.permanentFailedCount > 0 ? 1 : 0) > 0}
                      theme={theme}
                      title="Unreadable saved changes"
                    >
                      {(timeEntrySyncDiagnostics?.quarantinedCount ?? 0) > 0 ? (
                        <SettingsPillButton accessibilityLabel="Clear unreadable saved changes for this account" danger label="Clear" onPress={confirmClearTimeEntryQuarantine} theme={theme} />
                      ) : null}
                      {(timeEntrySyncDiagnostics?.deviceQuarantinedCount ?? 0) > 0 ? (
                        <SettingsPillButton accessibilityLabel="Clear unreadable saved changes on this iPhone" danger label="Clear for this iPhone" onPress={confirmClearDeviceTimeEntryQuarantine} theme={theme} />
                      ) : null}
                    </SettingsIssueRow>
                  ) : null}
                </SettingsBlockGroup>
              ) : null}

              <SettingsBlockGroup theme={theme} title="If something looks wrong">
                <SettingsBlockRow
                  accessibilityHint="Sends anything waiting on this iPhone and refreshes"
                  divider={false}
                  onPress={() => void syncAndReload().then((result) => {
                    // Lane failures come back as outcomes, not errors.
                    const unreachable = !result || Object.values(result.lanes).some(
                      (lane) => lane.outcome === "transport_failure" || lane.outcome === "server_busy"
                    );
                    setSyncHelpNote(unreachable ? "Couldn't reach Dayframe. Your changes are kept and send on their own." : null);
                  })}
                  subtitle={syncingQueue ? "Sending…" : "Safe to do any time"}
                  testID="sync-help-send"
                  theme={theme}
                  title="Try sending again"
                />
                <SettingsBlockRow
                  onPress={exportQueueDiagnostics}
                  subtitle="App version and sync details, to send to support"
                  testID="sync-help-copy"
                  theme={theme}
                  title="Copy details for support"
                />
                <SettingsBlockRow
                  onPress={() => void shareLocationDiagnostics()}
                  subtitle="How location capture is running, without places or points"
                  testID="sync-help-location"
                  theme={theme}
                  title="Share location details"
                />
                <SettingsBlockRow
                  onPress={() => void exportAppleHealthDebug()}
                  subtitle={exportingHealthDebug ? "Preparing…" : "Includes your Apple Health samples. Share only with support."}
                  testID="sync-help-health"
                  theme={theme}
                  title="Share Apple Health details"
                />
              </SettingsBlockGroup>
            </View>
          ) : null}

          {settingsSection === "automations" ? (
            <View style={styles.settingsBlocksStack}>
              <SettingsBlockGroup
                foot="Always access lets Dayframe notice visits while it's closed. iOS can still pause it at times."
                theme={theme}
                title="Access"
              >
                <SettingsBlockRow
                  control={
                    <SettingsPillButton
                      accessibilityLabel={`${locationActionLabel} location access`}
                      label={locationActionLabel}
                      onPress={() => void enableLocation()}
                      theme={theme}
                    />
                  }
                  divider={false}
                  subtitle={locationAccessSummary}
                  testID="location-access"
                  theme={theme}
                  title="Location"
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup theme={theme} title="Suggestions">
                <SettingsBlockRow
                  control={
                    <SettingsSwitch
                      // Consent for this account, separate from the iOS permission above.
                      accessibilityHint="Saves your choice for this account. Location access is set separately."
                      disabled={locationDiagnostics === null}
                      label="Suggest visits and commutes"
                      onValueChange={toggleLocationLearning}
                      theme={theme}
                      value={locationDiagnostics?.locationLearningEnabled ?? false}
                    />
                  }
                  divider={false}
                  subtitle={locationSuggestionsDetail}
                  testID="location-suggestions"
                  theme={theme}
                  title="Suggest visits and commutes"
                />
                <SettingsBlockRow
                  control={motionFitness?.action ? (
                    <SettingsPillButton
                      label={motionFitness.action.label}
                      onPress={() => void handleMotionFitnessAction()}
                      theme={theme}
                    />
                  ) : undefined}
                  subtitle={motionFitness ? `${motionFitness.label} · ${motionFitness.detail}` : "Checking…"}
                  testID="location-motion"
                  theme={theme}
                  title="Motion & Fitness"
                />
                <SettingsBlockRow
                  onPress={() => setLocationInfoSheet("suggestions")}
                  testID="location-how-it-works"
                  theme={theme}
                  title="How suggestions work"
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup
                foot="Dayframe only logs on its own at places you trust. Anything else waits in Review."
                theme={theme}
                title="Places"
              >
                <SettingsBlockRow
                  divider={false}
                  onPress={() => router.push("./places")}
                  testID="location-saved-places"
                  theme={theme}
                  title="Saved places"
                  value={String(data?.places.length ?? 0)}
                />
              </SettingsBlockGroup>

              <SettingsBlockGroup
                foot="Location stays private to your account. Recent points on this iPhone expire after seven days; upload copies can stay longer, even after they are sent. Signing out clears them all."
                theme={theme}
                title="Privacy"
              >
                <SettingsBlockRow
                  danger
                  divider={false}
                  onPress={confirmDeleteLocationEvidence}
                  subtitle="Recent location points. Logged blocks stay."
                  testID="location-clear-history"
                  theme={theme}
                  title="Clear recent location history"
                />
              </SettingsBlockGroup>
            </View>
          ) : null}

          {settingsSection === "health" ? (
            <View style={styles.settingsBlocksStack}>
              <SettingsBlockGroup
                foot="Each one becomes a block you confirm in Review, or logs itself when Dayframe is sure."
                theme={theme}
                title="Apple Health"
              >
                <SettingsBlockRow
                  control={healthConnected ? undefined : (
                    <SettingsPillButton
                      accessibilityLabel="Connect Apple Health"
                      disabled={healthAvailability?.status === "unavailable"}
                      label="Connect"
                      onPress={() => void connectAppleHealth()}
                      theme={theme}
                    />
                  )}
                  divider={false}
                  subtitle={healthAccessSummary}
                  testID="health-access"
                  theme={theme}
                  title="Access"
                />
                <SettingsBlockRow
                  accessibilityHint="Reads new sleep and workouts from Apple Health now"
                  onPress={() => void syncAppleHealth()}
                  subtitle={syncingQueue ? "Syncing…" : healthSyncNoteText ?? "Dayframe also syncs on its own"}
                  testID="health-sync-now"
                  theme={theme}
                  title="Sync now"
                />
              </SettingsBlockGroup>

              {HEALTH_IMPORT_GROUPS.map((group) => (
                // Opening a type's rows moves the groups below with the shared layout transition.
                <Reanimated.View key={group.title} layout={localLayoutTransition(reduceMotion)}>
                <SettingsBlockGroup theme={theme} title={group.title}>
                  {HEALTH_IMPORT_PREFERENCE_OPTIONS.filter((option) => group.keys.includes(option.key)).map((option, index) => {
                    const enabled = healthImportPreferences?.[option.key] ?? option.defaultEnabled;
                    const mapping = healthAutoLogMappings[option.key] ?? {};
                    const mappedCategory = data?.categories.find((category) => category.id === mapping.categoryId) ?? null;
                    const label = option.key === "other" ? "Other workouts" : option.label;
                    // UIA-085: one row per type; its Logs as and Name live in the type's own sheet.
                    return (
                      <SettingsBlockRow
                        accessibilityHint={`Opens ${label}: the activity it logs to and its name`}
                        control={
                          <SettingsSwitch
                            label={label}
                            onValueChange={(value) => void updateHealthImportPreference(option.key, value)}
                            theme={theme}
                            value={enabled}
                          />
                        }
                        divider={index > 0}
                        key={option.key}
                        onPress={() => setHealthDetailKey(option.key)}
                        subtitle={enabled
                          ? `Logs as ${mappedCategory?.name ?? defaultHealthCategoryLabel(option.key)}`
                          : "Not imported"}
                        testID={`health-type-${option.key}`}
                        theme={theme}
                        title={label}
                      />
                    );
                  })}
                </SettingsBlockGroup>
                </Reanimated.View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {activityEditor ? (
        <ActivityEditorSheet
          activities={data?.categories ?? []}
          activity={activityEditor.activity}
          defaultColor={nextCategoryColor(data?.categories ?? [])}
          pinnedCount={(data?.categories ?? []).filter((category) => category.isPinned).length}
          pinReady={activityPinsFresh()}
          onArchive={archiveActivityFromEditor}
          onClose={() => {
            setActivityEditor(null);
            activityEditorClosed();
          }}
          onSave={(draft) => saveActivityFromEditor(activityEditor.activity, draft)}
          reduceMotion={reduceMotion}
          styles={styles}
          theme={theme}
        />
      ) : null}
      {locationInfoSheet === "suggestions" ? (
        <BlocksInfoSheet
          eyebrow="Location"
          note={LOCATION_SUGGESTIONS_PRIVACY}
          onClose={() => setLocationInfoSheet(null)}
          reduceMotion={reduceMotion}
          rows={LOCATION_SUGGESTION_ROWS}
          styles={styles}
          testID="location-suggestions-info"
          theme={theme}
          title="How suggestions work"
        />
      ) : null}
      {healthDetailKey ? (
        <HealthTypeSheet
          categories={data?.categories ?? []}
          enabled={healthImportPreferences?.[healthDetailKey]
            ?? HEALTH_IMPORT_PREFERENCE_OPTIONS.find((option) => option.key === healthDetailKey)?.defaultEnabled
            ?? false}
          healthKey={healthDetailKey}
          label={healthDetailKey === "other"
            ? "Other workouts"
            : HEALTH_IMPORT_PREFERENCE_OPTIONS.find((option) => option.key === healthDetailKey)?.label ?? "Workout"}
          mapping={healthAutoLogMappings[healthDetailKey] ?? {}}
          onClose={() => {
            setHealthPickerKey(null);
            setHealthDetailKey(null);
          }}
          onEnabledChange={(value) => void updateHealthImportPreference(healthDetailKey, value)}
          onMappingChange={(patch) => updateHealthAutoLogMapping(healthDetailKey, patch)}
          onPickActivity={() => setHealthPickerKey(healthDetailKey)}
          reduceMotion={reduceMotion}
          styles={styles}
          theme={theme}
        >
          {/* The activity picker opens over the type's sheet. */}
          {healthPickerKey ? (
            <ActivityPickerSheet
              activities={data?.categories ?? []}
              onClose={() => setHealthPickerKey(null)}
              onPick={(activityId) => void updateHealthAutoLogMapping(healthPickerKey, { categoryId: activityId })}
              recentIds={[]}
              reduceMotion={reduceMotion}
              selectedId={healthAutoLogMappings[healthPickerKey]?.categoryId ?? null}
              styles={styles}
              theme={theme}
            />
          ) : null}
        </HealthTypeSheet>
      ) : null}
      {settingsNotice.notice ? (
        <BlocksToast
          key={settingsNotice.notice.token}
          message={settingsNotice.notice.message}
          reduceMotion={reduceMotion}
          style={styles.blocksToastOverlay}
          swatchColor={settingsNotice.notice.swatchColor}
          testID="settings-notice-toast"
          theme={theme}
        />
      ) : null}
      <BlocksConfirmHost controller={confirmSheet} reduceMotion={reduceMotion} styles={styles} theme={theme} />
    </SafeAreaView>
  );
}

let healthNameDraftVersion = 0;
function nextHealthNameDraftVersion() {
  healthNameDraftVersion += 1;
  return healthNameDraftVersion;
}

/**
 * One Apple Health type's settings (UIA-085): the import switch, the activity it logs to (Use
 * default once mapped) and the name its blocks get. The activity picker opens over it.
 */
function HealthTypeSheet({
  categories,
  children,
  enabled,
  healthKey,
  label,
  mapping,
  onClose,
  onEnabledChange,
  onMappingChange,
  onPickActivity,
  reduceMotion,
  styles,
  theme
}: {
  categories: readonly { id: string; name: string }[];
  children?: ReactNode;
  enabled: boolean;
  healthKey: HealthImportPreferenceKey;
  label: string;
  mapping: HealthAutoLogMapping;
  onClose: () => void;
  onEnabledChange: (value: boolean) => void;
  onMappingChange: (patch: HealthAutoLogMapping) => Promise<boolean>;
  onPickActivity: () => void;
  reduceMotion: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const { height: windowHeight } = useWindowDimensions();
  const mappedCategory = categories.find((category) => category.id === mapping.categoryId) ?? null;
  // Name is a draft saved once: when editing ends, or when the sheet starts to leave by any way
  // (Close, backdrop, swipe, accessibility escape), so a focused edit is never lost.
  const [nameDraft, setNameDraftState] = useState(mapping.description ?? "");
  const draftRef = useRef(mapping.description ?? "");
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  function setNameDraft(value: string) {
    draftRef.current = value;
    setNameDraftState(value);
  }
  // Until the person types, the field follows the Name the writer shows (a change still on its
  // way when this sheet opened), so closing an untouched sheet never commits an older Name.
  const typedRef = useRef(false);
  // Every edit gets an app-wide draft version, so a failed commit can tell whether anything was
  // typed after it — even text that happens to match the failed Name.
  const versionRef = useRef(nextHealthNameDraftVersion());
  const shownName = mapping.description ?? "";
  useEffect(() => {
    if (!typedRef.current && draftRef.current !== shownName) setNameDraft(shownName);
  }, [shownName]);
  function typeName(value: string) {
    typedRef.current = true;
    versionRef.current = nextHealthNameDraftVersion();
    setNameDraft(value);
  }
  // The Name is written by the app's one Health mapping writer, queued with this type's other
  // changes. From the moment this sheet opens it is told when a Name fails; it puts the saved Name
  // back only when nothing was typed after that commit, then follows the writer again.
  useEffect(() => healthMappingWriter.attach(healthKey, (savedName, _failedName, token) => {
    if (token !== undefined && token === versionRef.current) {
      // Back to what the writer shows now: the saved Name with any later queued Name over it
      // (an identical commit still on its way keeps the field on it).
      typedRef.current = false;
      // An empty Name is a Name (a queued clear); only a missing snapshot falls back to the saved one.
      const shown = healthMappingWriter.shown();
      setNameDraft(shown ? shown[healthKey]?.description ?? "" : savedName);
    }
  }), [healthKey]);
  function commitName() {
    void healthMappingWriter.commitName(healthKey, draftRef.current, versionRef.current);
  }
  return (
    <Modal
      animationType="none"
      onRequestClose={() => sheetRef.current?.dismiss()}
      presentationStyle="overFullScreen"
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.sheetOverlay}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel={label}
          backdropAccessibilityLabel={`Close ${label}`}
          backdropStyle={styles.sheetBackdrop}
          handleStyle={styles.sheetHandle}
          onDismiss={onClose}
          onDismissStart={() => {
            // Leaving: save the Name draft once and make the sheet inert, so a late tap (Logs as)
            // can't present the picker over a sheet that is going away.
            if (!closingRef.current) {
              closingRef.current = true;
              setClosing(true);
              commitName();
            }
          }}
          reduceMotion={reduceMotion}
          // Tall like the activity editor, so the scroll view can lift Name above the keyboard.
          style={[styles.activeEditSheet, { height: Math.round(windowHeight * 0.7) }]}
          visible
        >
          <View
            accessibilityElementsHidden={closing}
            importantForAccessibility={closing ? "no-hide-descendants" : "auto"}
            pointerEvents={closing ? "none" : "auto"}
            style={{ flex: 1, minHeight: 0 }}
          >
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text {...mobileTextProps("metadata")} style={styles.muted}>APPLE HEALTH</Text>
              <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={styles.sheetTitle}>{label}</Text>
            </View>
            <Pressable
              accessibilityLabel={`Close ${label}`}
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => {
                Keyboard.dismiss();
                sheetRef.current?.dismiss();
              }}
            >
              <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.close} size={18} />
            </Pressable>
          </View>
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.activeEditContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            style={styles.activeEditScroller}
          >
            <SettingsBlockGroup
              foot={enabled ? "Each one becomes a block you confirm in Review, or logs itself when Dayframe is sure." : undefined}
              theme={theme}
              title="Import"
            >
              <SettingsBlockRow
                control={<SettingsSwitch label={`Import ${label}`} onValueChange={onEnabledChange} theme={theme} value={enabled} />}
                divider={false}
                subtitle={enabled ? null : "Not imported"}
                testID={`health-detail-import-${healthKey}`}
                theme={theme}
                title="Import"
              />
              {/* Import on: the type's rows fade in and later rows move (Reduce Motion: no movement). */}
              {enabled ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                <SettingsBlockRow
                  accessibilityHint={`Chooses the activity ${label} logs to`}
                  onPress={() => {
                    if (!closingRef.current) onPickActivity();
                  }}
                  testID={`health-activity-${healthKey}`}
                  theme={theme}
                  title="Logs as"
                  value={mappedCategory?.name ?? `${defaultHealthCategoryLabel(healthKey)} (default)`}
                />
                </Reanimated.View>
              ) : null}
              {enabled && mapping.categoryId ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                >
                <SettingsBlockRow
                  control={
                    <SettingsPillButton
                      accessibilityLabel={`Use the default activity for ${label}`}
                      label="Use default"
                      onPress={() => void onMappingChange({ categoryId: null })}
                      theme={theme}
                    />
                  }
                  subtitle={`Logs as ${defaultHealthCategoryLabel(healthKey)}`}
                  testID={`health-default-${healthKey}`}
                  theme={theme}
                  title="Default activity"
                />
                </Reanimated.View>
              ) : null}
              {enabled ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={[styles.healthNameRow, { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Text {...mobileTextProps("control")} style={styles.healthNameLabel}>Name</Text>
                  <TextInput
                    accessibilityLabel={`${label} name`}
                    {...mobileTextProps("input")}
                    style={styles.healthNameInput}
                    onChangeText={typeName}
                    placeholder={defaultHealthDescription(healthKey)}
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                    testID={`health-name-${healthKey}`}
                    onEndEditing={commitName}
                    value={nameDraft}
                  />
                </Reanimated.View>
              ) : null}
            </SettingsBlockGroup>
          </ScrollView>
          </View>
          {children}
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

/** Settings › Location › How suggestions work (UIA-022). */
const LOCATION_SUGGESTION_ROWS: readonly BlocksInfoRow[] = [
  { glyph: "inbox", lead: "Suggestions wait in Review.", text: "Dayframe notices visits and journeys and shows them as blocks for you to confirm." },
  { glyph: "check", lead: "Only saved places log on their own.", text: "A clear stay at a place you saved can be logged straight away; anything less certain waits in Review." },
  { glyph: "footprints", lead: "Motion helps with trips.", text: "Motion & Fitness tells walking from driving. It stays with your location and never leaves Dayframe." },
  { glyph: "refresh-cw", lead: "iOS may pause updates.", text: "iOS can pause or limit background location, so a movement can be missed." }
];

const LOCATION_SUGGESTIONS_PRIVACY = {
  glyph: "shield" as const,
  text: "Location stays private to your account and is never used for ads or analytics. Recent points on this iPhone expire after seven days; upload copies can stay longer. Signing out clears them all."
};

function normalizeSettingsSection(value: string | string[] | undefined): SettingsSection {
  const section = Array.isArray(value) ? value[0] : value;
  switch (section) {
    case "profile":
    case "categories":
    case "automations":
    case "health":
    case "sync":
      return section;
    default:
      return "index";
  }
}

function nextCategoryColor(categories: Category[]): DayframePaletteKey {
  const paletteKeys = new Set(DAYFRAME_PALETTE.map((color) => color.key));
  const usedKeys = new Set(
    categories
      .map((category) => category.color)
      .filter((color): color is DayframePaletteKey => paletteKeys.has(color as DayframePaletteKey))
  );
  const unused = DAYFRAME_PALETTE.find((color) => !usedKeys.has(color.key));
  return unused?.key ?? DAYFRAME_PALETTE[categories.length % DAYFRAME_PALETTE.length].key;
}

function locationStatusText(diagnostics: LocationVisitDiagnostics) {
  if (diagnostics.locationLearningCaptureState === "logout_cleanup") return "Location is paused. Sign out again to finish signing out.";
  if (diagnostics.foregroundPermission !== "granted") return "Location permission is not enabled.";
  if (diagnostics.backgroundPermission !== "granted") return "Enable Always access to monitor saved places.";
  if (!diagnostics.locationLearningEnabled) return "Location access is allowed. Turn on commute and regular-place learning to capture.";
  if (!diagnostics.locationLearningActive) return "Location is allowed but not running. Tap Restart location to start it.";
  if (diagnostics.geofencingActive && diagnostics.activeMonitorCount > 0) return "Place monitoring is enabled.";
  return "Location learning is enabled. No saved-place monitors are active.";
}

const HEALTH_IMPORT_GROUPS: readonly { title: string; keys: readonly HealthImportPreferenceKey[] }[] = [
  { title: "Sleep", keys: ["sleep"] },
  { title: "Workouts and walks", keys: ["walking", "running", "cycling", "strength_training", "swimming", "other"] }
];

function defaultHealthCategoryLabel(type: HealthImportPreferenceKey) {
  return type === "sleep" ? "Sleep" : "Health";
}

function defaultHealthDescription(type: HealthImportPreferenceKey) {
  return HEALTH_IMPORT_PREFERENCE_OPTIONS.find((option) => option.key === type)?.label ?? "Health activity";
}

function formatReviewMutationAction(value: string) {
  switch (value) {
    case "accept":
    case "confirm":
      return "Log a moment";
    case "ignore_once":
    case "ignore_once_location":
      return "Skip a moment";
    case "edit_and_confirm":
      return "Log an edited moment";
    default:
      return "Save a Review choice";
  }
}

function formatQueueTime(value?: Date | string) {
  if (!value) return "unknown time";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
