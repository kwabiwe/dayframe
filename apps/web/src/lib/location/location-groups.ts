import type pg from "pg";
import type { RequestSession } from "../session";

/**
 * Named patterns on Today and Calendar (location v3 PR 14, PRD D19 A9). Display only: blocks stay
 * separate in storage, Reports and exports. A Move into a Stay and the Move out of it back to where
 * it started (A → B → A), all logged, all within three hours, whose Stay the person has named (a
 * learned name they gave it, `location_name_patterns` with uses), are tagged with one group key and
 * the name; clients show adjacent members as one row ("School run · 36m"). Nothing else groups.
 */
export type LocationGroup = { key: string; name: string };

export const LOCATION_GROUP_MAX_SPAN_MS = 3 * 60 * 60 * 1000;
/** Two ends of a trip at an unsaved place count as the same place within this distance. */
export const LOCATION_GROUP_SAME_END_METERS = 150;

const LOCATION_SOURCES = ["location_learning", "location_auto_log"];

type EntryLike = { id: string; source: string; startedAt: string | Date; stoppedAt: string | Date | null };

type BlockRow = {
  id: string;
  eventType: string | null;
  segmentId: string | null;
  fromStay: string | null;
  toStay: string | null;
  patternKey: string | null;
};

type StayEndRow = {
  segmentId: string;
  placeId: string | null;
  learnedPlaceId: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type LocationGroupBlock = {
  id: string;
  kind: "stay" | "move";
  startedAtMs: number;
  stoppedAtMs: number;
  segmentId: string | null;
  fromStay: string | null;
  toStay: string | null;
  name: string | null;
};

export type StayEnd = { placeId: string | null; learnedPlaceId: string | null; latitude: number | null; longitude: number | null };

/** A pool's `query` or one client (its reads here run one at a time). */
type Queryable = { query<T extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }> };

/** The group of each member block, by entry id (blocks outside a named A → B → A have none). */
export async function getLocationGroups(db: Queryable, session: RequestSession, entries: EntryLike[]) {
  const candidates = new Map<string, EntryLike>();
  for (const entry of entries) {
    if (entry.stoppedAt && LOCATION_SOURCES.includes(entry.source)) candidates.set(entry.id, entry);
  }
  if (candidates.size === 0) return new Map<string, LocationGroup>();

  const blocks = await db.query<BlockRow>(
    `select te.id,
            ae.event_type as "eventType",
            ae.raw_payload ->> 'clientSegmentId' as "segmentId",
            ae.raw_payload ->> 'fromStaySegmentId' as "fromStay",
            ae.raw_payload ->> 'toStaySegmentId' as "toStay",
            ae.raw_payload ->> 'namePatternKey' as "patternKey"
       from time_entries te
       join activity_events ae on ae.id = te.created_from_event_id
        and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
      where te.workspace_id = $1 and te.user_id = $2 and te.id = any($3::uuid[])`,
    [session.workspaceId, session.userId, [...candidates.keys()]]
  );
  const stayKeys = [...new Set(blocks.rows.filter(isStayRow).flatMap((row) => row.patternKey ? [row.patternKey] : []))];
  const moveEnds = [...new Set(blocks.rows.filter((row) => !isStayRow(row)).flatMap((row) => [row.fromStay, row.toStay])
    .filter((value): value is string => Boolean(value)))];
  if (stayKeys.length === 0 || moveEnds.length === 0) return new Map<string, LocationGroup>();

  // In turn: callers may pass one transaction client, which runs one query at a time.
  const names = await db.query<{ patternKey: string; name: string; uses: number }>(
    `select pattern_key as "patternKey", name, uses
       from location_name_patterns
      where workspace_id = $1 and user_id = $2 and pattern_key = any($3::text[])
        and name is not null and uses > 0`,
    [session.workspaceId, session.userId, stayKeys]
  );
  const ends = await db.query<StayEndRow>(
    `select client_segment_id as "segmentId", place_id as "placeId", learned_place_id as "learnedPlaceId",
            case when centre is null then null else ST_Y(centre::geometry) end as latitude,
            case when centre is null then null else ST_X(centre::geometry) end as longitude
       from stay_segments
      where workspace_id = $1 and user_id = $2 and client_segment_id = any($3::text[])`,
    [session.workspaceId, session.userId, moveEnds]
  );

  // The name the person has used most for the pattern, across time-of-day bands.
  const nameByKey = new Map<string, { name: string; uses: number }>();
  for (const row of names.rows) {
    const current = nameByKey.get(row.patternKey);
    if (!current || row.uses > current.uses) nameByKey.set(row.patternKey, { name: row.name, uses: row.uses });
  }
  const endBySegment = new Map(ends.rows.map((row) => [row.segmentId, row] as const));
  const input: LocationGroupBlock[] = blocks.rows.flatMap((row) => {
    const entry = candidates.get(row.id);
    if (!entry?.stoppedAt) return [];
    const stay = isStayRow(row);
    return [{
      id: row.id,
      kind: stay ? "stay" as const : "move" as const,
      startedAtMs: new Date(entry.startedAt).getTime(),
      stoppedAtMs: new Date(entry.stoppedAt).getTime(),
      segmentId: row.segmentId,
      fromStay: row.fromStay,
      toStay: row.toStay,
      name: stay && row.patternKey ? nameByKey.get(row.patternKey)?.name ?? null : null
    }];
  });
  return groupNamedPatterns(input, (segmentId) => endBySegment.get(segmentId) ?? null);
}

