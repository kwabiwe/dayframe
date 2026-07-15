import { useEffect, useRef } from "react";
import { Animated, Easing, View, useWindowDimensions } from "react-native";
import type { MobileStyles } from "@/lib/mobileTheme";
import { useReduceMotionPreference } from "@/lib/motion";

type SheetMutationProgressProps = {
  accessibilityLabel?: string;
  active: boolean;
  styles: MobileStyles;
};

export function SheetMutationProgress({
  accessibilityLabel = "Saving changes",
  active,
  styles
}: SheetMutationProgressProps) {
  const reduceMotion = useReduceMotionPreference();
  const windowDimensions = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return undefined;
    }
    if (reduceMotion) {
      progress.setValue(0.5);
      return undefined;
    }

    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 900,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true
      })
    );
    animation.start();

    return () => animation.stop();
  }, [active, progress, reduceMotion]);

  if (!active) return null;

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, windowDimensions.width]
  });

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.sheetProgressSlot}
    >
      <Animated.View
        style={[
          styles.sheetProgressFill,
          { transform: [{ translateX }] }
        ]}
      />
    </View>
  );
}
