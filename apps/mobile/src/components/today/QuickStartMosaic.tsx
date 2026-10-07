import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { ActivityIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { localLayoutTransition, localPresenceEntering } from "../../lib/motion";
import { QUICK_START_MOSAIC, type QuickStartColumn, type QuickStartTile } from "../../lib/quickStartMosaic";
import { compactDuration, spokenDuration } from "./todayBlocksLayout";

/**
 * Pinned activities as solid blocks sized by this week's time. Tap starts one, or switches to it while
 * another runs; the running activity's tile opens the running timer instead of starting a duplicate.
 */
export function QuickStartMosaic({
  columns,
  onOpenRunning,
  onStartActivity,
  reduceMotion,
  runningActivityId,
  timerRunning,
  theme,
}: {
  columns: QuickStartColumn[];
  onOpenRunning: () => void;
  onStartActivity: (activityId: string) => void;
  reduceMotion: boolean;
  runningActivityId: string | null;
  timerRunning: boolean;
  theme: MobileTheme;
}) {
  // Tiles settle without an entrance on first paint; later arrivals (a newly pinned activity) fade in.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  if (!columns.length) return null;

  return (
    <View style={styles.section} testID="today-quick-start">
      <View style={styles.header}>
        <Text
          {...mobileTextProps("sectionHeading")}
          accessibilityRole="header"
          style={[styles.heading, { color: theme.textPrimary }]}
        >
          {timerRunning ? "Switch to" : "Start an activity"}
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.caption, { color: theme.textSecondary }]}>
          Sized by this week
        </Text>
      </View>
      <View style={styles.mosaic}>
        {columns.map((column) => (
          <View key={column.key} style={[styles.column, { flex: column.flex }]}>
            {column.tiles.map((tile) => (
              <Reanimated.View
                entering={mounted.current ? localPresenceEntering(reduceMotion) : undefined}
                key={tile.id}
                layout={localLayoutTransition(reduceMotion)}
                style={{ height: tile.height }}
              >
                <QuickStartTileButton
                  onPress={() => (tile.id === runningActivityId ? onOpenRunning() : onStartActivity(tile.id))}
                  recording={tile.id === runningActivityId}
                  switching={timerRunning && tile.id !== runningActivityId}
                  theme={theme}
                  tile={tile}
                />
              </Reanimated.View>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function QuickStartTileButton({
  onPress,
  recording,
  switching,
  theme,
  tile,
}: {
  onPress: () => void;
  recording: boolean;
  switching: boolean;
  theme: MobileTheme;
  tile: QuickStartTile;
}) {
  const colors = blockColorsFor(tile.color ?? tile.id, theme.mode, tile.name);
  const week = `${spokenDuration(tile.weekSeconds)} this week`;
  const label = recording
    ? `${tile.name}, recording. Edit running timer`
    : `${switching ? "Switch to" : "Start"} ${tile.name}, ${week}`;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        tile.compact ? styles.tileCompact : null,
        { backgroundColor: colors.fill },
        recording ? [styles.tileRecording, { borderColor: colors.text }] : null,
        pressed ? styles.pressed : null,
      ]}
      testID={`quick-start-${tile.id}`}
    >
      <ActivityIcon color={colors.text} icon={tile.icon} name={tile.name} size={18} />
      <View style={tile.compact ? styles.textCompact : null}>
        <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          {tile.name}
        </Text>
        {tile.compact ? null : (
          <Text {...mobileTextProps("counter")} numberOfLines={1} style={[styles.time, { color: colors.text }]}>
            {recording ? "Recording" : compactDuration(tile.weekSeconds)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  header: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", gap: 12 },
  heading: { fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  caption: { fontSize: 13, fontWeight: "500" },
  mosaic: { flexDirection: "row", gap: QUICK_START_MOSAIC.gap, height: QUICK_START_MOSAIC.height },
  column: { gap: QUICK_START_MOSAIC.gap, minWidth: 0 },
  tile: {
    borderRadius: DAYFRAME_BLOCKS.radius.block,
    flex: 1,
    justifyContent: "space-between",
    overflow: "hidden",
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  tileCompact: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "flex-start" },
  tileRecording: { borderWidth: 2.5 },
  pressed: { opacity: 0.82 },
  textCompact: { flexShrink: 1 },
  name: { fontSize: 13, fontWeight: "700", lineHeight: 16 },
  time: { fontSize: 11.5, fontVariant: ["tabular-nums"], fontWeight: "500", lineHeight: 15 },
});
