import type pg from "pg";
import type { RequestSession } from "../session";

/**
 * Named patterns on Today and Calendar (location v3 PR 14, PRD D19 A9). Display only: blocks stay
 * separate in storage, Reports and exports. A Move into a Stay and the Move out of it back to where
 * it started (A → B → A), all logged, all within three hours, whose Stay the person has named (a
 * learned name they gave it, `location_name_patterns` with uses), are tagged with one group key,
 * the name and how many parts it has; clients show it as one row ("School run · 36m") only while
 * every part sits next to the others. Nothing else groups.
 *
 * A Stay corrected in Review (split or merged) is a new segment: its block stands for the stays it
 * came from (a split's parent, a merge's originals), which the Moves either side still name. The
 * Stay blocks that stand for the same stays form one middle; a split Stay's two parts both join,
 * and only together: every part meets the next.
 */
export type LocationGroup = { key: string; name: string; parts: number };

export const LOCATION_GROUP_MAX_SPAN_MS = 3 * 60 * 60 * 1000;
/**
 * How closely a named trip's parts must meet. Below the shortest part a Review split can leave (one
 * minute), so a missing part always shows as a gap (Codex r3 on #501); engine blocks meet exactly.
 */
export const LOCATION_GROUP_JOIN_TOLERANCE_MS = 30_000;
/** Two ends of a trip at an unsaved place count as the same place within this distance. */
export const LOCATION_GROUP_SAME_END_METERS = 150;

