import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS, formatClockTime, formatDuration, type ClockFormat, type SplitBounds } from "@dayframe/shared";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import { TimeWheelPanel } from "@/components/TimeWheelPanel";
import { playHaptic } from "@/lib/haptics";
import { pressable, type MobileTheme } from "@/lib/mobileTheme";
import { localPresenceEntering } from "@/lib/motion";
import { mobileTextProps } from "@/lib/mobileTypography";
import type { DayframeTimeWheelChange } from "../../modules/dayframe-time-wheel";

const MINUTE_MS = 60_000;

type EntrySplitPanelProps = {
  bounds: SplitBounds;
  busy: boolean;
  clockFormat: ClockFormat;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
  onDividerChange: (valueMs: number) => void;
  onToggleWheel: () => void;
  onWheelChange: (change: DayframeTimeWheelChange) => void;
  reduceMotion: boolean;
  revision: number;
  running?: boolean;
  theme: MobileTheme;
  timeControlRef: Ref<View>;
  valueMs: number;
  wheelId: number | null;
  wheelHeight: number;
};

/** Presentation and direct manipulation for either kind of split. The editor owns all mutations. */
export function EntrySplitPanel({
  bounds, busy, clockFormat, error, onBack, onConfirm, onDividerChange, onToggleWheel,
  onWheelChange, reduceMotion, revision, running = false, theme, timeControlRef,
  valueMs, wheelId, wheelHeight
}: EntrySplitPanelProps) {
  const { startMs, stopMs, minMs, maxMs } = bounds;
  const span = stopMs - startMs;
  const selectedTime = formatClockTime(valueMs, clockFormat);
  const rangeStart = formatClockTime(startMs, clockFormat);
  const rangeEnd = running ? "Now" : formatClockTime(stopMs, clockFormat);
  const [stacked, setStacked] = useState(false);
  const trackWidth = useSharedValue(0);
  const dragOrigin = useSharedValue(valueMs);
  const position = useSharedValue(valueMs);
  const snapped = useSharedValue(valueMs);
  const dragging = useSharedValue(false);
  const changeRef = useRef(onDividerChange);
  changeRef.current = onDividerChange;
  useEffect(() => {
    if (!dragging.value) {
      position.value = valueMs;
      snapped.value = valueMs;
    }
  }, [dragging, position, snapped, valueMs]);
  const change = useCallback((nextMs: number) => changeRef.current(nextMs), []);
  const changeFromDrag = useCallback((nextMs: number) => {
    change(nextMs);
    playHaptic("tick");
  }, [change]);
  const pan = useMemo(() => Gesture.Pan()
    .enabled(!busy && minMs < maxMs)
    .activeOffsetX([-4, 4])
    .failOffsetY([-8, 8])
    .onStart(() => {
      dragging.value = true;
      dragOrigin.value = snapped.value;
    })
    .onUpdate((event) => {
      if (trackWidth.value <= 0) return;
      const next = dragOrigin.value + event.translationX * span / trackWidth.value;
      position.value = Math.max(minMs, Math.min(maxMs, next));
      const minute = Math.max(minMs, Math.min(maxMs, Math.round(next / MINUTE_MS) * MINUTE_MS));
      if (minute === snapped.value) return;
      snapped.value = minute;
      runOnJS(changeFromDrag)(minute);
    })
    .onFinalize((_event, success) => {
      if (!dragging.value) return;
      dragging.value = false;
      if (!success && snapped.value !== dragOrigin.value) {
        snapped.value = dragOrigin.value;
        runOnJS(change)(dragOrigin.value);
      }
      position.value = snapped.value;
    }), [busy, change, changeFromDrag, dragOrigin, dragging, maxMs, minMs, position, snapped, span, trackWidth]);
  const fill = useAnimatedStyle(() => ({ width: `${(position.value - startMs) / span * 100}%` }));
  const handle = useAnimatedStyle(() => ({
    transform: [{ translateX: (position.value - startMs) / span * trackWidth.value - 12 }]
  }));

  return (
    <Reanimated.View
      entering={localPresenceEntering(reduceMotion)}
      onLayout={(event) => setStacked(event.nativeEvent.layout.width < 280)}
      style={styles.panel}
      testID="time-entry-split-panel"
    >
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to block editor" accessibilityRole="button" disabled={busy}
          onPress={onBack} style={pressable([styles.back, { backgroundColor: theme.surfaceMuted }], styles.pressed)}
          testID="time-entry-split-back">
          <View style={styles.backIcon}><DayframeIcon glyph={DAYFRAME_APP_ICONS.next} color={theme.textPrimary} size={20} /></View>
        </Pressable>
        <View style={styles.headerText}>
          <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.title, { color: theme.textPrimary }]}>Split block</Text>
          <Text {...mobileTextProps("metadata")} style={[styles.timeText, { color: theme.textSecondary }]}>
            {`${rangeStart}–${rangeEnd} · ${formatDuration(span / 1000)}`}
          </Text>
        </View>
      </View>
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.controls}>
        <View style={styles.timeRow}>
          <Text {...mobileTextProps("control")} style={[styles.label, { color: theme.textPrimary }]}>Split time</Text>
          <Pressable
            ref={timeControlRef}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "activate" }]}
            accessibilityHint="Swipe up or down to move a minute. Double-tap to open or close the time wheel."
            accessibilityLabel="Split time"
            accessibilityRole="adjustable"
            accessibilityState={{ disabled: busy, expanded: wheelId !== null }}
            accessibilityValue={{ text: selectedTime }}
            disabled={busy}
            onAccessibilityAction={(event) => {
              if (busy) return;
              const action = event.nativeEvent.actionName;
              if (action === "activate") onToggleWheel();
              else if (action === "increment" || action === "decrement") {
                change(Math.max(minMs, Math.min(maxMs, valueMs + (action === "increment" ? MINUTE_MS : -MINUTE_MS))));
              }
            }}
            onPress={onToggleWheel}
            style={pressable([styles.timePill, { backgroundColor: theme.surfaceMuted }], styles.pressed)}
            testID="time-entry-split-value"
          >
            <DayframeIcon glyph={DAYFRAME_APP_ICONS.time} color={theme.textSecondary} size={17} />
            <Text {...mobileTextProps("control")} style={[styles.label, styles.timeText, { color: theme.textPrimary }]}>{selectedTime}</Text>
          </Pressable>
        </View>
        {wheelId !== null ? (
          <TimeWheelPanel
            key={wheelId}
            model={{
              modelVersion: 1, presentationId: wheelId, revision, valueMs,
              minimumMs: minMs, maximumMs: maxMs, minuteInterval: 1, clockFormat,
              colorScheme: theme.mode === "dark" ? "dark" : "light"
            }}
            notch={null}
            onTimeChange={onWheelChange}
            reduceMotion={reduceMotion}
            testIDPrefix="time-entry-split-wheel"
            theme={theme}
            wheelHeight={wheelHeight}
          />
        ) : (
          <View>
            <GestureDetector gesture={pan}>
              <View accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
                onLayout={(event) => { trackWidth.value = event.nativeEvent.layout.width; }}
                style={styles.trackTouch} testID="time-entry-split-divider">
                <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]}>
                  <Reanimated.View style={[styles.trackFill, { backgroundColor: theme.accent }, fill]} />
                </View>
                <Reanimated.View style={[styles.handle, { backgroundColor: theme.surfaceRaised, borderColor: theme.borderStrong }, handle]}>
                  <View style={[styles.grip, { backgroundColor: theme.textMuted }]} />
                  <View style={[styles.grip, { backgroundColor: theme.textMuted }]} />
                </Reanimated.View>
              </View>
            </GestureDetector>
            <View style={styles.endpoints}>
              <Text {...mobileTextProps("metadata")} style={[styles.timeText, { color: theme.textSecondary }]}>{rangeStart}</Text>
              <Text {...mobileTextProps("metadata")} style={[styles.timeText, { color: theme.textSecondary }]}>{rangeEnd}</Text>
            </View>
          </View>
        )}
        {error ? <Text {...mobileTextProps("body")} style={{ color: theme.dangerText }}>{error}</Text> : null}
        <View style={[styles.row, stacked ? styles.column : null]}>
          <SplitPreview label="First block" range={`${rangeStart}–${selectedTime}`} seconds={(valueMs - startMs) / 1000} theme={theme} />
          <SplitPreview label="Second block" range={`${selectedTime}–${rangeEnd}`} seconds={(stopMs - valueMs) / 1000} theme={theme} />
        </View>
      </ScrollView>
      <View style={[styles.row, stacked ? styles.column : null]}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onBack}
          style={pressable([styles.action, { backgroundColor: theme.surfaceMuted }], styles.pressed)} testID="time-entry-split-keep">
          <Text {...mobileTextProps("control")} style={[styles.actionText, { color: theme.textPrimary }]}>Keep as one</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onConfirm}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed && !busy ? theme.accentPressed : theme.accent }, busy && styles.disabled]}
          testID="time-entry-split-confirm">
          <Text {...mobileTextProps("control")} style={[styles.actionText, { color: theme.onAccent }]}>{`Split at ${selectedTime}`}</Text>
        </Pressable>
      </View>
    </Reanimated.View>
  );
}

