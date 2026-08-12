import assert from "node:assert/strict";
import {
  LOCATION_ACCEPTANCE_PLACES,
  LOCATION_ENGINE_V2_CONFIG,
  locationAcceptanceFixture,
  runLocationEngine,
  type CommuteSegment,
  type LocationEvidence,
  type LocationEvidenceBatchRequest
} from "@dayframe/shared";
import { pool } from "../apps/web/src/lib/db";
import { ensureCommuteCategoryId } from "../apps/web/src/lib/automatic-category-service";
import { processActivityEvent } from "../apps/web/src/lib/event-service";
import {
  ingestLocationEvidence,
  replayRetainedLocationEvidence
} from "../apps/web/src/lib/location/location-ingest-service";
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
  evidence: LocationEvidence[],
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

function trustedCommuteFixture(prefix = "trusted-commute") {
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  const sportsVenue = LOCATION_ACCEPTANCE_PLACES[2];
  const baseTime = Date.parse("2026-07-20T08:00:00.000Z");
  const evidence = (
    id: string,
    minute: number,
    point: { latitude: number; longitude: number },
    options: Partial<LocationEvidence> = {}
  ): LocationEvidence => ({
    clientEvidenceId: `${prefix}-${id}`,
    deviceId: DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location",
    occurredAt: new Date(baseTime + minute * 60_000).toISOString(),
    latitude: point.latitude,
    longitude: point.longitude,
    horizontalAccuracyMeters: 25,
    receivedAt: PROCESSING_AT,
    timeZone: "Europe/London",
    ...options
  });
  const items = [
    evidence("home-1", 0, home, { savedPlaceId: home.id }),
    evidence("home-2", 5, home),
    evidence("home-3", 10, home),
    evidence("route-1", 12, { latitude: 51.503, longitude: -0.1246 }, { speedMetersPerSecond: 12 }),
    evidence("route-2", 15, { latitude: 51.505, longitude: -0.1246 }, { speedMetersPerSecond: 12 }),
    evidence("route-3", 18, { latitude: 51.507, longitude: -0.1246 }, { speedMetersPerSecond: 12 }),
    evidence("sports-1", 21, sportsVenue, { savedPlaceId: sportsVenue.id }),
    evidence("sports-2", 26, sportsVenue),
    evidence("sports-3", 31, sportsVenue)
  ];
  const result = runLocationEngine({
    priorState: {
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      mode: "idle",
      activeSegmentId: null,
      processedEvidenceIds: [],
      lastProcessedAt: null
    },
    evidence: items,
    savedPlaces: LOCATION_ACCEPTANCE_PLACES,
    acceptedLearnedPlaces: [],
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt: PROCESSING_AT
  });
  const commute = result.segmentUpserts.find(
    (segment): segment is CommuteSegment => segment.kind === "commute"
  );
  assert(commute, "Trusted commute fixture produced no commute.");
  assert.equal(commute.status, "finalised", "Trusted commute fixture is not finalised.");
  assert.equal(commute.confidence, "medium_high", "Trusted commute fixture lost medium-high confidence.");
  assert.equal(commute.continuityStatus, "continuous", "Trusted commute fixture has an uncertain boundary.");
  assert.equal(commute.qualificationReason, "significant_endpoint_displacement");
  assert(commute.fromPlaceId && commute.toPlaceId, "Trusted commute fixture lost a saved endpoint.");
  assert(commute.routeSampleCount >= 2, "Trusted commute fixture lost route evidence.");
  return { commute, evidence: items };
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

async function validateCommuteCategoryConcurrency() {
  await pool.query(
    "delete from categories where workspace_id = $1 and lower(name) = 'commute'",
    [WORKSPACE_ID]
  );
  const ensureInTransaction = async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const id = await ensureCommuteCategoryId(client, session);
      await client.query("commit");
      return id;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  };
  const categoryIds = await Promise.all([
    ensureInTransaction(),
    ensureInTransaction(),
    ensureInTransaction()
  ]);
  assert.equal(new Set(categoryIds).size, 1, "Concurrent Commute ensures returned different categories.");
  const categories = await pool.query<{ id: string; name: string; color: string }>(
    `select id, name, color from categories
     where workspace_id = $1 and lower(name) = 'commute' and coalesce(is_archived, false) = false`,
    [WORKSPACE_ID]
  );
  assert.equal(categories.rows.length, 1, "Concurrent Commute ensures created duplicates.");
  assert.deepEqual(
    categories.rows[0],
    { id: categoryIds[0], name: "Commute", color: "sky" },
    "Commute automatic category used the wrong semantic palette."
  );
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

async function validateCommuteReviewCategoryAndDescription() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const existingCategory = await pool.query<{ id: string }>(
    `update categories
     set name = 'cOmMuTe'
     where workspace_id = $1 and lower(name) = 'commute'
     returning id`,
    [WORKSPACE_ID]
  );
  assert(existingCategory.rows[0], "Commute category concurrency fixture is missing.");
  const commuteCategoryId = existingCategory.rows[0].id;
  const fixture = locationAcceptanceFixture();
  const commuteBatch = batch(
    "db-commute-review-quality",
    fixture.evidence,
    "v2_review",
    fixture.evidence[0].occurredAt
  );
  await ingestLocationEvidence(commuteBatch, session, PROCESSING_AT);

  const categories = await pool.query<{ id: string; name: string; color: string }>(
    `select id, name, color from categories
     where workspace_id = $1 and lower(name) = 'commute' and coalesce(is_archived, false) = false`,
    [WORKSPACE_ID]
  );
  assert.deepEqual(
    categories.rows,
    [{ id: commuteCategoryId, name: "cOmMuTe", color: "sky" }],
    "Semantic emission did not reuse the existing Commute category case-insensitively."
  );

  const commuteReviews = await pool.query<{
    id: string;
    eventId: string;
    eventCategoryId: string | null;
    reviewCategoryId: string | null;
  }>(
    `select ri.id, ri.event_id as "eventId",
            ae.suggested_category_id as "eventCategoryId",
            ri.suggested_category_id as "reviewCategoryId"
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     where ri.workspace_id = $1 and ri.user_id = $2
       and ri.status = 'open' and ae.event_type = 'commute_detected'
     order by ri.created_at, ri.id`,
    [WORKSPACE_ID, USER_ID]
  );
  assert(commuteReviews.rows.length >= 6, "Commute review quality fixture needs six commute rows.");
  assert(
    commuteReviews.rows.every(
      (row) =>
        row.eventCategoryId === commuteCategoryId &&
        row.reviewCategoryId === commuteCategoryId
    ),
    "A commute activity event or Review item was emitted without Commute."
  );
  const visitWithCommute = await pool.query(
    `select 1
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     where ri.workspace_id = $1 and ri.user_id = $2
       and ae.event_type <> 'commute_detected'
       and ri.suggested_category_id = $3
     limit 1`,
    [WORKSPACE_ID, USER_ID, commuteCategoryId]
  );
  assert.equal(visitWithCommute.rowCount, 0, "A non-commute review inherited Commute.");

  const persistedBounds = await pool.query<{
    lower: string | null;
    upper: string | null;
    reason: string | null;
  }>(
    `select start_lower_bound_at as lower, start_upper_bound_at as upper,
            metadata ->> 'qualificationReason' as reason
     from commute_segments
     where workspace_id = $1 and user_id = $2 and status <> 'superseded'
     order by started_at
     limit 1`,
    [WORKSPACE_ID, USER_ID]
  );
  assert(persistedBounds.rows[0]?.lower, "Recovered commute lost its lower start bound.");
  assert(persistedBounds.rows[0]?.upper, "Recovered commute lost its upper start bound.");
  assert(persistedBounds.rows[0]?.reason, "Commute qualification reason was not persisted.");
  assert(
    Date.parse(persistedBounds.rows[0].lower!) <= Date.parse(persistedBounds.rows[0].upper!),
    "Commute uncertainty bounds are inverted."
  );

  const repair = commuteReviews.rows[0];
  await pool.query(
    "update review_items set suggested_category_id = null where id = $1",
    [repair.id]
  );
  await pool.query(
    "update activity_events set suggested_category_id = null where id = $1",
    [repair.eventId]
  );
  await ingestLocationEvidence(commuteBatch, session, PROCESSING_AT);
  const repaired = await pool.query<{
    eventCategoryId: string | null;
    reviewCategoryId: string | null;
  }>(
    `select ae.suggested_category_id as "eventCategoryId",
            ri.suggested_category_id as "reviewCategoryId"
     from review_items ri
     join activity_events ae on ae.id = ri.event_id
     where ri.id = $1 and ri.workspace_id = $2 and ri.user_id = $3`,
    [repair.id, WORKSPACE_ID, USER_ID]
  );
  assert.deepEqual(
    repaired.rows[0],
    { eventCategoryId: commuteCategoryId, reviewCategoryId: commuteCategoryId },
    "Replay did not repair a still-open commute category."
  );

  const ignored = commuteReviews.rows[1];
  await pool.query(
    "update review_items set status = 'ignored', suggested_category_id = null where id = $1",
    [ignored.id]
  );
  await pool.query(
    "update activity_events set review_status = 'ignored', suggested_category_id = null where id = $1",
    [ignored.eventId]
  );
  await ingestLocationEvidence(commuteBatch, session, PROCESSING_AT);
  const ignoredAfterReplay = await pool.query<{
    eventCategoryId: string | null;
    reviewCategoryId: string | null;
    status: string;
  }>(
    `select ae.suggested_category_id as "eventCategoryId",
            ri.suggested_category_id as "reviewCategoryId", ri.status
     from review_items ri
     join activity_events ae on ae.id = ri.event_id
     where ri.id = $1`,
    [ignored.id]
  );
  assert.deepEqual(
    ignoredAfterReplay.rows[0],
    { eventCategoryId: null, reviewCategoryId: null, status: "ignored" },
    "Replay overwrote an ignored commute review."
  );

  const legacy = commuteReviews.rows[2];
  await pool.query(
    "update review_items set suggested_category_id = null where id = $1",
    [legacy.id]
  );
  const confirmed = await resolveLocationReviewAction(
    legacy.id,
    { action: "confirm" },
    session
  );
  assert("entryId" in confirmed && confirmed.entryId, "Legacy commute confirmation created no entry.");
  const confirmedEntry = await pool.query<{
    categoryId: string | null;
    description: string | null;
  }>(
    `select category_id as "categoryId", description
     from time_entries
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [confirmed.entryId, WORKSPACE_ID, USER_ID]
  );
  assert.deepEqual(
    confirmedEntry.rows[0],
    { categoryId: commuteCategoryId, description: null },
    "Legacy commute confirmation did not self-heal category-only semantics."
  );
  const timeEntryCount = await count("time_entries");
  const repeated = await resolveLocationReviewAction(
    legacy.id,
    { action: "confirm" },
    session
  );
  assert(repeated.alreadyResolved, "Repeated commute confirmation was not idempotent.");
  assert.equal(await count("time_entries"), timeEntryCount, "Repeated commute confirmation duplicated an entry.");

  const explicit = await resolveLocationReviewAction(
    commuteReviews.rows[3].id,
    { action: "edit_and_confirm", edit: { description: "  Train home  " } },
    session
  );
  assert("entryId" in explicit && explicit.entryId);
  const explicitEntry = await pool.query<{ description: string | null }>(
    "select description from time_entries where id = $1",
    [explicit.entryId]
  );
  assert.equal(explicitEntry.rows[0].description, "Train home", "Explicit commute description was lost.");

  const blank = await resolveLocationReviewAction(
    commuteReviews.rows[4].id,
    { action: "edit_and_confirm", edit: { description: "   " } },
    session
  );
  assert("entryId" in blank && blank.entryId);
  const blankEntry = await pool.query<{ description: string | null }>(
    "select description from time_entries where id = $1",
    [blank.entryId]
  );
  assert.equal(blankEntry.rows[0].description, null, "Blank commute description was not null.");

  await assert.rejects(
    () => resolveLocationReviewAction(
      commuteReviews.rows[5].id,
      { action: "confirm" },
      { ...session, workspaceId: "30000000-0000-4000-8000-000000000099" }
    ),
    /not found/i
  );
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
    eventType: string;
    startedAt: string;
    stoppedAt: string;
  }>(
    `select te.place_id as "placeId", te.confidence, te.source,
            te.review_status as "reviewStatus", te.created_from_event_id as "eventId",
            ae.event_type as "eventType", te.started_at as "startedAt", te.stopped_at as "stoppedAt"
     from time_entries te
     join activity_events ae
       on ae.id = te.created_from_event_id
      and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
     where te.workspace_id = $1 and te.user_id = $2`,
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
  assert(
    automaticEntries.rows.every((entry) => entry.eventType !== "commute_detected"),
    "An uncertain acceptance-fixture commute was automatically logged."
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
       and notes like 'Automatic logging paused because this visit overlaps existing tracked time%'`,
    [WORKSPACE_ID, USER_ID, blocked.placeId, blocked.startedAt, blocked.stoppedAt]
  );
  assert.equal(overlapReview.rowCount, 1, "An overlapping trusted stay did not fall back to Review.");
}

