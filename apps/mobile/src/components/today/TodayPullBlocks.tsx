import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { blockColorsFor, type DayframePaletteKey } from "@dayframe/shared";
import type { MobileTheme } from "../../lib/mobileTheme";

// The prototype's pull-to-refresh: six small blocks that stack up as you pull and pulse while a
// deliberate refresh runs (design/blocks/ios.html .ptr).
export const PULL_BLOCKS: readonly { color: DayframePaletteKey; height: number }[] = [
  { color: "violet", height: 18 },
  { color: "lime", height: 30 },
  { color: "blue", height: 40 },
  { color: "amber", height: 24 },
  { color: "rose", height: 14 },
  { color: "sky", height: 34 },
];
/** Pull this far (points past the top) for every block to stand at full height. */
export const PULL_FULL_DISTANCE = 90;
const PULSE = { halfMs: 250, staggerMs: 50, low: 0.4 } as const;

/** How tall block `index` stands for a pull of `distance` points (0–1), as in the prototype. */
export function pullBlockScale(distance: number, index: number) {
  "worklet";
  const progress = Math.min(1, Math.max(0, distance / PULL_FULL_DISTANCE));
  return Math.min(1, Math.max(0, progress * 1.6 - index * 0.12));
}

/**
 * The block pull-to-refresh indicator. The native refresh control still owns the pull, the
 * threshold and the held inset (its own spinner is transparent); this reads the list's overscroll
 * on the UI thread. While refreshing the blocks pulse; with Reduce Motion they stand still.
 */
export function TodayPullBlocks({
  refreshing,
  reduceMotion,
  scrollY,
  theme,
}: {
  refreshing: boolean;
  reduceMotion: boolean;
  /** The list's content offset; negative while pulled past the top. */
  scrollY: SharedValue<number>;
  theme: MobileTheme;
}) {
  // As in the prototype: the row sits just inside the top safe area, blocks standing on its floor.
  const top = useSafeAreaInsets().top - 6;
  const shown = useSharedValue(refreshing ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(refreshing ? 1 : 0, { duration: refreshing ? 120 : 200, reduceMotion: ReduceMotion.Never });
  }, [refreshing, shown]);

  // Content scrolled up over the top while a refresh runs covers the blocks, so they fade with it.
  const rowStyle = useAnimatedStyle(() => ({
    opacity: Math.max(shown.value, Math.min(1, Math.max(0, -scrollY.value / PULL_FULL_DISTANCE))) *
      Math.min(1, Math.max(0, 1 - scrollY.value / 20)),
  }));

  return (
    <Reanimated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.row, { top }, rowStyle]}
      testID="today-pull-blocks"
    >
      {PULL_BLOCKS.map((block, index) => (
        <PullBlock
          color={blockColorsFor(block.color, theme.mode).fill}
          height={block.height}
          index={index}
          key={block.color}
          refreshing={refreshing}
          reduceMotion={reduceMotion}
          scrollY={scrollY}
          shown={shown}
        />
      ))}
    </Reanimated.View>
  );
}

function PullBlock({
  color,
  height,
  index,
  reduceMotion,
  refreshing,
  scrollY,
  shown,
}: {
  color: string;
  height: number;
  index: number;
  reduceMotion: boolean;
  refreshing: boolean;
  scrollY: SharedValue<number>;
  shown: SharedValue<number>;
}) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(pulse);
    if (!refreshing || reduceMotion) {
      pulse.value = 1;
      return undefined;
    }
    const ease = Easing.inOut(Easing.quad);
    pulse.value = withDelay(
      index * PULSE.staggerMs,
      withRepeat(
        withSequence(
          withTiming(PULSE.low, { duration: PULSE.halfMs, easing: ease, reduceMotion: ReduceMotion.Never }),
          withTiming(1, { duration: PULSE.halfMs, easing: ease, reduceMotion: ReduceMotion.Never })
        ),
        -1,
        false,
        undefined,
        ReduceMotion.Never
      )
    );
    return () => cancelAnimation(pulse);
  }, [index, pulse, reduceMotion, refreshing]);

  const style = useAnimatedStyle(() => {
    // While refreshing (or fading out after it) the block stands at full height and pulses.
    const pulled = pullBlockScale(-scrollY.value, index);
    const stand = Math.max(pulled, shown.value);
    return { transform: [{ translateY: (height * (1 - stand * pulse.value)) / 2 }, { scaleY: stand * pulse.value }] };
  });

  return <Reanimated.View style={[styles.block, { backgroundColor: color, height }, style]} />;
}

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 4,
    height: 40,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
  },
  block: { borderRadius: 3, width: 9 },
});
