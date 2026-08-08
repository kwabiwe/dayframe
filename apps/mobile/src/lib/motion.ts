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

export type ResolvedReduceMotionPreference = {
  reduceMotion: boolean;
  resolved: boolean;
};

let cachedReduceMotionPreference: boolean | null = null;
let pendingReduceMotionPreference: Promise<boolean> | null = null;

function loadReduceMotionPreference() {
  if (cachedReduceMotionPreference !== null) {
    return Promise.resolve(cachedReduceMotionPreference);
  }
  if (pendingReduceMotionPreference) return pendingReduceMotionPreference;

  pendingReduceMotionPreference = AccessibilityInfo.isReduceMotionEnabled()
    .catch(() => cachedReduceMotionPreference ?? true)
    .then((enabled) => {
      cachedReduceMotionPreference = enabled;
      return enabled;
    })
    .finally(() => {
      pendingReduceMotionPreference = null;
    });
  return pendingReduceMotionPreference;
}

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

export function useResolvedReduceMotionPreference(): ResolvedReduceMotionPreference {
  const [preference, setPreference] = useState<ResolvedReduceMotionPreference>(() => ({
    reduceMotion: cachedReduceMotionPreference ?? true,
    resolved: cachedReduceMotionPreference !== null
  }));

  useEffect(() => {
    let mounted = true;
    void loadReduceMotionPreference()
      .then((enabled) => {
        if (mounted) setPreference({ reduceMotion: enabled, resolved: true });
      })
      .catch(() => {
        if (mounted) setPreference({ reduceMotion: true, resolved: true });
      });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        cachedReduceMotionPreference = enabled;
        if (mounted) setPreference({ reduceMotion: enabled, resolved: true });
      }
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return preference;
}

export function useReduceMotionPreference() {
  return useResolvedReduceMotionPreference().reduceMotion;
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
