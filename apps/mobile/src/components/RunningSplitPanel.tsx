import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, formatClockTime } from "@dayframe/shared";
import { useClockFormat } from "@/lib/clockFormat";
import { playHaptic } from "@/lib/haptics";
import type { MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "@/lib/mobileTypography";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { clampRunningSplit, defaultRunningSplit, runningSplitBounds } from "@/lib/runningSplitBounds";

/** The now edge moves on with the clock while the panel is open (and only then). */
const NOW_TICK_MS = 1_000;
const BAR_HEIGHT = 280;
const GRIP = 22;

function minutesLabel(fromMs: number, toMs: number) {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

/**
 * Split for the running block (owner 28 Oct 2026, as Toggl), card G's split bar in the iPhone's style: the
 * block as a tall bar in its activity colour from its start (top) to now (bottom, growing while open), a
 * line to drag in whole minutes (never into the first minute or the last minute before now) with each
 * half's length and times, Split at HH:MM and Keep as one. Presentation only: the sheet owns the split.
 */
export function RunningSplitPanel({
  categoryColor,
  categoryName,
  onCancel,
  onConfirm,
  reduceMotion,
  sheetDismissGestureRef,
  startedAt,
  theme
}: {
  categoryColor: string | null;
  categoryName: string | null;
  onCancel: () => void;
  onConfirm: (atMs: number) => void;
  reduceMotion: boolean;
  sheetDismissGestureRef: MutableRefObject<GestureType | undefined>;
  startedAt: string;
  theme: MobileTheme;
}) {
  const clockFormat = useClockFormat();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const bounds = runningSplitBounds(startedAt, nowMs);
  const [chosenMs, setChosenMs] = useState<number | null>(() => bounds ? defaultRunningSplit(bounds) : null);
  const atMs = bounds ? clampRunningSplit(bounds, chosenMs ?? defaultRunningSplit(bounds)) : null;
  const barHeight = useRef(BAR_HEIGHT);
  const lastMinute = useRef(atMs);
  const colors = categoryColor
    ? blockColorsFor(categoryColor, theme.mode, categoryName ?? "")
    : { fill: theme.surfaceRaised, text: theme.textPrimary };

  function moveTo(next: number) {
    if (!bounds) return;
    const snapped = clampRunningSplit(bounds, next);
    if (snapped !== lastMinute.current) {
      lastMinute.current = snapped;
      playHaptic("tick");
    }
    setChosenMs(snapped);
  }

  // One owner for the drag: the bar's pan, which the sheet's own dismiss swipe waits for.
  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .blocksExternalGesture(sheetDismissGestureRef)
    .onBegin((event) => moveToY(event.y))
    .onUpdate((event) => moveToY(event.y)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sheetDismissGestureRef, bounds?.minMs, bounds?.maxMs]);

  function moveToY(y: number) {
    if (!bounds) return;
    const usable = Math.max(1, barHeight.current - GRIP);
    const share = Math.min(1, Math.max(0, (y - GRIP / 2) / usable));
    moveTo(bounds.minMs + share * (bounds.maxMs - bounds.minMs));
  }

  if (!bounds || atMs == null) {
    return (
      <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} style={styles.panel} testID="running-split-panel">
        <Text {...mobileTextProps("body")} style={{ color: theme.textMuted }}>
          This block is too short to split yet: each part needs a minute or more.
        </Text>
        <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.pill, { backgroundColor: theme.surfaceMuted }]} testID="running-split-cancel">
          <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.textPrimary }]}>Keep as one</Text>
        </Pressable>
      </Reanimated.View>
    );
  }

  const share = bounds.maxMs > bounds.minMs ? (atMs - bounds.minMs) / (bounds.maxMs - bounds.minMs) : 0.5;
  const lineY = GRIP / 2 + share * (barHeight.current - GRIP);
  const time = (ms: number) => formatClockTime(ms, clockFormat);
  const first = `${minutesLabel(bounds.startMs, atMs)} · ${time(bounds.startMs)}–${time(atMs)}`;
  const second = `${minutesLabel(atMs, nowMs)} · ${time(atMs)}–now`;

  return (
    <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} style={styles.panel} testID="running-split-panel">
      <GestureDetector gesture={pan}>
        <View
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          accessibilityLabel="Split at"
          accessibilityRole="adjustable"
          accessibilityValue={{ text: `${time(atMs)}: ${minutesLabel(bounds.startMs, atMs)} then ${minutesLabel(atMs, nowMs)}` }}
          accessible
          onAccessibilityAction={(event) => moveTo(atMs + (event.nativeEvent.actionName === "increment" ? 60_000 : -60_000))}
          onLayout={(event: LayoutChangeEvent) => { barHeight.current = event.nativeEvent.layout.height; }}
          style={[styles.bar, { backgroundColor: colors.fill }]}
          testID="running-split-bar"
        >
          <Text {...mobileTextProps("counter")} numberOfLines={1} style={[styles.half, { color: colors.text, top: Math.max(8, lineY / 2 - 10) }]} testID="running-split-first">
            {first}
          </Text>
          <Text {...mobileTextProps("counter")} numberOfLines={1} style={[styles.half, { color: colors.text, top: Math.min(BAR_HEIGHT - 28, lineY + (barHeight.current - lineY) / 2 - 10) }]} testID="running-split-second">
            {second}
          </Text>
          <View pointerEvents="none" style={[styles.line, { backgroundColor: colors.text, top: lineY - 1 }]}>
            <View style={[styles.grip, styles.gripLeft, { backgroundColor: colors.text }]} />
            <View style={[styles.grip, styles.gripRight, { backgroundColor: colors.text }]} />
          </View>
        </View>
      </GestureDetector>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onConfirm(atMs)}
          style={({ pressed }) => [styles.pill, { backgroundColor: pressed ? theme.accentPressed : theme.accent }]}
          testID="running-split-confirm"
        >
          <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.pillText, { color: theme.onAccent }]}>Split at {time(atMs)}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.pill, { backgroundColor: theme.surfaceMuted }, pressed ? styles.pressed : null]}
          testID="running-split-cancel"
        >
          <Text {...mobileTextProps("control")} numberOfLines={1} style={[styles.pillText, { color: theme.textPrimary }]}>Keep as one</Text>
        </Pressable>
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14, paddingTop: 8 },
  bar: { borderRadius: 16, height: BAR_HEIGHT, overflow: "hidden" },
  half: { fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "600", left: 16, position: "absolute", right: 16 },
  line: { height: 2, left: 0, position: "absolute", right: 0 },
  grip: { borderRadius: 6, height: 12, position: "absolute", top: -5, width: 22 },
  gripLeft: { left: 8 },
  gripRight: { right: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  pill: { alignItems: "center", borderRadius: 999, justifyContent: "center", minHeight: 44, paddingHorizontal: 18 },
  pillText: { fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.7 }
});
