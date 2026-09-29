import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  EMPTY_LOCATION_ENGINE_STATE, LOCATION_ENGINE_V2_CONFIG, runLocationEngine,
  validReviewAcknowledgement, type CommuteSegment, type LocationEvidence, type StaySegment
} from "@dayframe/shared";
import { pool } from "../apps/web/src/lib/db";
import { replayRetainedLocationEvidence } from "../apps/web/src/lib/location/location-ingest-service";
import { replayLocationEvidence } from "../apps/web/src/lib/location/location-replay-service";
import { getLocationReviewEvidence } from "../apps/web/src/lib/location/location-query-service";
import { resolveLocationReviewActionWithClient } from "../apps/web/src/lib/location/location-review-service";
import { resolveIdempotentReviewMutation } from "../apps/web/src/lib/review-mutation-service";
import type { RequestSession } from "../apps/web/src/lib/session";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "DATABASE_URL is required.");
const url = new URL(databaseUrl);
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"),
  "Refusing to validate outside a disposable local *_test database.");

const baseMs = Date.parse("2026-09-25T08:00:00.000Z");
const at = (minutes: number) => new Date(baseMs + minutes * 60_000).toISOString();
const stopStartedAt = at(30);
const stopEndedAt = at(42);
const processingAt = "2026-09-29T12:00:00.000Z";
const deviceId = `synthetic-interruption-${randomUUID()}`;
const homeId = randomUUID();
const routeRows: Array<[string, number, number, number]> = [
  ["home-before-1", 0, 51.5, 0], ["home-before-2", 8, 51.5, 0],
  ["home-before-3", 16, 51.5, 0],
  ["route-in-1", 20, 51.504, 8], ["route-in-2", 23, 51.51, 8],
  ["route-in-3", 27, 51.52, 8],
  ["route-out-1", 44, 51.52, 8], ["route-out-2", 47, 51.51, 8],
  ["route-out-3", 50, 51.504, 8],
  ["home-after-1", 57 + 52 / 60, 51.5, 0],
  ["home-after-2", 65, 51.5, 0], ["home-after-3", 72, 51.5, 0]
];

async function count(table: string, session: RequestSession) {
  const result = await pool.query<{ n: number }>(
    `select count(*)::int as n from ${table} where workspace_id = $1 and user_id = $2`,
    [session.workspaceId, session.userId]
  );
  return result.rows[0].n;
}

