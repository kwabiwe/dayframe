import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type ViewStyle
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Circle, G, Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { DAYFRAME_THEME, paletteColorFor } from "@dayframe/shared";
import {
  requestLocationAccess,
  refreshGeofencesForPlaces,
  startGeofences
} from "@/lib/geofence";
import {
  getHealthImportStatus,
  importHealthKitSleep,
  importHealthKitWorkouts,
  friendlyHealthKitError,
  requestHealthKitSleepPermission,
  requestHealthKitWorkoutPermission,
  type HealthImportStatus
} from "@/lib/health";
import {
  AuthRequiredError,
  createCategory,
  enqueueEvent,
  fetchBootstrap,
  isNetworkTimerError,
  login,
  logout,
  queueStopTimer,
  readQueue,
  signup,
  startTimer,
  stopTimer,
  syncQueue,
  type MobileBootstrap,
  type QueuedEvent
} from "@/lib/api";
import { handleDayframeUrl } from "@/lib/deepLinks";

type ThemeMode = "light" | "dark";
type ThemePreference = ThemeMode | "system";
type MobileTheme = (typeof DAYFRAME_THEME)[ThemeMode] & {
  mode: ThemeMode;
  chartTrack: string;
  pressed: string;
};
type TimeEntry = MobileBootstrap["entries"][number];
type SummaryPeriod = "day" | "week" | "month" | "year";
type AuthView = "login" | "signup";
type AuthState = "checking" | "authenticated" | "signedOut";
type SummarySegment = {
  key: string;
  categoryName: string;
  seconds: number;
  share: number;
  color: string;
};

