import type pg from "pg";
import { withSyncTransaction } from "../sync-transaction";
import { isLockNotAvailableError, isStatementTimeoutError } from "../db";
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
 * has aged out (Codex r1 on #457). Pages through the open Move cards of the last 30 days, newest
 * first, that some workout covers by time as `healthWorkoutCoversMove` measures it (inside it give or
 * take five minutes, or, with a walk, run or ride mode, at least half covered), checking the
 * workout's kind on each page; only a card overlapping a workout of another kind is ever read and
 * kept, so open cards cannot crowd out covered ones (Codex r3/r4 on #457). `window` instead takes
 * every open card, of any age, overlapping one imported workout. `continueWhile` is asked before each
 * page, so a tight budget keeps the pages already retired (Codex r4 on #457). Retirement is replay's
 * own (`superseded`); user decisions are never touched. Returns the number retired.
 */
export async function retireHealthCoveredMoveCards(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  options: { now?: string | number; window?: { startedAt: string; stoppedAt: string }; continueWhile?: () => boolean } = {}
) {
  const modes = new Set(["walking", "running", "cycling", "automotive"]);
  let retired = 0;
  let cursor: { startedAt: Date; id: string } | null = null;
  for (;;) {
    if (options.continueWhile && !options.continueWhile()) break;
    const page: { rows: Array<{ reviewId: string; startedAt: Date; stoppedAt: Date; travelMode: string | null }> } = await client.query(
      `select ri.id as "reviewId", ri.suggested_started_at as "startedAt",
              ri.suggested_stopped_at as "stoppedAt", ae.raw_payload ->> 'travelMode' as "travelMode"
       from review_items ri
       join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
       where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
         and ae.source = 'location_learning' and ae.event_type = 'commute_detected' and ae.review_status = 'needs_review'
         and ri.suggested_started_at is not null and ri.suggested_stopped_at is not null
         and ($4::timestamptz is not null
           and ri.suggested_started_at < $5::timestamptz + interval '5 minutes' and ri.suggested_stopped_at > $4::timestamptz - interval '5 minutes'
           or $4::timestamptz is null and ri.suggested_started_at > $3::timestamptz - interval '30 days')
         and coalesce(ae.raw_payload ->> 'travelMode', '') <> 'automotive'
         and ri.suggested_stopped_at > ri.suggested_started_at
         and exists (select 1 from health_workouts hw where hw.workspace_id = $1 and hw.user_id = $2
           and hw.started_at < ri.suggested_stopped_at + interval '5 minutes' and hw.stopped_at > ri.suggested_started_at - interval '5 minutes'
           and hw.stopped_at > hw.started_at
           and (hw.started_at - interval '5 minutes' <= ri.suggested_started_at and ri.suggested_stopped_at <= hw.stopped_at + interval '5 minutes'
             or ae.raw_payload ->> 'travelMode' in ('walking', 'running', 'cycling')
               and extract(epoch from least(ri.suggested_stopped_at, hw.stopped_at) - greatest(ri.suggested_started_at, hw.started_at))
                 >= ${HEALTH_COVERAGE_MINIMUM_SHARE} * extract(epoch from ri.suggested_stopped_at - ri.suggested_started_at)))
         and ($6::timestamptz is null or (ri.suggested_started_at, ri.id) < ($6::timestamptz, $7::uuid))
       order by ri.suggested_started_at desc, ri.id desc
       limit ${PAGE}`,
      [session.workspaceId, session.userId, new Date(options.now ?? Date.now()).toISOString(),
        options.window?.startedAt ?? null, options.window?.stoppedAt ?? null,
        cursor?.startedAt.toISOString() ?? null, cursor?.id ?? null]);
    if (page.rows.length === 0) break;
    const covered = await coveredMoveKeys(client, session, page.rows.map((row) => ({
      key: row.reviewId, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString(),
      travelMode: row.travelMode && modes.has(row.travelMode) ? row.travelMode as MotionTravelMode : null
    })));
    retired += await retireReviews(client, session, page.rows.filter((row) => covered.has(row.reviewId)).map((row) => row.reviewId));
    if (page.rows.length < PAGE) break;
    const last = page.rows[page.rows.length - 1];
    cursor = { startedAt: last.startedAt, id: last.reviewId };
  }
  return retired;
}

const PAGE = 250;

/**
 * Retires the open cards of these candidate Moves (client event IDs) a Health workout covers by
 * their current window and mode, which can differ from what an open card still holds (late Motion
 * evidence giving a mode; Codex r2 on #457).
 */
export async function retireCoveredCandidateCards(client: Pick<pg.PoolClient, "query">, session: RequestSession, clientEventIds: readonly string[]) {
  const reviewIds: string[] = [];
  for (const batch of chunks(clientEventIds)) {
    const result = await client.query<{ id: string }>(
      `select ri.id from review_items ri
       join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
       where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
         and ae.client_event_id = any($3::text[]) and ae.review_status = 'needs_review'`,
      [session.workspaceId, session.userId, batch]);
    reviewIds.push(...result.rows.map((row) => row.id));
  }
  return retireReviews(client, session, reviewIds);
}

async function retireReviews(client: Pick<pg.PoolClient, "query">, session: RequestSession, reviewIds: readonly string[]) {
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
 * Replay's own sweep at its end: within what the replay's budget leaves (stopping at
 * `minimumRemainingMs`), and behind a savepoint, so a sweep that runs out of time never rolls back the
 * replay's other work (Codex r4 on #457). Returns the number retired (0 if it gave up).
 */
export async function retireHealthCoveredMoveCardsWithinReplay(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  options: { now: string | number; remainingMs?: () => number; minimumRemainingMs?: number }
) {
  const minimum = options.minimumRemainingMs ?? 2_500;
  await client.query("savepoint location_health_sweep");
  try {
    const retired = await retireHealthCoveredMoveCards(client, session, {
      now: options.now, continueWhile: () => (options.remainingMs?.() ?? Number.POSITIVE_INFINITY) > minimum });
    await client.query("release savepoint location_health_sweep");
    return retired;
  } catch (error) {
    if (!isStatementTimeoutError(error) && !isLockNotAvailableError(error)) throw error;
    await client.query("rollback to savepoint location_health_sweep");
    return 0;
  }
}

/**
 * Right after an events request imported a workout: retire the open Move cards of any age that this
 * workout's stored window covers (the row as kept, which an earlier revision of the same sample may
 * have set; Codex r4 on #457), in a bounded transaction of its own (`withSyncTransaction`: acquisition,
 * work and cleanup within the request's deadline, at most two seconds), if the location owner lock is
 * free; a replay holding it sweeps at its end, and every later replay does too (Codex r2/r3 on #457).
 * Best effort; never fails the import.
 */
export async function reconcileHealthCoveredMoveCardsNow(
  session: RequestSession,
  options: {
    deadlineAt?: number; signal?: AbortSignal; now?: string | number;
    /** The imported workout, as the events request named it. */
    workout?: { provider: string | null; externalSampleId: string | null; startedAt: string; stoppedAt: string } | null;
  } = {}
) {
  const deadlineAt = Math.min(options.deadlineAt ?? Number.POSITIVE_INFINITY, Date.now() + 2_000);
  if (deadlineAt - Date.now() < 300) return null;
  try {
    return await withSyncTransaction("location_health_reconcile", async ({ client }) => {
      const lock = await client.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as acquired", [session.workspaceId, session.userId]);
      if (!lock.rows[0]?.acquired) return null;
      // Without a workout (maintenance), the 30-day sweep.
      const window = options.workout ? await storedWorkoutWindow(client, session, options.workout) : undefined;
      if (options.workout && !window) return 0;
      // Pages stop with time to commit the ones already retired.
      return retireHealthCoveredMoveCards(client, session, { now: options.now, window: window ?? undefined,
        continueWhile: () => deadlineAt - Date.now() > 500 });
    }, { deadlineAt, signal: options.signal });
  } catch {
    return null;
  }
}

/**
 * The window kept for an imported workout: its stored row when it has a sample ID (the first revision
 * wins there), else the request's own window with ingestion's fallbacks.
 */
async function storedWorkoutWindow(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  workout: { provider: string | null; externalSampleId: string | null; startedAt: string; stoppedAt: string }
) {
  if (workout.externalSampleId) {
    const stored = await client.query<{ startedAt: Date; stoppedAt: Date }>(
      `select started_at as "startedAt", stopped_at as "stoppedAt" from health_workouts
       where workspace_id = $1 and user_id = $2 and provider = coalesce($3, 'healthkit') and external_sample_id = $4
       limit 1`,
      [session.workspaceId, session.userId, workout.provider, workout.externalSampleId]);
    const row = stored.rows[0];
    return row ? { startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString() } : null;
  }
  return { startedAt: workout.startedAt, stoppedAt: workout.stoppedAt };
}
