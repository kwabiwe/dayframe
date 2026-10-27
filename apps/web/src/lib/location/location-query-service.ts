import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationReviewEvidenceDtoSchema,
  TimelineItemEvidenceDtoSchema,
  type TimelineItemEvidenceDto,
  MotionTravelModeSchema,
  type LocationReviewEvidenceDto
} from "@dayframe/shared";
import { query } from "../db";
import type { RequestSession } from "../session";
import { placeDisplayNameSql } from "../place-display";

type ReviewSegmentRow = {
  /** Null for a timeline item with no open Review item (step 12). */
  reviewItemId: string | null;
  venuePlaceId?: string | null;
  suggestedVenuePlaceId?: string | null;
  eventId: string | null;
  title: string;
  notes: string | null;
  placeId: string | null;
  placeName: string | null;
  addressSummary: string | null;
  deviceId: string | null;
  stayId: string | null;
  commuteId: string | null;
  placeMatchKind: string | null;
  approximateArrival: boolean;
  status: string;
  startedAt: Date | string;
  stoppedAt: Date | string | null;
  startLowerBoundAt: Date | string | null;
  startUpperBoundAt: Date | string | null;
  stopLowerBoundAt: Date | string | null;
  stopUpperBoundAt: Date | string | null;
  centreLongitude: number | null;
  centreLatitude: number | null;
  radiusMeters: number | null;
  confidence: string;
  continuityStatus: string;
  algorithmVersion: string;
  fromLongitude: number | null;
  fromLatitude: number | null;
  toLongitude: number | null;
  toLatitude: number | null;
  tripStops: unknown;
  travelMode: string | null;
  timeAway: boolean;
};

type RejectedEvidenceRow = {
  clientEvidenceId: string;
  kind: string;
  occurredAt: Date | string;
  longitude: number | null;
  latitude: number | null;
  rejectionReason: string;
  expiresAt: Date | string;
};

type EvidenceMapRow = {
  id: string;
  clientEvidenceId: string;
  kind: string;
  occurredAt: Date | string;
  endedAt: Date | string | null;
  longitude: number | null;
  latitude: number | null;
  accuracyMeters: number | null;
  role: string;
  expiresAt: Date | string;
};

type NearbyPlaceRow = {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  radiusMeters: number;
  distanceMeters: number;
};

export class LocationEvidenceNotFoundError extends Error {
  status = 404;
}

type LocationEvidenceTimings = {
  reviewLookupMs?: number;
  acceptedEvidenceMs?: number;
  rejectedEvidenceMs?: number;
  nearbyPlacesMs?: number;
  venueHistoryMs?: number;
  assemblyMs?: number;
  totalMs?: number;
};

const SLOW_LOCATION_EVIDENCE_REQUEST_MS = 750;

const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();
const point = (longitude: number | null, latitude: number | null) =>
  longitude == null || latitude == null
    ? null
    : { type: "Point" as const, coordinates: [longitude, latitude] as [number, number] };

export async function getLocationReviewEvidence(
  reviewItemId: string,
  session: RequestSession
): Promise<LocationReviewEvidenceDto> {
  const startedAt = Date.now();
  const timings: LocationEvidenceTimings = {};
  try {
    const result = await buildLocationReviewEvidence(
      reviewItemId,
      session,
      timings
    );
    timings.totalMs = Date.now() - startedAt;
    logLocationEvidenceTiming(timings, result, null);
    return result;
  } catch (error) {
    timings.totalMs = Date.now() - startedAt;
    logLocationEvidenceTiming(timings, null, error);
    throw error;
  }
}

/**
 * The segment columns the evidence is built from, for a Review item's segment (`st`, `cs`) or a timeline item's
 * (step 12): place, times, bounds, centre, the trip's ends, stops and mode.
 */
