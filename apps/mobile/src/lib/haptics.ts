import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";

// Dayframe Blocks haptics (.codex/reference/motion.md). Haptics confirm a committed user action only:
// never a background refresh, a reconciliation, an automatic rollback or a rejected gesture.
// iOS silences them when System Haptics is off; the Settings switch below turns them off in Dayframe.
export type DayframeHapticMoment =
  | "start"
  | "stop"
  | "tick"
  | "reviewLog"
  | "reviewSkip"
  | "delete"
  | "undoRestore";

export const HAPTICS_PREFERENCE_KEY = "dayframe.hapticsEnabled.v1";
/** Stop is one composite: success now, then a soft impact as the stopped block lands. */
export const STOP_LANDING_HAPTIC_DELAY_MS = 180;

let hapticsEnabled = true;
let preferenceLoad: Promise<boolean> | null = null;
let pendingStopLanding: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(enabled: boolean) => void>();

export function loadHapticsPreference() {
  preferenceLoad ??= AsyncStorage.getItem(HAPTICS_PREFERENCE_KEY)
    .then((value) => {
      hapticsEnabled = value !== "off";
      return hapticsEnabled;
    })
    .catch(() => hapticsEnabled);
  return preferenceLoad;
}

export function hapticsAreEnabled() {
  return hapticsEnabled;
}

export async function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
  preferenceLoad = Promise.resolve(enabled);
  if (!enabled) cancelPendingStopLanding();
  for (const listener of listeners) listener(enabled);
  await AsyncStorage.setItem(HAPTICS_PREFERENCE_KEY, enabled ? "on" : "off");
}

export function useHapticsPreference() {
  const [enabled, setEnabled] = useState(hapticsEnabled);
  useEffect(() => {
    let mounted = true;
    listeners.add(setEnabled);
    void loadHapticsPreference().then((value) => {
      if (mounted) setEnabled(value);
    });
    return () => {
      mounted = false;
      listeners.delete(setEnabled);
    };
  }, []);
  return enabled;
}

/**
 * Play the haptic for one committed action. Rapid repeats each call this once per action. Stop's
 * soft landing impact follows `stopLandingDelayMs` (the Stop flight lands later than a row landing).
 */
export function playHaptic(moment: DayframeHapticMoment, { stopLandingDelayMs = STOP_LANDING_HAPTIC_DELAY_MS } = {}) {
  if (!hapticsEnabled) return;
  switch (moment) {
    case "start":
      return fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    case "stop":
      // A newer Stop replaces a landing impact still waiting from an earlier one: one composite per action.
      cancelPendingStopLanding();
      fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      pendingStopLanding = setTimeout(() => {
        pendingStopLanding = null;
        if (hapticsEnabled) fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
      }, stopLandingDelayMs);
      return;
    case "tick":
      return fire(() => Haptics.selectionAsync());
    case "reviewLog":
      return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    case "reviewSkip":
    case "undoRestore":
      return fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    case "delete":
      return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  }
}

function cancelPendingStopLanding() {
  if (pendingStopLanding === null) return;
  clearTimeout(pendingStopLanding);
  pendingStopLanding = null;
}

function fire(play: () => Promise<void>) {
  // Haptics are never the only feedback, so a device without a Taptic Engine just stays quiet.
  void play().catch(() => undefined);
}
