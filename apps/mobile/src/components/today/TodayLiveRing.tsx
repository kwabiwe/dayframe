import { Animated, StyleSheet } from "react-native";
import { useBreathingRing } from "../../lib/blocksMotion";

export type TodayLiveRingProps = {
  color: string;
  cornerRadius: number;
  live: boolean;
  paused?: boolean;
  reduceMotion: boolean;
};

export function TodayLiveRing({ color, cornerRadius, live, paused, reduceMotion }: TodayLiveRingProps) {
  const opacity = useBreathingRing({ live, paused, reduceMotion });
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderColor: color, borderRadius: cornerRadius, borderWidth: 2, opacity, overflow: "hidden" }]}
      testID="today-live-ring"
    />
  );
}
