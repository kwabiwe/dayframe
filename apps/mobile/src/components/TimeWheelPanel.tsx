import { StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { DayframeTimeWheelView, type DayframeTimeWheelChange, type DayframeTimeWheelModel } from "../../modules/dayframe-time-wheel";
import type { MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "@/lib/mobileTypography";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";

/**
 * The A11b time wheel's inline panel (owner decisions 12 Oct 2026), shared by the entry sheet's
 * time cards and the Location evidence editor's Start / End: a muted panel with a notch pointing
 * at its card, the native wheel (every minute) and an optional one-line summary. It has no
 * controls of its own (owner, 16 Oct 2026: no Every minute, Type time or Done): a second tap on its
 * card, or a tap outside, closes it. The host owns the value, the open state and which card the
 * wheel serves; give the panel a `key` per opening so it enters and leaves with its own presence
 * (`localPresenceEntering(…, "rise")` / `localPresenceExiting`). The panel takes its own touches,
 * so a tap on it never reads as a tap outside.
 */
export function TimeWheelPanel({
  minHeight = null,
  model,
  notch,
  onTimeChange,
  onTouchStart,
  reduceMotion,
  summary,
  testIDPrefix,
  theme,
  wheelHeight
}: {
  /**
   * The panel's least height (its box, without the 12-point top margin): the entry sheet passes the
   * dial's measured room so the actions below never move while the wheel is open; the content is
   * centred in it.
   */
  minHeight?: number | null;
  model: DayframeTimeWheelModel;
  /** Where the notch points along the panel (its card's centre, e.g. "25%"); null when the cards are stacked. */
  notch: `${number}%` | null;
  onTimeChange: (change: DayframeTimeWheelChange) => void;
  /** A touch starting on the panel (the Location editor marks it as inside the wheel). */
  onTouchStart?: () => void;
  reduceMotion: boolean;
  summary?: string | null;
  testIDPrefix: string;
  theme: MobileTheme;
  wheelHeight: number;
}) {
  return (
    <Reanimated.View
      entering={localPresenceEntering(reduceMotion, "rise")}
      exiting={localPresenceExiting(reduceMotion)}
      onStartShouldSetResponder={() => true}
      onTouchStart={onTouchStart}
      style={[panelStyles.panel, { backgroundColor: theme.surfaceMuted }, minHeight ? { minHeight } : null]}
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
    </Reanimated.View>
  );
}

/** The panel's top margin (outside its box). */
export const TIME_WHEEL_PANEL_MARGIN_TOP = 12;
/** The panel around the wheel: its top margin and its padding above and below. */
export const TIME_WHEEL_PANEL_CHROME = 12 + 8 + 8;

// The prototype's .tw-* panel, without its foot (owner, 16 Oct 2026).
const panelStyles = StyleSheet.create({
  panel: { borderRadius: 18, gap: 4, justifyContent: "center", marginTop: 12, padding: 8 },
  notch: { borderRadius: 3, height: 14, marginLeft: -7, position: "absolute", top: -7, transform: [{ rotate: "45deg" }], width: 14 },
  summary: { fontSize: 12.5, fontVariant: ["tabular-nums"], lineHeight: 16, textAlign: "center" }
});
