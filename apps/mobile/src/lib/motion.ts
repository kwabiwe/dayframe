import { AccessibilityInfo, LayoutAnimation } from "react-native";
import { useEffect, useState } from "react";
import {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion
} from "react-native-reanimated";

export const MOBILE_MOTION = {
  control: 140,
  layout: 220,
  sheet: 260,
  screen: 280
} as const;

export type LocalMotionPresence = "fade" | "rise" | "scale";

export function localPresenceEntering(
  reduceMotion: boolean,
  presence: LocalMotionPresence = "fade"
) {
  const builder = FadeIn.duration(reduceMotion ? 90 : MOBILE_MOTION.control)
    .reduceMotion(ReduceMotion.Never);
  if (reduceMotion || presence === "fade") return builder;
  if (presence === "rise") {
    return builder.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] });
  }
  return builder.withInitialValues({ opacity: 0, transform: [{ scale: 0.98 }] });
}

export function localPresenceExiting(reduceMotion: boolean) {
  return FadeOut.duration(reduceMotion ? 70 : MOBILE_MOTION.control)
    .reduceMotion(ReduceMotion.Never);
}

export function localLayoutTransition(reduceMotion: boolean) {
  return LinearTransition.duration(MOBILE_MOTION.layout)
    .reduceMotion(reduceMotion ? ReduceMotion.Always : ReduceMotion.System);
}

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

export function useReduceTransparencyPreference() {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceTransparency;
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
