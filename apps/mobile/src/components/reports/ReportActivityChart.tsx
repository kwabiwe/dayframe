import { useEffect, useRef, useState } from "react";
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
import {
  formatReportDuration,
  spokenReportDuration,
  reportAxis,
} from "@/lib/reportsPresentation";
import {
  reportBucketAtX,
  reportAxisLabels,
  reportTooltipLeft,
} from "@/lib/reportPlot";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";
import type { ReportAxisLayout, ReportBucket } from "@/lib/reportsRanges";
import { CalendarGlyph } from "@/components/calendar/DatePickerCalendar";
import { useReportTextMeasure } from "./ReportTextMeasure";
const HEIGHT = 168;
const LABEL_HEIGHT = 38;
export function ReportActivityChart({
  buckets,
  axisLayout,
  theme,
  reduceMotion,
  semanticContextKey,
  outsidePressDismissal,
}: {
  buckets: Array<ReportBucket & { seconds: number }>;
  axisLayout: ReportAxisLayout;
  theme: MobileTheme;
  reduceMotion: boolean;
  semanticContextKey: string;
  outsidePressDismissal: number;
}) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [plotWidth, setPlotWidth] = useState(220);
  const touch = useRef({ y: 0, moved: false });
  useEffect(() => setTooltip(null), [semanticContextKey]);
  useEffect(() => setTooltip(null), [outsidePressDismissal]);
  const axis = reportAxis(Math.max(0, ...buckets.map((b) => b.seconds)));
  const measuredTicks = useReportTextMeasure(
    axis.ticks.map((tick) => tick.label),
    { fontSize: 10, fontVariant: ["tabular-nums"] },
    REPORT_TEXT_CAP.small,
  );
  const gutter = Math.max(
    1,
    ...axis.ticks.map(
      (tick) => measuredTicks.widths[tick.label] ?? tick.label.length * 8,
    ),
  );
  const selectedIndex = buckets.findIndex((b) => b.key === tooltip);
  const selected = buckets[selectedIndex];
  const labels = reportAxisLabels(buckets, axisLayout, plotWidth);
  const slot = plotWidth / Math.max(1, buckets.length);
  const barWidth =
    buckets.length === 1
      ? Math.min(64, plotWidth * 0.25)
      : Math.min(20, slot * 0.65);
  const move = (offset: number) => {
    const index =
      selectedIndex < 0
        ? 0
        : Math.max(0, Math.min(buckets.length - 1, selectedIndex + offset));
    if (buckets[index]) setTooltip(buckets[index].key);
  };
  return (
    <View style={s.root}>
      {measuredTicks.probe}
      <Pressable accessible={false} onPress={() => setTooltip(null)}>
        <Text
          maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
          style={[s.title, { color: theme.textPrimary }]}
        >
          Activity over time
        </Text>
      </Pressable>
      <View style={s.plotRow}>
        <View testID="report-axis" style={{ width: gutter, height: HEIGHT }}>
          {axis.ticks.map((tick) => (
            <Text
              key={tick.seconds}
              maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
              numberOfLines={1}
              style={[
                s.tick,
                {
                  color: theme.textSecondary,
                  top: (1 - tick.seconds / axis.maximum) * HEIGHT - 8,
                },
              ]}
            >
              {tick.label}
            </Text>
          ))}
        </View>
        <View
          style={s.plot}
          onLayout={(event) => setPlotWidth(event.nativeEvent.layout.width)}
        >
          <Pressable
            testID="report-plot"
            accessibilityRole="adjustable"
            accessibilityLabel="Activity over time, select a bucket"
            accessibilityValue={{
              min: 1,
              max: buckets.length,
              now: Math.max(1, selectedIndex + 1),
              text: selected
                ? `${selected.fullLabel}, ${spokenReportDuration(selected.seconds)}`
                : "Adjust to inspect each period",
            }}
            accessibilityActions={[
              { name: "increment", label: "Next bucket" },
              { name: "decrement", label: "Previous bucket" },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "increment") move(1);
              else if (event.nativeEvent.actionName === "decrement") move(-1);
            }}
            onTouchStart={(event) => {
              touch.current = { y: event.nativeEvent.pageY, moved: false };
            }}
            onTouchMove={(event) => {
              if (Math.abs(event.nativeEvent.pageY - touch.current.y) > 8)
                touch.current.moved = true;
            }}
            onPress={(event) => {
              event.stopPropagation();
              if (touch.current.moved) return;
              const i = reportBucketAtX(
                event.nativeEvent.locationX,
                plotWidth,
                buckets.length,
              );
              if (i !== null) setTooltip(buckets[i].key);
            }}
            style={{ height: HEIGHT }}
          >
            <View
              pointerEvents="none"
              accessible={false}
              accessibilityElementsHidden
              style={StyleSheet.absoluteFill}
            >
              {axis.ticks.map((tick) => (
                <View
                  key={tick.seconds}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: (1 - tick.seconds / axis.maximum) * HEIGHT,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.border,
                  }}
                />
              ))}
              {buckets.map((bucket, i) => (
                <View
                  key={bucket.key}
                  style={{
                    position: "absolute",
                    left: i * slot,
                    width: slot,
                    bottom: 0,
                    alignItems: "center",
                  }}
                >
                  <ReportBar
                    height={(bucket.seconds / axis.maximum) * HEIGHT}
                    width={barWidth}
                    theme={theme}
                    reduceMotion={reduceMotion}
                  />
                </View>
              ))}
            </View>
          </Pressable>
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            style={s.labels}
          >
            {labels.map((label) => {
              const position =
                label.anchor === "left"
                  ? { left: 0, width: 52, alignItems: "flex-start" as const }
                  : label.anchor === "right"
                    ? { right: 0, width: 52, alignItems: "flex-end" as const }
                    : {
                        left: label.index * slot,
                        width: slot,
                        alignItems: "center" as const,
                      };
              return (
                <View
                  key={`${label.index}:${label.primary}`}
                  style={[s.xLabelSlot, position]}
                >
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
                    style={[s.xLabel, { color: theme.textSecondary }]}
                  >
                    {label.primary}
                  </Text>
                  {label.secondary ? (
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
                      style={[s.xLabel, { color: theme.textSecondary }]}
                    >
                      {label.secondary}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
          {selected ? (
            <ReportTooltip
              bucket={selected}
              index={selectedIndex}
              count={buckets.length}
              plotWidth={plotWidth}
              theme={theme}
              reduceMotion={reduceMotion}
              onMove={move}
              onClose={() => setTooltip(null)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}
function ReportTooltip({
  bucket,
  index,
  count,
  plotWidth,
  theme,
  reduceMotion,
  onMove,
  onClose,
}: {
  bucket: ReportBucket & { seconds: number };
  index: number;
  count: number;
  plotWidth: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  onMove: (offset: number) => void;
  onClose: () => void;
}) {
  const width = Math.min(240, plotWidth);
  const target = reportTooltipLeft(index, count, plotWidth, width);
  const left = useSharedValue(target),
    opacity = useSharedValue(1);
  useEffect(() => {
    left.value = withTiming(target, {
      duration: reduceMotion ? 0 : MOBILE_MOTION.layout,
    });
    opacity.value = reduceMotion ? 1 : 0.45;
    opacity.value = withTiming(1, {
      duration: reduceMotion ? 0 : MOBILE_MOTION.control,
    });
  }, [bucket.key, target, reduceMotion, left, opacity]);
  const style = useAnimatedStyle(() => ({
    left: left.value,
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      testID="report-tooltip"
      entering={FadeIn.duration(reduceMotion ? 0 : MOBILE_MOTION.control)}
      exiting={FadeOut.duration(reduceMotion ? 0 : MOBILE_MOTION.control)}
      style={[s.tooltip, { width, backgroundColor: theme.surfaceMuted }, style]}
    >
      <ScrollView style={{ maxHeight: 112 }}>
        <Text
          maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
          accessibilityLabel={`${bucket.fullLabel}, ${spokenReportDuration(bucket.seconds)}`}
          style={{ color: theme.textPrimary, fontSize: 14 }}
        >
          {bucket.fullLabel}: {formatReportDuration(bucket.seconds)}
        </Text>
      </ScrollView>
      <View style={s.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous bucket"
          accessibilityState={{ disabled: index === 0 }}
          disabled={index === 0}
          onPress={() => onMove(-1)}
          style={s.action}
        >
          <CalendarGlyph kind="left" color={theme.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close bucket details"
          onPress={onClose}
          style={s.action}
        >
          <Text
            maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
            style={{ color: theme.textPrimary, fontSize: 13 }}
          >
            Close
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next bucket"
          accessibilityState={{ disabled: index === count - 1 }}
          disabled={index === count - 1}
          onPress={() => onMove(1)}
          style={s.action}
        >
          <CalendarGlyph kind="right" color={theme.textPrimary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
function ReportBar({
  height,
  width,
  theme,
  reduceMotion,
}: {
  height: number;
  width: number;
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
      style={[s.bar, { width, backgroundColor: theme.accent }, style]}
    />
  );
}
const s = StyleSheet.create({
  root: { gap: 16, paddingTop: 24 },
  title: { fontSize: 18, fontWeight: "600" },
  plotRow: { flexDirection: "row", gap: 8, paddingTop: 8 },
  plot: { flex: 1, minWidth: 0 },
  tick: {
    position: "absolute",
    left: 0,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    textAlign: "left",
  },
  labels: { height: LABEL_HEIGHT },
  xLabelSlot: {
    position: "absolute",
    top: 6,
  },
  xLabel: { fontSize: 9, textAlign: "center" },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  tooltip: {
    position: "absolute",
    bottom: LABEL_HEIGHT + 2,
    borderRadius: 12,
    padding: 8,
    maxWidth: "100%",
  },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  action: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
