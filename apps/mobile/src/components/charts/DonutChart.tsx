import { useEffect, useId } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  createAnimatedComponent,
  useAnimatedProps,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import Svg, { Circle, Defs, Path, Pattern, Rect } from "react-native-svg";
import { donutSlicePath, prepareDonutArcs } from "@/lib/donutGeometry";
import { MOBILE_MOTION } from "@/lib/motion";
import type { MobileTheme } from "@/lib/mobileTheme";

const AnimatedPath = createAnimatedComponent(Path);

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
  onSegmentPress,
  reduceMotion,
  segments,
  settleImmediately,
  theme
}: {
  animateEntrance: boolean;
  centerLabel: string;
  centerValue: string;
  onSegmentPress?: (id: string) => void;
  reduceMotion: boolean;
  segments: readonly DonutChartSegment[];
  settleImmediately?: boolean;
  theme: MobileTheme;
}) {
  const patternId = `uncategorized-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const arcs = prepareDonutArcs(segments);
  return (
    <View
      accessibilityLabel={`${centerLabel} ${centerValue}. Category controls follow the chart.`}
      accessibilityRole="image"
      style={styles.box}
    >
      <Svg
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        width={184}
        height={184}
        viewBox="0 0 184 184"
      >
        <Defs>
          <Pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8}>
            <Rect width={8} height={8} fill={uncategorizedFill(theme)} />
            <Path d="M-2 8 8 -2M2 10 10 2" stroke={uncategorizedStripe(theme)} strokeWidth={1.4} />
          </Pattern>
        </Defs>
        <Circle cx={92} cy={92} r={84} fill={theme.chartTrack} />
        {arcs.map((arc) => {
          const segment = segments.find((candidate) => candidate.id === arc.id)!;
          return (
            <AnimatedDonutSlice
              key={arc.id}
              animateEntrance={animateEntrance}
              color={segment.isUncategorized ? `url(#${patternId})` : segment.color}
              endAngle={arc.endAngle}
              onPress={onSegmentPress ? () => onSegmentPress(arc.id) : undefined}
              reduceMotion={reduceMotion}
              selected={segment.selected}
              settleImmediately={settleImmediately}
              startAngle={arc.startAngle}
            />
          );
        })}
        <Circle cx={92} cy={92} r={57} fill={theme.surfaceRaised} />
      </Svg>
      <View pointerEvents="none" style={styles.center}>
        <Text style={[styles.centerLabel, { color: theme.textSecondary }]}>{centerLabel}</Text>
        <Text style={[styles.centerValue, { color: theme.textPrimary }]}>
          {centerValue}
        </Text>
      </View>
    </View>
  );
}

function AnimatedDonutSlice({
  animateEntrance,
  color,
  endAngle,
  onPress,
  reduceMotion,
  selected,
  settleImmediately = false,
  startAngle
}: {
  animateEntrance: boolean;
  color: string;
  endAngle: number;
  onPress?: () => void;
  reduceMotion: boolean;
  selected: boolean;
  settleImmediately?: boolean;
  startAngle: number;
}) {
  const animatedStart = useSharedValue(startAngle);
  const animatedEnd = useSharedValue(animateEntrance && !reduceMotion ? startAngle : endAngle);
  const targetOpacity = selected ? 1 : 0.22;
  const opacity = useSharedValue(reduceMotion || animateEntrance ? targetOpacity : 0);

  useEffect(() => {
    const duration = reduceMotion || settleImmediately ? 0 : animateEntrance ? 260 : MOBILE_MOTION.layout;
    animatedStart.value = withTiming(startAngle, { duration });
    animatedEnd.value = withTiming(endAngle, { duration });
  }, [animateEntrance, animatedEnd, animatedStart, endAngle, reduceMotion, settleImmediately, startAngle]);

  useEffect(() => {
    opacity.value = withTiming(selected ? 1 : 0.22, { duration: reduceMotion || settleImmediately ? 0 : MOBILE_MOTION.control });
  }, [opacity, reduceMotion, selected, settleImmediately]);

  const animatedProps = useAnimatedProps(() => ({
    d: donutSlicePath(92, 92, 84, 57, animatedStart.value, animatedEnd.value),
    fillOpacity: opacity.value
  }));

  return <AnimatedPath animatedProps={animatedProps} fill={color} onPress={onPress} />;
}

function uncategorizedFill(theme: MobileTheme) {
  return theme.mode === "dark" ? "#323946" : "#EEF2F6";
}

function uncategorizedStripe(theme: MobileTheme) {
  return theme.mode === "dark" ? "#8792A3" : "#98A4B3";
}

const styles = StyleSheet.create({
  box: { alignItems: "center", height: 184, justifyContent: "center", position: "relative", width: 184 },
  center: { alignItems: "center", justifyContent: "center", position: "absolute", width: 104 },
  centerLabel: { fontFamily: "System", fontSize: 11, fontWeight: "600", lineHeight: 15, textAlign: "center" },
  centerValue: { fontFamily: "System", fontSize: 22, fontVariant: ["tabular-nums"], fontWeight: "700", lineHeight: 27, maxWidth: 104, textAlign: "center" }
});
