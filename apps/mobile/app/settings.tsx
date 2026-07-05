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
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { paletteColorFor } from "@dayframe/shared";
import {
  AuthRequiredError,
  createCategory,
  fetchBootstrap,
  logout,
  readQueue,
  syncQueue,
  type MobileBootstrap,
  type QueuedEvent
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
  requestHealthKitSleepPermission,
  requestHealthKitWorkoutPermission,
  type HealthImportStatus
} from "@/lib/health";
import {
  pressable,
  themeOptions,
  useMobileTheme
} from "@/lib/mobileTheme";

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
  const [loading, setLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Not requested");
  const [healthStatus, setHealthStatus] = useState<HealthImportStatus[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pinNewCategory, setPinNewCategory] = useState(true);
  const refreshInFlight = useRef(false);

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

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await createCategory(name, { isPinned: pinNewCategory });
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

  async function syncAndReload() {
    try {
      const result = await syncQueue();
      setQueue(result.remaining);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.replace("/");
        return;
      }
      Alert.alert("Device sync", error instanceof Error ? error.message : "Unable to sync queued events.");
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
      const sleep = await requestHealthKitSleepPermission();
      updateHealthStatus(sleep);
      const workout = await requestHealthKitWorkoutPermission();
      updateHealthStatus(workout);
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health permission"));
    }
  }

  async function syncAppleHealth() {
    try {
      const sleep = await importHealthKitSleep();
      updateHealthStatus(sleep);
      const workout = await importHealthKitWorkouts();
      updateHealthStatus(workout);
      await syncAndReload();
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "sync Apple Health"));
    }
  }

  function updateHealthStatus(status: HealthImportStatus) {
    setHealthStatus((current) => [
      status,
      ...current.filter((item) => !(item.provider === status.provider && item.kind === status.kind))
    ]);
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
              accessibilityRole="button"
              style={pressable(styles.secondaryButton, styles.buttonPressed)}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
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
              {(data?.categories ?? []).slice(0, 8).map((category) => (
                <View key={category.id} style={styles.categoryRow}>
                  <View style={[styles.colorDot, { backgroundColor: paletteColorFor(category.color, category.name) }]} />
                  <Text style={styles.categoryName}>{category.name}</Text>
                  {category.isPinned ? <Text style={styles.categoryMeta}>Pinned</Text> : null}
                </View>
              ))}
            </View>
            <TextInput
              style={styles.textInput}
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              onSubmitEditing={addCategory}
              placeholder="New category"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
            />
            <View style={styles.buttonRow}>
              <Pressable
                style={pressable(
                  [styles.secondaryButton, pinNewCategory ? styles.toggleSelected : null],
                  styles.buttonPressed
                )}
                onPress={() => setPinNewCategory((current) => !current)}
              >
                <Text style={styles.secondaryButtonText}>{pinNewCategory ? "Pinned" : "Pin later"}</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={addCategory}>
                <Text style={styles.secondaryButtonText}>Create category</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Account</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={signOut}>
                <Text style={styles.secondaryButtonText}>Log out</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Device sync</Text>
            <Text style={styles.statusText}>{queue.length} queued events</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={syncAndReload}>
                <Text style={styles.secondaryButtonText}>Sync now</Text>
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
            <Text style={styles.muted}>Sleep: {sleepStatus?.notes ?? "Not synced yet."}</Text>
            <Text style={styles.muted}>Workouts: {workoutStatus?.notes ?? "Not synced yet."}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={connectAppleHealth}>
                <Text style={styles.secondaryButtonText}>Connect Apple Health</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={syncAppleHealth}>
                <Text style={styles.secondaryButtonText}>Sync Apple Health</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
