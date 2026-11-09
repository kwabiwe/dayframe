import { requireNativeViewManager } from "expo-modules-core";
import { useMemo } from "react";
import type { ViewProps } from "react-native";
import type { LiveDigitStripProps } from "./LiveDigitStrip";

const NativeDigitStrip = requireNativeViewManager<ViewProps & {
  model: { cellHeight: number; digit: number; reduceMotion: boolean };
}>("DayframeTodayRing", "DayframeTodayDigitStrip");

export function LiveDigitStrip({ cellHeight, children, digit, reduceMotion, style }: LiveDigitStripProps) {
  const model = useMemo(() => ({ cellHeight, digit, reduceMotion }), [cellHeight, digit, reduceMotion]);
  return <NativeDigitStrip model={model} style={style}>{children}</NativeDigitStrip>;
}
