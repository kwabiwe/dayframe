import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationReviewEvidenceDtoSchema,
  type LocationReviewEvidenceDto
} from "@dayframe/shared";
import { query } from "../db";
import type { RequestSession } from "../session";

type ReviewSegmentRow = {
  reviewItemId: string;
  eventId: string;
  title: string;
  notes: string | null;
  placeId: string | null;
  placeName: string | null;
  addressSummary: string | null;
  deviceId: string | null;
  stayId: string | null;
  commuteId: string | null;
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

const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();
const point = (longitude: number | null, latitude: number | null) =>
  longitude == null || latitude == null
    ? null
    : { type: "Point" as const, coordinates: [longitude, latitude] as [number, number] };

export async function getLocationReviewEvidence(
  reviewItemId: string,
  session: RequestSession
): Promise<LocationReviewEvidenceDto> {
  const reviewResult = await query<ReviewSegmentRow>(
    `select ri.id as "reviewItemId",
            ri.event_id as "eventId",
            ri.title,
            ri.notes,
            coalesce(st.place_id, cs.from_place_id) as "placeId",
            pl.name as "placeName",
            null::text as "addressSummary",
            coalesce(st.device_id, cs.device_id) as "deviceId",
            st.id as "stayId",
            cs.id as "commuteId",
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
            coalesce(st.confidence, cs.confidence) as confidence,
            coalesce(st.continuity_status, cs.continuity_status) as "continuityStatus",
            coalesce(st.algorithm_version, cs.algorithm_version) as "algorithmVersion",
            case when from_stay.centre is null then null else ST_X(from_stay.centre::geometry) end as "fromLongitude",
            case when from_stay.centre is null then null else ST_Y(from_stay.centre::geometry) end as "fromLatitude",
            case when to_stay.centre is null then null else ST_X(to_stay.centre::geometry) end as "toLongitude",
            case when to_stay.centre is null then null else ST_Y(to_stay.centre::geometry) end as "toLatitude"
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     left join stay_segments st
       on st.id = ri.location_segment_id and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs
       on cs.id = ri.location_segment_id and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     left join stay_segments from_stay
       on from_stay.id = cs.from_stay_segment_id
      and from_stay.workspace_id = ri.workspace_id and from_stay.user_id = ri.user_id
     left join stay_segments to_stay
       on to_stay.id = cs.to_stay_segment_id
      and to_stay.workspace_id = ri.workspace_id and to_stay.user_id = ri.user_id
     left join places pl
       on pl.id = coalesce(st.place_id, cs.from_place_id) and pl.workspace_id = ri.workspace_id
     where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3
       and (st.id is not null or cs.id is not null)
     limit 1`,
    [reviewItemId, session.workspaceId, session.userId]
  );
  const review = reviewResult.rows[0];
  if (!review) throw new LocationEvidenceNotFoundError("Location review evidence was not found.");
  const kind = review.stayId ? "stay" as const : "commute" as const;
  const evidenceResult = await query<EvidenceMapRow>(
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
  );
  const retained = downsampleEvidence(evidenceResult.rows, 160);
  const rejectedResult = review.deviceId
    ? await query<RejectedEvidenceRow>(
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
      )
    : { rows: [] as RejectedEvidenceRow[] };
  const coordinateRows = retained.filter(
    (row): row is EvidenceMapRow & { longitude: number; latitude: number } =>
      row.longitude != null && row.latitude != null
  );
  const anchors = retained.filter((row) =>
    ["visit", "geofence_enter", "geofence_exit", "significant_change"].includes(row.kind)
  );
  const gaps = evidenceGaps(coordinateRows);
  const centre = point(review.centreLongitude, review.centreLatitude);
  const nearbyPlaces = centre
    ? await nearbySavedPlaces(session, centre.coordinates[1], centre.coordinates[0])
    : [];
  const routeCoordinates = kind === "commute"
    ? coordinateRows.map((row) => [row.longitude, row.latitude] as [number, number])
    : [];
  const straightLineCoordinates = kind === "commute" &&
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
      startUncertainty: { lower: iso(review.startLowerBoundAt), upper: iso(review.startUpperBoundAt) },
      stopUncertainty: { lower: iso(review.stopLowerBoundAt), upper: iso(review.stopUpperBoundAt) },
      confidence: review.confidence,
      continuityStatus: review.continuityStatus,
      algorithmVersion: review.algorithmVersion,
      evidenceCount: evidenceResult.rows.length,
      rejectedEvidenceCount: rejectedResult.rows.length
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
    suggestedSplitPoints,
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
      review
    )
  };
  return LocationReviewEvidenceDtoSchema.parse(dto);
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

function evidenceGaps(rows: Array<EvidenceMapRow & { longitude: number; latitude: number }>) {
  return rows.slice(1).flatMap((row, index) => {
    const previous = rows[index];
    const durationSeconds = (Date.parse(iso(row.occurredAt)!) - Date.parse(iso(previous.occurredAt)!)) / 1000;
    if (durationSeconds <= LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs / 1000) return [];
    return [{
      startedAt: iso(previous.occurredAt)!,
      stoppedAt: iso(row.occurredAt)!,
      durationSeconds,
      fromPoint: point(previous.longitude, previous.latitude),
      toPoint: point(row.longitude, row.latitude)
    }];
  });
}

async function nearbySavedPlaces(session: RequestSession, latitude: number, longitude: number) {
  const result = await query<NearbyPlaceRow>(
    `select id, name, longitude, latitude, radius_meters as "radiusMeters",
            ST_Distance(
              ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
              ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
            ) as "distanceMeters"
     from places
     where workspace_id = $1 and latitude is not null and longitude is not null
       and ST_DWithin(
         ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
         ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         500
       )
     order by "distanceMeters", priority desc, id
     limit 12`,
    [session.workspaceId, longitude, latitude]
  );
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

function textualEvidenceSummary(
  kind: "stay" | "commute",
  sampleCount: number,
  rejectedSampleCount: number,
  anchorCount: number,
  gaps: Array<{ durationSeconds: number }>,
  placeCandidates: string[],
  splitCount: number,
  evidenceExpired: boolean,
  review: ReviewSegmentRow
) {
  const subject = kind === "stay" ? "visit" : "journey";
  const place = review.placeName ? ` near ${review.placeName}` : "";
  const window = `${iso(review.startedAt)} to ${iso(review.stoppedAt) ?? "ongoing"}`;
  const candidates = placeCandidates.length ? placeCandidates.join(", ") : "none within 500 metres";
  const largestGap = gaps.length ? Math.round(Math.max(...gaps.map((gap) => gap.durationSeconds)) / 60) : 0;
  const splitReason = splitCount ? "A split is suggested at the largest evidence gap." : "No split is currently suggested.";
  const retention = evidenceExpired
    ? "Raw evidence has expired; only the derived segment remains."
    : "Raw evidence is still inside its temporary retention window.";
  const rejected = rejectedSampleCount
    ? ` ${rejectedSampleCount} noisy or invalid sample${rejectedSampleCount === 1 ? " was" : "s were"} excluded.`
    : "";
  return `Time window: ${window}. This ${subject}${place} has ${sampleCount} mapped sample${sampleCount === 1 ? "" : "s"} and ${anchorCount} arrival or departure anchor${anchorCount === 1 ? "" : "s"}.${rejected} Place candidates: ${candidates}. Largest evidence gap: ${largestGap} minutes. ${splitReason} ${retention}`;
}