async function validateEnabledTrustedCommuteAutomation() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_enabled";
  const fixture = trustedCommuteFixture();
  const enabledBatch = batch(
    "db-enabled-trusted-commute",
    fixture.evidence,
    "v2_enabled",
    fixture.evidence[0].occurredAt
  );
  await ingestLocationEvidence(enabledBatch, session, PROCESSING_AT);

  const automaticCommutes = await pool.query<{
    id: string;
    eventId: string;
    categoryName: string | null;
    placeId: string | null;
    description: string | null;
    confidence: string;
    source: string;
    reviewStatus: string;
    eventReviewStatus: string;
    semanticDisposition: string | null;
    semanticReason: string | null;
  }>(
    `select te.id, te.created_from_event_id as "eventId", c.name as "categoryName",
            te.place_id as "placeId", te.description, te.confidence, te.source,
            te.review_status as "reviewStatus", ae.review_status as "eventReviewStatus",
            ae.raw_payload ->> 'semanticDisposition' as "semanticDisposition",
            ae.raw_payload ->> 'semanticReason' as "semanticReason"
     from time_entries te
     join activity_events ae
       on ae.id = te.created_from_event_id
      and ae.workspace_id = te.workspace_id and ae.user_id = te.user_id
     left join categories c
       on c.id = te.category_id and c.workspace_id = te.workspace_id
     where te.workspace_id = $1 and te.user_id = $2 and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(automaticCommutes.rows.length, 1, "Trusted commute did not create exactly one automatic entry.");
  const automaticCommute = automaticCommutes.rows[0];
  assert.deepEqual(
    {
      categoryName: automaticCommute.categoryName?.toLowerCase(),
      placeId: automaticCommute.placeId,
      description: automaticCommute.description,
      confidence: automaticCommute.confidence,
      source: automaticCommute.source,
      reviewStatus: automaticCommute.reviewStatus,
      eventReviewStatus: automaticCommute.eventReviewStatus,
      semanticDisposition: automaticCommute.semanticDisposition,
      semanticReason: automaticCommute.semanticReason
    },
    {
      categoryName: "commute",
      placeId: null,
      description: null,
      confidence: "medium_high",
      source: "location_learning",
      reviewStatus: "confirmed",
      eventReviewStatus: "confirmed",
      semanticDisposition: "auto_confirmed",
      semanticReason: "enabled_trusted_commute"
    },
    "Trusted commute automatic entry did not preserve the category-only event-first contract."
  );
  const automaticReview = await pool.query(
    `select 1 from review_items
     where workspace_id = $1 and user_id = $2 and event_id = $3`,
    [WORKSPACE_ID, USER_ID, automaticCommute.eventId]
  );
  assert.equal(automaticReview.rowCount, 0, "An automatically logged commute also entered Review.");

  await ingestLocationEvidence(enabledBatch, session, PROCESSING_AT);
  const commuteCountAfterRetry = await pool.query<{ count: number }>(
    `select count(*)::integer as count
     from time_entries te
     join activity_events ae on ae.id = te.created_from_event_id
     where te.workspace_id = $1 and te.user_id = $2 and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(commuteCountAfterRetry.rows[0].count, 1, "Trusted commute replay duplicated its automatic entry.");

  await pool.query(
    "delete from time_entries where id = $1 and workspace_id = $2 and user_id = $3",
    [automaticCommute.id, WORKSPACE_ID, USER_ID]
  );
  await ingestLocationEvidence(enabledBatch, session, PROCESSING_AT);
  const commuteCountAfterDeleteReplay = await pool.query<{ count: number }>(
    `select count(*)::integer as count
     from time_entries te
     join activity_events ae on ae.id = te.created_from_event_id
     where te.workspace_id = $1 and te.user_id = $2 and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(
    commuteCountAfterDeleteReplay.rows[0].count,
    0,
    "Replay recreated an automatic commute after the user deleted it."
  );

  await clearDerivedLocationState();
  await pool.query(
    `insert into time_entries (
       workspace_id, user_id, source, confidence, review_status,
       description, started_at, stopped_at
     ) values ($1, $2, 'manual_app', 'high', 'confirmed', 'Existing tracked time', $3, $4)`,
    [WORKSPACE_ID, USER_ID, fixture.commute.startedAt, fixture.commute.stoppedAt]
  );
  const overlapBatch = batch(
    "db-enabled-trusted-commute-overlap",
    fixture.evidence,
    "v2_enabled",
    fixture.evidence[0].occurredAt
  );
  await ingestLocationEvidence(overlapBatch, session, PROCESSING_AT);
  const overlapReview = await pool.query<{
    id: string;
    eventId: string;
    status: string;
    notes: string | null;
    semanticReason: string | null;
  }>(
    `select ri.id, ri.event_id as "eventId", ri.status, ri.notes,
            ae.raw_payload ->> 'semanticReason' as "semanticReason"
     from review_items ri
     join activity_events ae
       on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
     where ri.workspace_id = $1 and ri.user_id = $2
       and ri.status = 'open' and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(overlapReview.rows.length, 1, "An overlapping trusted commute did not fall back to Review.");
  assert.equal(overlapReview.rows[0].semanticReason, "confirmed_time_overlap");
  assert.match(overlapReview.rows[0].notes ?? "", /this commute overlaps existing tracked time/i);
  const overlapAutomaticEntry = await pool.query(
    `select 1 from time_entries te
     join activity_events ae on ae.id = te.created_from_event_id
     where te.workspace_id = $1 and te.user_id = $2 and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(overlapAutomaticEntry.rowCount, 0, "An overlapping commute was automatically logged.");

  await pool.query(
    `delete from time_entries
     where workspace_id = $1 and user_id = $2 and source = 'manual_app' and description = 'Existing tracked time'`,
    [WORKSPACE_ID, USER_ID]
  );
  await ingestLocationEvidence(overlapBatch, session, PROCESSING_AT);
  const preservedReview = await pool.query<{
    status: string;
    notes: string | null;
    semanticReason: string | null;
  }>(
    `select ri.status, ri.notes, ae.raw_payload ->> 'semanticReason' as "semanticReason"
     from review_items ri
     join activity_events ae on ae.id = ri.event_id
     where ri.id = $1`,
    [overlapReview.rows[0].id]
  );
  assert.equal(preservedReview.rows[0].status, "open");
  assert.equal(preservedReview.rows[0].semanticReason, "existing_review_preserved");
  assert.match(preservedReview.rows[0].notes ?? "", /already awaiting your decision/i);
  assert.equal(
    (await pool.query(
      `select 1 from time_entries where workspace_id = $1 and user_id = $2 and created_from_event_id = $3`,
      [WORKSPACE_ID, USER_ID, overlapReview.rows[0].eventId]
    )).rowCount,
    0,
    "Removing an overlap silently promoted an existing Review item."
  );

  await resolveLocationReviewAction(
    overlapReview.rows[0].id,
    { action: "ignore_once_location" },
    session
  );
  await ingestLocationEvidence(overlapBatch, session, PROCESSING_AT);
  const ignoredAfterReplay = await pool.query<{ reviewStatus: string; eventReviewStatus: string }>(
    `select ri.status as "reviewStatus", ae.review_status as "eventReviewStatus"
     from review_items ri
     join activity_events ae on ae.id = ri.event_id
     where ri.id = $1`,
    [overlapReview.rows[0].id]
  );
  assert.deepEqual(
    ignoredAfterReplay.rows[0],
    { reviewStatus: "ignored", eventReviewStatus: "ignored" },
    "Replay reopened an ignored commute decision."
  );
  assert.equal(
    (await pool.query(
      `select 1 from time_entries where workspace_id = $1 and user_id = $2 and created_from_event_id = $3`,
      [WORKSPACE_ID, USER_ID, overlapReview.rows[0].eventId]
    )).rowCount,
    0,
    "Replay created an entry for an ignored commute."
  );
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

async function validateFinalisationWithoutNewEvidence() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const fixture = locationAcceptanceFixture();
  const evidenceBeforeFinalisation = fixture.evidence.filter(
    (item) => Date.parse(item.occurredAt) <= Date.parse("2026-07-20T14:38:00.000Z")
  );
  const semanticModeAcknowledgedAt = "2026-06-01T07:00:00.000Z";
  await ingestLocationEvidence(
    batch("db-finalisation-before-lag", evidenceBeforeFinalisation, "v2_review", semanticModeAcknowledgedAt),
    session,
    "2026-07-20T14:28:30.000Z"
  );
  const reviewsBeforeReplay = await count("review_items");
  const replayRequest = {
    deviceId: DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    rolloutMode: "v2_review" as const,
    semanticModeAcknowledgedAt
  };
  const firstReplay = await replayRetainedLocationEvidence(
    replayRequest,
    session,
    "2026-07-20T14:40:00.000Z"
  );
  const reviewsAfterReplay = await count("review_items");
  assert(firstReplay.finalisedSegmentCount > 0, "Explicit replay finalised no retained segments.");
  assert(firstReplay.semanticSegmentCount > 0, "Explicit replay emitted no semantic segments.");
  assert(
    reviewsAfterReplay > reviewsBeforeReplay,
    "A segment that crossed the finalisation lag without new evidence did not enter Review."
  );
  await replayRetainedLocationEvidence(replayRequest, session, "2026-07-20T14:45:00.000Z");
  assert.equal(
    await count("review_items"),
    reviewsAfterReplay,
    "Repeated explicit replay duplicated Review items."
  );
}

async function main() {
  try {
    await seedOwner();
    await validateCommuteCategoryConcurrency();
    await validateOutOfOrderAndIdempotency();
    await validateShadowToReviewCutover();
    await validateSemanticIdempotencyAndRollback();
    await validateCommuteReviewCategoryAndDescription();
    await validateEnabledTrustedPlaceAutomation();
    await validateEnabledTrustedCommuteAutomation();
    await validateFinalisationWithoutNewEvidence();
    await validateV1Compatibility();
    console.log("Location V2 database validation passed: ordered replay, duplicate ingest, shadow cutover, no-new-evidence finalisation, semantic idempotency, Commute category concurrency/emission/replay/confirmation, uncertainty bounds, description semantics, isolation, trusted-place and trusted-commute automation, overlap fallback, terminal-decision preservation, automatic-entry deletion safety, automatic-entry idempotency, atomic rollback, concurrent retry, split, merge, incompatible-merge rejection, and V1 compatibility.");
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