const SEGMENT_COLUMNS = `coalesce(st.place_id, cs.from_place_id) as "placeId",
            ${placeDisplayNameSql("pl")} as "placeName",
            null::text as "addressSummary",
            coalesce(st.device_id, cs.device_id) as "deviceId",
            st.id as "stayId",
            cs.id as "commuteId",
            st.metadata->>'placeMatchKind' as "placeMatchKind",
            coalesce((st.metadata->>'approximateArrival')::boolean, false) as "approximateArrival",
            coalesce(st.status, cs.status) as status,
            coalesce(st.started_at, cs.started_at) as "startedAt",
            coalesce(st.stopped_at, cs.stopped_at) as "stoppedAt",
            coalesce(st.start_lower_bound_at, cs.start_lower_bound_at) as "startLowerBoundAt",
            coalesce(st.start_upper_bound_at, cs.start_upper_bound_at) as "startUpperBoundAt",
            coalesce(st.stop_lower_bound_at, cs.stop_lower_bound_at) as "stopLowerBoundAt",
            coalesce(st.stop_upper_bound_at, cs.stop_upper_bound_at) as "stopUpperBoundAt",
            case when st.centre is null then null else ST_X(st.centre::geometry) end as "centreLongitude",
            case when st.centre is null then null else ST_Y(st.centre::geometry) end as "centreLatitude",
            st.radius_m as "radiusMeters",
            st.venue_place_id as "venuePlaceId",
            st.suggested_venue_place_id as "suggestedVenuePlaceId",
            coalesce(st.confidence, cs.confidence) as confidence,
            coalesce(st.continuity_status, cs.continuity_status, 'unknown') as "continuityStatus",
            coalesce(st.algorithm_version, cs.algorithm_version, 'unknown') as "algorithmVersion",
            case when from_stay.centre is null then null else ST_X(from_stay.centre::geometry) end as "fromLongitude",
            case when from_stay.centre is null then null else ST_Y(from_stay.centre::geometry) end as "fromLatitude",
            case when to_stay.centre is null then null else ST_X(to_stay.centre::geometry) end as "toLongitude",
            case when to_stay.centre is null then null else ST_Y(to_stay.centre::geometry) end as "toLatitude",
            cs.metadata->'stops' as "tripStops",
            cs.metadata->>'travelMode' as "travelMode",
            coalesce(cs.metadata->>'qualificationReason' = 'same_place_outing', false) as "timeAway"`;

/** The trip's two stays and the place, scoped to the owner (`$1` workspace, `$2` user). */
const SEGMENT_JOINS = `     left join stay_segments from_stay
       on from_stay.id = cs.from_stay_segment_id
      and from_stay.workspace_id = $1 and from_stay.user_id = $2
     left join stay_segments to_stay
       on to_stay.id = cs.to_stay_segment_id
      and to_stay.workspace_id = $1 and to_stay.user_id = $2
     left join places pl
       on pl.id = coalesce(st.place_id, cs.from_place_id) and pl.workspace_id = $1`;

async function buildLocationReviewEvidence(
  reviewItemId: string,
  session: RequestSession,
  timings: LocationEvidenceTimings
): Promise<LocationReviewEvidenceDto> {
  const reviewLookupStartedAt = Date.now();
  const reviewResult = await query<ReviewSegmentRow>(
    `select ri.id as "reviewItemId",
            ri.event_id as "eventId",
            ri.title,
            ri.notes,
            ${SEGMENT_COLUMNS}
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join stay_segments st
       on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs
       on cs.id = ri.location_segment_id and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     ${SEGMENT_JOINS}
     where ri.id = $3 and ri.workspace_id = $1 and ri.user_id = $2
       and (st.id is not null or cs.id is not null)
     limit 1`,
    [session.workspaceId, session.userId, reviewItemId]
  );
  timings.reviewLookupMs = Date.now() - reviewLookupStartedAt;
  const review = reviewResult.rows[0];
  if (!review) throw new LocationEvidenceNotFoundError("Location review evidence was not found.");
  const dto = await assembleSegmentEvidence(review, session, timings);
  const assemblyStartedAt = Date.now();
  const parsed = LocationReviewEvidenceDtoSchema.parse(dto);
  timings.assemblyMs = (timings.assemblyMs ?? 0) + Date.now() - assemblyStartedAt;
  return parsed;
}

/**
 * A timeline item's evidence (location v4 step 12): the map for the correction sheets, found by the item the
 * timeline names (its client segment id; never a superseded segment), with no Review item needed. Its open
 * Review item and event come along when it has them.
 */
