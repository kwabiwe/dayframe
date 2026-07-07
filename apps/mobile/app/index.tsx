import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
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
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
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
type MobileTab = "timer" | "calendar" | "reports";
type ReportRange = "today" | "week";
type CalendarEntry = TimeEntry & { isActive: boolean };
type SummarySegment = {
  key: string;
  categoryName: string;
  seconds: number;
  share: number;
  color: string;
};

const AUTH_KEYBOARD_ACCESSORY_ID = "dayframe-auth-keyboard-accessory";
const RECENT_LAST_STOP_WINDOW_MS = 24 * 60 * 60 * 1000;
const TAB_BAR_HEIGHT = 72;
const TIMELINE_START_HOUR = 6;
const TIMELINE_END_HOUR = 22;
const TIMELINE_HOUR_HEIGHT = 72;
const TIMELINE_MIN_BLOCK_HEIGHT = 44;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { reloadThemePreference, styles, theme } = useMobileTheme();
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [activeTab, setActiveTab] = useState<MobileTab>("timer");
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDateKey(new Date()));
  const [reportRange, setReportRange] = useState<ReportRange>("today");
  const [calendarEditEntry, setCalendarEditEntry] = useState<CalendarEntry | null>(null);
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
  const [calendarEditSaving, setCalendarEditSaving] = useState(false);
  const [chartProgress, setChartProgress] = useState(1);
  const refreshInFlight = useRef(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const chartBuild = useRef(new Animated.Value(1)).current;
  const authNameRef = useRef<TextInput>(null);
  const authWorkspaceRef = useRef<TextInput>(null);
  const authEmailRef = useRef<TextInput>(null);
  const authPasswordRef = useRef<TextInput>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!options?.silent) setLoading(true);
    try {
      const bootstrap = await fetchBootstrap({ date: formatDateKey(new Date()) });
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
  const activeDurationSeconds = data?.activeEntry
    ? Math.max(
        data.activeEntry.durationSeconds,
        Math.floor((now - new Date(data.activeEntry.startedAt).getTime()) / 1000)
      )
    : 0;
  const todayKey = useMemo(() => formatDateKey(new Date(now)), [now]);
  const weekDays = useMemo(
    () => buildWeekStripDays(data?.dateRange?.weekStart, now),
    [data?.dateRange?.weekStart, now]
  );
  const summaryEntries = useMemo(
    () => mergeActiveEntry(data?.dayEntries ?? data?.entries ?? [], data?.activeEntry ?? null),
    [data?.activeEntry, data?.dayEntries, data?.entries]
  );
  const summarySegments = useMemo(
    () => buildTodaySummarySegments(summaryEntries, now),
    [summaryEntries, now]
  );
  const summaryTotal = summarySegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const activeCategoryColor = data?.activeEntry?.categoryName
    ? paletteColorFor(data.activeEntry.categoryColor ?? data.activeEntry.categoryId, data.activeEntry.categoryName)
    : null;
  const activeDescription = displayTimerDescription(data?.activeEntry);
  const recentStoppedAt = useMemo(
    () => recentStoppedEntryTime(data?.entries ?? [], data?.activeEntry ?? null),
    [data?.activeEntry, data?.entries]
  );
  const calendarEntries = useMemo(
    () => buildCalendarEntries(data, selectedDayKey, now),
    [data, now, selectedDayKey]
  );
  const calendarTotal = useMemo(
    () => sumStartedInDaySeconds(calendarEntries, selectedDayKey, now),
    [calendarEntries, now, selectedDayKey]
  );
  const reports = useMemo(
    () => buildReports(data, reportRange, todayKey, now),
    [data, now, reportRange, todayKey]
  );

  useEffect(() => {
    if (weekDays.some((day) => day.key === selectedDayKey)) return;
    setSelectedDayKey(weekDays.some((day) => day.key === todayKey) ? todayKey : weekDays[0]?.key ?? todayKey);
  }, [selectedDayKey, todayKey, weekDays]);

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

  async function saveCalendarEntryEdit(entryId: string, patch: TimeEntryUpdatePatch) {
    setCalendarEditSaving(true);
    try {
      await updateTimeEntry(entryId, patch);
      await load();
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setCalendarEditEntry(null);
        setAuthState("signedOut");
        setData(null);
        return false;
      }
      Alert.alert(
        "Entry not saved",
        isNetworkTimerError(error)
          ? "Your changes were not saved. Check your connection and try again."
          : error instanceof Error ? error.message : "Unable to save this entry."
      );
      return false;
    } finally {
      setCalendarEditSaving(false);
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
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingBottom: 18 }
        ]}
        keyboardShouldPersistTaps="handled"
        scrollIndicatorInsets={{ bottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + 16 }}
        style={{ marginBottom: TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + 16 }}
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

          {activeTab === "timer" ? (
            <>
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
                    style={[styles.textInput, styles.startInput]}
                    value={customDescription}
                    onChangeText={setCustomDescription}
                    onSubmitEditing={() => startTask(null)}
                    placeholder="What are you working on?"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
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
            </>
          ) : null}

          {activeTab === "calendar" ? (
            <CalendarTab
              entries={calendarEntries}
              now={now}
              onOpenActive={() => {
                setCalendarEditEntry(null);
                setActiveEditVisible(true);
              }}
              onOpenDetail={setCalendarEditEntry}
              onSelectDay={setSelectedDayKey}
              selectedDayKey={selectedDayKey}
              styles={styles}
              theme={theme}
              todayKey={todayKey}
              total={calendarTotal}
              weekDays={weekDays}
            />
          ) : null}

          {activeTab === "reports" ? (
            <ReportsTab
              dailyBars={reports.dailyBars}
              range={reportRange}
              segments={reports.segments}
              styles={styles}
              theme={theme}
              todayTotal={reports.todayTotal}
              weekTotal={reports.weekTotal}
              onRangeChange={setReportRange}
            />
          ) : null}
        </Animated.View>
      </ScrollView>
      <FloatingTabBar
        activeTab={activeTab}
        bottomInset={insets.bottom}
        onChange={setActiveTab}
        styles={styles}
        theme={theme}
      />
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
      <ActiveTimerEditSheet
        categories={data?.categories ?? []}
        elapsedSeconds={calendarEditEntry ? entryDurationSeconds(calendarEditEntry, now) : 0}
        entry={calendarEditEntry}
        lastStoppedAt={null}
        mode="entry"
        onCancel={() => setCalendarEditEntry(null)}
        onSave={saveCalendarEntryEdit}
        saving={calendarEditSaving}
        stopping={false}
        styles={styles}
        theme={theme}
        visible={Boolean(calendarEditEntry)}
      />
    </SafeAreaView>
  );
}

