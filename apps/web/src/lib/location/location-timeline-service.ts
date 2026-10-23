import {
  LOCATION_ENGINE_V2_CONFIG,
  type LocationTimeline,
  type TimelineGap,
  type TimelineOpenTrip,
  type TimelinePlace,
  type TimelineTrip,
  type TripLeg,
  type TripLegMode
} from "@dayframe/shared";
import { query } from "../db";
import { buildDashboardDateRange } from "../queries";
import { OPEN_TRIP_ORIGIN_LOOKBACK_MS } from "./open-trip-window";
import type { RequestSession } from "../session";

/**
 * The day's location timeline, read-only (location v4 §2, §14; build step 8): places (stays), trips
 * with their legs and stops, the journey in progress, and the gaps nothing covers. Never coordinates;
 * place names are the user's own. Mobile's bootstrap, time-entries and events contracts are unchanged. The
 * response types live in `@dayframe/shared` (`LocationTimeline`), for the web and the iPhone.
 */
export type { LocationTimeline, TimelineGap, TimelineOpenTrip, TimelinePlace, TimelineTrip };

/** Uncovered stretches shorter than this are not gaps (a trip's start is a few minutes after a stay ends). */
export const TIMELINE_GAP_MINIMUM_MS = 10 * 60_000;
const LEG_MODES: readonly TripLegMode[] = ["walking", "running", "cycling", "automotive", "bus", "train", "underground", "tram"];
const LEG_CONFIDENCE: readonly TripLeg["confidence"][] = ["sure", "likely", "unsure"];
const MATCH_KINDS: readonly TimelinePlace["matchKind"][] = ["saved", "learned", "unknown", "ambiguous"];
const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();

/** Stored legs rebuilt field by field: anything else a metadata blob holds never reaches a client. */
export function timelineLegs(value: unknown): TripLeg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): TripLeg[] => {
    const leg = raw as Record<string, unknown> | null;
    if (!leg || typeof leg.startedAt !== "string" || typeof leg.stoppedAt !== "string" ||
      !Number.isFinite(Date.parse(leg.startedAt)) || !Number.isFinite(Date.parse(leg.stoppedAt)) ||
      !LEG_MODES.includes(leg.mode as TripLegMode) || !LEG_CONFIDENCE.includes(leg.confidence as TripLeg["confidence"])) return [];
    return [{
      startedAt: new Date(leg.startedAt).toISOString(),
      stoppedAt: new Date(leg.stoppedAt).toISOString(),
      mode: leg.mode as TripLegMode,
      confidence: leg.confidence as TripLeg["confidence"],
      ...(LEG_MODES.includes(leg.runnerUp as TripLegMode) ? { runnerUp: leg.runnerUp as TripLegMode } : {}),
      ...(leg.unobserved === true ? { unobserved: true as const } : {}),
      distanceMeters: typeof leg.distanceMeters === "number" && Number.isFinite(leg.distanceMeters) ? Math.round(leg.distanceMeters) : null,
      ...(leg.setByYou === true ? { setByYou: true as const } : {})
    }];
  });
}

/** Stretches of [fromMs, toMs) no item covers, from `TIMELINE_GAP_MINIMUM_MS` long. */
export function timelineGaps(spans: ReadonlyArray<readonly [number, number]>, fromMs: number, toMs: number): TimelineGap[] {
  const sorted = spans.map(([a, b]) => [Math.max(a, fromMs), Math.min(b, toMs)] as const).filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const gaps: TimelineGap[] = [];
  let cursor = fromMs;
  const push = (a: number, b: number) => {
    if (b - a >= TIMELINE_GAP_MINIMUM_MS) gaps.push({ kind: "gap", startedAt: new Date(a).toISOString(), stoppedAt: new Date(b).toISOString() });
  };
  for (const [a, b] of sorted) {
    if (a > cursor) push(cursor, a);
    cursor = Math.max(cursor, b);
  }
  if (toMs > cursor) push(cursor, toMs);
  return gaps;
}

/** A stay shown on a day started at most this long before it (a longer stay is cut from the timeline). */
export const TIMELINE_STAY_LOOKBACK_MS = 31 * 24 * 60 * 60_000;
/** A location segment's event occurs within the segment; this much slack either side bounds the read. */
const SEGMENT_EVENT_SLACK_MS = 24 * 60 * 60_000;

/**
 * The user's blocks made from these segments, by client segment id, whatever day the blocks now sit on.
 * A block's event names its segment: `clientSegmentId`, or for a Review correction (`correction: true`)
 * the corrected part's row id (`segmentId`), mapped back to that row's client segment id. Read through the
 * segments' own events (which occur within them), so a block moved to another day keeps its link.
 */