export async function getTimelineItemEvidence(itemId: string, session: RequestSession): Promise<TimelineItemEvidenceDto> {
  const startedAt = Date.now();
  const timings: LocationEvidenceTimings = {};
  try {
    const lookupStartedAt = Date.now();
    const found = await query<ReviewSegmentRow>(
      `select open_ri.id as "reviewItemId",
              coalesce(st.created_from_event_id, cs.created_from_event_id) as "eventId",
              coalesce(${placeDisplayNameSql("pl")}, case when st.id is not null then 'Unknown place' else 'Trip' end) as title,
              null::text as notes,
              ${SEGMENT_COLUMNS}
       from (select $3::text as item) wanted
       left join stay_segments st
         on st.workspace_id = $1 and st.user_id = $2 and st.client_segment_id = wanted.item and st.status <> 'superseded'
       left join commute_segments cs
         on st.id is null and cs.workspace_id = $1 and cs.user_id = $2 and cs.client_segment_id = wanted.item and cs.status <> 'superseded'
       ${SEGMENT_JOINS}
       left join lateral (
         select ri.id from review_items ri
          where ri.workspace_id = $1 and ri.user_id = $2 and ri.location_segment_id = coalesce(st.id, cs.id) and ri.status = 'open'
          order by ri.created_at desc
          limit 1
       ) open_ri on true
       where st.id is not null or cs.id is not null
       order by coalesce(st.updated_at, cs.updated_at) desc
       limit 1`,
      [session.workspaceId, session.userId, itemId]
    );
    timings.reviewLookupMs = Date.now() - lookupStartedAt;
    const segment = found.rows[0];
    if (!segment) throw new LocationEvidenceNotFoundError("That place or trip is no longer in your day.");
    const dto = await assembleSegmentEvidence(segment, session, timings);
    const result = TimelineItemEvidenceDtoSchema.parse({ ...dto, itemId });
    timings.totalMs = Date.now() - startedAt;
    logLocationEvidenceTiming(timings, result, null);
    return result;
  } catch (error) {
    timings.totalMs = Date.now() - startedAt;
    logLocationEvidenceTiming(timings, null, error);
    throw error;
  }
}

