import { readOwnedAuthenticatedSessionSnapshot, isAuthenticatedSessionSnapshotCurrent } from "@/lib/secure-session";
import { mobileBuildDiagnostics } from "@/lib/mobileBuildDiagnostics";
import { supportQueueDiagnostics } from "@/lib/supportSyncDiagnostics";
import { readActiveMobileAccount, mobileAccountOwnersEqual } from "@/lib/mobileAccount";
import { synchroniseDeviceNow, getLastManualSyncResult } from "@/lib/manualSyncRuntime";
import { manualSyncSummary } from "@/lib/syncCoordinator";
import { createOwnerSyncCoalescer } from "@/lib/ownerSyncCoalescer";
import { subscribeRecoveredDashboardBootstrap } from "@/lib/dashboardBootstrapChannel";
import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import {
  Alert,
  AppState,
  findNodeHandle,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import Reanimated from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
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
import { setHapticsEnabled, useHapticsPreference } from "@/lib/haptics";
import {
  DAYFRAME_PALETTE,
  DAYFRAME_PALETTE_PICKER,
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
  getHealthAutoLogMappings,
  getHealthImportPreferences,
  getHealthImportStatus,
  HEALTH_IMPORT_PREFERENCE_OPTIONS,
  reprocessExistingHealthReviewItems,
  requestHealthKitPermissions,
  setHealthAutoLogMapping,
  setHealthImportPreference,
  type HealthImportStatus
} from "@/lib/health";
import {
  pressable,
  themeOptions,
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
import { mobileTextProps } from "@/lib/mobileTypography";
import { createGoalSaver, publishSavedTimeGoals, type TimeGoals } from "@/lib/settingsGoals";
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
import { recordMobileLayout, recordMobileTextLayout } from "@/components/accessibility/diagnostics";
import type { MobileAccessibilityDiagnostic } from "@/components/accessibility/diagnostics";
import { drainNativeShortcutQueue, syncShortcutCatalog } from "@/lib/shortcuts";
import {
  configureLocationIntelligence,
  getNativeLocationIntelligenceStatus
} from "@/lib/location/runtime";
import {
  getLocationStoreDiagnostics,
  recordLocationStoreError,
  type LocationStoreDiagnostics
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

type Category = MobileBootstrap["categories"][number];
// Settings › Your day goal ranges (hours): daily in 1 h steps, weekly in 5 h steps.
const DAILY_GOAL_HOURS = { min: 1, max: 14, step: 1 } as const;
const WEEKLY_GOAL_HOURS = { min: 5, max: 80, step: 5 } as const;
const GOAL_SAVE_DELAY_MS = 600;
// D1: the same theme names on iPhone and web.
const SETTINGS_THEME_OPTIONS = [
  { label: "Midnight", value: "dark" },
  { label: "Daylight", value: "light" },
  { label: "System", value: "system" }
] as const;

type SettingsSection = "index" | "profile" | "categories" | "automations" | "health" | "sync" | "appearance";
type SettingsIcon = "profile" | "categories" | "automations" | "health" | "sync" | "appearance" | "review";

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
  syncStatusMessage: string | null;
  locationStatus: string;
  locationDiagnostics: LocationVisitDiagnostics | null;
  healthStatus: HealthImportStatus[];
  healthImportPreferences: HealthImportPreferences | null;
  healthAutoLogMappings: HealthAutoLogMappings;
  updatedAt: number;
  healthUpdatedAt: number;
};

let cachedSettingsSnapshot: SettingsSnapshot | null = null;
const CATEGORY_EDITOR_KEYBOARD_CLEARANCE = 360;

function defaultSettingsSnapshot(): SettingsSnapshot {
  return {
    data: null,
    queue: [],
    lastSyncResult: null,
    syncStatusMessage: null,
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
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const routeSettingsSection = normalizeSettingsSection(params.section);
  const settingsSection = routeSettingsSection;
  const cachedSnapshot = readSettingsSnapshot();
  const [data, setData] = useState<MobileBootstrap | null>(cachedSnapshot?.data ?? null);
  const [queue, setQueue] = useState<QueuedEvent[]>(cachedSnapshot?.queue ?? []);
  const [lastSyncResult, setLastSyncResult] = useState<SyncQueueResult | null>(cachedSnapshot?.lastSyncResult ?? null);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(cachedSnapshot?.syncStatusMessage ?? null);
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
  const [showLocationTroubleshooting, setShowLocationTroubleshooting] = useState(false);
  const [locationInfoSheet, setLocationInfoSheet] = useState<"places" | "suggestions" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [locationStatus, setLocationStatus] = useState(cachedSnapshot?.locationStatus ?? "Not requested");
  const [locationDiagnostics, setLocationDiagnostics] = useState<LocationVisitDiagnostics | null>(
    cachedSnapshot?.locationDiagnostics ?? null
  );
  const [motionFitnessStatus, setMotionFitnessStatus] = useState<DayframeMotionAuthorizationStatus | null>(null);
  const [locationV2Diagnostics, setLocationV2Diagnostics] = useState<LocationStoreDiagnostics | null>(null);
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
  const [healthDebugStatus, setHealthDebugStatus] = useState<string | null>(null);
  const [exportingHealthDebug, setExportingHealthDebug] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState<DayframePaletteKey>("lime");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [pinNewCategory, setPinNewCategory] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryColor, setEditingCategoryColor] = useState("lime");
  const refreshes = useRef(createOwnerSyncCoalescer<void>());
  const categoryEditRef = useRef<TextInput>(null);
  const newCategoryInputRef = useRef<TextInput>(null);
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
    setShowLocationTroubleshooting(false);
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

  const setSyncStatusMessageAndCache = useCallback((action: SetStateAction<string | null>) => {
    setSyncStatusMessage((current) => {
      const next = resolveStateAction(action, current);
      updateSettingsSnapshot({ syncStatusMessage: next });
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
    // The local queue has one guarded reader (refreshQueueLatest): it publishes whether or not the
    // bootstrap below succeeds, and never after Settings closed or the account changed.
    void refreshQueueLatest();
    try {
      await drainNativeShortcutQueue();
      const [bootstrap, location] = await Promise.all([
        fetchBootstrap(),
        getLocationVisitDiagnostics()
      ]);
      const nextLocationStatus = locationStatusText(location);
      updateSettingsSnapshot({
        data: bootstrap,
        locationDiagnostics: location,
        locationStatus: nextLocationStatus,
        updatedAt: Date.now()
      });
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

  useEffect(() => subscribeRecoveredDashboardBootstrap(event => {
    if (event.type === "completed") setDataAndCache(event.bootstrap);
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
      if (!isSettingsSnapshotFresh()) void load({ silent: true, trigger: "focus" });
    }, [load, reloadThemePreference])
  );

  useEffect(() => {
    if (settingsSection !== "index" && settingsSection !== "health") return;
    if (settingsSection === "index" && isSettingsHealthSnapshotFresh()) return;

    getHealthImportStatus().then(setHealthStatusAndCache).catch(() => {
      setHealthStatusAndCache([
        {
          provider: "healthkit",
          status: "error",
          notes: "Unable to check Apple Health status."
        }
      ]);
    });
    getHealthImportPreferences().then(setHealthImportPreferencesAndCache).catch(() => undefined);
    getHealthAutoLogMappings().then(setHealthAutoLogMappingsAndCache).catch(() => undefined);
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
  const sleepStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "sleep");
  const workoutStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "workout");
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
  const locationActionLabel = locationCaptureNeedsRetry ? "Retry capture" : locationMonitoringAllowed
    ? "Refresh"
    : locationDiagnostics?.foregroundPermission === "denied"
      ? "Review access"
      : "Enable";
  const backgroundAccessSummary = locationMonitoringAllowed ? "On" : "Needs attention";
  const motionFitness = motionFitnessStatus
    ? motionFitnessPresentation(motionFitnessStatus, locationDiagnostics?.locationLearningEnabled === true)
    : null;
  const settingsTitle = settingsSectionTitle(settingsSection);
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

  const revealCategoryCreator = useCallback(() => {
    requestAnimationFrame(() => {
      settingsScrollRef.current?.scrollToEnd({ animated: !reduceMotion });
    });
  }, [reduceMotion]);

  const revealCategoryEditor = useCallback(() => {
    requestAnimationFrame(() => {
      const inputHandle = findNodeHandle(categoryEditRef.current);
      if (inputHandle === null) return;
      settingsScrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        inputHandle,
        CATEGORY_EDITOR_KEYBOARD_CLEARANCE,
        true
      );
    });
  }, []);

  useEffect(() => {
    if (!editingCategoryId) return undefined;

    const focusTimer = setTimeout(() => {
      categoryEditRef.current?.focus();
      revealCategoryEditor();
    }, 50);

    return () => clearTimeout(focusTimer);
  }, [editingCategoryId, revealCategoryEditor]);

  useEffect(() => {
    if (
      settingsSection !== "categories" ||
      (!creatingCategory && !editingCategoryId)
    ) return undefined;

    const revealFocusedEditor = creatingCategory ? revealCategoryCreator : revealCategoryEditor;
    revealFocusedEditor();
    const keyboardSubscription = Keyboard.addListener("keyboardDidShow", revealFocusedEditor);
    return () => keyboardSubscription.remove();
  }, [
    creatingCategory,
    editingCategoryId,
    revealCategoryCreator,
    revealCategoryEditor,
    settingsSection
  ]);

  function beginCreateCategory() {
    if (!creatingCategory) {
      if (!newCategoryName.trim()) {
        setNewCategoryColor(nextCategoryColor(data?.categories ?? []));
      }
      setCreatingCategory(true);
    }
    if (editingCategoryId) {
      setEditingCategoryId(null);
      setEditingCategoryName("");
      setEditingCategoryColor("lime");
    }
    revealCategoryCreator();
  }

  function cancelCreateCategory() {
    setCreatingCategory(false);
    setNewCategoryName("");
    setNewCategoryColor(nextCategoryColor(data?.categories ?? []));
    setPinNewCategory(true);
    Keyboard.dismiss();
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await createCategory(name, { color: newCategoryColor, isPinned: pinNewCategory });
      setCreatingCategory(false);
      setNewCategoryName("");
      setPinNewCategory(true);
      Keyboard.dismiss();
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      Alert.alert("Activities", error instanceof Error ? error.message : "Unable to create activity.");
    }
  }

  function beginEditCategory(category: Category) {
    setCreatingCategory(false);
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategoryColor(category.color);
  }

  function cancelEditCategory() {
    setEditingCategoryId(null);
    setEditingCategoryName("");
    setEditingCategoryColor("lime");
  }

  async function saveCategoryEdit(category: Category) {
    const name = editingCategoryName.trim();
    if (!name) {
      Alert.alert("Activities", "Activity name is required.");
      return;
    }
    try {
      await updateCategory(category.id, {
        name,
        color: editingCategoryColor
      });
      cancelEditCategory();
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      Alert.alert("Activities", error instanceof Error ? error.message : "Unable to save activity.");
    }
  }

  async function toggleCategoryPin(category: Category) {
    const nextPinned = !category.isPinned;
    patchCategory(category.id, { isPinned: nextPinned });
    try {
      const result = await updateCategory(category.id, { isPinned: nextPinned });
      if (result.category.isPinned !== nextPinned) {
        throw new Error("The activity pin was not saved. Check that the Dayframe server is up to date, then try again.");
      }
      await load({ silent: true });
    } catch (error) {
      patchCategory(category.id, { isPinned: category.isPinned });
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      Alert.alert("Activities", error instanceof Error ? error.message : "Unable to update activity.");
    }
  }

  function confirmDeleteCategory(category: Category) {
    Alert.alert(
      "Delete activity",
      `Delete ${category.name}? Existing time entries keep their history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteSelectedCategory(category);
          }
        }
      ]
    );
  }

  async function deleteSelectedCategory(category: Category) {
    try {
      await archiveCategory(category.id);
      if (editingCategoryId === category.id) cancelEditCategory();
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return;
      }
      Alert.alert("Activities", error instanceof Error ? error.message : "Unable to delete activity.");
    }
  }

  async function syncAndReload(options?: { syncingMessage?: string }) {
    setSyncingQueue(true);
    setSyncStatusMessageAndCache(options?.syncingMessage ?? "Syncing device data...");
    try {
      const result = await synchroniseDeviceNow({ date: data?.dateRange?.selectedDate });
      await refreshQueueLatest();
      setSyncStatusMessageAndCache(manualSyncSummary(result));
      await Promise.all([refreshReviewDiagnostics(), refreshLocationV2Diagnostics(), refreshTimeEntryDiagnostics(), refreshTimerStopDiagnostics()]);
      return result;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        finishSignedOutNavigation();
        return null;
      }
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to sync queued events.");
      return null;
    } finally {
      setSyncingQueue(false);
    }
  }

  function confirmDiscardReviewIssue(clientMutationId: string) {
    Alert.alert(
      "Discard saved Review change?",
      "This removes only the permanently failed local Review change. Pending changes are not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void discardReviewSyncIssue(clientMutationId).then(
              () => { void refreshReviewDiagnostics().catch(() => undefined); },
              () => setSyncHelpNote("Couldn't discard that change. Nothing was removed.")
            );
          }
        }
      ]
    );
  }

  function confirmDiscardTimeEntryIssue(clientCommandId: string) {
    Alert.alert(
      "Discard failed time entry change?",
      "The server version is already restored. This removes the rejected local change from diagnostics.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void discardTimeEntrySyncIssue(clientCommandId).then(
              () => { void refreshTimeEntryDiagnostics().catch(() => undefined); },
              () => setSyncHelpNote("Couldn't discard that change. Nothing was removed.")
            );
          }
        }
      ]
    );
  }

  function retryTimeEntryIssue(clientCommandId: string) {
    // Only the retry itself failing gets the note; a failed refresh afterwards is retried by the
    // diagnostics subscription.
    void retryTimeEntrySyncIssue(clientCommandId).then(
      (retried) => {
        void refreshTimeEntryDiagnostics().catch(() => undefined);
        if (retried) setSyncStatusMessageAndCache("Retrying the saved time entry change...");
      },
      () => setSyncHelpNote("Couldn't retry that change. It's still saved on this iPhone.")
    );
  }

  function confirmDiscardTimerStopIssue(clientEventId: string) {
    Alert.alert(
      "Discard rejected timer Stop?",
      "The server timer will stay unchanged. This removes only the rejected Stop saved on this iPhone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard Stop",
          style: "destructive",
          onPress: () => {
            void discardTimerStopSyncIssue(clientEventId).then(
              () => { void refreshTimerStopDiagnostics().catch(() => undefined); },
              () => setSyncHelpNote("Couldn't discard that Stop. Nothing was removed.")
            );
          }
        }
      ]
    );
  }

  function retryTimerStopIssue(clientEventId: string) {
    // Only the retry itself failing gets the note; a failed refresh afterwards is retried by the
    // diagnostics subscription.
    void retryTimerStopSyncIssue(clientEventId).then(
      (retried) => {
        void refreshTimerStopDiagnostics().catch(() => undefined);
        if (retried) setSyncStatusMessageAndCache("Retrying the saved timer Stop...");
      },
      () => setSyncHelpNote("Couldn't retry that Stop. It's still saved on this iPhone.")
    );
  }

  function confirmClearTimeEntryQuarantine() {
    Alert.alert(
      "Clear unreadable local sync data?",
      "These records cannot be replayed. Clearing them removes only quarantined diagnostics.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearTimeEntryOutboxQuarantine().then(
              () => { void refreshTimeEntryDiagnostics().catch(() => undefined); },
              () => setSyncHelpNote("Couldn't clear those records. Nothing was removed.")
            );
          }
        }
      ]
    );
  }

  function confirmClearDeviceTimeEntryQuarantine() {
    Alert.alert(
      "Clear unreadable device-wide sync data?",
      "The damaged data has no recoverable account owner and cannot be replayed. Clearing it removes only device-wide quarantine diagnostics.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearDeviceTimeEntryOutboxQuarantine().then(
              () => { void refreshTimeEntryDiagnostics().catch(() => undefined); },
              () => setSyncHelpNote("Couldn't clear those records. Nothing was removed.")
            );
          }
        }
      ]
    );
  }

  async function retryFailedAndReload() {
    setSyncingQueue(true);
    setSyncStatusMessageAndCache("Retrying failed items...");
    try {
      const result = await retryFailedQueuedEvents();
      await refreshQueueLatest();
      setLastSyncResultAndCache(result);
      setSyncStatusMessageAndCache(null);
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
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to retry failed events.");
      setSyncHelpNote("Couldn't retry those items. They're still saved on this iPhone.");
    } finally {
      setSyncingQueue(false);
    }
  }

  function confirmClearFailedQueue() {
    Alert.alert(
      "Clear failed queued events",
      "Failed queued events that Dayframe has marked invalid will be removed from this device. Queued events that are still retryable will stay queued.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear failed",
          style: "destructive",
          onPress: () => {
            void clearFailedQueue();
          }
        }
      ]
    );
  }

  async function clearFailedQueue() {
    try {
      const result = await clearFailedQueuedEvents();
      await refreshQueueLatest();
      setLastSyncResultAndCache(null);
      setSyncStatusMessageAndCache(
        `${result.removedCount} failed queued ${result.removedCount === 1 ? "event was" : "events were"} removed. ${result.remainingCount} queued ${result.remainingCount === 1 ? "event remains" : "events remain"}.`
      );
      await load({ silent: true });
    } catch (error) {
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to clear failed events.");
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
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to export queue diagnostics.");
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
      const [local, native] = await Promise.all([
        getLocationStoreDiagnostics(),
        getNativeLocationIntelligenceStatus().catch(() => null)
      ]);
      if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) return;
      if (session?.status === "authenticated" && !isAuthenticatedSessionSnapshotCurrent(session.snapshot)) return;
      setLocationV2Diagnostics(local);
      setNativeLocationStatus(native);
    } catch (error) {
      await recordLocationStoreError(error);
    }
  }

  function confirmDeleteLocationEvidence() {
    Alert.alert(
      "Clear recent location history?",
      "Removes recent location points from this iPhone and from your account. Logged blocks, saved places and Review items stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear history",
          style: "destructive",
          onPress: () => { void removeLocationEvidence(); }
        }
      ]
    );
  }

  async function removeLocationEvidence() {
    try {
      const result = await deleteRecentLocationEvidence();
      await refreshLocationV2Diagnostics();
      Alert.alert(
        "Location evidence deleted",
        `Removed ${result.localDeletedEvidenceCount} local and ${result.deletedEvidenceCount} server evidence items. Derived entries were kept.`
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
      if (permissions.status === "available") {
        const preferences = healthImportPreferences ?? await getHealthImportPreferences();
        const kinds = healthAutomaticCategoryKinds(preferences);
        if (kinds.length > 0) await ensureAutomaticLoggingCategories(kinds);
        await syncAppleHealth({ silent: true });
      }
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health permission"));
    }
  }

  async function syncAppleHealth(options?: { silent?: boolean }) {
    try {
      setSyncStatusMessageAndCache("Syncing Health data...");
      await syncAndReload({ syncingMessage: "Syncing Health data..." });
      setHealthStatusAndCache(await getHealthImportStatus());
    } catch (error) {
      if (error instanceof AuthRequiredError) return;
      const message = friendlyHealthKitError(error, "sync Apple Health");
      setSyncStatusMessageAndCache(message);
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

  async function updateHealthAutoLogMapping(type: HealthImportPreferenceKey, patch: HealthAutoLogMapping) {
    const current = healthAutoLogMappings;
    const nextMapping = {
      ...(current[type] ?? {}),
      ...patch
    };
    const optimistic = { ...current };
    if (nextMapping.categoryId || nextMapping.description) {
      optimistic[type] = nextMapping;
    } else {
      delete optimistic[type];
    }
    setHealthAutoLogMappingsAndCache(optimistic);
    try {
      const saved = await setHealthAutoLogMapping(type, nextMapping);
      setHealthAutoLogMappingsAndCache(saved);
      const preferences = healthImportPreferences ?? await getHealthImportPreferences();
      await reprocessExistingHealthReviewItems(preferences, { force: true, mappings: saved });
      await load({ silent: true });
    } catch (error) {
      setHealthAutoLogMappingsAndCache(current);
      Alert.alert("Apple Health", error instanceof Error ? error.message : "Unable to save Health mapping.");
    }
  }

  async function exportAppleHealthDebug() {
    setExportingHealthDebug(true);
    setHealthDebugStatus("Preparing Health debug export...");
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
      setHealthDebugStatus(summary);
    } catch (error) {
      const message = friendlyHealthKitError(error, "export Health debug data");
      setHealthDebugStatus(message);
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
    setDataAndCache((current) => {
      if (!current) return current;
      return {
        ...current,
        categories: current.categories.map((category) =>
          category.id === id ? { ...category, ...patch } : category
        )
      };
    });
  }

  async function signOut() {
    // A goal change still waiting is saved while the session is valid.
    goalSaver.flush();
    const diagnostics = await getReviewSyncDiagnostics();
    const unsynchronisedCount =
      diagnostics.waitingCount + diagnostics.needsAttentionCount;
    const reviewWarning = unsynchronisedCount > 0
      ? `${unsynchronisedCount} unsynchronised Review ${unsynchronisedCount === 1 ? "change" : "changes"} will be removed from this iPhone. `
      : "";
    Alert.alert(
      "Log out and remove saved changes?",
      `${reviewWarning}Unsynchronised Location evidence will be removed from this iPhone. Synced history stays in your account.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Log out", style: "destructive", onPress: () => { void completeSignOut(); } }
      ]
    );
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
        "Unable to log out",
        error instanceof Error ? error.message : "Dayframe could not finish logging out."
      );
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ gestureEnabled: !signingOut }} />
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            accessibilityState={{ disabled: signingOut }}
            disabled={signingOut}
            style={pressable(styles.iconButton, styles.buttonPressed)}
            onPress={goBack}
          >
            <BackGlyph color={theme.accent} />
          </Pressable>
          <Text {...mobileTextProps("screenHeading")} style={styles.settingsTitle}>{settingsTitle}</Text>
        </View>
      </View>
      <ScrollView
        key={settingsSection}
        ref={settingsScrollRef}
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios" && settingsSection === "categories"}
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps={settingsSection === "categories" ? "always" : "handled"}
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
            onRefresh={() => load({ trigger: "pull" })}
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
                <SettingsBlockRow
                  onPress={() => openSettingsSection("automations")}
                  subtitle={motionFitness?.label ?? null}
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
                <SettingsBlockRow
                  danger
                  divider={false}
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
              </SettingsBlockGroup>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: signingOut, busy: signingOut }}
                disabled={signingOut}
                onPress={signOut}
                style={({ pressed }) => [styles.settingsSignOut, pressed ? styles.buttonPressed : null]}
                testID="settings-sign-out"
              >
                <Text {...mobileTextProps("control")} style={styles.settingsSignOutText}>
                  {signingOut ? "Signing out…" : "Sign out"}
                </Text>
              </Pressable>
              <Text {...mobileTextProps("metadata")} style={styles.settingsFooter}>
                Dayframe {Constants.expoConfig?.version ?? ""} · {workspaceLabel}
              </Text>
            </View>
          ) : null}

          {settingsSection === "appearance" ? (
            <View style={styles.appearanceStack}>
              <Text {...mobileTextProps("body")} style={styles.appearanceIntro}>Choose how Dayframe follows your iPhone.</Text>
              <View style={styles.segmentedControl}>
                {themeOptions.map((option) => {
                  const selected = option.value === themePreference;
                  return (
                    <Pressable
                      accessibilityLabel={`${option.label} theme`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={option.value}
                      style={pressable(
                        [styles.segmentButton, selected ? styles.segmentButtonSelected : null],
                        styles.buttonPressed
                      )}
                      onPress={() => setThemePreference(option.value)}
                    >
                      <Text {...mobileTextProps("control")} style={[styles.segmentButtonText, selected ? styles.segmentButtonTextSelected : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.appearanceSelectionCard}>
                <Text {...mobileTextProps("itemTitle")} style={styles.appearanceSelectionTitle}>
                  {themePreference === "system" ? "System" : themePreference === "light" ? "Light" : "Dark"}
                </Text>
                <Text {...mobileTextProps("body")} style={styles.appearanceSelectionMeta}>
                  {themePreference === "system"
                    ? "Automatically matches iOS appearance."
                    : themePreference === "light"
                      ? "Uses the designed light companion throughout Dayframe."
                      : "Uses Midnight Core throughout Dayframe."}
                </Text>
              </View>

              <Text {...mobileTextProps("sectionHeading")} style={styles.appearanceSectionLabel}>Feedback</Text>
              <View style={styles.healthPreferenceRow}>
                <View style={styles.healthPreferenceHeader}>
                  <View style={styles.healthPreferenceText}>
                    <Text {...mobileTextProps("itemTitle")} style={styles.categoryName}>Haptics</Text>
                    <Text {...mobileTextProps("body")} style={styles.categoryMeta}>
                      A tap you can feel when you start, stop, delete or undo. Your iPhone's System Haptics setting still applies.
                    </Text>
                  </View>
                  <Switch
                    style={{ flexShrink: 0 }}
                    accessibilityLabel="Haptics"
                    value={hapticsEnabled}
                    onValueChange={(enabled) => {
                      void setHapticsEnabled(enabled).catch(() => undefined);
                    }}
                    trackColor={{ false: theme.borderStrong, true: theme.accent }}
                    thumbColor={hapticsEnabled ? theme.onAccent : theme.surfaceRaised}
                    ios_backgroundColor={theme.borderStrong}
                  />
                </View>
              </View>

              <Text {...mobileTextProps("sectionHeading")} style={styles.appearanceSectionLabel}>Preview</Text>
              <View style={styles.appearancePreviewRow}>
                <AppearancePreviewCard mode="light" selected={themePreference === "light"} styles={styles} />
                <AppearancePreviewCard mode="dark" selected={themePreference === "dark"} styles={styles} />
              </View>

              <Text {...mobileTextProps("sectionHeading")} style={styles.appearanceSectionLabel}>Display details</Text>
              <View style={styles.appearanceDetailsCard}>
                <View style={styles.appearanceDetailRow}>
                  <Text {...mobileTextProps("itemTitle")} style={styles.appearanceDetailTitle}>Midnight Core</Text>
                  <Text {...mobileTextProps("metadata")} style={styles.appearanceDetailMeta}>Always preserved</Text>
                </View>
                <View style={[styles.appearanceDetailRow, styles.appearanceDetailDivider]}>
                  <Text {...mobileTextProps("itemTitle")} style={styles.appearanceDetailTitle}>Colour logo</Text>
                  <Text {...mobileTextProps("metadata")} style={styles.appearanceDetailMeta}>Never recoloured</Text>
                </View>
              </View>
            </View>
          ) : null}

          {settingsSection === "categories" ? (
          <View style={styles.panel}>
            <View style={styles.categoryList}>
              {(data?.categories ?? []).map((category) => {
                const categoryColor = paletteColorFor(category.color, category.name, theme.mode);
                const editing = editingCategoryId === category.id;

                if (editing) {
                  return (
                    <Reanimated.View
                      key={category.id}
                      entering={localPresenceEntering(reduceMotion)}
                      exiting={localPresenceExiting(reduceMotion)}
                      layout={localLayoutTransition(reduceMotion)}
                      onLayout={revealCategoryEditor}
                      style={styles.categoryEditCard}
                    >
                      <View style={styles.categoryEditHeader}>
                        <View
                          style={[
                            styles.colorDot,
                            { backgroundColor: paletteColorFor(editingCategoryColor, category.name, theme.mode) }
                          ]}
                        />
                        <TextInput
                          ref={categoryEditRef}
                          accessibilityLabel="Activity name"
                          {...mobileTextProps("input")}
                          style={[styles.textInput, styles.categoryEditInput]}
                          value={editingCategoryName}
                          onChangeText={setEditingCategoryName}
                          placeholder="Activity name"
                          placeholderTextColor={theme.textSecondary}
                          returnKeyType="done"
                          onSubmitEditing={() => saveCategoryEdit(category)}
                        />
                      </View>
                      <CategoryColorPicker
                        selectedColor={editingCategoryColor}
                        onSelect={setEditingCategoryColor}
                        styles={styles}
                        theme={theme}
                      />
                      <View style={styles.buttonRow}>
                        <Pressable
                          accessibilityRole="button"
                          style={pressable(styles.secondaryButton, styles.buttonPressed)}
                          onPress={cancelEditCategory}
                        >
                          <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`Delete ${category.name}`}
                          accessibilityRole="button"
                          style={pressable(styles.secondaryButton, styles.buttonPressed)}
                          onPress={() => confirmDeleteCategory(category)}
                        >
                          <Text {...mobileTextProps("control")} style={styles.activeEditDeleteText}>Delete</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          style={pressable(styles.primaryInlineButton, styles.buttonPressed)}
                          onPress={() => saveCategoryEdit(category)}
                        >
                          <Text {...mobileTextProps("control")} style={styles.primaryButtonText}>Save</Text>
                        </Pressable>
                      </View>
                    </Reanimated.View>
                  );
                }

                return (
                  <Reanimated.View
                    key={category.id}
                    layout={localLayoutTransition(reduceMotion)}
                    style={[styles.categoryRow, category.isPinned ? styles.categoryRowPinned : null]}
                  >
                    <Pressable
                      accessibilityLabel={`Edit ${category.name}`}
                      accessibilityRole="button"
                      onPress={() => beginEditCategory(category)}
                      style={pressable(styles.categoryRowMain, styles.buttonPressed)}
                    >
                      <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
                      <View style={styles.categoryTextStack}>
                    <Text {...mobileTextProps("itemTitle")} style={styles.categoryName}>{category.name}</Text>
                        <Text {...mobileTextProps("metadata")} style={[styles.categoryMeta, category.isPinned ? styles.categoryMetaPinned : null]}>
                          {category.isPinned ? "Pinned" : "Unpinned"}
                        </Text>
                      </View>
                    </Pressable>
                    <View style={styles.categoryActions}>
                      <Pressable
                        accessibilityLabel={category.isPinned ? `Unpin ${category.name}` : `Pin ${category.name}`}
                        accessibilityRole="button"
                        style={pressable(
                          [
                            styles.categoryIconButton,
                            category.isPinned ? styles.categoryIconButtonSelected : null
                          ],
                          styles.buttonPressed
                        )}
                        onPress={() => toggleCategoryPin(category)}
                      >
                        {category.isPinned ? (
                          <PinGlyph color={theme.accentText} />
                        ) : (
                          <PinOffGlyph color={theme.textSecondary} />
                        )}
                      </Pressable>
                    </View>
                  </Reanimated.View>
                );
              })}
            </View>
            <Reanimated.View
              layout={localLayoutTransition(reduceMotion)}
              onLayout={creatingCategory ? revealCategoryCreator : undefined}
              style={creatingCategory ? styles.categoryEditCard : null}
            >
              <View style={styles.categoryCreateRow}>
                {creatingCategory ? (
                  <View
                    style={[
                      styles.colorDot,
                      { backgroundColor: paletteColorFor(newCategoryColor, newCategoryName, theme.mode) }
                    ]}
                  />
                ) : null}
                <TextInput
                  ref={newCategoryInputRef}
                  accessibilityLabel="New activity name"
                  {...mobileTextProps("input")}
                  style={[styles.textInput, styles.categoryCreateInput]}
                  value={newCategoryName}
                  onChangeText={setNewCategoryName}
                  onFocus={beginCreateCategory}
                  onSubmitEditing={addCategory}
                  placeholder="New activity"
                  placeholderTextColor={theme.textSecondary}
                  returnKeyType="done"
                />
                {!creatingCategory ? (
                  <>
                    <Pressable
                      accessibilityLabel={pinNewCategory ? "Create as pinned activity" : "Create as unpinned activity"}
                      accessibilityRole="button"
                      accessibilityState={{ selected: pinNewCategory }}
                      style={pressable(
                        [styles.categoryIconButton, pinNewCategory ? styles.categoryIconButtonSelected : null],
                        styles.buttonPressed
                      )}
                      onPress={() => setPinNewCategory((current) => !current)}
                    >
                      {pinNewCategory ? (
                        <PinGlyph color={theme.accentText} />
                      ) : (
                        <PinOffGlyph color={theme.textSecondary} />
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Create activity"
                      accessibilityRole="button"
                      disabled={!newCategoryName.trim()}
                      style={({ pressed }) => [
                        styles.categoryIconButtonPrimary,
                        pressed && newCategoryName.trim() ? styles.buttonPressed : null,
                        !newCategoryName.trim() ? styles.buttonDisabled : null
                      ]}
                      onPress={addCategory}
                    >
                      <PlusGlyph color={theme.onAccent} />
                    </Pressable>
                  </>
                ) : null}
              </View>
              {creatingCategory ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  layout={localLayoutTransition(reduceMotion)}
                  style={styles.categoryCreateDetails}
                >
                  <CategoryColorPicker
                    selectedColor={newCategoryColor}
                    onSelect={setNewCategoryColor}
                    styles={styles}
                    theme={theme}
                  />
                  <View style={styles.buttonRow}>
                    <Pressable
                      accessibilityRole="button"
                      style={pressable(styles.secondaryButton, styles.buttonPressed)}
                      onPress={cancelCreateCategory}
                    >
                      <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={pinNewCategory ? "New activity pinned" : "New activity unpinned"}
                      accessibilityRole="button"
                      accessibilityState={{ selected: pinNewCategory }}
                      style={pressable(
                        [styles.secondaryButton, styles.categoryCreatePinButton],
                        styles.buttonPressed
                      )}
                      onPress={() => setPinNewCategory((current) => !current)}
                    >
                      {pinNewCategory ? (
                        <PinGlyph color={theme.accentText} />
                      ) : (
                        <PinOffGlyph color={theme.textSecondary} />
                      )}
                      <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>
                        {pinNewCategory ? "Pinned" : "Unpinned"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!newCategoryName.trim()}
                      style={({ pressed }) => [
                        styles.primaryInlineButton,
                        pressed && newCategoryName.trim() ? styles.buttonPressed : null,
                        !newCategoryName.trim() ? styles.buttonDisabled : null
                      ]}
                      onPress={addCategory}
                    >
                      <Text {...mobileTextProps("control")} style={styles.primaryButtonText}>Create</Text>
                    </Pressable>
                  </View>
                </Reanimated.View>
              ) : null}
            </Reanimated.View>
          </View>
          ) : null}

          {settingsSection === "profile" ? (
          <View style={styles.panel}>
            <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Account</Text>
            {data?.user || data?.workspace ? (
              <View style={styles.accountList}>
                {data.user ? (
                  <View style={styles.accountRow}>
                    <Text {...mobileTextProps("metadata")} style={styles.label}>Signed in as</Text>
                    <Text {...mobileTextProps("body")} style={styles.accountValue}>
                      {data.user.name || data.user.email}
                    </Text>
                    <Text {...mobileTextProps("body")} style={styles.accountMeta}>{data.user.email}</Text>
                  </View>
                ) : null}
                {data.workspace ? (
                  <View style={styles.accountRow}>
                    <Text {...mobileTextProps("metadata")} style={styles.label}>Workspace</Text>
                    <Text {...mobileTextProps("body")} style={styles.accountValue}>{data.workspace.name}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityState={{ disabled: signingOut }}
                disabled={signingOut}
                style={pressable(
                  [styles.secondaryButton, signingOut ? styles.buttonDisabled : null],
                  styles.buttonPressed
                )}
                onPress={signOut}
              >
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>
                  {signingOut ? "Logging out..." : "Log out"}
                </Text>
              </Pressable>
            </View>
          </View>
          ) : null}

          {settingsSection === "automations" ? (
          <>
          <View style={styles.panel}>
            <View style={styles.healthPreferenceHeader}>
              <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Places</Text>
              <InfoButton
                accessibilityLabel="About saved places"
                onPress={() => setLocationInfoSheet("places")}
                styles={styles}
                theme={theme}
              />
            </View>
            <Text {...mobileTextProps("body")} style={styles.muted}>Save locations Dayframe should recognise.</Text>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
                onPress={() => router.push("./places")}
              >
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Manage places</Text>
              </Pressable>
            </View>
          </View>
          </>
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
                  foot="Retry sends a change again. Discard keeps what your account already has."
                  theme={theme}
                  title="Needs attention"
                >
                  {timerStopSyncIssues.map((issue, index) => (
                    <SettingsIssueRow
                      detail={`Stopped ${formatQueueTime(issue.failedAt ?? issue.queuedAt)}. The server didn't accept it, so the timer still shows as running there.`}
                      divider={index > 0}
                      key={issue.clientEventId}
                      theme={theme}
                      title="Timer stop not accepted"
                    >
                      <SettingsPillButton accessibilityLabel="Retry rejected timer Stop" label="Retry" onPress={() => retryTimerStopIssue(issue.clientEventId)} theme={theme} />
                      <SettingsPillButton accessibilityLabel="Discard rejected timer Stop" danger label="Discard" onPress={() => confirmDiscardTimerStopIssue(issue.clientEventId)} theme={theme} />
                    </SettingsIssueRow>
                  ))}
                  {timeEntrySyncIssues.map((issue, index) => (
                    <SettingsIssueRow
                      detail={`Saved ${formatQueueTime(issue.updatedAt)}. The server didn't accept it, so your account keeps the earlier version.`}
                      divider={timerStopSyncIssues.length + index > 0}
                      key={issue.clientCommandId}
                      theme={theme}
                      title={issue.operation === "delete" ? "Delete not accepted" : "Edit not accepted"}
                    >
                      <SettingsPillButton accessibilityLabel={`Retry rejected ${issue.operation === "delete" ? "delete" : "edit"}`} label="Retry" onPress={() => retryTimeEntryIssue(issue.clientCommandId)} theme={theme} />
                      <SettingsPillButton accessibilityLabel={`Discard rejected ${issue.operation === "delete" ? "delete" : "edit"}`} danger label="Discard" onPress={() => confirmDiscardTimeEntryIssue(issue.clientCommandId)} theme={theme} />
                    </SettingsIssueRow>
                  ))}
                  {reviewSyncIssues.map((issue, index) => (
                    <SettingsIssueRow
                      detail={issue.resolutionStatus === "resolution_unknown"
                        ? `Saved ${formatQueueTime(issue.createdAt)}. Dayframe is still checking whether it reached your account; your choice is kept.`
                        : `Saved ${formatQueueTime(issue.createdAt)}. The server didn't accept this Review choice.`}
                      divider={timerStopSyncIssues.length + timeEntrySyncIssues.length + index > 0}
                      key={issue.clientMutationId}
                      theme={theme}
                      title={issue.resolutionStatus === "resolution_unknown"
                        ? `${formatReviewMutationAction(issue.action)} · checking`
                        : `${formatReviewMutationAction(issue.action)} not accepted`}
                    >
                      <SettingsPillButton
                        accessibilityLabel="Check saved Review change again"
                        label="Check again"
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
                        <SettingsPillButton accessibilityLabel="Discard rejected Review change" danger label="Discard" onPress={() => confirmDiscardReviewIssue(issue.clientMutationId)} theme={theme} />
                      ) : null}
                    </SettingsIssueRow>
                  ))}
                  {queueDiagnostics.permanentFailedCount > 0 ? (
                    <SettingsIssueRow
                      // Items still retrying on their own are only "waiting" (background, AGENTS rule);
                      // this row is for items the server will not accept as they are.
                      detail={`${queueDiagnostics.permanentFailedCount} ${queueDiagnostics.permanentFailedCount === 1 ? "item" : "items"} from this iPhone can't be accepted as ${queueDiagnostics.permanentFailedCount === 1 ? "it is" : "they are"}. Updating Dayframe and retrying may help; clearing removes ${queueDiagnostics.permanentFailedCount === 1 ? "it" : "them"} from this iPhone.`}
                      divider={timerStopSyncIssues.length + timeEntrySyncIssues.length + reviewSyncIssues.length > 0}
                      theme={theme}
                      title="Couldn't be sent"
                    >
                      <SettingsPillButton accessibilityLabel="Retry sending items from this iPhone" disabled={!canRetryFailed} label="Retry" onPress={retryFailedAndReload} theme={theme} />
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
              </SettingsBlockGroup>
            </View>
          ) : null}

          {settingsSection === "automations" ? (
          <View style={styles.panel}>
            <View style={styles.healthPreferenceHeader}>
              <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Location suggestions</Text>
              <InfoButton
                accessibilityLabel="How location suggestions work"
                onPress={() => setLocationInfoSheet("suggestions")}
                styles={styles}
                theme={theme}
              />
            </View>
            <View style={styles.healthPreferenceRow}>
              <View style={styles.healthPreferenceHeader}>
                <View style={styles.healthPreferenceText}>
                  <Text {...mobileTextProps("itemTitle")} style={styles.categoryName}>Suggest visits and journeys</Text>
                  <Text {...mobileTextProps("body")} style={styles.categoryMeta}>
                    {locationDiagnostics?.locationLearningCaptureState === "logout_cleanup"
                      ? "Capture is paused. Retry signing out to finish local cleanup."
                      : locationDiagnostics?.locationLearningEnabled && !locationDiagnostics.locationLearningActive
                      ? "Consent is saved. Capture is inactive; retry below."
                      : locationDiagnostics?.locationLearningActive
                      ? "Background location can create suggestions in Review."
                      : "Location suggestions are off."}
                  </Text>
                </View>
                <Switch
                  style={{ flexShrink: 0 }}
                  accessibilityLabel="Commute and regular-place learning"
                  accessibilityHint="Saves consent for this account. Capture status is shown beside this switch."
                  value={locationDiagnostics?.locationLearningEnabled ?? false}
                  onValueChange={toggleLocationLearning}
                  trackColor={{ false: theme.borderStrong, true: theme.accent }}
                  thumbColor={locationDiagnostics?.locationLearningEnabled ? theme.onAccent : theme.surfaceRaised}
                  ios_backgroundColor={theme.borderStrong}
                />
              </View>
            </View>
            <Text {...mobileTextProps("body")} style={styles.statusText}>Background access: {backgroundAccessSummary}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={enableLocation}>
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>{locationActionLabel}</Text>
              </Pressable>
            </View>
            <Reanimated.View layout={localLayoutTransition(reduceMotion)} style={styles.healthPreferenceRow}>
              <View style={styles.healthPreferenceText}>
                <Text {...mobileTextProps("itemTitle")} style={styles.categoryName}>Motion & Fitness</Text>
                <Text {...mobileTextProps("body")} style={styles.categoryMeta}>
                  {motionFitness ? `${motionFitness.label} · ${motionFitness.detail}` : "Checking…"}
                </Text>
              </View>
              {motionFitness?.action ? (
                <Reanimated.View
                  entering={localPresenceEntering(reduceMotion)}
                  exiting={localPresenceExiting(reduceMotion)}
                  style={styles.buttonRow}
                >
                  <Pressable
                    accessibilityRole="button"
                    style={pressable(styles.secondaryButton, styles.buttonPressed)}
                    onPress={() => void handleMotionFitnessAction()}
                  >
                    <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>{motionFitness.action.label}</Text>
                  </Pressable>
                </Reanimated.View>
              ) : null}
            </Reanimated.View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showLocationTroubleshooting }}
              style={pressable(styles.detailsToggle, styles.buttonPressed)}
              onPress={() => {
                setShowLocationTroubleshooting((current) => !current);
              }}
            >
              <Text {...mobileTextProps("control")} style={styles.detailsToggleText}>Privacy & troubleshooting</Text>
              <DisclosureChevronGlyph color={theme.textSecondary} expanded={showLocationTroubleshooting} />
            </Pressable>
            {showLocationTroubleshooting ? (
              <Reanimated.View
                entering={localPresenceEntering(reduceMotion)}
                exiting={localPresenceExiting(reduceMotion)}
                layout={localLayoutTransition(reduceMotion)}
                style={styles.healthPreferenceRow}
              >
                <Text {...mobileTextProps("body")} style={styles.muted}>
                  Location data is private. Motion & Fitness activity (still, walking, driving) is kept with it and never leaves Dayframe. Local journal samples expire after seven days. Upload copies, cached places and summaries can stay on this iPhone longer, even after upload or signing back in. Signing out clears this account’s local Location data; synced entries and saved places stay in your account.
                </Text>
                {([['Evidence upload', locationV2Diagnostics?.uploadAttempt],
                  ['Location processing', locationV2Diagnostics?.replayAttempt]] as const).map(([label, attempt]) => (
                  <View key={label}>
                    <Text {...mobileTextProps("body")} style={styles.muted}>
                      {label}: {attempt?.outcome === "success" ? "Succeeded" : attempt?.outcome === "partial" ? "Partly acknowledged" : attempt ? "Failed" : "No recent result"}
                      {"\n"}Last attempt: {attempt ? formatQueueTime(attempt.attemptedAt) : "Not recorded"}
                      {"\n"}Last success: {attempt?.lastSuccessAt ? formatQueueTime(attempt.lastSuccessAt) : "Not recorded"}
                    </Text>
                    {attempt ? <Text selectable {...mobileTextProps("body")} style={styles.muted}>
                      HTTP: {attempt.details.httpStatus ?? "Unknown"} · Phase: {attempt.details.phase}
                      {"\n"}Stage: {attempt.details.locationStage ?? "Unknown"} · Reason: {attempt.outcome === "success" ? "None" : attempt.details.reason}
                      {"\n"}Server duration: {attempt.details.durationMs === undefined ? "Not provided" : `${attempt.details.durationMs} ms`}
                      {"\n"}Client elapsed: {attempt.clientElapsedMs} ms
                      {"\n"}Request ID: {attempt.details.requestId ?? "Not provided"}
                    </Text> : null}
                  </View>
                ))}
                <Text {...mobileTextProps("body")} style={styles.muted}>
                  Foreground access: {formatPermissionStatus(locationDiagnostics?.foregroundPermission ?? "unknown")} · Background access: {backgroundAccessSummary}
                </Text>
                {locationDiagnostics ? <Text {...mobileTextProps("body")} style={styles.muted}>{locationMonitorCountText(locationDiagnostics)}</Text> : null}
                <View style={styles.buttonRow}>
                  <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={enableLocation}>
                    <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Refresh monitoring</Text>
                  </Pressable>
                  <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => void shareLocationDiagnostics()}>
                    <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Share diagnostics</Text>
                  </Pressable>
                  <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={confirmDeleteLocationEvidence}>
                    <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Delete recent evidence</Text>
                  </Pressable>
                </View>
              </Reanimated.View>
            ) : null}
          </View>
          ) : null}

          {settingsSection === "health" ? (
          <View style={styles.panel}>
            <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Apple Health</Text>
            <Text {...mobileTextProps("body")} style={styles.muted}>
              Sleep and workouts are queued as health activity events first, then logged when confidence is high.
            </Text>
            <Text {...mobileTextProps("body")} style={styles.statusText}>
              {healthAvailability?.notes ?? "Apple Health status not checked"}
            </Text>
            {healthPermissionStatus ? <Text {...mobileTextProps("body")} style={styles.muted}>{healthPermissionStatus.notes}</Text> : null}
            <Text {...mobileTextProps("body")} style={styles.muted}>Sleep: {sleepStatus?.notes ?? "Not synced yet."}</Text>
            <Text {...mobileTextProps("body")} style={styles.muted}>Workouts: {workoutStatus?.notes ?? "Not synced yet."}</Text>
            {healthDebugStatus ? <Text {...mobileTextProps("body")} style={styles.muted}>{healthDebugStatus}</Text> : null}
            <View style={styles.healthPreferenceList}>
              {HEALTH_IMPORT_PREFERENCE_OPTIONS.map((option) => {
                const enabled = healthImportPreferences?.[option.key] ?? option.defaultEnabled;
                const mapping = healthAutoLogMappings[option.key] ?? {};
                const selectedCategoryName =
                  data?.categories.find((category) => category.id === mapping.categoryId)?.name ??
                  defaultHealthCategoryLabel(option.key);
                return (
                  <View key={option.key} style={styles.healthPreferenceRow}>
                    <View style={styles.healthPreferenceHeader}>
                      <View style={styles.healthPreferenceText}>
                        <Text {...mobileTextProps("itemTitle")} style={styles.categoryName}>{option.label}</Text>
                        <Text {...mobileTextProps("body")} style={styles.categoryMeta}>
                          {enabled
                            ? `Logs to ${selectedCategoryName}`
                            : "Ignored during Health sync"}
                        </Text>
                      </View>
                      <Switch
                        style={{ flexShrink: 0 }}
                        accessibilityLabel={`${option.label} Apple Health auto-log`}
                        value={enabled}
                        onValueChange={(value) => updateHealthImportPreference(option.key, value)}
                        trackColor={{ false: theme.borderStrong, true: theme.accent }}
                        thumbColor={enabled ? theme.onAccent : theme.surfaceRaised}
                        ios_backgroundColor={theme.borderStrong}
                      />
                    </View>
                    {enabled ? (
                      <View style={styles.healthMappingPanel}>
                        <Text {...mobileTextProps("metadata")} style={styles.healthMappingLabel}>Activity</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.categoryChoiceScroller}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${option.label} default Health activity`}
                            accessibilityState={{ selected: !mapping.categoryId }}
                            onPress={() => updateHealthAutoLogMapping(option.key, { categoryId: null })}
                            style={pressable(
                              [
                                styles.categoryChoice,
                                !mapping.categoryId ? styles.categoryChoiceSelected : null,
                                !mapping.categoryId ? { borderColor: theme.accent } : null
                              ],
                              styles.buttonPressed
                            )}
                          >
                            <Text
                              {...mobileTextProps("control")}
                              style={[
                                styles.categoryChoiceText,
                                !mapping.categoryId ? styles.categoryChoiceTextSelected : null,
                                !mapping.categoryId ? { color: theme.accent } : null
                              ]}
                            >
                              Default {defaultHealthCategoryLabel(option.key)}
                            </Text>
                            {!mapping.categoryId ? <CheckGlyph color={theme.accent} /> : null}
                          </Pressable>
                          {(data?.categories ?? []).map((category) => {
                            const selected = mapping.categoryId === category.id;
                            const categoryColor = paletteColorFor(category.color, category.name, theme.mode);
                            return (
                              <Pressable
                                key={`${option.key}:${category.id}`}
                                accessibilityRole="button"
                                accessibilityLabel={`${option.label} activity ${category.name}`}
                                accessibilityState={{ selected }}
                                onPress={() => updateHealthAutoLogMapping(option.key, { categoryId: category.id })}
                                style={pressable(
                                  [
                                    styles.categoryChoice,
                                    { borderColor: categoryColor },
                                    selected ? styles.categoryChoiceSelected : null,
                                    selected ? { borderColor: categoryColor } : null
                                  ],
                                  styles.buttonPressed
                                )}
                              >
                                <View
                                  style={[
                                    styles.colorDot,
                                    { backgroundColor: categoryColor, borderColor: categoryColor }
                                  ]}
                                />
                                <Text
                                  {...mobileTextProps("control")}
                                  style={[
                                    styles.categoryChoiceText,
                                    selected ? styles.categoryChoiceTextSelected : null,
                                    selected ? { color: categoryColor } : null
                                  ]}
                                >
                                  {category.name}
                                </Text>
                                {selected ? <CheckGlyph color={categoryColor} /> : null}
                              </Pressable>
                            );
                          })}
                        </ScrollView>
                        <Text {...mobileTextProps("metadata")} style={styles.healthMappingLabel}>Description</Text>
                        <TextInput
                          accessibilityLabel={`${option.label} description`}
                          {...mobileTextProps("input")}
                          key={`${option.key}:${mapping.description ?? ""}`}
                          style={[styles.textInput, styles.healthMappingInput]}
                          defaultValue={mapping.description ?? ""}
                          placeholder={defaultHealthDescription(option.key)}
                          placeholderTextColor={theme.textSecondary}
                          returnKeyType="done"
                          onEndEditing={(event) =>
                            updateHealthAutoLogMapping(option.key, {
                              description: event.nativeEvent.text.trim() || null
                            })
                          }
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={connectAppleHealth}>
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Connect</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => syncAppleHealth()}>
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>Sync now</Text>
              </Pressable>
              <Pressable
                disabled={exportingHealthDebug}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  exportingHealthDebug ? styles.buttonDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                onPress={exportAppleHealthDebug}
              >
                <Text {...mobileTextProps("control")} style={styles.secondaryButtonText}>{exportingHealthDebug ? "Exporting..." : "Export debug"}</Text>
              </Pressable>
            </View>
          </View>
          ) : null}
        </View>
      </ScrollView>
      <LocationInformationSheet
        kind={locationInfoSheet}
        onClose={() => setLocationInfoSheet(null)}
        reduceMotion={reduceMotion}
        styles={styles}
        theme={theme}
      />
    </SafeAreaView>
  );
}

function InfoButton({
  accessibilityLabel,
  onPress,
  styles,
  theme
}: {
  accessibilityLabel: string;
  onPress: () => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={pressable(styles.iconButton, styles.buttonPressed)}
      onPress={onPress}
    >
      <InfoGlyph color={theme.accent} />
    </Pressable>
  );
}

function LocationInformationSheet({
  kind,
  onClose,
  reduceMotion,
  styles,
  theme
}: {
  kind: "places" | "suggestions" | null;
  onClose: () => void;
  reduceMotion: boolean;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  if (!kind) return null;
  const isPlaces = kind === "places";
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
          accessibilityLabel={isPlaces ? "About saved places" : "About location suggestions"}
          backdropAccessibilityLabel="Close information"
          backdropStyle={styles.sheetBackdrop}
          handleStyle={styles.sheetHandle}
          onDismiss={onClose}
          reduceMotion={reduceMotion}
          style={styles.activeEditSheet}
          visible
        >
          <View style={styles.sheetHeader}>
            <Text {...mobileTextProps("sectionHeading")} style={styles.sheetTitle}>{isPlaces ? "About saved places" : "About location suggestions"}</Text>
            <Pressable
              accessibilityLabel="Close information"
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => sheetRef.current?.dismiss()}
            >
              <CloseGlyph color={theme.accent} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.activeEditContent}
            style={styles.activeEditScroller}
          >
            {isPlaces ? (
              <>
                <Text {...mobileTextProps("body")} style={styles.muted}>
                  Saved places help Dayframe recognise where you spent time. Detected visits appear in Review before they become time entries.
                </Text>
                <Text {...mobileTextProps("body")} style={styles.muted}>You can edit a saved name and radius at any time.</Text>
              </>
            ) : (
              <>
                <Text {...mobileTextProps("body")} style={styles.muted}>
                  Dayframe uses background location to suggest visits and journeys. Suggestions go to Review before becoming time entries.
                </Text>
                <Text {...mobileTextProps("body")} style={styles.muted}>
                  Location data is private. Motion & Fitness activity (still, walking, driving) is kept with it and never leaves Dayframe. Local journal samples expire after seven days. Upload copies, cached places and summaries can stay on this iPhone longer, even after upload or signing back in. Signing out clears this account’s local Location data; synced entries and saved places stay in your account.
                </Text>
                <Text {...mobileTextProps("body")} style={styles.muted}>
                  iOS can pause or limit background updates, so Dayframe may not capture every movement.
                </Text>
              </>
            )}
          </ScrollView>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

function CategoryColorPicker({
  onSelect,
  selectedColor,
  styles,
  theme
}: {
  onSelect: (color: DayframePaletteKey) => void;
  selectedColor: string;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  return (
    <View accessibilityLabel="Activity colour" style={styles.paletteGrid}>
      {DAYFRAME_PALETTE_PICKER.map((color) => {
        const selected = selectedColor === color.key;
        return (
          <Pressable
            key={color.key}
            accessibilityLabel={`${color.label} activity colour`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={pressable(
              [
                styles.paletteSwatch,
                { backgroundColor: paletteColorFor(color.key, color.label, theme.mode) },
                selected ? styles.paletteSwatchSelected : null
              ],
              styles.buttonPressed
            )}
            onPress={() => onSelect(color.key)}
          />
        );
      })}
    </View>
  );
}

export function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  const { styles } = useMobileTheme();
  return (
    <View style={styles.settingsGroup}>
      <Text {...mobileTextProps("counter")} style={styles.settingsGroupTitle}>{title}</Text>
      <View style={styles.settingsGroupRows}>{children}</View>
    </View>
  );
}

function AppearancePreviewCard({
  mode,
  selected,
  styles
}: {
  mode: "light" | "dark";
  selected: boolean;
  styles: MobileStyles;
}) {
  const dark = mode === "dark";
  return (
    <View style={styles.appearancePreviewColumn}>
      <Text {...mobileTextProps("metadata")} style={styles.appearancePreviewLabel}>{dark ? "Dark" : "Light"}</Text>
      <View style={[
        styles.appearancePreviewCard,
        dark ? styles.appearancePreviewCardDark : styles.appearancePreviewCardLight,
        selected ? styles.appearancePreviewCardSelected : null
      ]}>
        <View style={[
          styles.appearancePreviewSurface,
          dark ? styles.appearancePreviewSurfaceDark : styles.appearancePreviewSurfaceLight
        ]}>
          <View style={[styles.appearancePreviewLine, dark ? styles.appearancePreviewLineDark : styles.appearancePreviewLineLight]} />
          <View style={[styles.appearancePreviewLineShort, dark ? styles.appearancePreviewLineMutedDark : styles.appearancePreviewLineMutedLight]} />
          <View style={styles.appearancePreviewAccent} />
        </View>
        <View style={[
          styles.appearancePreviewPill,
          dark ? styles.appearancePreviewPillDark : styles.appearancePreviewPillLight
        ]}>
          <Text style={[styles.appearancePreviewPillText, dark ? styles.appearancePreviewPillTextDark : null]}>
            Midnight Core
          </Text>
        </View>
      </View>
    </View>
  );
}

export function SettingsMenuRow({
  icon,
  label,
  last = false,
  onPress,
  styles,
  theme,
  value,
  diagnostic
}: {
  icon: SettingsIcon;
  label: string;
  last?: boolean;
  onPress: () => void;
  styles: MobileStyles;
  theme: MobileTheme;
  value?: string;
  diagnostic?: MobileAccessibilityDiagnostic;
}) {
  return (
    <View>
      <Pressable
        accessibilityLabel={label}
        accessibilityValue={value ? { text: value } : undefined}
        accessibilityRole="button"
        style={pressable(styles.settingsMenuRow, styles.buttonPressed)}
        onLayout={(event) => recordMobileLayout(diagnostic, "settings.row", event)}
        onPress={onPress}
      >
        <View style={styles.settingsMenuIcon} onLayout={(event) => recordMobileLayout(diagnostic, "settings.icon", event)}>
          <SettingsRowGlyph name={icon} color={theme.accentText} />
        </View>
        <View style={styles.settingsMenuText} onLayout={(event) => recordMobileLayout(diagnostic, "settings.text-column", event)}>
          <Text {...mobileTextProps("itemTitle")} style={styles.settingsMenuTitle} onLayout={(event) => recordMobileLayout(diagnostic, "settings.label.frame", event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, "settings.label", event, "itemTitle", styles.settingsMenuTitle)}>{label}</Text>
          {value ? <Text {...mobileTextProps("metadata")} style={styles.settingsMenuMeta} onLayout={(event) => recordMobileLayout(diagnostic, "settings.value.frame", event)} onTextLayout={(event) => recordMobileTextLayout(diagnostic, "settings.value", event, "metadata", styles.settingsMenuMeta)}>{value}</Text> : null}
        </View>
        <View style={styles.settingsMenuChevron} onLayout={(event) => recordMobileLayout(diagnostic, "settings.chevron", event)}>
          <ChevronGlyph color={theme.textSecondary} />
        </View>
      </Pressable>
      {!last ? <View pointerEvents="none" style={styles.settingsMenuDivider} /> : null}
    </View>
  );
}

function SettingsRowGlyph({ color, name }: { color: string; name: SettingsIcon }) {
  switch (name) {
    case "profile":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" fill="none" stroke={color} strokeWidth={2} />
          <Path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2} />
        </Svg>
      );
    case "categories":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M5 5h6v6H5V5Zm8 0h6v6h-6V5ZM5 13h6v6H5v-6Zm8 0h6v6h-6v-6Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
        </Svg>
      );
    case "automations":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="m13 3-8 11h6l-1 7 9-12h-6l0-6Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
        </Svg>
      );
    case "health":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M12 5v14M5 12h14" stroke={color} strokeLinecap="round" strokeWidth={2.2} />
        </Svg>
      );
    case "sync":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M17 7H7l3-3M7 17h10l-3 3" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </Svg>
      );
    case "appearance":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M12 4a8 8 0 1 0 8 8 6 6 0 0 1-8-8Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
        </Svg>
      );
    case "review":
      return (
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="m5 12 4 4L19 6" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
        </Svg>
      );
  }
}

function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24">
      <Path d="m5 12 4 4 10-10" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} />
    </Svg>
  );
}

function ChevronGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="m9 6 6 6-6 6" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
    </Svg>
  );
}

function DisclosureChevronGlyph({ color, expanded }: { color: string; expanded: boolean }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function InfoGlyph({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Path d="M12 11v6" stroke={color} strokeLinecap="round" strokeWidth={2} />
      <Path d="M12 7h.01" stroke={color} strokeLinecap="round" strokeWidth={2.8} />
      <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="m7 7 10 10M17 7 7 17" stroke={color} strokeLinecap="round" strokeWidth={2} />
    </Svg>
  );
}

function settingsSectionTitle(section: SettingsSection) {
  switch (section) {
    case "profile":
      return "Profile";
    case "categories":
      return "Activities";
    case "automations":
      return "Places & Location";
    case "health":
      return "Health";
    case "sync":
      return "Sync help";
    case "appearance":
      return "Appearance";
    case "index":
      return "Settings";
  }
}

function normalizeSettingsSection(value: string | string[] | undefined): SettingsSection {
  const section = Array.isArray(value) ? value[0] : value;
  switch (section) {
    case "profile":
    case "categories":
    case "automations":
    case "health":
    case "sync":
    case "appearance":
      return section;
    default:
      return "index";
  }
}

function BackGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M15 5 8 12l7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
    </Svg>
  );
}

function PinGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M9 4h6l-1 6 4 3v2h-5l-1 6-1-6H6v-2l4-3-1-6Z"
        fill={color}
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function PinOffGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M9 4h6l-1 6 4 3v2h-5l-1 6-1-6H6v-2l4-3-1-6Z"
        fill="none"
        stroke={color}
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <Path d="M4 4l16 16" stroke={color} strokeLinecap="round" strokeWidth={2.2} />
    </Svg>
  );
}

function PlusGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12h14" stroke={color} strokeLinecap="round" strokeWidth={2.2} />
    </Svg>
  );
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
  if (diagnostics.locationLearningCaptureState === "logout_cleanup") return "Location capture is paused. Retry signing out to finish local cleanup.";
  if (diagnostics.foregroundPermission !== "granted") return "Location permission is not enabled.";
  if (diagnostics.backgroundPermission !== "granted") return "Enable Always access to monitor saved places.";
  if (!diagnostics.locationLearningEnabled) return "Location access is allowed. Turn on commute and regular-place learning to capture.";
  if (!diagnostics.locationLearningActive) return "Location consent is saved, but capture is inactive. Retry capture to start it.";
  if (diagnostics.geofencingActive && diagnostics.activeMonitorCount > 0) return "Place monitoring is enabled.";
  return "Location learning is enabled. No saved-place monitors are active.";
}

function locationMonitorCountText(diagnostics: LocationVisitDiagnostics) {
  if (diagnostics.backgroundPermission !== "granted") return "No place monitors are active.";
  if (diagnostics.activeMonitorCount > 0) {
    return `Monitoring ${diagnostics.activeMonitorCount} saved ${diagnostics.activeMonitorCount === 1 ? "place" : "places"}.`;
  }
  return "No saved places with coordinates are being monitored.";
}

function formatPermissionStatus(value: LocationVisitDiagnostics["foregroundPermission"]) {
  switch (value) {
    case "granted":
      return "Allowed";
    case "denied":
      return "Denied";
    case "undetermined":
      return "Not requested";
    case "unknown":
      return "Unknown";
  }
}

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
      return "Confirm";
    case "ignore_once":
    case "ignore_once_location":
      return "Dismiss";
    case "edit_and_confirm":
      return "Edit and confirm";
    default:
      return "Review change";
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
