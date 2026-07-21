import assert from "node:assert/strict";
import {
  LOCATION_ACCEPTANCE_PLACES,
  LOCATION_ENGINE_V2_CONFIG,
  locationAcceptanceFixture,
  type LocationEvidenceBatchRequest
} from "@dayframe/shared";
import { pool } from "../apps/web/src/lib/db";
import { processActivityEvent } from "../apps/web/src/lib/event-service";
import { ingestLocationEvidence } from "../apps/web/src/lib/location/location-ingest-service";
import { resolveLocationReviewAction } from "../apps/web/src/lib/location/location-review-service";
import type { RequestSession } from "../apps/web/src/lib/session";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "DATABASE_URL is required.");
const parsedDatabaseUrl = new URL(databaseUrl);
assert(
  ["localhost", "127.0.0.1"].includes(parsedDatabaseUrl.hostname) && parsedDatabaseUrl.pathname.endsWith("_test"),
  "Refusing to run Location V2 database validation outside a disposable local *_test database."
);

const WORKSPACE_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "30000000-0000-4000-8000-000000000002";
const INVALID_CATEGORY_ID = "30000000-0000-4000-8000-000000000099";
const DEVICE_ID = "20000000-0000-4000-8000-000000000001";
const PROCESSING_AT = "2026-07-20T20:00:00.000Z";
const session: RequestSession = {
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  authMode: "token",
  scopes: ["app:read", "app:write", "events:write"]
};

function batch(
  clientBatchId: string,
  evidence: ReturnType<typeof locationAcceptanceFixture>["evidence"],
  rolloutMode: LocationEvidenceBatchRequest["rolloutMode"],
  semanticModeAcknowledgedAt?: string
) {
  return {
    clientBatchId,
    deviceId: DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    timeZone: "Europe/London",
    rolloutMode,
    semanticModeAcknowledgedAt,
    evidence
  };
}

async function seedOwner() {
  await pool.query("delete from workspaces where id = $1", [WORKSPACE_ID]);
  await pool.query("delete from users where id = $1", [USER_ID]);
  await pool.query(
    "insert into users (id, email, name) values ($1, $2, $3)",
    [USER_ID, "location-db-validation@example.test", "Location DB Validation"]
  );
  await pool.query("insert into workspaces (id, name) values ($1, $2)", [WORKSPACE_ID, "Location DB Validation"]);
  await pool.query(
    "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
    [WORKSPACE_ID, USER_ID]
  );
  for (const place of LOCATION_ACCEPTANCE_PLACES) {
    await pool.query(
      `insert into places (id, workspace_id, name, latitude, longitude, radius_meters, priority, logging_enabled)
       values ($1, $2, $3, $4, $5, $6, $7, true)`,
      [place.id, WORKSPACE_ID, place.name, place.latitude, place.longitude, place.radiusMeters, place.priority ?? 0]
    );
  }
}

