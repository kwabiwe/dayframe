import type pg from "pg";
import { pool } from "../db";
import { normalizeHealthWorkoutType, type MotionTravelMode } from "@dayframe/shared";
import type { RequestSession } from "../session";
import { SUPERSEDED_REVIEW_SCOPE } from "./location-review-supersession";

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
 * A workout's kind from its hints one at a time, as Health reprocessing does: the stored type, the
 * payload's type (numbers included), its label, its activity type. JSON null or an unrecognised hint
 * never masks a later recognisable one (Codex r1 on #457).
 */
export function healthWorkoutKind(hints: readonly unknown[]) {
  for (const hint of hints) {
    if (hint == null) continue;
    const kind = normalizeHealthWorkoutType(hint);
    if (kind !== "other") return kind;
  }
  return "other";
}

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
  const kind = MODE_FOR_WORKOUT[healthWorkoutKind(Array.isArray(workout.workoutType) ? workout.workoutType : [workout.workoutType])];
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

type WorkoutRow = { key: string; startedAt: Date; stoppedAt: Date; storedType: unknown; payloadType: unknown; label: unknown; activity: unknown };
const CHUNK = 250;
const chunks = <T,>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK));

/**
 * For each Move window, every imported Apple Health workout (`health_workouts`, whatever became of its
 * card or block) within five minutes of it, read per batch of Moves so no cap can hide one (Codex r1
 * on #457). Returns the keys of the Moves a workout covers.
 */
async function coveredMoveKeys(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  moves: ReadonlyArray<{ key: string; startedAt: string; stoppedAt: string; travelMode: MotionTravelMode | null }>
) {
  const covered = new Set<string>();
  for (const batch of chunks(moves)) {
    const result = await client.query<WorkoutRow>(
      `select r.key, hw.started_at as "startedAt", hw.stopped_at as "stoppedAt", hw.workout_type as "storedType",
              hw.raw_payload -> 'workoutType' as "payloadType", hw.raw_payload -> 'workoutLabel' as label,
              hw.raw_payload -> 'activityType' as activity
       from jsonb_to_recordset($3::jsonb) as r(key text, started_at timestamptz, stopped_at timestamptz)
       join health_workouts hw
         on hw.workspace_id = $1 and hw.user_id = $2
        and hw.started_at < r.stopped_at + interval '5 minutes' and hw.stopped_at > r.started_at - interval '5 minutes'`,
      [session.workspaceId, session.userId, JSON.stringify(batch.map(({ key, startedAt, stoppedAt }) =>
        ({ key, started_at: startedAt, stopped_at: stoppedAt })))]);
    const byKey = new Map(batch.map((move) => [move.key, move]));
    for (const row of result.rows) {
      const move = byKey.get(row.key);
      if (move && !covered.has(row.key) && healthWorkoutCoversMove(move, {
        startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString(),
        workoutType: [row.storedType, row.payloadType, row.label, row.activity]
      })) covered.add(row.key);
    }
  }
  return covered;
}

/** The candidate Moves (by client event ID) a Health workout covers: they are not offered. */
export async function healthCoveredMoves(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  candidates: ReadonlyArray<{ clientEventId: string; segment: { kind: string; startedAt: string; stoppedAt?: string | null; travelMode?: MotionTravelMode } }>
) {
  return coveredMoveKeys(client, session, candidates.flatMap(({ clientEventId, segment }) =>
    segment.kind === "commute" && segment.stoppedAt
      ? [{ key: clientEventId, startedAt: segment.startedAt, stoppedAt: segment.stoppedAt, travelMode: segment.travelMode ?? null }]
      : []));
}

/**
 * Retires every open location Move card a Health workout covers, from the cards themselves, so a
 * workout that arrives after the card is reconciled on the next replay even once the Move's evidence
 * has aged out (Codex r1 on #457). Retirement is replay's own (`superseded`); user decisions are never
 * touched. Returns the number retired.
 */
export async function retireHealthCoveredMoveCards(client: Pick<pg.PoolClient, "query">, session: RequestSession) {
  const open = await client.query<{ reviewId: string; eventId: string; startedAt: Date; stoppedAt: Date; travelMode: string | null }>(
    `select ri.id as "reviewId", ri.event_id as "eventId", ri.suggested_started_at as "startedAt",
            ri.suggested_stopped_at as "stoppedAt", ae.raw_payload ->> 'travelMode' as "travelMode"
     from review_items ri
     join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
       and ae.source = 'location_learning' and ae.event_type = 'commute_detected' and ae.review_status = 'needs_review'
       and ri.suggested_started_at is not null and ri.suggested_stopped_at is not null
       and exists (select 1 from health_workouts hw where hw.workspace_id = $1 and hw.user_id = $2
         and hw.started_at < ri.suggested_stopped_at + interval '5 minutes' and hw.stopped_at > ri.suggested_started_at - interval '5 minutes')`,
    [session.workspaceId, session.userId]);
  if (open.rows.length === 0) return 0;
  const modes = new Set(["walking", "running", "cycling", "automotive"]);
  const covered = await coveredMoveKeys(client, session, open.rows.map((row) => ({
    key: row.reviewId, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString(),
    travelMode: row.travelMode && modes.has(row.travelMode) ? row.travelMode as MotionTravelMode : null
  })));
  const reviewIds = open.rows.filter((row) => covered.has(row.reviewId)).map((row) => row.reviewId);
  let retired = 0;
  for (const batch of chunks(reviewIds)) {
    const result = await client.query<{ eventId: string }>(
      `update review_items set status = 'ignored', ignored_scope = '${SUPERSEDED_REVIEW_SCOPE}', resolved_at = now()
       where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and status = 'open'
       returning event_id as "eventId"`,
      [session.workspaceId, session.userId, batch]);
    const eventIds = [...new Set(result.rows.map((row) => row.eventId))];
    if (eventIds.length) {
      await client.query(
        `update activity_events set review_status = 'ignored'
         where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'needs_review'`,
        [session.workspaceId, session.userId, eventIds]);
    }
    retired += result.rows.length;
  }
  return retired;
}

/**
 * Right after an events request imported a workout: retire the open Move cards it covers in a short
 * transaction of its own, if the location owner lock is free (a replay holding it runs the same sweep
 * at its end, and every later replay does too). Best effort; never fails the import.
 */
export async function reconcileHealthCoveredMoveCardsNow(session: RequestSession) {
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '2000ms'");
    const lock = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as acquired", [session.workspaceId, session.userId]);
    if (!lock.rows[0]?.acquired) {
      await client.query("rollback");
      return null;
    }
    const retired = await retireHealthCoveredMoveCards(client, session);
    await client.query("commit");
    return retired;
  } catch {
    await client?.query("rollback").catch(() => undefined);
    return null;
  } finally {
    client?.release();
  }
}
