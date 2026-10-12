import type { ReactNode } from "react";
import { LayoutAnimationConfig } from "react-native-reanimated";
import { useSettingsLastKnownReady } from "../../lib/settingsLastKnown";

/**
 * A Settings page's rows, mounted only once the last-known values have hydrated (A4; Codex r1–r2 on
 * #365). Hydration starts before any screen renders, so a page opened by the user mounts its rows on
 * its first render. A page that mounts mid-hydration (a deep link at launch) mounts nothing until it
 * settles (at most `SETTINGS_LAST_KNOWN_FIRST_PAINT_WAIT_MS`), so its controls are created with their
 * hydrated values: a switch's thumb starts in place instead of sliding from a default, and rows
 * that appear with the page (the reminder's Time row) skip their entering animation. Changes after
 * that — a toggle, a live read that really differs — animate as usual.
 */
export function SettingsHydrationGate({ children, waitMs }: { children: ReactNode; waitMs?: number }) {
  const ready = useSettingsLastKnownReady(waitMs);
  if (!ready) return null;
  return <LayoutAnimationConfig skipEntering>{children}</LayoutAnimationConfig>;
}
