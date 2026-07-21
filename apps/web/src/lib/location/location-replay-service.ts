import {
  EMPTY_LOCATION_ENGINE_STATE,
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceSchema,
  runLocationEngine,
  type CommuteSegment,
  type LocationEvidence,
  type LocationSegment,
  type StaySegment
} from "@dayframe/shared";
import type pg from "pg";
import type { RequestSession } from "../session";

type EvidenceRow = {
  id: string;
  clientEvidenceId: string;
  deviceId: string;
  evidenceType: LocationEvidence["kind"];
  occurredAt: Date | string;
  endedAt: Date | string | null;
  longitude: number | null;
  latitude: number | null;
  horizontalAccuracyMeters: number | null;
  altitudeMeters: number | null;
  speedMetersPerSecond: number | null;
  courseDegrees: number | null;
  savedPlaceId: string | null;
  geofenceIdentifier: string | null;
  algorithmVersion: string;
  timeZone: string;
  isSimulated: boolean | null;
  metadata: Record<string, unknown>;
  receivedAt: Date | string;
};

type PlaceRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority: number;
  loggingEnabled: boolean;
};

type LearnedPlaceRow = PlaceRow;

export type LocationReplayResult = {
  segments: LocationSegment[];
  stayIds: Map<string, string>;
  commuteIds: Map<string, string>;
  evidenceIds: Map<string, string>;
  diagnostics: ReturnType<typeof runLocationEngine>["diagnostics"];
};

type PersistedSegment = {
  id: string;
  preservesManualCorrection: boolean;
};

function iso(value: Date | string | null) {
  return value == null ? null : new Date(value).toISOString();
}

export async function replayLocationEvidence(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string; processingAt: string }
): Promise<LocationReplayResult> {
  const evidenceResult = await client.query<EvidenceRow>(
    `select id,
            client_evidence_id as "clientEvidenceId",
            device_id as "deviceId",
            evidence_type as "evidenceType",
            occurred_at as "occurredAt",
            ended_at as "endedAt",
            case when coordinate is null then null else ST_X(coordinate::geometry) end as longitude,
            case when coordinate is null then null else ST_Y(coordinate::geometry) end as latitude,
            horizontal_accuracy_m as "horizontalAccuracyMeters",
            altitude_m as "altitudeMeters",
            speed_mps as "speedMetersPerSecond",
            course_degrees as "courseDegrees",
            saved_place_id as "savedPlaceId",
            geofence_identifier as "geofenceIdentifier",
            algorithm_version as "algorithmVersion",
            time_zone as "timeZone",
            is_simulated as "isSimulated",
            metadata,
            received_at as "receivedAt"
     from location_evidence
     where workspace_id = $1 and user_id = $2 and device_id = $3
       and algorithm_version = $4 and accepted = true and expires_at > now()
     order by occurred_at, evidence_type, client_evidence_id`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion]
  );
  const placesResult = await client.query<PlaceRow>(
    `select id, name, latitude, longitude,
            radius_meters as "radiusMeters", priority,
            logging_enabled as "loggingEnabled"
     from places
     where workspace_id = $1 and latitude is not null and longitude is not null`,
    [session.workspaceId]
  );
  const learnedResult = await client.query<LearnedPlaceRow>(
    `select id, name, latitude, longitude,
            radius_meters as "radiusMeters", 0 as priority, true as "loggingEnabled"
     from learned_places
     where workspace_id = $1 and user_id = $2 and status = 'accepted'`,
    [session.workspaceId, session.userId]
  );
  const evidence = evidenceResult.rows.map((row) => LocationEvidenceSchema.parse({
    clientEvidenceId: row.clientEvidenceId,
    deviceId: row.deviceId,
    algorithmVersion: row.algorithmVersion,
    kind: row.evidenceType,
    occurredAt: iso(row.occurredAt)!,
    endedAt: iso(row.endedAt),
    latitude: row.latitude,
    longitude: row.longitude,
    horizontalAccuracyMeters: row.horizontalAccuracyMeters,
    altitudeMeters: row.altitudeMeters,
    speedMetersPerSecond: row.speedMetersPerSecond,
    courseDegrees: row.courseDegrees,
    savedPlaceId: row.savedPlaceId,
    geofenceIdentifier: row.geofenceIdentifier,
    receivedAt: iso(row.receivedAt)!,
    timeZone: row.timeZone,
    isSimulated: row.isSimulated,
    metadata: row.metadata
  }));
  const output = runLocationEngine({
    priorState: { ...EMPTY_LOCATION_ENGINE_STATE, algorithmVersion: options.algorithmVersion },
    evidence,
    savedPlaces: placesResult.rows,
    acceptedLearnedPlaces: learnedResult.rows.map((place) => ({ ...place, accepted: true as const })),
    config: { ...LOCATION_ENGINE_V2_CONFIG, algorithmVersion: options.algorithmVersion },
    processingAt: options.processingAt
  });

  const nextStayClientIds = output.segmentUpserts
    .filter((segment): segment is StaySegment => segment.kind === "stay")
    .map((segment) => segment.clientSegmentId);
  const nextCommuteClientIds = output.segmentUpserts
    .filter((segment): segment is CommuteSegment => segment.kind === "commute")
    .map((segment) => segment.clientSegmentId);
  await supersedeMissingSegments(client, session, options, nextStayClientIds, nextCommuteClientIds);

  const evidenceIds = new Map(evidenceResult.rows.map((row) => [row.clientEvidenceId, row.id]));
  const stayIds = new Map<string, string>();
  const protectedSegmentIds = new Set<string>();
  for (const segment of output.segmentUpserts.filter((item): item is StaySegment => item.kind === "stay")) {
    const result = await upsertStay(client, session, options.deviceId, segment);
    stayIds.set(segment.clientSegmentId, result.id);
    if (result.preservesManualCorrection) protectedSegmentIds.add(result.id);
  }
  const commuteIds = new Map<string, string>();
  for (const segment of output.segmentUpserts.filter((item): item is CommuteSegment => item.kind === "commute")) {
    const fromStayId = stayIds.get(segment.fromStaySegmentId);
    const toStayId = stayIds.get(segment.toStaySegmentId);
    if (!fromStayId || !toStayId) continue;
    const result = await upsertCommute(client, session, options.deviceId, segment, fromStayId, toStayId);
    commuteIds.set(segment.clientSegmentId, result.id);
    if (result.preservesManualCorrection) protectedSegmentIds.add(result.id);
  }
  await replaceEvidenceLinks(
    client,
    session,
    output.segmentUpserts,
    evidenceIds,
    stayIds,
    commuteIds,
    protectedSegmentIds
  );
  return { segments: output.segmentUpserts, stayIds, commuteIds, evidenceIds, diagnostics: output.diagnostics };
}

