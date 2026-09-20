import { observeLocationCount, observeLocationStage, observeLocationTiming, type LocationObservation } from "./location-sync-diagnostics";
import {
  boundedJsonBatches,
  LOCATION_LINEAGE_INSERT_BATCH_SIZE,
  LOCATION_LINEAGE_INSERT_PAYLOAD_MAX_BYTES,
  LOCATION_PROTECTED_EVIDENCE_ID_BATCH_SIZE,
  LOCATION_PROTECTED_EVIDENCE_ID_PAYLOAD_MAX_BYTES,
  LOCATION_REPLAY_SCALABILITY_PROFILE,
  type LocationReplayPersistenceProfile
} from "./location-replay-batching";
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

type ExistingSegment = {
  id: string;
  clientSegmentId: string;
  continuityStatus: string;
  preservesManualCorrection: boolean;
};

type LocationReplayOptions = {
  deviceId: string;
  algorithmVersion: string;
  processingAt: string;
  persistenceProfile?: LocationReplayPersistenceProfile;
} & LocationObservation;

function iso(value: Date | string | null) {
  return value == null ? null : new Date(value).toISOString();
}

export async function replayLocationEvidence(
  client: pg.PoolClient,
  session: RequestSession,
  options: LocationReplayOptions
): Promise<LocationReplayResult> {
  observeLocationStage(options, "evidence_read");
  observeLocationTiming(options, "evidence_read", "started");
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
       and algorithm_version = $4 and accepted = true and expires_at > $5::timestamptz
     order by occurred_at, evidence_type, client_evidence_id`,
    [
      session.workspaceId,
      session.userId,
      options.deviceId,
      options.algorithmVersion,
      options.processingAt
    ]
  );
  observeLocationTiming(options, "evidence_read", "completed");
  observeLocationCount(options, "evidenceRows", evidenceResult.rows.length);
  observeLocationStage(options, "catalogue_read");
  observeLocationTiming(options, "catalogue_read", "started");
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
  observeLocationTiming(options, "catalogue_read", "completed");
  observeLocationStage(options, "engine");
  observeLocationTiming(options, "engine_computation", "started");
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
  observeLocationTiming(options, "engine_computation", "completed");

  observeLocationStage(options, "segment_persistence");
  observeLocationCount(options, "staySegments", output.segmentUpserts.filter(segment => segment.kind === "stay").length);
  observeLocationCount(options, "commuteSegments", output.segmentUpserts.filter(segment => segment.kind === "commute").length);
  observeLocationTiming(options, "protected_replacement_checks", "started");
  const protectedReplacement = await excludeProtectedReplacements(client, session, options, output.segmentUpserts);
  const segments = protectedReplacement.segments;
  observeLocationTiming(options, "protected_replacement_checks", "completed");
  observeLocationCount(options, "protectedSegments", protectedReplacement.count);
  const nextStayClientIds = segments
    .filter((segment): segment is StaySegment => segment.kind === "stay")
    .map((segment) => segment.clientSegmentId);
  const nextCommuteClientIds = segments
    .filter((segment): segment is CommuteSegment => segment.kind === "commute")
    .map((segment) => segment.clientSegmentId);
  observeLocationTiming(options, "obsolete_segment_handling", "started");
  await supersedeMissingSegments(client, session, options, nextStayClientIds, nextCommuteClientIds);
  observeLocationTiming(options, "obsolete_segment_handling", "completed");

  const evidenceIds = new Map(evidenceResult.rows.map((row) => [row.clientEvidenceId, row.id]));
  const protectedSegmentIds = new Set<string>();
  observeLocationTiming(options, "stay_persistence", "started");
  const stayIds = await persistStays(client, session, options.deviceId,
    segments.filter((segment): segment is StaySegment => segment.kind === "stay"), protectedSegmentIds);
  observeLocationTiming(options, "stay_persistence", "completed");
  observeLocationTiming(options, "commute_persistence", "started");
  const resolvedCommutes = segments
    .filter((segment): segment is CommuteSegment => segment.kind === "commute")
    .flatMap(segment => {
      const fromStayId = stayIds.get(segment.fromStaySegmentId);
      const toStayId = stayIds.get(segment.toStaySegmentId);
      return fromStayId && toStayId ? [{...segment, fromStayId, toStayId}] : [];
    });
  const commuteIds = await persistCommutes(client, session, options.deviceId, resolvedCommutes, protectedSegmentIds);
  observeLocationTiming(options, "commute_persistence", "completed");
  observeLocationCount(options, "protectedSegments", protectedReplacement.count + protectedSegmentIds.size);
  observeLocationStage(options, "lineage");
  await replaceEvidenceLinks(
    client,
    session,
    segments,
    evidenceIds,
    stayIds,
    commuteIds,
    protectedSegmentIds,
    options
  );
  return { segments, stayIds, commuteIds, evidenceIds, diagnostics: output.diagnostics };
}

type ProtectedSourceLink = {
  clientSegmentId: string; clientEvidenceId: string; kind: string;
  occurredAt: Date | string; startedAt: Date | string; stoppedAt: Date | string | null;
};

/** Exact provenance plus the occupied portion, never name/time proximity alone. */
function sharesProtectedPortion(segment: LocationSegment, link: ProtectedSourceLink) {
  if (segment.clientSegmentId === link.clientSegmentId) return false;
  const start = Date.parse(iso(link.startedAt)!);
  const stop = link.stoppedAt ? Date.parse(iso(link.stoppedAt)!) : NaN;
  const nextStart = Date.parse(segment.startedAt);
  const nextStop = segment.stoppedAt ? Date.parse(segment.stoppedAt) : NaN;
  if (!(Math.min(stop, nextStop) > Math.max(start, nextStart))) return false;
  // A long Visit reused after departure cannot claim the later episode.
  if (link.kind === "visit") return start === nextStart;
  if (!["standard_location", "significant_change"].includes(link.kind)) return false;
  const at = Date.parse(iso(link.occurredAt)!);
  // A single shared endpoint belongs to neither interval's interior.
  return at > start && at < stop && at > nextStart && at < nextStop;
}

async function excludeProtectedReplacements(
  client: pg.PoolClient, session: RequestSession,
  options: Pick<LocationReplayOptions, "deviceId" | "algorithmVersion" | "persistenceProfile" | "onLocationCount">,
  segments: LocationSegment[]
) {
  const byEvidence = new Map<string, LocationSegment[]>();
  for (const segment of segments) for (const id of segment.evidenceIds) {
    const candidates = byEvidence.get(id) ?? [];
    candidates.push(segment);
    byEvidence.set(id, candidates);
  }
  const held = new Set<string>();
  const candidateEvidenceIds = [...byEvidence.keys()].sort();
  const scalabilityProfile = options.persistenceProfile === LOCATION_REPLAY_SCALABILITY_PROFILE;
  let protectionQueryBatches = 0;
  if (scalabilityProfile) observeLocationCount(options, "protectionEvidenceIds", candidateEvidenceIds.length);
  // Bounded provenance reads under the existing owner transaction/lock. No per-segment SQL.
  for (const table of ["stay_segments", "commute_segments"] as const) {
    const batches = scalabilityProfile
      ? candidateEvidenceIds.length === 0
        ? [candidateEvidenceIds]
        : boundedJsonBatches(candidateEvidenceIds, {
            operation: "protected_evidence_ids",
            maxItems: LOCATION_PROTECTED_EVIDENCE_ID_BATCH_SIZE,
            maxBytes: LOCATION_PROTECTED_EVIDENCE_ID_PAYLOAD_MAX_BYTES
          })
      : segmentChunks(candidateEvidenceIds);
    for (const ids of batches) {
      if (scalabilityProfile) {
        protectionQueryBatches += 1;
        observeLocationCount(options, "protectionQueryBatches", protectionQueryBatches);
      }
      const column = table === "stay_segments" ? "stay_segment_id" : "commute_segment_id";
      const links = await client.query<ProtectedSourceLink>(
        `select s.client_segment_id as "clientSegmentId", le.client_evidence_id as "clientEvidenceId",
                le.evidence_type as kind, le.occurred_at as "occurredAt",
                s.started_at as "startedAt", s.stopped_at as "stoppedAt"
         from ${table} s
         join location_segment_evidence lse on lse.${column} = s.id
           and lse.workspace_id = s.workspace_id and lse.user_id = s.user_id
         join location_evidence le on le.id = lse.evidence_id
           and le.workspace_id = s.workspace_id and le.user_id = s.user_id
         where s.workspace_id = $1 and s.user_id = $2 and s.device_id = $3 and s.algorithm_version = $4
           and le.device_id = $3 and le.algorithm_version = $4 and le.client_evidence_id = any($5::text[])
           and (s.continuity_status = 'manual' or (s.status <> 'superseded' and s.created_from_event_id is not null
             and not exists (select 1 from review_items ri where ri.workspace_id = s.workspace_id
               and ri.user_id = s.user_id and ri.location_segment_id = s.id and ri.status = 'open')))
         order by s.id, le.client_evidence_id for update of s`,
        [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, ids]);
      for (const link of links.rows) for (const candidate of byEvidence.get(link.clientEvidenceId) ?? []) {
        if (sharesProtectedPortion(candidate, link)) held.add(candidate.clientSegmentId);
      }
    }
  }
  return {
    count: held.size,
    segments: segments.filter(segment => !held.has(segment.clientSegmentId) && (segment.kind !== "commute" ||
      (!held.has(segment.fromStaySegmentId) && !held.has(segment.toStaySegmentId))))
  };
}

async function supersedeMissingSegments(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string; processingAt: string },
  stayClientIds: string[],
  commuteClientIds: string[]
) {
  await retireOpenReviewsForMissingSegments(
    client,
    session,
    options,
    stayClientIds,
    commuteClientIds
  );
  await client.query(
    `update stay_segments set status = 'superseded', updated_at = now()
     where workspace_id = $1 and user_id = $2 and device_id = $3 and algorithm_version = $4
       and created_from_event_id is null and continuity_status <> 'manual'
       and status in ('candidate', 'open', 'closed', 'finalised')
       and not (client_segment_id = any($5::text[]))`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, stayClientIds]
  );
  await client.query(
    `update commute_segments set status = 'superseded', updated_at = now()
     where workspace_id = $1 and user_id = $2 and device_id = $3 and algorithm_version = $4
       and created_from_event_id is null and continuity_status <> 'manual'
       and status in ('candidate', 'open', 'closed', 'finalised')
       and not (client_segment_id = any($5::text[]))`,
    [session.workspaceId, session.userId, options.deviceId, options.algorithmVersion, commuteClientIds]
  );
}

async function retireOpenReviewsForMissingSegments(
  client: pg.PoolClient,
  session: RequestSession,
  options: { deviceId: string; algorithmVersion: string; processingAt: string },
  stayClientIds: string[],
  commuteClientIds: string[]
) {
  const stale = await client.query<{ reviewId: string; eventId: string }>(
    `select ri.id as "reviewId", ri.event_id as "eventId"
     from review_items ri
     left join stay_segments st
       on st.id = ri.location_segment_id
      and st.workspace_id = ri.workspace_id and st.user_id = ri.user_id
     left join commute_segments cs
       on cs.id = ri.location_segment_id
      and cs.workspace_id = ri.workspace_id and cs.user_id = ri.user_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
       and coalesce(st.continuity_status, cs.continuity_status) <> 'manual'
       and coalesce(st.started_at, cs.started_at) >= $7::timestamptz - ($8::int * interval '1 day')
       and coalesce(st.device_id, cs.device_id) = $3
       and coalesce(st.algorithm_version, cs.algorithm_version) = $4
       and (
         (st.id is not null and not (st.client_segment_id = any($5::text[])))
         or
         (cs.id is not null and not (cs.client_segment_id = any($6::text[])))
       )
       and exists (
         select 1
         from location_segment_evidence lse
         join location_evidence le
           on le.id = lse.evidence_id
          and le.workspace_id = lse.workspace_id and le.user_id = lse.user_id
         where lse.workspace_id = ri.workspace_id and lse.user_id = ri.user_id
           and (lse.stay_segment_id = st.id or lse.commute_segment_id = cs.id)
           and le.accepted = true and le.device_id = $3 and le.algorithm_version = $4
           and le.expires_at > $7::timestamptz
       )
     for update of ri`,
    [
      session.workspaceId,
      session.userId,
      options.deviceId,
      options.algorithmVersion,
      stayClientIds,
      commuteClientIds,
      options.processingAt,
      LOCATION_ENGINE_V2_CONFIG.rawEvidenceRetentionDays
    ]
  );
  if (stale.rows.length === 0) return;
  const reviewIds = stale.rows.map((row) => row.reviewId);
  const eventIds = stale.rows.map((row) => row.eventId);
  // Only rows just identified as obsolete *open* proposals are retired here.
  // Explicitly mark derived snapshots superseded so their retirement is not a user decision.
  for (const table of ["stay_segments", "commute_segments"] as const) {
    await client.query(`update ${table} set status = 'superseded', updated_at = now()
      where workspace_id = $1 and user_id = $2 and created_from_event_id = any($3::uuid[])
        and continuity_status <> 'manual'`, [session.workspaceId, session.userId, eventIds]);
  }
  await client.query(
    `update review_items
     set status = 'ignored', resolved_at = now(),
         notes = concat_ws(' ', nullif(notes, ''), 'Superseded by corrected location evidence replay.')
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) and status = 'open'`,
    [session.workspaceId, session.userId, reviewIds]
  );
  await client.query(
    `update activity_events set review_status = 'ignored'
     where workspace_id = $1 and user_id = $2 and id = any($3::uuid[])
       and review_status = 'needs_review'`,
    [session.workspaceId, session.userId, eventIds]
  );
}

// At most 5,750 parameters per write and 250 IDs per locking read. Every chunk
// remains under the original advisory lock, checked-out client and deadline.
export const LOCATION_SEGMENT_PERSIST_CHUNK_SIZE = 250;
function* segmentChunks<T>(items: T[]) {
  for (let offset = 0; offset < items.length; offset += LOCATION_SEGMENT_PERSIST_CHUNK_SIZE) {
    yield items.slice(offset, offset + LOCATION_SEGMENT_PERSIST_CHUNK_SIZE);
  }
}
async function lockAndPartitionSegments<T extends {clientSegmentId: string}>(
  client: pg.PoolClient, session: RequestSession, deviceId: string,
  table: "stay_segments" | "commute_segments", segments: T[], protectedSegmentIds: Set<string>
) {
  const ordered = [...segments].sort((a, b) => a.clientSegmentId < b.clientSegmentId ? -1 : a.clientSegmentId > b.clientSegmentId ? 1 : 0);
  const ids = new Map<string, string>();
  // Lock all matching existing rows before writing this segment kind. The table
  // identifier is a local closed union, never supplied by a request.
  for (const chunk of segmentChunks(ordered)) {
    const existing = await client.query<ExistingSegment>(
      `select id, client_segment_id as "clientSegmentId", continuity_status as "continuityStatus",
              created_from_event_id is not null and not exists (
                select 1 from review_items
                where workspace_id = $1 and user_id = $2
                  and location_segment_id = ${table}.id and status = 'open'
              ) as "preservesManualCorrection"
       from ${table}
       where workspace_id = $1 and user_id = $2 and device_id = $3 and client_segment_id = any($4::text[])
       order by client_segment_id
       for update`,
      [session.workspaceId, session.userId, deviceId, chunk.map(segment => segment.clientSegmentId)]);
    for (const row of existing.rows) {
      if (row.continuityStatus === "manual" || row.preservesManualCorrection) {
        ids.set(row.clientSegmentId, row.id);
        protectedSegmentIds.add(row.id);
      }
    }
  }
  return {ids, mutable: ordered.filter(segment => !ids.has(segment.clientSegmentId))};
}

async function persistStays(
  client: pg.PoolClient,
  session: RequestSession,
  deviceId: string,
  segments: StaySegment[],
  protectedSegmentIds: Set<string>
): Promise<Map<string, string>> {
  const {ids, mutable} = await lockAndPartitionSegments(client, session, deviceId, "stay_segments", segments, protectedSegmentIds);
  for (const chunk of segmentChunks(mutable)) {
    const parameters = chunk.flatMap(segment => [
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
    ]);
    // Trusted SQL template; only parameter positions vary with the bounded row index.
    const values = chunk.map((_, index) => `(
       $1, $2, $3, $4, $5, $6, 'location_v2', $7, $8, $9, $10,
       $11, $12, $13, $14,
       case when $15::double precision is null or $16::double precision is null then null
            else ST_SetSRID(ST_MakePoint($16, $15), 4326)::geography end,
       $17, $18, $19, $20, $18, 'needs_review', $20, $20, $21::jsonb, now()
     )`.replace(/\$(\d+)/g, (_, position) => `$${index * 21 + Number(position)}`));
    const result = await client.query<{id: string; clientSegmentId: string}>(
      `insert into stay_segments (
       workspace_id, user_id, device_id, client_segment_id, algorithm_version,
       status, source, place_id, learned_place_id, started_at, stopped_at,
       start_lower_bound_at, start_upper_bound_at, stop_lower_bound_at, stop_upper_bound_at,
       centre, radius_m, sample_count, continuity_status, confidence, raw_sample_count,
       review_status, arrival_confidence, departure_confidence, metadata, updated_at
     ) values ${values.join(", ")}
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
     returning id, client_segment_id as "clientSegmentId"`, parameters);
    for (const row of result.rows) ids.set(row.clientSegmentId, row.id);
  }
  return ids;
}

async function persistCommutes(
  client: pg.PoolClient,
  session: RequestSession,
  deviceId: string,
  segments: (CommuteSegment & { fromStayId: string; toStayId: string })[],
  protectedSegmentIds: Set<string>
): Promise<Map<string, string>> {
  const {ids, mutable} = await lockAndPartitionSegments(client, session, deviceId, "commute_segments", segments, protectedSegmentIds);
  for (const chunk of segmentChunks(mutable)) {
    const parameters = chunk.flatMap(segment => [
      session.workspaceId,
      session.userId,
      deviceId,
      segment.clientSegmentId,
      segment.algorithmVersion,
      segment.status,
      segment.startedAt,
      segment.stoppedAt,
      segment.startLowerBoundAt ?? null,
      segment.startUpperBoundAt ?? null,
      segment.stopLowerBoundAt ?? null,
      segment.stopUpperBoundAt ?? null,
      segment.fromStayId,
      segment.toStayId,
      segment.fromPlaceId ?? null,
      segment.toPlaceId ?? null,
      segment.routeDistanceMeters ?? null,
      segment.straightLineDistanceMeters ?? null,
      segment.routeSampleCount,
      segment.maximumObservationGapSeconds,
      segment.continuityStatus,
      segment.confidence,
      JSON.stringify({
        qualificationReason: segment.qualificationReason ?? null
      })
    ]);
    // Trusted SQL template; only parameter positions vary with the bounded row index.
    const values = chunk.map((_, index) => `(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20, $21, $22, $23::jsonb, now()
     )`.replace(/\$(\d+)/g, (_, position) => `$${index * 23 + Number(position)}`));
    const result = await client.query<{id: string; clientSegmentId: string}>(
      `insert into commute_segments (
       workspace_id, user_id, device_id, client_segment_id, algorithm_version, status,
       started_at, stopped_at,
       start_lower_bound_at, start_upper_bound_at, stop_lower_bound_at, stop_upper_bound_at,
       from_stay_segment_id, to_stay_segment_id,
       from_place_id, to_place_id, route_distance_m, straight_line_distance_m,
       route_sample_count, max_gap_seconds, continuity_status, confidence, metadata, updated_at
     ) values ${values.join(", ")}
     on conflict (workspace_id, user_id, device_id, client_segment_id)
     do update set
       status = excluded.status,
       started_at = excluded.started_at,
       stopped_at = excluded.stopped_at,
       start_lower_bound_at = excluded.start_lower_bound_at,
       start_upper_bound_at = excluded.start_upper_bound_at,
       stop_lower_bound_at = excluded.stop_lower_bound_at,
       stop_upper_bound_at = excluded.stop_upper_bound_at,
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
       metadata = excluded.metadata,
       updated_at = now()
     returning id, client_segment_id as "clientSegmentId"`, parameters);
    for (const row of result.rows) ids.set(row.clientSegmentId, row.id);
  }
  return ids;
}

export const LOCATION_LINEAGE_INSERT_CHUNK_SIZE = 250;

type LineageInsertRow = {
  evidence_id: string;
  stay_segment_id: string | null;
  commute_segment_id: string | null;
  sequence_index: number;
  role: "inside" | "route";
  ordinal: number;
};

function* intendedLineageRows(
  segments: LocationSegment[],
  evidenceIds: Map<string, string>,
  stayIds: Map<string, string>,
  commuteIds: Map<string, string>,
  protectedSegmentIds: Set<string>
): Generator<LineageInsertRow> {
  let ordinal = 0;
  for (const segment of segments) {
    const segmentId = segment.kind === "stay"
      ? stayIds.get(segment.clientSegmentId)
      : commuteIds.get(segment.clientSegmentId);
    if (!segmentId || protectedSegmentIds.has(segmentId)) continue;
    for (const [index, clientEvidenceId] of segment.evidenceIds.entries()) {
      const evidenceId = evidenceIds.get(clientEvidenceId);
      if (!evidenceId) continue;
      yield {
        evidence_id: evidenceId,
        stay_segment_id: segment.kind === "stay" ? segmentId : null,
        commute_segment_id: segment.kind === "commute" ? segmentId : null,
        sequence_index: index,
        role: segment.kind === "stay" ? "inside" : "route",
        ordinal: ordinal++
      };
    }
  }
}

async function replaceEvidenceLinks(
  client: pg.PoolClient,
  session: RequestSession,
  segments: LocationSegment[],
  evidenceIds: Map<string, string>,
  stayIds: Map<string, string>,
  commuteIds: Map<string, string>,
  protectedSegmentIds: Set<string>,
  observation: LocationReplayOptions
) {
  const allIds = [...stayIds.values(), ...commuteIds.values()].filter(
    (segmentId) => !protectedSegmentIds.has(segmentId)
  );
  if (allIds.length > 0) {
    observeLocationTiming(observation, "lineage_deletion", "started");
    await client.query(
      `delete from location_segment_evidence
       where workspace_id = $1 and user_id = $2
         and (stay_segment_id = any($3::uuid[]) or commute_segment_id = any($3::uuid[]))`,
      [session.workspaceId, session.userId, allIds]
    );
    observeLocationTiming(observation, "lineage_deletion", "completed");
  } else {
    observeLocationTiming(observation, "lineage_deletion", "started");
    observeLocationTiming(observation, "lineage_deletion", "completed");
  }
  observeLocationTiming(observation, "lineage_insertion", "started");
  if (observation.persistenceProfile === LOCATION_REPLAY_SCALABILITY_PROFILE) {
    let lineageLinksIntended = 0;
    for (const row of intendedLineageRows(segments, evidenceIds, stayIds, commuteIds, protectedSegmentIds)) {
      if (row) lineageLinksIntended += 1;
    }
    observeLocationCount(observation, "lineageLinksIntended", lineageLinksIntended);
    await insertBoundedLineageLinks(
      client,
      session,
      segments,
      evidenceIds,
      stayIds,
      commuteIds,
      protectedSegmentIds,
      observation
    );
    observeLocationTiming(observation, "lineage_insertion", "completed");
    return;
  }
  // Measured lineage dominated driver calls. Bound memory and retain one transaction.
  const parameters: unknown[] = [];
  const rows: string[] = [];
  let lineageLinksPrepared = 0;
  let lineageChunksStarted = 0;
  let lineageChunksCompleted = 0;
  const flush = async () => {
    if (!rows.length) return;
    const chunkLinks = rows.length;
    lineageLinksPrepared += chunkLinks;
    lineageChunksStarted += 1;
    observeLocationCount(observation, "lineageLinksPrepared", lineageLinksPrepared);
    observeLocationCount(observation, "lineageChunksStarted", lineageChunksStarted);
    await client.query(
      `insert into location_segment_evidence (
         workspace_id, user_id, evidence_id, stay_segment_id, commute_segment_id, sequence_index, role
      ) values ${rows.join(", ")} on conflict do nothing`, parameters);
    lineageChunksCompleted += 1;
    observeLocationCount(observation, "lineageChunksCompleted", lineageChunksCompleted);
    parameters.length = 0;
    rows.length = 0;
  };
  for (const segment of segments) {
    const segmentId = segment.kind === "stay"
      ? stayIds.get(segment.clientSegmentId)
      : commuteIds.get(segment.clientSegmentId);
    if (!segmentId || protectedSegmentIds.has(segmentId)) continue;
    for (const [index, clientEvidenceId] of segment.evidenceIds.entries()) {
      const evidenceId = evidenceIds.get(clientEvidenceId);
      if (!evidenceId) continue;
      rows.push(`(${Array.from({length:7}, (_, column) => `$${parameters.length + column + 1}`).join(", ")})`);
      parameters.push(...[
          session.workspaceId,
          session.userId,
          evidenceId,
          segment.kind === "stay" ? segmentId : null,
          segment.kind === "commute" ? segmentId : null,
          index,
          segment.kind === "stay" ? "inside" : "route"
        ]);
      if (rows.length === LOCATION_LINEAGE_INSERT_CHUNK_SIZE) await flush();
    }
  }
  await flush();
  observeLocationTiming(observation, "lineage_insertion", "completed");
}

async function insertBoundedLineageLinks(
  client: pg.PoolClient,
  session: RequestSession,
  segments: LocationSegment[],
  evidenceIds: Map<string, string>,
  stayIds: Map<string, string>,
  commuteIds: Map<string, string>,
  protectedSegmentIds: Set<string>,
  observation: LocationReplayOptions
) {
  let lineageChunksStarted = 0;
  let lineageChunksCompleted = 0;
  let lineageLinksPrepared = 0;
  observeLocationCount(observation, "lineageLinksPrepared", lineageLinksPrepared);
  for (const batch of boundedJsonBatches(
    intendedLineageRows(segments, evidenceIds, stayIds, commuteIds, protectedSegmentIds),
    {
      operation: "lineage_links",
      maxItems: LOCATION_LINEAGE_INSERT_BATCH_SIZE,
      maxBytes: LOCATION_LINEAGE_INSERT_PAYLOAD_MAX_BYTES
    }
  )) {
    lineageLinksPrepared += batch.length;
    observeLocationCount(observation, "lineageLinksPrepared", lineageLinksPrepared);
    lineageChunksStarted += 1;
    observeLocationCount(observation, "lineageChunksStarted", lineageChunksStarted);
    await client.query(
      `insert into location_segment_evidence (
         workspace_id, user_id, evidence_id, stay_segment_id, commute_segment_id, sequence_index, role
       )
       select $1::uuid, $2::uuid, r.evidence_id, r.stay_segment_id, r.commute_segment_id,
              r.sequence_index, r.role
       from jsonb_to_recordset($3::jsonb) as r(
         evidence_id uuid,
         stay_segment_id uuid,
         commute_segment_id uuid,
         sequence_index integer,
         role text,
         ordinal integer
       )
       order by r.ordinal
       on conflict do nothing`,
      [session.workspaceId, session.userId, JSON.stringify(batch)]
    );
    lineageChunksCompleted += 1;
    observeLocationCount(observation, "lineageChunksCompleted", lineageChunksCompleted);
  }
}
