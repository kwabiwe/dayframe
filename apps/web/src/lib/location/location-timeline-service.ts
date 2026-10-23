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
      distanceMeters: typeof leg.distanceMeters === "number" && Number.isFinite(leg.distanceMeters) ? Math.round(leg.distanceMeters) : null
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

export async function getLocationTimeline(
  session: RequestSession,
  options: { date: string; timeZone: string; now: Date }
): Promise<LocationTimeline> {
  const range = buildDashboardDateRange(options.date, options.timeZone);
  const nowIso = options.now.toISOString();
  const [stays, trips, blocks] = await Promise.all([
    query<{
      id: string; status: string; startedAt: Date; stoppedAt: Date | null; placeId: string | null; learnedPlaceId: string | null;
      placeName: string | null; placeRole: string | null; learnedName: string | null; matchKind: string | null; confidence: string;
    }>(
      `select s.client_segment_id as "id", s.status, s.started_at as "startedAt", s.stopped_at as "stoppedAt",
              s.place_id as "placeId", s.learned_place_id as "learnedPlaceId", p.name as "placeName", p.role as "placeRole",
              lp.name as "learnedName", s.metadata->>'placeMatchKind' as "matchKind", s.confidence
         from stay_segments s
         left join places p on p.id = s.place_id and p.workspace_id = s.workspace_id
         left join learned_places lp on lp.id = s.learned_place_id and lp.workspace_id = s.workspace_id
        where s.workspace_id = $1 and s.user_id = $2 and s.status <> 'superseded'
          and s.client_segment_id is not null
          and s.started_at < $4::timestamptz and coalesce(s.stopped_at, $5::timestamptz) > $3::timestamptz
        order by s.started_at, s.client_segment_id`,
      [session.workspaceId, session.userId, range.dayStart, range.dayEnd, nowIso]),
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
          and c.started_at < $4::timestamptz and c.stopped_at > $3::timestamptz
        order by c.started_at, c.client_segment_id`,
      [session.workspaceId, session.userId, range.dayStart, range.dayEnd]),
    // Blocks made from a location segment: its event names the segment (a correction names the one it corrected).
    query<{ segmentId: string; entryId: string }>(
      `select coalesce(case when ae.raw_payload ->> 'correction' = 'true' then ae.raw_payload ->> 'segmentId' end,
                       ae.raw_payload ->> 'clientSegmentId') as "segmentId", te.id as "entryId"
         from time_entries te
         join activity_events ae on ae.id = te.created_from_event_id
          and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
        where te.workspace_id = $1 and te.user_id = $2
          and te.started_at < $4::timestamptz and coalesce(te.stopped_at, $5::timestamptz) > $3::timestamptz
          and (ae.raw_payload ? 'clientSegmentId' or ae.raw_payload ? 'segmentId')`,
      [session.workspaceId, session.userId, range.dayStart, range.dayEnd, nowIso])
  ]);
  const blocksBySegment = new Map<string, string[]>();
  for (const row of blocks.rows) {
    if (row.segmentId) blocksBySegment.set(row.segmentId, [...(blocksBySegment.get(row.segmentId) ?? []), row.entryId]);
  }
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
    blockIds: blocksBySegment.get(row.id) ?? []
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
      blockIds: blocksBySegment.get(row.id) ?? []
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

/** The journey in progress when it overlaps the day and its latest observation is recent, read as bootstrap reads it. */
async function getTimelineOpenTrip(session: RequestSession, now: Date, dayStart: string, dayEnd: string): Promise<TimelineOpenTrip | null> {
  const result = await query<{ fromId: string; trip: Record<string, unknown> }>(
    `select sg.client_segment_id as "fromId", sg.metadata->'openTrip' as "trip"
       from stay_segments sg
      where sg.workspace_id = $1 and sg.user_id = $2 and sg.status <> 'superseded'
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
