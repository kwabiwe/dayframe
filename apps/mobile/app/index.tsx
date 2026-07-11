import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  AppState,
  Easing,
  Linking,
  PanResponder,
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
import { calendarBlockContinuationEdges, paletteColorFor } from "@dayframe/shared";
import { ActiveTimerEditSheet } from "@/components/ActiveTimerEditSheet";
import { DayframeBrand } from "@/components/brand";
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
import {
  calendarSwipeDelta,
  formatCalendarHourLabel,
  shouldCaptureCalendarSwipe
} from "@/lib/calendarGestures";
import { handleDayframeUrl } from "@/lib/deepLinks";
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
import {
  pressable,
  useMobileTheme,
  type MobileStyles,
  type MobileTheme
} from "@/lib/mobileTheme";
import {
  REVIEW_COPY,
  buildReviewItemDraftEntry,
  hasReviewNeededActivityForRange,
  isOpenReviewItem,
  isReviewNeededEntry
} from "@/lib/review";

type TimeEntry = MobileBootstrap["entries"][number];
type AuthView = "login" | "signup";
type AuthState = "checking" | "authenticated" | "signedOut";
type MobileTab = "timer" | "calendar" | "reports";
type ReportRange = "today" | "week";
type ReportChartView = "pie" | "bars";
type CalendarHoursMode = "fullDay";
type CalendarEntry = TimeEntry & { isActive: boolean; reviewItemId?: string; isReviewSuggestion?: boolean };
type CalendarHours = { startHour: number; endHour: number };
type CalendarBlockMetrics = {
  top: number;
  height: number;
  startsBeforeDay: boolean;
  continuesIntoNextDay: boolean;
};
type CalendarZoomFocus = {
  anchorY: number;
  startHourHeight: number;
  startScrollY: number;
};
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
const CALENDAR_HOURS_MODES: Record<CalendarHoursMode, CalendarHours & { label: string; accessibilityLabel: string }> = {
  fullDay: { label: "24-hour", accessibilityLabel: "Show 24-hour calendar", startHour: 0, endHour: 24 }
};
const TIMELINE_DEFAULT_HOUR_HEIGHT = 72;
const TIMELINE_MIN_HOUR_HEIGHT = 48;
const TIMELINE_MAX_HOUR_HEIGHT = 128;
const TIMELINE_MIN_BLOCK_HEIGHT = 44;
const CALENDAR_HOUR_LABEL_HEIGHT = 22;
const CALENDAR_CURRENT_TIME_LABEL_HEIGHT = 18;

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
  const [calendarHourHeight, setCalendarHourHeight] = useState(TIMELINE_DEFAULT_HOUR_HEIGHT);
  const [calendarHoursMode] = useState<CalendarHoursMode>("fullDay");
  const [calendarTransitionDirection, setCalendarTransitionDirection] = useState(1);
  const [reportChartView, setReportChartView] = useState<ReportChartView>("pie");
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
  const [calendarEditDeleting, setCalendarEditDeleting] = useState(false);
  const [calendarGestureLocked, setCalendarGestureLocked] = useState(false);
  const [chartProgress, setChartProgress] = useState(1);
  const reduceMotion = useReduceMotionPreference();
  const refreshInFlight = useRef(false);
  const queueSyncInFlight = useRef(false);
  const healthAutoSyncInFlight = useRef(false);
  const mainScrollRef = useRef<ScrollView>(null);
  const mainScrollY = useRef(0);
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

  const syncQueuedEvents = useCallback(async () => {
    if (queueSyncInFlight.current) return null;
    queueSyncInFlight.current = true;
    try {
      return await syncQueue();
    } finally {
      queueSyncInFlight.current = false;
    }
  }, []);

  const syncQueuedEventsAndReload = useCallback(async () => {
    if (authState !== "authenticated") return;
    try {
      await syncQueuedEvents();
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setData(null);
        setAuthState("signedOut");
      }
    }
  }, [authState, load, syncQueuedEvents]);

  const syncHealthKitAndReload = useCallback(async (reason: "foreground" | "observer" = "foreground") => {
    if (authState !== "authenticated" || healthAutoSyncInFlight.current) return;

    let enabled = await isHealthKitAutomaticSyncEnabled().catch(() => false);
    if (!enabled) {
      enabled = await configureHealthKitAutomaticSync().catch(() => false);
    }
    if (!enabled) return;

    healthAutoSyncInFlight.current = true;
    try {
      await importHealthKitSleep();
      await importHealthKitWorkouts();
      await syncQueuedEvents();
      await reprocessExistingHealthReviewItems(undefined, { force: reason === "observer" });
      await load({ silent: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setData(null);
        setAuthState("signedOut");
        return;
      }
      console.warn(friendlyHealthKitError(error, "sync Apple Health"));
    } finally {
      healthAutoSyncInFlight.current = false;
    }
  }, [authState, load, syncQueuedEvents]);

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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (authState !== "authenticated") return undefined;
    let mounted = true;
    let subscription: HealthKitChangeSubscription | null = null;

    void (async () => {
      await syncHealthKitAndReload("foreground");
      if (!mounted) return;

      const nextSubscription = await startHealthKitChangeObservers((_type, errorMessage) => {
        if (errorMessage) console.warn(`HealthKit observer update failed: ${errorMessage}`);
        void syncHealthKitAndReload("observer");
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
      if (authState === "authenticated") {
        void syncQueuedEventsAndReload();
      } else {
        void load({ silent: true });
      }
    }, [authState, load, reloadThemePreference, syncQueuedEventsAndReload])
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
      if (state === "active" && authState === "authenticated") {
        void syncHealthKitAndReload("foreground");
        void syncQueuedEventsAndReload();
      }
    });
    return () => subscription.remove();
  }, [authState, syncHealthKitAndReload, syncQueuedEventsAndReload]);

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
    () => buildWeekStripDays(selectedDayKey, now),
    [now, selectedDayKey]
  );
  const summaryEntries = useMemo(
    () => mergeActiveEntry(data?.dayEntries ?? data?.entries ?? [], data?.activeEntry ?? null),
    [data?.activeEntry, data?.dayEntries, data?.entries]
  );
  const summarySegments = useMemo(
    () => buildTodaySummarySegments(summaryEntries, now, theme.mode),
    [summaryEntries, now, theme.mode]
  );
  const summaryTotal = summarySegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const summaryHasSuggestedActivity = useMemo(() => {
    const rangeStart = dateFromKey(todayKey);
    return hasReviewNeededActivityForRange({
      entries: summaryEntries,
      now,
      rangeEnd: addDaysToDate(rangeStart, 1),
      rangeStart,
      reviewItems: data?.reviewItems ?? []
    });
  }, [data?.reviewItems, now, summaryEntries, todayKey]);
  const activeCategoryColor = data?.activeEntry?.categoryName
    ? paletteColorFor(
        data.activeEntry.categoryColor ?? data.activeEntry.categoryId,
        data.activeEntry.categoryName,
        theme.mode
      )
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
    () => sumOverlappingDaySeconds(calendarEntries.filter((entry) => !isCalendarReviewNeeded(entry)), selectedDayKey, now),
    [calendarEntries, now, selectedDayKey]
  );
  const reports = useMemo(
    () => buildReports(data, reportRange, todayKey, now, theme.mode),
    [data, now, reportRange, theme.mode, todayKey]
  );

  useEffect(() => {
    if (!data?.activeEntry && activeEditVisible) setActiveEditVisible(false);
  }, [activeEditVisible, data?.activeEntry]);

  useEffect(() => {
    chartBuild.stopAnimation();
    if (reduceMotion) {
      chartBuild.setValue(1);
      setChartProgress(1);
      return undefined;
    }
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
  }, [chartBuild, reduceMotion, summarySegments.length]);

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

  async function deleteCalendarEntry(entryId: string) {
    setCalendarEditDeleting(true);
    try {
      await deleteTimeEntry(entryId);
      await load();
      return true;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setCalendarEditEntry(null);
        setAuthState("signedOut");
        setData(null);
        return false;
      }
      Alert.alert("Entry not deleted", error instanceof Error ? error.message : "Unable to delete this entry.");
      return false;
    } finally {
      setCalendarEditDeleting(false);
    }
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

  const setCalendarZoom = useCallback((hourHeight: number, focus?: CalendarZoomFocus) => {
    const nextHourHeight = clamp(hourHeight, TIMELINE_MIN_HOUR_HEIGHT, TIMELINE_MAX_HOUR_HEIGHT);
    setCalendarHourHeight(nextHourHeight);

    if (focus && focus.startHourHeight > 0) {
      const scale = nextHourHeight / focus.startHourHeight;
      const nextScrollY = Math.max(0, focus.startScrollY + focus.anchorY * (scale - 1));
      requestAnimationFrame(() => {
        mainScrollRef.current?.scrollTo({ y: nextScrollY, animated: false });
      });
    }
  }, []);

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
              <DayframeBrand
                layout="horizontal"
                size="md"
                tone={theme.mode === "dark" ? "light" : "dark"}
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
        ref={mainScrollRef}
        contentContainerStyle={[
          styles.container,
          { paddingBottom: 18 }
        ]}
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!calendarGestureLocked}
        onScroll={(event) => {
          mainScrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
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
              <DayframeBrand
                layout="horizontal"
                size="md"
                tone={theme.mode === "dark" ? "light" : "dark"}
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
                {activeCategoryColor ? (
                  <View
                    pointerEvents="none"
                    style={[styles.activeTimerAccentRail, { backgroundColor: activeCategoryColor }]}
                  />
                ) : null}
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
                      <Text style={styles.activeElapsed}>{formatClockDuration(activeDurationSeconds)}</Text>
                      <Text style={styles.activeElapsedLabel}>Running</Text>
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
                        <StopGlyph color={theme.onAccent} />
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
                        <TrashGlyph color={theme.onDanger} />
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
                    <PlayGlyph color={theme.onAccent} />
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
                      const categoryColor = paletteColorFor(category.color, category.name, theme.mode);
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
                hasSuggestedActivity={summaryHasSuggestedActivity}
                segments={summarySegments}
                styles={styles}
                theme={theme}
                total={summaryTotal}
              />
            </>
          ) : null}

          {activeTab === "calendar" ? (
            <CalendarTab
              calendarHoursMode={calendarHoursMode}
              calendarTransitionDirection={calendarTransitionDirection}
              entries={calendarEntries}
              hourHeight={calendarHourHeight}
              now={now}
              onChangeDay={shiftSelectedCalendarDay}
              onChangeWeek={(weeks) => shiftSelectedCalendarDay(weeks * 7)}
              onChangeZoom={setCalendarZoom}
              getScrollY={() => mainScrollY.current}
              onGestureLockedChange={setCalendarGestureLocked}
              onOpenActive={() => {
                setCalendarEditEntry(null);
                setActiveEditVisible(true);
              }}
              onOpenDetail={setCalendarEditEntry}
              onOpenReviewItem={() => router.push("./review")}
              onSelectDay={selectCalendarDay}
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
              chartView={reportChartView}
              dailyBars={reports.dailyBars}
              range={reportRange}
              segments={reports.segments}
              hasSuggestedActivity={reports.hasSuggestedActivity}
              onChartViewChange={setReportChartView}
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
        onDelete={deleteCalendarEntry}
        onSave={saveCalendarEntryEdit}
        deleting={calendarEditDeleting}
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
    { id: "timer", label: "Today" },
    { id: "calendar", label: "Calendar" },
    { id: "reports", label: "Reports" }
  ];

  const tabItems = (
    <>
      {tabs.map((tab) => {
        const selected = tab.id === activeTab;
        const color = selected ? theme.accentText : theme.textSecondary;

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
            {tab.id === "timer" ? <TodayTabGlyph color={color} /> : null}
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
            tintColor={theme.glassTint}
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
    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency
    );

    return () => {
      mounted = false;
      subscription.remove();
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

function useReduceMotionPreference() {
  // Default to the accessibility-safe state until iOS resolves the preference.
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function CalendarTab({
  calendarHoursMode,
  calendarTransitionDirection,
  entries,
  getScrollY,
  hourHeight,
  now,
  onChangeDay,
  onChangeWeek,
  onChangeZoom,
  onGestureLockedChange,
  onOpenActive,
  onOpenDetail,
  onOpenReviewItem,
  onSelectDay,
  selectedDayKey,
  styles,
  theme,
  todayKey,
  total,
  weekDays
}: {
  calendarHoursMode: CalendarHoursMode;
  calendarTransitionDirection: number;
  entries: CalendarEntry[];
  getScrollY: () => number;
  hourHeight: number;
  now: number;
  onChangeDay: (days: number) => void;
  onChangeWeek: (weeks: number) => void;
  onChangeZoom: (hourHeight: number, focus?: CalendarZoomFocus) => void;
  onGestureLockedChange: (locked: boolean) => void;
  onOpenActive: () => void;
  onOpenDetail: (entry: CalendarEntry) => void;
  onOpenReviewItem: (reviewItemId: string) => void;
  onSelectDay: (dayKey: string) => void;
  selectedDayKey: string;
  styles: MobileStyles;
  theme: MobileTheme;
  todayKey: string;
  total: number;
  weekDays: Array<{ key: string; date: Date }>;
}) {
  const reduceMotion = useReduceMotionPreference();
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartHourHeight = useRef(hourHeight);
  const pinchAnchorY = useRef(0);
  const pinchStartScrollY = useRef(0);
  const timelinePanelY = useRef(0);
  const timelineCanvasY = useRef(0);
  const calendarTransition = useRef(new Animated.Value(1)).current;
  const calendarHours = CALENDAR_HOURS_MODES[calendarHoursMode];
  const timelineHeight = (calendarHours.endHour - calendarHours.startHour) * hourHeight;
  const selectedDate = dateFromKey(selectedDayKey);
  const currentMinute = minutesSinceStartOfDay(new Date(now));
  const showCurrentTime = selectedDayKey === todayKey;
  const currentLineTop = Math.min(
    timelineHeight,
    Math.max(0, ((currentMinute - calendarHours.startHour * 60) / 60) * hourHeight)
  );
  const currentTimeRowTop = clamp(currentLineTop - CALENDAR_CURRENT_TIME_LABEL_HEIGHT / 2, 0, timelineHeight - CALENDAR_CURRENT_TIME_LABEL_HEIGHT);
  const currentTimeOutsideAxis =
    showCurrentTime &&
    (currentMinute < calendarHours.startHour * 60 || currentMinute > calendarHours.endHour * 60);
  const visibleBlocks = entries
    .map((entry) => ({ entry, metrics: getTimelineMetrics(entry, selectedDayKey, now, hourHeight, calendarHours) }))
    .filter((item): item is { entry: CalendarEntry; metrics: CalendarBlockMetrics } => Boolean(item.metrics));
  const visibleBlockIds = new Set(visibleBlocks.map(({ entry }) => entry.id));
  const outsideAxisEntries = entries.filter((entry) => !visibleBlockIds.has(entry.id)).slice(0, 3);

  useEffect(() => {
    calendarTransition.stopAnimation();
    if (reduceMotion) {
      calendarTransition.setValue(1);
      return;
    }
    calendarTransition.setValue(0);
    Animated.timing(calendarTransition, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [calendarTransition, reduceMotion, selectedDayKey]);

  const calendarTransitionStyle = {
    opacity: calendarTransition.interpolate({
      inputRange: [0, 1],
      outputRange: [0.78, 1]
    }),
    transform: [
      {
        translateX: calendarTransition.interpolate({
          inputRange: [0, 1],
          outputRange: [calendarTransitionDirection * 24, 0]
        })
      }
    ]
  };

  const dayGestureResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: (event, gesture) => {
      if (event.nativeEvent.touches.length >= 2) return true;
      return shouldCaptureCalendarSwipe(gesture);
    },
    onMoveShouldSetPanResponderCapture: (event, gesture) => {
      if (event.nativeEvent.touches.length >= 2) return true;
      return shouldCaptureCalendarSwipe(gesture);
    },
    onPanResponderGrant: (event) => {
      onGestureLockedChange(true);
      if (event.nativeEvent.touches.length >= 2) {
        pinchStartDistance.current = touchDistance(event.nativeEvent.touches);
        pinchStartHourHeight.current = hourHeight;
        pinchStartScrollY.current = getScrollY();
        pinchAnchorY.current = clamp(
          touchMidpointLocationY(event.nativeEvent.touches) - timelinePanelY.current - timelineCanvasY.current,
          0,
          timelineHeight
        );
      } else {
        pinchStartDistance.current = null;
      }
    },
    onPanResponderMove: (event) => {
      if (event.nativeEvent.touches.length < 2 || !pinchStartDistance.current) return;
      const distance = touchDistance(event.nativeEvent.touches);
      if (!distance) return;
      onChangeZoom(
        pinchStartHourHeight.current * (distance / pinchStartDistance.current),
        {
          anchorY: pinchAnchorY.current,
          startHourHeight: pinchStartHourHeight.current,
          startScrollY: pinchStartScrollY.current
        }
      );
    },
    onPanResponderRelease: (_event, gesture) => {
      const wasPinching = Boolean(pinchStartDistance.current);
      pinchStartDistance.current = null;
      onGestureLockedChange(false);
      if (wasPinching) return;
      const delta = calendarSwipeDelta("day", gesture);
      if (delta === 0) return;
      onChangeDay(delta);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      pinchStartDistance.current = null;
      onGestureLockedChange(false);
    }
  }), [getScrollY, hourHeight, onChangeDay, onChangeZoom, onGestureLockedChange, timelineHeight]);

  const weekGestureResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      shouldCaptureCalendarSwipe(gesture),
    onMoveShouldSetPanResponder: (_event, gesture) =>
      shouldCaptureCalendarSwipe(gesture),
    onPanResponderGrant: () => {
      onGestureLockedChange(true);
    },
    onPanResponderRelease: (_event, gesture) => {
      onGestureLockedChange(false);
      const delta = calendarSwipeDelta("week", gesture);
      if (delta === 0) return;
      onChangeWeek(delta);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      onGestureLockedChange(false);
    }
  }), [onChangeWeek, onGestureLockedChange]);

  return (
    <View style={styles.tabScreenStack}>
      <View style={styles.panel} {...weekGestureResponder.panHandlers}>
        <View style={styles.calendarWeekStrip}>
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
        </View>
      </View>

      <View style={styles.lifecyclePanel} {...dayGestureResponder.panHandlers}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.label}>Calendar</Text>
            <Text style={styles.sectionTitle}>{formatSelectedDayTitle(selectedDate)}</Text>
          </View>
          <Text style={styles.summaryTotal}>{formatDuration(total)}</Text>
        </View>

        <Animated.View
          onLayout={(event) => {
            timelinePanelY.current = event.nativeEvent.layout.y;
          }}
          style={[styles.calendarTimelinePanel, calendarTransitionStyle]}
        >
          {currentTimeOutsideAxis || outsideAxisEntries.length > 0 ? (
            <View style={styles.calendarEdgeStack}>
              {currentTimeOutsideAxis ? (
                <View pointerEvents="none" style={styles.calendarEdgeTimeRow}>
                  <View style={styles.currentTimeLine} />
                </View>
              ) : null}
              {outsideAxisEntries.map((entry) => {
                const reviewNeeded = isCalendarReviewNeeded(entry);
                const color = entryCategoryColor(entry, theme.mode);
                const blockColor = reviewNeeded ? theme.textSecondary : color;

                return (
                  <Pressable
                    key={entry.id}
                    accessibilityLabel={`${reviewNeeded ? REVIEW_COPY.needsReview : entry.isActive ? "Edit running timer" : "Open time block"} outside visible calendar hours`}
                    accessibilityRole="button"
                    onPress={() => openCalendarEntry(entry, onOpenActive, onOpenDetail, onOpenReviewItem)}
                    style={({ pressed }) => [
                      styles.calendarOutsideBlock,
                      entry.isActive ? styles.calendarBlockActive : null,
                      reviewNeeded ? styles.calendarBlockReview : null,
                      {
                        borderColor: reviewNeeded ? theme.borderStrong : color,
                        backgroundColor: colorWithAlpha(blockColor, reviewNeeded ? 0.12 : entry.isActive ? 0.16 : 0.24)
                      },
                      pressed ? styles.buttonPressed : null
                    ]}
                  >
                    <View style={styles.calendarBlockTitleRow}>
                      <View
                        style={[styles.colorDot, { backgroundColor: blockColor }]}
                      />
                      <Text style={styles.calendarBlockTitle} numberOfLines={1}>
                        {displayEntryTitle(entry)}
                      </Text>
                    </View>
                    <Text style={styles.calendarBlockMeta} numberOfLines={1}>
                      {calendarBlockMeta(entry, now, reviewNeeded)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View
            onLayout={(event) => {
              timelineCanvasY.current = event.nativeEvent.layout.y;
            }}
            style={[styles.calendarTimelineCanvas, { height: timelineHeight }]}
          >
            {Array.from({ length: calendarHours.endHour - calendarHours.startHour + 1 }, (_, index) => {
              const hour = calendarHours.startHour + index;
              const lineTop = index * hourHeight;
              const labelTop = clamp(lineTop - CALENDAR_HOUR_LABEL_HEIGHT / 2, 0, timelineHeight - CALENDAR_HOUR_LABEL_HEIGHT);

              return (
                <Fragment key={hour}>
                  <Text style={[styles.calendarHourLabel, { top: labelTop }]}>
                    {formatCalendarHourLabel(hour)}
                  </Text>
                  <View pointerEvents="none" style={[styles.calendarHourLine, { top: lineTop }]} />
                </Fragment>
              );
            })}

            {visibleBlocks.map(({ entry, metrics }) => {
              const reviewNeeded = isCalendarReviewNeeded(entry);
              const color = entryCategoryColor(entry, theme.mode);
              const blockColor = reviewNeeded ? theme.textSecondary : color;
              const title = displayEntryTitle(entry);
              const compact = metrics.height <= 54;

              return (
                <Pressable
                  key={entry.id}
                  accessibilityLabel={`${reviewNeeded ? REVIEW_COPY.needsReview : entry.isActive ? "Edit running timer" : "Open time block"}: ${title}`}
                  accessibilityRole="button"
                  onPress={() => openCalendarEntry(entry, onOpenActive, onOpenDetail, onOpenReviewItem)}
                  style={({ pressed }) => [
                    styles.calendarBlock,
                    entry.isActive ? styles.calendarBlockActive : null,
                    reviewNeeded ? styles.calendarBlockReview : null,
                    {
                      top: metrics.top,
                      height: Math.max(TIMELINE_MIN_BLOCK_HEIGHT, metrics.height),
                      borderColor: reviewNeeded ? theme.borderStrong : color,
                      backgroundColor: colorWithAlpha(blockColor, reviewNeeded ? 0.12 : entry.isActive ? 0.16 : 0.28)
                    },
                    metrics.startsBeforeDay ? styles.calendarBlockFromPrevious : null,
                    metrics.continuesIntoNextDay ? styles.calendarBlockIntoNext : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                >
                  <View style={styles.calendarBlockTitleRow}>
                    <View style={[styles.colorDot, { backgroundColor: blockColor }]} />
                    <Text style={styles.calendarBlockTitle} numberOfLines={1}>{title}</Text>
                  </View>
                  <Text style={styles.calendarBlockMeta} numberOfLines={compact ? 1 : 2}>
                    {calendarBlockMeta(entry, now, reviewNeeded, metrics)}
                  </Text>
                </Pressable>
              );
            })}

            {showCurrentTime ? (
              <View pointerEvents="none" style={[styles.currentTimeRow, { top: currentTimeRowTop }]}>
                <View style={styles.currentTimeLine} />
              </View>
            ) : null}
          </View>
        </Animated.View>

        {visibleBlocks.length === 0 ? (
          <Text style={styles.muted}>No tracked time for this day.</Text>
        ) : null}
      </View>
    </View>
  );
}

function ReportsTab({
  chartView,
  dailyBars,
  hasSuggestedActivity,
  onChartViewChange,
  onRangeChange,
  range,
  segments,
  styles,
  theme,
  todayTotal,
  weekTotal
}: {
  chartView: ReportChartView;
  dailyBars: Array<{ key: string; label: string; seconds: number }>;
  hasSuggestedActivity: boolean;
  onChartViewChange: (view: ReportChartView) => void;
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
        {hasSuggestedActivity ? (
          <Text style={styles.reviewNote}>{REVIEW_COPY.suggestedNote}</Text>
        ) : null}

        {segments.length === 0 ? (
          <Text style={styles.muted}>No tracked time yet.</Text>
        ) : (
          <>
            <View style={styles.reportChartSwitchRow}>
              {(["pie", "bars"] as const).map((option) => {
                const selected = option === chartView;
                return (
                  <Pressable
                    key={option}
                    accessibilityLabel={`Show category ${option === "pie" ? "pie chart" : "bar chart"}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onChartViewChange(option)}
                    style={({ pressed }) => [
                      styles.reportChartSwitchButton,
                      selected ? styles.reportChartSwitchButtonSelected : null,
                      pressed ? styles.buttonPressed : null
                    ]}
                  >
                    <Text style={[
                      styles.reportChartSwitchText,
                      selected ? styles.reportChartSwitchTextSelected : null
                    ]}>
                      {option === "pie" ? "Pie" : "Bars"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {chartView === "pie" ? (
              <>
                <View style={styles.chartWrap}>
                  <DonutChart progress={1} segments={segments} styles={styles} theme={theme} total={segments.reduce((sum, segment) => sum + segment.seconds, 0)} />
                </View>
                <View style={styles.legendList}>
                  {segments.map((segment) => (
                    <View key={segment.key} style={styles.legendRow}>
                      <View style={[styles.legendSwatch, { backgroundColor: segment.color }]} />
                      <View style={styles.legendText}>
                        <Text style={styles.legendPlace} numberOfLines={1}>{segment.categoryName}</Text>
                        <Text style={styles.legendProject}>Category</Text>
                      </View>
                      <View style={styles.legendNumbers}>
                        <Text style={styles.legendDuration}>{formatDuration(segment.seconds)}</Text>
                        <Text style={styles.legendShare}>{segment.share}%</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
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
          </>
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
            <View
              key={bar.key}
              accessibilityLabel={`${bar.label}: ${formatDuration(bar.seconds)}`}
              accessible
              style={styles.reportDailySlot}
            >
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

function TodayTabGlyph({ color }: { color: string }) {
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
      <Path d="M9 12h6v4H9z" fill={color} />
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
  hasSuggestedActivity,
  segments,
  styles,
  theme,
  total
}: {
  chartProgress: number;
  hasSuggestedActivity: boolean;
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
      {hasSuggestedActivity ? (
        <Text style={styles.reviewNote}>{REVIEW_COPY.suggestedNote}</Text>
      ) : null}

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
  const innerRadius = 82;
  let cursor = 0;

  return (
    <View
      accessibilityLabel={`Tracked time total ${formatDuration(total)}. Category details follow the chart.`}
      accessibilityRole="image"
      accessible
      style={styles.chartBox}
    >
      <Svg
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <Circle cx={center} cy={center} r={outerRadius} fill={theme.chartTrack} />
        <Circle cx={center} cy={center} r={innerRadius} fill={theme.surfaceRaised} />
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

function buildWeekStripDays(selectedDayKey: string | undefined, now: number) {
  const selectedDate = selectedDayKey ? dateFromKey(selectedDayKey) : new Date(now);
  const start = startOfWeekDate(selectedDate);
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
  const mergedEntries = mergeActiveEntry(
    dedupeEntriesById([...(data.entries ?? []), ...(data.weekEntries ?? [])]),
    data.activeEntry
  );
  const timeEntries = mergedEntries
    .filter((entry) => entryOverlapsDay(entry, selectedDayKey, now))
    .map((entry) => ({
      ...entry,
      isActive: data.activeEntry?.id === entry.id || !entry.stoppedAt
    }));
  const reviewEntries: CalendarEntry[] = [];
  for (const item of data.reviewItems ?? []) {
    if (!isOpenReviewItem(item)) continue;
    const draft = buildReviewItemDraftEntry(item, data.categories, now);
    if (!draft) continue;
    const entry: CalendarEntry = {
      ...draft,
      id: `review:${item.id}`,
      isActive: false,
      isReviewSuggestion: true,
      reviewItemId: item.id
    };
    if (entryOverlapsDay(entry, selectedDayKey, now)) reviewEntries.push(entry);
  }

  return [...timeEntries, ...reviewEntries]
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

function dedupeEntriesById(entries: TimeEntry[]) {
  const byId = new Map<string, TimeEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  return Array.from(byId.values());
}

function buildReports(
  data: MobileBootstrap | null,
  range: ReportRange,
  todayKey: string,
  now: number,
  mode: MobileTheme["mode"]
) {
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
  const selectedEntries = range === "today" ? dayEntries : weekEntries;
  const rangeStart = range === "today" ? todayStart : weekStart;
  const rangeEnd = range === "today" ? todayEnd : weekEnd;
  const confirmedDayEntries = dayEntries.filter((entry) => !isReviewNeededEntry(entry));
  const confirmedWeekEntries = weekEntries.filter((entry) => !isReviewNeededEntry(entry));
  const confirmedSelectedEntries = selectedEntries.filter((entry) => !isReviewNeededEntry(entry));
  const todayTotal = sumRangeSeconds(confirmedDayEntries, todayStart, todayEnd, now);
  const weekTotal = sumRangeSeconds(confirmedWeekEntries, weekStart, weekEnd, now);

  return {
    todayTotal,
    weekTotal,
    segments: buildCategorySegments(confirmedSelectedEntries, rangeStart, rangeEnd, now, mode),
    dailyBars: buildDailyBars(confirmedWeekEntries, weekStart, now),
    hasSuggestedActivity: hasReviewNeededActivityForRange({
      entries: selectedEntries,
      now,
      rangeEnd,
      rangeStart,
      reviewItems: data?.reviewItems ?? []
    })
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
  now: number,
  mode: MobileTheme["mode"]
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
      color: current?.color ?? entryCategoryColor(entry, mode)
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

function sumOverlappingDaySeconds(entries: TimeEntry[], dayKey: string, now: number) {
  const dayStart = dateFromKey(dayKey);
  return sumRangeSeconds(entries, dayStart, addDaysToDate(dayStart, 1), now);
}

function sumStartedInDaySeconds(entries: TimeEntry[], dayKey: string, now: number) {
  return entries.reduce((sum, entry) => {
    if (formatDateKey(new Date(entry.startedAt)) !== dayKey) return sum;
    return sum + entryDurationSeconds(entry, now);
  }, 0);
}

function sumRangeSeconds(entries: TimeEntry[], rangeStart: Date, rangeEnd: Date, now: number) {
  return entries.reduce((sum, entry) => {
    return sum + entryOverlapSeconds(entry, rangeStart, rangeEnd, now);
  }, 0);
}

function entryOverlapSeconds(entry: TimeEntry, rangeStart: Date, rangeEnd: Date, now: number) {
  const startedAt = new Date(entry.startedAt);
  const stoppedAt = entry.stoppedAt ? new Date(entry.stoppedAt) : new Date(now);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(stoppedAt.getTime())) return 0;
  const overlapStart = Math.max(startedAt.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(stoppedAt.getTime(), rangeEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / 1000);
}

function getTimelineMetrics(
  entry: CalendarEntry,
  selectedDayKey: string,
  now: number,
  hourHeight: number,
  calendarHours: CalendarHours
): CalendarBlockMetrics | null {
  const dayStart = dateFromKey(selectedDayKey);
  const dayEnd = addDaysToDate(dayStart, 1);
  const axisStart = new Date(dayStart);
  axisStart.setHours(calendarHours.startHour, 0, 0, 0);
  const axisEnd = new Date(dayStart);
  axisEnd.setHours(calendarHours.endHour, 0, 0, 0);
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
  const continuation = calendarBlockContinuationEdges({
    startedAt,
    stoppedAt,
    dayStart,
    dayEnd
  });

  return {
    top: (topMinutes / 60) * hourHeight,
    height: Math.max(TIMELINE_MIN_BLOCK_HEIGHT, (durationMinutes / 60) * hourHeight),
    startsBeforeDay: continuation.startsBeforeDay,
    continuesIntoNextDay: continuation.continuesIntoNextDay
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

function entryCategoryColor(entry: TimeEntry, mode: MobileTheme["mode"]) {
  return paletteColorFor(
    entry.categoryColor ?? entry.categoryId,
    entry.categoryName ?? "Uncategorized",
    mode
  );
}

function displayEntryTitle(entry: TimeEntry) {
  return displayTimerDescription(entry) ?? entry.categoryName ?? "Uncategorized";
}

function isCalendarReviewNeeded(entry: CalendarEntry) {
  return Boolean(entry.reviewItemId || entry.isReviewSuggestion || isReviewNeededEntry(entry));
}

function openCalendarEntry(
  entry: CalendarEntry,
  onOpenActive: () => void,
  onOpenDetail: (entry: CalendarEntry) => void,
  onOpenReviewItem: (reviewItemId: string) => void
) {
  if (entry.reviewItemId) {
    onOpenReviewItem(entry.reviewItemId);
    return;
  }
  if (entry.isActive) {
    onOpenActive();
    return;
  }
  onOpenDetail(entry);
}

function calendarBlockMeta(
  entry: CalendarEntry,
  now: number,
  reviewNeeded: boolean,
  metrics?: Pick<CalendarBlockMetrics, "continuesIntoNextDay">
) {
  const timeLabel = formatEntryTimeRange(entry, now);
  const suffix = entry.isActive ? "running" : formatDuration(entryDurationSeconds(entry, now));
  const labels = [
    reviewNeeded ? REVIEW_COPY.needsReview : null,
    metrics?.continuesIntoNextDay ? "Continues next day" : null,
    timeLabel,
    suffix
  ].filter(Boolean);
  return labels.join(" · ");
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

function touchDistance(touches: ArrayLike<{ pageX: number; pageY: number }>) {
  if (touches.length < 2) return 0;
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}

function touchMidpointLocationY(touches: ArrayLike<{ locationY: number }>) {
  if (touches.length < 2) return 0;
  return (touches[0].locationY + touches[1].locationY) / 2;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
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

function buildTodaySummarySegments(
  entries: TimeEntry[],
  now: number,
  mode: MobileTheme["mode"]
): SummarySegment[] {
  const periodStart = startOfToday(now);
  const totals = new Map<string, Omit<SummarySegment, "share">>();

  for (const entry of entries) {
    if (isReviewNeededEntry(entry)) continue;
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
      color: current?.color ?? entryCategoryColor(entry, mode)
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
