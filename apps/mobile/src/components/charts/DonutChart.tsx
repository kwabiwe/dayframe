import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  createAnimatedComponent,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Path, Pattern, Rect } from "react-native-svg";
import {
  canRemoveDonutVisual,
  donutSlicePath,
  donutTransitionTargets,
  prepareDonutArcs,
} from "@/lib/donutGeometry";
import { MOBILE_MOTION } from "@/lib/motion";
import type { MobileTheme } from "@/lib/mobileTheme";

const AnimatedPath = createAnimatedComponent(Path);
const DEFAULT_SIZE = 184;
const DEFAULT_CENTER_WIDTH = 104;

export type DonutChartSegment = {
  id: string;
  value: number;
  color: string;
  selected: boolean;
  isUncategorized?: boolean;
};

export function DonutChart({
  animateEntrance,
  centerLabel,
  centerValue,
  spokenValue,
  reduceMotion,
  segments,
  settleImmediately,
  theme,
}: {
  animateEntrance: boolean;
  centerLabel: string;
  centerValue: string;
  spokenValue?: string;
  reduceMotion: boolean;
  segments: readonly DonutChartSegment[];
  settleImmediately?: boolean;
  theme: MobileTheme;
}) {
  const patternId = `uncategorized-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(DEFAULT_SIZE);
  const size = Math.min(availableWidth, DEFAULT_SIZE);
  const centerWidth = DEFAULT_CENTER_WIDTH * (size / DEFAULT_SIZE);
  const [visuals, setVisuals] = useState(() =>
    segments.map((segment, i) => ({
      ...segment,
      ...prepareDonutArcs(segments)[i],
    })),
  );
  const generation = useRef(0);
  const desiredIds = useRef(segments.map((segment) => segment.id));
  desiredIds.current = segments.map((segment) => segment.id);
  const targetKey = JSON.stringify(segments);
  const generationKey = useRef(targetKey);
  if (generationKey.current !== targetKey) {
    generationKey.current = targetKey;
    generation.current++;
  }
  const transitionGeneration = generation.current;
  const targets = donutTransitionTargets(visuals, segments);
  const drawing = targets.map((arc) => ({
    ...(segments.find((s) => s.id === arc.id) ??
      visuals.find((s) => s.id === arc.id)!),
    ...arc,
  }));
  useEffect(() => {
    setVisuals(
      reduceMotion || settleImmediately
        ? drawing.filter((s) => desiredIds.current.includes(s.id))
        : drawing,
    );
  }, [targetKey, reduceMotion, settleImmediately]);
  const completeExit = useCallback((id: string, token: number) => {
    if (canRemoveDonutVisual(token, generation.current, id, desiredIds.current))
      setVisuals((current) => current.filter((s) => s.id !== id));
  }, []);
  const centreSize = 16;
  const valueWidth =
    centerValue.length * centreSize * Math.min(fontScale, 1.2) * 0.72;
  const useFlowValue = valueWidth > centerWidth;

  const centerOpacity = useSharedValue(
    animateEntrance && !reduceMotion ? 0 : 1,
  );
  useEffect(() => {
    if (reduceMotion || settleImmediately) centerOpacity.value = 1;
    else if (animateEntrance) {
      centerOpacity.value = 0;
      centerOpacity.value = withTiming(1, { duration: MOBILE_MOTION.control });
    }
  }, [animateEntrance, centerOpacity, reduceMotion, settleImmediately]);
  const centerStyle = useAnimatedStyle(() => ({
    opacity: centerOpacity.value,
  }));
  const measureAvailableWidth = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (Number.isFinite(nextWidth) && nextWidth > 0)
      setAvailableWidth(nextWidth);
  };
  return (
    <View
      accessible
      // Fabric assigns this exact label passively on iOS; no live announcement.
      accessibilityLabel={`Category breakdown. ${centerLabel} ${spokenValue ?? centerValue}. ${segments.length} categories. Category information follows the chart.`}
      accessibilityRole="image"
      onLayout={measureAvailableWidth}
      style={styles.measurementBox}
    >
      <View style={[styles.chart, { height: size, width: size }]}>
        <Svg
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          width={size}
          height={size}
          viewBox="0 0 184 184"
        >
          <Defs>
            <Pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              width={8}
              height={8}
            >
              <Rect width={8} height={8} fill={uncategorizedFill(theme)} />
              <Path
                d="M-2 8 8 -2M2 10 10 2"
                stroke={uncategorizedStripe(theme)}
                strokeWidth={1.4}
              />
            </Pattern>
          </Defs>
          <Circle cx={92} cy={92} r={84} fill={theme.chartTrack} />
          {drawing.map((segment) => {
            const active = desiredIds.current.includes(segment.id);
            return (
              <AnimatedDonutSlice
                key={segment.id}
                id={segment.id}
                generation={transitionGeneration}
                animateEntrance={animateEntrance}
                color={
                  segment.isUncategorized ? `url(#${patternId})` : segment.color
                }
                endAngle={segment.endAngle}
                startAngle={segment.startAngle}
                reduceMotion={reduceMotion}
                selected={active}
                settleImmediately={settleImmediately}
                onExitComplete={completeExit}
              />
            );
          })}
          <Circle cx={92} cy={92} r={57} fill={theme.surfaceRaised} />
        </Svg>
        <Animated.View
          pointerEvents="none"
          style={[styles.center, { width: centerWidth }, centerStyle]}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={[styles.centerLabel, { color: theme.textSecondary }]}
          >
            {centerLabel}
          </Text>
          {!useFlowValue ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={[
                styles.centerValue,
                { fontSize: centreSize, color: theme.textPrimary },
              ]}
            >
              {centerValue}
            </Text>
          ) : null}
        </Animated.View>
      </View>
      {useFlowValue ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          style={[
            styles.centerValue,
            { fontSize: 16, marginTop: 8, color: theme.textPrimary },
          ]}
        >
          {centerValue}
        </Text>
      ) : null}
    </View>
  );
}

