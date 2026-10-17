import type pg from "pg";
import { assessAutomaticMove, type CommuteSegment, type LocationSegment } from "@dayframe/shared";
import type { RequestSession } from "../session";

/**
 * Moves log themselves (PRD D19, A3/A4): in Review mode, a Move between two known places with a clear
 * mode (`assessAutomaticMove`) becomes a `location_auto_log` block instead of a Review card when the
 * person's "Log trips automatically" is on, its pattern is not one they stopped ("Don't log trips like
 * this"), it was never offered or decided before, it overlaps no tracked time by more than five
 * minutes and no running timer at all, and no Health workout covers it (those never reach here). The
 * block keeps no description of its own unless a learned name has two uses, and replay moves or
 * removes it with its Move while it is unedited, as for Log automatically visits.
 */
export const MOVE_OVERLAP_TOLERANCE_MS = 5 * 60_000;

export type AutoMoveFallback =
  | ReturnType<typeof assessAutomaticMove>["reason"]
  | "auto_log_overlap" | "auto_log_offered_before" | "trip_logging_opted_out";

/**
 * The person's "Log trips automatically" (on by default). Read through `to_jsonb` so a database
 * without the column yet (the migration runs before this server deploys) reads as off, never fails.
 */
export async function logTripsAutomatically(client: Pick<pg.PoolClient, "query">, session: RequestSession) {
  const result = await client.query<{ value: boolean | null }>(
    `select (to_jsonb(u) -> 'log_trips_automatically')::boolean as value from users u where u.id = $1`, [session.userId]);
  return result.rows[0]?.value === true;
}

/** Whether both ends of a Move are known places: saved, or accepted learned (`stays` by client ID). */
export function moveEndsKnown(move: CommuteSegment, stays: ReadonlyMap<string, LocationSegment>) {
  const known = (placeId: string | null | undefined, stayId: string) => {
    if (placeId) return true;
    const stay = stays.get(stayId);
    return stay?.kind === "stay" && ((stay.placeMatchKind === "saved" && Boolean(stay.placeId)) ||
      (stay.placeMatchKind === "learned" && Boolean(stay.learnedPlaceId)));
  };
  return known(move.fromPlaceId, move.fromStaySegmentId) && known(move.toPlaceId, move.toStaySegmentId);
}

const CHUNK = 250;
function* chunks<T>(rows: readonly T[]) {
  for (let index = 0; index < rows.length; index += CHUNK) yield rows.slice(index, index + CHUNK);
}

/**
 * The Moves this emission logs as blocks, and why the others with a clear policy answer stay Review
 * cards (their reason line). `prior` holds the events that already exist (offered or decided before),
 * `freshAgain` those replay retired from automatic logging and now offers as new, `optedOut` the
 * candidates whose pattern the person stopped, and `orphans` the locked blocks of retired Moves, which
 * never count as overlapping (their replacement takes them).
 */
export async function chooseAutoLoggedMoves(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  candidates: ReadonlyArray<{ segment: LocationSegment; clientEventId: string }>,
  context: {
    stays: ReadonlyMap<string, LocationSegment>;
    prior: ReadonlySet<string>;
    freshAgain: ReadonlySet<string>;
    optedOut: ReadonlySet<string>;
    orphanEntryIds: readonly string[];
    enabled: boolean;
  }
) {
  const logged = new Set<string>();
  const fallback = new Map<string, AutoMoveFallback>();
  const eligible: Array<{ clientEventId: string; segment: CommuteSegment }> = [];
  for (const { segment, clientEventId } of candidates) {
    if (segment.kind !== "commute") continue;
    const policy = assessAutomaticMove(segment, moveEndsKnown(segment, context.stays));
    if (!policy.eligible) {
      fallback.set(clientEventId, policy.reason);
      continue;
    }
    if (context.prior.has(clientEventId) && !context.freshAgain.has(clientEventId)) {
      fallback.set(clientEventId, "auto_log_offered_before");
      continue;
    }
    if (!context.enabled) {
      fallback.set(clientEventId, "log_trips_off");
      continue;
    }
    if (context.optedOut.has(clientEventId)) {
      fallback.set(clientEventId, "trip_logging_opted_out");
      continue;
    }
    eligible.push({ clientEventId, segment });
  }
  for (const batch of chunks(eligible)) {
    // Overlap by more than five minutes with any block not ignored, or any overlap with a running one.
    const result = await client.query<{ key: string }>(
      `select r.key from jsonb_to_recordset($3::jsonb) as r(key text, started_at timestamptz, stopped_at timestamptz)
       where exists (
         select 1 from time_entries te
         where te.workspace_id = $1 and te.user_id = $2 and te.review_status <> 'ignored' and not (te.id = any($4::uuid[]))
           and te.started_at < r.stopped_at and coalesce(te.stopped_at, 'infinity'::timestamptz) > r.started_at
           and (te.stopped_at is null
             or least(te.stopped_at, r.stopped_at) - greatest(te.started_at, r.started_at) > make_interval(secs => $5)))`,
      [session.workspaceId, session.userId,
        JSON.stringify(batch.map(({ clientEventId, segment }) => ({ key: clientEventId, started_at: segment.startedAt, stopped_at: segment.stoppedAt }))),
        [...context.orphanEntryIds], MOVE_OVERLAP_TOLERANCE_MS / 1_000]);
    const overlapping = new Set(result.rows.map((row) => row.key));
    for (const { clientEventId } of batch) {
      if (overlapping.has(clientEventId)) fallback.set(clientEventId, "auto_log_overlap");
      else logged.add(clientEventId);
    }
  }
  return { logged, fallback };
}

/** The candidates whose learned-name pattern the person stopped from logging automatically. */
export async function optedOutMoves(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, patterns: ReadonlyMap<string, { key: string }>,
  moveIds: ReadonlySet<string>
) {
  const keys = [...new Set([...patterns].filter(([id]) => moveIds.has(id)).map(([, pattern]) => pattern.key))].sort();
  const stopped = new Set<string>();
  for (const batch of chunks(keys)) {
    const result = await client.query<{ key: string }>(
      `select distinct pattern_key as key from location_name_patterns
       where workspace_id = $1 and user_id = $2 and pattern_key = any($3::text[]) and auto_log_opt_out`,
      [session.workspaceId, session.userId, batch]);
    for (const row of result.rows) stopped.add(row.key);
  }
  return new Set([...patterns].filter(([id, pattern]) => moveIds.has(id) && stopped.has(pattern.key)).map(([id]) => id));
}