async function supersedeMissingSegments(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string },
  stayClientIds: string[],
  commuteClientIds: string[]
) {
  await client.query(
    `update stay_segments set status = 'superseded', updated_at = now()
     where workspace_id = $1 and user_id = $2 and device_id = $3 and algorithm_version = $4
       and created_from_event_id is null and status in ('candidate', 'open', 'closed', 'finalised')
       and not (client_segment_id = any($5::text[]))`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, stayClientIds]
  );
  await client.query(
    `update commute_segments set status = 'superseded', updated_at = now()
     where workspace_id = $1 and user_id = $2 and device_id = $3 and algorithm_version = $4
       and created_from_event_id is null and status in ('candidate', 'open', 'closed', 'finalised')
       and not (client_segment_id = any($5::text[]))`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, commuteClientIds]
  );
}

async function upsertStay(
  client: pg.PoolClient,
  session: RequestSession,
  deviceId: string,
  segment: StaySegment
): Promise<PersistedSegment> {
  const existing = await client.query<{
    id: string;
    continuityStatus: string;
    createdFromEventId: string | null;
  }>(
    `select id, continuity_status as "continuityStatus", created_from_event_id as "createdFromEventId"
     from stay_segments
     where workspace_id = $1 and user_id = $2 and device_id = $3 and client_segment_id = $4
     for update`,
    [session.workspaceId, session.userId, deviceId, segment.clientSegmentId]
  );
  if (existing.rows[0]?.continuityStatus === "manual" || existing.rows[0]?.createdFromEventId) {
    return { id: existing.rows[0].id, preservesManualCorrection: true };
  }
  const result = await client.query<{ id: string }>(
    `insert into stay_segments (
       workspace_id, user_id, device_id, client_segment_id, algorithm_version,
       status, source, place_id, learned_place_id, started_at, stopped_at,
       start_lower_bound_at, start_upper_bound_at, stop_lower_bound_at, stop_upper_bound_at,
       centre, radius_m, sample_count, continuity_status, confidence, raw_sample_count,
       review_status, arrival_confidence, departure_confidence, metadata, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, 'location_v2', $7, $8, $9, $10,
       $11, $12, $13, $14,
       case when $15::double precision is null or $16::double precision is null then null
            else ST_SetSRID(ST_MakePoint($16, $15), 4326)::geography end,
       $17, $18, $19, $20, $18, 'needs_review', $20, $20, $21::jsonb, now()
     )
     on conflict (workspace_id, user_id, device_id, client_segment_id)
       where device_id is not null and client_segment_id is not null
     do update set
       status = excluded.status,
       place_id = excluded.place_id,
       learned_place_id = excluded.learned_place_id,
       started_at = excluded.started_at,
       stopped_at = excluded.stopped_at,
       start_lower_bound_at = excluded.start_lower_bound_at,
       start_upper_bound_at = excluded.start_upper_bound_at,
       stop_lower_bound_at = excluded.stop_lower_bound_at,
       stop_upper_bound_at = excluded.stop_upper_bound_at,
       centre = excluded.centre,
       radius_m = excluded.radius_m,
       sample_count = excluded.sample_count,
       raw_sample_count = excluded.raw_sample_count,
       continuity_status = excluded.continuity_status,
       confidence = excluded.confidence,
       metadata = excluded.metadata,
       updated_at = now()
     returning id`,
    [
      session.workspaceId,
      session.userId,
      deviceId,
      segment.clientSegmentId,
      segment.algorithmVersion,
      segment.status,
      segment.placeId ?? null,
      segment.learnedPlaceId ?? null,
      segment.startedAt,
      segment.stoppedAt ?? null,
      segment.startLowerBoundAt ?? null,
      segment.startUpperBoundAt ?? null,
      segment.stopLowerBoundAt ?? null,
      segment.stopUpperBoundAt ?? null,
      segment.centreLatitude ?? null,
      segment.centreLongitude ?? null,
      segment.radiusMeters ?? null,
      segment.sampleCount,
      segment.continuityStatus,
      segment.confidence,
      JSON.stringify({
        placeMatchKind: segment.placeMatchKind,
        candidatePlaceIds: segment.candidatePlaceIds
      })
    ]
  );
  return { id: result.rows[0].id, preservesManualCorrection: false };
}

