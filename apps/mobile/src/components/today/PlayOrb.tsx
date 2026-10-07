import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { blockColorsFor } from "@dayframe/shared";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";
import { playHaptic } from "../../lib/haptics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT } from "../../lib/mobileTypography";
import { PLAY_ORB, bloomHit, bloomSpots, playOrbFrame, type BloomActivity, type BloomSpot } from "../../lib/playOrb";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { ActivityIcon } from "../icons/DayframeIcon";

const RING = { inset: 5, stroke: 3, opacity: 0.55 } as const;
const SCRIM = { dark: "rgba(3, 6, 14, 0.66)", light: "rgba(17, 20, 29, 0.55)" } as const;

/**
 * The Play orb (Blocks prototype): a 64-point coral orb in the tab bar's trailing slot. Tap starts a
 * bare block, or stops the running one. Hold it for 360 ms and the bloom fans out up to nine
 * activities; slide to one and let go to start it (or switch to it). Let go without moving and the
 * bloom stays open to tap; tap outside to close. One gesture owner (Pan after a long press, raced
 * with a Tap) tracks the finger on the UI thread. VoiceOver reaches the same actions through the
 * native tab item underneath (see the tabs layout), so this view is hidden from it.
 */
export function PlayOrb({
  activities,
  hidden,
  nowMs,
  onChoose,
  onTap,
  reduceMotion,
  running,
  theme,
}: {
  activities: readonly BloomActivity[];
  hidden: boolean;
  nowMs: number;
  onChoose: (activityId: string) => void;
  onTap: () => void;
  reduceMotion: boolean;
  running: boolean;
  theme: MobileTheme;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const frame = playOrbFrame({ bottomInset: insets.bottom, height: window.height, width: window.width });
  const spots = useMemo(() => bloomSpots(activities), [activities]);
  const [bloom, setBloom] = useState<{ sticky: boolean } | null>(null);
  const [hotIndex, setHotIndex] = useState(-1);

  const scale = useSharedValue(1);
  const bloomOpen = useSharedValue(false);
  const hot = useSharedValue(-1);
  const moved = useSharedValue(false);
  const spotOffsets = useSharedValue<{ dx: number; dy: number }[]>([]);
  useEffect(() => {
    spotOffsets.value = spots.map(({ dx, dy }) => ({ dx, dy }));
  }, [spotOffsets, spots]);

  const closeBloom = useCallback(() => {
    bloomOpen.value = false;
    hot.value = -1;
    setBloom(null);
    setHotIndex(-1);
  }, [bloomOpen, hot]);

  // Closing on hide (a sheet, the Reports portal) or when there is nothing to offer.
  useEffect(() => {
    if (hidden) closeBloom();
  }, [closeBloom, hidden]);

  const openBloom = useCallback(() => {
    if (!spots.length) return;
    playHaptic("start");
    setBloom({ sticky: false });
  }, [spots.length]);

  const choose = useCallback((index: number) => {
    const spot = spots[index];
    closeBloom();
    if (spot) onChoose(spot.activity.id);
  }, [closeBloom, onChoose, spots]);

  const release = useCallback((index: number, wasMoved: boolean) => {
    if (index >= 0) choose(index);
    else if (wasMoved) closeBloom();
    else setBloom((current) => (current ? { sticky: true } : current));
  }, [choose, closeBloom]);

  const markHot = useCallback((index: number) => {
    setHotIndex(index);
    if (index >= 0) playHaptic("tick");
  }, []);

  const gesture = useMemo(() => {
    const center = PLAY_ORB.size / 2;
    const hold = Gesture.Pan()
      .activateAfterLongPress(PLAY_ORB.holdMs)
      .onBegin(() => {
        "worklet";
        scale.value = withSpring(0.9, { ...BLOCKS_SPRING.control, reduceMotion: ReduceMotion.Never });
      })
      .onStart(() => {
        "worklet";
        bloomOpen.value = true;
        hot.value = -1;
        moved.value = false;
        runOnJS(openBloom)();
      })
      .onUpdate((event) => {
        "worklet";
        if (Math.hypot(event.translationX, event.translationY) > PLAY_ORB.tapSlop) moved.value = true;
        if (!bloomOpen.value) return;
        const index = bloomHit(spotOffsets.value, event.x - center, event.y - center);
        if (index !== hot.value) {
          hot.value = index;
          runOnJS(markHot)(index);
        }
      })
      .onEnd((_event, success) => {
        "worklet";
        if (!success) return;
        runOnJS(release)(hot.value, moved.value);
      })
      .onFinalize((_event, success) => {
        "worklet";
        scale.value = withSpring(1, { ...BLOCKS_SPRING.pop, reduceMotion: ReduceMotion.Never });
        // A hold the system cancels closes the bloom without choosing.
        if (!success && bloomOpen.value) runOnJS(closeBloom)();
      });
    const tap = Gesture.Tap()
      .maxDuration(PLAY_ORB.holdMs)
      .onEnd((_event, success) => {
        "worklet";
        if (success) runOnJS(onTap)();
      });
    return Gesture.Exclusive(hold, tap);
  }, [bloomOpen, closeBloom, hot, markHot, moved, onTap, openBloom, release, scale, spotOffsets]);

  const orbStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (hidden) return null;
  const centerX = frame.left + PLAY_ORB.size / 2;
  const centerY = frame.top + PLAY_ORB.size / 2;
  const seconds = new Date(nowMs).getSeconds() + (nowMs % 1000) / 1000;
  const ringRadius = PLAY_ORB.size / 2 + RING.inset - RING.stroke / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const hotSpot = hotIndex >= 0 ? spots[hotIndex] : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="play-orb-layer">
      {bloom ? (
        <BloomLayer
          centerX={centerX}
          centerY={centerY}
          hotIndex={hotIndex}
          hotName={hotSpot?.activity.name ?? null}
          onChoose={choose}
          onClose={closeBloom}
          reduceMotion={reduceMotion}
          running={running}
          spots={spots}
          sticky={bloom.sticky}
          theme={theme}
          topInset={insets.top}
        />
      ) : null}
      <GestureDetector gesture={gesture}>
        <Reanimated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.orb,
            { backgroundColor: theme.accent, left: frame.left, shadowColor: theme.accent, top: frame.top },
            orbStyle,
          ]}
          testID="play-orb"
        >
          {running ? (
            <Svg height={PLAY_ORB.size + RING.inset * 2} style={styles.ring} width={PLAY_ORB.size + RING.inset * 2}>
              <Circle
                cx={PLAY_ORB.size / 2 + RING.inset}
                cy={PLAY_ORB.size / 2 + RING.inset}
                fill="none"
                opacity={RING.opacity}
                origin={`${PLAY_ORB.size / 2 + RING.inset}, ${PLAY_ORB.size / 2 + RING.inset}`}
                r={ringRadius}
                rotation={-90}
                stroke={theme.accent}
                strokeDasharray={`${(seconds / 60) * circumference} ${circumference}`}
                strokeLinecap="round"
                strokeWidth={RING.stroke}
                testID="play-orb-ring"
              />
            </Svg>
          ) : null}
          <PrimaryTimerGlyph color={theme.onAccent} mode={running ? "stop" : "play"} />
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