async function clearDerivedLocationState() {
  await pool.query("delete from review_items where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  await pool.query("delete from commute_segments where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  await pool.query("delete from location_evidence where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  await pool.query("delete from stay_segments where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  await pool.query("delete from time_entries where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  await pool.query("delete from activity_events where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
}

async function segmentSnapshot() {
  const result = await pool.query<{ kind: string; clientSegmentId: string }>(
    `select 'stay' as kind, client_segment_id as "clientSegmentId"
     from stay_segments
     where workspace_id = $1 and user_id = $2 and status <> 'superseded'
     union all
     select 'commute' as kind, client_segment_id as "clientSegmentId"
     from commute_segments
     where workspace_id = $1 and user_id = $2 and status <> 'superseded'
     order by kind, "clientSegmentId"`,
    [WORKSPACE_ID, USER_ID]
  );
  return result.rows;
}

async function count(table: string) {
  assert(/^[a-z_]+$/.test(table));
  const result = await pool.query<{ count: number }>(
    `select count(*)::integer as count from ${table} where workspace_id = $1 and user_id = $2`,
    [WORKSPACE_ID, USER_ID]
  );
  return result.rows[0].count;
}

async function validateOutOfOrderAndIdempotency() {
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_shadow";
  const evidence = locationAcceptanceFixture().evidence;
  const midpoint = Math.floor(evidence.length / 2);
  await ingestLocationEvidence(batch("db-out-of-order-later", evidence.slice(midpoint), "v2_shadow"), session, PROCESSING_AT);
  await ingestLocationEvidence(batch("db-out-of-order-earlier", evidence.slice(0, midpoint), "v2_shadow"), session, PROCESSING_AT);
  const outOfOrder = await segmentSnapshot();
  assert(outOfOrder.length > 0, "Out-of-order replay produced no segments.");

  await clearDerivedLocationState();
  const orderedBatch = batch("db-ordered", evidence, "v2_shadow");
  const orderedResult = await ingestLocationEvidence(orderedBatch, session, PROCESSING_AT);
  const ordered = await segmentSnapshot();
  assert.deepEqual(outOfOrder, ordered, "Out-of-order upload changed the canonical segment snapshot.");
  const evidenceCount = await count("location_evidence");
  const eventCount = await count("activity_events");
  const duplicate = await ingestLocationEvidence(orderedBatch, session, PROCESSING_AT);
  assert.equal(duplicate.duplicateBatch, true);
  assert.equal(await count("location_evidence"), evidenceCount, "Duplicate upload inserted evidence.");
  assert.equal(await count("activity_events"), eventCount, "Duplicate upload inserted an activity event.");
  assert.deepEqual(await segmentSnapshot(), ordered, "Duplicate upload changed segments.");
  assert.equal(orderedResult.rolloutMode, "v2_shadow");
  assert.equal(await count("review_items"), 0, "Shadow mode created user-visible reviews.");
  assert.equal(await count("time_entries"), 0, "Shadow mode created time entries.");
}

async function validateSemanticIdempotencyAndRollback() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const fixture = locationAcceptanceFixture();
  const semanticBatch = batch(
    "db-semantic-review",
    fixture.evidence,
    "v2_review",
    fixture.evidence[0].occurredAt
  );
  await ingestLocationEvidence(semanticBatch, session, PROCESSING_AT);
  const reviewBeforeRetry = await count("review_items");
  const eventBeforeRetry = await count("activity_events");
  assert(reviewBeforeRetry > 1, "Review mode did not create review items.");
  assert.equal(await count("time_entries"), 0, "Review mode auto-confirmed a time entry.");
  await ingestLocationEvidence(semanticBatch, session, PROCESSING_AT);
  assert.equal(await count("review_items"), reviewBeforeRetry, "Semantic retry duplicated review items.");
  assert.equal(await count("activity_events"), eventBeforeRetry, "Semantic retry duplicated activity events.");

  const summaries = await pool.query<{ rawPayload: Record<string, unknown> }>(
    `select raw_payload as "rawPayload" from activity_events
     where workspace_id = $1 and user_id = $2 and source = 'location_learning'`,
    [WORKSPACE_ID, USER_ID]
  );
  const forbiddenKey = /^(latitude|longitude|coordinate|coordinates|route|routePoints|geocoderPayload)$/i;
  const containsForbiddenKey = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsForbiddenKey);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, child]) => forbiddenKey.test(key) || containsForbiddenKey(child));
  };
  assert.equal(summaries.rows.some((row) => containsForbiddenKey(row.rawPayload)), false, "Permanent event payload contains exact location data.");

  const reviews = await pool.query<{ id: string }>(
    `select id from review_items
     where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id in (
       select id from stay_segments where workspace_id = $1 and user_id = $2
     ) order by created_at, id limit 4`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(reviews.rows.length, 4, "Four stay reviews are required for correction validation.");

  await assert.rejects(() => resolveLocationReviewAction(reviews.rows[0].id, {
    action: "save_place_and_confirm",
    name: "ROLLBACK_SENTINEL",
    latitude: 51.5007,
    longitude: -0.1246,
    radiusMeters: 80,
    edit: { categoryId: INVALID_CATEGORY_ID }
  }, session));
  const rolledBackPlace = await pool.query(
    "select 1 from places where workspace_id = $1 and name = 'ROLLBACK_SENTINEL'",
    [WORKSPACE_ID]
  );
  assert.equal(rolledBackPlace.rowCount, 0, "Failed atomic action left a saved place behind.");
  const rolledBackReview = await pool.query<{ status: string }>(
    "select status from review_items where id = $1 and workspace_id = $2 and user_id = $3",
    [reviews.rows[0].id, WORKSPACE_ID, USER_ID]
  );
  assert.equal(rolledBackReview.rows[0].status, "open", "Failed atomic action resolved the review.");
  assert.equal(await count("time_entries"), 0, "Failed atomic action left a time entry behind.");

  const [first, second] = await Promise.all([
    resolveLocationReviewAction(reviews.rows[1].id, { action: "confirm" }, session),
    resolveLocationReviewAction(reviews.rows[1].id, { action: "confirm" }, session)
  ]);
  assert.equal([first, second].filter((result) => result.alreadyResolved).length, 1);
  assert.equal(await count("time_entries"), 1, "Concurrent retry created duplicate time entries.");

  const splitSource = await pool.query<{ startedAt: string; stoppedAt: string; segmentId: string }>(
    `select suggested_started_at as "startedAt", suggested_stopped_at as "stoppedAt",
            location_segment_id as "segmentId"
     from review_items where id = $1 and workspace_id = $2 and user_id = $3`,
    [reviews.rows[2].id, WORKSPACE_ID, USER_ID]
  );
  const splitAt = new Date(
    (Date.parse(splitSource.rows[0].startedAt) + Date.parse(splitSource.rows[0].stoppedAt)) / 2
  ).toISOString();
  const segmentCountBeforeFailedSplit = await count("stay_segments");
  await assert.rejects(() => resolveLocationReviewAction(reviews.rows[2].id, {
    action: "split_and_confirm",
    splitAt,
    left: { categoryId: INVALID_CATEGORY_ID }
  }, session));
  assert.equal(await count("stay_segments"), segmentCountBeforeFailedSplit, "Failed split left child segments behind.");
  const splitReviewAfterFailure = await pool.query<{ status: string }>(
    "select status from review_items where id = $1 and workspace_id = $2 and user_id = $3",
    [reviews.rows[2].id, WORKSPACE_ID, USER_ID]
  );
  assert.equal(splitReviewAfterFailure.rows[0].status, "open", "Failed split resolved its source review.");

  const splitResult = await resolveLocationReviewAction(reviews.rows[2].id, {
    action: "split",
    splitAt
  }, session);
  assert("childSegmentIds" in splitResult && splitResult.childSegmentIds.length === 2, "Split did not create two child segments.");
  const childReviews = await pool.query<{ id: string }>(
    `select id from review_items
     where workspace_id = $1 and user_id = $2 and status = 'open'
       and location_segment_id = any($3::uuid[])
     order by suggested_started_at`,
    [WORKSPACE_ID, USER_ID, splitResult.childSegmentIds]
  );
  assert.equal(childReviews.rows.length, 2, "Split did not create two child reviews.");
  const linkedChildEvidence = await pool.query<{ count: number }>(
    `select count(*)::integer as count from location_segment_evidence
     where workspace_id = $1 and user_id = $2 and stay_segment_id = any($3::uuid[])`,
    [WORKSPACE_ID, USER_ID, splitResult.childSegmentIds]
  );
  assert(linkedChildEvidence.rows[0].count > 0, "Split did not preserve evidence lineage.");

  const mergeResult = await resolveLocationReviewAction(childReviews.rows[0].id, {
    action: "merge",
    adjacentReviewItemId: childReviews.rows[1].id,
    acknowledgeContradictoryEvidence: false
  }, session);
  assert("mergedSegmentId" in mergeResult, "Merge did not create a merged segment.");
  const mergedReview = await pool.query<{ count: number }>(
    `select count(*)::integer as count from review_items
     where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id = $3`,
    [WORKSPACE_ID, USER_ID, mergeResult.mergedSegmentId]
  );
  assert.equal(mergedReview.rows[0].count, 1, "Merge did not create one replacement review.");
  assert.equal(await count("time_entries"), 1, "Review-only split or merge created a time entry.");

  await assert.rejects(() => resolveLocationReviewAction(reviews.rows[0].id, {
    action: "merge",
    adjacentReviewItemId: reviews.rows[3].id,
    acknowledgeContradictoryEvidence: false
  }, session));
  const incompatibleStatuses = await pool.query<{ id: string; status: string }>(
    "select id, status from review_items where id = any($1::uuid[]) order by id",
    [[reviews.rows[0].id, reviews.rows[3].id]]
  );
  assert(incompatibleStatuses.rows.every((row) => row.status === "open"), "Rejected merge changed source review state.");
}