/** A segment's evidence for the map, whichever way it was found (a Review item, or a timeline item). */
async function assembleSegmentEvidence(review: ReviewSegmentRow, session: RequestSession, timings: LocationEvidenceTimings) {
  const kind = review.stayId ? "stay" as const : "commute" as const;
  const centre = point(review.centreLongitude, review.centreLatitude);
  const [evidenceResult, rejectedResult, nearbyPlaces, venueHistory] = await Promise.all([
    timedPhase(timings, "acceptedEvidenceMs", () => query<EvidenceMapRow>(
      `select le.id,
            le.client_evidence_id as "clientEvidenceId",
            le.evidence_type as kind,
            le.occurred_at as "occurredAt",
            le.ended_at as "endedAt",
            case when le.coordinate is null then null else ST_X(le.coordinate::geometry) end as longitude,
            case when le.coordinate is null then null else ST_Y(le.coordinate::geometry) end as latitude,
            le.horizontal_accuracy_m as "accuracyMeters",
            lse.role,
            le.expires_at as "expiresAt"
     from location_segment_evidence lse
     join location_evidence le
       on le.id = lse.evidence_id
      and le.workspace_id = lse.workspace_id
      and le.user_id = lse.user_id
     where lse.workspace_id = $1 and lse.user_id = $2
       and (($3::uuid is not null and lse.stay_segment_id = $3)
         or ($4::uuid is not null and lse.commute_segment_id = $4))
     order by le.occurred_at, lse.sequence_index, le.client_evidence_id`,
      [session.workspaceId, session.userId, review.stayId, review.commuteId]
    )),
    review.deviceId
      ? timedPhase(timings, "rejectedEvidenceMs", () => query<RejectedEvidenceRow>(
          `select client_evidence_id as "clientEvidenceId", evidence_type as kind,
                  occurred_at as "occurredAt",
                  case when coordinate is null then null else ST_X(coordinate::geometry) end as longitude,
                  case when coordinate is null then null else ST_Y(coordinate::geometry) end as latitude,
                  coalesce(rejection_reason, 'rejected') as "rejectionReason",
                  expires_at as "expiresAt"
           from location_evidence
           where workspace_id = $1 and user_id = $2 and device_id = $3 and accepted = false
             and occurred_at >= $4::timestamptz - interval '15 minutes'
             and occurred_at <= coalesce($5::timestamptz, $4::timestamptz) + interval '15 minutes'
             and expires_at > now()
           order by occurred_at, client_evidence_id
           limit 80`,
          [session.workspaceId, session.userId, review.deviceId, review.startedAt, review.stoppedAt]
        ))
      : Promise.resolve({ rows: [] as RejectedEvidenceRow[] }),
    centre
      ? timedPhase(timings, "nearbyPlacesMs", () =>
          nearbySavedPlaces(
            session,
            centre.coordinates[1],
            centre.coordinates[0]
          )
        )
      : Promise.resolve([]),
    kind === "stay" && centre && review.stayId
      ? timedPhase(timings, "venueHistoryMs", () => venueHistoryNear(
          session, review.stayId!, centre.coordinates[1], centre.coordinates[0]))
      : Promise.resolve([] as string[])
  ]);
  const retained = downsampleEvidence(evidenceResult.rows, 160);
  const assemblyStartedAt = Date.now();
  const approximateArrival = kind === "stay" && review.placeMatchKind === "unknown" &&
    review.approximateArrival === true;
  const coordinateRows = retained.filter(
    (row): row is EvidenceMapRow & { longitude: number; latitude: number } =>
      row.longitude != null && row.latitude != null
  );
  const anchors = retained.filter((row) =>
    ["visit", "geofence_enter", "geofence_exit", "significant_change"].includes(row.kind)
  );
  const stops = kind === "commute" ? tripStops(review.tripStops) : [];
  const gaps = evidenceGaps(coordinateRows, stops);
  // Time away claims only the absence: its readings stay inspectable, but it has no route or endpoint line.
  const journey = kind === "commute" && !review.timeAway;
  const routeCoordinates = journey
    ? coordinateRows.map((row) => [row.longitude, row.latitude] as [number, number])
    : [];
  const straightLineCoordinates = journey &&
    review.fromLongitude != null && review.fromLatitude != null &&
    review.toLongitude != null && review.toLatitude != null
    ? [[review.fromLongitude, review.fromLatitude], [review.toLongitude, review.toLatitude]] as [[number, number], [number, number]]
    : null;
  const observedRouteCoordinates = routeCoordinates.length >= 2
    ? [
        ...(straightLineCoordinates ? [straightLineCoordinates[0]] : []),
        ...routeCoordinates,
        ...(straightLineCoordinates ? [straightLineCoordinates[1]] : [])
      ]
    : [];
  const expiryRows = [...evidenceResult.rows, ...rejectedResult.rows];
  const expiresAt = expiryRows.length
    ? expiryRows.map((row) => iso(row.expiresAt)!).sort()[0]
    : null;
  const evidenceExpired = expiryRows.length === 0 &&
    Date.now() - Date.parse(iso(review.stoppedAt) ?? iso(review.startedAt)!) >
      LOCATION_ENGINE_V2_CONFIG.rawEvidenceRetentionDays * 86_400_000;
  const suggestedSplitPoints = gaps.map((gap) => ({
    at: new Date((Date.parse(gap.startedAt) + Date.parse(gap.stoppedAt)) / 2).toISOString(),
    reason: "evidence_gap" as const,
    confidence: "low"
  }));
  const dto = {
    reviewItemId: review.reviewItemId,
    eventId: review.eventId,
    segment: {
      id: review.stayId ?? review.commuteId!,
      kind,
      status: review.status,
      startedAt: iso(review.startedAt)!,
      stoppedAt: iso(review.stoppedAt),
      approximateArrival,
      startUncertainty: { lower: iso(review.startLowerBoundAt), upper: iso(review.startUpperBoundAt) },
      stopUncertainty: { lower: iso(review.stopLowerBoundAt), upper: iso(review.stopUpperBoundAt) },
      confidence: review.confidence,
      continuityStatus: review.continuityStatus,
      algorithmVersion: review.algorithmVersion,
      evidenceCount: evidenceResult.rows.length,
      rejectedEvidenceCount: rejectedResult.rows.length,
      ...(kind === "commute" ? { travelMode: MotionTravelModeSchema.safeParse(review.travelMode).data ?? null } : {}),
      ...(kind === "commute" && review.timeAway ? { timeAway: true } : {})
    },
    display: {
      title: review.title,
      subtitle: review.notes,
      placeId: review.placeId,
      placeName: review.placeName,
      addressSummary: review.addressSummary
    },
    map: {
      centre,
      stayRadiusMeters: review.radiusMeters,
      route: observedRouteCoordinates.length >= 2
        ? { type: "LineString" as const, coordinates: observedRouteCoordinates }
        : null,
      straightLineFallback: routeCoordinates.length < 2 && straightLineCoordinates
        ? { type: "LineString" as const, coordinates: straightLineCoordinates }
        : null,
      acceptedSamples: coordinateRows.map((row) => ({
        id: row.clientEvidenceId,
        point: point(row.longitude, row.latitude)!,
        occurredAt: iso(row.occurredAt)!,
        accuracyMeters: row.accuracyMeters,
        kind: row.kind,
        role: row.role
      })),
      rejectedSamples: rejectedResult.rows.map((row) => ({
        id: row.clientEvidenceId,
        point: point(row.longitude, row.latitude),
        occurredAt: iso(row.occurredAt)!,
        kind: row.kind,
        reason: row.rejectionReason
      })),
      anchors: anchors.map((row) => ({
        id: row.clientEvidenceId,
        point: point(row.longitude, row.latitude),
        occurredAt: iso(row.occurredAt)!,
        endedAt: iso(row.endedAt),
        kind: row.kind,
        label: anchorLabel(row.kind)
      })),
      gaps,
      nearbySavedPlaces: nearbyPlaces
    },
    stops,
    suggestedSplitPoints,
    ...(kind === "stay" ? {
      venue: {
        confirmedPlaceId: review.venuePlaceId ?? null,
        suggestedPlaceId: review.suggestedVenuePlaceId ?? null,
        historyPlaceIds: venueHistory
      }
    } : {}),
    evidenceExpiresAt: expiresAt,
    evidenceExpired,
    rawEvidenceAvailable: expiryRows.length > 0,
    textualSummary: textualEvidenceSummary(
      kind,
      coordinateRows.length,
      rejectedResult.rows.length,
      anchors.length,
      gaps,
      nearbyPlaces.map((place) => place.name),
      suggestedSplitPoints.length,
      evidenceExpired,
      expiryRows.length > 0,
      review,
      stops
    )
  };
  timings.assemblyMs = Date.now() - assemblyStartedAt;
  return dto;
}

