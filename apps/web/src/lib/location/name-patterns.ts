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
 * Each candidate's own time zone: that of its first evidence reading, so a replay after travel or a
 * second device never moves a past item to another band (Codex r1 on #458); UTC when it is gone.
 */
async function itemTimeZones(
  client: Pick<pg.PoolClient, "query">, session: RequestSession, candidates: ReadonlyArray<{ clientEventId: string; segment: LocationSegment }>
) {
  const firstIds = new Map(candidates.flatMap(({ clientEventId, segment }) => segment.evidenceIds[0] ? [[clientEventId, segment.evidenceIds[0]] as const] : []));
  const zones = new Map<string, string>();
  for (const batch of chunks([...new Set(firstIds.values())].sort())) {
    const result = await client.query<{ id: string; timeZone: string }>(
      `select distinct on (client_evidence_id) client_evidence_id as id, time_zone as "timeZone"
       from location_evidence where workspace_id = $1 and user_id = $2 and client_evidence_id = any($3::text[])
       order by client_evidence_id, occurred_at`, [session.workspaceId, session.userId, batch]);
    for (const row of result.rows) zones.set(row.id, row.timeZone);
  }
  return (clientEventId: string) => zones.get(firstIds.get(clientEventId) ?? "") || "UTC";
}

/**
 * Each candidate's pattern (client event ID → key and band). A Stay by its place, learned place or
 * cell; a Move by its persisted end stays and mode; a round trip by its origin, the cell of its
 * farthest route reading from the origin, and mode.
 */
export async function namePatternsFor(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  candidates: ReadonlyArray<{ clientEventId: string; segment: LocationSegment }>,
  stayIds: ReadonlyMap<string, string>, commuteIds: ReadonlyMap<string, string>
) {
  const patterns = new Map<string, NamePattern>();
  if (candidates.length === 0) return patterns;
  const timeZoneOf = await itemTimeZones(client, session, candidates);
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
  const roundTrips = moves.filter(({ segment }) => isRoundTrip(segment));
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
  for (const { clientEventId, segment } of candidates) {
    const band = nameBand(segment.startedAt, timeZoneOf(clientEventId));
    let key: string | null;
    if (segment.kind === "stay") {
      key = stayKey(segment);
    } else {
      const from = endKeys.get(stayIds.get(segment.fromStaySegmentId) ?? "") ?? null;
      const to = endKeys.get(stayIds.get(segment.toStaySegmentId) ?? "") ?? null;
      const roundTrip = isRoundTrip(segment);
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
 * The learned name for each pattern: its own band's, else the most used one of another band (a name
 * given in the morning still helps at noon); only names used at least once. Archived activities are
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
  for (const [clientEventId, pattern] of patterns) {
    const rows = byKey.get(pattern.key) ?? [];
    const own = rows.find((row) => row.band === pattern.band);
    const other = [...rows].filter((row) => row.band !== pattern.band).sort((a, b) => b.uses - a.uses)[0];
    const chosen = own ?? other;
    if (chosen && (chosen.name || chosen.categoryId)) {
      learned.set(clientEventId, { name: chosen.name, categoryId: chosen.categoryId, uses: chosen.uses, categoryUses: chosen.categoryUses });
    }
  }
  return learned;
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
  const result = await client.query(
    `delete from location_name_patterns lnp
     using time_entries te
     join activity_events ae on ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
     where te.id = $3 and te.workspace_id = $1 and te.user_id = $2
       and lnp.workspace_id = $1 and lnp.user_id = $2
       and lnp.pattern_key = ae.raw_payload ->> 'namePatternKey'`,
    [session.workspaceId, session.userId, entryId]);
  return result.rowCount ?? 0;
}
