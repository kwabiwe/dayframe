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
  Text,
  TextInput,
  View
} from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { paletteColorFor } from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { useKeyboardAccessory, type KeyboardAccessoryField } from "@/components/KeyboardAccessory";
import {
  AuthRequiredError,
  deleteTimeEntry,
  enqueueEvent,
  fetchBootstrap,
  isNetworkTimerError,
  login,
  queueStopTimer,
  signup,
  startTimer,
  stopTimer,
  syncQueue,
  updateTimeEntry,
  type MobileBootstrap,
  type TimeEntryUpdatePatch
} from "@/lib/api";
import { handleDayframeUrl } from "@/lib/deepLinks";
import {
  pressable,
  useMobileTheme,
  type MobileStyles,
  type MobileTheme
} from "@/lib/mobileTheme";

type TimeEntry = MobileBootstrap["entries"][number];
type AuthView = "login" | "signup";
type AuthState = "checking" | "authenticated" | "signedOut";
type SummarySegment = {
  key: string;
  categoryName: string;
  seconds: number;
  share: number;
  color: string;
};

const AUTH_KEYBOARD_ACCESSORY_ID = "dayframe-auth-keyboard-accessory";
const START_TASK_KEYBOARD_ACCESSORY_ID = "dayframe-start-task-keyboard-accessory";
const RECENT_LAST_STOP_WINDOW_MS = 24 * 60 * 60 * 1000;

