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
import { locationSemanticDisposition } from "./location-semantic-policy";

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
        await emitSemanticSegment(
          client,
          session,
          rollout.effectiveMode,
          segment,
          replay.stayIds,
          replay.commuteIds
        );
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
  rolloutMode: LocationRolloutMode,
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
  const trustedPlace = segment.kind === "stay"
    ? await trustedPlaceContext(client, session, segment)
    : null;
  const placeId = trustedPlace?.placeId ?? (segment.kind === "stay" ? segment.placeId ?? null : null);
  if (segment.kind === "stay" && segment.placeMatchKind === "unknown") {
    const duration = Date.parse(segment.stoppedAt ?? segment.startedAt) - Date.parse(segment.startedAt);
    if (duration < LOCATION_ENGINE_V2_CONFIG.unknownStayReviewDwellMs) return;
  }
  if (trustedPlace && !trustedPlace.loggingEnabled) return;
  let disposition = locationSemanticDisposition(rolloutMode, segment);
  if (disposition.action === "auto_confirm" && !trustedPlace) {
    disposition = { action: "review", reason: "untrusted_place" };
  }
  const overlapsConfirmedTime = disposition.action === "auto_confirm"
    ? await hasConfirmedTimeOverlap(
        client,
        session,
        segment.startedAt,
        segment.stoppedAt!,
        segmentEventClientId(segment)
      )
    : false;
  const autoConfirm = disposition.action === "auto_confirm" && !overlapsConfirmedTime;
  const rawPayload = segment.kind === "stay"
    ? {
        clientSegmentId: segment.clientSegmentId,
        algorithmVersion: segment.algorithmVersion,
        placeMatchKind: segment.placeMatchKind,
        evidenceCount: segment.evidenceIds.length,
        continuityStatus: segment.continuityStatus,
        startedAt: segment.startedAt,
        stoppedAt: segment.stoppedAt,
        semanticDisposition: autoConfirm ? "auto_confirmed" : "needs_review",
        semanticReason: overlapsConfirmedTime ? "confirmed_time_overlap" : disposition.reason
      }
    : {
        clientSegmentId: segment.clientSegmentId,
        algorithmVersion: segment.algorithmVersion,
        fromStaySegmentId: segment.fromStaySegmentId,
        toStaySegmentId: segment.toStaySegmentId,
        routeSampleCount: segment.routeSampleCount,
        continuityStatus: segment.continuityStatus,
        startedAt: segment.startedAt,
        stoppedAt: segment.stoppedAt,
        semanticDisposition: "needs_review",
        semanticReason: disposition.reason
      };
  const event = await client.query<{ id: string }>(
     `insert into activity_events (
       workspace_id, user_id, client_event_id, source, event_type, occurred_at,
       confidence, raw_payload, suggested_category_id, suggested_place_id, review_status
     ) values ($1, $2, $3, 'location_learning', $4, $5, $6, $7::jsonb, $8, $9, $10)
     on conflict (workspace_id, user_id, client_event_id) where client_event_id is not null
     do update set client_event_id = excluded.client_event_id
     returning id`,
    [
      session.workspaceId,
      session.userId,
      segmentEventClientId(segment),
      eventType,
      segment.startedAt,
      segment.confidence,
      JSON.stringify(rawPayload),
      trustedPlace?.categoryId ?? null,
      placeId,
      autoConfirm ? "confirmed" : "needs_review"
    ]
  );
  const title = trustedPlace?.description ?? await segmentTitle(client, session, segment);
  if (autoConfirm) {
    await client.query(
      `insert into time_entries (
         workspace_id, user_id, category_id, place_id, source, confidence, review_status,
         description, started_at, stopped_at, created_from_event_id
       )
       select $1, $2, $3, $4, 'location_learning', $5, 'confirmed', $6, $7, $8, $9
       where not exists (
         select 1 from time_entries
         where workspace_id = $1 and user_id = $2 and created_from_event_id = $9
       )`,
      [
        session.workspaceId,
        session.userId,
        trustedPlace!.categoryId,
        trustedPlace!.placeId,
        segment.confidence,
        title,
        segment.startedAt,
        segment.stoppedAt,
        event.rows[0].id
      ]
    );
  } else {
    await client.query(
      `insert into review_items (
         workspace_id, user_id, event_id, location_segment_id, type, title,
         suggested_category_id, suggested_place_id, suggested_started_at, suggested_stopped_at,
         confidence, status, notes
       )
       select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', $12
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
        trustedPlace?.categoryId ?? null,
        placeId,
        segment.startedAt,
        segment.stoppedAt,
        segment.confidence,
        overlapsConfirmedTime
          ? "This detected visit overlaps existing tracked time and needs review."
          : segment.continuityStatus === "uncertain_gap"
            ? "The boundary includes an evidence gap; inspect the timeline before confirming."
            : "Ordered location evidence supports this suggestion."
      ]
    );
  }
  if (segment.kind === "stay") {
    await client.query(
      `update stay_segments
       set created_from_event_id = $1, review_status = $2, updated_at = now()
       where id = $3 and workspace_id = $4 and user_id = $5`,
      [
        event.rows[0].id,
        autoConfirm ? "confirmed" : "needs_review",
        databaseSegmentId,
        session.workspaceId,
        session.userId
      ]
    );
  } else {
    await client.query(
      `update commute_segments set created_from_event_id = $1, updated_at = now()
       where id = $2 and workspace_id = $3 and user_id = $4`,
      [event.rows[0].id, databaseSegmentId, session.workspaceId, session.userId]
    );
  }
}

type TrustedPlaceContext = {
  placeId: string;
  categoryId: string | null;
  description: string;
  loggingEnabled: boolean;
};

async function trustedPlaceContext(
  client: import("pg").PoolClient,
  session: RequestSession,
  segment: StaySegment
): Promise<TrustedPlaceContext | null> {
  if (segment.placeMatchKind === "saved" && segment.placeId) {
    const result = await client.query<{
      placeId: string;
      name: string;
      categoryId: string | null;
      description: string | null;
      loggingEnabled: boolean;
    }>(
      `select id as "placeId", name, default_category_id as "categoryId",
              default_activity_description as description, logging_enabled as "loggingEnabled"
       from places where id = $1 and workspace_id = $2`,
      [segment.placeId, session.workspaceId]
    );
    const place = result.rows[0];
    return place ? {
      placeId: place.placeId,
      categoryId: place.categoryId,
      description: place.description?.trim() || `Visit ${place.name}`,
      loggingEnabled: place.loggingEnabled
    } : null;
  }
  if (segment.placeMatchKind === "learned" && segment.learnedPlaceId) {
    const result = await client.query<{
      placeId: string;
      name: string;
      categoryId: string | null;
      description: string | null;
      loggingEnabled: boolean;
    }>(
      `select p.id as "placeId", coalesce(p.name, lp.name) as name,
              p.default_category_id as "categoryId", p.default_activity_description as description,
              p.logging_enabled as "loggingEnabled"
       from learned_places lp
       join places p on p.id = lp.place_id and p.workspace_id = lp.workspace_id
       where lp.id = $1 and lp.workspace_id = $2 and lp.user_id = $3 and lp.status = 'accepted'`,
      [segment.learnedPlaceId, session.workspaceId, session.userId]
    );
    const place = result.rows[0];
    return place ? {
      placeId: place.placeId,
      categoryId: place.categoryId,
      description: place.description?.trim() || `Visit ${place.name}`,
      loggingEnabled: place.loggingEnabled
    } : null;
  }
  return null;
}

async function hasConfirmedTimeOverlap(
  client: import("pg").PoolClient,
  session: RequestSession,
  startedAt: string,
  stoppedAt: string,
  clientEventId: string
) {
  const overlap = await client.query(
    `select 1 from time_entries
     where workspace_id = $1 and user_id = $2
       and review_status in ('confirmed', 'accepted')
       and started_at < $4 and coalesce(stopped_at, 'infinity'::timestamptz) > $3
       and not exists (
         select 1 from activity_events ae
         where ae.id = time_entries.created_from_event_id
           and ae.workspace_id = $1 and ae.user_id = $2 and ae.client_event_id = $5
       )
     limit 1`,
    [session.workspaceId, session.userId, startedAt, stoppedAt, clientEventId]
  );
  return Boolean(overlap.rows[0]);
}

function segmentEventClientId(segment: LocationSegment) {
  return `location-segment:${segment.clientSegmentId}`.slice(0, 160);
}

async function segmentTitle(
  client: import("pg").PoolClient,
  session: RequestSession,
  segment: StaySegment | CommuteSegment
) {
  if (segment.kind === "commute") return "Possible journey";
  if (segment.learnedPlaceId) {
    const learned = await client.query<{ name: string }>(
      "select name from learned_places where id = $1 and workspace_id = $2 and user_id = $3",
      [segment.learnedPlaceId, session.workspaceId, session.userId]
    );
    if (learned.rows[0]) return `Visit ${learned.rows[0].name}`;
  }
  if (!segment.placeId) return segment.placeMatchKind === "ambiguous" ? "Visit near saved places" : "Visit at an unknown place";
  const place = await client.query<{ name: string }>(
    "select name from places where id = $1 and workspace_id = $2",
    [segment.placeId, session.workspaceId]
  );
  return place.rows[0] ? `Visit ${place.rows[0].name}` : "Visit at a saved place";
}