function AnimatedDonutSlice({
  id,
  generation,
  animateEntrance,
  color,
  endAngle,
  reduceMotion,
  selected,
  settleImmediately = false,
  startAngle,
  onExitComplete,
}: {
  animateEntrance: boolean;
  color: string;
  endAngle: number;
  reduceMotion: boolean;
  selected: boolean;
  settleImmediately?: boolean;
  startAngle: number;
  id: string;
  generation: number;
  onExitComplete: (id: string, generation: number) => void;
}) {
  const entranceConsumed = useRef(false);
  const animatedStart = useSharedValue(startAngle);
  const animatedEnd = useSharedValue(
    !reduceMotion && !settleImmediately ? startAngle : endAngle,
  );
  const targetOpacity = selected ? 1 : 0;
  const opacity = useSharedValue(
    reduceMotion || animateEntrance ? targetOpacity : 0,
  );

  useEffect(() => {
    const enterNow =
      animateEntrance &&
      !entranceConsumed.current &&
      !reduceMotion &&
      !settleImmediately;
    if (!animateEntrance) entranceConsumed.current = false;
    if (enterNow) {
      entranceConsumed.current = true;
      // A native tab may eagerly mount and settle this slice while hidden.
      // Collapse from its current settled geometry before the first visible sweep.
      animatedStart.value = startAngle;
      animatedEnd.value = startAngle;
    }
    const duration =
      reduceMotion || settleImmediately
        ? 0
        : enterNow
          ? 260
          : MOBILE_MOTION.layout;
    animatedStart.value = withTiming(startAngle, { duration });
    animatedEnd.value = withTiming(endAngle, { duration }, (finished) => {
      if (finished && !selected) runOnJS(onExitComplete)(id, generation);
    });
    if (enterNow) opacity.value = 0;
    opacity.value = withTiming(selected ? 1 : 0, {
      duration: reduceMotion || settleImmediately ? 0 : MOBILE_MOTION.control,
    });
  }, [
    animateEntrance,
    animatedEnd,
    animatedStart,
    endAngle,
    reduceMotion,
    settleImmediately,
    startAngle,
    selected,
    generation,
    id,
    opacity,
    onExitComplete,
  ]);

  const animatedProps = useAnimatedProps(() => ({
    d: donutSlicePath(92, 92, 84, 57, animatedStart.value, animatedEnd.value),
    fillOpacity: opacity.value,
  }));

  return <AnimatedPath animatedProps={animatedProps} fill={color} />;
}

function uncategorizedFill(theme: MobileTheme) {
  return theme.mode === "dark" ? "#323946" : "#EEF2F6";
}

function uncategorizedStripe(theme: MobileTheme) {
  return theme.mode === "dark" ? "#8792A3" : "#98A4B3";
}

const styles = StyleSheet.create({
  chart: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  measurementBox: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  accessibleTotal: { alignItems: "center", marginTop: 8 },
  center: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
  },
  centerLabel: {
    fontFamily: "System",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  centerValue: {
    fontFamily: "System",
    fontSize: 22,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    textAlign: "center",
  },
});