async function validateShadowToReviewCutover() {
  await clearDerivedLocationState();
  const fixture = locationAcceptanceFixture();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_shadow";
  await ingestLocationEvidence(batch("db-shadow-history", fixture.evidence, "v2_shadow"), session, PROCESSING_AT);
  const cutoverAt = "2026-07-20T16:00:00.000Z";
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  const newEvidence = [0, 8, 16, 24].map((minutes) => ({
    clientEvidenceId: `post-cutover-home-${minutes}`,
    deviceId: DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: minutes === 24 ? "geofence_exit" as const : "standard_location" as const,
    occurredAt: new Date(Date.parse(cutoverAt) + minutes * 60_000).toISOString(),
    latitude: home.latitude,
    longitude: home.longitude,
    horizontalAccuracyMeters: 25,
    savedPlaceId: minutes === 24 ? home.id : undefined,
    receivedAt: PROCESSING_AT,
    timeZone: "Europe/London"
  }));
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  await ingestLocationEvidence(
    batch("db-review-cutover", newEvidence, "v2_review", cutoverAt),
    session,
    PROCESSING_AT
  );
  const semanticEvents = await pool.query<{ startedAt: string }>(
    `select raw_payload ->> 'startedAt' as "startedAt"
     from activity_events
     where workspace_id = $1 and user_id = $2 and client_event_id like 'location-segment:%'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert(semanticEvents.rows.length > 0, "Review cutover did not emit a post-cutover segment.");
  assert(
    semanticEvents.rows.every((row) => Date.parse(row.startedAt) >= Date.parse(cutoverAt)),
    "Review cutover backfilled a shadow-era semantic event."
  );
}

async function validateEnabledTrustedPlaceAutomation() {
  await clearDerivedLocationState();
  const fixture = locationAcceptanceFixture();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_enabled";
  const enabledBatch = batch(
    "db-enabled-trusted-place",
    fixture.evidence,
    "v2_enabled",
    fixture.evidence[0].occurredAt
  );
  await ingestLocationEvidence(enabledBatch, session, PROCESSING_AT);

  const automaticEntries = await pool.query<{
    placeId: string | null;
    confidence: string;
    source: string;
    reviewStatus: string;
    eventId: string;
    startedAt: string;
    stoppedAt: string;
  }>(
    `select place_id as "placeId", confidence, source, review_status as "reviewStatus",
            created_from_event_id as "eventId", started_at as "startedAt", stopped_at as "stoppedAt"
     from time_entries where workspace_id = $1 and user_id = $2`,
    [WORKSPACE_ID, USER_ID]
  );
  assert(automaticEntries.rows.length > 0, "Enabled mode created no trusted-place automatic entries.");
  assert(
    automaticEntries.rows.every((entry) =>
      entry.placeId && entry.confidence === "medium_high" &&
      entry.source === "location_learning" && entry.reviewStatus === "confirmed"
    ),
    "Enabled mode automatically wrote an untrusted or insufficient-confidence entry."
  );
  assert(await count("review_items") > 0, "Enabled mode did not keep uncertain stays or commutes in Review.");
  const automaticReview = await pool.query(
    `select 1 from review_items
     where workspace_id = $1 and user_id = $2 and event_id = any($3::uuid[])`,
    [WORKSPACE_ID, USER_ID, automaticEntries.rows.map((entry) => entry.eventId)]
  );
  assert.equal(automaticReview.rowCount, 0, "An automatically confirmed event also created a Review item.");

  const entryCount = await count("time_entries");
  const reviewCount = await count("review_items");
  await ingestLocationEvidence(enabledBatch, session, PROCESSING_AT);
  assert.equal(await count("time_entries"), entryCount, "Enabled-mode retry duplicated automatic entries.");
  assert.equal(await count("review_items"), reviewCount, "Enabled-mode retry duplicated Review items.");

  const blocked = automaticEntries.rows[0];
  await clearDerivedLocationState();
  await pool.query(
    `insert into time_entries (
       workspace_id, user_id, place_id, source, confidence, review_status,
       description, started_at, stopped_at
     ) values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'Existing tracked time', $4, $5)`,
    [WORKSPACE_ID, USER_ID, blocked.placeId, blocked.startedAt, blocked.stoppedAt]
  );
  await ingestLocationEvidence(enabledBatch, session, PROCESSING_AT);
  const overlapReview = await pool.query(
    `select 1 from review_items
     where workspace_id = $1 and user_id = $2
       and suggested_place_id = $3
       and suggested_started_at = $4
       and suggested_stopped_at = $5
       and notes like 'This detected visit overlaps existing tracked time%'`,
    [WORKSPACE_ID, USER_ID, blocked.placeId, blocked.startedAt, blocked.stoppedAt]
  );
  assert.equal(overlapReview.rowCount, 1, "An overlapping trusted stay did not fall back to Review.");
}

async function validateV1Compatibility() {
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_shadow";
  const placeId = LOCATION_ACCEPTANCE_PLACES[0].id;
  await processActivityEvent({
    source: "geofence_specific",
    type: "geofence_enter",
    occurredAt: new Date("2026-07-20T19:00:00.000Z"),
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    clientEventId: "db-v1-geofence-compatible",
    placeId,
    rawPayload: { placeId }
  }, session);
  const result = await pool.query(
    `select 1 from activity_events
     where workspace_id = $1 and user_id = $2 and client_event_id = 'db-v1-geofence-compatible'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(result.rowCount, 1, "Legacy V1 geofence event was not persisted.");
}

async function main() {
  try {
    await seedOwner();
    await validateOutOfOrderAndIdempotency();
    await validateShadowToReviewCutover();
    await validateSemanticIdempotencyAndRollback();
    await validateEnabledTrustedPlaceAutomation();
    await validateV1Compatibility();
    console.log("Location V2 database validation passed: ordered replay, duplicate ingest, shadow cutover, semantic idempotency, trusted-place automation, automatic-entry idempotency, atomic rollback, concurrent retry, split, merge, incompatible-merge rejection, and V1 compatibility.");
  } finally {
    if (process.env.KEEP_LOCATION_V2_DB_FIXTURE !== "1") {
      await pool.query("delete from workspaces where id = $1", [WORKSPACE_ID]).catch(() => undefined);
      await pool.query("delete from users where id = $1", [USER_ID]).catch(() => undefined);
    } else {
      console.log(`Retained disposable browser fixture for workspace ${WORKSPACE_ID} and user ${USER_ID}.`);
    }
    await pool.end();
  }
}

void main();
