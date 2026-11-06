import { requireNativeViewManager } from "expo-modules-core";
import { StyleSheet, type ViewProps } from "react-native";
import type { TodayLiveRingProps } from "./TodayLiveRing";

const NativeTodayRing = requireNativeViewManager<ViewProps & {
  cornerRadius: number;
  mode: "hidden" | "live" | "resting";
  strokeColor: string;
}>("DayframeTodayRing");

export function TodayLiveRing({ color, cornerRadius, live, paused, reduceMotion }: TodayLiveRingProps) {
  const mode = live ? (paused || reduceMotion ? "resting" : "live") : "hidden";
  return (
    <NativeTodayRing
      cornerRadius={cornerRadius}
      mode={mode}
      pointerEvents="none"
      strokeColor={color}
      style={StyleSheet.absoluteFill}
      testID="today-live-ring"
    />
  );
}
