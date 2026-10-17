import type pg from "pg";
import { assessAutomaticMove, type CommuteSegment, type LocationSegment } from "@dayframe/shared";
import type { RequestSession } from "../session";
import { AUTO_LOG_SUPERSEDED_PAYLOAD_KEY, LOCATION_AUTO_LOG_SOURCE } from "./location-auto-log";

/**
 * Moves log themselves (PRD D19, A3/A4): in Review mode, a Move between two known places with a clear
 * mode (`assessAutomaticMove`) becomes a `location_auto_log` block instead of a Review card when the
 * person's "Log trips automatically" is on, its pattern is not one they stopped ("Don't log trips like
 * this"), it was never offered or decided before (under this ID or another), it overlaps no tracked
 * time by more than five minutes and no running timer at all, and no Health workout covers it (those
 * never reach here). The block keeps no description of its own unless a learned name has two uses, and
 * replay moves or removes it with its Move while it is unedited and the Move still logs itself.
 */
export const MOVE_OVERLAP_TOLERANCE_MS = 5 * 60_000;

export type AutoMoveFallback =
  | ReturnType<typeof assessAutomaticMove>["reason"]
  | "auto_log_overlap" | "auto_log_offered_before" | "trip_logged_before" | "trip_logging_opted_out";

type MoveWindow = { key: string; startedAt: string; stoppedAt: string; eventId?: string | null };

/**
 * Why each Move window must not log itself, in order, or nothing: it overlaps a block (not ignored, not
 * its own, not a retired Move's) by more than five minutes or any running timer; another Move here was
 * logged automatically and is still a decision (its block deleted or edited; a retired one is no longer
 * confirmed); or a Move card was offered here before under another ID, whatever became of it (Codex r1
 * on #462, as visits do). One bounded read per 250 windows; `checks` limits it to the overlap read.
 */
export async function movesBlocked(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, windows: readonly MoveWindow[],
  excludedEntryIds: readonly string[], checks: "all" | "overlap" = "all"
) {
  const blocked = new Map<string, "overlap" | "logged" | "offered">();
  for (const batch of chunks(windows)) {
    const result = await client.query<{ key: string; reason: "overlap" | "logged" | "offered" | null }>(
      `select r.key, case
         when exists (
           select 1 from time_entries te
           where te.workspace_id = $1 and te.user_id = $2 and te.review_status <> 'ignored' and not (te.id = any($4::uuid[]))
             and (r.event_id is null or te.created_from_event_id is distinct from r.event_id)
             and te.started_at < r.stopped_at and coalesce(te.stopped_at, 'infinity'::timestamptz) > r.started_at
             and (te.stopped_at is null
               or least(te.stopped_at, r.stopped_at) - greatest(te.started_at, r.started_at) > make_interval(secs => $5))) then 'overlap'
         when $6 and exists (
           select 1 from activity_events ae
           where ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type = 'commute_detected'
             and ae.review_status = 'confirmed' and ae.raw_payload ->> 'semanticDisposition' = 'auto_logged'
             and ae.client_event_id <> r.key and (r.event_id is null or ae.id <> r.event_id)
             and ae.occurred_at < r.stopped_at and (ae.raw_payload ->> 'stoppedAt')::timestamptz > r.started_at) then 'logged'
         when $6 and exists (
           select 1 from review_items ri
           join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
           where ri.workspace_id = $1 and ri.user_id = $2 and ae.event_type = 'commute_detected'
             and (r.event_id is null or ae.id <> r.event_id)
             and ri.suggested_started_at < r.stopped_at and ri.suggested_stopped_at > r.started_at) then 'offered'
       end as reason
       from jsonb_to_recordset($3::jsonb) as r(key text, started_at timestamptz, stopped_at timestamptz, event_id uuid)`,
      [session.workspaceId, session.userId,
        JSON.stringify(batch.map((window) => ({ key: window.key, started_at: window.startedAt, stopped_at: window.stoppedAt, event_id: window.eventId ?? null }))),
        [...excludedEntryIds], MOVE_OVERLAP_TOLERANCE_MS / 1_000, checks === "all"]);
    for (const row of result.rows) if (row.reason) blocked.set(row.key, row.reason);
  }
  return blocked;
}

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
  const blocked = await movesBlocked(client, session,
    eligible.map(({ clientEventId, segment }) => ({ key: clientEventId, startedAt: segment.startedAt, stoppedAt: segment.stoppedAt })),
    context.orphanEntryIds);
  for (const { clientEventId } of eligible) {
    const reason = blocked.get(clientEventId);
    if (reason) fallback.set(clientEventId, reason === "overlap" ? "auto_log_overlap" : reason === "logged" ? "trip_logged_before" : "auto_log_offered_before");
    else logged.add(clientEventId);
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

/**
 * Health walks win (PRD D19) also over a Move that already logged itself: when a workout arrives after
 * it, replay removes the Move's unedited block (one it locked) and retires the Move's event as replay's
 * own (ignored, `autoLogSuperseded`, detached from its Move), so if the workout goes while the Move's
 * evidence lasts, the Move comes back as new (Codex r1 on #462). Edited or deleted blocks stay decisions.
 * Returns the number of blocks removed.
 */
export async function retireCoveredAutoMoves(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, clientEventIds: readonly string[], locked: ReadonlySet<string>
) {
  if (clientEventIds.length === 0 || locked.size === 0) return 0;
  let removed = 0;
  for (const batch of chunks([...clientEventIds].sort())) {
    const covered = (await client.query<{ entryId: string; eventId: string }>(
      `select te.id as "entryId", ae.id as "eventId"
       from activity_events ae
       join time_entries te on te.created_from_event_id = ae.id and te.workspace_id = ae.workspace_id and te.user_id = ae.user_id
       where ae.workspace_id = $1 and ae.user_id = $2 and ae.client_event_id = any($3::text[])
         and ae.event_type = 'commute_detected' and ae.review_status = 'confirmed'
         and ae.raw_payload ->> 'semanticDisposition' = 'auto_logged'
         and te.source = '${LOCATION_AUTO_LOG_SOURCE}' and te.user_edited_at is null and te.id = any($4::uuid[])
       order by te.id`,
      [session.workspaceId, session.userId, batch, [...locked]])).rows;
    if (covered.length === 0) continue;
    const deleted = await client.query(
      `delete from time_entries where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])
         and source = '${LOCATION_AUTO_LOG_SOURCE}' and user_edited_at is null`,
      [session.workspaceId, session.userId, covered.map((row) => row.entryId)]);
    removed += deleted.rowCount ?? 0;
    const eventIds = [...new Set(covered.map((row) => row.eventId))];
    await client.query(
      `update activity_events
       set review_status = 'ignored', raw_payload = raw_payload || jsonb_build_object('${AUTO_LOG_SUPERSEDED_PAYLOAD_KEY}', true)
       where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and review_status = 'confirmed'`,
      [session.workspaceId, session.userId, eventIds]);
    await client.query(
      `update commute_segments set created_from_event_id = null, updated_at = now()
       where workspace_id = $1 and user_id = $2 and created_from_event_id = any($3::uuid[]) and continuity_status <> 'manual'`,
      [session.workspaceId, session.userId, eventIds]);
  }
  return removed;
}
