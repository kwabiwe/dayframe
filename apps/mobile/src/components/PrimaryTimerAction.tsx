import { Pressable, StyleSheet, type GestureResponderEvent } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

export const PRIMARY_TIMER_ACTION_SIZE = 44;
// Lucide's nominal 18/14 sizes include generous 24-point view-box margins.
// These optical sizes preserve the web silhouettes while matching their
// visible bounds inside the same 44-point outer control.
export const PRIMARY_TIMER_PLAY_GLYPH_SIZE = 22;
export const PRIMARY_TIMER_STOP_GLYPH_SIZE = 17;
export const PRIMARY_TIMER_PLAY_OFFSET_X = 1;
export const PRIMARY_TIMER_ICON_VIEWBOX = "0 0 24 24";
export const PRIMARY_TIMER_PLAY_PATH =
  "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z";
export const COMPACT_REPLAY_PLAY_GLYPH_SIZE = 14;

type PrimaryTimerActionProps = {
  accessibilityLabel: string;
  backgroundColor: string;
  glyphColor: string;
  mode: "play" | "stop";
  onPress: (event: GestureResponderEvent) => void;
};

export function PrimaryTimerAction({
  accessibilityLabel,
  backgroundColor,
  glyphColor,
  mode,
  onPress
}: PrimaryTimerActionProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        { backgroundColor },
        pressed ? styles.pressed : null
      ]}
    >
      <PrimaryTimerGlyph color={glyphColor} mode={mode} />
    </Pressable>
  );
}

export function PrimaryTimerGlyph({ color, mode }: { color: string; mode: "play" | "stop" }) {
  if (mode === "play") {
    return (
      <Svg
        height={PRIMARY_TIMER_PLAY_GLYPH_SIZE}
        style={{ transform: [{ translateX: PRIMARY_TIMER_PLAY_OFFSET_X }] }}
        viewBox={PRIMARY_TIMER_ICON_VIEWBOX}
        width={PRIMARY_TIMER_PLAY_GLYPH_SIZE}
      >
        <Path d={PRIMARY_TIMER_PLAY_PATH} fill={color} strokeWidth={0} />
      </Svg>
    );
  }

  return (
    <Svg
      height={PRIMARY_TIMER_STOP_GLYPH_SIZE}
      viewBox={PRIMARY_TIMER_ICON_VIEWBOX}
      width={PRIMARY_TIMER_STOP_GLYPH_SIZE}
    >
      <Rect
        fill={color}
        height={18}
        rx={2}
        stroke={color}
        strokeWidth={2}
        width={18}
        x={3}
        y={3}
      />
    </Svg>
  );
}

export function CompactReplayPlayGlyph({ color }: { color: string }) {
  return (
    <Svg
      height={COMPACT_REPLAY_PLAY_GLYPH_SIZE}
      style={{ transform: [{ translateX: 0.5 }] }}
      viewBox={PRIMARY_TIMER_ICON_VIEWBOX}
      width={COMPACT_REPLAY_PLAY_GLYPH_SIZE}
    >
      <Path d={PRIMARY_TIMER_PLAY_PATH} fill={color} strokeWidth={0} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    borderRadius: PRIMARY_TIMER_ACTION_SIZE / 2,
    height: PRIMARY_TIMER_ACTION_SIZE,
    justifyContent: "center",
    width: PRIMARY_TIMER_ACTION_SIZE
  },
  pressed: {
    opacity: 0.88,
    transform: [{ translateY: 1 }]
  }
});
