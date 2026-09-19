import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  LOCATION_ENGINE_V2_CONFIG,
  runLocationEngine,
  type LocationEngineInput,
  type LocationSegment,
  type StaySegment
} from "@dayframe/shared";
import {
  savedPlaceArrivalBoundaryFixture,
  type SavedPlaceArrivalFixtureOptions
} from "../../packages/shared/src/location/savedPlaceArrivalBoundaryFixture";
import { pool } from "../../apps/web/src/lib/db";
import { ingestLocationEvidence, replayRetainedLocationEvidence } from "../../apps/web/src/lib/location/location-ingest-service";
import { resolveIdempotentReviewMutation } from "../../apps/web/src/lib/review-mutation-service";
import type { RequestSession } from "../../apps/web/src/lib/session";

type ArrivalFixture = LocationEngineInput & {
  targetPlaceId: string;
  originPlaceId: string;
};

type ArrivalOwner = {
  session: RequestSession;
  deviceId: string;
  request: {
    deviceId: string;
    algorithmVersion: string;
    rolloutMode: "v2_review";
    semanticModeAcknowledgedAt: string;
  };
};

function fixture(options: SavedPlaceArrivalFixtureOptions = {}): ArrivalFixture {
  const source = savedPlaceArrivalBoundaryFixture(options);
  const originPlaceId = randomUUID();
  const targetPlaceId = randomUUID();
  const deviceId = randomUUID();
  const placeIds = new Map([
    [source.savedPlaces[0].id, originPlaceId],
    [source.savedPlaces[1].id, targetPlaceId]
  ]);
  return {
    ...source,
    savedPlaces: source.savedPlaces.map((place) => ({
      ...place,
      id: placeIds.get(place.id)!
    })),
    evidence: source.evidence.map((evidence) => ({
      ...evidence,
      deviceId,
      savedPlaceId: evidence.savedPlaceId ? placeIds.get(evidence.savedPlaceId) ?? null : null
    })),
    targetPlaceId,
    originPlaceId
  };
}

function ownerFor(fixtureInput: ArrivalFixture): ArrivalOwner {
  const session: RequestSession = {
    workspaceId: randomUUID(),
    userId: randomUUID(),
    authMode: "token",
    scopes: ["app:read", "app:write", "events:write"]
  };
  const deviceId = fixtureInput.evidence[0].deviceId;
  return {
    session,
    deviceId,
    request: {
      deviceId,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review",
      semanticModeAcknowledgedAt: "2026-09-17T00:00:00.000Z"
    }
  };
}

async function seedOwner(owner: ArrivalOwner, fixtureInput: ArrivalFixture) {
  const { session } = owner;
  await pool.query(
    "insert into users (id, email, name) values ($1, $2, $3)",
    [session.userId, `${session.userId}@arrival-boundary.example.test`, "Synthetic arrival boundary"]
  );
  await pool.query(
    "insert into workspaces (id, name) values ($1, $2)",
    [session.workspaceId, "Synthetic arrival boundary"]
  );
  await pool.query(
    "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
    [session.workspaceId, session.userId]
  );
  await pool.query(
    "insert into devices (id, user_id, platform, name) values ($1, $2, 'ios', 'Synthetic arrival boundary')",
    [owner.deviceId, session.userId]
  );
  for (const place of fixtureInput.savedPlaces) {
    await pool.query(
      `insert into places (
         id, workspace_id, name, latitude, longitude, radius_meters, priority, logging_enabled
       ) values ($1, $2, $3, $4, $5, $6, 5, true)`,
      [place.id, session.workspaceId, place.name, place.latitude, place.longitude, place.radiusMeters]
    );
  }
}

async function ingest(owner: ArrivalOwner, fixtureInput: ArrivalFixture) {
  await ingestLocationEvidence(
    {
      ...owner.request,
      clientBatchId: randomUUID(),
      timeZone: "Europe/London",
      evidence: fixtureInput.evidence
    },
    owner.session,
    fixtureInput.processingAt
  );
}

