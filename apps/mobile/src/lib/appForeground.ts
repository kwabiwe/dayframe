import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Whether the app is in the foreground ("active"). Clocks and looping animations stop when it is
 * not: location can keep Dayframe alive in the background for hours, and a 1 s clock or a repeating
 * Reanimated animation there kept the JS thread and the display link busy (investigation
 * 2026-10-12, Instruments on an iPhone 11).
 */
export function useAppForeground() {
  const [foreground, setForeground] = useState(() => AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    // The state can change between the first render and this subscription (a launch that becomes
    // active, or a return to the app while the screen mounts); read it again so no change is missed.
    setForeground(AppState.currentState === "active");
    return () => subscription.remove();
  }, []);
  return foreground;
}