async function blocksForSegments(
  session: RequestSession,
  stays: ReadonlyArray<{ id: string; rowId: string; startedAt: Date; stoppedAt: Date | null }>,
  trips: ReadonlyArray<{ id: string; startedAt: Date; stoppedAt: Date }>,
  nowIso: string
) {
  const blocksBySegment = new Map<string, string[]>();
  const spans = [...stays, ...trips];
  if (!spans.length) return blocksBySegment;
  const fromMs = Math.min(...spans.map((row) => new Date(row.startedAt).getTime())) - SEGMENT_EVENT_SLACK_MS;
  const toMs = Math.max(...spans.map((row) => row.stoppedAt ? new Date(row.stoppedAt).getTime() : Date.parse(nowIso))) + SEGMENT_EVENT_SLACK_MS;
  const clientIds = spans.map((row) => row.id);
  const rowIds = new Map(stays.map((row) => [row.rowId, row.id]));
  const result = await query<{ clientSegmentId: string | null; segmentId: string | null; correction: boolean; entryId: string }>(
    `select ae.raw_payload ->> 'clientSegmentId' as "clientSegmentId", ae.raw_payload ->> 'segmentId' as "segmentId",
            coalesce(ae.raw_payload ->> 'correction', '') = 'true' as "correction", te.id as "entryId"
       from activity_events ae
       join time_entries te on te.created_from_event_id = ae.id and te.workspace_id = ae.workspace_id and te.user_id = ae.user_id
      where ae.workspace_id = $1 and ae.user_id = $2
        and ae.occurred_at >= $3::timestamptz and ae.occurred_at <= $4::timestamptz
        and (ae.raw_payload ->> 'clientSegmentId' = any($5::text[]) or ae.raw_payload ->> 'segmentId' = any($6::text[]))
      order by te.started_at, te.id`,
    [session.workspaceId, session.userId, new Date(fromMs).toISOString(), new Date(toMs).toISOString(), clientIds, [...rowIds.keys()]]);
  const shown = new Set(clientIds);
  for (const row of result.rows) {
    const segment = row.correction ? (row.segmentId ? rowIds.get(row.segmentId) : undefined) : row.clientSegmentId ?? undefined;
    if (segment && shown.has(segment)) blocksBySegment.set(segment, [...(blocksBySegment.get(segment) ?? []), row.entryId]);
  }
  return blocksBySegment;
}

export async function getLocationTimeline(
  session: RequestSession,
  options: { date: string; timeZone: string; now: Date }
): Promise<LocationTimeline> {
  const range = buildDashboardDateRange(options.date, options.timeZone);
  const nowIso = options.now.toISOString();
  // Bounded reads (Codex r1 on #564): a stay shown on this day started at most `TIMELINE_STAY_LOOKBACK_MS`
  // before it, and a trip at most the longest journey before it.
  const staysFrom = new Date(Date.parse(range.dayStart) - TIMELINE_STAY_LOOKBACK_MS).toISOString();
  const tripsFrom = new Date(Date.parse(range.dayStart) - LOCATION_ENGINE_V2_CONFIG.commuteMaximumDurationMs).toISOString();
  const [stays, trips] = await Promise.all([
    query<{
      id: string; rowId: string; status: string; startedAt: Date; stoppedAt: Date | null; placeId: string | null; learnedPlaceId: string | null;
      placeName: string | null; placeRole: string | null; learnedName: string | null; matchKind: string | null; confidence: string;
      setByYou: boolean;
    }>(
      `select s.client_segment_id as "id", s.id as "rowId", s.status, s.started_at as "startedAt", s.stopped_at as "stoppedAt",
              s.place_id as "placeId", s.learned_place_id as "learnedPlaceId", p.name as "placeName", p.role as "placeRole",
              lp.name as "learnedName", s.metadata->>'placeMatchKind' as "matchKind", s.confidence,
              coalesce((s.metadata->>'setByYou')::boolean, false) as "setByYou"
         from stay_segments s
         left join places p on p.id = s.place_id and p.workspace_id = s.workspace_id
         left join learned_places lp on lp.id = s.learned_place_id and lp.workspace_id = s.workspace_id
        where s.workspace_id = $1 and s.user_id = $2 and s.status <> 'superseded'
          and s.client_segment_id is not null
          and s.started_at >= $6::timestamptz and s.started_at < $4::timestamptz
          and coalesce(s.stopped_at, $5::timestamptz) > $3::timestamptz
        order by s.started_at, s.client_segment_id`,
      [session.workspaceId, session.userId, range.dayStart, range.dayEnd, nowIso, staysFrom]),
    query<{
      id: string; status: string; startedAt: Date; stoppedAt: Date; fromId: string; toId: string; confidence: string;
      distance: number | null; metadata: Record<string, unknown>;
    }>(
      `select c.client_segment_id as "id", c.status, c.started_at as "startedAt", c.stopped_at as "stoppedAt",
              fs.client_segment_id as "fromId", ts.client_segment_id as "toId", c.confidence,
              c.route_distance_m as "distance", c.metadata
         from commute_segments c
         join stay_segments fs on fs.id = c.from_stay_segment_id
         join stay_segments ts on ts.id = c.to_stay_segment_id
        where c.workspace_id = $1 and c.user_id = $2 and c.status <> 'superseded'
          and c.started_at >= $5::timestamptz and c.started_at < $4::timestamptz and c.stopped_at > $3::timestamptz
        order by c.started_at, c.client_segment_id`,
      [session.workspaceId, session.userId, range.dayStart, range.dayEnd, tripsFrom])
  ]);
  const blocksBySegment = await blocksForSegments(session, stays.rows, trips.rows, nowIso);
  const placeItems = stays.rows.map((row): TimelinePlace => ({
    kind: "place",
    id: row.id,
    status: row.status,
    startedAt: iso(row.startedAt)!,
    stoppedAt: iso(row.stoppedAt),
    placeId: row.placeId,
    learnedPlaceId: row.learnedPlaceId,
    name: row.placeName ?? row.learnedName ?? null,
    role: row.placeId ? row.placeRole : null,
    matchKind: MATCH_KINDS.includes(row.matchKind as TimelinePlace["matchKind"]) ? row.matchKind as TimelinePlace["matchKind"]
      : row.placeId ? "saved" : row.learnedPlaceId ? "learned" : "unknown",
    confidence: row.confidence,
    blockIds: blocksBySegment.get(row.id) ?? [],
    ...(row.setByYou ? { setByYou: true as const } : {})
  }));
  const tripItems = trips.rows.map((row): TimelineTrip => {
    const stops = Array.isArray(row.metadata?.stops) ? row.metadata.stops as Array<Record<string, unknown>> : [];
    return {
      kind: "trip",
      id: row.id,
      status: row.status,
      startedAt: iso(row.startedAt)!,
      stoppedAt: iso(row.stoppedAt)!,
      fromId: row.fromId,
      toId: row.toId,
      mode: typeof row.metadata?.travelMode === "string" ? row.metadata.travelMode : null,
      legs: timelineLegs(row.metadata?.legs),
      stopIds: stops.flatMap((stop) => typeof stop.staySegmentId === "string" ? [stop.staySegmentId] : []),
      distanceMeters: row.distance == null ? null : Math.round(row.distance),
      confidence: row.confidence,
      reason: typeof row.metadata?.qualificationReason === "string" ? row.metadata.qualificationReason : null,
      blockIds: blocksBySegment.get(row.id) ?? [],
      ...(row.metadata?.setByYou === true ? { setByYou: true as const } : {})
    };
  });
  const openTrip = await getTimelineOpenTrip(session, options.now, range.dayStart, range.dayEnd);
  const items = [...placeItems, ...tripItems].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) ||
    a.kind.localeCompare(b.kind));
  const nowMs = options.now.getTime();
  const spans = [
    ...items.map((item) => [Date.parse(item.startedAt), item.stoppedAt ? Date.parse(item.stoppedAt) : nowMs] as const),
    ...(openTrip ? [[Date.parse(openTrip.startedAt), nowMs] as const] : [])
  ];
  return {
    date: range.selectedDate,
    timeZone: options.timeZone,
    dayStart: range.dayStart,
    dayEnd: range.dayEnd,
    items,
    openTrip,
    gaps: timelineGaps(spans, Date.parse(range.dayStart), Math.min(Date.parse(range.dayEnd), nowMs))
  };
}

