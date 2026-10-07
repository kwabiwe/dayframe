import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { ActivityIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import {
  QUICK_START_MOSAIC,
  quickStartTileFrames,
  type QuickStartColumn,
  type QuickStartTile,
} from "../../lib/quickStartMosaic";
import { compactDuration, spokenDuration } from "./todayBlocksLayout";

/**
 * Pinned activities as solid blocks sized by the last seven days. Tap starts one, or switches to it
 * while another runs; the running activity's tile opens the running timer instead of starting a
 * duplicate. Tiles are absolutely positioned and keyed by activity: when a stop changes the ranking,
 * the same tiles move and resize under the screen's existing layout transition (one owner), and with
 * Reduce Motion they settle at once.
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
  const [width, setWidth] = useState(0);
  // No entrance on first paint; a tile that arrives later (a newly pinned activity) fades in.
  const painted = useRef(false);
  useEffect(() => {
    if (width > 0) painted.current = true;
  }, [width]);
  if (!columns.length) return null;
  const frames = width > 0 ? quickStartTileFrames(columns, width) : [];

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
          Sized by the last 7 days
        </Text>
      </View>
      <View
        onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
        style={styles.mosaic}
        testID="today-quick-start-mosaic"
      >
        {frames.map((tile) => (
          <Reanimated.View
            entering={painted.current ? localPresenceEntering(reduceMotion) : undefined}
            exiting={localPresenceExiting(reduceMotion)}
            key={tile.id}
            style={[styles.slot, { height: tile.height, left: tile.x, top: tile.y, width: tile.width }]}
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
  const recent = `${spokenDuration(tile.weekSeconds)} in the last 7 days`;
  const label = recording
    ? `${tile.name}, recording. Edit running timer`
    : `${switching ? "Switch to" : "Start"} ${tile.name}, ${recent}`;
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
  header: { alignItems: "baseline", columnGap: 12, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  heading: { flexShrink: 1, fontSize: 17, fontWeight: "700", letterSpacing: -0.2, minWidth: 0 },
  caption: { flexShrink: 1, fontSize: 13, fontWeight: "500", minWidth: 0 },
  mosaic: { height: QUICK_START_MOSAIC.height, position: "relative" },
  slot: { position: "absolute" },
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