async function upsertCommute(
  client: pg.PoolClient,
  session: RequestSession,
  deviceId: string,
  segment: CommuteSegment,
  fromStayId: string,
  toStayId: string
): Promise<PersistedSegment> {
  const existing = await client.query<{
    id: string;
    continuityStatus: string;
    createdFromEventId: string | null;
  }>(
    `select id, continuity_status as "continuityStatus", created_from_event_id as "createdFromEventId"
     from commute_segments
     where workspace_id = $1 and user_id = $2 and device_id = $3 and client_segment_id = $4
     for update`,
    [session.workspaceId, session.userId, deviceId, segment.clientSegmentId]
  );
  if (existing.rows[0]?.continuityStatus === "manual" || existing.rows[0]?.createdFromEventId) {
    return { id: existing.rows[0].id, preservesManualCorrection: true };
  }
  const result = await client.query<{ id: string }>(
    `insert into commute_segments (
       workspace_id, user_id, device_id, client_segment_id, algorithm_version, status,
       started_at, stopped_at, from_stay_segment_id, to_stay_segment_id,
       from_place_id, to_place_id, route_distance_m, straight_line_distance_m,
       route_sample_count, max_gap_seconds, continuity_status, confidence, metadata, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, '{}'::jsonb, now())
     on conflict (workspace_id, user_id, device_id, client_segment_id)
     do update set
       status = excluded.status,
       started_at = excluded.started_at,
       stopped_at = excluded.stopped_at,
       from_stay_segment_id = excluded.from_stay_segment_id,
       to_stay_segment_id = excluded.to_stay_segment_id,
       from_place_id = excluded.from_place_id,
       to_place_id = excluded.to_place_id,
       route_distance_m = excluded.route_distance_m,
       straight_line_distance_m = excluded.straight_line_distance_m,
       route_sample_count = excluded.route_sample_count,
       max_gap_seconds = excluded.max_gap_seconds,
       continuity_status = excluded.continuity_status,
       confidence = excluded.confidence,
       updated_at = now()
     returning id`,
    [
      session.workspaceId,
      session.userId,
      deviceId,
      segment.clientSegmentId,
      segment.algorithmVersion,
      segment.status,
      segment.startedAt,
      segment.stoppedAt,
      fromStayId,
      toStayId,
      segment.fromPlaceId ?? null,
      segment.toPlaceId ?? null,
      segment.routeDistanceMeters ?? null,
      segment.straightLineDistanceMeters ?? null,
      segment.routeSampleCount,
      segment.gapDurationSeconds,
      segment.continuityStatus,
      segment.confidence
    ]
  );
  return { id: result.rows[0].id, preservesManualCorrection: false };
}

async function replaceEvidenceLinks(
  client: pg.PoolClient,
  session: RequestSession,
  segments: LocationSegment[],
  evidenceIds: Map<string, string>,
  stayIds: Map<string, string>,
  commuteIds: Map<string, string>,
  protectedSegmentIds: Set<string>
) {
  const allIds = [...stayIds.values(), ...commuteIds.values()].filter(
    (segmentId) => !protectedSegmentIds.has(segmentId)
  );
  if (allIds.length > 0) {
    await client.query(
      `delete from location_segment_evidence
       where workspace_id = $1 and user_id = $2
         and (stay_segment_id = any($3::uuid[]) or commute_segment_id = any($3::uuid[]))`,
      [session.workspaceId, session.userId, allIds]
    );
  }
  for (const segment of segments) {
    const segmentId = segment.kind === "stay"
      ? stayIds.get(segment.clientSegmentId)
      : commuteIds.get(segment.clientSegmentId);
    if (!segmentId || protectedSegmentIds.has(segmentId)) continue;
    for (const [index, clientEvidenceId] of segment.evidenceIds.entries()) {
      const evidenceId = evidenceIds.get(clientEvidenceId);
      if (!evidenceId) continue;
      await client.query(
        `insert into location_segment_evidence (
           workspace_id, user_id, evidence_id, stay_segment_id, commute_segment_id, sequence_index, role
         ) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict do nothing`,
        [
          session.workspaceId,
          session.userId,
          evidenceId,
          segment.kind === "stay" ? segmentId : null,
          segment.kind === "commute" ? segmentId : null,
          index,
          segment.kind === "stay" ? "inside" : "route"
        ]
      );
    }
  }
}
