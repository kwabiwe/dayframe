import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Reanimated from "react-native-reanimated";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { DayframeTimeWheelView, type DayframeTimeWheelChange, type DayframeTimeWheelModel } from "../../modules/dayframe-time-wheel";
import { DayframeIcon } from "@/components/icons/DayframeIcon";
import type { MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "@/lib/mobileTypography";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";

/**
 * The A11b time wheel's inline panel (owner decisions 12 Oct 2026), shared by the entry sheet's
 * time cards and the Location evidence editor's Start / End: a muted panel with a notch pointing
 * at its card, the native wheel, an optional one-line summary, and one 44-point row of Every
 * minute, Type time and a neutral Done. The host owns the value, the open state and which card
 * the wheel serves; give the panel a `key` per opening so it enters and leaves with its own
 * presence (`localPresenceEntering(…, "rise")` / `localPresenceExiting`). The panel takes its own
 * touches, so a tap on it never reads as a tap outside.
 */
export function TimeWheelPanel({
  busy,
  model,
  notch,
  onDone,
  onTimeChange,
  onToggleEveryMinute,
  onTypeTime,
  pressedStyle,
  reduceMotion,
  summary,
  targetLabel,
  testIDPrefix,
  theme,
  wheelHeight
}: {
  busy: boolean;
  model: DayframeTimeWheelModel;
  /** Where the notch points along the panel (its card's centre, e.g. "25%"); null when the cards are stacked. */
  notch: `${number}%` | null;
  onDone: () => void;
  onTimeChange: (change: DayframeTimeWheelChange) => void;
  onToggleEveryMinute: () => void;
  onTypeTime: () => void;
  pressedStyle: StyleProp<ViewStyle>;
  reduceMotion: boolean;
  summary?: string | null;
  /** "Start" or "End", for Done's spoken label. */
  targetLabel: string;
  testIDPrefix: string;
  theme: MobileTheme;
  wheelHeight: number;
}) {
  const everyMinute = model.minuteInterval === 1;
  return (
    <Reanimated.View
      entering={localPresenceEntering(reduceMotion, "rise")}
      exiting={localPresenceExiting(reduceMotion)}
      onStartShouldSetResponder={() => true}
      style={[panelStyles.panel, { backgroundColor: theme.surfaceMuted }]}
      testID={testIDPrefix}
    >
      {notch ? (
        <View
          pointerEvents="none"
          style={[panelStyles.notch, { backgroundColor: theme.surfaceMuted, left: notch }]}
        />
      ) : null}
      <DayframeTimeWheelView
        model={model}
        onTimeChange={(event) => onTimeChange(event.nativeEvent)}
        style={{ alignSelf: "stretch", height: wheelHeight }}
        testID={`${testIDPrefix}-native`}
      />
      {summary ? (
        <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[panelStyles.summary, { color: theme.textSecondary }]} testID={`${testIDPrefix}-summary`}>
          {summary}
        </Text>
      ) : null}
      <View style={panelStyles.foot}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, selected: everyMinute }}
          disabled={busy}
          onPress={onToggleEveryMinute}
          style={({ pressed }) => [
            panelStyles.pill,
            { backgroundColor: everyMinute ? theme.surface : "transparent" },
            pressed && !busy ? pressedStyle : null
          ]}
          testID={`${testIDPrefix}-every-minute`}
        >
          {everyMinute ? <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.done} size={14} /> : null}
          <Text {...mobileTextProps("control")} adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[panelStyles.pillText, { color: everyMinute ? theme.textPrimary : theme.textSecondary }]}>
            Every minute
          </Text>
        </Pressable>
        <Pressable
          accessibilityHint="Types the time with the number pad"
          accessibilityRole="button"
          disabled={busy}
          onPress={onTypeTime}
          style={({ pressed }) => [panelStyles.pill, pressed && !busy ? pressedStyle : null]}
          testID={`${testIDPrefix}-type`}
        >
          <Text {...mobileTextProps("control")} adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={1} style={[panelStyles.pillText, { color: theme.textSecondary }]}>Type time</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Done, sets ${targetLabel} to ${formatWheelTime(model.valueMs)}`}
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [panelStyles.pill, panelStyles.done, { backgroundColor: theme.textPrimary }, pressed ? pressedStyle : null]}
          testID={`${testIDPrefix}-done`}
        >
          <Text {...mobileTextProps("control")} numberOfLines={1} style={[panelStyles.pillText, { color: theme.background }]}>Done</Text>
        </Pressable>
      </View>
    </Reanimated.View>
  );
}

function formatWheelTime(valueMs: number) {
  const at = new Date(valueMs);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** The panel around the wheel: its top margin and padding, the gap and the 44-point foot. */
export const TIME_WHEEL_PANEL_CHROME = 12 + 8 + 4 + 44 + 8;

// The prototype's .tw-* panel. The foot is one row at every text size: labels shrink rather than wrap.
const panelStyles = StyleSheet.create({
  panel: { borderRadius: 18, gap: 4, marginTop: 12, padding: 8 },
  notch: { borderRadius: 3, height: 14, marginLeft: -7, position: "absolute", top: -7, transform: [{ rotate: "45deg" }], width: 14 },
  foot: { alignItems: "center", flexDirection: "row", gap: 6 },
  pill: { alignItems: "center", borderRadius: 999, flexDirection: "row", flexShrink: 1, gap: 6, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  pillText: { fontSize: 13, fontWeight: "700" },
  done: { marginLeft: "auto", minWidth: 72 },
  summary: { fontSize: 12.5, fontVariant: ["tabular-nums"], lineHeight: 16, textAlign: "center" }
});