function FloatingTabBar({
  activeTab,
  bottomInset,
  onChange,
  styles,
  theme
}: {
  activeTab: MobileTab;
  bottomInset: number;
  onChange: (tab: MobileTab) => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const liquidGlassAvailable = useLiquidGlassAvailability();
  const tabs: Array<{ id: MobileTab; label: string }> = [
    { id: "timer", label: "Timer" },
    { id: "calendar", label: "Calendar" },
    { id: "reports", label: "Reports" }
  ];

  const tabItems = (
    <>
      {tabs.map((tab) => {
        const selected = tab.id === activeTab;
        const color = selected ? theme.accent : theme.textSecondary;

        return (
          <Pressable
            key={tab.id}
            accessibilityLabel={`${tab.label} tab`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [
              styles.floatingTabButton,
              selected ? styles.floatingTabButtonSelected : null,
              pressed ? styles.buttonPressed : null
            ]}
          >
            {tab.id === "timer" ? <TimerTabGlyph color={color} /> : null}
            {tab.id === "calendar" ? <CalendarTabGlyph color={color} /> : null}
            {tab.id === "reports" ? <ReportsTabGlyph color={color} /> : null}
            <Text style={[
              styles.floatingTabLabel,
              selected ? styles.floatingTabLabelSelected : null
            ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </>
  );

  return (
    <View
      pointerEvents="box-none"
      style={[styles.floatingTabBarWrap, { bottom: Math.max(bottomInset, 12) }]}
    >
      <View style={styles.floatingTabBarShell}>
        {liquidGlassAvailable ? (
          <GlassView
            colorScheme={theme.mode}
            glassEffectStyle="regular"
            isInteractive
            style={styles.floatingTabBarGlass}
            tintColor={theme.mode === "dark" ? "rgba(23, 32, 40, 0.44)" : "rgba(255, 255, 255, 0.50)"}
          >
            {tabItems}
          </GlassView>
        ) : (
          <View style={styles.floatingTabBarFallback}>
            {tabItems}
          </View>
        )}
      </View>
    </View>
  );
}

function useLiquidGlassAvailability() {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => {
    if (reduceTransparency) return false;
    try {
      return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
    } catch {
      return false;
    }
  }, [reduceTransparency]);
}

function CalendarTab({
  entries,
  now,
  onOpenActive,
  onOpenDetail,
  onSelectDay,
  selectedDayKey,
  styles,
  theme,
  todayKey,
  total,
  weekDays
}: {
  entries: CalendarEntry[];
  now: number;
  onOpenActive: () => void;
  onOpenDetail: (entry: CalendarEntry) => void;
  onSelectDay: (dayKey: string) => void;
  selectedDayKey: string;
  styles: MobileStyles;
  theme: MobileTheme;
  todayKey: string;
  total: number;
  weekDays: Array<{ key: string; date: Date }>;
}) {
  const timelineHeight = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * TIMELINE_HOUR_HEIGHT;
  const selectedDate = dateFromKey(selectedDayKey);
  const currentMinute = minutesSinceStartOfDay(new Date(now));
  const showCurrentTime = selectedDayKey === todayKey;
  const currentLineTop = Math.min(
    timelineHeight,
    Math.max(0, ((currentMinute - TIMELINE_START_HOUR * 60) / 60) * TIMELINE_HOUR_HEIGHT)
  );
  const currentTimeOutsideAxis =
    showCurrentTime &&
    (currentMinute < TIMELINE_START_HOUR * 60 || currentMinute > TIMELINE_END_HOUR * 60);
  const visibleBlocks = entries
    .map((entry) => ({ entry, metrics: getTimelineMetrics(entry, selectedDayKey, now) }))
    .filter((item): item is { entry: CalendarEntry; metrics: { top: number; height: number } } => Boolean(item.metrics));
  const visibleBlockIds = new Set(visibleBlocks.map(({ entry }) => entry.id));
  const outsideAxisEntries = entries.filter((entry) => !visibleBlockIds.has(entry.id)).slice(0, 3);

  return (
    <View style={styles.tabScreenStack}>
      <View style={styles.panel}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.calendarWeekStrip}
        >
          {weekDays.map((day) => {
            const selected = day.key === selectedDayKey;
            const isTodayDay = day.key === todayKey;

            return (
              <Pressable
                key={day.key}
                accessibilityLabel={`Show ${formatSelectedDayTitle(day.date)}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onSelectDay(day.key)}
                style={({ pressed }) => [
                  styles.calendarDayButton,
                  selected ? styles.calendarDayButtonSelected : null,
                  isTodayDay ? styles.calendarDayButtonToday : null,
                  pressed ? styles.buttonPressed : null
                ]}
              >
                <Text style={[
                  styles.calendarWeekday,
                  selected ? styles.calendarDayTextSelected : null
                ]}>
                  {formatWeekday(day.date)}
                </Text>
                <Text style={[
                  styles.calendarDayNumber,
                  selected ? styles.calendarDayTextSelected : null
                ]}>
                  {day.date.getDate()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.lifecyclePanel}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.label}>Calendar</Text>
            <Text style={styles.sectionTitle}>{formatSelectedDayTitle(selectedDate)}</Text>
          </View>
          <Text style={styles.summaryTotal}>{formatDuration(total)}</Text>
        </View>

        <View style={styles.calendarTimelinePanel}>
          {currentTimeOutsideAxis || outsideAxisEntries.length > 0 ? (
            <View style={styles.calendarEdgeStack}>
              {currentTimeOutsideAxis ? (
                <View pointerEvents="none" style={styles.calendarEdgeTimeRow}>
                  <Text style={styles.currentTimeLabel}>{formatTimeOfDay(new Date(now))}</Text>
                  <View style={styles.currentTimeLine} />
                </View>
              ) : null}
              {outsideAxisEntries.map((entry) => (
                <Pressable
                  key={entry.id}
                  accessibilityLabel={`${entry.isActive ? "Edit running timer" : "Open time block"} outside visible calendar hours`}
                  accessibilityRole="button"
                  onPress={() => {
                    if (entry.isActive) {
                      onOpenActive();
                      return;
                    }
                    onOpenDetail(entry);
                  }}
                  style={({ pressed }) => [
                    styles.calendarOutsideBlock,
                    entry.isActive ? styles.calendarBlockActive : null,
                    {
                      borderColor: entryCategoryColor(entry),
                      backgroundColor: colorWithAlpha(entryCategoryColor(entry), entry.isActive ? 0.16 : 0.24)
                    },
                    pressed ? styles.buttonPressed : null
                  ]}
                >
                  <View style={styles.calendarBlockTitleRow}>
                    <View
                      style={[styles.colorDot, { backgroundColor: entryCategoryColor(entry) }]}
                    />
                    <Text style={styles.calendarBlockTitle} numberOfLines={1}>
                      {displayEntryTitle(entry)}
                    </Text>
                  </View>
                  <Text style={styles.calendarBlockMeta} numberOfLines={1}>
                    {entry.isActive
                      ? `${formatEntryTimeRange(entry, now)} · running`
                      : `${formatEntryTimeRange(entry, now)} · ${formatDuration(entryDurationSeconds(entry, now))}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={[styles.calendarTimelineCanvas, { height: timelineHeight }]}>
            {Array.from({ length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 }, (_, index) => {
              const hour = TIMELINE_START_HOUR + index;
              const top = index * TIMELINE_HOUR_HEIGHT;

              return (
                <View key={hour} pointerEvents="none" style={[styles.calendarHourRow, { top }]}>
                  <Text style={styles.calendarHourLabel}>{`${pad2(hour)}:00`}</Text>
                  <View style={styles.calendarHourLine} />
                </View>
              );
            })}

            {visibleBlocks.map(({ entry, metrics }) => {
              const color = entryCategoryColor(entry);
              const title = displayEntryTitle(entry);
              const compact = metrics.height <= 54;
              const timeLabel = formatEntryTimeRange(entry, now);

              return (
                <Pressable
                  key={entry.id}
                  accessibilityLabel={`${entry.isActive ? "Edit running timer" : "Open time block"}: ${title}`}
                  accessibilityRole="button"
                  onPress={() => {
                    if (entry.isActive) {
                      onOpenActive();
                      return;
                    }
                    onOpenDetail(entry);
                  }}
                  style={({ pressed }) => [
                    styles.calendarBlock,
                    entry.isActive ? styles.calendarBlockActive : null,
                    {
                      top: metrics.top,
                      height: Math.max(TIMELINE_MIN_BLOCK_HEIGHT, metrics.height),
                      borderColor: color,
                      backgroundColor: colorWithAlpha(color, entry.isActive ? 0.16 : 0.28)
                    },
                    pressed ? styles.buttonPressed : null
                  ]}
                >
                  <View style={styles.calendarBlockTitleRow}>
                    <View style={[styles.colorDot, { backgroundColor: color }]} />
                    <Text style={styles.calendarBlockTitle} numberOfLines={1}>{title}</Text>
                  </View>
                  <Text style={styles.calendarBlockMeta} numberOfLines={compact ? 1 : 2}>
                    {entry.isActive ? `${timeLabel} · running` : `${timeLabel} · ${formatDuration(entryDurationSeconds(entry, now))}`}
                  </Text>
                </Pressable>
              );
            })}

            {showCurrentTime ? (
              <View pointerEvents="none" style={[styles.currentTimeRow, { top: currentLineTop }]}>
                <Text style={styles.currentTimeLabel}>{formatTimeOfDay(new Date(now))}</Text>
                <View style={styles.currentTimeLine} />
              </View>
            ) : null}
          </View>
        </View>

        {visibleBlocks.length === 0 ? (
          <Text style={styles.muted}>No tracked time for this day.</Text>
        ) : null}
      </View>
    </View>
  );
}

function ReportsTab({
  dailyBars,
  onRangeChange,
  range,
  segments,
  styles,
  theme,
  todayTotal,
  weekTotal
}: {
  dailyBars: Array<{ key: string; label: string; seconds: number }>;
  onRangeChange: (range: ReportRange) => void;
  range: ReportRange;
  segments: SummarySegment[];
  styles: MobileStyles;
  theme: MobileTheme;
  todayTotal: number;
  weekTotal: number;
}) {
  const maxSegmentSeconds = Math.max(1, ...segments.map((segment) => segment.seconds));
  const maxDailySeconds = Math.max(1, ...dailyBars.map((bar) => bar.seconds));

  return (
    <View style={styles.tabScreenStack}>
      <View style={styles.panel}>
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
            <Text style={styles.label}>Today total</Text>
            <Text style={styles.reportTotalValue}>{formatDuration(todayTotal)}</Text>
          </View>
          <View style={styles.reportTotalCard}>
            <Text style={styles.label}>This week</Text>
            <Text style={styles.reportTotalValue}>{formatDuration(weekTotal)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.lifecyclePanel}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.label}>Category breakdown</Text>
            <Text style={styles.sectionTitle}>{range === "today" ? "Today" : "This week"}</Text>
          </View>
        </View>

        {segments.length === 0 ? (
          <Text style={styles.muted}>No tracked time yet.</Text>
        ) : (
          <View style={styles.reportCategoryList}>
            {segments.map((segment) => (
              <View key={segment.key} style={styles.reportCategoryRow}>
                <View style={[styles.reportCategorySwatch, { backgroundColor: segment.color }]} />
                <View style={styles.reportCategoryBody}>
                  <View style={styles.reportCategoryHeader}>
                    <Text style={styles.legendPlace} numberOfLines={1}>{segment.categoryName}</Text>
                    <Text style={styles.legendDuration}>{formatDuration(segment.seconds)}</Text>
                  </View>
                  <View style={styles.reportBarTrack}>
                    <View
                      style={[
                        styles.reportBarFill,
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
            <View key={bar.key} style={styles.reportDailySlot}>
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

function TimerTabGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Circle cx={12} cy={13} r={7} fill="none" stroke={color} strokeWidth={2} />
      <Path d="M9 3h6M12 7v6l4 2" fill="none" stroke={color} strokeLinecap="round" strokeWidth={2} />
    </Svg>
  );
}

function CalendarTabGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M7 3v3M17 3v3M5 8h14M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function ReportsTabGlyph({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path
        d="M5 19V9M12 19V5M19 19v-7"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={2.4}
      />
    </Svg>
  );
}

function CloseGlyph({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6 6 18" stroke={color} strokeLinecap="round" strokeWidth={2.4} />
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

function buildWeekStripDays(weekStartIso: string | undefined, now: number) {
  const start = weekStartIso ? new Date(weekStartIso) : startOfWeekDate(new Date(now));
  if (Number.isNaN(start.getTime())) {
    return buildWeekStripDays(undefined, now);
  }
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDate(start, index);
    return {
      key: formatDateKey(date),
      date
    };
  });
}

function buildCalendarEntries(data: MobileBootstrap | null, selectedDayKey: string, now: number): CalendarEntry[] {
  if (!data) return [];
  return mergeActiveEntry(data.weekEntries ?? data.entries, data.activeEntry)
    .filter((entry) => entryOverlapsDay(entry, selectedDayKey, now))
    .map((entry) => ({
      ...entry,
      isActive: data.activeEntry?.id === entry.id || !entry.stoppedAt
    }))
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

function buildReports(data: MobileBootstrap | null, range: ReportRange, todayKey: string, now: number) {
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
  const todayTotal = sumRangeSeconds(dayEntries, todayStart, todayEnd, now);
  const weekTotal = sumRangeSeconds(weekEntries, weekStart, weekEnd, now);
  const selectedEntries = range === "today" ? dayEntries : weekEntries;
  const rangeStart = range === "today" ? todayStart : weekStart;
  const rangeEnd = range === "today" ? todayEnd : weekEnd;

  return {
    todayTotal: todayTotal || data?.stats?.todaySeconds || 0,
    weekTotal: weekTotal || data?.stats?.weekSeconds || 0,
    segments: buildCategorySegments(selectedEntries, rangeStart, rangeEnd, now),
    dailyBars: buildDailyBars(weekEntries, weekStart, now)
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

function buildCategorySegments(
  entries: TimeEntry[],
  rangeStart: Date,
  rangeEnd: Date,
  now: number
): SummarySegment[] {
  const totals = new Map<string, Omit<SummarySegment, "share">>();

  for (const entry of entries) {
    const startedAt = new Date(entry.startedAt);
    if (startedAt < rangeStart || startedAt >= rangeEnd) continue;
    const categoryName = entry.categoryName ?? "Uncategorized";
    const key = entry.categoryId ?? "uncategorized";
    const current = totals.get(key);
    const seconds = entryDurationSeconds(entry, now);

    totals.set(key, {
      key,
      categoryName,
      seconds: (current?.seconds ?? 0) + seconds,
      color: current?.color ?? entryCategoryColor(entry)
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
    const startedAt = new Date(entry.startedAt);
    if (startedAt < rangeStart || startedAt >= rangeEnd) return sum;
    return sum + entryDurationSeconds(entry, now);
  }, 0);
}

function getTimelineMetrics(entry: CalendarEntry, selectedDayKey: string, now: number) {
  const dayStart = dateFromKey(selectedDayKey);
  const axisStart = new Date(dayStart);
  axisStart.setHours(TIMELINE_START_HOUR, 0, 0, 0);
  const axisEnd = new Date(dayStart);
  axisEnd.setHours(TIMELINE_END_HOUR, 0, 0, 0);
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  const visibleStart = new Date(Math.max(startedAt.getTime(), axisStart.getTime()));
  const visibleEnd = new Date(Math.min(stoppedAt.getTime(), axisEnd.getTime()));

  if (
    Number.isNaN(startedAt.getTime()) ||
    Number.isNaN(stoppedAt.getTime()) ||
    visibleEnd <= axisStart ||
    visibleStart >= axisEnd ||
    visibleEnd <= visibleStart
  ) {
    return null;
  }

  const topMinutes = (visibleStart.getTime() - axisStart.getTime()) / 60000;
  const durationMinutes = Math.max(1, (visibleEnd.getTime() - visibleStart.getTime()) / 60000);

  return {
    top: (topMinutes / 60) * TIMELINE_HOUR_HEIGHT,
    height: Math.max(TIMELINE_MIN_BLOCK_HEIGHT, (durationMinutes / 60) * TIMELINE_HOUR_HEIGHT)
  };
}

function entryOverlapsDay(entry: TimeEntry, dayKey: string, now: number) {
  const dayStart = dateFromKey(dayKey);
  const dayEnd = addDaysToDate(dayStart, 1);
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) return false;
  return startedAt < dayEnd && stoppedAt > dayStart;
}

function entryDurationSeconds(entry: TimeEntry, now: number) {
  const startedAt = new Date(entry.startedAt).getTime();
  if (entry.stoppedAt) return Math.max(0, entry.durationSeconds);
  if (Number.isNaN(startedAt)) return Math.max(0, entry.durationSeconds);
  return Math.max(entry.durationSeconds, Math.floor((now - startedAt) / 1000));
}

function entryCategoryColor(entry: TimeEntry) {
  return paletteColorFor(entry.categoryColor ?? entry.categoryId, entry.categoryName ?? "Uncategorized");
}

function displayEntryTitle(entry: TimeEntry) {
  return displayTimerDescription(entry) ?? entry.categoryName ?? "Uncategorized";
}

function formatEntryTimeRange(entry: TimeEntry, now: number) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  return `${formatTimeOfDay(startedAt)}-${entry.stoppedAt ? formatTimeOfDay(stoppedAt) : "now"}`;
}

function minutesSinceStartOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function formatSelectedDayTitle(date: Date) {
  if (isSameLocalDay(date, new Date())) return "Today";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
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

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
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

function buildTodaySummarySegments(entries: TimeEntry[], now: number): SummarySegment[] {
  const periodStart = startOfToday(now);
  const totals = new Map<string, Omit<SummarySegment, "share">>();

  for (const entry of entries) {
    const startedAt = new Date(entry.startedAt).getTime();
    if (startedAt < periodStart) continue;
    const categoryName = entry.categoryName ?? "Uncategorized";
    const key = entry.categoryId ?? "uncategorized";
    const current = totals.get(key);
    const seconds = entryDurationSeconds(entry, now);

    totals.set(key, {
      key,
      categoryName,
      seconds: (current?.seconds ?? 0) + seconds,
      color: current?.color ?? entryCategoryColor(entry)
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
