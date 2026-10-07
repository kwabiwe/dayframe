import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { MobileTheme } from "../../lib/mobileTheme";
import { STOP_FLIGHT, setStopFlightOverlayOrigin, stopFlightPose, type FlightFrame } from "../../lib/stopFlight";
import { TodayLiveBlock, type TodayLiveBlockPresentation } from "./TodayLiveBlock";

export type StopFlight = {
  entryId: string;
  /** The live block's frame in window coordinates when Stop was pressed. */
  from: FlightFrame;
  /** What the live block showed, so the ghost is the same block. */
  presentation: TodayLiveBlockPresentation;
  /** False while Stop is being accepted: the ghost holds the block's place. */
  flying: boolean;
  /** The row block to land on (re-measured once Stop commits), or "none" when there is no row. */
  to: FlightFrame | "none";
  token: number;
};

/**
 * The single owner of the Blocks Stop flight: a ghost of the live block, drawn above the app, that
 * holds the block's place while Stop is accepted, then squashes, shrinks and flies into its row
 * (Reanimated, UI thread). Its content fades in the first 200 ms. A row re-measured after Stop
 * commits retargets it mid-flight. With no row to land on it fades where it is. `onFinished`
 * reports whether it landed.
 */
export function StopFlightOverlay({
  flight,
  onFinished,
  theme,
}: {
  flight: StopFlight | null;
  onFinished: (token: number, landed: boolean, entryId: string) => void;
  theme: MobileTheme;
}) {
  const host = useRef<View>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => () => setStopFlightOverlayOrigin(null), []);

  return (
    <View
      collapsable={false}
      onLayout={() => host.current?.measureInWindow((x, y) => {
        setOrigin({ x, y });
        setStopFlightOverlayOrigin({ x, y });
      })}
      pointerEvents="box-none"
      ref={host}
      style={StyleSheet.absoluteFill}
      testID="stop-flight-overlay"
    >
      {flight && origin ? (
        <FlightGhost flight={flight} key={flight.token} onFinished={onFinished} origin={origin} theme={theme} />
      ) : null}
    </View>
  );
}

const flightEasing = Easing.bezier(...STOP_FLIGHT.easing);

function FlightGhost({
  flight,
  onFinished,
  origin,
  theme,
}: {
  flight: StopFlight;
  onFinished: (token: number, landed: boolean, entryId: string) => void;
  origin: { x: number; y: number };
  theme: MobileTheme;
}) {
  const { entryId, flying, from, to, token } = flight;
  const initial = to === "none" ? from : to;
  const progress = useSharedValue(0);
  const content = useSharedValue(1);
  const fade = useSharedValue(1);
  // The landing frame lives on the UI thread, so a re-measured row retargets the ghost mid-flight.
  const targetX = useSharedValue(initial.x);
  const targetY = useSharedValue(initial.y);
  const targetWidth = useSharedValue(initial.width);
  const targetHeight = useSharedValue(initial.height);
  const landing = to !== "none";

  useEffect(() => {
    if (!flying) return undefined;
    content.value = withTiming(0, { duration: STOP_FLIGHT.contentFadeMs, reduceMotion: ReduceMotion.Never });
    if (!landing) {
      fade.value = withTiming(0, { duration: STOP_FLIGHT.fadeInPlaceMs, reduceMotion: ReduceMotion.Never }, (finished) => {
        if (finished) runOnJS(onFinished)(token, false, entryId);
      });
    } else {
      progress.value = withTiming(1, { duration: STOP_FLIGHT.durationMs, easing: flightEasing, reduceMotion: ReduceMotion.Never }, (finished) => {
        if (finished) runOnJS(onFinished)(token, true, entryId);
      });
    }
    return () => {
      cancelAnimation(progress);
      cancelAnimation(content);
      cancelAnimation(fade);
    };
  }, [content, entryId, fade, flying, landing, onFinished, progress, token]);

  useEffect(() => {
    if (to === "none") return;
    const retarget = { duration: STOP_FLIGHT.retargetMs, reduceMotion: ReduceMotion.Never };
    targetX.value = withTiming(to.x, retarget);
    targetY.value = withTiming(to.y, retarget);
    targetWidth.value = withTiming(to.width, retarget);
    targetHeight.value = withTiming(to.height, retarget);
  }, [targetHeight, targetWidth, targetX, targetY, to]);

  const ghostStyle = useAnimatedStyle(() => {
    const pose = stopFlightPose(progress.value, from, {
      height: targetHeight.value,
      width: targetWidth.value,
      x: targetX.value,
      y: targetY.value,
    });
    return {
      opacity: pose.opacity * fade.value,
      transform: [
        { translateX: pose.translateX },
        { translateY: pose.translateY },
        { scaleX: pose.scaleX },
        { scaleY: pose.scaleY },
      ],
    };
  });
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));

  return (
    <Reanimated.View
      // The ghost catches touches where it flies, so a second tap on the old Stop does nothing.
      pointerEvents="auto"
      style={[
        styles.ghost,
        { height: from.height, left: from.x - origin.x, top: from.y - origin.y, width: from.width },
        ghostStyle,
      ]}
      testID="stop-flight-ghost"
    >
      <TodayLiveBlock
        active={{ ...flight.presentation, hasLiveActiveTimer: false }}
        ghostContentStyle={contentStyle}
        landing={null}
        onAddTime={noop}
        onOpen={noop}
        onStop={noop}
        onSwitch={noop}
        reduceMotion
        theme={theme}
      />
    </Reanimated.View>
  );
}

function noop() {}

const styles = StyleSheet.create({
  ghost: { position: "absolute" },
});
