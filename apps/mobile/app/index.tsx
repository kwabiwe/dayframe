import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
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
import Svg, { Circle, G, Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { DAYFRAME_THEME, paletteColorFor } from "@dayframe/shared";
import {
  requestLocationAccess,
  startGeofences
} from "@/lib/geofence";
import {
  enqueueEvent,
  fetchBootstrap,
  readQueue,
  stopTimer,
  syncQueue,
  type MobileBootstrap,
  type QueuedEvent
} from "@/lib/api";
import { handleDayframeUrl } from "@/lib/deepLinks";

type ThemeMode = "light" | "dark";
type MobileTheme = (typeof DAYFRAME_THEME)[ThemeMode] & {
  mode: ThemeMode;
  chartTrack: string;
  pressed: string;
};
type TimeEntry = MobileBootstrap["entries"][number];
type SummaryPeriod = "day" | "week" | "month" | "year";
type SummarySegment = {
  key: string;
  placeName: string;
  projectName: string;
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

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const theme = useMemo(() => createMobileTheme(colorScheme === "light" ? "light" : "dark"), [colorScheme]);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Not requested");
  const [now, setNow] = useState(() => Date.now());
  const [customDescription, setCustomDescription] = useState("");
  const [customProjectId, setCustomProjectId] = useState("");
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
    } catch (error) {
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

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void load({ silent: true });
    }, 1000);
    return () => clearInterval(interval);
  }, [load]);

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

  const quickActions = useMemo(() => data?.projects.slice(0, 8) ?? [], [data?.projects]);
  const selectedCustomProject = useMemo(
    () => data?.projects.find((project) => project.id === customProjectId) ?? data?.projects[0],
    [customProjectId, data?.projects]
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

  useEffect(() => {
    if (!customProjectId && data?.projects[0]) setCustomProjectId(data.projects[0].id);
  }, [customProjectId, data?.projects]);

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

  async function quickStart(projectId: string, categoryId?: string | null) {
    const nextQueue = await enqueueEvent({
      source: "mobile_app",
      type: "quick_action",
      projectId,
      categoryId: categoryId ?? undefined,
      rawPayload: { origin: "mobile_quick_action" }
    });
    setQueue(nextQueue);
    await syncAndReload();
  }

  async function customStart() {
    if (!selectedCustomProject) return;
    const trimmedDescription = customDescription.trim();
    const nextQueue = await enqueueEvent({
      source: "mobile_app",
      type: "timer_start",
      projectId: selectedCustomProject.id,
      categoryId: selectedCustomProject.categoryId ?? undefined,
      description: trimmedDescription || undefined,
      rawPayload: { origin: "mobile_custom_start" }
    });
    setQueue(nextQueue);
    if (trimmedDescription) setCustomDescription("");
    await syncAndReload();
  }

  async function syncAndReload() {
    const result = await syncQueue();
    setQueue(result.remaining);
    await load();
  }

  async function enableLocation() {
    const status = await requestLocationAccess();
    setLocationStatus(status);
    if (status === "granted" && data) {
      const count = await startGeofences(data.places);
      Alert.alert("Geofences", `Started ${count} place monitors.`);
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
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
            <View>
              <Text style={styles.title}>Dayframe</Text>
              <Text style={styles.subtitle}>Mobile capture</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable style={pressable(styles.syncButton, styles.buttonPressed)} onPress={syncAndReload}>
                <Text style={styles.secondaryButtonText}>Sync {queue.length}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.timerPanel}>
            <Text style={styles.label}>Active timer</Text>
            <Text style={styles.timerText}>
              {data?.activeEntry ? data.activeEntry.projectName ?? "Running" : "No timer"}
            </Text>
            {data?.activeEntry?.description ? (
              <Text style={styles.activeDescription}>{data.activeEntry.description}</Text>
            ) : null}
            <Text style={styles.muted}>
              {data?.activeEntry
                ? `${formatClockDuration(activeDurationSeconds)} running`
                : "Start from a quick action, NFC tag or shortcut."}
            </Text>
            {data?.activeEntry ? (
              <Pressable
                style={pressable(styles.primaryButton, styles.buttonPressed)}
                onPress={async () => {
                  setQueue(await stopTimer());
                  await syncAndReload();
                }}
              >
                <Text style={styles.primaryButtonText}>Stop current timer</Text>
              </Pressable>
            ) : null}
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
            <Text style={styles.sectionTitle}>Start task</Text>
            <TextInput
              style={styles.textInput}
              value={customDescription}
              onChangeText={setCustomDescription}
              placeholder="What are you working on?"
              placeholderTextColor={theme.textSecondary}
            />
            <Text style={styles.label}>Project</Text>
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.projectPicker}
            >
              {(data?.projects ?? []).map((project) => {
                const selected = project.id === selectedCustomProject?.id;
                const projectColor = paletteColorFor(project.color, project.name);
                return (
                  <Pressable
                    key={project.id}
                    style={pressable(
                      [styles.projectPill, selected ? styles.projectPillSelected : null],
                      styles.buttonPressed
                    )}
                    onPress={() => setCustomProjectId(project.id)}
                  >
                    <View style={[styles.colorDot, { backgroundColor: projectColor }]} />
                    <Text style={[styles.projectPillText, selected ? styles.projectPillTextSelected : null]}>
                      {project.name}
                    </Text>
                    <Text style={styles.projectPillMeta}>
                      {project.categoryName ?? project.clientName ?? "No category"}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={pressable(
                [styles.primaryButton, !selectedCustomProject ? styles.buttonDisabled : null],
                styles.buttonPressed
              )}
              disabled={!selectedCustomProject}
              onPress={customStart}
            >
              <Text style={styles.primaryButtonText}>Start task</Text>
            </Pressable>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick actions</Text>
            <Text style={styles.muted}>{quickActions.length} configured projects</Text>
          </View>
          <View style={styles.quickGrid}>
            {quickActions.map((project) => (
              <Pressable
                key={project.id}
                style={pressable(styles.quickButton, styles.buttonPressed)}
                onPress={() => quickStart(project.id, project.categoryId)}
              >
                <View style={[styles.colorRule, { backgroundColor: paletteColorFor(project.color, project.name) }]} />
                <Text style={styles.quickTitle}>{project.name}</Text>
                <Text style={styles.quickMeta}>{project.categoryName ?? project.clientName ?? "No category"}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Location permission</Text>
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
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Review</Text>
            <Text style={styles.timerText}>{data?.reviewItems.filter((item) => item.status === "open").length ?? 0}</Text>
            <Text style={styles.muted}>Open suggestions awaiting web or mobile review.</Text>
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
              <Text style={styles.legendPlace}>{segment.placeName}</Text>
              <Text style={styles.legendProject}>{segment.projectName}</Text>
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
    const placeName = entry.placeName ?? "No place";
    const projectName = entry.projectName ?? "Unassigned";
    const key = `${placeName}:${projectName}`;
    const current = totals.get(key);
    const seconds = entry.stoppedAt
      ? entry.durationSeconds
      : Math.max(entry.durationSeconds, Math.floor((now - startedAt) / 1000));

    totals.set(key, {
      key,
      placeName,
      projectName,
      seconds: (current?.seconds ?? 0) + seconds,
      color: current?.color ?? paletteColorFor(entry.projectColor, projectName)
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
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

const monoFont = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "Courier"
});

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
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14
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
      padding: 16,
      gap: 10
    },
    timerPanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
      padding: 16,
      gap: 10
    },
    lifecyclePanel: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      padding: 16,
      gap: 14
    },
    label: {
      fontSize: 11,
      color: theme.textSecondary,
      fontFamily: monoFont
    },
    timerText: {
      fontSize: 28,
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
      fontSize: 18,
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
      backgroundColor: theme.surfaceMuted
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
      padding: 14,
      justifyContent: "space-between",
      overflow: "hidden"
    },
    colorRule: {
      height: 3,
      marginBottom: 10
    },
    colorDot: {
      width: 12,
      height: 12,
      borderWidth: 1,
      borderColor: theme.borderStrong
    },
    textInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
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
      paddingHorizontal: 14,
      paddingVertical: 10
    },
    syncButton: {
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surfaceInset,
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
    statusText: {
      fontSize: 13,
      color: theme.textPrimary,
      fontWeight: "700",
      fontFamily: monoFont
    }
  });
}
