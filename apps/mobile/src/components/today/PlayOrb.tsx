import { useAppForeground } from "../../lib/appForeground";
import { useDashboardClockTicks } from "../../lib/dashboardClock";
import { liveElapsedSecondsAt } from "./liveBlockClock";
import { formatLiveClock } from "./todayBlocksLayout";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Svg, { Path } from "react-native-svg";
import { BlurView } from "expo-blur";
import { blockColorsFor } from "@dayframe/shared";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";
import { playHaptic } from "../../lib/haptics";
import { useReduceTransparencyPreference } from "../../lib/motion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT } from "../../lib/mobileTypography";
import { PLAY_ORB, bloomHit, bloomSpots, playOrbFrame, type BloomActivity, type BloomSpot } from "../../lib/playOrb";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { ActivityIcon } from "../icons/DayframeIcon";

const RING = { inset: 5, stroke: 3, opacity: 0.55 } as const;
const SCRIM = { dark: "rgba(3, 6, 14, 0.66)", light: "rgba(17, 20, 29, 0.55)" } as const;
/** Under Reduce Transparency there is no blur; the scrim alone hides what's behind a little more. */
const SCRIM_SOLID = { dark: "rgba(3, 6, 14, 0.8)", light: "rgba(17, 20, 29, 0.7)" } as const;
/** expo-blur intensity (0–100) matching the prototype's 10 px backdrop blur under the scrim. */
const BLOOM_BLUR_INTENSITY = 24;

/**
 * The Play orb (Blocks prototype): a 64-point coral orb in the tab bar's trailing slot. Tap starts a
 * bare block, or stops the running one. Hold it for 360 ms and the bloom fans out up to nine
 * activities; slide to one and let go to start it (or switch to it). Let go without moving and the
 * bloom stays open to tap; tap outside to close. One gesture owner (Pan after a long press, raced
 * with a Tap) tracks the finger on the UI thread. VoiceOver reaches the same actions through the
 * native tab item underneath (see the tabs layout), so this view is hidden from it.
 */
type PlayOrbProps = {
  activities: readonly BloomActivity[];
  hidden: boolean;
  onChoose: (activityId: string) => void;
  onTap: () => void;
  reduceMotion: boolean;
  running: boolean;
  /** The running block's activity (its bubble is ringed) and title (the bloom's "Now:" line). */
  runningActivityId?: string | null;
  runningTitle?: string;
  /**
   * The running block as the live block shows it: its start, stored duration and the Dashboard's elapsed
   * seconds (the floor both clocks take), and the seconds a Stop flight's ghost holds while Stop is saved.
   */
  runningDurationSeconds?: number;
  runningElapsedSeconds?: number;
  runningHeldSeconds?: number;
  runningStartedAt?: string;
  theme: MobileTheme;
};

// The Dashboard re-renders every second; the orb only re-renders when what it shows changes (its
// callbacks are read through refs), so its gesture is not rebuilt on the tick.
export const PlayOrb = memo(PlayOrbView, (previous, next) =>
  previous.activities === next.activities &&
  previous.hidden === next.hidden &&
  previous.reduceMotion === next.reduceMotion &&
  previous.running === next.running &&
  previous.runningActivityId === next.runningActivityId &&
  previous.runningTitle === next.runningTitle &&
  previous.runningDurationSeconds === next.runningDurationSeconds &&
  previous.runningElapsedSeconds === next.runningElapsedSeconds &&
  previous.runningHeldSeconds === next.runningHeldSeconds &&
  previous.runningStartedAt === next.runningStartedAt &&
  previous.theme === next.theme
);

