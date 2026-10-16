import { createHash } from "node:crypto";
import type pg from "pg";
import {
  locationCellKey, movePatternKey, nameBand, stayPatternKey,
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
export type LearnedName = { name: string | null; categoryId: string | null; uses: number };

const CHUNK = 250;
const chunks = <T,>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) => items.slice(index * CHUNK, (index + 1) * CHUNK));

/** The time zone of the user's latest location evidence (the device's), else UTC. */
async function userTimeZone(client: Pick<pg.PoolClient, "query">, session: RequestSession) {
  const result = await client.query<{ timeZone: string }>(
    `select time_zone as "timeZone" from location_evidence where workspace_id = $1 and user_id = $2
     order by occurred_at desc limit 1`, [session.workspaceId, session.userId]);
  return result.rows[0]?.timeZone || "UTC";
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
  const timeZone = await userTimeZone(client, session);
  const moves = candidates.filter((row): row is { clientEventId: string; segment: CommuteSegment } => row.segment.kind === "commute");
  const endStayIds = [...new Set(moves.flatMap(({ segment }) =>
    [stayIds.get(segment.fromStaySegmentId), stayIds.get(segment.toStaySegmentId)].filter((id): id is string => Boolean(id))))].sort();
  const endKeys = new Map<string, string | null>();
  for (const ids of chunks(endStayIds)) {
    const result = await client.query<{ id: string; placeId: string | null; learnedPlaceId: string | null; latitude: number | null; longitude: number | null }>(
      `select id, place_id as "placeId", learned_place_id as "learnedPlaceId",
              st_y(centre::geometry) as latitude, st_x(centre::geometry) as longitude
       from stay_segments where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])`,
      [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) {
      endKeys.set(row.id, stayPatternKey({ placeId: row.placeId, learnedPlaceId: row.learnedPlaceId,
        centreLatitude: row.latitude, centreLongitude: row.longitude }));
    }
  }
  const roundTrips = moves.filter(({ segment }) => isRoundTrip(segment));
  const turnaround = new Map<string, string>();
  const roundTripIds = roundTrips.flatMap(({ segment }) => commuteIds.get(segment.clientSegmentId) ?? []);
  for (const ids of chunks(roundTripIds)) {
    const result = await client.query<{ commuteId: string; latitude: number; longitude: number }>(
      `select distinct on (lse.commute_segment_id) lse.commute_segment_id as "commuteId",
              st_y(le.coordinate::geometry) as latitude, st_x(le.coordinate::geometry) as longitude
       from location_segment_evidence lse
       join location_evidence le on le.id = lse.evidence_id and le.workspace_id = lse.workspace_id and le.user_id = lse.user_id
       join commute_segments cs on cs.id = lse.commute_segment_id and cs.workspace_id = lse.workspace_id and cs.user_id = lse.user_id
       join stay_segments fs on fs.id = cs.from_stay_segment_id and fs.workspace_id = cs.workspace_id and fs.user_id = cs.user_id
       where lse.workspace_id = $1 and lse.user_id = $2 and lse.commute_segment_id = any($3::uuid[]) and lse.role = 'route'
         and le.coordinate is not null and fs.centre is not null
       order by lse.commute_segment_id, st_distance(le.coordinate, fs.centre) desc, le.client_evidence_id`,
      [session.workspaceId, session.userId, ids]);
    for (const row of result.rows) turnaround.set(row.commuteId, locationCellKey(row.latitude, row.longitude));
  }
  for (const { clientEventId, segment } of candidates) {
    const band = nameBand(segment.startedAt, timeZone);
    let key: string | null;
    if (segment.kind === "stay") {
      key = stayKey(segment);
    } else {
      const from = endKeys.get(stayIds.get(segment.fromStaySegmentId) ?? "") ?? null;
      const to = endKeys.get(stayIds.get(segment.toStaySegmentId) ?? "") ?? null;
      const commuteId = commuteIds.get(segment.clientSegmentId);
      key = movePatternKey({ fromKey: from, toKey: to, travelMode: segment.travelMode ?? null, roundTrip: isRoundTrip(segment),
        turnaroundCell: commuteId ? turnaround.get(commuteId) ?? null : null });
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
      `select lnp.pattern_key as key, lnp.band, lnp.name,
              case when c.id is not null and not coalesce(c.is_archived, false) then lnp.category_id end as "categoryId", lnp.uses
       from location_name_patterns lnp
       left join categories c on c.id = lnp.category_id and c.workspace_id = lnp.workspace_id
       where lnp.workspace_id = $1 and lnp.user_id = $2 and lnp.pattern_key = any($3::text[]) and lnp.uses > 0`,
      [session.workspaceId, session.userId, batch]);
    for (const row of result.rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  }
  const learned = new Map<string, LearnedName>();
  for (const [clientEventId, pattern] of patterns) {
    const rows = byKey.get(pattern.key) ?? [];
    const own = rows.find((row) => row.band === pattern.band);
    const other = [...rows].filter((row) => row.band !== pattern.band).sort((a, b) => b.uses - a.uses)[0];
    const chosen = own ?? other;
    if (chosen && (chosen.name || chosen.categoryId)) learned.set(clientEventId, { name: chosen.name, categoryId: chosen.categoryId, uses: chosen.uses });
  }
  return learned;
}

/**
 * Keeps a decision's name and activity against its pattern: a new name starts at one use, the same
 * name (case and spacing aside) or an activity alone adds one.
 */
export async function recordLearnedName(
  client: Pick<pg.PoolClient, "query">, session: RequestSession,
  pattern: NamePattern, learned: { name: string | null; categoryId: string | null }
) {
  if (!learned.name && !learned.categoryId) return;
  await client.query(
    `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, category_id, uses, last_used_at)
     values ($1, $2, $3, $4, $5, $6, 1, now())
     on conflict (workspace_id, user_id, pattern_key, band) do update set
       uses = case
         when excluded.name is null or location_name_patterns.name is null
           or lower(regexp_replace(btrim(location_name_patterns.name), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(excluded.name), '\\s+', ' ', 'g'))
         then location_name_patterns.uses + 1 else 1 end,
       name = coalesce(excluded.name, location_name_patterns.name),
       category_id = coalesce(excluded.category_id, location_name_patterns.category_id),
       last_used_at = now(), updated_at = now()`,
    [session.workspaceId, session.userId, pattern.key, pattern.band, learned.name?.trim().slice(0, 500) || null, learned.categoryId]);
}

/** "Stop suggesting this": forgets the learned name of the pattern a location block came from. */
export async function forgetLearnedNameForEntry(client: Pick<pg.PoolClient, "query">, session: RequestSession, entryId: string) {
  const result = await client.query(
    `delete from location_name_patterns lnp
     using time_entries te
     join activity_events ae on ae.id = te.created_from_event_id and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
     where te.id = $3 and te.workspace_id = $1 and te.user_id = $2
       and lnp.workspace_id = $1 and lnp.user_id = $2
       and lnp.pattern_key = ae.raw_payload ->> 'namePatternKey' and lnp.band = ae.raw_payload ->> 'namePatternBand'`,
    [session.workspaceId, session.userId, entryId]);
  return result.rowCount ?? 0;
}