async function replay(
  owner: ArrivalOwner,
  processingAt: string,
  options: Parameters<typeof replayRetainedLocationEvidence>[3] = {}
) {
  return replayRetainedLocationEvidence(owner.request, owner.session, processingAt, options);
}

async function segmentRows(owner: ArrivalOwner) {
  const result = await pool.query<{
    id: string;
    kind: "stay" | "commute";
    clientSegmentId: string;
    startedAt: Date | string;
    stoppedAt: Date | string | null;
    startLowerBoundAt: Date | string | null;
    startUpperBoundAt: Date | string | null;
    stopLowerBoundAt: Date | string | null;
    stopUpperBoundAt: Date | string | null;
    status: string;
    confidence: string;
    continuityStatus: string;
    placeId: string | null;
    toPlaceId: string | null;
    fromPlaceId: string | null;
    routeSampleCount: number | null;
    maxGapSeconds: number | null;
  }>(
    `select id, 'stay' as kind, client_segment_id as "clientSegmentId",
            started_at as "startedAt", stopped_at as "stoppedAt",
            start_lower_bound_at as "startLowerBoundAt", start_upper_bound_at as "startUpperBoundAt",
            stop_lower_bound_at as "stopLowerBoundAt", stop_upper_bound_at as "stopUpperBoundAt",
            status, confidence, continuity_status as "continuityStatus", place_id as "placeId",
            null::uuid as "toPlaceId", null::uuid as "fromPlaceId",
            null::integer as "routeSampleCount", null::integer as "maxGapSeconds"
     from stay_segments where workspace_id = $1 and user_id = $2
     union all
     select id, 'commute' as kind, client_segment_id as "clientSegmentId",
            started_at as "startedAt", stopped_at as "stoppedAt",
            start_lower_bound_at as "startLowerBoundAt", start_upper_bound_at as "startUpperBoundAt",
            stop_lower_bound_at as "stopLowerBoundAt", stop_upper_bound_at as "stopUpperBoundAt",
            status, confidence, continuity_status as "continuityStatus", null::uuid as "placeId",
            to_place_id as "toPlaceId", from_place_id as "fromPlaceId",
            route_sample_count as "routeSampleCount", max_gap_seconds as "maxGapSeconds"
     from commute_segments where workspace_id = $1 and user_id = $2
     order by "startedAt", kind, "clientSegmentId"`,
    [owner.session.workspaceId, owner.session.userId]
  );
  return result.rows;
}

function iso(value: Date | string | null) {
  return value == null ? null : new Date(value).toISOString();
}

function assertPersistedSegmentMatches(segment: LocationSegment, row: Awaited<ReturnType<typeof segmentRows>>[number]) {
  assert.equal(row.kind, segment.kind);
  assert.equal(row.clientSegmentId, segment.clientSegmentId);
  assert.equal(iso(row.startedAt), segment.startedAt);
  assert.equal(iso(row.stoppedAt), segment.stoppedAt ?? null);
  assert.equal(iso(row.startLowerBoundAt), segment.startLowerBoundAt ?? null);
  assert.equal(iso(row.startUpperBoundAt), segment.startUpperBoundAt ?? null);
  assert.equal(iso(row.stopLowerBoundAt), segment.stopLowerBoundAt ?? null);
  assert.equal(iso(row.stopUpperBoundAt), segment.stopUpperBoundAt ?? null);
  assert.equal(row.confidence, segment.confidence);
  assert.equal(row.continuityStatus, segment.continuityStatus);
  if (segment.kind === "stay") {
    assert.equal(row.placeId, segment.placeId ?? null);
  } else {
    assert.equal(row.fromPlaceId, segment.fromPlaceId ?? null);
    assert.equal(row.toPlaceId, segment.toPlaceId ?? null);
    assert.equal(row.routeSampleCount, segment.routeSampleCount);
    assert.equal(row.maxGapSeconds, segment.maximumObservationGapSeconds);
  }
}