function BloomLayer({
  centerX,
  centerY,
  hotIndex,
  hotName,
  onChoose,
  onClose,
  reduceMotion,
  running,
  spots,
  sticky,
  theme,
  topInset,
}: {
  centerX: number;
  centerY: number;
  hotIndex: number;
  hotName: string | null;
  onChoose: (index: number) => void;
  onClose: () => void;
  reduceMotion: boolean;
  running: boolean;
  spots: readonly BloomSpot[];
  sticky: boolean;
  theme: MobileTheme;
  topInset: number;
}) {
  const fadeIn = useMemo(() => FadeIn.duration(reduceMotion ? 90 : 200).reduceMotion(ReduceMotion.Never), [reduceMotion]);
  const fadeOut = useMemo(() => FadeOut.duration(reduceMotion ? 60 : 160).reduceMotion(ReduceMotion.Never), [reduceMotion]);
  const verb = running ? "switch" : "start";
  return (
    <Reanimated.View entering={fadeIn} exiting={fadeOut} pointerEvents={sticky ? "auto" : "none"} style={StyleSheet.absoluteFill} testID="play-orb-bloom">
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM[theme.mode === "dark" ? "dark" : "light"] }]}
        testID="play-orb-scrim"
      />
      <View pointerEvents="none" style={[styles.label, { top: topInset + 120 }]}>
        <Text style={styles.labelEyebrow}>{running ? "SWITCH TO" : "START"}</Text>
        <Text numberOfLines={1} style={styles.labelTitle}>{hotName ?? "Slide to a block"}</Text>
        <Text style={styles.labelHint}>
          {sticky ? `Tap one to ${verb} · tap outside to cancel` : `Release to ${verb} · tap outside to cancel`}
        </Text>
      </View>
      {spots.map((spot, index) => (
        <BloomBubble
          centerX={centerX}
          centerY={centerY}
          hot={index === hotIndex}
          index={index}
          key={spot.activity.id}
          onPress={() => onChoose(index)}
          reduceMotion={reduceMotion}
          running={running}
          spot={spot}
          theme={theme}
        />
      ))}
    </Reanimated.View>
  );
}