/**
 * The journey in progress when it overlaps the day and its latest observation is recent, read as bootstrap
 * reads it: whatever its origin stay's status, since an older replay can supersede that stay while keeping
 * the newer journey (Codex r1 on #564).
 */
async function getTimelineOpenTrip(session: RequestSession, now: Date, dayStart: string, dayEnd: string): Promise<TimelineOpenTrip | null> {
  const result = await query<{ fromId: string; trip: Record<string, unknown> }>(
    `select sg.client_segment_id as "fromId", sg.metadata->'openTrip' as "trip"
       from stay_segments sg
      where sg.workspace_id = $1 and sg.user_id = $2
        and sg.started_at >= $3::timestamptz - make_interval(secs => $5::double precision / 1000)
        and sg.metadata -> 'openTrip' ? 'startedAt'
        and (sg.metadata -> 'openTrip' ->> 'lastObservedAt')::timestamptz >= $3::timestamptz - make_interval(secs => $4::double precision / 1000)
      order by sg.metadata->'openTrip'->>'lastObservedAt' desc
      limit 1`,
    [session.workspaceId, session.userId, now.toISOString(), LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs, OPEN_TRIP_ORIGIN_LOOKBACK_MS]);
  const row = result.rows[0];
  const startedAt = typeof row?.trip?.startedAt === "string" ? Date.parse(row.trip.startedAt) : NaN;
  const lastObservedAt = typeof row?.trip?.lastObservedAt === "string" ? Date.parse(row.trip.lastObservedAt) : NaN;
  if (!row || !Number.isFinite(startedAt) || !Number.isFinite(lastObservedAt)) return null;
  if (now.getTime() - lastObservedAt > LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs) return null;
  if (!(startedAt < Date.parse(dayEnd) && now.getTime() > Date.parse(dayStart))) return null;
  return {
    kind: "open_trip",
    fromId: row.fromId,
    startedAt: new Date(startedAt).toISOString(),
    lastObservedAt: new Date(lastObservedAt).toISOString(),
    mode: typeof row.trip.travelMode === "string" ? row.trip.travelMode : null,
    legs: timelineLegs(row.trip.legs)
  };
}
