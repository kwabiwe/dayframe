import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { ActivityIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { localLayoutTransition, localPresenceExiting } from "../../lib/motion";
import {
  QUICK_START_MOSAIC,
  quickStartTileFrames,
  type QuickStartColumn,
  type QuickStartTile,
} from "../../lib/quickStartMosaic";
import { useAppForegroundState } from "../../lib/appForeground";
import { useDropIn, useTileFadeIn } from "../../lib/blocksMotion";
import { recordQuickStartLayout, recordQuickStartTileFoundHidden, type QuickStartDiagnostics } from "../../lib/quickStartDiagnostics";
import { compactDuration, spokenDuration } from "./todayBlocksLayout";

/**
 * The tiles drop in on the first paint of the app only (Blocks prototype); a later mount of Today,
 * a refresh or a cached launch in the same process shows them at rest.
 */
let mosaicDroppedIn = false;

/**
 * Today's list gutter on each side (`container.paddingHorizontal` in mobileTheme; the app is
 * portrait-only, so the safe area adds nothing at the sides). Only the screen-width fallback uses it.
 */
const TODAY_SIDE_GUTTER = 16;

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
  focused = true,
  onOpenRunning,
  onStartActivity,
  reduceMotion,
  runningActivityId,
  timerRunning,
  theme,
}: {
  columns: QuickStartColumn[];
  /** Today is in front (not another tab or a pushed screen). Each return settles the tiles at rest. */
  focused?: boolean;
  onOpenRunning: () => void;
  onStartActivity: (activityId: string) => void;
  reduceMotion: boolean;
  runningActivityId: string | null;
  timerRunning: boolean;
  theme: MobileTheme;
}) {
  const [width, setWidth] = useState(0);
  const [fallback, setFallback] = useState<{ source: "measure" | "window"; width: number } | null>(null);
  const mosaicRef = useRef<View>(null);
  const windowWidth = useWindowDimensions().width;
  const foreground = useAppForegroundState();
  // Memoised so the 1 s timer tick does not re-register a layout config on every tile.
  const tileLayout = useMemo(() => localLayoutTransition(reduceMotion), [reduceMotion]);
  const tileExiting = useMemo(() => localPresenceExiting(reduceMotion), [reduceMotion]);
  // No entrance on first paint; a tile that arrives later (a newly pinned activity) fades in.
  const painted = useRef(false);
  const layoutWidth = width > 0 ? width : fallback?.width ?? 0;
  const frames = layoutWidth > 0 && columns.length ? quickStartTileFrames(columns, layoutWidth) : [];
  // Decided once, on the render that first shows tiles: only the app's first paint drops them in.
  const dropIn = useRef<boolean | null>(null);
  // Never while the app is in the background (a location relaunch draws Today unseen; Trello 210).
  if (dropIn.current === null && frames.length) dropIn.current = !mosaicDroppedIn && !reduceMotion && AppState.currentState === "active";

  // Every return to the foreground or to Today, and every re-layout once the tiles have painted (a
  // new width or a different set of tiles), is a new settle revision: each tile then sets itself at
  // rest, so being visible never depends on an animation or its timer having run (Trello 210
  // recurred on 20 Oct after days in one process, with the timer net in place). A tile mounting in
  // that render (a newly pinned one) starts from the new revision and keeps its own fade.
  const focus = useRef({ focused, returns: 0 });
  if (focused !== focus.current.focused) focus.current = { focused, returns: focus.current.returns + (focused ? 1 : 0) };
  const signature = `${foreground.returns}:${focus.current.returns}:${layoutWidth}:${frames.map((tile) => tile.id).join(",")}`;
  const settle = useRef({ revision: 0, signature });
  if (settle.current.signature !== signature) settle.current = { revision: settle.current.revision + 1, signature };

  useEffect(() => {
    if (layoutWidth > 0) painted.current = true;
    if (frames.length) mosaicDroppedIn = true;
  }, [frames.length, layoutWidth]);

  const widthSource: QuickStartDiagnostics["widthSource"] = width > 0 ? "layout" : fallback?.source ?? null;
  useEffect(() => {
    if (widthSource) recordQuickStartLayout(layoutWidth, widthSource, frames.length);
  }, [frames.length, layoutWidth, widthSource]);

  // Width fallback (Trello 210: no width means no frames, so an empty mosaic while there are
  // columns). Tiles are positioned from the width onLayout reports. On React Native 0.85 (Fabric)
  // onLayout is sent after mount and then only when the frame changes; it is not proven to go
  // missing here, but Today can be built unseen (a location relaunch) or in a tab whose window has
  // no size yet, and if that first report is lost, or is 0 with no later change, nothing would ever
  // draw. So after a commit with no width the mosaic measures its own committed layout (synchronous
  // on Fabric; it finds the same width onLayout is about to report), and if that is 0 too it uses
  // the screen width minus Today's gutters, the mosaic's width on an iPhone. It tries again on each
  // foreground or focus return, and a real onLayout width always wins.
  const hasColumns = columns.length > 0;
  const focusReturns = focus.current.returns;
  useEffect(() => {
    if (width > 0 || !hasColumns) return;
    const fromWindow = windowWidth > TODAY_SIDE_GUTTER * 2 ? { source: "window" as const, width: Math.round(windowWidth - TODAY_SIDE_GUTTER * 2) } : null;
    const apply = (next: typeof fallback) =>
      setFallback((current) => (current?.width === next?.width && current?.source === next?.source ? current : next));
    const node = mosaicRef.current;
    if (!node?.measure) {
      apply(fromWindow);
      return;
    }
    // The screen width is used only when the committed layout itself has no width, never while a
    // measure is still answering, so a normal launch never draws at a guessed width first.
    node.measure((_x, _y, measuredWidth) => {
      const measured = Math.round(measuredWidth || 0);
      apply(measured > 0 ? { source: "measure", width: measured } : fromWindow);
    });
  }, [focusReturns, foreground.returns, hasColumns, width, windowWidth]);
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
        ref={mosaicRef}
        style={styles.mosaic}
        testID="today-quick-start-mosaic"
      >
        {frames.map((tile, index) => (
          <Reanimated.View
            exiting={tileExiting}
            key={tile.id}
            layout={tileLayout}
            style={[styles.slot, { height: tile.height, left: tile.x, top: tile.y, width: tile.width }]}
          >
            <DropInTile
              arrived={painted.current && AppState.currentState === "active"}
              index={index}
              play={Boolean(dropIn.current) && !painted.current}
              reduceMotion={reduceMotion}
              settle={settle.current.revision}
            >
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

/**
 * The drop-in (first paint) or the arrival fade (a tile pinned later) plays inside the tile's
 * slot; the slot keeps its own layout transition and exit. Both settle visible on their own even
 * if their frames never run, and at once on every new settle revision (Trello 210).
 */
function DropInTile({
  arrived,
  children,
  index,
  play,
  reduceMotion,
  settle,
}: {
  arrived: boolean;
  children: ReactNode;
  index: number;
  play: boolean;
  reduceMotion: boolean;
  settle: number;
}) {
  // Both layers can be found hidden by the same settle; the tile counts once.
  const reported = useRef(-1);
  const onFoundHidden = () => {
    if (reported.current === settle) return;
    reported.current = settle;
    recordQuickStartTileFoundHidden();
  };
  const drop = useDropIn({ index, onFoundHidden, play, settle });
  const fade = useTileFadeIn({ onFoundHidden, play: arrived && !play, reduceMotion, settle });
  return (
    <Reanimated.View style={[styles.dropIn, fade]} testID="quick-start-tile-fade">
      <Reanimated.View style={[styles.dropIn, drop]} testID="quick-start-tile-drop">{children}</Reanimated.View>
    </Reanimated.View>
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
    ? `${tile.name}, recording. Edit running block`
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