async function main() {
  const session: RequestSession = {
    workspaceId: randomUUID(), userId: randomUUID(), authMode: "dev",
    scopes: ["app:read", "app:write", "events:write"]
  };
  await pool.query("insert into users (id, email, name) values ($1, $2, 'Synthetic owner')",
    [session.userId, `synthetic-${session.userId}@example.invalid`]);
  await pool.query("insert into workspaces (id, name) values ($1, 'Disposable interruption test')", [session.workspaceId]);
  await pool.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
    [session.workspaceId, session.userId]);
  await pool.query(
    `insert into places (id, workspace_id, name, latitude, longitude, radius_meters)
     values ($1, $2, 'Synthetic Home', 51.5, -0.1, 90)`,
    [homeId, session.workspaceId]
  );
  const evidence: LocationEvidence[] = routeRows.map(([id, minute, latitude, speed]) => ({
    clientEvidenceId: `${deviceId}:${id}`, deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location", occurredAt: at(minute), receivedAt: processingAt,
    timeZone: "Europe/London", latitude, longitude: -0.1,
    horizontalAccuracyMeters: 12, speedMetersPerSecond: speed,
    isSimulated: false,
    ...(id.startsWith("home-") ? { savedPlaceId: homeId } : {})
  }));
  const engine = runLocationEngine({
    priorState: EMPTY_LOCATION_ENGINE_STATE, evidence,
    savedPlaces: [{ id: homeId, name: "Synthetic Home", latitude: 51.5, longitude: -0.1, radiusMeters: 90 }],
    acceptedLearnedPlaces: [], config: LOCATION_ENGINE_V2_CONFIG, processingAt
  });
  const parent = engine.segmentUpserts.find((segment): segment is CommuteSegment => segment.kind === "commute");
  const stays = engine.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
  assert(parent && stays.length === 2, "Sanitised B-shaped evidence must produce the original composite and two Home stays.");
  assert.equal(parent.qualificationReason, "same_place_meaningful_round_trip");
  assert.equal(Date.parse(parent.stoppedAt) - Date.parse(parent.startedAt), 39 * 60_000 + 52_000);
  assert.deepEqual(parent.evidenceIds, evidence.slice(3, 9).map((row) => row.clientEvidenceId));

  const evidenceIdByClient = new Map<string, string>();
  for (const row of evidence) {
    const id = randomUUID();
    evidenceIdByClient.set(row.clientEvidenceId, id);
    await pool.query(
      `insert into location_evidence (
         id, workspace_id, user_id, device_id, client_evidence_id, client_batch_id,
         evidence_type, occurred_at, coordinate, horizontal_accuracy_m, speed_mps,
         saved_place_id, accepted, algorithm_version, time_zone, is_simulated,
         received_at, expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,
         $11,$12,$13,true,$14,$15,false,now(),now()+interval '7 days')`,
      [id, session.workspaceId, session.userId, deviceId, row.clientEvidenceId, "synthetic-interruption",
        row.kind, row.occurredAt, row.longitude, row.latitude, row.horizontalAccuracyMeters,
        row.speedMetersPerSecond, row.savedPlaceId ?? null, row.algorithmVersion, row.timeZone]
    );
  }
  const stayIdByClient = new Map<string, string>();
  for (const stay of stays) {
    const inserted = await pool.query<{ id: string }>(
      `insert into stay_segments (
         workspace_id, user_id, device_id, client_segment_id, algorithm_version,
         status, source, place_id, started_at, stopped_at, centre, confidence, continuity_status
       ) values ($1,$2,$3,$4,$5,'finalised','location_v2',$6,$7,$8,
         ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,'medium','continuous') returning id`,
      [session.workspaceId, session.userId, deviceId, stay.clientSegmentId,
        LOCATION_ENGINE_V2_CONFIG.algorithmVersion, homeId, stay.startedAt, stay.stoppedAt,
        stay.centreLongitude, stay.centreLatitude]
    );
    stayIdByClient.set(stay.clientSegmentId, inserted.rows[0].id);
  }
  const parentEvent = await pool.query<{ id: string }>(
    `insert into activity_events (workspace_id,user_id,client_event_id,source,event_type,occurred_at,
       confidence,raw_payload,review_status)
     values ($1,$2,$3,'location_learning','commute_detected',$4,'medium','{}','needs_review') returning id`,
    [session.workspaceId, session.userId, `location-segment:${parent.clientSegmentId}`, parent.startedAt]
  );
  const parentSegment = await pool.query<{ id: string }>(
    `insert into commute_segments (
       workspace_id,user_id,device_id,client_segment_id,algorithm_version,status,started_at,stopped_at,
       from_stay_segment_id,to_stay_segment_id,from_place_id,to_place_id,route_sample_count,
       continuity_status,confidence,created_from_event_id
     ) values ($1,$2,$3,$4,$5,'finalised',$6,$7,$8,$9,$10,$10,6,'uncertain_gap','medium',$11) returning id`,
    [session.workspaceId, session.userId, deviceId, parent.clientSegmentId,
      LOCATION_ENGINE_V2_CONFIG.algorithmVersion, parent.startedAt, parent.stoppedAt,
      stayIdByClient.get(parent.fromStaySegmentId), stayIdByClient.get(parent.toStaySegmentId),
      homeId, parentEvent.rows[0].id]
  );
  const parentId = parentSegment.rows[0].id;
  for (const [index, clientEvidenceId] of parent.evidenceIds.entries()) {
    await pool.query(
      `insert into location_segment_evidence
         (workspace_id,user_id,evidence_id,commute_segment_id,sequence_index,role)
       values ($1,$2,$3,$4,$5,'route')`,
      [session.workspaceId, session.userId, evidenceIdByClient.get(clientEvidenceId), parentId, index]
    );
  }
  const sourceReview = await pool.query<{ id: string }>(
    `insert into review_items (workspace_id,user_id,event_id,location_segment_id,type,title,
       suggested_started_at,suggested_stopped_at,confidence,status)
     values ($1,$2,$3,$4,'commute_detected_suggestion','Commute',$5,$6,'medium','open') returning id`,
    [session.workspaceId, session.userId, parentEvent.rows[0].id, parentId, parent.startedAt, parent.stoppedAt]
  );
  const reviewItemId = sourceReview.rows[0].id;
  const mutation = { action: "interrupt_commute" as const, stopStartedAt, stopEndedAt };
  const envelope = { clientMutationId: randomUUID(), mutation };
  const pre = {
    endpoints: await count("location_manual_stop_endpoints", session),
    commutes: await count("commute_segments", session),
    reviews: await count("review_items", session),
    receipts: await count("review_mutation_receipts", session)
  };

  const rollback = await pool.connect();
  try {
    await rollback.query("begin");
    const transient = await resolveLocationReviewActionWithClient(rollback, reviewItemId, mutation, session);
    assert.equal(transient.action, "interrupt_commute");
    await rollback.query("rollback");
  } finally {
    rollback.release();
  }
  assert.deepEqual({
    endpoints: await count("location_manual_stop_endpoints", session),
    commutes: await count("commute_segments", session),
    reviews: await count("review_items", session),
    receipts: await count("review_mutation_receipts", session)
  }, pre, "A rolled-back correction left durable effects.");

  const result = await resolveIdempotentReviewMutation(reviewItemId, envelope, session);
  assert(validReviewAcknowledgement(result, envelope, reviewItemId));
  assert.deepEqual(await resolveIdempotentReviewMutation(reviewItemId, envelope, session), result,
    "The durable receipt did not replay the exact result.");
  assert.deepEqual({
    endpoints: await count("location_manual_stop_endpoints", session),
    commutes: await count("commute_segments", session),
    reviews: await count("review_items", session),
    receipts: await count("review_mutation_receipts", session)
  }, { endpoints: 2, commutes: 3, reviews: 3, receipts: 1 });
  await assert.rejects(
    () => resolveIdempotentReviewMutation(reviewItemId,
      { clientMutationId: envelope.clientMutationId,
        mutation: { ...mutation, stopEndedAt: at(43) } }, session),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "mutation_id_conflict")
  );
  const children = await pool.query<{
    id: string; startedAt: Date; stoppedAt: Date; fromStaySegmentId: string | null;
    toStaySegmentId: string | null; fromManualStopEndpointId: string | null;
    toManualStopEndpointId: string | null; continuityStatus: string; status: string;
    routeSampleCount: number; eventId: string;
  }>(
    `select id,started_at as "startedAt",stopped_at as "stoppedAt",
       from_stay_segment_id as "fromStaySegmentId",to_stay_segment_id as "toStaySegmentId",
       from_manual_stop_endpoint_id as "fromManualStopEndpointId",
       to_manual_stop_endpoint_id as "toManualStopEndpointId",
       continuity_status as "continuityStatus",status,route_sample_count as "routeSampleCount",
       created_from_event_id as "eventId"
     from commute_segments where workspace_id=$1 and user_id=$2 and parent_segment_id=$3
     order by started_at`,
    [session.workspaceId, session.userId, parentId]
  );
  assert.equal(children.rows.length, 2);
  assert.equal(children.rows[0].stoppedAt.toISOString(), stopStartedAt);
  assert.equal(children.rows[1].startedAt.toISOString(), stopEndedAt);
  assert(children.rows[0].fromStaySegmentId && children.rows[0].toManualStopEndpointId);
  assert(children.rows[1].fromManualStopEndpointId && children.rows[1].toStaySegmentId);
  assert(children.rows.every((child) => child.continuityStatus === "manual" && child.status === "finalised" && child.routeSampleCount === 3));
  const childReviews = await pool.query<{ id: string }>(
    `select id from review_items where workspace_id=$1 and user_id=$2
       and location_segment_id = any($3::uuid[]) order by suggested_started_at`,
    [session.workspaceId, session.userId, children.rows.map((row) => row.id)]
  );
  assert.equal(childReviews.rows.length, 2);
  for (const review of childReviews.rows) {
    const detail = await getLocationReviewEvidence(review.id, session);
    assert.equal(detail.segment.kind, "commute");
    assert.equal(detail.map.acceptedSamples.length, 3);
    assert.equal(detail.map.straightLineFallback, null);
  }
  const lineage = await pool.query<{ segmentId: string; n: number }>(
    `select commute_segment_id as "segmentId",count(*)::int as n
     from location_segment_evidence where workspace_id=$1 and user_id=$2
     group by commute_segment_id`, [session.workspaceId, session.userId]
  );
  assert.deepEqual(new Map(lineage.rows.map((row) => [row.segmentId, row.n])),
    new Map([[parentId, 6], [children.rows[0].id, 3], [children.rows[1].id, 3]]),
    "Parent lineage must remain whole while children receive only their leg's route links.");
  const parentRow = await pool.query<{ status: string; continuityStatus: string; reviewStatus: string }>(
    `select cs.status,cs.continuity_status as "continuityStatus",ri.status as "reviewStatus"
     from commute_segments cs join review_items ri on ri.location_segment_id=cs.id
     where cs.id=$1`, [parentId]
  );
  assert.deepEqual(parentRow.rows[0], { status: "superseded", continuityStatus: "manual", reviewStatus: "accepted" });
  assert.equal(await count("time_entries", session), 0);
  assert.equal(await count("stay_segments", session), 2);
  const eventKinds = await pool.query<{ eventType: string; reviewStatus: string }>(
    `select event_type as "eventType",review_status as "reviewStatus" from activity_events
     where workspace_id=$1 and user_id=$2 order by created_at`, [session.workspaceId, session.userId]
  );
  assert(eventKinds.rows.every((row) => row.eventType === "commute_detected"));
  assert.equal(eventKinds.rows.filter((row) => row.reviewStatus === "needs_review").length, 2);

  const replayClient = await pool.connect();
  try {
    await replayClient.query("begin");
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const replay = await replayLocationEvidence(replayClient, session, {
        deviceId, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, processingAt
      });
      assert(!replay.segments.some((segment) => segment.kind === "commute" &&
        segment.clientSegmentId === parent.clientSegmentId), "Replay regenerated the protected composite.");
    }
    await replayClient.query("commit");
  } catch (error) {
    await replayClient.query("rollback");
    throw error;
  } finally {
    replayClient.release();
  }
  assert.equal(await count("commute_segments", session), 3);
  assert.equal(await count("review_items", session), 3);
  assert.equal(await count("time_entries", session), 0);
  assert.equal(await count("location_manual_stop_endpoints", session), 2);

  // Simulate a changed historical engine identity on both segment and event.
  // A failed provenance guard could otherwise create a fresh composite Review.
  await pool.query("update commute_segments set client_segment_id=$1 where id=$2",
    [`historical-interrupted:${randomUUID()}`, parentId]);
  await pool.query("update activity_events set client_event_id=$1 where id=$2",
    [`historical-interrupted-event:${randomUUID()}`, parentEvent.rows[0].id]);
  const previousRolloutMode = process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  try {
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const semanticReplay = await replayRetainedLocationEvidence({
        deviceId, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
        rolloutMode: "v2_review", semanticModeAcknowledgedAt: "2026-09-24T00:00:00.000Z"
      }, session, processingAt);
      assert.equal(semanticReplay.rolloutMode, "v2_review");
    }
  } finally {
    if (previousRolloutMode === undefined) delete process.env.DAYFRAME_LOCATION_ROLLOUT_MODE;
    else process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = previousRolloutMode;
  }
  const protectedCommutes = await pool.query<{ id: string; status: string; routeLinks: number }>(
    `select cs.id,cs.status,count(lse.id)::int as "routeLinks"
     from commute_segments cs left join location_segment_evidence lse on lse.commute_segment_id=cs.id
     where cs.workspace_id=$1 and cs.user_id=$2 and (cs.id=$3 or cs.parent_segment_id=$3)
     group by cs.id,cs.status`, [session.workspaceId, session.userId, parentId]
  );
  assert.deepEqual(new Map(protectedCommutes.rows.map((row) => [row.id, row.routeLinks])),
    new Map([[parentId, 6], [children.rows[0].id, 3], [children.rows[1].id, 3]]),
    "Changed-ID replay rewrote the protected parent or child lineage.");
  assert.equal(await count("commute_segments", session), 3,
    "Changed-ID replay inserted another composite commute.");
  const commuteReviews = await pool.query<{ n: number }>(
    `select count(*)::int as n from review_items ri join commute_segments cs on cs.id=ri.location_segment_id
     where ri.workspace_id=$1 and ri.user_id=$2`, [session.workspaceId, session.userId]
  );
  assert.equal(commuteReviews.rows[0].n, 3,
    "Changed-ID replay inserted a duplicate composite Review.");

  const insufficientEvent = await pool.query<{ id: string }>(
    `insert into activity_events (workspace_id,user_id,source,event_type,occurred_at,
       confidence,raw_payload,review_status)
     values ($1,$2,'location_learning','commute_detected',$3,'low','{}','needs_review') returning id`,
    [session.workspaceId, session.userId, parent.startedAt]
  );
  const insufficientSegment = await pool.query<{ id: string }>(
    `insert into commute_segments (workspace_id,user_id,device_id,client_segment_id,
       algorithm_version,status,started_at,stopped_at,from_stay_segment_id,to_stay_segment_id,
       continuity_status,created_from_event_id)
     values ($1,$2,$3,$4,$5,'finalised',$6,$7,$8,$9,'uncertain_gap',$10) returning id`,
    [session.workspaceId, session.userId, deviceId, randomUUID(),
      LOCATION_ENGINE_V2_CONFIG.algorithmVersion, parent.startedAt, parent.stoppedAt,
      stayIdByClient.get(parent.fromStaySegmentId), stayIdByClient.get(parent.toStaySegmentId),
      insufficientEvent.rows[0].id]
  );
  for (const [index, row] of [...evidence.slice(3, 6), evidence[6]].entries()) {
    await pool.query(
      `insert into location_segment_evidence
         (workspace_id,user_id,evidence_id,commute_segment_id,sequence_index,role)
       values ($1,$2,$3,$4,$5,'route')`,
      [session.workspaceId, session.userId, evidenceIdByClient.get(row.clientEvidenceId),
        insufficientSegment.rows[0].id, index]
    );
  }
  // Even owner-scoped evidence must come from the corrected parent device.
  // These two additional linked observations would complete the outbound leg
  // if the server trusted a different device's provenance.
  for (const [index, latitude] of [51.51, 51.504].entries()) {
    const otherEvidenceId = randomUUID();
    await pool.query(
      `insert into location_evidence (
         id,workspace_id,user_id,device_id,client_evidence_id,client_batch_id,
         evidence_type,occurred_at,coordinate,horizontal_accuracy_m,accepted,
         algorithm_version,time_zone,is_simulated,received_at,expires_at
       ) values ($1,$2,$3,$4,$5,'foreign-device-fixture','standard_location',$6,
         ST_SetSRID(ST_MakePoint(-0.1,$7),4326)::geography,12,true,$8,'Europe/London',false,
         now(),now()+interval '7 days')`,
      [otherEvidenceId, session.workspaceId, session.userId, `${deviceId}-other`, randomUUID(),
        at(index === 0 ? 47 : 50), latitude, LOCATION_ENGINE_V2_CONFIG.algorithmVersion]
    );
    await pool.query(
      `insert into location_segment_evidence
         (workspace_id,user_id,evidence_id,commute_segment_id,sequence_index,role)
       values ($1,$2,$3,$4,$5,'route')`,
      [session.workspaceId, session.userId, otherEvidenceId, insufficientSegment.rows[0].id, index + 4]
    );
  }
  const insufficientReview = await pool.query<{ id: string }>(
    `insert into review_items (workspace_id,user_id,event_id,location_segment_id,type,title,
       suggested_started_at,suggested_stopped_at,confidence,status)
     values ($1,$2,$3,$4,'commute_detected_suggestion','Commute',$5,$6,'low','open') returning id`,
    [session.workspaceId, session.userId, insufficientEvent.rows[0].id,
      insufficientSegment.rows[0].id, parent.startedAt, parent.stoppedAt]
  );
  const beforeRejected = {
    endpoints: await count("location_manual_stop_endpoints", session),
    commutes: await count("commute_segments", session),
    reviews: await count("review_items", session),
    receipts: await count("review_mutation_receipts", session)
  };
  await assert.rejects(
    () => resolveIdempotentReviewMutation(insufficientReview.rows[0].id,
      { clientMutationId: randomUUID(), mutation }, session),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error &&
      error.code === "insufficient_route_provenance")
  );
  assert.deepEqual({
    endpoints: await count("location_manual_stop_endpoints", session),
    commutes: await count("commute_segments", session),
    reviews: await count("review_items", session),
    receipts: await count("review_mutation_receipts", session)
  }, beforeRejected, "A one-leg correction partially committed.");
  assert.equal((await pool.query<{ status: string }>("select status from review_items where id=$1",
    [insufficientReview.rows[0].id])).rows[0].status, "open");

  // An endpoint may replace precisely one stay on a side. The database also
  // rejects an endpoint with a different owner/parent before any semantic row.
  await assert.rejects(() => pool.query(
    `insert into location_manual_stop_endpoints
       (workspace_id,user_id,parent_commute_segment_id,boundary_kind,occurred_at)
     values ($1,$2,$3,'stop_started',$4)`,
    [session.workspaceId, randomUUID(), parentId, stopStartedAt]
  ));
  await assert.rejects(() => pool.query(
    `insert into commute_segments (workspace_id,user_id,device_id,client_segment_id,
       algorithm_version,started_at,stopped_at,from_stay_segment_id,to_stay_segment_id)
     values ($1,$2,$3,$4,$5,$6,$7,null,$8)`,
    [session.workspaceId, session.userId, deviceId, randomUUID(), LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      parent.startedAt, parent.stoppedAt, stayIdByClient.get(parent.toStaySegmentId)]
  ));
  await assert.rejects(() => pool.query(
    "update commute_segments set continuity_status='continuous' where id=$1",
    [children.rows[0].id]
  ));
  await assert.rejects(() => pool.query(
    "update commute_segments set to_place_id=$1 where id=$2",
    [homeId, children.rows[0].id]
  ));
  await assert.rejects(() => pool.query(
    "update location_manual_stop_endpoints set occurred_at=$1 where id=$2",
    [at(31), children.rows[0].toManualStopEndpointId]
  ));

  const deletionScenarios = [
    { name: "interrupted parent", sql: "delete from commute_segments where id=$1", id: parentId, cascade: true },
    { name: "origin stay", sql: "delete from stay_segments where id=$1", id: stayIdByClient.get(parent.fromStaySegmentId)!, cascade: true },
    { name: "destination stay", sql: "delete from stay_segments where id=$1", id: stayIdByClient.get(parent.toStaySegmentId)!, cascade: true },
    { name: "user", sql: "delete from users where id=$1", id: session.userId, cascade: true },
    { name: "workspace", sql: "delete from workspaces where id=$1", id: session.workspaceId, cascade: true },
    { name: "ordinary commute", sql: "delete from commute_segments where id=$1", id: insufficientSegment.rows[0].id, cascade: false }
  ];
  for (const scenario of deletionScenarios) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const deleted = await client.query(scenario.sql, [scenario.id]);
      assert.equal(deleted.rowCount, 1, `${scenario.name} was not deleted.`);
      const graph = await client.query<{ commutes: number; endpoints: number; links: number }>(
        `select
           (select count(*)::int from commute_segments where id=$1 or parent_segment_id=$1) as commutes,
           (select count(*)::int from location_manual_stop_endpoints where parent_commute_segment_id=$1) as endpoints,
           (select count(*)::int from location_segment_evidence where commute_segment_id=any($2::uuid[])) as links`,
        [parentId, [parentId, ...children.rows.map((child) => child.id)]]
      );
      assert.deepEqual(graph.rows[0], scenario.cascade
        ? { commutes: 0, endpoints: 0, links: 0 }
        : { commutes: 3, endpoints: 2, links: 12 },
        `${scenario.name} left an invalid interruption graph.`);
      await client.query("rollback");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Deletion lifecycle failed for ${scenario.name}.`, { cause: error });
    } finally {
      client.release();
    }
  }
  assert.equal(await count("commute_segments", session), 4,
    "Lifecycle validation must leave the synthetic owner intact after rollbacks.");
  await pool.query(
    `update location_evidence set expires_at=now()-interval '1 minute'
     where workspace_id=$1 and user_id=$2 and id in
       (select evidence_id from location_segment_evidence where commute_segment_id=$3)`,
    [session.workspaceId, session.userId, insufficientSegment.rows[0].id]
  );
  const expiredRead = await getLocationReviewEvidence(insufficientReview.rows[0].id, session);
  assert.equal(expiredRead.map.acceptedSamples.length, 0,
    "Expired but not yet purged route rows must not be presented as retained evidence.");
  console.log("Confirmed commute interruption: B-shaped route proof, durable receipt, parent/child lineage, same- and changed-ID semantic replay, no duplicate composite Review, expired-row read filtering, endpoint integrity and all six deletion lifecycles passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
