import { AccessibilityInfo, LayoutAnimation } from "react-native";
import { useEffect, useState } from "react";

export const MOBILE_MOTION = {
  control: 140,
  layout: 220,
  sheet: 260,
  screen: 280
} as const;

export function useReduceMotionPreference() {
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export function scheduleLayoutTransition(reduceMotion: boolean) {
  if (reduceMotion) return;
  LayoutAnimation.configureNext({
    duration: MOBILE_MOTION.layout,
    create: {
      type: LayoutAnimation.Types.easeOut,
      property: LayoutAnimation.Properties.opacity
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut
    },
    delete: {
      type: LayoutAnimation.Types.easeIn,
      property: LayoutAnimation.Properties.opacity
    }
  });
}
