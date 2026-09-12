import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import { DonutChart, type DonutChartSegment } from "../charts/DonutChart";
import { useIntrinsicTextMeasure } from "../accessibility/IntrinsicTextMeasure";
import type { TodayActivity, TodayDonutSegment } from "../../lib/todayReviewPresentation";
import { layoutTodayDonutLabels } from "../../lib/todayDonutLabels";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

const CHART_SIZE = 184;

export function TodayReviewDonut({
  animateEntrance,
  activities,
  isFocused,
  onOpenActivity,
  segments,
  completedLoggedMs,
  reduceMotion,
  theme
}: {
  animateEntrance: boolean;
  activities: readonly TodayActivity[];
  isFocused: boolean;
  onOpenActivity: (activity: TodayActivity) => void;
  segments: readonly TodayDonutSegment[];
  completedLoggedMs: number;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const activityBySegmentId = useMemo(() => new Map(segments.flatMap((segment) => {
    const activity = activityForSegment(segment, activities);
    return activity ? [[segment.id, activity] as const] : [];
  })), [activities, segments]);
  const chartSegments = useMemo(() => segments.map((segment): DonutChartSegment => ({
    id: segment.id,
    value: segment.valueMs,
    color: segmentColor(segment, theme),
    selected: true,
    isUncategorized: isUncategorized(segment),
    provisional: segment.provisional,
    interactive: Boolean(segment.provisional && activityBySegmentId.get(segment.id))
  })), [activityBySegmentId, segments, theme]);
  const labelSamples = useMemo(
    () => segments.map((segment) => labelText(segment)),
    [segments]
  );
  const labelMeasure = useIntrinsicTextMeasure(
    labelSamples,
    styles.labelText,
    1.3,
    "today-donut-label"
  );
  const measuredWidths = useMemo(() => Object.fromEntries(segments.map((segment) => [
    segment.id,
    labelMeasure.widths[labelText(segment)]
  ])), [labelMeasure.widths, segments]);
  const labels = useMemo(() => {
    if (!availableWidth || segments.length === 0) return [];
    return layoutTodayDonutLabels({
      availableWidth,
      chartSize: CHART_SIZE,
      candidates: segments.map((segment) => ({
        id: segment.id,
        title: labelText(segment),
        valueMs: segment.valueMs,
        provisional: segment.provisional
      })),
      measuredWidths
    });
  }, [availableWidth, measuredWidths, segments]);

  return (
    <View
      testID="today-review-donut"
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        if (Number.isFinite(width) && width > 0) setAvailableWidth((current) => current === width ? current : width);
      }}
      style={styles.root}
    >
      {labelMeasure.probe}
      <View style={[styles.canvas, { height: CHART_SIZE }]}>
        <View style={styles.chartLayer}>
          <DonutChart
            accessibilityLabel={`Today completed activity. Total logged ${spokenDuration(completedLoggedMs)}. ${segments.filter((segment) => segment.provisional).length} pending Review ${segments.filter((segment) => segment.provisional).length === 1 ? "item" : "items"}.`}
            animateEntrance={animateEntrance && chartSegments.length > 0}
            centerLabel="Total logged"
            centerValue={formatDuration(completedLoggedMs)}
            spokenValue={spokenDuration(completedLoggedMs)}
            onPressSegment={(segment) => {
              const activity = activityBySegmentId.get(segment.id);
              if (activity) onOpenActivity(activity);
            }}
            reduceMotion={reduceMotion}
            segments={chartSegments}
            settleImmediately={!isFocused}
            theme={theme}
          />
        </View>
        {labels.map((label) => {
          const segment = segments.find((candidate) => candidate.id === label.id);
          const activity = activityBySegmentId.get(label.id);
          const content = (
            <Text
              {...mobileTextProps("metadata")}
              numberOfLines={2}
              style={[styles.labelText, { color: theme.textSecondary, textAlign: label.side === "left" ? "right" : "left" }]}
            >
              {label.title}
            </Text>
          );
          const position = { left: label.x, top: label.y, width: label.width };
          return activity && segment?.provisional ? (
            <View key={label.id}>
              <View
                pointerEvents="none"
                style={[
                  styles.labelLeader,
                  { backgroundColor: theme.borderStrong },
                  label.side === "left"
                    ? { left: label.x + label.width, top: label.y + 17 }
                    : { left: label.x - 8, top: label.y + 17 }
                ]}
              />
              <Pressable
                accessibilityLabel={`Open Review proposal: ${label.title}`}
                accessibilityRole="button"
                onPress={() => onOpenActivity(activity)}
                style={({ pressed }) => [styles.labelSlot, position, pressed ? { opacity: 0.7 } : null]}
              >
                {content}
              </Pressable>
            </View>
          ) : (
            <View key={label.id}>
              <View
                pointerEvents="none"
                style={[
                  styles.labelLeader,
                  { backgroundColor: theme.borderStrong },
                  label.side === "left"
                    ? { left: label.x + label.width, top: label.y + 17 }
                    : { left: label.x - 8, top: label.y + 17 }
                ]}
              />
              <View accessible={false} pointerEvents="none" style={[styles.labelSlot, position]}>
                {content}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function segmentColor(segment: TodayDonutSegment, theme: MobileTheme) {
  const category = segment.category;
  if (!category || (!category.id && !category.name)) return theme.textSecondary;
  return paletteColorFor(
    category.color ?? category.id,
    category.name ?? "Uncategorized",
    theme.mode
  );
}

function isUncategorized(segment: TodayDonutSegment) {
  return !segment.category || (!segment.category.id && !segment.category.name);
}

function activityForSegment(segment: TodayDonutSegment, activities: readonly TodayActivity[]) {
  const source = segment.source;
  if (!source) return null;
  if (source.kind === "review") {
    return activities.find((activity) =>
      activity.source.kind === "review" && activity.source.reviewItemId === source.reviewItemId
    ) ?? null;
  }
  if (source.kind === "legacy_review_entry") {
    return activities.find((activity) =>
      activity.source.kind === "legacy_review_entry" && activity.source.entryId === source.entryId
    ) ?? null;
  }
  return null;
}

function labelText(segment: TodayDonutSegment) {
  const title = segment.kind === "pending" ? `? ${segment.title}` : segment.title;
  return `${title} · ${formatDuration(segment.valueMs)}`;
}

function formatDuration(valueMs: number) {
  const seconds = Math.max(0, Math.floor(valueMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function spokenDuration(valueMs: number) {
  const seconds = Math.max(0, Math.floor(valueMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts = [
    hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : null,
    minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : null
  ].filter(Boolean);
  return parts.join(", ") || "0 minutes";
}

const styles = StyleSheet.create({
  root: { width: "100%" },
  canvas: { position: "relative", width: "100%" },
  chartLayer: {
    alignItems: "center",
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  labelSlot: { position: "absolute", justifyContent: "center", minHeight: 34 },
  labelLeader: {
    height: 1,
    position: "absolute",
    width: 8
  },
  labelText: { fontFamily: "System", fontSize: 10, lineHeight: 14, fontWeight: "600" }
});
