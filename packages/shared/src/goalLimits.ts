/**
 * Settings › Your day goal steppers on iPhone and web (Blocks 6a-1, UIA-309): whole hours, daily
 * 1–24 h and weekly 5–168 h in 5 h steps (owner, 12 Oct: the prototype's 14 h / 80 h caps were too
 * low). The server accepts any whole minute up to a day / a week.
 */
export type GoalLimits = { min: number; max: number; step: number };

export const DAILY_GOAL_HOURS = { min: 1, max: 24, step: 1 } as const satisfies GoalLimits;
export const WEEKLY_GOAL_HOURS = { min: 5, max: 168, step: 5 } as const satisfies GoalLimits;

/**
 * One stepper tap. A goal on the step grid moves by one step; one between steps (set elsewhere,
 * say 42 h a week) moves to the nearest step in that direction (45 h or 40 h). Clamped to the limits;
 * a goal outside them only steps back towards them.
 */
export function nextGoalMinutes(minutes: number, direction: -1 | 1, limits: GoalLimits) {
  const hours = minutes / 60;
  // A goal at or beyond a limit never steps further out, and the step never lands on the opposite
  // side: Increase at the maximum does nothing; Decrease brings it in.
  if (direction > 0 && hours >= limits.max) return minutes;
  if (direction < 0 && hours <= limits.min) return minutes;
  const next = direction > 0
    ? Math.floor(hours / limits.step + 1e-9) * limits.step + limits.step
    : Math.ceil(hours / limits.step - 1e-9) * limits.step - limits.step;
  return Math.min(limits.max, Math.max(limits.min, next)) * 60;
}

export function canStepGoal(minutes: number, direction: -1 | 1, limits: GoalLimits) {
  return nextGoalMinutes(minutes, direction, limits) !== minutes;
}