/** How near a past stay must be for its picked venue to count as "picked here before" (design §8 cell). */
export const VENUE_HISTORY_RADIUS_METERS = 150;

export const VENUE_HISTORY_SQL = `select venue_place_id as "placeId"
     from stay_segments
    where workspace_id = $1 and user_id = $2 and id <> $3
      and venue_place_id is not null
      and ST_DWithin(centre, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6)
    group by venue_place_id
    order by max(coalesce(stopped_at, started_at)) desc
    limit 20`;

/**
 * Apple venues the person picked for their own stays within 150 m of this one, newest first
 * (location v3 PR 8): Place IDs only, for the iPhone's venue ranker.
 */
async function venueHistoryNear(session: RequestSession, stayId: string, latitude: number, longitude: number) {
  const result = await query<{ placeId: string }>(
    VENUE_HISTORY_SQL,
    [session.workspaceId, session.userId, stayId, longitude, latitude, VENUE_HISTORY_RADIUS_METERS]
  );
  return result.rows.map((row) => row.placeId);
}

async function timedPhase<K extends keyof LocationEvidenceTimings, T>(
  timings: LocationEvidenceTimings,
  key: K,
  operation: () => Promise<T>
) {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}

function logLocationEvidenceTiming(
  timings: LocationEvidenceTimings,
  evidence: Pick<LocationReviewEvidenceDto, "segment" | "map"> | null,
  error: unknown
) {
  if ((timings.totalMs ?? 0) < SLOW_LOCATION_EVIDENCE_REQUEST_MS) {
    return;
  }
  console.warn("Dayframe Location Evidence request timing", {
    reviewLookupMs: timings.reviewLookupMs ?? null,
    acceptedEvidenceMs: timings.acceptedEvidenceMs ?? null,
    rejectedEvidenceMs: timings.rejectedEvidenceMs ?? null,
    nearbyPlacesMs: timings.nearbyPlacesMs ?? null,
    // Its duration only: never the Place IDs it read (Codex r1 on #519).
    venueHistoryMs: timings.venueHistoryMs ?? null,
    assemblyMs: timings.assemblyMs ?? null,
    totalMs: timings.totalMs ?? null,
    acceptedEvidenceCount: evidence?.segment.evidenceCount ?? null,
    rejectedEvidenceCount: evidence?.segment.rejectedEvidenceCount ?? null,
    nearbyPlacesQueried: timings.nearbyPlacesMs != null,
    errorClass: error instanceof Error ? error.name : error ? "unknown" : null
  });
}

