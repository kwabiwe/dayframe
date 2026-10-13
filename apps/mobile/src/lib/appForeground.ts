import { useEffect, useState } from "react";
import { AppState } from "react-native";

type AppForegroundState = {
  foreground: boolean;
  /** How many times the app has come back to the foreground since this hook mounted. */
  returns: number;
};

function nextAppForegroundState(current: AppForegroundState, state: string | null | undefined): AppForegroundState {
  const foreground = state === "active";
  if (foreground === current.foreground) return current;
  return { foreground, returns: foreground ? current.returns + 1 : current.returns };
}

/**
 * Whether the app is in the foreground ("active") and how many times it has returned there. Both
 * change in the render the AppState event causes, so whatever resets on a return (the live block's
 * clock) does so in the same commit as the time it shows.
 */
export function useAppForegroundState() {
  const [state, setState] = useState<AppForegroundState>(() => ({
    foreground: AppState.currentState === "active",
    returns: 0,
  }));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) =>
      setState((current) => nextAppForegroundState(current, next))
    );
    // The state can change between the first render and this subscription (a launch that becomes
    // active, or a return to the app while the screen mounts); read it again so no change is missed.
    setState((current) => nextAppForegroundState(current, AppState.currentState));
    return () => subscription.remove();
  }, []);
  return state;
}

/**
 * Whether the app is in the foreground ("active"). Clocks and looping animations stop when it is
 * not: location can keep Dayframe alive in the background for hours, and a 1 s clock or a repeating
 * Reanimated animation there kept the JS thread and the display link busy (investigation
 * 2026-10-12, Instruments on an iPhone 11).
 */
export function useAppForeground() {
  return useAppForegroundState().foreground;
}
