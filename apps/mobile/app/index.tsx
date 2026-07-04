import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AppState,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle
} from "react-native";
import { router } from "expo-router";
import { AlertCircle, Check, Inbox, Play, RefreshCw, Save, Settings, Square } from "lucide-react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { paletteColorFor } from "@dayframe/shared";
import {
  AuthRequiredError,
  enqueueEvent,
  fetchBootstrap,
  login,
  readQueue,
  resolveReviewItem,
  signup,
  startTimer,
  stopTimer,
  syncQueue,
  updateTimeEntry,
  type MobileBootstrap,
  type QueuedEvent
} from "@/lib/api";
import { handleDayframeUrl } from "@/lib/deepLinks";
import { useMobileTheme, type MobileTheme } from "@/lib/theme";

type TimeEntry = MobileBootstrap["entries"][number];
type Category = MobileBootstrap["categories"][number];
type ReviewItem = MobileBootstrap["reviewItems"][number];
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
type StartStatus =
  | { kind: "idle" }
  | { kind: "starting"; label: string }
  | { kind: "queued"; label: string }
  | { kind: "error"; label: string };

const periodLabels: Record<SummaryPeriod, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year"
};

export default function HomeScreen() {
  const { theme } = useMobileTheme();
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
  const [now, setNow] = useState(() => Date.now());
  const [taskDraft, setTaskDraft] = useState("");
  const [startStatus, setStartStatus] = useState<StartStatus>({ kind: "idle" });
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>("day");
  const [startCategoryDraft, setStartCategoryDraft] = useState("");
  const [activeDescriptionDraft, setActiveDescriptionDraft] = useState("");
  const [activeCategoryDraft, setActiveCategoryDraft] = useState("");
  const [savingActive, setSavingActive] = useState(false);
  const refreshInFlight = useRef(false);
  const refreshSequence = useRef(0);

  const load = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    if (refreshInFlight.current && !options?.force) return null;
    const sequence = ++refreshSequence.current;
    refreshInFlight.current = true;
    if (!options?.silent) setLoading(true);
    try {
      const [bootstrap, queued] = await Promise.all([fetchBootstrap(), readQueue()]);
      if (sequence === refreshSequence.current) {
        setData(bootstrap);
        setQueue(queued);
        setAuthState("authenticated");
      }
      return bootstrap;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        if (sequence === refreshSequence.current) {
          setData(null);
          setAuthState("signedOut");
        }
        return null;
      }
      if (!options?.silent && sequence === refreshSequence.current) {
        Alert.alert("Dayframe API", error instanceof Error ? error.message : "Unable to load API");
      }
      return null;
    } finally {
      if (sequence === refreshSequence.current) {
        refreshInFlight.current = false;
        if (!options?.silent) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (authState === "authenticated") void load({ silent: true });
    }, data?.activeEntry || queue.length > 0 || startStatus.kind !== "idle" ? 3000 : 15000);
    return () => clearInterval(interval);
  }, [authState, data?.activeEntry, load, queue.length, startStatus.kind]);

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
      await load({ silent: true });
    });
    Linking.getInitialURL().then(async (url) => {
      if (!url) return;
      await handleDayframeUrl(url);
      setQueue(await readQueue());
      await load({ silent: true });
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    const active = data?.activeEntry;
    setActiveDescriptionDraft(active?.description ?? "");
    setActiveCategoryDraft(active?.categoryId ?? "");
  }, [data?.activeEntry?.categoryId, data?.activeEntry?.description, data?.activeEntry?.id]);

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
  const openReviewItems = (data?.reviewItems ?? []).filter((item) => item.status === "open");
  const categories = data?.categories ?? [];

  useEffect(() => {
    if (categories.length === 0) {
      if (startCategoryDraft) setStartCategoryDraft("");
      return;
    }
    if (!categories.some((category) => category.id === startCategoryDraft)) {
      setStartCategoryDraft(categories[0].id);
    }
  }, [categories, startCategoryDraft]);

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

  async function beginStart(categoryId?: string | null) {
    if (startStatus.kind === "starting") return;
    const description = taskDraft.trim();
    setStartStatus({ kind: "starting", label: "Starting..." });
    try {
      const startResult = await startTimer(undefined, categoryId ?? undefined, description || undefined);
      const confirmedActive = startResult.activeEntry ?? null;
      setTaskDraft("");
      const bootstrap = await load({ force: true });
      if (!bootstrap?.activeEntry) {
        if (confirmedActive) {
          setData((current) => (current ? { ...current, activeEntry: confirmedActive } : current));
          setStartStatus({ kind: "idle" });
          return;
        }
        setStartStatus({ kind: "starting", label: "Started. Refreshing timer state..." });
        const retry = await load({ force: true, silent: true });
        if (!retry?.activeEntry) {
          if (confirmedActive) {
            setData((current) => (current ? { ...current, activeEntry: confirmedActive } : current));
            setStartStatus({ kind: "idle" });
            return;
          }
          setStartStatus({
            kind: "error",
            label: "Timer start was accepted, but the active timer did not refresh. Pull to refresh or try again."
          });
          return;
        }
      }
      setStartStatus({ kind: "idle" });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        setStartStatus({ kind: "idle" });
        return;
      }

      const nextQueue = await enqueueEvent({
        source: "mobile_app",
        type: "timer_start",
        categoryId: categoryId ?? undefined,
        description: description || undefined,
        rawPayload: { origin: "mobile_dashboard_start_fallback" }
      });
      setQueue(nextQueue);
      setStartStatus({ kind: "queued", label: "Queued. Syncing when the API is ready." });
      try {
        const result = await syncQueue();
        setQueue(result.remaining);
        await load({ silent: true });
        if (result.remaining.length === 0) {
          setTaskDraft("");
          setStartStatus({ kind: "idle" });
        }
      } catch (syncError) {
        if (syncError instanceof AuthRequiredError) {
          setAuthState("signedOut");
          setData(null);
          setStartStatus({ kind: "idle" });
          return;
        }
      }
    }
  }

  async function stopActiveTimer() {
    try {
      await stopTimer();
      await load({ force: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      const nextQueue = await enqueueEvent({
        source: "mobile_app",
        type: "timer_stop",
        rawPayload: { origin: "mobile_dashboard_stop_fallback" }
      });
      setQueue(nextQueue);
      Alert.alert("Timer queued", "The stop action is queued and will sync when the API is ready.");
    }
  }

  async function saveActiveTimer() {
    const active = data?.activeEntry;
    if (!active || savingActive) return;
    setSavingActive(true);
    try {
      await updateTimeEntry(active.id, {
        description: activeDescriptionDraft.trim() || null,
        categoryId: activeCategoryDraft || null
      });
      await load({ force: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      Alert.alert("Timer", error instanceof Error ? error.message : "Unable to save timer changes.");
    } finally {
      setSavingActive(false);
    }
  }

  function openReviewItem(item: ReviewItem) {
    Alert.alert(item.title, "Review this activity suggestion.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Ignore",
        style: "destructive",
        onPress: () => {
          void resolveReview(item.id, "ignore_once");
        }
      },
      {
        text: "Accept",
        onPress: () => {
          void resolveReview(item.id, "accept");
        }
      }
    ]);
  }

  async function resolveReview(id: string, action: "accept" | "ignore_once") {
    try {
      await resolveReviewItem(id, action);
      await load({ force: true });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthState("signedOut");
        setData(null);
        return;
      }
      Alert.alert("Review", error instanceof Error ? error.message : "Unable to update review item.");
    }
  }

  if (authState === "signedOut") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Header styles={styles} />
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
        <View style={styles.contentStack}>
          <Header
            styles={styles}
            action={
              <IconButton
                accessibilityLabel="Open settings"
                icon={<Settings size={21} color={theme.accent} />}
                onPress={() => router.push("/settings")}
                styles={styles}
              />
            }
          />

          <TimerCard
            activeCategoryDraft={activeCategoryDraft}
            activeDescriptionDraft={activeDescriptionDraft}
            activeDurationSeconds={activeDurationSeconds}
            categories={categories}
            data={data}
            onCategoryDraft={setActiveCategoryDraft}
            onDescriptionDraft={setActiveDescriptionDraft}
            onSave={saveActiveTimer}
            onStop={stopActiveTimer}
            saving={savingActive}
            startStatus={startStatus}
            styles={styles}
            theme={theme}
          />

          <StartTaskCard
            categories={categories}
            disabled={startStatus.kind === "starting"}
            onStart={beginStart}
            onSelectCategory={setStartCategoryDraft}
            setTaskDraft={setTaskDraft}
            selectedCategoryId={startCategoryDraft}
            startStatus={startStatus}
            styles={styles}
            taskDraft={taskDraft}
            theme={theme}
          />

          <TodaySummary
            onOpenReview={openReviewItem}
            period={summaryPeriod}
            reviewItems={openReviewItems}
            segments={summarySegments}
            setPeriod={setSummaryPeriod}
            styles={styles}
            theme={theme}
            total={summaryTotal}
          />

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({
  action,
  styles
}: {
  action?: ReactNode;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.header}>
      <Image
        source={require("../assets/dayframe_logo_banner.png")}
        style={styles.logoImage}
        resizeMode="contain"
      />
      {action}
    </View>
  );
}