const LOCATION_SOURCES = ["location_learning", "location_auto_log"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Corrections of corrections a block is followed back through (Codex r2 on #501). */
export const LINEAGE_MAX_DEPTH = 8;

/**
 * The client segment ids each corrected segment ($3, uuids) stands for: itself and its ancestors
 * through `parent_segment_id` and a merge's `metadata.mergedSegmentIds`, all this person's ($1, $2).
 */
export const STAY_LINEAGE_SQL = `with recursive lineage(root, id, depth) as (
    select s.id, s.id, 0
      from stay_segments s
     where s.workspace_id = $1 and s.user_id = $2 and s.id = any($3::uuid[])
    union
    select lineage.root, ancestor.id, lineage.depth + 1
      from lineage
      join stay_segments child on child.id = lineage.id and child.workspace_id = $1 and child.user_id = $2
      cross join lateral (
        select child.parent_segment_id as id where child.parent_segment_id is not null
        union
        select original::uuid
          from jsonb_array_elements_text(coalesce(child.metadata -> 'mergedSegmentIds', '[]'::jsonb)) original
         where original ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) ancestor
     where lineage.depth < ${LINEAGE_MAX_DEPTH}
  )
  select lineage.root::text as id,
         array_agg(distinct segment.client_segment_id) filter (where segment.client_segment_id is not null) as covers
    from lineage
    join stay_segments segment on segment.id = lineage.id and segment.workspace_id = $1 and segment.user_id = $2
   group by lineage.root`;

type EntryLike = { id: string; source: string; startedAt: string | Date; stoppedAt: string | Date | null };

type BlockRow = {
  id: string;
  eventType: string | null;
  segmentId: string | null;
  correctedSegmentId: string | null;
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
  /** A Stay: the client segment ids it stands for (itself, or the stays a correction came from). */
  covers: string[];
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
            case when ae.raw_payload ->> 'correction' = 'true' then ae.raw_payload ->> 'segmentId' end as "correctedSegmentId",
            ae.raw_payload ->> 'fromStaySegmentId' as "fromStay",
            ae.raw_payload ->> 'toStaySegmentId' as "toStay",
            ae.raw_payload ->> 'namePatternKey' as "patternKey"
       from time_entries te
       join activity_events ae on ae.id = te.created_from_event_id
        and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
      where te.workspace_id = $1 and te.user_id = $2 and te.id = any($3::uuid[])`,
    [session.workspaceId, session.userId, [...candidates.keys()]]
  );
  const stayRows = blocks.rows.filter(isStayRow);
  const stayKeys = [...new Set(stayRows.flatMap((row) => row.patternKey ? [row.patternKey] : []))];
  const moveEnds = [...new Set(blocks.rows.filter((row) => !isStayRow(row)).flatMap((row) => [row.fromStay, row.toStay])
    .filter((value): value is string => Boolean(value)))];
  if (stayKeys.length === 0 || moveEnds.length === 0) return new Map<string, LocationGroup>();

  // In turn: callers may pass one transaction client, which runs one query at a time.
  // The name the person has used most for each pattern, ties to the latest used (then by band).
  const names = await db.query<{ patternKey: string; name: string }>(
    `select distinct on (pattern_key) pattern_key as "patternKey", name
       from location_name_patterns
      where workspace_id = $1 and user_id = $2 and pattern_key = any($3::text[])
        and name is not null and uses > 0
      order by pattern_key, uses desc, last_used_at desc nulls last, band`,
    [session.workspaceId, session.userId, stayKeys]
  );
  // A corrected Stay's segment and every stay it came from, however many corrections ago (a
  // split's parent, a merge's originals, then theirs), as the Moves name them. Each step reads one
  // of this person's segments by primary key, at most LINEAGE_MAX_DEPTH steps from the block.
  const correctedIds = [...new Set(stayRows.flatMap((row) => row.correctedSegmentId && UUID.test(row.correctedSegmentId)
    ? [row.correctedSegmentId.toLowerCase()] : []))];
  const corrected = correctedIds.length === 0
    ? { rows: [] as { id: string; covers: string[] | null }[] }
    : await db.query<{ id: string; covers: string[] | null }>(STAY_LINEAGE_SQL, [session.workspaceId, session.userId, correctedIds]);
  // The Moves' ends, by owner and client segment id (`idx_stay_segments_owner_client`).
  const ends = await db.query<StayEndRow>(
    `select client_segment_id as "segmentId", place_id as "placeId", learned_place_id as "learnedPlaceId",
            case when centre is null then null else ST_Y(centre::geometry) end as latitude,
            case when centre is null then null else ST_X(centre::geometry) end as longitude
       from stay_segments
      where workspace_id = $1 and user_id = $2 and client_segment_id = any($3::text[])`,
    [session.workspaceId, session.userId, moveEnds]
  );

  const nameByKey = new Map(names.rows.map((row) => [row.patternKey, row.name] as const));
  const coversById = new Map(corrected.rows.map((row) => [row.id.toLowerCase(), row.covers ?? []] as const));
  const endBySegment = new Map(ends.rows.map((row) => [row.segmentId, row] as const));
  const input: LocationGroupBlock[] = blocks.rows.flatMap((row) => {
    const entry = candidates.get(row.id);
    if (!entry?.stoppedAt) return [];
    const stay = isStayRow(row);
    const covers = !stay ? [] : row.correctedSegmentId ? coversById.get(row.correctedSegmentId.toLowerCase()) ?? [] : row.segmentId ? [row.segmentId] : [];
    return [{
      id: row.id,
      kind: stay ? "stay" as const : "move" as const,
      startedAtMs: new Date(entry.startedAt).getTime(),
      stoppedAtMs: new Date(entry.stoppedAt).getTime(),
      covers,
      fromStay: row.fromStay,
      toStay: row.toStay,
      name: stay && row.patternKey ? nameByKey.get(row.patternKey) ?? null : null
    }];
  });
  return groupNamedPatterns(input, (segmentId) => endBySegment.get(segmentId) ?? null);
}

function isStayRow(row: Pick<BlockRow, "eventType">) {
  return row.eventType !== "commute_detected";
}

/**
 * Pure: the A → B → A chains around a named Stay. Stay blocks that stand for a shared stay are one
 * middle (a split's two parts, or a merge standing for both originals); the Move into it and the
 * Move out of it must be unique, back to the same place, meet it (LOCATION_GROUP_JOIN_TOLERANCE_MS),
 * and all within three hours.
 */
export function groupNamedPatterns(blocks: LocationGroupBlock[], endOf: (segmentId: string) => StayEnd | null) {
  const groups = new Map<string, LocationGroup>();
  const moves = blocks.filter((block) => block.kind === "move");
  const stays = blocks.filter((block) => block.kind === "stay" && block.covers.length > 0)
    .sort((left, right) => left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id));
  const used = new Set<string>();
  for (const seed of stays) {
    if (used.has(seed.id)) continue;
    // Every Stay block standing for one of the same stays, transitively.
    const middle = [seed];
    const covered = new Set(seed.covers);
    for (let grown = true; grown;) {
      grown = false;
      for (const stay of stays) {
        if (middle.includes(stay) || !stay.covers.some((id) => covered.has(id))) continue;
        middle.push(stay);
        for (const id of stay.covers) covered.add(id);
        grown = true;
      }
    }
    for (const stay of middle) used.add(stay.id);
    middle.sort((left, right) => left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id));
    const name = middle.find((stay) => stay.name)?.name;
    if (!name) continue;
    const into = moves.filter((move) => move.toStay !== null && covered.has(move.toStay));
    const outOf = moves.filter((move) => move.fromStay !== null && covered.has(move.fromStay));
    // One Move each way, or the chain is ambiguous and nothing groups.
    if (into.length !== 1 || outOf.length !== 1 || into[0] === outOf[0]) continue;
    const [there, back] = [into[0], outOf[0]];
    const first = middle[0];
    // Every part is here: each block meets the next, so a deleted or unlogged part (a split's other
    // half) leaves the trip ungrouped rather than a smaller group (Codex r2–r3 on #501).
    const parts = [there, ...middle, back];
    if (parts.some((part, index) => index > 0
      && Math.abs(part.startedAtMs - parts[index - 1].stoppedAtMs) > LOCATION_GROUP_JOIN_TOLERANCE_MS)) continue;
    if (back.stoppedAtMs - there.startedAtMs > LOCATION_GROUP_MAX_SPAN_MS) continue;
    if (!there.fromStay || !back.toStay || !sameEnd(endOf(there.fromStay), endOf(back.toStay))) continue;
    if (parts.some((block) => groups.has(block.id))) continue;
    const group = { key: `named:${first.id}`, name, parts: parts.length };
    for (const block of parts) groups.set(block.id, group);
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