async function segmentId(owner: ArrivalOwner, clientSegmentId: string, kind: "stay" | "commute") {
  const table = kind === "stay" ? "stay_segments" : "commute_segments";
  const result = await pool.query<{ id: string }>(
    `select id from ${table} where workspace_id = $1 and user_id = $2 and client_segment_id = $3`,
    [owner.session.workspaceId, owner.session.userId, clientSegmentId]
  );
  assert.equal(result.rowCount, 1, `Missing persisted ${kind} ${clientSegmentId}`);
  return result.rows[0].id;
}

async function lineage(owner: ArrivalOwner, id: string, kind: "stay" | "commute") {
  const column = kind === "stay" ? "stay_segment_id" : "commute_segment_id";
  const result = await pool.query<{ clientEvidenceId: string }>(
    `select le.client_evidence_id as "clientEvidenceId"
     from location_segment_evidence lse
     join location_evidence le on le.id = lse.evidence_id
     where lse.workspace_id = $1 and lse.user_id = $2 and lse.${column} = $3
     order by lse.sequence_index`,
    [owner.session.workspaceId, owner.session.userId, id]
  );
  return result.rows.map((row) => row.clientEvidenceId);
}

async function replaySnapshot(owner: ArrivalOwner) {
  const tables = [
    "stay_segments",
    "commute_segments",
    "activity_events",
    "review_items",
    "time_entries",
    "location_segment_evidence"
  ];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [
    table,
    (await pool.query(
      `select * from ${table} where workspace_id = $1 and user_id = $2 order by id`,
      [owner.session.workspaceId, owner.session.userId]
    )).rows
  ])));
}

async function cleanup(owner: ArrivalOwner) {
  await pool.query("delete from workspaces where id = $1", [owner.session.workspaceId]);
  await pool.query("delete from users where id = $1", [owner.session.userId]);
}