function SplitPreview({ label, range, seconds, theme }: { label: string; range: string; seconds: number; theme: MobileTheme }) {
  return (
    <View style={[styles.preview, { backgroundColor: theme.surfaceMuted }]}>
      <Text {...mobileTextProps("control")} style={[styles.previewLabel, { color: theme.textPrimary }]}>{label}</Text>
      <Text {...mobileTextProps("metadata")} style={[styles.timeText, { color: theme.textSecondary }]}>{range}</Text>
      <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary }}>{formatDuration(seconds)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 1, minHeight: 0, gap: 14, paddingBottom: 6 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  back: { alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: DAYFRAME_BLOCKS.radius.pill },
  backIcon: { transform: [{ rotate: "180deg" }] },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 22, fontWeight: "700" },
  timeText: { fontVariant: ["tabular-nums"] },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  controls: { gap: 12 },
  timeRow: { alignItems: "center", justifyContent: "space-between", flexDirection: "row", gap: 8, flexWrap: "wrap" },
  label: { fontSize: 16, fontWeight: "700" },
  timePill: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12, borderRadius: 999 },
  trackTouch: { height: 44, justifyContent: "center", marginHorizontal: 12 },
  track: { height: 18, borderRadius: 9, overflow: "hidden" },
  trackFill: { height: "100%", borderRadius: 9 },
  handle: { position: "absolute", left: 0, width: 24, height: 32, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: "row", gap: 3, alignItems: "center", justifyContent: "center" },
  grip: { width: 1.5, height: 12, borderRadius: 1 },
  endpoints: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  row: { flexDirection: "row", gap: 8 },
  column: { flexDirection: "column" },
  preview: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, gap: 2, borderRadius: 12 },
  previewLabel: { fontSize: 14, fontWeight: "700" },
  action: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.65 },
  pressed: { opacity: 0.7 }
});
