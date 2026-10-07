import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { ActivityIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import {
  QUICK_START_MOSAIC,
  quickStartTileFrames,
  type QuickStartColumn,
  type QuickStartTile,
} from "../../lib/quickStartMosaic";
import { useDropIn } from "../../lib/blocksMotion";
import { compactDuration, spokenDuration } from "./todayBlocksLayout";

/**
 * The tiles drop in on the first paint of the app only (Blocks prototype); a later mount of Today,
 * a refresh or a cached launch in the same process shows them at rest.
 */
let mosaicDroppedIn = false;

/** Test-only: lets each test start from a fresh app launch. */
export function resetMosaicDropInForTests() {
  mosaicDroppedIn = false;
}

/**
 * Pinned activities as solid blocks sized by the last seven days. Tap starts one, or switches to it
 * while another runs; the running activity's tile opens the running timer instead of starting a
 * duplicate. Tiles are absolutely positioned and keyed by activity, and each owns its Reanimated layout
 * transition: whatever changes the totals (stop, switch, Add past time, edit, delete, Undo, Review, the
 * midnight roll-over), the same tiles move and resize, and with Reduce Motion they settle at once.
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
  // Memoised so the 1 s timer tick does not re-register a layout config on every tile.
  const tileLayout = useMemo(() => localLayoutTransition(reduceMotion), [reduceMotion]);
  const tileEntering = useMemo(() => localPresenceEntering(reduceMotion), [reduceMotion]);
  const tileExiting = useMemo(() => localPresenceExiting(reduceMotion), [reduceMotion]);
  // No entrance on first paint; a tile that arrives later (a newly pinned activity) fades in.
  const painted = useRef(false);
  const frames = width > 0 && columns.length ? quickStartTileFrames(columns, width) : [];
  // Decided once, on the render that first shows tiles: only the app's first paint drops them in.
  const dropIn = useRef<boolean | null>(null);
  if (dropIn.current === null && frames.length) dropIn.current = !mosaicDroppedIn && !reduceMotion;
  useEffect(() => {
    if (width > 0) painted.current = true;
    if (frames.length) mosaicDroppedIn = true;
  }, [frames.length, width]);
  if (!columns.length) return null;

  return (
    <View style={styles.section} testID="today-quick-start">
      <View style={styles.header}>
        <Text
          {...mobileTextProps("sectionHeading")}
          accessibilityRole="header"
          style={[styles.heading, { color: theme.textPrimary }]}
        >
          {timerRunning ? "Switch to" : "Start a block"}
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
        {frames.map((tile, index) => (
          <Reanimated.View
            entering={painted.current ? tileEntering : undefined}
            exiting={tileExiting}
            key={tile.id}
            layout={tileLayout}
            style={[styles.slot, { height: tile.height, left: tile.x, top: tile.y, width: tile.width }]}
          >
            <DropInTile index={index} play={Boolean(dropIn.current) && !painted.current}>
              <QuickStartTileButton
                onPress={() => (tile.id === runningActivityId ? onOpenRunning() : onStartActivity(tile.id))}
                recording={tile.id === runningActivityId}
                switching={timerRunning && tile.id !== runningActivityId}
                theme={theme}
                tile={tile}
              />
            </DropInTile>
          </Reanimated.View>
        ))}
      </View>
    </View>
  );
}

/** The drop-in moves the tile inside its slot; the slot keeps its own layout transition. */
function DropInTile({ children, index, play }: { children: ReactNode; index: number; play: boolean }) {
  const style = useDropIn({ index, play });
  return <Reanimated.View style={[styles.dropIn, style]}>{children}</Reanimated.View>;
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
  dropIn: { flex: 1 },
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
