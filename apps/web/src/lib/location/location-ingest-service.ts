import {
  EMPTY_LOCATION_ENGINE_STATE,
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceBatchRequestSchema,
  runLocationEngine,
  type CommuteSegment,
  type LocationEvidenceBatchRequest,
  type LocationRolloutMode,
  type LocationSegment,
  type StaySegment
} from "@dayframe/shared";
import { pool } from "../db";
import type { RequestSession } from "../session";
import { replayLocationEvidence } from "./location-replay-service";
import {
  decideLocationRollout,
  getServerLocationRolloutMode,
  segmentStartedAfterSemanticCutover
} from "./location-rollout";

export const LOCATION_EVIDENCE_BODY_LIMIT_BYTES = 512 * 1024;

export class LocationIngestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "LocationIngestError";
  }
}

export type LocationEvidenceIngestResult = {
  ok: true;
  duplicateBatch: boolean;
  acknowledgedEvidenceIds: string[];
  segmentIds: string[];
  replayVersion: string;
  rolloutMode: LocationRolloutMode;
  clientAcknowledgedMode: boolean;
  warnings: string[];
};

export async function ingestLocationEvidence(
  input: unknown,
  session: RequestSession,
  processingAt = new Date().toISOString()
): Promise<LocationEvidenceIngestResult> {
  const batch = LocationEvidenceBatchRequestSchema.parse(input);
  const rollout = decideLocationRollout(
    getServerLocationRolloutMode(),
    batch.rolloutMode,
    batch.semanticModeAcknowledgedAt
  );
  validateEvidenceTimes(batch, processingAt);
  const classification = classifyForStorage(batch, processingAt);
  const rejected = new Map(classification.rejectedEvidence.map((item) => [item.clientEvidenceId, item.reason]));
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [session.workspaceId, session.userId]
    );
    await client.query(
      `delete from location_evidence evidence
       using (
         select id from location_evidence
         where workspace_id = $1 and user_id = $2 and expires_at < now()
         order by expires_at
         limit 500
       ) expired
       where evidence.id = expired.id`,
      [session.workspaceId, session.userId]
    );
    const summary = evidenceBatchSummary(batch, rollout.effectiveMode);
    const eventResult = await client.query<{ id: string; inserted: boolean }>(
      `insert into activity_events (
         workspace_id, user_id, client_event_id, source, event_type, occurred_at,
         confidence, raw_payload, review_status
       ) values ($1, $2, $3, 'location_learning', 'location_evidence_batch', $4, 'medium', $5::jsonb, 'confirmed')
       on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null
       do update set client_event_id = excluded.client_event_id
       returning id, (xmax = 0) as inserted`,
      [
        session.workspaceId,
        session.userId,
        batchEventId(batch),
        summary.firstOccurredAt,
        JSON.stringify(summary)
      ]
    );
    const duplicateBatch = eventResult.rows[0]?.inserted === false;
    const expiresAt = new Date(Date.parse(processingAt) + LOCATION_ENGINE_V2_CONFIG.rawEvidenceRetentionDays * 86_400_000).toISOString();
    for (const evidence of batch.evidence) {
      const rejectionReason = rejected.get(evidence.clientEvidenceId) ?? null;
      const retainCoordinate = !rejectionReason;
      await client.query(
        `insert into location_evidence (
           workspace_id, user_id, device_id, client_evidence_id, client_batch_id,
           evidence_type, occurred_at, ended_at, coordinate, horizontal_accuracy_m,
           altitude_m, speed_mps, course_degrees, saved_place_id, geofence_identifier,
           accepted, rejection_reason, algorithm_version, time_zone, is_simulated,
           metadata, received_at, expires_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           case when $9::double precision is null or $10::double precision is null then null
                else ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography end,
           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23, $24
         )
         on conflict (workspace_id, user_id, device_id, client_evidence_id) do nothing`,
        [
          session.workspaceId,
          session.userId,
          batch.deviceId,
          evidence.clientEvidenceId,
          batch.clientBatchId,
          evidence.kind,
          evidence.occurredAt,
          evidence.endedAt ?? null,
          retainCoordinate ? evidence.latitude ?? null : null,
          retainCoordinate ? evidence.longitude ?? null : null,
          evidence.horizontalAccuracyMeters ?? null,
          retainCoordinate ? evidence.altitudeMeters ?? null : null,
          retainCoordinate && evidence.speedMetersPerSecond != null && evidence.speedMetersPerSecond >= 0
            ? evidence.speedMetersPerSecond
            : null,
          retainCoordinate && evidence.courseDegrees != null && evidence.courseDegrees >= 0
            ? evidence.courseDegrees
            : null,
          evidence.savedPlaceId ?? null,
          evidence.geofenceIdentifier ?? null,
          !rejectionReason,
          rejectionReason,
          batch.algorithmVersion,
          batch.timeZone,
          evidence.isSimulated ?? null,
          JSON.stringify(evidence.metadata ?? {}),
          evidence.receivedAt,
          expiresAt
        ]
      );
    }

    const replay = await replayLocationEvidence(client, session, {
      deviceId: batch.deviceId,
      algorithmVersion: batch.algorithmVersion,
      processingAt
    });
    if (rollout.emitV2ReviewItems && rollout.semanticCutoverAt) {
      for (const segment of replay.segments.filter((item) =>
        item.status === "finalised" &&
        segmentStartedAfterSemanticCutover(item.startedAt, rollout.semanticCutoverAt!)
      )) {
        await emitSemanticSegment(client, session, segment, replay.stayIds, replay.commuteIds);
      }
    }
    await client.query("commit");
    const warnings = [
      ...(classification.rejectedEvidence.length > 0
        ? [`${classification.rejectedEvidence.length} evidence item(s) were retained without coordinates for diagnostics.`]
        : []),
      ...(rollout.effectiveMode === "v2_shadow"
        ? ["V2 shadow mode stored segments without replacing V1 suggestions."]
        : []),
      ...(!rollout.clientAcknowledgedMode
        ? ["The client has not acknowledged the server rollout mode; V2 semantic output was suppressed."]
        : []),
      ...(rollout.clientAcknowledgedMode &&
          (rollout.effectiveMode === "v2_review" || rollout.effectiveMode === "v2_enabled") &&
          !rollout.semanticCutoverAt
        ? ["The client did not provide a semantic-mode cutover; V2 semantic output was suppressed."]
        : []),
      ...replay.diagnostics.warningCodes
    ];
    return {
      ok: true,
      duplicateBatch,
      acknowledgedEvidenceIds: batch.evidence.map((item) => item.clientEvidenceId),
      segmentIds: [...replay.stayIds.keys(), ...replay.commuteIds.keys()],
      replayVersion: batch.algorithmVersion,
      rolloutMode: rollout.effectiveMode,
      clientAcknowledgedMode: rollout.clientAcknowledgedMode,
      warnings
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function validateEvidenceTimes(batch: LocationEvidenceBatchRequest, processingAt: string) {
  const now = Date.parse(processingAt);
  const earliest = now - 30 * 86_400_000;
  const latest = now + 10 * 60_000;
  for (const evidence of batch.evidence) {
    const time = Date.parse(evidence.occurredAt);
    if (!Number.isFinite(time) || time < earliest || time > latest) {
      throw new LocationIngestError(
        "Location evidence timestamp falls outside the accepted replay window.",
        422,
        "invalid_evidence_time"
      );
    }
  }
  if (batch.semanticModeAcknowledgedAt) {
    const acknowledgedAt = Date.parse(batch.semanticModeAcknowledgedAt);
    if (acknowledgedAt < earliest || acknowledgedAt > latest) {
      throw new LocationIngestError(
        "The semantic-mode acknowledgement falls outside the accepted replay window.",
        422,
        "invalid_semantic_mode_acknowledgement"
      );
    }
  }
}

function classifyForStorage(batch: LocationEvidenceBatchRequest, processingAt: string) {
  return runLocationEngine({
    priorState: { ...EMPTY_LOCATION_ENGINE_STATE, algorithmVersion: batch.algorithmVersion },
    evidence: batch.evidence,
    savedPlaces: [],
    acceptedLearnedPlaces: [],
    config: { ...LOCATION_ENGINE_V2_CONFIG, algorithmVersion: batch.algorithmVersion },
    processingAt
  });
}

function batchEventId(batch: LocationEvidenceBatchRequest) {
  return `location-batch:${batch.deviceId}:${batch.clientBatchId}`.slice(0, 160);
}

function evidenceBatchSummary(
  batch: LocationEvidenceBatchRequest,
  effectiveRolloutMode: LocationRolloutMode
) {
  const sorted = [...batch.evidence].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const evidenceKinds = batch.evidence.reduce<Record<string, number>>((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, {});
  return {
    clientBatchId: batch.clientBatchId,
    deviceId: batch.deviceId,
    algorithmVersion: batch.algorithmVersion,
    requestedRolloutMode: batch.rolloutMode,
    effectiveRolloutMode,
    semanticModeAcknowledgedAt: batch.semanticModeAcknowledgedAt ?? null,
    evidenceCount: batch.evidence.length,
    firstOccurredAt: sorted[0].occurredAt,
    lastOccurredAt: sorted.at(-1)!.occurredAt,
    evidenceKinds
  };
}

async function emitSemanticSegment(
  client: import("pg").PoolClient,
  session: RequestSession,
  segment: LocationSegment,
  stayIds: Map<string, string>,
  commuteIds: Map<string, string>
) {
  const databaseSegmentId = segment.kind === "stay"
    ? stayIds.get(segment.clientSegmentId)
    : commuteIds.get(segment.clientSegmentId);
  if (!databaseSegmentId) return;
  const eventType = segment.kind === "commute"
    ? "commute_detected"
    : segment.placeMatchKind === "learned"
      ? "learned_place_visit"
      : segment.placeMatchKind === "saved"
        ? "geofence_exit"
        : "unknown_stay";
  const placeId = segment.kind === "stay" ? segment.placeId ?? null : null;
  if (segment.kind === "stay" && segment.placeMatchKind === "unknown") {
    const duration = Date.parse(segment.stoppedAt ?? segment.startedAt) - Date.parse(segment.startedAt);
    if (duration < LOCATION_ENGINE_V2_CONFIG.unknownStayReviewDwellMs) return;
  }
  if (segment.kind === "stay" && placeId) {
    const place = await client.query<{ name: string; loggingEnabled: boolean }>(
      `select name, logging_enabled as "loggingEnabled" from places
       where id = $1 and workspace_id = $2`,
      [placeId, session.workspaceId]
    );
    if (place.rows[0] && !place.rows[0].loggingEnabled) return;
  }
  const rawPayload = segment.kind === "stay"
    ? {
        clientSegmentId: segment.clientSegmentId,
        algorithmVersion: segment.algorithmVersion,
        placeMatchKind: segment.placeMatchKind,
        evidenceCount: segment.evidenceIds.length,
        continuityStatus: segment.continuityStatus,
        startedAt: segment.startedAt,
        stoppedAt: segment.stoppedAt
      }
    : {
        clientSegmentId: segment.clientSegmentId,
        algorithmVersion: segment.algorithmVersion,
        fromStaySegmentId: segment.fromStaySegmentId,
        toStaySegmentId: segment.toStaySegmentId,
        routeSampleCount: segment.routeSampleCount,
        continuityStatus: segment.continuityStatus,
        startedAt: segment.startedAt,
        stoppedAt: segment.stoppedAt
      };
  const event = await client.query<{ id: string }>(
    `insert into activity_events (
       workspace_id, user_id, client_event_id, source, event_type, occurred_at,
       confidence, raw_payload, suggested_place_id, review_status
     ) values ($1, $2, $3, 'location_learning', $4, $5, $6, $7::jsonb, $8, 'needs_review')
     on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null
     do update set client_event_id = excluded.client_event_id
     returning id`,
    [
      session.workspaceId,
      session.userId,
      `location-segment:${segment.clientSegmentId}`.slice(0, 160),
      eventType,
      segment.startedAt,
      segment.confidence,
      JSON.stringify(rawPayload),
      placeId
    ]
  );
  const title = await segmentTitle(client, session, segment);
  await client.query(
    `insert into review_items (
       workspace_id, user_id, event_id, location_segment_id, type, title,
       suggested_place_id, suggested_started_at, suggested_stopped_at,
       confidence, status, notes
     )
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11
     where not exists (
       select 1 from review_items where workspace_id = $1 and user_id = $2 and event_id = $3
     )`,
    [
      session.workspaceId,
      session.userId,
      event.rows[0].id,
      databaseSegmentId,
      `${eventType}_suggestion`,
      title,
      placeId,
      segment.startedAt,
      segment.stoppedAt,
      segment.confidence,
      segment.continuityStatus === "uncertain_gap"
        ? "The boundary includes an evidence gap; inspect the timeline before confirming."
        : "Ordered location evidence supports this suggestion."
    ]
  );
  await client.query(
    `update ${segment.kind === "stay" ? "stay_segments" : "commute_segments"}
     set created_from_event_id = $1, updated_at = now()
     where id = $2 and workspace_id = $3 and user_id = $4`,
    [event.rows[0].id, databaseSegmentId, session.workspaceId, session.userId]
  );
}

async function segmentTitle(
  client: import("pg").PoolClient,
  session: RequestSession,
  segment: StaySegment | CommuteSegment
) {
  if (segment.kind === "commute") return "Possible journey";
  if (!segment.placeId) return segment.placeMatchKind === "ambiguous" ? "Visit near saved places" : "Visit at an unknown place";
  const place = await client.query<{ name: string }>(
    "select name from places where id = $1 and workspace_id = $2",
    [segment.placeId, session.workspaceId]
  );
  return place.rows[0] ? `Visit ${place.rows[0].name}` : "Visit at a saved place";
}