function BloomBubble({
  centerX,
  centerY,
  hot,
  index,
  onPress,
  reduceMotion,
  running,
  spot,
  theme,
}: {
  centerX: number;
  centerY: number;
  hot: boolean;
  index: number;
  onPress: () => void;
  reduceMotion: boolean;
  running: boolean;
  spot: BloomSpot;
  theme: MobileTheme;
}) {
  const colors = blockColorsFor(spot.activity.color ?? spot.activity.id, theme.mode, spot.activity.name);
  // Bubbles fly out from the orb with `pop`, 18 ms apart; Reduce Motion shows them in place.
  const flight = useSharedValue(reduceMotion ? 1 : 0);
  const hotScale = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return;
    flight.value = withDelay(index * PLAY_ORB.staggerMs, withSpring(1, { ...BLOCKS_SPRING.pop, reduceMotion: ReduceMotion.Never }));
  }, [flight, index, reduceMotion]);
  useEffect(() => {
    hotScale.value = withTiming(hot ? 1.22 : 1, { duration: reduceMotion ? 0 : 140, reduceMotion: ReduceMotion.Never });
  }, [hot, hotScale, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, flight.value * 1.4),
    transform: [
      { translateX: -spot.dx * (1 - flight.value) },
      { translateY: -spot.dy * (1 - flight.value) },
      { scale: (0.2 + 0.8 * flight.value) * hotScale.value },
    ],
  }));
  const half = PLAY_ORB.bubbleSize / 2;
  return (
    <Reanimated.View style={[styles.bubbleSlot, { left: centerX + spot.dx - half, top: centerY + spot.dy - half }, style]}>
      <Pressable
        accessibilityLabel={`${running ? "Switch to" : "Start"} ${spot.activity.name}`}
        accessibilityRole="button"
        onPress={onPress}
        style={[styles.bubble, { backgroundColor: colors.fill }]}
        testID={`play-orb-bubble-${spot.activity.id}`}
      >
        <ActivityIcon color={colors.text} icon={spot.activity.icon} name={spot.activity.name} size={22} />
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  orb: {
    alignItems: "center",
    borderRadius: PLAY_ORB.size / 2,
    height: PLAY_ORB.size,
    justifyContent: "center",
    position: "absolute",
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 15,
    width: PLAY_ORB.size,
  },
  ring: { left: -RING.inset, position: "absolute", top: -RING.inset },
  label: { gap: 6, left: 24, position: "absolute", right: 24 },
  labelEyebrow: { color: "rgba(255, 255, 255, 0.7)", fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  labelTitle: { color: "#FFFFFF", fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 40, letterSpacing: -1.2, lineHeight: 42 },
  labelHint: { color: "rgba(255, 255, 255, 0.75)", fontSize: 14 },
  bubbleSlot: { height: PLAY_ORB.bubbleSize, position: "absolute", width: PLAY_ORB.bubbleSize },
  bubble: {
    alignItems: "center",
    borderRadius: 18,
    flex: 1,
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 11,
  },
});