const periodLabels: Record<SummaryPeriod, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year"
};
const themeOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];
const THEME_PREFERENCE_KEY = "dayframe.themePreference.v1";

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const resolvedThemeMode = themePreference === "system"
    ? colorScheme === "light" ? "light" : "dark"
    : themePreference;
  const theme = useMemo(() => createMobileTheme(resolvedThemeMode), [resolvedThemeMode]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authView, setAuthView] = useState<AuthView>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authWorkspace, setAuthWorkspace] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState("Not requested");
  const [healthStatus, setHealthStatus] = useState<HealthImportStatus[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [customDescription, setCustomDescription] = useState("");
  const [customCategoryId, setCustomCategoryId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pinNewCategory, setPinNewCategory] = useState(true);
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>("day");
  const [chartProgress, setChartProgress] = useState(1);
  const refreshInFlight = useRef(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const chartBuild = useRef(new Animated.Value(1)).current;

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!options?.silent) setLoading(true);
    try {
      const [bootstrap, queued] = await Promise.all([fetchBootstrap(), readQueue()]);
      setData(bootstrap);
      setQueue(queued);
      setAuthState("authenticated");
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setData(null);
        setAuthState("signedOut");
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
    Animated.timing(entrance, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [entrance]);

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREFERENCE_KEY)
      .then((value) => {
        if (value === "system" || value === "light" || value === "dark") setThemePreferenceState(value);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      if (state === "active" && authState === "authenticated") void load({ silent: true });
    });
    return () => subscription.remove();
  }, [authState, load]);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", async ({ url }) => {
      await handleDayframeUrl(url);
      setQueue(await readQueue());
    });
    Linking.getInitialURL().then(async (url) => {
      if (!url) return;
      await handleDayframeUrl(url);
      setQueue(await readQueue());
    });
    return () => subscription.remove();
  }, []);

  const quickActions = useMemo(() => buildMobileQuickActions(data), [data]);
  const selectedCustomCategory = useMemo(
    () => data?.categories.find((category) => category.id === customCategoryId) ?? data?.categories[0],
    [customCategoryId, data?.categories]
  );
  const activeDurationSeconds = data?.activeEntry
    ? Math.max(
        data.activeEntry.durationSeconds,
        Math.floor((now - new Date(data.activeEntry.startedAt).getTime()) / 1000)
      )
    : 0;
  const summarySegments = useMemo(
    () => buildSummarySegments(data?.entries ?? [], summaryPeriod, now),
    [data?.entries, now, summaryPeriod]
  );
  const summaryTotal = summarySegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const places = data?.places ?? [];
  const healthAvailability =
    healthStatus.find((item) => item.provider === "healthkit" && item.kind === "availability") ??
    healthStatus.find((item) => item.provider === "healthkit");
  const sleepStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "sleep");
  const workoutStatus = healthStatus.find((item) => item.provider === "healthkit" && item.kind === "workout");

  useEffect(() => {
    if (!customCategoryId && data?.categories[0]) setCustomCategoryId(data.categories[0].id);
  }, [customCategoryId, data?.categories]);

  useEffect(() => {
    if (authState !== "authenticated" || !data?.places.length) return;
    refreshGeofencesForPlaces(data.places)
      .then((count) => {
        if (count > 0) setLocationStatus(`Monitoring ${count} places`);
      })
      .catch(() => undefined);
  }, [authState, data?.places]);

  useEffect(() => {
    chartBuild.stopAnimation();
    chartBuild.setValue(0);
    const listenerId = chartBuild.addListener(({ value }) => setChartProgress(value));
    Animated.timing(chartBuild, {
      toValue: 1,
      duration: 720,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start();

    return () => {
      chartBuild.removeListener(listenerId);
    };
  }, [chartBuild, summaryPeriod, summarySegments.length]);

  async function quickStart(categoryId?: string | null) {
    try {
      await startTimer(categoryId);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      if (!isNetworkTimerError(error)) {
        Alert.alert("Timer not started", error instanceof Error ? error.message : "Unable to start this timer.");
        return;
      }
      const nextQueue = await enqueueEvent({
        source: "mobile_app",
        type: "quick_action",
        categoryId: categoryId ?? undefined,
        rawPayload: { origin: "mobile_quick_action_fallback" }
      });
      setQueue(nextQueue);
      await syncAndReload();
    }
  }

  async function customStart() {
    const trimmedDescription = customDescription.trim();
    try {
      await startTimer(
        selectedCustomCategory?.id,
        trimmedDescription
      );
      if (trimmedDescription) setCustomDescription("");
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      if (!isNetworkTimerError(error)) {
        Alert.alert("Timer not started", error instanceof Error ? error.message : "Unable to start this timer.");
        return;
      }
      const nextQueue = await enqueueEvent({
        source: "mobile_app",
        type: "timer_start",
        categoryId: selectedCustomCategory?.id,
        description: trimmedDescription || undefined,
        rawPayload: { origin: "mobile_custom_start_fallback" }
      });
      setQueue(nextQueue);
      if (trimmedDescription) setCustomDescription("");
      await syncAndReload();
    }
  }

  async function syncAndReload() {
    try {
      const result = await syncQueue();
      setQueue(result.remaining);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      throw error;
    }
  }

  async function setThemePreference(nextPreference: ThemePreference) {
    setThemePreferenceState(nextPreference);
    await AsyncStorage.setItem(THEME_PREFERENCE_KEY, nextPreference);
  }

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
        setAuthState("signedOut");
        setData(null);
        return;
      }
      Alert.alert("Categories", error instanceof Error ? error.message : "Unable to create category.");
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

  async function connectHealthKit() {
    try {
      const status = await requestHealthKitSleepPermission();
      updateHealthStatus(status);
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health permission"));
    }
  }

  async function connectHealthKitWorkouts() {
    try {
      const status = await requestHealthKitWorkoutPermission();
      updateHealthStatus(status);
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "request Apple Health workout permission"));
    }
  }

  async function syncHealthKitSleep() {
    try {
      const status = await importHealthKitSleep();
      updateHealthStatus(status);
      await syncAndReload();
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "sync Apple Health sleep"));
    }
  }

  async function syncHealthKitWorkouts() {
    try {
      const status = await importHealthKitWorkouts();
      updateHealthStatus(status);
      await syncAndReload();
    } catch (error) {
      Alert.alert("Apple Health", friendlyHealthKitError(error, "sync Apple Health workouts"));
    }
  }

  function updateHealthStatus(status: HealthImportStatus) {
    setHealthStatus((current) => [
      status,
      ...current.filter((item) => !(item.provider === status.provider && item.kind === status.kind))
    ]);
  }

  async function submitAuth() {
    setAuthError(null);
    setAuthNotice(null);
    setLoading(true);
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
      setLoading(false);
    }
  }

  async function signOut() {
    await logout();
    setData(null);
    setQueue(await readQueue());
    setAuthState("signedOut");
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
              <Image
                source={require("../assets/dayframe_logo_banner.png")}
                style={styles.logoImage}
                resizeMode="contain"
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
                  style={styles.textInput}
                  value={authName}
                  onChangeText={setAuthName}
                  placeholder="Name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                />
                <TextInput
                  style={styles.textInput}
                  value={authWorkspace}
                  onChangeText={setAuthWorkspace}
                  placeholder="Workspace"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                />
              </>
            ) : null}
            <TextInput
              style={styles.textInput}
              value={authEmail}
              onChangeText={setAuthEmail}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextInput
              style={styles.textInput}
              value={authPassword}
              onChangeText={setAuthPassword}
              placeholder="Password"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              textContentType={authView === "signup" ? "newPassword" : "password"}
            />
            {authNotice ? <Text style={styles.statusText}>{authNotice}</Text> : null}
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <Pressable style={pressable(styles.primaryButton, styles.buttonPressed)} onPress={submitAuth}>
              <Text style={styles.primaryButtonText}>
                {loading ? "Working..." : authView === "signup" ? "Create account" : "Log in"}
              </Text>
            </Pressable>
            <Pressable
              style={pressable(styles.secondaryButton, styles.buttonPressed)}
              onPress={() => {
                setAuthError(null);
                setAuthView(authView === "signup" ? "login" : "signup");
              }}
            >
              <Text style={styles.secondaryButtonText}>
                {authView === "signup" ? "Use existing account" : "Create account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
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
        <Animated.View style={[styles.contentStack, enteringStyle]}>
          <View style={styles.header}>
            <View style={styles.logoLockup}>
              <Image
                source={require("../assets/dayframe_logo_banner.png")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
          </View>

          <View style={styles.timerPanel}>
            <Text style={styles.label}>Active timer</Text>
            <Text style={styles.timerText}>
              {data?.activeEntry
                ? data.activeEntry.description ?? data.activeEntry.categoryName ?? "Running"
                : "No timer"}
            </Text>
            {data?.activeEntry?.categoryName ? (
              <Text style={styles.activeDescription}>{data.activeEntry.categoryName}</Text>
            ) : null}
            <Text style={styles.muted}>
              {data?.activeEntry
                ? `${formatClockDuration(activeDurationSeconds)} running`
                : "Start a task now, then add detail when you need it."}
            </Text>
            {data?.activeEntry ? (
              <Pressable
                style={pressable(styles.primaryButton, styles.buttonPressed)}
                onPress={async () => {
                  try {
                    await stopTimer();
                    await load();
                  } catch (error) {
                    if (error instanceof AuthRequiredError) {
                      setAuthState("signedOut");
                      setData(null);
                      return;
                    }
                    if (!isNetworkTimerError(error)) {
                      Alert.alert("Timer not stopped", error instanceof Error ? error.message : "Unable to stop this timer.");
                      return;
                    }
                    setQueue(await queueStopTimer());
                    await syncAndReload();
                  }
                }}
              >
                <Text style={styles.primaryButtonText}>Stop current timer</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Start task</Text>
            <TextInput
              style={styles.textInput}
              value={customDescription}
              onChangeText={setCustomDescription}
              onSubmitEditing={customStart}
              placeholder="What are you working on?"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
            />
            <Text style={styles.label}>Category</Text>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.projectPicker}
            >
              {(data?.categories ?? []).map((category) => {
                const selected = category.id === selectedCustomCategory?.id;
                const categoryColor = paletteColorFor(category.color, category.name);
                return (
                  <Pressable
                    key={category.id}
                    style={pressable(
                      [styles.projectPill, selected ? styles.projectPillSelected : null],
                      styles.buttonPressed
                    )}
                    onPress={() => setCustomCategoryId(category.id)}
                  >
                    <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
                    <Text style={[styles.projectPillText, selected ? styles.projectPillTextSelected : null]}>
                      {category.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable style={pressable(styles.primaryButton, styles.buttonPressed)} onPress={customStart}>
              <Text style={styles.primaryButtonText}>Start task</Text>
            </Pressable>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick categories</Text>
            <Text style={styles.muted}>{quickActions.length} ready</Text>
          </View>
          <View style={styles.quickGrid}>
            {quickActions.map((category) => (
              <Pressable
                key={category.id}
                style={pressable(styles.quickButton, styles.buttonPressed)}
                onPress={() => quickStart(category.id)}
              >
                <View style={[styles.colorRule, { backgroundColor: paletteColorFor(category.color, category.name) }]} />
                <Text style={styles.quickTitle}>{category.name}</Text>
                <Text style={styles.quickMeta}>Start now</Text>
              </Pressable>
            ))}
          </View>

          <LifecycleSummary
            chartProgress={chartProgress}
            period={summaryPeriod}
            segments={summarySegments}
            setPeriod={setSummaryPeriod}
            styles={styles}
            theme={theme}
            total={summaryTotal}
          />

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Profile & settings</Text>
            <Text style={styles.muted}>Account, sync and device permissions.</Text>
            <View style={styles.settingsDivider} />
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
            <View style={styles.settingsDivider} />
            <Text style={styles.label}>Categories</Text>
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
            <View style={styles.settingsDivider} />
            <Text style={styles.label}>Profile</Text>
            <View style={styles.buttonRow}>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={signOut}>
                <Text style={styles.secondaryButtonText}>Log out</Text>
              </Pressable>
            </View>
            <View style={styles.settingsDivider} />
            <Text style={styles.label}>Device sync</Text>
            <View style={styles.row}>
              <Text style={styles.statusText}>{queue.length} queued events</Text>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={syncAndReload}>
                <Text style={styles.secondaryButtonText}>Sync now</Text>
              </Pressable>
            </View>
            <View style={styles.settingsDivider} />
            <Text style={styles.label}>Location</Text>
            <Text style={styles.muted}>
              Enable location to let Dayframe suggest activity from places you visit. Ambiguous stays are sent
              to review before they become time entries.
            </Text>
            <View style={styles.row}>
              <Text style={styles.statusText}>{locationStatus}</Text>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={enableLocation}>
                <Text style={styles.secondaryButtonText}>Enable</Text>
              </Pressable>
            </View>

            <View style={styles.settingsDivider} />
            <Text style={styles.label}>Apple Health</Text>
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
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={connectHealthKit}>
                <Text style={styles.secondaryButtonText}>Sleep access</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={syncHealthKitSleep}>
                <Text style={styles.secondaryButtonText}>Sync sleep</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={connectHealthKitWorkouts}>
                <Text style={styles.secondaryButtonText}>Workout access</Text>
              </Pressable>
              <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={syncHealthKitWorkouts}>
                <Text style={styles.secondaryButtonText}>Sync workouts</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LifecycleSummary({
  chartProgress,
  period,
  segments,
  setPeriod,
  styles,
  theme,
  total
}: {
  chartProgress: number;
  period: SummaryPeriod;
  segments: SummarySegment[];
  setPeriod: (period: SummaryPeriod) => void;
  styles: ReturnType<typeof createStyles>;
  theme: MobileTheme;
  total: number;
}) {
  return (
    <View style={styles.lifecyclePanel}>
      <View style={styles.summaryHeader}>
        <View>
          <Text style={styles.label}>Activity summary</Text>
          <Text style={styles.sectionTitle}>{periodTitle(period)}</Text>
        </View>
        <Text style={styles.summaryTotal}>{formatDuration(total)}</Text>
      </View>

      <View style={styles.segmentedControl}>
        {(Object.keys(periodLabels) as SummaryPeriod[]).map((option) => {
          const selected = option === period;
          return (
            <Pressable
              key={option}
              style={pressable(
                [styles.segmentButton, selected ? styles.segmentButtonSelected : null],
                styles.buttonPressed
              )}
              onPress={() => setPeriod(option)}
            >
              <Text style={[styles.segmentButtonText, selected ? styles.segmentButtonTextSelected : null]}>
                {periodLabels[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chartWrap}>
        <DonutChart progress={chartProgress} segments={segments} styles={styles} theme={theme} total={total} />
      </View>

      <View style={styles.legendList}>
        {segments.length === 0 ? (
          <Text style={styles.muted}>No tracked time for this period.</Text>
        ) : null}
        {segments.map((segment) => (
          <View key={segment.key} style={styles.legendRow}>
            <View style={[styles.legendSwatch, { backgroundColor: segment.color }]} />
            <View style={styles.legendText}>
              <Text style={styles.legendPlace}>{segment.categoryName}</Text>
              <Text style={styles.legendProject}>Category</Text>
            </View>
            <View style={styles.legendNumbers}>
              <Text style={styles.legendDuration}>{formatDuration(segment.seconds)}</Text>
              <Text style={styles.legendShare}>{segment.share}%</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
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
  styles: ReturnType<typeof createStyles>;
  theme: MobileTheme;
  total: number;
}) {
  const size = 264;
  const center = size / 2;
  const outerRadius = 122;
  const innerRadius = 58;
  let cursor = 0;

  return (
    <View style={styles.chartBox}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={center} cy={center} r={outerRadius} fill={theme.chartTrack} />
        <Circle cx={center} cy={center} r={innerRadius} fill={theme.surface} />
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
                    fill={segment.color}
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

function createMobileTheme(mode: ThemeMode): MobileTheme {
  const base = DAYFRAME_THEME[mode];
  return {
    ...base,
    mode,
    chartTrack: mode === "dark" ? "#161A13" : "#E2E9D8",
    pressed: mode === "dark" ? "#1B2114" : "#E9F2DE"
  };
}

function buildSummarySegments(entries: TimeEntry[], period: SummaryPeriod, now: number): SummarySegment[] {
  const periodStart = startOfPeriod(period, now);
  const totals = new Map<string, Omit<SummarySegment, "share">>();

  for (const entry of entries) {
    const startedAt = new Date(entry.startedAt).getTime();
    if (startedAt < periodStart) continue;
    const categoryName = entry.categoryName ?? "Uncategorized";
    const key = entry.categoryId ?? "uncategorized";
    const current = totals.get(key);
    const seconds = entry.stoppedAt
      ? entry.durationSeconds
      : Math.max(entry.durationSeconds, Math.floor((now - startedAt) / 1000));

    totals.set(key, {
      key,
      categoryName,
      seconds: (current?.seconds ?? 0) + seconds,
      color: current?.color ?? paletteColorFor(entry.categoryId, categoryName)
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

function buildMobileQuickActions(data: MobileBootstrap | null) {
  if (!data) return [];
  const categoriesById = new Map(data.categories.map((category) => [category.id, category]));
  const scored = new Map<string, { count: number; lastSeen: number }>();

  for (const entry of data.entries) {
    if (!entry.categoryId) continue;
    const current = scored.get(entry.categoryId) ?? { count: 0, lastSeen: 0 };
    current.count += 1;
    current.lastSeen = Math.max(current.lastSeen, new Date(entry.startedAt).getTime());
    scored.set(entry.categoryId, current);
  }

  const learned = [...scored.entries()]
    .map(([categoryId, score]) => ({ score, category: categoriesById.get(categoryId) }))
    .filter((item): item is { score: { count: number; lastSeen: number }; category: MobileBootstrap["categories"][number] } =>
      Boolean(item.category)
    )
    .sort((a, b) => b.score.count - a.score.count || b.score.lastSeen - a.score.lastSeen)
    .map((item) => item.category);
  const pinned = data.categories.filter((category) => category.isPinned);
  const usedIds = new Set(pinned.map((category) => category.id));
  const learnedUnpinned = learned.filter((category) => !usedIds.has(category.id));
  for (const category of learnedUnpinned) usedIds.add(category.id);
  const fallback = data.categories.filter((category) => !usedIds.has(category.id));

  return [...pinned, ...learnedUnpinned, ...fallback].slice(0, 8);
}

function startOfPeriod(period: SummaryPeriod, now: number) {
  const date = new Date(now);
  if (period === "year") return new Date(date.getFullYear(), 0, 1).getTime();
  if (period === "month") return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  if (period === "week") {
    const day = date.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset).getTime();
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function periodTitle(period: SummaryPeriod) {
  switch (period) {
    case "day":
      return "Today";
    case "week":
      return "This week";
    case "month":
      return "This month";
    case "year":
      return "This year";
  }
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

function pressable(baseStyle: ViewStyle | Array<ViewStyle | null>, pressedStyle: ViewStyle) {
  return ({ pressed }: { pressed: boolean }) => [
    ...(Array.isArray(baseStyle) ? baseStyle : [baseStyle]),
    pressed ? pressedStyle : null
  ];
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

const monoFont = "System";

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.background
    },
    container: {
      padding: 18,
      backgroundColor: theme.background
    },
    contentStack: {
      gap: 18
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      paddingHorizontal: 6,
      paddingTop: 6
    },
    logoLockup: {
      flexShrink: 1,
      gap: 4
    },
    logoImage: {
      width: 158,
      height: 52
    },
    headerActions: {
      alignItems: "flex-end",
      gap: 8
    },
    title: {
      fontSize: 30,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    subtitle: {
      marginTop: 2,
      fontSize: 13,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    panel: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      gap: 10
    },
    timerPanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 16,
      padding: 16,
      gap: 10
    },
    lifecyclePanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      gap: 14
    },
    label: {
      fontSize: 11,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    timerText: {
      fontSize: 25,
      fontWeight: "800",
      color: theme.accent,
      fontFamily: monoFont
    },
    activeDescription: {
      fontSize: 14,
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    muted: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    sectionHeader: {
      gap: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      paddingBottom: 10
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    summaryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    summaryTotal: {
      color: theme.accent,
      fontFamily: monoFont,
      fontSize: 20,
      fontWeight: "800"
    },
    segmentedControl: {
      flexDirection: "row",
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      backgroundColor: theme.surfaceMuted,
      overflow: "hidden"
    },
    segmentButton: {
      flex: 1,
      alignItems: "center",
      borderRightWidth: 1,
      borderRightColor: theme.border,
      paddingVertical: 9
    },
    segmentButtonSelected: {
      backgroundColor: theme.surfaceInset
    },
    segmentButtonText: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontWeight: "700"
    },
    segmentButtonTextSelected: {
      color: theme.accent
    },
    chartWrap: {
      alignItems: "center",
      paddingVertical: 8
    },
    chartBox: {
      width: 264,
      height: 264,
      alignItems: "center",
      justifyContent: "center"
    },
    chartCenter: {
      position: "absolute",
      width: 116,
      height: 116,
      alignItems: "center",
      justifyContent: "center"
    },
    chartCenterLabel: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11
    },
    chartCenterValue: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 18,
      fontWeight: "800"
    },
    legendList: {
      gap: 10
    },
    legendRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 10
    },
    legendSwatch: {
      width: 12,
      height: 28,
      borderWidth: 1,
      borderColor: theme.borderStrong
    },
    legendText: {
      flex: 1,
      gap: 2
    },
    legendPlace: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "800"
    },
    legendProject: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    legendNumbers: {
      alignItems: "flex-end",
      gap: 2
    },
    legendDuration: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    legendShare: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 12
    },
    quickGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10
    },
    quickButton: {
      width: "48%",
      minHeight: 98,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      padding: 14,
      justifyContent: "space-between",
      overflow: "hidden"
    },
    colorRule: {
      height: 3,
      borderRadius: 999,
      marginBottom: 10
    },
    colorDot: {
      width: 12,
      height: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 999
    },
    categoryList: {
      gap: 8
    },
    categoryRow: {
      minHeight: 38,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    categoryName: {
      flex: 1,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    categoryMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11,
      fontWeight: "700"
    },
    textInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    projectPicker: {
      gap: 10,
      paddingRight: 4
    },
    projectPill: {
      minWidth: 150,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 14,
      padding: 12,
      gap: 6
    },
    projectPillSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    projectPillText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 14,
      fontWeight: "800"
    },
    projectPillTextSelected: {
      color: theme.accent
    },
    projectPillMeta: {
      color: theme.textSecondary,
      fontFamily: monoFont,
      fontSize: 11
    },
    quickTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    quickMeta: {
      fontSize: 12,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    primaryButton: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center"
    },
    buttonPressed: {
      opacity: 0.84,
      transform: [{ translateY: 1 }]
    },
    buttonDisabled: {
      opacity: 0.45
    },
    primaryButtonText: {
      color: theme.mode === "dark" ? theme.background : "#FFFFFF",
      fontWeight: "800",
      fontFamily: monoFont
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10
    },
    toggleSelected: {
      borderColor: theme.accent,
      backgroundColor: theme.surfaceMuted
    },
    syncButton: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    secondaryButtonText: {
      color: theme.accent,
      fontWeight: "800",
      fontFamily: monoFont
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10
    },
    settingsDivider: {
      height: 1,
      backgroundColor: theme.border,
      marginVertical: 8
    },
    buttonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10
    },
    statusText: {
      fontSize: 13,
      color: theme.textPrimary,
      fontWeight: "700",
      fontFamily: monoFont
    },
    errorText: {
      borderWidth: 1,
      borderColor: theme.danger,
      color: theme.danger,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      fontFamily: monoFont
    }
  });
}