function downsampleEvidence(rows: EvidenceMapRow[], limit: number) {
  if (rows.length <= limit) return rows;
  const anchorIndexes = new Set(rows.flatMap((row, index) =>
    ["visit", "geofence_enter", "geofence_exit", "significant_change"].includes(row.kind) ? [index] : []
  ));
  anchorIndexes.add(0);
  anchorIndexes.add(rows.length - 1);
  const stride = Math.ceil(rows.length / Math.max(1, limit - anchorIndexes.size));
  return rows.filter((_, index) => anchorIndexes.has(index) || index % stride === 0).slice(0, limit);
}

/**
 * Unobserved intervals between route samples. A recorded trip stop is observed
 * by its own stay, so its time is removed before measuring the gap; only the
 * longest remaining unobserved piece can be reported and split.
 */
function evidenceGaps(rows: Array<EvidenceMapRow & { longitude: number; latitude: number }>, stops: TripStopDto[] = []) {
  return rows.slice(1).flatMap((row, index) => {
    const previous = rows[index];
    const gapStart = Date.parse(iso(previous.occurredAt)!);
    const gapStop = Date.parse(iso(row.occurredAt)!);
    let pieces = [[gapStart, gapStop]];
    for (const stop of stops) {
      const stopStart = Date.parse(stop.startedAt);
      const stopStop = Date.parse(stop.stoppedAt);
      pieces = pieces.flatMap(([start, stopAt]) => [
        ...(stopStart > start ? [[start, Math.min(stopAt, stopStart)]] : []),
        ...(stopStop < stopAt ? [[Math.max(start, stopStop), stopAt]] : [])
      ].filter(([from, to]) => to > from));
    }
    const longest = pieces.reduce<number[] | null>((best, piece) =>
      !best || piece[1] - piece[0] > best[1] - best[0] ? piece : best, null);
    if (!longest) return [];
    const durationSeconds = (longest[1] - longest[0]) / 1000;
    if (durationSeconds <= LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs / 1000) return [];
    return [{
      startedAt: new Date(longest[0]).toISOString(),
      stoppedAt: new Date(longest[1]).toISOString(),
      durationSeconds,
      fromPoint: point(previous.longitude, previous.latitude),
      toPoint: point(row.longitude, row.latitude)
    }];
  });
}

/**
 * Saved places within 500 m of a point ($2 longitude, $3 latitude). The ST_DWithin expression is
 * exactly `idx_places_geography`'s, so the search uses that index (places at scale, PR 16).
 */
export const NEARBY_SAVED_PLACES_SQL = `select id, ${placeDisplayNameSql("places")} as name, longitude, latitude, radius_meters as "radiusMeters",
            ST_Distance(
              ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
              ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
            ) as "distanceMeters"
     from places
     where workspace_id = $1 and latitude is not null and longitude is not null and archived_at is null
       and ST_DWithin(
         ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         500
       )
     order by "distanceMeters", priority desc, id
     limit 12`;