export default function HomeScreen() {
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authView, setAuthView] = useState<AuthView>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authWorkspace, setAuthWorkspace] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [customDescription, setCustomDescription] = useState("");
  const [activeEditVisible, setActiveEditVisible] = useState(false);
  const [activeEditSaving, setActiveEditSaving] = useState(false);
  const [activeEditStopping, setActiveEditStopping] = useState(false);
  const [chartProgress, setChartProgress] = useState(1);
  const refreshInFlight = useRef(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const chartBuild = useRef(new Animated.Value(1)).current;
  const authNameRef = useRef<TextInput>(null);
  const authWorkspaceRef = useRef<TextInput>(null);
  const authEmailRef = useRef<TextInput>(null);
  const authPasswordRef = useRef<TextInput>(null);
  const startTaskRef = useRef<TextInput>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!options?.silent) setLoading(true);
    try {
      const bootstrap = await fetchBootstrap();
      setData(bootstrap);
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
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reloadThemePreference();
      if (authState === "authenticated") void load({ silent: true });
    }, [authState, load, reloadThemePreference])
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
      if (state === "active" && authState === "authenticated") void load({ silent: true });
    });
    return () => subscription.remove();
  }, [authState, load]);

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
  const startTaskKeyboardFields = useMemo<KeyboardAccessoryField[]>(() => [
    { id: "start-task-description", ref: startTaskRef }
  ], []);
  const startTaskKeyboard = useKeyboardAccessory({
    nativeID: START_TASK_KEYBOARD_ACCESSORY_ID,
    fields: startTaskKeyboardFields,
    theme
  });
  const activeDurationSeconds = data?.activeEntry
    ? Math.max(
        data.activeEntry.durationSeconds,
        Math.floor((now - new Date(data.activeEntry.startedAt).getTime()) / 1000)
      )
    : 0;
  const summarySegments = useMemo(
    () => buildTodaySummarySegments(data?.entries ?? [], now),
    [data?.entries, now]
  );
  const summaryTotal = summarySegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const activeCategoryColor = data?.activeEntry?.categoryName
    ? paletteColorFor(data.activeEntry.categoryId, data.activeEntry.categoryName)
    : null;
  const activeDescription = displayTimerDescription(data?.activeEntry);
  const recentStoppedAt = useMemo(
    () => recentStoppedEntryTime(data?.entries ?? [], data?.activeEntry ?? null),
    [data?.activeEntry, data?.entries]
  );

  useEffect(() => {
    if (!data?.activeEntry && activeEditVisible) setActiveEditVisible(false);
  }, [activeEditVisible, data?.activeEntry]);

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
  }, [chartBuild, summarySegments.length]);

  async function startTask(categoryId?: string | null) {
    const trimmedDescription = customDescription.trim();
    try {
      await startTimer(categoryId, trimmedDescription);
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
      await enqueueEvent({
        source: "mobile_app",
        type: "timer_start",
        categoryId: categoryId ?? undefined,
        description: trimmedDescription || undefined,
        rawPayload: { origin: "mobile_custom_start_fallback" }
      });
      if (trimmedDescription) setCustomDescription("");
      await syncAndReload();
    }
  }

  async function syncAndReload() {
    try {
      await syncQueue();
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

  async function saveActiveTimerEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    setActiveEditSaving(true);
    try {
      await updateTimeEntry(entryId, patch);
      await load();
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setActiveEditVisible(false);
        setAuthState("signedOut");
        setData(null);
        return false;
      }
      Alert.alert(
        "Timer not saved",
        isNetworkTimerError(error)
          ? "Your changes were not saved. Check your connection and try again."
          : error instanceof Error ? error.message : "Unable to save this timer."
      );
      return false;
    } finally {
      setActiveEditSaving(false);
    }
  }

  async function stopActiveTimer() {
    setActiveEditStopping(true);
    try {
      await stopTimer();
      await load();
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setActiveEditVisible(false);
        setAuthState("signedOut");
        setData(null);
        return false;
      }
      if (!isNetworkTimerError(error)) {
        Alert.alert("Timer not stopped", error instanceof Error ? error.message : "Unable to stop this timer.");
        return false;
      }
      await queueStopTimer();
      await syncAndReload();
      return true;
    } finally {
      setActiveEditStopping(false);
    }
  }

  function confirmDeleteActiveTimer() {
    const activeEntry = data?.activeEntry;
    if (!activeEntry) return;

    Alert.alert(
      "Delete running timer",
      "Delete this running timer? This removes the entry instead of stopping it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteActiveTimer(activeEntry.id);
          }
        }
      ]
    );
  }

  async function deleteActiveTimer(entryId: string) {
    try {
      await deleteTimeEntry(entryId);
      await load();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      Alert.alert("Timer not deleted", error instanceof Error ? error.message : "Unable to delete this timer.");
    }
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
                {loading ? "Working..." : authView === "signup" ? "Create account" : "Log in"}
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
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              style={pressable(styles.iconButton, styles.buttonPressed)}
              onPress={() => router.push("./settings")}
            >
              <SettingsGlyph color={theme.accent} />
            </Pressable>
          </View>

          <Pressable
            accessibilityLabel={data?.activeEntry ? "Edit running timer" : undefined}
            accessibilityRole={data?.activeEntry ? "button" : undefined}
            disabled={!data?.activeEntry}
            onPress={() => setActiveEditVisible(true)}
            style={({ pressed }) => [
              styles.timerPanel,
              pressed && data?.activeEntry ? styles.buttonPressed : null
            ]}
          >
            <View style={styles.activeTimerHeader}>
              {data?.activeEntry ? (
                <View style={styles.activeTimerTextStack}>
                  <Text style={styles.label}>Active timer</Text>
                  <View style={styles.activeTitleRow}>
                    {activeCategoryColor ? (
                      <View style={[styles.colorDot, { backgroundColor: activeCategoryColor }]} />
                    ) : null}
                    <Text style={[styles.timerText, styles.activeTitleText]} numberOfLines={2}>
                      {activeDescription ?? data.activeEntry.categoryName ?? "Running"}
                    </Text>
                  </View>
                  {activeDescription && data.activeEntry.categoryName ? (
                    <Text style={styles.activeDescription}>{data.activeEntry.categoryName}</Text>
                  ) : null}
                  <Text style={styles.muted}>{formatClockDuration(activeDurationSeconds)} running</Text>
                </View>
              ) : (
                <View style={styles.activeTimerTextStack}>
                  <Text style={styles.label}>Active timer</Text>
                  <View style={styles.activeTitleRow}>
                    <Text style={[styles.timerText, styles.activeTitleText]} numberOfLines={2}>
                      Start task below
                    </Text>
                  </View>
                </View>
              )}
              {data?.activeEntry ? (
                <View style={styles.activeTimerActions}>
                  <Pressable
                    accessibilityLabel="Stop current timer"
                    accessibilityRole="button"
                    style={pressable(styles.stopButton, styles.buttonPressed)}
                    onPress={(event) => {
                      event.stopPropagation();
                      void stopActiveTimer();
                    }}
                  >
                    <StopGlyph color={theme.mode === "dark" ? theme.background : "#FFFFFF"} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Delete running timer"
                    accessibilityRole="button"
                    style={pressable(styles.deleteTimerButton, styles.buttonPressed)}
                    onPress={(event) => {
                      event.stopPropagation();
                      confirmDeleteActiveTimer();
                    }}
                  >
                    <TrashGlyph color={theme.danger} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Pressable>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Start task</Text>
            <View style={styles.startInputRow}>
              <TextInput
                ref={startTaskRef}
                style={[styles.textInput, styles.startInput]}
                value={customDescription}
                onChangeText={setCustomDescription}
                onSubmitEditing={() => startTask(null)}
                placeholder="What are you working on?"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                {...startTaskKeyboard.getTextInputProps("start-task-description")}
              />
              <Pressable
                accessibilityLabel="Start task"
                accessibilityRole="button"
                style={pressable(styles.playButton, styles.buttonPressed)}
                onPress={() => startTask(null)}
              >
                <PlayGlyph color={theme.mode === "dark" ? theme.background : "#FFFFFF"} />
              </Pressable>
            </View>
            {quickActions.length > 0 ? (
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.compactCategoryScroller}
              >
                {quickActions.map((category) => {
                  const categoryColor = paletteColorFor(category.color, category.name);
                  return (
                    <Pressable
                      key={category.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Start ${category.name}`}
                      style={pressable(
                        [styles.categoryPill, { borderColor: categoryColor }],
                        styles.buttonPressed
                      )}
                      onPress={() => startTask(category.id)}
                    >
                      <View style={[styles.colorDot, { backgroundColor: categoryColor }]} />
                      <Text style={styles.categoryPillText}>{category.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={styles.quickCategoryHint}>Pin categories in Settings</Text>
            )}
          </View>

          <TodaySummary
            chartProgress={chartProgress}
            segments={summarySegments}
            styles={styles}
            theme={theme}
            total={summaryTotal}
          />
        </Animated.View>
      </ScrollView>
      <ActiveTimerEditSheet
        categories={data?.categories ?? []}
        elapsedSeconds={activeDurationSeconds}
        entry={data?.activeEntry ?? null}
        lastStoppedAt={recentStoppedAt}
        onCancel={() => setActiveEditVisible(false)}
        onSave={saveActiveTimerEdit}
        onStop={stopActiveTimer}
        saving={activeEditSaving}
        stopping={activeEditStopping}
        styles={styles}
        theme={theme}
        visible={activeEditVisible}
      />
      {startTaskKeyboard.accessory}
    </SafeAreaView>
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

function PlayGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d="M8 5v14l11-7L8 5Z" fill={color} />
    </Svg>
  );
}

function StopGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M7 7h10v10H7V7Z" fill={color} />
    </Svg>
  );
}

function TrashGlyph({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M9 4h6l1 2h4v2H4V6h4l1-2Zm-2 6h10l-.7 10H7.7L7 10Zm3 2v6h1.5v-6H10Zm2.5 0v6H14v-6h-1.5Z"
        fill={color}
      />
    </Svg>
  );
}

function TodaySummary({
  chartProgress,
  segments,
  styles,
  theme,
  total
}: {
  chartProgress: number;
  segments: SummarySegment[];
  styles: MobileStyles;
  theme: MobileTheme;
  total: number;
}) {
  return (
    <View style={styles.lifecyclePanel}>
      <View style={styles.summaryHeader}>
        <View>
          <Text style={styles.label}>Today summary</Text>
          <Text style={styles.sectionTitle}>Today</Text>
        </View>
        <Text style={styles.summaryTotal}>{formatDuration(total)}</Text>
      </View>

      <View style={styles.chartWrap}>
        <DonutChart progress={chartProgress} segments={segments} styles={styles} theme={theme} total={total} />
      </View>

      <View style={styles.legendList}>
        {segments.length === 0 ? (
          <Text style={styles.muted}>No tracked time today.</Text>
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
  styles: MobileStyles;
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

function buildTodaySummarySegments(entries: TimeEntry[], now: number): SummarySegment[] {
  const periodStart = startOfToday(now);
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
  return data.categories.filter((category) => category.isPinned).slice(0, 8);
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

function displayTimerDescription(entry: MobileBootstrap["activeEntry"] | null | undefined) {
  if (!entry?.description) return null;
  return entry.description === "Start activity" ? null : entry.description;
}

function startOfToday(now: number) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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
