import { normalizeHealthWorkoutType, type MotionTravelMode } from "@dayframe/shared";

/**
 * Health walks win (PRD D19, design §9): a walk, run or ride Move that an Apple Health workout of
 * that kind covers is the workout, so it is neither offered in Review nor logged; the workout keeps
 * its own block or card.
 */
export const HEALTH_COVERAGE_MINIMUM_SHARE = 0.5;
export const HEALTH_COVERAGE_TOLERANCE_MS = 5 * 60_000;

const MODE_FOR_WORKOUT: Record<string, MotionTravelMode> = { walking: "walking", running: "running", cycling: "cycling" };

export type HealthWorkoutWindow = { startedAt: string; stoppedAt: string; workoutType: unknown };

/**
 * Whether one workout covers the Move: the workout is a walk, run or ride and the Move's mode is the
 * same and the workout covers at least half of the Move, or the Move lies inside the workout give or
 * take five minutes. A Move whose mode is unknown is covered only in the second case: travel that
 * happened during a walk workout is the walk.
 */
export function healthWorkoutCoversMove(
  move: { startedAt: string; stoppedAt: string; travelMode?: MotionTravelMode | null },
  workout: HealthWorkoutWindow
) {
  const kind = MODE_FOR_WORKOUT[normalizeHealthWorkoutType(workout.workoutType)];
  if (!kind) return false;
  const moveStart = Date.parse(move.startedAt), moveStop = Date.parse(move.stoppedAt);
  const workoutStart = Date.parse(workout.startedAt), workoutStop = Date.parse(workout.stoppedAt);
  if (![moveStart, moveStop, workoutStart, workoutStop].every(Number.isFinite) || moveStop <= moveStart || workoutStop <= workoutStart) {
    return false;
  }
  const mode = move.travelMode ?? null;
  if (mode != null && mode !== kind) return false;
  const inside = moveStart >= workoutStart - HEALTH_COVERAGE_TOLERANCE_MS && moveStop <= workoutStop + HEALTH_COVERAGE_TOLERANCE_MS;
  if (inside) return true;
  if (mode == null) return false;
  const overlap = Math.max(0, Math.min(moveStop, workoutStop) - Math.max(moveStart, workoutStart));
  return overlap >= HEALTH_COVERAGE_MINIMUM_SHARE * (moveStop - moveStart);
}