async function validateFullSupport() {
  const fixtureInput = fixture();
  const owner = ownerFor(fixtureInput);
  await seedOwner(owner, fixtureInput);
  try {
    await ingest(owner, fixtureInput);
    const expected = runLocationEngine(fixtureInput);
    const expectedTarget = expected.segmentUpserts.find(
      (segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === fixtureInput.targetPlaceId
    );
    const expectedInbound = expected.segmentUpserts.find(
      (segment) => segment.kind === "commute" && segment.toPlaceId === fixtureInput.targetPlaceId
    );
    assert(expectedTarget, "Synthetic full-support fixture produced no target stay.");
    assert(expectedInbound, "Synthetic full-support fixture produced no inbound commute.");
    assert.equal(expectedTarget.startedAt, "2026-09-17T11:32:51.000Z");
    assert.equal(expectedTarget.stoppedAt, "2026-09-17T12:34:53.000Z");
    assert.equal(expectedTarget.confidence, "medium");
    assert.equal(expectedInbound.stoppedAt, expectedTarget.startedAt);
    assert.equal(expectedInbound.confidence, "low");

    const beforeFailedReplay = await replaySnapshot(owner);
    const failingPool = {
      connect: async () => {
        const raw = await pool.connect();
        return new Proxy(raw, {
          get(client, key) {
            if (key === "query") {
              return async (sql: string, parameters?: unknown[]) => {
                if (/insert into review_items/i.test(sql)) throw new Error("Synthetic failure after semantic write");
                return client.query(sql, parameters);
              };
            }
            const value = Reflect.get(client, key);
            return typeof value === "function" ? value.bind(client) : value;
          }
        });
      }
    } as Pick<pg.Pool, "connect">;
    await assert.rejects(replay(owner, fixtureInput.processingAt, { databasePool: failingPool }));
    assert.deepEqual(await replaySnapshot(owner), beforeFailedReplay, "Arrival replay failure did not roll back all semantic writes.");

    const response = await replay(owner, fixtureInput.processingAt);
    assert.equal(response.rolloutMode, "v2_review");
    assert(response.semanticSegmentCount > 0, "Full-support replay emitted no Review semantics.");
    const rows = await segmentRows(owner);
    for (const segment of expected.segmentUpserts) {
      const row = rows.find((candidate) => candidate.clientSegmentId === segment.clientSegmentId);
      assert(row, `Missing persisted ${segment.kind} ${segment.clientSegmentId}`);
      assertPersistedSegmentMatches(segment, row);
    }
    const targetId = await segmentId(owner, expectedTarget.clientSegmentId, "stay");
    assert.deepEqual(await lineage(owner, targetId, "stay"), expectedTarget.evidenceIds);
    const inboundId = await segmentId(owner, expectedInbound.clientSegmentId, "commute");
    assert.deepEqual(await lineage(owner, inboundId, "commute"), expectedInbound.evidenceIds);
    const targetReview = await pool.query<{ status: string; confidence: string; suggestedStartedAt: Date | string; suggestedStoppedAt: Date | string }>(
      `select status, confidence, suggested_started_at as "suggestedStartedAt",
              suggested_stopped_at as "suggestedStoppedAt"
       from review_items where workspace_id = $1 and user_id = $2 and location_segment_id = $3`,
      [owner.session.workspaceId, owner.session.userId, targetId]
    );
    assert.equal(targetReview.rowCount, 1);
    assert.deepEqual(targetReview.rows[0], {
      status: "open",
      confidence: "medium",
      suggestedStartedAt: targetReview.rows[0].suggestedStartedAt,
      suggestedStoppedAt: targetReview.rows[0].suggestedStoppedAt
    });
    assert.equal(iso(targetReview.rows[0].suggestedStartedAt), expectedTarget.startedAt);
    assert.equal(iso(targetReview.rows[0].suggestedStoppedAt), expectedTarget.stoppedAt);
    assert.equal(
      (await pool.query("select count(*)::int as count from time_entries where workspace_id = $1 and user_id = $2", [owner.session.workspaceId, owner.session.userId])).rows[0].count,
      0,
      "Review-mode arrival inference created a time entry."
    );
  } finally {
    await cleanup(owner);
  }
}

async function validateFallback() {
  const fixtureInput = fixture({ includeVisit: false });
  const owner = ownerFor(fixtureInput);
  await seedOwner(owner, fixtureInput);
  try {
    await ingest(owner, fixtureInput);
    const expected = runLocationEngine(fixtureInput);
    const expectedTarget = expected.segmentUpserts.find(
      (segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === fixtureInput.targetPlaceId
    );
    const expectedReturn = expected.segmentUpserts.find(
      (segment) => segment.kind === "commute" && segment.fromPlaceId === fixtureInput.targetPlaceId
    );
    assert(expectedTarget, "Synthetic fallback fixture produced no later target stay.");
    assert(expectedReturn, "Synthetic fallback fixture produced no return commute.");
    assert(!expected.segmentUpserts.some(
      (segment) => segment.kind === "commute" && segment.toPlaceId === fixtureInput.targetPlaceId
    ), "Fallback fixture still produced the conflicting spanning commute.");
    await replay(owner, fixtureInput.processingAt);
    const conflicting = await pool.query(
      `select 1 from commute_segments
       where workspace_id = $1 and user_id = $2 and to_place_id = $3 and status <> 'superseded'`,
      [owner.session.workspaceId, owner.session.userId, fixtureInput.targetPlaceId]
    );
    assert.equal(conflicting.rowCount, 0, "Server replay persisted the suppressed spanning commute.");
    const rows = await segmentRows(owner);
    assert(rows.some((row) => row.clientSegmentId === expectedTarget.clientSegmentId), "Later target stay was lost.");
    assert(rows.some((row) => row.clientSegmentId === expectedReturn.clientSegmentId), "Return commute was lost.");
  } finally {
    await cleanup(owner);
  }
}

async function insertConfirmedHistory(owner: ArrivalOwner, fixtureInput: ArrivalFixture) {
  const { session } = owner;
  const historicalOriginId = randomUUID();
  const historicalGymId = randomUUID();
  const historicalGymEventId = randomUUID();
  const historicalGymReviewId = randomUUID();
  const historicalCommuteId = randomUUID();
  const historicalCommuteEventId = randomUUID();
  const historicalCommuteReviewId = randomUUID();
  const historicalGymMutationId = randomUUID();
  const historicalCommuteMutationId = randomUUID();
  const oldStartedAt = "2026-09-17T12:21:00.000Z";
  const oldStoppedAt = "2026-09-17T12:34:00.000Z";

  await pool.query(
    `insert into stay_segments (
       id, workspace_id, user_id, device_id, client_segment_id, algorithm_version,
       status, source, place_id, started_at, stopped_at,
       start_lower_bound_at, start_upper_bound_at, stop_lower_bound_at, stop_upper_bound_at,
       confidence, raw_sample_count, sample_count, continuity_status, review_status, metadata
     ) values ($1, $2, $3, $4, 'confirmed-historical-origin', $5, 'finalised', 'location_v2', $6,
       '2026-09-17T10:50:00.000Z', '2026-09-17T11:06:00.000Z',
       '2026-09-17T10:50:00.000Z', '2026-09-17T10:50:00.000Z',
       '2026-09-17T11:06:00.000Z', '2026-09-17T11:20:00.000Z',
       'medium_high', 3, 3, 'uncertain_gap', 'needs_review', '{"placeMatchKind":"saved"}'::jsonb)`,
    [historicalOriginId, session.workspaceId, session.userId, owner.deviceId, LOCATION_ENGINE_V2_CONFIG.algorithmVersion, fixtureInput.originPlaceId]
  );
  await pool.query(
    `insert into activity_events (
       id, workspace_id, user_id, device_id, client_event_id, source, event_type,
       occurred_at, confidence, review_status, raw_payload
     ) values ($1, $2, $3, $4, 'location-segment:confirmed-historical-gym',
       'location_learning', 'geofence_exit', $5, 'medium_high', 'needs_review', $6::jsonb)`,
    [historicalGymEventId, session.workspaceId, session.userId, owner.deviceId, oldStartedAt, JSON.stringify({ clientSegmentId: "confirmed-historical-gym", startedAt: oldStartedAt, stoppedAt: oldStoppedAt })]
  );
  await pool.query(
    `insert into stay_segments (
       id, workspace_id, user_id, device_id, client_segment_id, algorithm_version,
       status, source, place_id, started_at, stopped_at,
       start_lower_bound_at, start_upper_bound_at, stop_lower_bound_at, stop_upper_bound_at,
       confidence, raw_sample_count, sample_count, continuity_status, review_status,
       created_from_event_id, metadata
     ) values ($1, $2, $3, $4, 'confirmed-historical-gym', $5, 'finalised', 'location_v2', $6,
       $7, $8, $7, $7, $8, $8, 'medium_high', 2, 2, 'uncertain_gap', 'needs_review', $9,
       '{"placeMatchKind":"saved"}'::jsonb)`,
    [historicalGymId, session.workspaceId, session.userId, owner.deviceId, LOCATION_ENGINE_V2_CONFIG.algorithmVersion, fixtureInput.targetPlaceId, oldStartedAt, oldStoppedAt, historicalGymEventId]
  );
  await pool.query(
    `insert into review_items (
       id, workspace_id, user_id, event_id, location_segment_id, type, title,
       suggested_place_id, suggested_started_at, suggested_stopped_at, confidence, status
     ) values ($1, $2, $3, $4, $5, 'geofence_exit_suggestion', 'Confirmed historical gym',
       $6, $7, $8, 'medium_high', 'open')`,
    [historicalGymReviewId, session.workspaceId, session.userId, historicalGymEventId, historicalGymId, fixtureInput.targetPlaceId, oldStartedAt, oldStoppedAt]
  );
  await pool.query(
    `insert into location_segment_evidence (workspace_id, user_id, evidence_id, stay_segment_id, sequence_index, role)
     select workspace_id, user_id, id, $1, 0, 'inside'
     from location_evidence
     where workspace_id = $2 and user_id = $3 and client_evidence_id = 'later-strong-2'`,
    [historicalGymId, session.workspaceId, session.userId]
  );

  await pool.query(
    `insert into activity_events (
       id, workspace_id, user_id, device_id, client_event_id, source, event_type,
       occurred_at, confidence, review_status, raw_payload
     ) values ($1, $2, $3, $4, 'location-segment:confirmed-historical-inbound',
       'location_learning', 'commute_detected', '2026-09-17T11:06:00.000Z', 'low', 'needs_review', $5::jsonb)`,
    [historicalCommuteEventId, session.workspaceId, session.userId, owner.deviceId, JSON.stringify({ clientSegmentId: "confirmed-historical-inbound" })]
  );
  await pool.query(
    `insert into commute_segments (
       id, workspace_id, user_id, device_id, client_segment_id, algorithm_version,
       status, started_at, stopped_at, start_lower_bound_at, start_upper_bound_at,
       stop_lower_bound_at, stop_upper_bound_at, from_stay_segment_id, to_stay_segment_id,
       from_place_id, to_place_id, route_distance_m, straight_line_distance_m,
       route_sample_count, max_gap_seconds, continuity_status, confidence,
       created_from_event_id, metadata
     ) values ($1, $2, $3, $4, 'confirmed-historical-inbound', $5, 'finalised',
       '2026-09-17T11:06:00.000Z', '2026-09-17T12:21:00.000Z',
       '2026-09-17T11:06:00.000Z', '2026-09-17T11:10:00.000Z',
       '2026-09-17T12:21:00.000Z', '2026-09-17T12:21:00.000Z', $6, $7, $8, $9,
       2000, 1400, 3, 600, 'uncertain_gap', 'low', $10, '{"qualificationReason":"significant_endpoint_displacement"}'::jsonb)`,
    [historicalCommuteId, session.workspaceId, session.userId, owner.deviceId, LOCATION_ENGINE_V2_CONFIG.algorithmVersion, historicalOriginId, historicalGymId, fixtureInput.originPlaceId, fixtureInput.targetPlaceId, historicalCommuteEventId]
  );
  await pool.query(
    `insert into review_items (
       id, workspace_id, user_id, event_id, location_segment_id, type, title,
       suggested_category_id, suggested_place_id, suggested_started_at, suggested_stopped_at,
       confidence, status
     ) values ($1, $2, $3, $4, $5, 'commute_suggestion', 'Confirmed historical commute',
       null, null, '2026-09-17T11:06:00.000Z', '2026-09-17T12:21:00.000Z', 'low', 'open')`,
    [historicalCommuteReviewId, session.workspaceId, session.userId, historicalCommuteEventId, historicalCommuteId]
  );
  await pool.query(
    `insert into location_segment_evidence (workspace_id, user_id, evidence_id, commute_segment_id, sequence_index, role)
     select workspace_id, user_id, id, $1, 0, 'route'
     from location_evidence
     where workspace_id = $2 and user_id = $3 and client_evidence_id = 'route-out-2'`,
    [historicalCommuteId, session.workspaceId, session.userId]
  );
  return {
    historicalGymId,
    historicalGymReviewId,
    historicalGymEventId,
    historicalCommuteId,
    historicalCommuteReviewId,
    historicalCommuteEventId,
    historicalGymMutationId,
    historicalCommuteMutationId
  };
}

async function historySnapshot(owner: ArrivalOwner, ids: Awaited<ReturnType<typeof insertConfirmedHistory>>) {
  const { session } = owner;
  const query = async (table: string, idsToRead: string[]) => (await pool.query(
    `select * from ${table} where workspace_id = $1 and user_id = $2 and id = any($3::uuid[]) order by id`,
    [session.workspaceId, session.userId, idsToRead]
  )).rows;
  return {
    stays: await query("stay_segments", [ids.historicalGymId]),
    commutes: await query("commute_segments", [ids.historicalCommuteId]),
    events: await query("activity_events", [ids.historicalGymEventId, ids.historicalCommuteEventId]),
    reviews: await query("review_items", [ids.historicalGymReviewId, ids.historicalCommuteReviewId]),
    entries: (await pool.query(
      `select * from time_entries where workspace_id = $1 and user_id = $2
       and created_from_event_id = any($3::uuid[]) order by id`,
      [session.workspaceId, session.userId, [ids.historicalGymEventId, ids.historicalCommuteEventId]]
    )).rows,
    receipts: (await pool.query(
      `select * from review_mutation_receipts where workspace_id = $1 and user_id = $2
       and review_item_id = any($3::uuid[]) order by id`,
      [session.workspaceId, session.userId, [ids.historicalGymReviewId, ids.historicalCommuteReviewId]]
    )).rows,
    lineage: (await pool.query(
      `select * from location_segment_evidence where workspace_id = $1 and user_id = $2
       and (stay_segment_id = $3 or commute_segment_id = $4) order by id`,
      [session.workspaceId, session.userId, ids.historicalGymId, ids.historicalCommuteId]
    )).rows
  };
}

async function validateConfirmedHistoryProtection() {
  const fixtureInput = fixture();
  const owner = ownerFor(fixtureInput);
  await seedOwner(owner, fixtureInput);
  try {
    await ingest(owner, fixtureInput);
    const ids = await insertConfirmedHistory(owner, fixtureInput);
    const gymResult = await resolveIdempotentReviewMutation(
      ids.historicalGymReviewId,
      { clientMutationId: ids.historicalGymMutationId, mutation: { action: "confirm" } },
      owner.session
    );
    const commuteResult = await resolveIdempotentReviewMutation(
      ids.historicalCommuteReviewId,
      { clientMutationId: ids.historicalCommuteMutationId, mutation: { action: "confirm" } },
      owner.session
    );
    const before = await historySnapshot(owner, ids);
    const expected = runLocationEngine(fixtureInput);
    const expectedTarget = expected.segmentUpserts.find(
      (segment): segment is StaySegment => segment.kind === "stay" && segment.placeId === fixtureInput.targetPlaceId
    );
    const expectedInbound = expected.segmentUpserts.find(
      (segment) => segment.kind === "commute" && segment.toPlaceId === fixtureInput.targetPlaceId
    );
    assert(expectedTarget && expectedInbound, "Synthetic protection fixture lost the corrected output.");
    await replay(owner, fixtureInput.processingAt);
    const after = await historySnapshot(owner, ids);
    assert.deepEqual(after, before, "Confirmed history, entries, receipts or lineage changed during replay.");
    assert.equal(
      (await pool.query(
        `select count(*)::int as count from stay_segments
         where workspace_id = $1 and user_id = $2 and client_segment_id = $3`,
        [owner.session.workspaceId, owner.session.userId, expectedTarget.clientSegmentId]
      )).rows[0].count,
      0,
      "Corrected stay competed with the confirmed historical gym stay."
    );
    assert.equal(
      (await pool.query(
        `select count(*)::int as count from commute_segments
         where workspace_id = $1 and user_id = $2 and client_segment_id = $3`,
        [owner.session.workspaceId, owner.session.userId, expectedInbound.clientSegmentId]
      )).rows[0].count,
      0,
      "Corrected inbound commute competed with the confirmed historical commute."
    );
    const replayedGymResult = await resolveIdempotentReviewMutation(
      ids.historicalGymReviewId,
      { clientMutationId: ids.historicalGymMutationId, mutation: { action: "confirm" } },
      owner.session
    );
    assert.deepEqual(replayedGymResult, gymResult, "Committed gym receipt did not replay exactly once.");
    assert(commuteResult, "Confirmed commute mutation returned no result.");
    assert.deepEqual(await historySnapshot(owner, ids), after, "Receipt replay changed confirmed history.");
  } finally {
    await cleanup(owner);
  }
}

export async function validateSavedPlaceArrivalBoundaries() {
  const previousMode = process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  try {
    await validateFullSupport();
    await validateFallback();
    await validateConfirmedHistoryProtection();
    console.log("PASS: saved-place arrival-boundary server replay, fallback suppression, lineage, confirmed-history protection and receipt replay.");
  } finally {
    if (previousMode === undefined) delete process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
    else process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = previousMode;
  }
}
