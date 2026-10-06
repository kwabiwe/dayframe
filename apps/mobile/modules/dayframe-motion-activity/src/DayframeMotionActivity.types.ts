export type DayframeMotionAuthorizationStatus =
  | "unavailable"
  | "not_determined"
  | "restricted"
  | "denied"
  | "authorized"
  | "unknown";

/** One Core Motion activity record. No position: only when it began, its flags and confidence. */
export type DayframeMotionActivityRecord = {
  startMs: number;
  stationary: boolean;
  walking: boolean;
  running: boolean;
  cycling: boolean;
  automotive: boolean;
  unknown: boolean;
  confidence: "low" | "medium" | "high";
};
