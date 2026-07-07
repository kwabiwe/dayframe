import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { DAYFRAME_PALETTE, paletteColorFor, type DayframePaletteKey } from "@dayframe/shared";
import {
  AuthRequiredError,
  archiveCategory,
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
  requestLocationAccess,
  refreshGeofencesForPlaces,
  startGeofences
} from "@/lib/geofence";
import {
  friendlyHealthKitError,
  getHealthImportStatus,
  importHealthKitSleep,
  importHealthKitWorkouts,
  requestHealthKitPermissions,
  type HealthImportStatus
} from "@/lib/health";
import {
  pressable,
  themeOptions,
  useMobileTheme
} from "@/lib/mobileTheme";

type Category = MobileBootstrap["categories"][number];

export default function SettingsScreen() {
  const {
    reloadThemePreference,
    setThemePreference,
    styles,
    theme,
    themePreference
  } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [lastSyncResult, setLastSyncResult] = useState<SyncQueueResult | null>(null);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [showQueueDetails, setShowQueueDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Not requested");
  const [healthStatus, setHealthStatus] = useState<HealthImportStatus[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pinNewCategory, setPinNewCategory] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryColor, setEditingCategoryColor] = useState("lime");
  const refreshInFlight = useRef(false);
  const categoryEditRef = useRef<TextInput>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!options?.silent) setLoading(true);
    try {
      const [bootstrap, queued] = await Promise.all([fetchBootstrap(), readQueue()]);
      setData(bootstrap);
      setQueue(queued);
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
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reloadThemePreference();
      void load({ silent: true });
    }, [load, reloadThemePreference])
  );

  useEffect(() => {
    getHealthImportStatus().then(setHealthStatus).catch(() => {
      setHealthStatus([
        {
          provider: "healthkit",
          status: "error",
          notes: "Unable to check Apple Health status."
        }
      ]);
    });
  }, []);

  useEffect(() => {
    if (!data?.places.length) return;
    refreshGeofencesForPlaces(data.places)
      .then((count) => {
        if (count > 0) setLocationStatus(`Monitoring ${count} places`);
      })
      .catch(() => undefined);
  }, [data?.places]);

  const healthAvailability =
    healthStatus.find((item) => item.provider === "healthkit" && item.kind === "availability") ??
    healthStatus.find((item) => item.provider === "healthkit");
  const sleepStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "sleep");
  const workoutStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "workout");
  const healthPermissionStatus = healthStatus.find(
    (item) => item.provider === "healthkit" && item.kind === "permissions"
  );
  const queueDiagnostics = getQueueDiagnostics(queue);
  const firstFailedEvent = queueDiagnostics.firstFailed;
  const canRetryFailed = queueDiagnostics.failedCount > 0;
  const canClearFailed = queueDiagnostics.clearableFailedCount > 0;
  const deviceSyncStatus = deviceSyncStatusText({
    syncingQueue,
    syncStatusMessage,
    lastSyncResult,
    queueDiagnostics
  });
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
    setSyncStatusMessage(options?.syncingMessage ?? "Syncing device data...");
    try {
      const result = await syncQueue();
      setQueue(result.remaining);
      setLastSyncResult(result);
      setSyncStatusMessage(null);
      await load();
      return result;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return null;
      }
      setSyncStatusMessage(error instanceof Error ? error.message : "Unable to sync queued events.");
      return null;
    } finally {
      setSyncingQueue(false);
    }
  }

  async function retryFailedAndReload() {
    setSyncingQueue(true);
    setSyncStatusMessage("Retrying failed items...");
    try {
      const result = await retryFailedQueuedEvents();
      setQueue(result.remaining);
      setLastSyncResult(result);
      setSyncStatusMessage(null);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      setSyncStatusMessage(error instanceof Error ? error.message : "Unable to retry failed events.");
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
      setQueue(result.remaining);
      setLastSyncResult(null);
      setSyncStatusMessage(
        `${result.removedCount} failed queued ${result.removedCount === 1 ? "event was" : "events were"} removed. ${result.remainingCount} queued ${result.remainingCount === 1 ? "event remains" : "events remain"}.`
      );
      await load({ silent: true });
    } catch (error) {
      setSyncStatusMessage(error instanceof Error ? error.message : "Unable to clear failed events.");
    }
  }

  async function enableLocation() {
    const status = await requestLocationAccess();
    setLocationStatus(status);
    if (status.startsWith("Always allowed") && data) {
      const count = await startGeofences(data.places);
      Alert.alert("Geofences", `Started ${count} place monitors.`);
    }
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
      setSyncStatusMessage("Syncing Health data...");
      const sleep = await importHealthKitSleep();
      updateHealthStatus(sleep);
      const workout = await importHealthKitWorkouts();
      updateHealthStatus(workout);
      await syncAndReload({ syncingMessage: "Syncing Health data..." });
    } catch (error) {
      if (error instanceof AuthRequiredError) return;
      const message = friendlyHealthKitError(error, "sync Apple Health");
      setSyncStatusMessage(message);
      if (!options?.silent) {
        Alert.alert("Apple Health", message);
      }
    }
  }

  function updateHealthStatus(status: HealthImportStatus) {
    setHealthStatus((current) => [
      status,
      ...current.filter((item) => !(item.provider === status.provider && item.kind === status.kind))
    ]);
  }

  function patchCategory(id: string, patch: Partial<Category>) {
    setData((current) => {
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
    setData(null);
    setQueue(await readQueue());
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => load()}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.contentStack}>
          <View style={styles.settingsHeader}>
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => router.back()}
            >
              <BackGlyph color={theme.accent} />
            </Pressable>
            <Image
              source={require("../assets/dayframe_logo_banner.png")}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Settings</Text>
            <Text style={styles.muted}>Account, categories, device sync and permissions.</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.label}>Theme</Text>
            <View style={styles.segmentedControl}>
              {themeOptions.map((option) => {
                const selected = option.value === themePreference;
                return (
                  <Pressable
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
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.categoryList}>
              {(data?.categories ?? []).map((category) => {
                const categoryColor = paletteColorFor(category.color, category.name);
                const editing = editingCategoryId === category.id;

                if (editing) {
                  return (
                    <View key={category.id} style={styles.categoryEditCard}>
                      <View style={styles.categoryEditHeader}>
                        <View style={[styles.colorDot, { backgroundColor: paletteColorFor(editingCategoryColor, category.name) }]} />
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
                              style={pressable(
                                [
                                  styles.paletteSwatch,
                                  { backgroundColor: color.hex },
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
                  <View key={category.id} style={[styles.categoryRow, category.isPinned ? styles.categoryRowPinned : null]}>
                    <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
                    <View style={styles.categoryTextStack}>
                      <Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text>
                      <Text style={[styles.categoryMeta, category.isPinned ? styles.categoryMetaPinned : null]}>
                        {category.isPinned ? "Pinned" : "Unpinned"}
                      </Text>
                    </View>
                    <View style={styles.categoryActions}>
                      <Pressable
                        accessibilityLabel={`Edit ${category.name}`}
                        accessibilityRole="button"
                        style={pressable(styles.categoryIconButton, styles.buttonPressed)}
                        onPress={() => beginEditCategory(category)}
                      >
                        <PencilGlyph color={theme.accent} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Delete ${category.name}`}
                        accessibilityRole="button"
                        style={pressable(styles.categoryIconButton, styles.buttonPressed)}
                        onPress={() => confirmDeleteCategory(category)}
                      >
                        <ArchiveGlyph color={theme.danger} />
                      </Pressable>
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
                          <PinGlyph color={theme.accent} />
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
                  <PinGlyph color={theme.accent} />
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
                <PlusGlyph color={theme.mode === "dark" ? theme.background : "#FFFFFF"} />
              </Pressable>
            </View>
          </View>

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

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Places</Text>
            <Text style={styles.muted}>
              Places help Dayframe recognise where time was spent. Visits are reviewed before becoming time entries.
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

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Device sync</Text>
            <Text style={styles.statusText}>{deviceSyncStatus}</Text>
            {lastSyncResult?.firstError ? (
              <Text style={styles.muted}>Some queued data still needs attention. Details are available below.</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={pressable(styles.detailsToggle, styles.buttonPressed)}
              onPress={() => setShowQueueDetails((current) => !current)}
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
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Location</Text>
            <Text style={styles.muted}>
              Enable location to let Dayframe suggest activity from places you visit. Ambiguous stays are sent
              to review before they become time entries.
            </Text>
            <Text style={styles.statusText}>{locationStatus}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={enableLocation}>
                <Text style={styles.secondaryButtonText}>Enable</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Apple Health</Text>
            <Text style={styles.muted}>
              Sleep and workouts are queued as health activity events first, then reviewed before becoming
              trusted time entries.
            </Text>
            <Text style={styles.statusText}>
              {healthAvailability?.notes ?? "Apple Health status not checked"}
            </Text>
            {healthPermissionStatus ? <Text style={styles.muted}>{healthPermissionStatus.notes}</Text> : null}
            <Text style={styles.muted}>Sleep: {sleepStatus?.notes ?? "Not synced yet."}</Text>
            <Text style={styles.muted}>Workouts: {workoutStatus?.notes ?? "Not synced yet."}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={connectAppleHealth}>
                <Text style={styles.secondaryButtonText}>Connect</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={() => syncAppleHealth()}>
                <Text style={styles.secondaryButtonText}>Sync now</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BackGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M15 5 8 12l7 7" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} />
    </Svg>
  );
}

function PencilGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M4 20h4l10.5-10.5-4-4L4 16v4Z" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
      <Path d="m13.5 6.5 4 4" stroke={color} strokeLinecap="round" strokeWidth={2} />
    </Svg>
  );
}

function ArchiveGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M5 7h14" stroke={color} strokeLinecap="round" strokeWidth={2} />
      <Path d="M9 7V5h6v2" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
      <Path d="M8 10v9h8v-9" fill="none" stroke={color} strokeLinejoin="round" strokeWidth={2} />
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
  unknown_stay: "Unknown stay",
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
