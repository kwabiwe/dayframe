import type { MotionTravelMode } from "./types";

const LABELS: Record<MotionTravelMode, string> = {
  automotive: "By car",
  cycling: "By bike",
  running: "Running",
  walking: "On foot"
};

/** A journey's travel mode in user language; null for anything else (older rows, unknown values). */
export function travelModeLabel(mode: unknown): string | null {
  return typeof mode === "string" && Object.hasOwn(LABELS, mode) ? LABELS[mode as MotionTravelMode] : null;
}
