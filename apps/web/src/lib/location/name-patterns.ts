import { createHash } from "node:crypto";
import type pg from "pg";
import {
  distanceMeters, locationCellKey, movePatternKey, nameBand, stayPatternKey,
  type CommuteSegment, type LocationSegment, type NameBand, type StaySegment
} from "@dayframe/shared";
import type { RequestSession } from "../session";

/**
 * Learned names (PRD D19, A8; `location_name_patterns`). A name or activity the person typed or chose
 * for a Stay or Move in Review is kept against the item's pattern and time-of-day band: prefilled as
 * the card's name and activity after one use, naming an automatic block after two. Only words the
 * person typed count; Dayframe's own titles never feed it.
 */
export type NamePattern = { key: string; band: NameBand };
/** A pattern's learned name (with how often it was used) and activity (with how often it was chosen). */
export type LearnedName = { name: string | null; categoryId: string | null; uses: number; categoryUses: number };

const CHUNK = 250;
const chunks = <T,>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK));

/**
 * Each candidate's pattern (client event ID → key and band). A Stay by its place, learned place or
 * cell; a Move by its persisted end stays and mode; a round trip by its origin, the cell of its
 * farthest route reading from the origin, and mode.
 */
export async function namePatternsFor(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  candidates: ReadonlyArray<{ clientEventId: string; segment: LocationSegment }>,
  stayIds: ReadonlyMap<string, string>, commuteIds: ReadonlyMap<string, string>,
  evidenceTimeZones: ReadonlyMap<string, string>,
  /** Moves whose ends their person corrected: a round trip only when the corrected ends are one place (Codex r4 on #459). */
  correctedMoves: ReadonlySet<string> = new Set()
) {
  const patterns = new Map<string, NamePattern>();
  if (candidates.length === 0) return patterns;
  // Each item's own time zone, that of its first reading as replay loaded it for this device, so a
  // replay after travel or a second device never moves a past item to another band (Codex r1/r2 on
  // #458); UTC when that reading is gone.
  const timeZoneOf = (segment: LocationSegment) => evidenceTimeZones.get(segment.evidenceIds[0] ?? "") || "UTC";
  const moves = candidates.filter((row): row is { clientEventId: string; segment: CommuteSegment } => row.segment.kind === "commute");
  // Both ends of every Move, and every stop of a round trip (its turnaround can be a stop).
  const endStayIds = [...new Set(moves.flatMap(({ segment }) =>
    [stayIds.get(segment.fromStaySegmentId), stayIds.get(segment.toStaySegmentId),
      ...(segment.stops ?? []).map((stop) => stayIds.get(stop.staySegmentId))].filter((id): id is string => Boolean(id))))].sort();
  const endKeys = new Map<string, string | null>();
  const endCentres = new Map<string, { latitude: number; longitude: number }>();
  for (const ids of chunks(endStayIds)) {
    const result = await client.query<{ id: string; placeId: string | null; learnedPlaceId: string | null; latitude: number | null; longitude: number | null }>(
      `select id, place_id as "placeId", learned_place_id as "learnedPlaceId",
              st_y(centre::geometry) as latitude, st_x(centre::geometry) as longitude
       from stay_segments where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])`,
      [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) {
      endKeys.set(row.id, stayPatternKey({ placeId: row.placeId, learnedPlaceId: row.learnedPlaceId,
        centreLatitude: row.latitude, centreLongitude: row.longitude }));
      if (row.latitude != null && row.longitude != null) endCentres.set(row.id, { latitude: row.latitude, longitude: row.longitude });
    }
  }
  const roundTripOf = (segment: CommuteSegment) => correctedMoves.has(segment.clientSegmentId)
    ? Boolean(segment.fromPlaceId && segment.fromPlaceId === segment.toPlaceId)
    : isRoundTrip(segment);
  const roundTrips = moves.filter(({ segment }) => roundTripOf(segment));
  // A round trip's turnaround: the farthest of its route readings and its stops from where it began
  // (an outing with a stop may have no route links at all; Codex r1 on #458).
  const farthest = new Map<string, { latitude: number; longitude: number; metres: number }>();
  const roundTripIds = roundTrips.flatMap(({ segment }) => commuteIds.get(segment.clientSegmentId) ?? []);
  for (const ids of chunks(roundTripIds)) {
    const result = await client.query<{ commuteId: string; latitude: number; longitude: number; metres: number }>(
      `select distinct on (lse.commute_segment_id) lse.commute_segment_id as "commuteId",
              st_y(le.coordinate::geometry) as latitude, st_x(le.coordinate::geometry) as longitude,
              st_distance(le.coordinate, fs.centre) as metres
       from location_segment_evidence lse
       join location_evidence le on le.id = lse.evidence_id and le.workspace_id = lse.workspace_id and le.user_id = lse.user_id
       join commute_segments cs on cs.id = lse.commute_segment_id and cs.workspace_id = lse.workspace_id and cs.user_id = lse.user_id
       join stay_segments fs on fs.id = cs.from_stay_segment_id and fs.workspace_id = cs.workspace_id and fs.user_id = cs.user_id
       where lse.workspace_id = $1 and lse.user_id = $2 and lse.commute_segment_id = any($3::uuid[]) and lse.role = 'route'
         and le.coordinate is not null and fs.centre is not null
       order by lse.commute_segment_id, st_distance(le.coordinate, fs.centre) desc, le.client_evidence_id`,
      [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) farthest.set(row.commuteId, row);
  }
  const turnaroundOf = (segment: CommuteSegment) => {
    const commuteId = commuteIds.get(segment.clientSegmentId);
    let best = commuteId ? farthest.get(commuteId) ?? null : null;
    const origin = endCentres.get(stayIds.get(segment.fromStaySegmentId) ?? "");
    for (const stop of segment.stops ?? []) {
      const centre = endCentres.get(stayIds.get(stop.staySegmentId) ?? "");
      if (!origin || !centre) continue;
      const metres = distanceMeters(origin, centre);
      if (!best || metres > best.metres) best = { ...centre, metres };
    }
    return best ? locationCellKey(best.latitude, best.longitude) : null;
  };
  // A Stay the person corrected keeps its stored identity through replay (Codex r3 on #458).
  const manualKeys = new Map<string, string | null>();
  const candidateStayIds = [...new Set(candidates.flatMap(({ segment }) =>
    segment.kind === "stay" ? stayIds.get(segment.clientSegmentId) ?? [] : []))].sort();
  for (const ids of chunks(candidateStayIds)) {
    const result = await client.query<{ id: string; placeId: string | null; learnedPlaceId: string | null; placeMatchKind: string | null;
      latitude: number | null; longitude: number | null }>(
      `select id, place_id as "placeId", learned_place_id as "learnedPlaceId", metadata ->> 'placeMatchKind' as "placeMatchKind",
              st_y(centre::geometry) as latitude, st_x(centre::geometry) as longitude
       from stay_segments where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and continuity_status = 'manual'`,
      [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) manualKeys.set(row.id, persistedStayKey(row));
  }
  for (const { clientEventId, segment } of candidates) {
    const band = nameBand(segment.startedAt, timeZoneOf(segment));
    let key: string | null;
    if (segment.kind === "stay") {
      const persistedId = stayIds.get(segment.clientSegmentId) ?? "";
      key = manualKeys.has(persistedId) ? manualKeys.get(persistedId) ?? null : stayKey(segment);
    } else {
      const from = endKeys.get(stayIds.get(segment.fromStaySegmentId) ?? "") ?? null;
      const to = endKeys.get(stayIds.get(segment.toStaySegmentId) ?? "") ?? null;
      const roundTrip = roundTripOf(segment);
      const turnaround = roundTrip ? turnaroundOf(segment) : null;
      // A round trip whose turnaround is unknown has no pattern: different outings would share one.
      key = roundTrip && !turnaround ? null
        : movePatternKey({ fromKey: from, toKey: to, travelMode: segment.travelMode ?? null, roundTrip, turnaroundCell: turnaround });
    }
    if (key) patterns.set(clientEventId, { key: hashedPatternKey(session, key), band });
  }
  return patterns;
}

/**
 * Patterns are stored and carried as a SHA-256 of the workspace and key, so neither the table nor a
 * Review payload (which reaches the browser) holds a place ID or a cell of the person's location.
 */
export function hashedPatternKey(session: Pick<RequestSession, "workspaceId">, key: string) {
  return createHash("sha256").update(`${session.workspaceId}:${key}`).digest("hex");
}

/**
 * A persisted Stay's pattern key from its stored identity, as its person corrected it: a saved place,
 * else a learned one, else its cell. A correction part keeps both identities of the Stay it came from
 * (the learned place first, as the emitter keys a learned visit) unless its place was changed.
 */
export function persistedStayKey(row: {
  placeId: string | null; learnedPlaceId: string | null; placeMatchKind: string | null;
  latitude: number | null; longitude: number | null;
}) {
  const centre = { centreLatitude: row.latitude, centreLongitude: row.longitude };
  if (row.placeMatchKind === "saved") return stayPatternKey({ placeId: row.placeId, ...centre });
  if (row.placeMatchKind === "learned") return stayPatternKey({ learnedPlaceId: row.learnedPlaceId, ...centre });
  return stayPatternKey({ placeId: row.learnedPlaceId ? null : row.placeId, learnedPlaceId: row.learnedPlaceId, ...centre });
}

function isRoundTrip(segment: CommuteSegment) {
  return segment.qualificationReason === "same_place_outing" || segment.qualificationReason === "same_place_meaningful_round_trip" ||
    Boolean(segment.fromPlaceId && segment.fromPlaceId === segment.toPlaceId);
}

function stayKey(stay: StaySegment) {
  return stayPatternKey({
    placeId: stay.placeMatchKind === "saved" ? stay.placeId : null,
    learnedPlaceId: stay.placeMatchKind === "learned" ? stay.learnedPlaceId : null,
    centreLatitude: stay.centreLatitude, centreLongitude: stay.centreLongitude
  });
}

/**
 * The learned name and activity for each pattern: its own band's, else the most used one of another
 * band (a name given in the morning still helps at noon); only those used at least once. Archived activities are
 * never suggested.
 */
export async function learnedNamesFor(client: Pick<pg.PoolClient, "query">, session: RequestSession, patterns: ReadonlyMap<string, NamePattern>) {
  const keys = [...new Set([...patterns.values()].map((pattern) => pattern.key))].sort();
  const byKey = new Map<string, Array<LearnedName & { band: NameBand }>>();
  for (const batch of chunks(keys)) {
    const result = await client.query<LearnedName & { key: string; band: NameBand }>(
      `select lnp.pattern_key as key, lnp.band, case when lnp.uses > 0 then lnp.name end as name,
              case when lnp.category_uses > 0 and c.id is not null and not coalesce(c.is_archived, false) then lnp.category_id end as "categoryId",
              lnp.uses, lnp.category_uses as "categoryUses"
       from location_name_patterns lnp
       left join categories c on c.id = lnp.category_id and c.workspace_id = lnp.workspace_id
       where lnp.workspace_id = $1 and lnp.user_id = $2 and lnp.pattern_key = any($3::text[])
         and (lnp.uses > 0 or lnp.category_uses > 0)`,
      [session.workspaceId, session.userId, batch]);
    for (const row of result.rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  }
  const learned = new Map<string, LearnedName>();
  // The name and the activity are chosen independently, each from its own band first, else the other
  // band where it was used most, so a band holding only an activity never hides another band's name
  // (Codex r2 on #458).
  const pick = <K extends "name" | "categoryId">(rows: Array<LearnedName & { band: NameBand }>, band: NameBand, field: K,
    count: (row: LearnedName) => number) => rows.find((row) => row.band === band && row[field])
    ?? rows.filter((row) => row.band !== band && row[field]).sort((a, b) => count(b) - count(a) || (a.band < b.band ? -1 : 1))[0];
  for (const [clientEventId, pattern] of patterns) {
    const rows = byKey.get(pattern.key) ?? [];
    const name = pick(rows, pattern.band, "name", (row) => row.uses);
    const activity = pick(rows, pattern.band, "categoryId", (row) => row.categoryUses);
    if (name || activity) {
      // A name counts every use it has in any band: keeping a name another band suggested never makes
      // it less trusted (Codex r4 on #458).
      const uses = name ? Math.max(...rows.filter((row) => sameName(row.name, name.name)).map((row) => row.uses)) : 0;
      const categoryUses = activity ? Math.max(...rows.filter((row) => row.categoryId === activity.categoryId).map((row) => row.categoryUses)) : 0;
      learned.set(clientEventId, { name: name?.name ?? null, categoryId: activity?.categoryId ?? null, uses, categoryUses });
    }
  }
  return learned;
}

/** Two learned names are the same name with case and spacing aside (as `recordLearnedName` counts them). */
function sameName(left: string | null, right: string | null) {
  const fold = (value: string | null) => value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
  return Boolean(fold(left)) && fold(left) === fold(right);
}

/**
 * Keeps a decision's name and activity against its pattern. A name the person gives starts at one use
 * and the same name (case and spacing aside) adds one; an activity counts the same way on its own;
 * an activity-only decision never adds a use to a name, nor a name-only one to an activity (Codex r1
 * on #458).
 */
export async function recordLearnedName(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  pattern: NamePattern, learned: { name: string | null; categoryId: string | null }
) {
  const name = learned.name?.trim().slice(0, 500) || null;
  if (!name && !learned.categoryId) return;
  await client.query(
    `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, category_id, uses, category_uses, last_used_at)
     values ($1, $2, $3, $4, $5, $6, case when $5::text is null then 0 else 1 end, case when $6::uuid is null then 0 else 1 end, now())
     on conflict (workspace_id, user_id, pattern_key, band) do update set
       uses = case
         when excluded.name is null then location_name_patterns.uses
         when location_name_patterns.name is not null
           and lower(regexp_replace(btrim(location_name_patterns.name), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(excluded.name), '\\s+', ' ', 'g'))
           then location_name_patterns.uses + 1
         else 1 end,
       name = coalesce(excluded.name, location_name_patterns.name),
       category_uses = case
         when excluded.category_id is null then location_name_patterns.category_uses
         when location_name_patterns.category_id = excluded.category_id then location_name_patterns.category_uses + 1
         else 1 end,
       category_id = coalesce(excluded.category_id, location_name_patterns.category_id),
       last_used_at = now(), updated_at = now()`,
    [session.workspaceId, session.userId, pattern.key, pattern.band, name, learned.categoryId]);
}

/**
 * "Stop suggesting this": forgets the learned names of the pattern a location block came from, in
 * every band, so a fallback from another band cannot bring one back (Codex r1 on #458).
 */
export async function forgetLearnedNameForEntry(client: Pick<pg.PoolClient, "query">, session: RequestSession, entryId: string) {
  const key = `(select ae.raw_payload ->> 'namePatternKey' from time_entries te
       join activity_events ae on ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
       where te.id = $3 and te.workspace_id = $1 and te.user_id = $2)`;
  // A pattern whose trips the person stopped logging keeps that choice, without its name (PRD D19).
  const kept = await client.query(
    `update location_name_patterns set name = null, uses = 0, category_id = null, category_uses = 0, updated_at = now()
     where workspace_id = $1 and user_id = $2 and pattern_key = ${key} and auto_log_opt_out
       and (name is not null or category_id is not null)`,
    [session.workspaceId, session.userId, entryId]);
  const result = await client.query(
    `delete from location_name_patterns
     where workspace_id = $1 and user_id = $2 and pattern_key = ${key} and not auto_log_opt_out`,
    [session.workspaceId, session.userId, entryId]);
  return (result.rowCount ?? 0) + (kept.rowCount ?? 0);
}

/**
 * "Don't log trips like this" (PRD D19, A4): the pattern of the Move an automatic block came from stops
 * logging itself; its later Moves go to Review saying so. Takes the Move's event, which outlives the
 * deleted block. Returns whether there was a pattern to stop.
 */
export async function stopLoggingTripsLike(client: Pick<pg.PoolClient, "query">, session: RequestSession, eventId: string) {
  const result = await client.query(
    `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, auto_log_opt_out)
     select ae.workspace_id, ae.user_id, ae.raw_payload ->> 'namePatternKey', ae.raw_payload ->> 'namePatternBand', true
     from activity_events ae
     where ae.id = $3 and ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type = 'commute_detected'
       and ae.raw_payload ->> 'namePatternKey' is not null
       and ae.raw_payload ->> 'namePatternBand' in ('morning', 'afternoon', 'evening', 'weekend')
     on conflict (workspace_id, user_id, pattern_key, band) do update set auto_log_opt_out = true, updated_at = now()
     returning pattern_key as "patternKey"`,
    [session.workspaceId, session.userId, eventId]);
  return result.rows.length > 0;
}

/** Logs trips like these automatically again: clears the pattern's stop in every band. */
export async function resumeLoggingTrips(client: Pick<pg.PoolClient, "query">, session: RequestSession, patternKey: string) {
  await client.query(
    `delete from location_name_patterns
     where workspace_id = $1 and user_id = $2 and pattern_key = $3 and auto_log_opt_out
       and name is null and category_id is null and uses = 0 and category_uses = 0`,
    [session.workspaceId, session.userId, patternKey]);
  const result = await client.query(
    `update location_name_patterns set auto_log_opt_out = false, updated_at = now()
     where workspace_id = $1 and user_id = $2 and pattern_key = $3 and auto_log_opt_out`,
    [session.workspaceId, session.userId, patternKey]);
  return result.rowCount ?? 0;
}

/** How far back Places › Trips looks for a stopped trip's latest Move, to label it. */
export const STOPPED_TRIP_LABEL_LOOKBACK_DAYS = 90;

/**
 * The trip patterns the person stopped logging, newest first (at most 200), each labelled by the name
 * they gave it, else its latest Move's route ("Home → Gym") from the last
 * `STOPPED_TRIP_LABEL_LOOKBACK_DAYS` days, else "A trip". The label lookup is one range scan of the
 * owner's Move events in that window (idx_activity_events_workspace_occurred), whatever the history,
 * and reads nothing else (Codex r1/r2 on #463).
 */
export async function stoppedTripPatterns(client: Pick<pg.PoolClient, "query">, session: RequestSession) {
  const stopped = (await client.query<{ patternKey: string; name: string | null; stoppedAt: Date }>(
    `select pattern_key as "patternKey", max(name) as name, max(updated_at) as "stoppedAt"
     from location_name_patterns
     where workspace_id = $1 and user_id = $2 and auto_log_opt_out
     group by pattern_key
     order by max(updated_at) desc
     limit 200`,
    [session.workspaceId, session.userId])).rows;
  if (stopped.length === 0) return [];
  const latest = new Map((await client.query<{ patternKey: string; route: string | null }>(
    `select distinct on (ae.raw_payload ->> 'namePatternKey')
            ae.raw_payload ->> 'namePatternKey' as "patternKey", ae.raw_payload ->> 'routeLabel' as route
     from activity_events ae
     where ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type = 'commute_detected'
       and ae.occurred_at > now() - make_interval(days => $4)
       and ae.raw_payload ->> 'namePatternKey' = any($3::text[]) and ae.raw_payload ? 'routeLabel'
     order by ae.raw_payload ->> 'namePatternKey', ae.occurred_at desc`,
    [session.workspaceId, session.userId, stopped.map((row) => row.patternKey), STOPPED_TRIP_LABEL_LOOKBACK_DAYS])).rows
    .map((row) => [row.patternKey, row] as const));
  return stopped.map((row) => ({
    patternKey: row.patternKey,
    label: row.name ?? latest.get(row.patternKey)?.route ?? "A trip",
    stoppedAt: row.stoppedAt instanceof Date ? row.stoppedAt.toISOString() : String(row.stoppedAt)
  }));
}
