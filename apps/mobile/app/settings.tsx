import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { scheduleLayoutTransition, useReduceMotionPreference } from "@/lib/motion";
import {
  DAYFRAME_PALETTE,
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
  buildQueueDiagnosticsSnapshot,
  clearFailedQueuedEvents,
  createCategory,
  fetchBootstrap,
  getQueueDiagnostics,
  logout,
  readQueue,
  retryFailedQueuedEvents,
  syncQueue,
  updateCategory,
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
  importHealthKitSleep,
  importHealthKitWorkouts,
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
import { REVIEW_COPY, isOpenReviewItem, isReviewNeededEntry } from "@/lib/review";
import {
  SETTINGS_HEALTH_SNAPSHOT_TTL_MS,
  SETTINGS_SNAPSHOT_TTL_MS,
  shouldRefreshSettingsSnapshot,
  shouldShowSettingsRefreshSpinner
} from "@/lib/settingsRefresh";
import { drainNativeShortcutQueue, syncShortcutCatalog } from "@/lib/shortcuts";

type Category = MobileBootstrap["categories"][number];
type SettingsSection = "index" | "profile" | "categories" | "automations" | "health" | "sync" | "appearance";
type SettingsIcon = "profile" | "categories" | "automations" | "health" | "sync" | "appearance" | "review";

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
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const routeSettingsSection = normalizeSettingsSection(params.section);
  const settingsSection = routeSettingsSection;
  const cachedSnapshot = readSettingsSnapshot();
  const [data, setData] = useState<MobileBootstrap | null>(cachedSnapshot?.data ?? null);
  const [queue, setQueue] = useState<QueuedEvent[]>(cachedSnapshot?.queue ?? []);
  const [lastSyncResult, setLastSyncResult] = useState<SyncQueueResult | null>(cachedSnapshot?.lastSyncResult ?? null);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(cachedSnapshot?.syncStatusMessage ?? null);
  const [showQueueDetails, setShowQueueDetails] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [locationStatus, setLocationStatus] = useState(cachedSnapshot?.locationStatus ?? "Not requested");
  const [locationDiagnostics, setLocationDiagnostics] = useState<LocationVisitDiagnostics | null>(
    cachedSnapshot?.locationDiagnostics ?? null
  );
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
  const [pinNewCategory, setPinNewCategory] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryColor, setEditingCategoryColor] = useState("lime");
  const refreshInFlight = useRef(false);
  const categoryEditRef = useRef<TextInput>(null);

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

  const load = useCallback(async (options?: { silent?: boolean; trigger?: "navigation" | "focus" | "pull" }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const showRefreshIndicator = shouldShowSettingsRefreshSpinner(options?.trigger ?? "navigation");
    if (showRefreshIndicator) setRefreshing(true);
    try {
      await drainNativeShortcutQueue();
      const [bootstrap, queued, location] = await Promise.all([
        fetchBootstrap(),
        readQueue(),
        getLocationVisitDiagnostics()
      ]);
      const nextLocationStatus = locationStatusText(location);
      updateSettingsSnapshot({
        data: bootstrap,
        queue: queued,
        locationDiagnostics: location,
        locationStatus: nextLocationStatus,
        updatedAt: Date.now()
      });
      setData(bootstrap);
      syncShortcutCatalog(bootstrap);
      setQueue(queued);
      setLocationDiagnostics(location);
      setLocationStatus(nextLocationStatus);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      if (!options?.silent) {
        Alert.alert("Dayframe API", error instanceof Error ? error.message : "Unable to load API");
      }
    } finally {
      refreshInFlight.current = false;
      if (showRefreshIndicator) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isSettingsSnapshotFresh()) void load({ silent: true });
  }, [load]);

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
    refreshGeofencesForPlaces(data.places)
      .then((count) => {
        void refreshLocationDiagnostics(count > 0 ? `Monitoring ${count} saved ${count === 1 ? "place" : "places"}.` : undefined);
      })
      .catch(() => undefined);
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
  const firstFailedEvent = queueDiagnostics.firstFailed;
  const canRetryFailed = queueDiagnostics.failedCount > 0;
  const canClearFailed = queueDiagnostics.clearableFailedCount > 0;
  const deviceSyncStatus = deviceSyncStatusText({
    syncingQueue,
    syncStatusMessage,
    lastSyncResult,
    queueDiagnostics
  });
  const locationMonitoringAllowed = locationDiagnostics?.backgroundPermission === "granted";
  const locationActionLabel = locationMonitoringAllowed ? "Refresh monitoring" : "Enable";
  const settingsTitle = settingsSectionTitle(settingsSection);
  const categoryCount = data?.categories.length ?? 0;
  const workspaceLabel = data?.workspace?.name ?? "Default workspace";

  function goBack() {
    router.back();
  }

  function openSettingsSection(section: Exclude<SettingsSection, "index">) {
    router.push({ pathname: "/settings", params: { section } });
  }

  useEffect(() => {
    if (!editingCategoryId) return undefined;

    const focusTimer = setTimeout(() => {
      categoryEditRef.current?.focus();
    }, 50);

    return () => clearTimeout(focusTimer);
  }, [editingCategoryId]);

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const color = nextCategoryColor(data?.categories ?? []);
    try {
      await createCategory(name, { color, isPinned: pinNewCategory });
      setNewCategoryName("");
      setPinNewCategory(true);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to create category.");
    }
  }

  function beginEditCategory(category: Category) {
    scheduleLayoutTransition(reduceMotion);
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategoryColor(category.color);
  }

  function cancelEditCategory() {
    scheduleLayoutTransition(reduceMotion);
    setEditingCategoryId(null);
    setEditingCategoryName("");
    setEditingCategoryColor("lime");
  }

  async function saveCategoryEdit(category: Category) {
    const name = editingCategoryName.trim();
    if (!name) {
      Alert.alert("Categories", "Category name is required.");
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
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to save category.");
    }
  }

  async function toggleCategoryPin(category: Category) {
    const nextPinned = !category.isPinned;
    patchCategory(category.id, { isPinned: nextPinned });
    try {
      const result = await updateCategory(category.id, { isPinned: nextPinned });
      if (result.category.isPinned !== nextPinned) {
        throw new Error("Category pin state was not saved. Check that the Dayframe API has the category pin migration.");
      }
      await load({ silent: true });
    } catch (error) {
      patchCategory(category.id, { isPinned: category.isPinned });
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to update category.");
    }
  }

  function confirmDeleteCategory(category: Category) {
    Alert.alert(
      "Delete category",
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
        router.replace("/");
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to delete category.");
    }
  }

  async function syncAndReload(options?: { syncingMessage?: string }) {
    setSyncingQueue(true);
    setSyncStatusMessageAndCache(options?.syncingMessage ?? "Syncing device data...");
    try {
      const result = await syncQueue({ forceRetry: true });
      setQueueAndCache(result.remaining);
      setLastSyncResultAndCache(result);
      setSyncStatusMessageAndCache(null);
      await load();
      return result;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return null;
      }
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to sync queued events.");
      return null;
    } finally {
      setSyncingQueue(false);
    }
  }

  async function retryFailedAndReload() {
    setSyncingQueue(true);
    setSyncStatusMessageAndCache("Retrying failed items...");
    try {
      const result = await retryFailedQueuedEvents();
      setQueueAndCache(result.remaining);
      setLastSyncResultAndCache(result);
      setSyncStatusMessageAndCache(null);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to retry failed events.");
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
      setQueueAndCache(result.remaining);
      setLastSyncResultAndCache(null);
      setSyncStatusMessageAndCache(
        `${result.removedCount} failed queued ${result.removedCount === 1 ? "event was" : "events were"} removed. ${result.remainingCount} queued ${result.remainingCount === 1 ? "event remains" : "events remain"}.`
      );
      await load({ silent: true });
    } catch (error) {
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to clear failed events.");
    }
  }

  async function exportQueueDiagnostics() {
    try {
      const latestQueue = await readQueue();
      const snapshot = buildQueueDiagnosticsSnapshot(latestQueue, lastSyncResult);
      await Share.share({
        title: `Dayframe queue diagnostics ${snapshot.exportedAt}`,
        message: JSON.stringify(snapshot, null, 2)
      });
      setQueueAndCache(latestQueue);
    } catch (error) {
      setSyncStatusMessageAndCache(error instanceof Error ? error.message : "Unable to export queue diagnostics.");
    }
  }

  async function enableLocation() {
    if (locationMonitoringAllowed && data) {
      await startGeofences(data.places);
      await refreshLocationDiagnostics("Place monitoring is enabled.");
      return;
    }

    const status = await requestLocationAccess();
    updateSettingsSnapshot({ locationStatus: status });
    setLocationStatus(status);
    if (status.startsWith("Always allowed") && data) {
      await startGeofences(data.places);
      await refreshLocationDiagnostics("Place monitoring is enabled.");
    } else {
      await refreshLocationDiagnostics(status);
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

    const status = await setLocationLearningEnabled(enabled, data?.places ?? []);
    await refreshLocationDiagnostics(status);
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
  }

  async function connectAppleHealth() {
    try {
      const permissions = await requestHealthKitPermissions();
      updateHealthStatus(permissions);
      if (permissions.status === "available") await syncAppleHealth({ silent: true });
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health permission"));
    }
  }

  async function syncAppleHealth(options?: { silent?: boolean }) {
    try {
      setSyncStatusMessageAndCache("Syncing Health data...");
      const sleep = await importHealthKitSleep();
      updateHealthStatus(sleep);
      const workout = await importHealthKitWorkouts();
      updateHealthStatus(workout);
      await syncAndReload({ syncingMessage: "Syncing Health data..." });
      await reprocessExistingHealthReviewItems(undefined, { force: true });
      await load({ silent: true });
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
    await logout();
    setDataAndCache(null);
    setQueueAndCache(await readQueue());
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.settingsFloatingHeader}>
        <View style={styles.settingsHeader}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            style={pressable(styles.iconButton, styles.buttonPressed)}
            onPress={goBack}
          >
            <BackGlyph color={theme.accent} />
          </Pressable>
          <Text style={styles.settingsTitle} numberOfLines={1}>{settingsTitle}</Text>
        </View>
      </View>
      <ScrollView
        style={styles.settingsScrollView}
        contentContainerStyle={styles.settingsScrollContent}
        keyboardShouldPersistTaps="handled"
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
            <>
              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>Settings</Text>
                <Text style={styles.muted}>Grouped controls for account, tracking, places, sync and permissions.</Text>
              </View>

              <SettingsGroup title="Dayframe">
                <SettingsMenuRow
                  icon="profile"
                  label="Profile & workspace"
                  value={workspaceLabel}
                  styles={styles}
                  theme={theme}
                  onPress={() => openSettingsSection("profile")}
                />
                <SettingsMenuRow
                  icon="categories"
                  label="Categories"
                  value={`${categoryCount} ${categoryCount === 1 ? "category" : "categories"}`}
                  styles={styles}
                  theme={theme}
                  onPress={() => openSettingsSection("categories")}
                />
                <SettingsMenuRow
                  icon="appearance"
                  label="Appearance"
                  value={themePreference === "system" ? "System" : themePreference === "dark" ? "Dark" : "Light"}
                  styles={styles}
                  theme={theme}
                  onPress={() => openSettingsSection("appearance")}
                />
              </SettingsGroup>

              <SettingsGroup title="Tracking">
                <SettingsMenuRow
                  icon="automations"
                  label="Places & Location"
                  value="Places, permissions, learning"
                  styles={styles}
                  theme={theme}
                  onPress={() => openSettingsSection("automations")}
                />
                <SettingsMenuRow
                  icon="health"
                  label="Apple Health"
                  value={healthAvailability?.notes ?? "Sleep and workouts"}
                  styles={styles}
                  theme={theme}
                  onPress={() => openSettingsSection("health")}
                />
                <SettingsMenuRow
                  icon="review"
                  label={REVIEW_COPY.needsReview}
                  value={`${openReviewCount} open`}
                  styles={styles}
                  theme={theme}
                  onPress={() => router.push("./review")}
                />
              </SettingsGroup>

              <SettingsGroup title="Device">
                <SettingsMenuRow
                  icon="sync"
                  label="Sync & diagnostics"
                  value={deviceSyncStatus}
                  styles={styles}
                  theme={theme}
                  onPress={() => openSettingsSection("sync")}
                />
              </SettingsGroup>
            </>
          ) : null}

          {settingsSection === "appearance" ? (
            <View style={styles.appearanceStack}>
              <Text style={styles.appearanceIntro}>Choose how Dayframe follows your iPhone.</Text>
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
                      <Text style={[styles.segmentButtonText, selected ? styles.segmentButtonTextSelected : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.appearanceSelectionCard}>
                <Text style={styles.appearanceSelectionTitle}>
                  {themePreference === "system" ? "System" : themePreference === "light" ? "Light" : "Dark"}
                </Text>
                <Text style={styles.appearanceSelectionMeta}>
                  {themePreference === "system"
                    ? "Automatically matches iOS appearance."
                    : themePreference === "light"
                      ? "Uses the designed light companion throughout Dayframe."
                      : "Uses Midnight Core throughout Dayframe."}
                </Text>
              </View>

              <Text style={styles.appearanceSectionLabel}>Preview</Text>
              <View style={styles.appearancePreviewRow}>
                <AppearancePreviewCard mode="light" selected={themePreference === "light"} styles={styles} />
                <AppearancePreviewCard mode="dark" selected={themePreference === "dark"} styles={styles} />
              </View>

              <Text style={styles.appearanceSectionLabel}>Display details</Text>
              <View style={styles.appearanceDetailsCard}>
                <View style={styles.appearanceDetailRow}>
                  <Text style={styles.appearanceDetailTitle}>Midnight Core</Text>
                  <Text style={styles.appearanceDetailMeta}>Always preserved</Text>
                </View>
                <View style={[styles.appearanceDetailRow, styles.appearanceDetailDivider]}>
                  <Text style={styles.appearanceDetailTitle}>Colour logo</Text>
                  <Text style={styles.appearanceDetailMeta}>Never recoloured</Text>
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
                    <View key={category.id} style={styles.categoryEditCard}>
                      <View style={styles.categoryEditHeader}>
                        <View
                          style={[
                            styles.colorDot,
                            { backgroundColor: paletteColorFor(editingCategoryColor, category.name, theme.mode) }
                          ]}
                        />
                        <TextInput
                          ref={categoryEditRef}
                          style={[styles.textInput, styles.categoryEditInput]}
                          value={editingCategoryName}
                          onChangeText={setEditingCategoryName}
                          placeholder="Category name"
                          placeholderTextColor={theme.textSecondary}
                          returnKeyType="done"
                          onSubmitEditing={() => saveCategoryEdit(category)}
                        />
                      </View>
                      <View style={styles.paletteGrid}>
                        {DAYFRAME_PALETTE.map((color) => {
                          const selected = editingCategoryColor === color.key;
                            return (
                              <Pressable
                                key={color.key}
                                accessibilityLabel={`${color.label} category colour`}
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
                              onPress={() => setEditingCategoryColor(color.key)}
                            />
                          );
                        })}
                      </View>
                      <View style={styles.buttonRow}>
                        <Pressable
                          accessibilityRole="button"
                          style={pressable(styles.secondaryButton, styles.buttonPressed)}
                          onPress={cancelEditCategory}
                        >
                          <Text style={styles.secondaryButtonText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`Delete ${category.name}`}
                          accessibilityRole="button"
                          style={pressable(styles.secondaryButton, styles.buttonPressed)}
                          onPress={() => confirmDeleteCategory(category)}
                        >
                          <Text style={styles.activeEditDeleteText}>Delete</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          style={pressable(styles.primaryInlineButton, styles.buttonPressed)}
                          onPress={() => saveCategoryEdit(category)}
                        >
                          <Text style={styles.primaryButtonText}>Save</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }

                return (
                  <View
                    key={category.id}
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
                        <Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text>
                        <Text style={[styles.categoryMeta, category.isPinned ? styles.categoryMetaPinned : null]}>
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
                  </View>
                );
              })}
            </View>
            <View style={styles.categoryCreateRow}>
              <TextInput
                style={[styles.textInput, styles.categoryCreateInput]}
                value={newCategoryName}
                onChangeText={setNewCategoryName}
                onSubmitEditing={addCategory}
                placeholder="New category"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
              />
              <Pressable
                accessibilityLabel={pinNewCategory ? "Create as pinned category" : "Create as unpinned category"}
                accessibilityRole="button"
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
                accessibilityLabel="Create category"
                accessibilityRole="button"
                style={pressable(styles.categoryIconButtonPrimary, styles.buttonPressed)}
                onPress={addCategory}
              >
                <PlusGlyph color={theme.onAccent} />
              </Pressable>
            </View>
          </View>
          ) : null}

          {settingsSection === "profile" ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Account</Text>
            {data?.user || data?.workspace ? (
              <View style={styles.accountList}>
                {data.user ? (
                  <View style={styles.accountRow}>
                    <Text style={styles.label}>Signed in as</Text>
                    <Text style={styles.accountValue} numberOfLines={1}>
                      {data.user.name || data.user.email}
                    </Text>
                    <Text style={styles.accountMeta} numberOfLines={1}>{data.user.email}</Text>
                  </View>
                ) : null}
                {data.workspace ? (
                  <View style={styles.accountRow}>
                    <Text style={styles.label}>Workspace</Text>
                    <Text style={styles.accountValue} numberOfLines={1}>{data.workspace.name}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={signOut}>
                <Text style={styles.secondaryButtonText}>Log out</Text>
              </Pressable>
            </View>
          </View>
          ) : null}

          {settingsSection === "automations" ? (
          <>
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Places</Text>
            <Text style={styles.muted}>
              Places help Dayframe recognise where time was spent. Completed visits are review-first, even for specific places, so you can confirm the time window before it becomes a time entry.
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityRole="button"
                style={pressable(styles.secondaryButton, styles.buttonPressed)}
                onPress={() => router.push("./places")}
              >
                <Text style={styles.secondaryButtonText}>Manage places</Text>
              </Pressable>
            </View>
          </View>
          </>
          ) : null}

          {settingsSection === "sync" ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Device sync</Text>
            <Text style={styles.statusText}>{deviceSyncStatus}</Text>
            {lastSyncResult?.firstError ? (
              <Text style={styles.muted}>Some queued data still needs attention. Details are available below.</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={pressable(styles.detailsToggle, styles.buttonPressed)}
              onPress={() => {
                scheduleLayoutTransition(reduceMotion);
                setShowQueueDetails((current) => !current);
              }}
            >
              <Text style={styles.detailsToggleText}>
                {showQueueDetails ? "Hide troubleshooting details" : "Troubleshooting details..."}
              </Text>
            </Pressable>
            {showQueueDetails ? (
              <View style={styles.queueDiagnosticCard}>
                <Text style={styles.label}>Queue</Text>
                <Text style={styles.accountMeta}>
                  Queued {queueDiagnostics.queuedCount} · Last synced {lastSyncResult?.syncedCount ?? 0} · Failed{" "}
                  {queueDiagnostics.failedCount}
                </Text>
                {queueDiagnostics.failedCount > 0 ? (
                  <Text style={styles.accountMeta}>
                    Retryable {queueDiagnostics.retryableFailedCount} · Invalid {queueDiagnostics.permanentFailedCount}
                    {queueDiagnostics.nextRetryAt ? ` · Next retry ${formatQueueTime(queueDiagnostics.nextRetryAt)}` : ""}
                  </Text>
                ) : null}
                {firstFailedEvent ? (
                  <>
                    <Text style={styles.label}>First failed event</Text>
                    <Text style={styles.accountValue} numberOfLines={2}>
                      {formatSourceLabel(firstFailedEvent.source)} · {formatEventLabel(firstFailedEvent.type)} ·{" "}
                      {formatQueueTime(firstFailedEvent.occurredAt)}
                    </Text>
                    <Text style={styles.accountMeta} numberOfLines={3}>
                      {firstFailedEvent.lastError ?? "No error message was recorded."}
                    </Text>
                    {firstFailedEvent.lastAttemptedAt || firstFailedEvent.failedAt ? (
                      <Text style={styles.accountMeta}>
                        Last attempt {formatQueueTime(firstFailedEvent.lastAttemptedAt ?? firstFailedEvent.failedAt)}
                      </Text>
                    ) : null}
                    {firstFailedEvent.nextRetryAt ? (
                      <Text style={styles.accountMeta}>
                        Next automatic retry {formatQueueTime(firstFailedEvent.nextRetryAt)}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.accountMeta}>No failed queued events.</Text>
                )}
              </View>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => void syncAndReload()}>
                <Text style={styles.secondaryButtonText}>Sync now</Text>
              </Pressable>
              <Pressable
                disabled={!canRetryFailed}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  !canRetryFailed ? styles.buttonDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                onPress={retryFailedAndReload}
              >
                <Text style={styles.secondaryButtonText}>Retry failed</Text>
              </Pressable>
              <Pressable
                disabled={!canClearFailed}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  !canClearFailed ? styles.buttonDisabled : null,
                  pressed ? styles.buttonPressed : null
                ]}
                onPress={confirmClearFailedQueue}
              >
                <Text style={styles.secondaryButtonText}>Clear failed/invalid</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={exportQueueDiagnostics}>
                <Text style={styles.secondaryButtonText}>Export diagnostics</Text>
              </Pressable>
            </View>
          </View>
          ) : null}

          {settingsSection === "automations" ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Location</Text>
            <Text style={styles.muted}>
              Dayframe can recognise visits to saved places. Visits are reviewed before becoming time entries.
              Place visits do not start live timers.
            </Text>
            <View style={styles.healthPreferenceRow}>
              <View style={styles.healthPreferenceHeader}>
                <View style={styles.healthPreferenceText}>
                  <Text style={styles.categoryName}>Commute + place learning</Text>
                  <Text style={styles.categoryMeta}>
                    {locationDiagnostics?.locationLearningEnabled
                      ? "Review-first suggestions from coarse background location"
                      : "Paused until you turn it on"}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Commute and regular-place learning"
                  value={locationDiagnostics?.locationLearningEnabled ?? false}
                  onValueChange={toggleLocationLearning}
                  trackColor={{ false: theme.borderStrong, true: theme.accent }}
                  thumbColor={locationDiagnostics?.locationLearningEnabled ? theme.onAccent : theme.surfaceRaised}
                  ios_backgroundColor={theme.borderStrong}
                />
              </View>
              <Text style={styles.muted}>
                Learns repeated unsaved places and commutes between visits. Suggestions stay in Review and can be paused here.
              </Text>
            </View>
            <Text style={styles.statusText}>{locationStatus}</Text>
            {locationDiagnostics ? (
              <>
                <Text style={styles.muted}>
                  Permission: {formatPermissionStatus(locationDiagnostics.foregroundPermission)} · Background:{" "}
                  {formatPermissionStatus(locationDiagnostics.backgroundPermission)}
                </Text>
                <Text style={styles.muted}>{locationMonitorCountText(locationDiagnostics)}</Text>
                {locationDiagnostics.lastGeofenceEvent ? (
                  <Text style={styles.muted}>
                    Last geofence: {formatGeofenceTransition(locationDiagnostics.lastGeofenceEvent.transition)}{" "}
                    {locationDiagnostics.lastGeofenceEvent.placeName} ·{" "}
                    {formatQueueTime(locationDiagnostics.lastGeofenceEvent.occurredAt)}
                  </Text>
                ) : null}
                {locationDiagnostics.lastQueuedVisitCandidate ? (
                  <Text style={styles.muted}>
                    Last candidate: {locationDiagnostics.lastQueuedVisitCandidate.placeName} ·{" "}
                    {formatDurationMinutes(locationDiagnostics.lastQueuedVisitCandidate.durationSeconds)} ·{" "}
                    {formatQueueTime(locationDiagnostics.lastQueuedVisitCandidate.queuedAt)}
                  </Text>
                ) : null}
                {locationDiagnostics.lastCommuteCandidate ? (
                  <Text style={styles.muted}>
                    Last commute: {locationDiagnostics.lastCommuteCandidate.fromPlaceName} →{" "}
                    {locationDiagnostics.lastCommuteCandidate.toPlaceName} ·{" "}
                    {formatDurationMinutes(locationDiagnostics.lastCommuteCandidate.durationSeconds)} ·{" "}
                    {formatQueueTime(locationDiagnostics.lastCommuteCandidate.queuedAt)}
                  </Text>
                ) : null}
                {locationDiagnostics.lastLearnedPlaceCandidate ? (
                  <Text style={styles.muted}>
                    Last learned place: {locationDiagnostics.lastLearnedPlaceCandidate.candidateName} ·{" "}
                    {locationDiagnostics.lastLearnedPlaceCandidate.sampleCount} samples ·{" "}
                    {formatQueueTime(locationDiagnostics.lastLearnedPlaceCandidate.queuedAt)}
                  </Text>
                ) : null}
                {locationDiagnostics.lastStatus &&
                locationDiagnostics.lastStatus !== locationMonitorCountText(locationDiagnostics) ? (
                  <Text style={styles.muted}>{locationDiagnostics.lastStatus}</Text>
                ) : null}
                {locationDiagnostics.lastEventAt || locationDiagnostics.lastMonitorRefreshAt ? (
                  <Text style={styles.muted}>
                    Last update {formatQueueTime(locationDiagnostics.lastEventAt ?? locationDiagnostics.lastMonitorRefreshAt)}
                  </Text>
                ) : null}
              </>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={enableLocation}>
                <Text style={styles.secondaryButtonText}>{locationActionLabel}</Text>
              </Pressable>
            </View>
          </View>
          ) : null}

          {settingsSection === "health" ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Apple Health</Text>
            <Text style={styles.muted}>
              Sleep and workouts are queued as health activity events first, then logged when confidence is high.
            </Text>
            <Text style={styles.statusText}>
              {healthAvailability?.notes ?? "Apple Health status not checked"}
            </Text>
            {healthPermissionStatus ? <Text style={styles.muted}>{healthPermissionStatus.notes}</Text> : null}
            <Text style={styles.muted}>Sleep: {sleepStatus?.notes ?? "Not synced yet."}</Text>
            <Text style={styles.muted}>Workouts: {workoutStatus?.notes ?? "Not synced yet."}</Text>
            {healthDebugStatus ? <Text style={styles.muted}>{healthDebugStatus}</Text> : null}
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
                        <Text style={styles.categoryName}>{option.label}</Text>
                        <Text style={styles.categoryMeta}>
                          {enabled
                            ? `Logs to ${selectedCategoryName}`
                            : "Ignored during Health sync"}
                        </Text>
                      </View>
                      <Switch
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
                        <Text style={styles.healthMappingLabel}>Category</Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={styles.categoryChoiceScroller}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${option.label} default Health category`}
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
                                accessibilityLabel={`${option.label} category ${category.name}`}
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
                        <Text style={styles.healthMappingLabel}>Description</Text>
                        <TextInput
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
                <Text style={styles.secondaryButtonText}>Connect</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => syncAppleHealth()}>
                <Text style={styles.secondaryButtonText}>Sync now</Text>
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
                <Text style={styles.secondaryButtonText}>{exportingHealthDebug ? "Exporting..." : "Export debug"}</Text>
              </Pressable>
            </View>
          </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsGroup({ children, title }: { children: ReactNode; title: string }) {
  const { styles } = useMobileTheme();
  return (
    <View style={styles.settingsGroup}>
      <Text style={styles.settingsGroupTitle}>{title}</Text>
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
      <Text style={styles.appearancePreviewLabel}>{dark ? "Dark" : "Light"}</Text>
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

function SettingsMenuRow({
  icon,
  label,
  onPress,
  styles,
  theme,
  value
}: {
  icon: SettingsIcon;
  label: string;
  onPress: () => void;
  styles: MobileStyles;
  theme: MobileTheme;
  value?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      style={pressable(styles.settingsMenuRow, styles.buttonPressed)}
      onPress={onPress}
    >
      <View style={styles.settingsMenuIcon}>
        <SettingsRowGlyph name={icon} color={theme.accentText} />
      </View>
      <View style={styles.settingsMenuText}>
        <Text style={styles.settingsMenuTitle} numberOfLines={1}>{label}</Text>
        {value ? <Text style={styles.settingsMenuMeta} numberOfLines={1}>{value}</Text> : null}
      </View>
      <ChevronGlyph color={theme.textSecondary} />
    </Pressable>
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

function settingsSectionTitle(section: SettingsSection) {
  switch (section) {
    case "profile":
      return "Profile";
    case "categories":
      return "Categories";
    case "automations":
      return "Places & Location";
    case "health":
      return "Health";
    case "sync":
      return "Sync";
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
  if (diagnostics.foregroundPermission !== "granted") return "Location permission is not enabled.";
  if (diagnostics.backgroundPermission !== "granted") return "Enable Always access to monitor saved places.";
  return "Place monitoring is enabled.";
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

function formatGeofenceTransition(value: NonNullable<LocationVisitDiagnostics["lastGeofenceEvent"]>["transition"]) {
  return value === "enter" ? "Entered" : "Exited";
}

function formatDurationMinutes(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

function defaultHealthCategoryLabel(type: HealthImportPreferenceKey) {
  return type === "sleep" ? "Sleep" : "Health";
}

function defaultHealthDescription(type: HealthImportPreferenceKey) {
  return HEALTH_IMPORT_PREFERENCE_OPTIONS.find((option) => option.key === type)?.label ?? "Health activity";
}

const sourceLabels: Record<string, string> = {
  manual_app: "Web app",
  mobile_app: "Mobile app",
  nfc: "NFC",
  widget: "Widget",
  shortcut: "Shortcut",
  geofence_specific: "Specific place",
  geofence_broad: "Broad place",
  calendar: "Calendar",
  health_sleep: "Health sleep",
  health_workout: "Health workout",
  location_learning: "Location learning",
  home_assistant: "Home Assistant",
  ha_button: "Home Assistant button",
  ha_geofence: "Home Assistant geofence"
};

const eventLabels: Record<string, string> = {
  timer_start: "Started timer",
  timer_stop: "Stopped timer",
  timer_switch: "Switched timer",
  quick_action: "Quick action",
  geofence_enter: "Entered place",
  geofence_exit: "Left place",
  unknown_stay: "Detected stay",
  commute_detected: "Commute detected",
  learned_place_visit: "Detected visit",
  nfc_action: "NFC action",
  shortcut_action: "Shortcut action",
  calendar_hint: "Calendar hint",
  health_sleep_import: "Health sleep import",
  health_workout_import: "Health workout import"
};

function deviceSyncStatusText({
  syncingQueue,
  syncStatusMessage,
  lastSyncResult,
  queueDiagnostics
}: {
  syncingQueue: boolean;
  syncStatusMessage: string | null;
  lastSyncResult: SyncQueueResult | null;
  queueDiagnostics: QueueDiagnostics;
}) {
  if (syncingQueue) return syncStatusMessage ?? "Syncing device data...";
  if (syncStatusMessage) return syncStatusMessage;

  if (lastSyncResult) {
    if (lastSyncResult.syncedCount > 0 && lastSyncResult.failedCount > 0) {
      return `Synced ${formatItemCount(lastSyncResult.syncedCount)}. ${formatItemCount(lastSyncResult.failedCount)} ${lastSyncResult.failedCount === 1 ? "needs" : "need"} attention.`;
    }
    if (lastSyncResult.syncedCount > 0) {
      return `Synced ${formatItemCount(lastSyncResult.syncedCount)}.`;
    }
    if (lastSyncResult.failedCount > 0) return "Some items need attention.";
    if (lastSyncResult.remainingCount > 0) return "Device data is waiting to sync.";
    return "Device data is synced.";
  }

  if (queueDiagnostics.failedCount > 0) return "Some items need attention.";
  if (queueDiagnostics.queuedCount > 0) return "Device data is waiting to sync.";
  return "Device data is synced.";
}

function formatItemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function formatSourceLabel(value?: string | null) {
  if (!value) return "Unknown source";
  return sourceLabels[value] ?? formatMachineLabel(value);
}

function formatEventLabel(value?: string | null) {
  if (!value) return "Activity";
  return eventLabels[value] ?? formatMachineLabel(value);
}

function formatMachineLabel(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "nfc") return "NFC";
      if (part.toLowerCase() === "ha") return "Home Assistant";
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
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