function IconButton({
  accessibilityLabel,
  icon,
  onPress,
  styles
}: {
  accessibilityLabel: string;
  icon: ReactNode;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={pressable(styles.iconButton, styles.buttonPressed)}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  );
}

function TimerCard({
  activeCategoryDraft,
  activeDescriptionDraft,
  activeDurationSeconds,
  categories,
  data,
  onCategoryDraft,
  onDescriptionDraft,
  onSave,
  onStop,
  saving,
  startStatus,
  styles,
  theme
}: {
  activeCategoryDraft: string;
  activeDescriptionDraft: string;
  activeDurationSeconds: number;
  categories: Category[];
  data: MobileBootstrap | null;
  onCategoryDraft: (categoryId: string) => void;
  onDescriptionDraft: (description: string) => void;
  onSave: () => void;
  onStop: () => void;
  saving: boolean;
  startStatus: StartStatus;
  styles: ReturnType<typeof createStyles>;
  theme: MobileTheme;
}) {
  const active = data?.activeEntry;
  const categoryLabel = active?.categoryName ?? "No category";

  if (!active && startStatus.kind !== "idle") {
    return (
      <View style={styles.timerPanel}>
        <View style={styles.row}>
          <Text style={styles.label}>Active timer</Text>
          {startStatus.kind === "starting" ? (
            <RefreshCw size={17} color={theme.accent} />
          ) : (
            <AlertCircle size={17} color={theme.warning} />
          )}
        </View>
        <Text style={styles.timerText}>{startStatus.kind === "starting" ? "Starting..." : "Queued"}</Text>
        <Text style={styles.muted}>{startStatus.label}</Text>
      </View>
    );
  }

  return (
    <View style={styles.timerPanel}>
      <Text style={styles.label}>Active timer</Text>
      <Text style={styles.timerText}>
        {active ? active.description || active.categoryName || "Running" : "No timer"}
      </Text>
      <Text style={styles.muted}>
        {active
          ? `${formatClockDuration(activeDurationSeconds)} running in ${categoryLabel}`
          : "Start task below"}
      </Text>

      {active ? (
        <>
          <TextInput
            style={styles.textInput}
            value={activeDescriptionDraft}
            onChangeText={onDescriptionDraft}
            placeholder="Task title"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
          />
          <CategoryChipRow
            categories={categories}
            onPress={(category) => onCategoryDraft(category.id)}
            selectedId={activeCategoryDraft}
            styles={styles}
            theme={theme}
          />
          <View style={styles.buttonRow}>
            <Pressable style={pressable(styles.secondaryButton, styles.buttonPressed)} onPress={onSave}>
              <Save size={16} color={theme.accent} />
              <Text style={styles.secondaryButtonText}>{saving ? "Saving..." : "Save"}</Text>
            </Pressable>
            <Pressable style={pressable(styles.stopButton, styles.buttonPressed)} onPress={onStop}>
              <Square size={16} color="#FFFFFF" />
              <Text style={styles.stopButtonText}>Stop</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function StartTaskCard({
  categories,
  disabled,
  onStart,
  onSelectCategory,
  selectedCategoryId,
  setTaskDraft,
  startStatus,
  styles,
  taskDraft,
  theme
}: {
  categories: Category[];
  disabled: boolean;
  onStart: (categoryId?: string | null) => void;
  onSelectCategory: (categoryId: string) => void;
  selectedCategoryId?: string;
  setTaskDraft: (task: string) => void;
  startStatus: StartStatus;
  styles: ReturnType<typeof createStyles>;
  taskDraft: string;
  theme: MobileTheme;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Start task</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start task"
          disabled={disabled}
          style={pressable([styles.playButton, disabled ? styles.buttonDisabled : null], styles.buttonPressed)}
          onPress={() => onStart(selectedCategoryId || undefined)}
        >
          <Play size={18} color="#FFFFFF" fill="#FFFFFF" />
        </Pressable>
      </View>
      <TextInput
        style={styles.textInput}
        value={taskDraft}
        onChangeText={setTaskDraft}
        onSubmitEditing={() => onStart(selectedCategoryId || undefined)}
        placeholder="What are you working on?"
        placeholderTextColor={theme.textSecondary}
        returnKeyType="done"
      />
      <Text style={styles.label}>Categories</Text>
      <CategoryChipRow
        categories={categories}
        disabled={disabled}
        onPress={(category) => {
          onSelectCategory(category.id);
          onStart(category.id);
        }}
        selectedId={selectedCategoryId}
        styles={styles}
        theme={theme}
      />
      {startStatus.kind !== "idle" ? (
        <View style={styles.inlineStatus}>
          {startStatus.kind === "starting" ? <RefreshCw size={15} color={theme.accent} /> : <Check size={15} color={theme.accent} />}
          <Text style={styles.muted}>{startStatus.label}</Text>
        </View>
      ) : null}
    </View>
  );
}

function CategoryChipRow({
  categories,
  disabled,
  onPress,
  selectedId,
  styles,
  theme
}: {
  categories: Category[];
  disabled?: boolean;
  onPress: (category: Category) => void;
  selectedId?: string;
  styles: ReturnType<typeof createStyles>;
  theme: MobileTheme;
}) {
  if (categories.length === 0) {
    return <Text style={styles.muted}>Create categories in Settings.</Text>;
  }

  return (
    <View style={styles.chipWrap}>
      {categories.map((category) => {
        const selected = category.id === selectedId;
        const color = paletteColorFor(category.color, category.name);
        return (
          <Pressable
            key={category.id}
            disabled={disabled}
            style={pressable(
              [
                styles.categoryChip,
                selected ? styles.categoryChipSelected : null,
                {
                  borderColor: color,
                  backgroundColor: selected ? color : transparentColor(color, theme.mode === "dark" ? "2B" : "42")
                },
                disabled ? styles.buttonDisabled : null
              ],
              styles.buttonPressed
            )}
            onPress={() => onPress(category)}
          >
            <Text style={[styles.categoryChipText, selected ? styles.categoryChipTextSelected : null]}>
              {category.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TodaySummary({
  onOpenReview,
  period,
  reviewItems,
  segments,
  setPeriod,
  styles,
  theme,
  total
}: {
  onOpenReview: (item: ReviewItem) => void;
  period: SummaryPeriod;
  reviewItems: ReviewItem[];
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
        <DonutChart segments={segments} styles={styles} theme={theme} total={total} />
      </View>

      {total === 0 ? (
        <View style={styles.emptySummary}>
          <Text style={styles.statusText}>No tracked time yet.</Text>
          <Text style={styles.muted}>Start a category when your day begins.</Text>
        </View>
      ) : (
        <View style={styles.legendList}>
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
      )}

      <View style={styles.reviewBlock}>
        <View style={styles.row}>
          <View style={styles.inlineStatus}>
            <Inbox size={16} color={theme.accent} />
            <Text style={styles.statusText}>{reviewItems.length} reviewable</Text>
          </View>
        </View>
        {reviewItems.length === 0 ? (
          <Text style={styles.muted}>No suggestions waiting.</Text>
        ) : (
          reviewItems.slice(0, 3).map((item) => (
            <Pressable
              key={item.id}
              style={pressable(styles.reviewRow, styles.buttonPressed)}
              onPress={() => onOpenReview(item)}
            >
              <View style={styles.reviewDot} />
              <View style={styles.reviewText}>
                <Text style={styles.reviewTitle}>{item.title}</Text>
                <Text style={styles.muted}>{item.categoryName ?? item.placeName ?? item.confidence}</Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

function DonutChart({
  segments,
  styles,
  theme,
  total
}: {
  segments: SummarySegment[];
  styles: ReturnType<typeof createStyles>;
  theme: MobileTheme;
  total: number;
}) {
  const size = 220;
  const center = size / 2;
  const outerRadius = 98;
  const innerRadius = 52;
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
                const end = start + Math.max(0, fullSweep - gap);
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
    if (seconds <= 0) continue;

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
  if (safe > 0 && safe < 60) return "<1m";
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function transparentColor(hex: string, alpha: string) {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
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
      paddingBottom: 32,
      backgroundColor: theme.background
    },
    contentStack: {
      gap: 16
    },
    header: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 4
    },
    logoImage: {
      width: 166,
      height: 52
    },
    iconButton: {
      width: 44,
      height: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surface
    },
    panel: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      gap: 12
    },
    timerPanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 16,
      padding: 16,
      gap: 12
    },
    lifecyclePanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
      gap: 14
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12
    },
    label: {
      fontSize: 11,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    muted: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.textPrimary,
      fontFamily: monoFont
    },
    timerText: {
      fontSize: 27,
      fontWeight: "800",
      color: theme.accent,
      fontFamily: monoFont
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
    chipWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8
    },
    categoryChip: {
      minHeight: 36,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 7,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center"
    },
    categoryChipSelected: {
      borderWidth: 2
    },
    categoryChipText: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    },
    categoryChipTextSelected: {
      color: theme.textPrimary
    },
    colorDot: {
      width: 11,
      height: 11,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      borderRadius: 999
    },
    playButton: {
      width: 46,
      height: 46,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center"
    },
    buttonRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10
    },
    primaryButton: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 46
    },
    secondaryButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8
    },
    stopButton: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.danger,
      backgroundColor: theme.danger,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8
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
    secondaryButtonText: {
      color: theme.accent,
      fontWeight: "800",
      fontFamily: monoFont
    },
    stopButtonText: {
      color: "#FFFFFF",
      fontWeight: "800",
      fontFamily: monoFont
    },
    statusText: {
      fontSize: 13,
      color: theme.textPrimary,
      fontWeight: "800",
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
    },
    inlineStatus: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8
    },
    syncNotice: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      borderRadius: 16,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12
    },
    syncNoticeText: {
      flex: 1,
      gap: 2
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
      paddingVertical: 2
    },
    chartBox: {
      width: 220,
      height: 220,
      alignItems: "center",
      justifyContent: "center"
    },
    chartCenter: {
      position: "absolute",
      width: 104,
      height: 104,
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
    emptySummary: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 12,
      gap: 2
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
    reviewBlock: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      paddingTop: 12,
      gap: 8
    },
    reviewRow: {
      minHeight: 50,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceInset,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10
    },
    reviewDot: {
      width: 8,
      height: 28,
      borderRadius: 999,
      backgroundColor: theme.accentStrong
    },
    reviewText: {
      flex: 1,
      gap: 2
    },
    reviewTitle: {
      color: theme.textPrimary,
      fontFamily: monoFont,
      fontSize: 13,
      fontWeight: "800"
    }
  });
}