function PlayOrbView({
  activities,
  hidden,
  onChoose: onChooseProp,
  onTap: onTapProp,
  reduceMotion,
  running,
  runningActivityId,
  runningDurationSeconds,
  runningElapsedSeconds,
  runningHeldSeconds,
  runningStartedAt,
  runningTitle,
  theme,
}: PlayOrbProps) {
  const callbacks = useRef({ onChoose: onChooseProp, onTap: onTapProp });
  callbacks.current = { onChoose: onChooseProp, onTap: onTapProp };
  const onTap = useCallback(() => callbacks.current.onTap(), []);
  const onChoose = useCallback((activityId: string) => callbacks.current.onChoose(activityId), []);
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
  // The orb's centre in window points: bubbles are hit-tested in window space, so the orb's own
  // press scale never skews the reach.
  const orbCenterX = useSharedValue(0);
  const orbCenterY = useSharedValue(0);

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
    const hold = Gesture.Pan()
      .activateAfterLongPress(PLAY_ORB.holdMs)
      .onBegin(() => {
        "worklet";
        // Reduce Motion presses in place, without the spring.
        scale.value = reduceMotion ? 0.9 : withSpring(0.9, { ...BLOCKS_SPRING.control, reduceMotion: ReduceMotion.Never });
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
        const index = bloomHit(spotOffsets.value, event.absoluteX - orbCenterX.value, event.absoluteY - orbCenterY.value);
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
        scale.value = reduceMotion ? 1 : withSpring(1, { ...BLOCKS_SPRING.pop, reduceMotion: ReduceMotion.Never });
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
  }, [bloomOpen, closeBloom, hot, markHot, moved, onTap, openBloom, orbCenterX, orbCenterY, reduceMotion, release, scale, spotOffsets]);

  const orbStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const centerX = frame.left + PLAY_ORB.size / 2;
  const centerY = frame.top + PLAY_ORB.size / 2;
  useEffect(() => {
    orbCenterX.value = centerX;
    orbCenterY.value = centerY;
  }, [centerX, centerY, orbCenterX, orbCenterY]);
  if (hidden) return null;
  const hotSpot = hotIndex >= 0 ? spots[hotIndex] : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} testID="play-orb-layer">
      {bloom ? (
        <BloomLayer
          centerX={centerX}
          centerY={centerY}
          hotIndex={hotIndex}
          hotName={hotSpot?.activity.name ?? null}
          hotIsRunning={running && hotSpot !== null && hotSpot.activity.id === runningActivityId}
          now={
            running && runningStartedAt !== undefined
              ? {
                  durationSeconds: runningDurationSeconds ?? 0,
                  elapsedSeconds: runningElapsedSeconds ?? 0,
                  heldSeconds: runningHeldSeconds,
                  startedAt: runningStartedAt,
                  title: runningTitle ?? "",
                }
              : null
          }
          onChoose={choose}
          onClose={closeBloom}
          reduceMotion={reduceMotion}
          running={running}
          runningActivityId={running ? runningActivityId ?? null : null}
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
          {running && runningStartedAt !== undefined ? (
            <OrbSecondsRing
              color={theme.accent}
              durationSeconds={runningDurationSeconds ?? 0}
              elapsedSeconds={runningElapsedSeconds ?? 0}
              heldSeconds={runningHeldSeconds}
              startedAt={runningStartedAt}
            />
          ) : null}
          <PrimaryTimerGlyph color={theme.onAccent} mode={running ? "stop" : "play"} />
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * The seconds ring's track as a full circle that starts at 12 o'clock and runs clockwise (two half arcs,
 * sweep flag 1 in the y-down view box). The start is in the geometry itself: the earlier `Circle` (which starts
 * at 3 o'clock) turned by `rotation`/`origin` showed its zero point at 9 o'clock on the owner's iPhone
 * (TestFlight 119), so no transform is left to the renderer.
 */
export function orbRingPath(center: number, radius: number) {
  const top = center - radius;
  const bottom = center + radius;
  return `M${center} ${top} A${radius} ${radius} 0 1 1 ${center} ${bottom} A${radius} ${radius} 0 1 1 ${center} ${top}`;
}

/**
 * How much of the ring is lit: the running block's own seconds into its current minute, so it is empty at
 * the block's :00 and full just before the next (owner, TestFlight 121: the ring followed the wall clock's
 * seconds, so a block reading 0:45:00 showed an arc to about 2 o'clock).
 */
export function orbRingProgress(elapsedSeconds: number) {
  return (((Math.floor(elapsedSeconds) % 60) + 60) % 60) / 60;
}

/**
 * The running orb's coral ring, filling with the block's current elapsed minute. It reads the live block's
 * seconds (`liveElapsedSecondsAt`, with the same Dashboard floor) on a 1 s clock anchored to the block's
 * start, as the live block's is; while a Stop flight's ghost holds the block's time, the ring holds it
 * too, and resumes if the Stop is refused or rolled back. It stops in the background and reads the time
 * again on return.
 */
function OrbSecondsRing({
  color,
  durationSeconds,
  elapsedSeconds,
  heldSeconds,
  startedAt,
}: {
  color: string;
  durationSeconds: number;
  elapsedSeconds: number;
  heldSeconds: number | undefined;
  startedAt: string;
}) {
  const progress = orbRingProgress(useOrbRunningSeconds({ durationSeconds, elapsedSeconds, heldSeconds, startedAt }));
  const ringRadius = PLAY_ORB.size / 2 + RING.inset - RING.stroke / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const box = PLAY_ORB.size + RING.inset * 2;
  return (
    <Svg height={box} style={styles.ring} width={box}>
      <Path
        d={orbRingPath(box / 2, ringRadius)}
        fill="none"
        opacity={RING.opacity}
        stroke={color}
        strokeDasharray={`${progress * circumference} ${circumference}`}
        strokeLinecap="round"
        strokeWidth={RING.stroke}
        testID="play-orb-ring"
      />
    </Svg>
  );
}

type OrbRunningClock = { durationSeconds: number; elapsedSeconds: number; heldSeconds: number | undefined; startedAt: string };

/**
 * The running block's seconds on a 1 s clock anchored to its start, as the live block's is: the ring and the
 * bloom's "Now:" line each re-render alone on it (no per-frame work). While a Stop flight's ghost holds the
 * block's time, this holds it too; it stops in the background and reads the time again on return.
 */
function useOrbRunningSeconds({ durationSeconds, elapsedSeconds, heldSeconds, startedAt }: OrbRunningClock) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Released from a hold (the Stop was refused or rolled back): read the time in that same render, so the
  // first frame after it shows the block's seconds, not the time before the hold (Codex r2 on #439).
  const held = heldSeconds !== undefined;
  const [wasHeld, setWasHeld] = useState(held);
  if (held !== wasHeld) {
    setWasHeld(held);
    if (!held) setNowMs(Date.now());
  }
  const foreground = useAppForeground();
  useDashboardClockTicks({
    foreground: foreground && heldSeconds === undefined,
    needsSecondClock: true,
    secondAnchorMs: Date.parse(startedAt),
    setNow: setNowMs,
  });
  return heldSeconds ?? liveElapsedSecondsAt({ durationSeconds, elapsedSeconds, startedAt }, nowMs);
}

/**
 * "Now: {title} · 0:35:37" at the top of the bloom while a block runs (Trello H). Only the title
 * truncates, so the time stays whole with a long title or large text (Codex r1 on #592).
 */
function BloomNowLine({ now }: { now: OrbRunningClock & { title: string } }) {
  const seconds = useOrbRunningSeconds(now);
  const time = formatLiveClock(seconds);
  return (
    <View
      accessibilityLabel={`Now: ${now.title}, ${time}`}
      style={styles.labelNowRow}
      testID="play-orb-bloom-now"
    >
      <Text numberOfLines={1} style={[styles.labelNow, styles.labelNowTitle]}>{`Now: ${now.title}`}</Text>
      <Text numberOfLines={1} style={styles.labelNow}>{` · ${time}`}</Text>
    </View>
  );
}

function BloomLayer({
  centerX,
  centerY,
  hotIndex,
  hotIsRunning,
  hotName,
  now,
  onChoose,
  onClose,
  reduceMotion,
  running,
  runningActivityId,
  spots,
  sticky,
  theme,
  topInset,
}: {
  centerX: number;
  centerY: number;
  hotIndex: number;
  hotIsRunning: boolean;
  hotName: string | null;
  now: (OrbRunningClock & { title: string }) | null;
  onChoose: (index: number) => void;
  onClose: () => void;
  reduceMotion: boolean;
  running: boolean;
  runningActivityId: string | null;
  spots: readonly BloomSpot[];
  sticky: boolean;
  theme: MobileTheme;
  topInset: number;
}) {
  const fadeIn = useMemo(() => FadeIn.duration(reduceMotion ? 90 : 200).reduceMotion(ReduceMotion.Never), [reduceMotion]);
  const fadeOut = useMemo(() => FadeOut.duration(reduceMotion ? 60 : 160).reduceMotion(ReduceMotion.Never), [reduceMotion]);
  // Over the running activity's own bubble, letting go opens its editor (the orb never starts a duplicate).
  const verb = hotIsRunning ? "edit" : running ? "switch" : "start";
  // Trello 211: the prototype blurs what's behind the bloom (backdrop blur 10 px under the scrim).
  // Reduce Transparency keeps the plain scrim, made a little more opaque instead.
  const reduceTransparency = useReduceTransparencyPreference();
  const scheme = theme.mode === "dark" ? "dark" : "light";
  return (
    <Reanimated.View entering={fadeIn} exiting={fadeOut} pointerEvents={sticky ? "auto" : "none"} style={StyleSheet.absoluteFill} testID="play-orb-bloom">
      {reduceTransparency ? null : (
        <BlurView intensity={BLOOM_BLUR_INTENSITY} pointerEvents="none" style={StyleSheet.absoluteFill} testID="play-orb-blur" tint={scheme} />
      )}
      <Pressable
        accessibilityLabel="Close"
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: reduceTransparency ? SCRIM_SOLID[scheme] : SCRIM[scheme] }]}
        testID="play-orb-scrim"
      />
      <View pointerEvents="none" style={[styles.label, { top: topInset + 120 }]}>
        {now ? <BloomNowLine now={now} /> : null}
        <Text style={styles.labelEyebrow}>{hotIsRunning ? "EDIT" : running ? "SWITCH TO" : "START"}</Text>
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
          runningHere={spot.activity.id === runningActivityId}
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
  runningHere,
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
  /** The running block's activity: ringed, and choosing it opens its editor. */
  runningHere: boolean;
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
      {runningHere ? <View pointerEvents="none" style={styles.bubbleRunningRing} testID="play-orb-bubble-running-ring" /> : null}
      <Pressable
        accessibilityLabel={runningHere ? `Edit ${spot.activity.name}, running now` : `${running ? "Switch to" : "Start"} ${spot.activity.name}`}
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
  labelNow: { color: "#FFFFFF", flexShrink: 0, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "600" },
  labelNowRow: { flexDirection: "row", marginBottom: 6 },
  labelNowTitle: { flexShrink: 1 },
  labelEyebrow: { color: "rgba(255, 255, 255, 0.7)", fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  labelTitle: { color: "#FFFFFF", fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 40, letterSpacing: -1.2, lineHeight: 42 },
  labelHint: { color: "rgba(255, 255, 255, 0.75)", fontSize: 14 },
  // The ring sits 4 points outside the bubble, in white: it reads on every tile colour over the dark scrim.
  bubbleRunningRing: {
    borderColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 2.5,
    bottom: -4,
    left: -4,
    position: "absolute",
    right: -4,
    top: -4,
  },
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