async function nearbySavedPlaces(session: RequestSession, latitude: number, longitude: number) {
  const result = await query<NearbyPlaceRow>(NEARBY_SAVED_PLACES_SQL, [session.workspaceId, longitude, latitude]);
  return result.rows.map((place) => ({
    id: place.id,
    name: place.name,
    point: point(place.longitude, place.latitude)!,
    radiusMeters: place.radiusMeters,
    matchClass:
      place.distanceMeters <= place.radiusMeters
        ? "strong" as const
        : place.distanceMeters <= place.radiusMeters + LOCATION_ENGINE_V2_CONFIG.maxAccuracyAllowanceMeters + 25
          ? "plausible" as const
          : "outside" as const,
    distanceMeters: Math.round(place.distanceMeters)
  }));
}

function anchorLabel(kind: string) {
  if (kind === "visit") return "iOS visit anchor";
  if (kind === "geofence_enter") return "Saved-place arrival";
  if (kind === "geofence_exit") return "Saved-place departure";
  return "Significant location change";
}

type TripStopDto = { startedAt: string; stoppedAt: string; durationSeconds: number; approximate: boolean };

/** Reads coordinate-free trip stops from commute metadata; malformed entries are ignored. */
function tripStops(value: unknown): TripStopDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((stop) => {
    if (!stop || typeof stop !== "object") return [];
    const { startedAt, stoppedAt, startLowerBoundAt, startUpperBoundAt } = stop as Record<string, unknown>;
    const start = typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
    const stopAt = typeof stoppedAt === "string" ? Date.parse(stoppedAt) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(stopAt) || stopAt <= start) return [];
    return [{
      startedAt: new Date(start).toISOString(),
      stoppedAt: new Date(stopAt).toISOString(),
      durationSeconds: Math.round((stopAt - start) / 1_000),
      approximate: typeof startLowerBoundAt === "string" && typeof startUpperBoundAt === "string" &&
        startLowerBoundAt !== startUpperBoundAt
    }];
  }).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function textualEvidenceSummary(
  kind: "stay" | "commute",
  sampleCount: number,
  rejectedSampleCount: number,
  anchorCount: number,
  gaps: Array<{ durationSeconds: number }>,
  placeCandidates: string[],
  splitCount: number,
  evidenceExpired: boolean,
  rawEvidenceAvailable: boolean,
  review: ReviewSegmentRow,
  stops: TripStopDto[] = []
) {
  const subject = kind === "stay" ? "visit" : review.timeAway ? "round trip" : "journey";
  const place = review.placeName ? ` near ${review.placeName}` : "";
  const window = `${iso(review.startedAt)} to ${iso(review.stoppedAt) ?? "ongoing"}`;
  const candidates = placeCandidates.length ? placeCandidates.join(", ") : "none within 500 metres";
  const largestGap = gaps.length ? Math.round(Math.max(...gaps.map((gap) => gap.durationSeconds)) / 60) : 0;
  const splitReason = splitCount ? "A split is suggested at the largest evidence gap." : "No split is currently suggested.";
  const retention = evidenceExpired
    ? "Raw evidence has expired; only the derived segment remains."
    : rawEvidenceAvailable
      ? "Raw evidence is still inside its temporary retention window."
      : "No raw evidence is attached to this segment.";
  const rejected = rejectedSampleCount
    ? ` ${rejectedSampleCount} noisy or invalid sample${rejectedSampleCount === 1 ? " was" : "s were"} excluded.`
    : "";
  const stopSummary = stops.map((stop) => {
    const minutes = Math.max(1, Math.round(stop.durationSeconds / 60));
    const article = /^8/.test(String(minutes)) || minutes === 11 || minutes === 18 ? "an" : "a";
    return ` It includes ${article} ${minutes}-minute${stop.approximate ? " (approximate)" : ""} stop from ${stop.startedAt} to ${stop.stoppedAt}; the stop is part of this ${review.timeAway ? "time away" : "trip, not travel time"}.`;
  }).join("");
  return `Time window: ${window}.${stopSummary} This ${subject}${place} has ${sampleCount} mapped sample${sampleCount === 1 ? "" : "s"} and ${anchorCount} arrival or departure anchor${anchorCount === 1 ? "" : "s"}.${rejected} Place candidates: ${candidates}. Largest evidence gap: ${largestGap} minutes. ${splitReason} ${retention}`;
}
