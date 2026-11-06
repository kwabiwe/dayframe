import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, type ViewProps } from "react-native";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";

export type LiveDigitStripProps = {
  cellHeight: number;
  children: ReactNode;
  digit: number;
  reduceMotion: boolean;
  style: ViewProps["style"];
};

function stripOffset(digit: number, cellHeight: number) {
  return digit === 0 ? 0 : -digit * cellHeight;
}

export function LiveDigitStrip({ cellHeight, children, digit, reduceMotion, style }: LiveDigitStripProps) {
  // React Native's native driver moves the strip on the UI thread, with no per-frame JS and no view-tree
  // commit (Reanimated committed the whole tree on every frame of a roll: iPhone 17, 13 Oct).
  const [offset] = useState(() => new Animated.Value(stripOffset(digit, cellHeight)));
  const placed = useRef({ cellHeight, digit, reduceMotion });

  useEffect(() => {
    const previous = placed.current;
    if (previous.digit === digit && previous.cellHeight === cellHeight && previous.reduceMotion === reduceMotion) return;
    placed.current = { cellHeight, digit, reduceMotion };
    const target = stripOffset(digit, cellHeight);
    // Reduce Motion (or a covered Today) sets the strip at rest, a roll still running from the tick
    // before included; a new cell size (Dynamic Type, a narrower card) re-places it. Neither rolls.
    if (reduceMotion || previous.cellHeight !== cellHeight) {
      offset.stopAnimation();
      offset.setValue(target);
      return;
    }
    // Motion coming back alone leaves the strip where it rests.
    if (previous.digit === digit) return;
    // Keep the spring's visible trajectory and stop the native driver within 0.08 pt of the target
    // at 0.5 pt/s or slower. The final snap is subpixel. A retarget starts at the strip's current
    // position without the earlier roll's speed (Codex r1 on #392).
    Animated.spring(offset, { ...BLOCKS_SPRING.roll, toValue: target, useNativeDriver: true }).start();
  }, [cellHeight, digit, offset, reduceMotion]);

  useEffect(() => () => offset.stopAnimation(), [offset]);

  return <Animated.View style={[style, { transform: [{ translateY: offset }] }]}>{children}</Animated.View>;
}
