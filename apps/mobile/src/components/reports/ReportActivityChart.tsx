import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION } from "@/lib/motion";
import { formatReportDuration, reportAxis } from "@/lib/reportsPresentation";
import type { ReportBucket } from "@/lib/reportsRanges";

export function ReportActivityChart({
  buckets,
  theme,
  reduceMotion,
  contextKey,
}: {
  buckets: Array<ReportBucket & { seconds: number }>;
  theme: MobileTheme;
  reduceMotion: boolean;
  contextKey: string;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [plotWidth, setPlotWidth] = useState(240);
  const [scrollX, setScrollX] = useState(0);
  useEffect(() => setTooltip(null), [contextKey]);
  const axis = reportAxis(Math.max(0, ...buckets.map((b) => b.seconds)));
  const selected = buckets.find((b) => b.key === tooltip);
  return (
    <Pressable
      accessible={false}
      onPress={() => setTooltip(null)}
      style={s.root}
    >
      <Text style={[s.title, { color: theme.textPrimary }]}>
        Activity over time
      </Text>
      <View style={s.plotRow}>
        <View style={s.axis}>
          {axis.ticks.map((tick) => (
            <Text
              key={tick.seconds}
              maxFontSizeMultiplier={1.3}
              style={[s.tick, { color: theme.textSecondary }]}
            >
              {tick.label}
            </Text>
          ))}
        </View>
        <View
          style={s.plot}
          onLayout={(event) => setPlotWidth(event.nativeEvent.layout.width)}
        >
          <View pointerEvents="none" style={s.grid}>
            {axis.ticks.map((tick) => (
              <View
                key={tick.seconds}
                style={{
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.border,
                }}
              />
            ))}
          </View>
          <ScrollView
            horizontal
            directionalLockEnabled
            onScroll={(event) => setScrollX(event.nativeEvent.contentOffset.x)}
            scrollEventThrottle={32}
            onScrollBeginDrag={() => setTooltip(null)}
            showsHorizontalScrollIndicator
            contentContainerStyle={s.columns}
          >
            {buckets.map((bucket) => (
              <Pressable
                key={bucket.key}
                accessibilityRole={bucket.seconds > 0 ? "button" : "text"}
                accessibilityLabel={`${bucket.fullLabel}, ${formatReportDuration(bucket.seconds)}`}
                onPress={(event) => {
                  event.stopPropagation();
                  setTooltip(bucket.seconds > 0 ? bucket.key : null);
                }}
                style={s.column}
              >
                <View style={s.barTrack}>
                  <ReportBar
                    height={(bucket.seconds / axis.maximum) * 160}
                    theme={theme}
                    reduceMotion={reduceMotion}
                  />
                </View>
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={[s.xLabel, { color: theme.textSecondary }]}
                >
                  {bucket.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {selected ? (
            <Animated.View
              pointerEvents="none"
              entering={FadeIn.duration(
                reduceMotion ? 0 : MOBILE_MOTION.control,
              )}
              exiting={FadeOut.duration(
                reduceMotion ? 0 : MOBILE_MOTION.control,
              )}
              style={[
                s.tooltip,
                {
                  width: Math.min(220, plotWidth),
                  left: Math.max(
                    0,
                    Math.min(
                      plotWidth - Math.min(220, plotWidth),
                      buckets.indexOf(selected) *
                        Math.max(44, plotWidth / buckets.length) -
                        scrollX,
                    ),
                  ),
                  backgroundColor: theme.surfaceMuted,
                },
              ]}
            >
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: theme.textPrimary }}
              >
                {selected.fullLabel}: {formatReportDuration(selected.seconds)}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
function ReportBar({
  height,
  theme,
  reduceMotion,
}: {
  height: number;
  theme: MobileTheme;
  reduceMotion: boolean;
}) {
  const value = useSharedValue(height);
  useEffect(() => {
    value.value = withTiming(height, {
      duration: reduceMotion ? 0 : MOBILE_MOTION.layout,
    });
  }, [height, reduceMotion, value]);
  const style = useAnimatedStyle(() => ({ height: value.value }));
  return (
    <Animated.View
      testID="report-activity-bar"
      style={[s.bar, { backgroundColor: theme.accent }, style]}
    />
  );
}
const s = StyleSheet.create({
  root: { gap: 12, paddingTop: 24 },
  title: { fontSize: 18, fontWeight: "600" },
  tooltip: {
    position: "absolute",
    bottom: 42,
    borderRadius: 12,
    padding: 12,
    maxWidth: "100%",
  },
  plotRow: { flexDirection: "row", gap: 8 },
  axis: { height: 160, justifyContent: "space-between", minWidth: 38 },
  tick: { fontSize: 10, fontVariant: ["tabular-nums"] },
  plot: { flex: 1, minWidth: 0 },
  grid: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 160,
    justifyContent: "space-between",
  },
  columns: { flexGrow: 1 },
  column: { alignItems: "center", minWidth: 44, flex: 1 },
  barTrack: { height: 160, justifyContent: "flex-end", alignItems: "center" },
  bar: { width: 12, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  xLabel: { fontSize: 11, paddingTop: 8, minHeight: 28 },
});