function isStayRow(row: BlockRow) {
  return row.eventType !== "commute_detected";
}

/** Pure: the A → B → A chains around a named Stay, each member keyed by the Stay's block. */
export function groupNamedPatterns(blocks: LocationGroupBlock[], endOf: (segmentId: string) => StayEnd | null) {
  const groups = new Map<string, LocationGroup>();
  const moves = blocks.filter((block) => block.kind === "move");
  for (const stay of blocks) {
    if (stay.kind !== "stay" || !stay.name || !stay.segmentId) continue;
    const into = moves.filter((move) => move.toStay === stay.segmentId);
    const outOf = moves.filter((move) => move.fromStay === stay.segmentId);
    // One Move each way, or the chain is ambiguous and nothing groups.
    if (into.length !== 1 || outOf.length !== 1) continue;
    const [there, back] = [into[0], outOf[0]];
    if (there.stoppedAtMs > stay.startedAtMs + 60_000 || back.startedAtMs < stay.stoppedAtMs - 60_000) continue;
    if (back.stoppedAtMs - there.startedAtMs > LOCATION_GROUP_MAX_SPAN_MS) continue;
    if (!there.fromStay || !back.toStay || !sameEnd(endOf(there.fromStay), endOf(back.toStay))) continue;
    if ([there, stay, back].some((block) => groups.has(block.id))) continue;
    const group = { key: `named:${stay.id}`, name: stay.name };
    for (const block of [there, stay, back]) groups.set(block.id, group);
  }
  return groups;
}

/** The two ends of an A → B → A are one place: the same saved or learned place, or (unsaved) close. */
export function sameEnd(left: StayEnd | null, right: StayEnd | null) {
  if (!left || !right) return false;
  if (left.placeId || right.placeId) return left.placeId === right.placeId;
  if (left.learnedPlaceId || right.learnedPlaceId) return left.learnedPlaceId === right.learnedPlaceId;
  if (left.latitude === null || left.longitude === null || right.latitude === null || right.longitude === null) return false;
  return metresBetween(left, right) <= LOCATION_GROUP_SAME_END_METERS;
}

function metresBetween(left: StayEnd, right: StayEnd) {
  const radians = Math.PI / 180;
  const dLat = (right.latitude! - left.latitude!) * radians;
  const dLng = (right.longitude! - left.longitude!) * radians;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(left.latitude! * radians) * Math.cos(right.latitude! * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Adds each entry's group (only members of a named A → B → A carry one). */
export function withLocationGroups<T extends { id: string }>(entries: T[], groups: Map<string, LocationGroup>) {
  return entries.map((entry) => {
    const group = groups.get(entry.id);
    return group ? { ...entry, locationGroup: group } : entry;
  });
}
