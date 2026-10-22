import { validateSavedPlaceQuality } from "./fixtures/location-saved-place-quality";
import { validateSavedPlaceArrivalBoundaries } from "./fixtures/location-saved-place-arrival-boundaries";
import assert from "node:assert/strict";
import {
  LOCATION_ACCEPTANCE_PLACES,
  LOCATION_ENGINE_V2_CONFIG,
  locationAcceptanceFixture,
  nameBand,
  PHYSICAL_STOP_PICKUP,
  physicalStopFixture,
  runLocationEngine,
  type CommuteSegment,
  type LocationEvidence,
  type LocationEvidenceBatchRequest
} from "@dayframe/shared";
import { MissingRequiredColumnError, pool } from "../apps/web/src/lib/db";
import { ensureCommuteCategoryId } from "../apps/web/src/lib/automatic-category-service";
import { deletePlace, PlaceDeleteBusyError, processActivityEvent, updatePlace } from "../apps/web/src/lib/event-service";
import {
  ingestLocationEvidence as storeLocationEvidence,
  replayRetainedLocationEvidence
} from "../apps/web/src/lib/location/location-ingest-service";
import { isLocationSegmentReview, resolveLocationReviewAction } from "../apps/web/src/lib/location/location-review-service";
import {
  forgetLearnedNameForEntry, hashedPatternKey, learnedNamesFor, recordLearnedName, resumeLoggingTrips, stopLoggingTripsLike, stoppedTripPatterns
} from "../apps/web/src/lib/location/name-patterns";
import { reconcileReviewMutations, resolveIdempotentReviewMutation } from "../apps/web/src/lib/review-mutation-service";
import { reconcileHealthCoveredMoveCardsNow } from "../apps/web/src/lib/location/health-coverage";
import type { RequestSession } from "../apps/web/src/lib/session";
import { buildTimeEntriesQuery, getBootstrapData } from "../apps/web/src/lib/queries";
import { openReviewCountFor } from "../apps/web/src/lib/review-count";
import { foldedOutingMemberSql, OUTING_STAYS_SQL } from "../apps/web/src/lib/review-card-count";
import { getReviewPresentation } from "../apps/web/src/lib/review-presentation-service";
import { REVIEW_DECISION_PAYLOAD_KEY } from "../apps/web/src/lib/review-decision-signal";

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
  semanticModeAcknowledgedAt?: string,
  deviceId = DEVICE_ID
) {
  return {
    clientBatchId,
    deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    timeZone: "Europe/London",
    rolloutMode,
    semanticModeAcknowledgedAt,
    evidence
  };
}

async function ingestLocationEvidence(
  evidenceBatch: ReturnType<typeof batch>,
  requestSession: RequestSession,
  processingAt = PROCESSING_AT
) {
  return (await ingestAndReplayLocationEvidence(evidenceBatch, requestSession, processingAt)).ingest;
}

async function ingestAndReplayLocationEvidence(
  evidenceBatch: ReturnType<typeof batch>,
  requestSession: RequestSession,
  processingAt = PROCESSING_AT
) {
  const ingest = await storeLocationEvidence(evidenceBatch, requestSession, processingAt);
  const replay = await replayRetainedLocationEvidence(
    {
      deviceId: evidenceBatch.deviceId,
      algorithmVersion: evidenceBatch.algorithmVersion,
      rolloutMode: evidenceBatch.rolloutMode,
      semanticModeAcknowledgedAt: evidenceBatch.semanticModeAcknowledgedAt
    },
    requestSession,
    processingAt
  );
  return { ingest, replay };
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

async function clearDerivedLocationState(options: { keepNamePatterns?: boolean } = {}) {
  // Learned names (PRD D19, A8) come from decisions, so one validator's typed names would name the
  // next validator's cards.
  if (!options.keepNamePatterns) {
    await pool.query("delete from location_name_patterns where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  }
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
  const categories = await pool.query<{ id: string; name: string; color: string; icon: string | null; starterKey: string | null }>(
    `select id, name, color, icon, starter_key as "starterKey" from categories
     where workspace_id = $1 and lower(name) = 'commute' and coalesce(is_archived, false) = false`,
    [WORKSPACE_ID]
  );
  assert.equal(categories.rows.length, 1, "Concurrent Commute ensures created duplicates.");
  // An automatic Commute is the Commute starter activity (colour, icon and starter key).
  assert.deepEqual(
    categories.rows[0],
    { id: categoryIds[0], name: "Commute", color: "graphite", icon: "commute", starterKey: "commute" },
    "Commute automatic category did not use the Commute starter activity."
  );
}

async function validateOutOfOrderAndIdempotency() {
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_shadow";
  const evidence = locationAcceptanceFixture().evidence;
  const midpoint = Math.floor(evidence.length / 2);
  await ingestLocationEvidence(batch("db-out-of-order-later", evidence.slice(midpoint), "v2_shadow"), session);
  await ingestLocationEvidence(batch("db-out-of-order-earlier", evidence.slice(0, midpoint), "v2_shadow"), session);
  const outOfOrder = await segmentSnapshot();
  assert(outOfOrder.length > 0, "Out-of-order replay produced no segments.");

  await clearDerivedLocationState();
  const orderedBatch = batch("db-ordered", evidence, "v2_shadow");
  const orderedResult = await ingestLocationEvidence(orderedBatch, session);
  const ordered = await segmentSnapshot();
  assert.deepEqual(outOfOrder, ordered, "Out-of-order upload changed the canonical segment snapshot.");
  const evidenceCount = await count("location_evidence");
  const eventCount = await count("activity_events");
  const duplicate = await ingestLocationEvidence(orderedBatch, session);
  assert.equal(duplicate.duplicateBatch, true);
  assert.equal(await count("location_evidence"), evidenceCount, "Duplicate upload inserted evidence.");
  assert.equal(await count("activity_events"), eventCount, "Duplicate upload inserted an activity event.");
  assert.deepEqual(await segmentSnapshot(), ordered, "Duplicate upload changed segments.");
  assert.equal(orderedResult.rolloutMode, "v2_shadow");
  assert.equal(await count("review_items"), 0, "Shadow mode created user-visible reviews.");
  assert.equal(await count("time_entries"), 0, "Shadow mode created time entries.");
}

// Stability audit 22 Oct 2026 (location-1/2): one reading naming a saved place that no longer exists,
// or one outside the replay window, never fails or drops the readings beside it.
async function validateIngestPerReadingFailures() {
  await clearDerivedLocationState();
  const goneId = "30000000-0000-4000-8000-0000000000aa";
  const home = LOCATION_ACCEPTANCE_PLACES[0]!;
  const reading = (id: string, occurredAt: string, patch: Partial<LocationEvidence> = {}): LocationEvidence => ({
    clientEvidenceId: `per-reading-${id}`, deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location", occurredAt, latitude: home.latitude, longitude: home.longitude,
    horizontalAccuracyMeters: 10, receivedAt: PROCESSING_AT, timeZone: "Europe/London", ...patch
  });
  const evidence = [
    reading("fix", "2026-07-20T19:00:00.000Z"),
    reading("gone-place", "2026-07-20T19:05:00.000Z", { kind: "geofence_exit", latitude: null, longitude: null, horizontalAccuracyMeters: null, savedPlaceId: goneId }),
    reading("future", "2026-07-20T22:00:00.000Z"),
    reading("too-old", "2026-06-01T12:00:00.000Z")
  ];
  const result = await storeLocationEvidence(batch("db-per-reading", evidence, "v2_shadow"), session, PROCESSING_AT);
  assert.deepEqual(
    [...result.acknowledgedEvidenceIds].sort(),
    evidence.map((item) => item.clientEvidenceId).sort(),
    "Every reading of a batch with one bad reading must be acknowledged."
  );
  const rows = (await pool.query<{
    id: string; accepted: boolean; reason: string | null; placeId: string | null; hasCoordinate: boolean;
  }>(
    `select client_evidence_id as id, accepted, rejection_reason as reason, saved_place_id as "placeId",
            coordinate is not null as "hasCoordinate"
       from location_evidence where workspace_id = $1 and user_id = $2 and client_batch_id = 'db-per-reading'
      order by client_evidence_id`,
    [WORKSPACE_ID, USER_ID]
  )).rows;
  const byId = new Map(rows.map((row) => [row.id.replace("per-reading-", ""), row]));
  assert.equal(rows.length, 4, "Every reading must be stored.");
  assert.equal(byId.get("fix")?.accepted, true, "A good reading beside bad ones must be accepted.");
  assert.equal(byId.get("fix")?.hasCoordinate, true, "A good reading keeps its coordinate.");
  assert.equal(byId.get("gone-place")?.accepted, true, "A reading for a deleted place is kept.");
  assert.equal(byId.get("gone-place")?.placeId, null, "A reading for a deleted place is unlinked.");
  for (const id of ["future", "too-old"]) {
    assert.equal(byId.get(id)?.accepted, false, `The ${id} reading must be rejected on its own.`);
    assert.equal(byId.get(id)?.reason, "outside_replay_window", `The ${id} reading must say why.`);
    assert.equal(byId.get(id)?.hasCoordinate, false, `The ${id} reading keeps no coordinate.`);
  }
  assert(result.warnings.some((warning) => warning.includes("no longer exist")), "The unlinked place is reported.");
  await clearDerivedLocationState();
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
  const first = await ingestAndReplayLocationEvidence(semanticBatch, session, PROCESSING_AT);
  const reviewBeforeRetry = await count("review_items");
  const eventBeforeRetry = await count("activity_events");
  assert(reviewBeforeRetry > 1, "Review mode did not create review items.");
  assert.equal(await count("time_entries"), 0, "Review mode auto-confirmed a time entry.");
  // The app reloads its Dashboard only when a replay changed something it shows.
  assert.equal(first.replay.semanticChangeCount, reviewBeforeRetry, "First Review replay did not count each new Review item.");
  const retry = await ingestAndReplayLocationEvidence(semanticBatch, session, PROCESSING_AT);
  assert(retry.replay.semanticSegmentCount > 0, "Retry did not re-emit the finalised segments.");
  assert.equal(retry.replay.semanticChangeCount, 0, "An identical replay reported Review changes.");
  // A replay that changes only an open event's payload (as late Motion & Fitness evidence changes a
  // journey's travel mode, which Review shows) still counts, though no Review column changes.
  await pool.query(
    `update activity_events set raw_payload = raw_payload || '{"staleSemanticField": true}'::jsonb
     where id = (select id from activity_events where workspace_id = $1 and user_id = $2
       and source = 'location_learning' and review_status = 'needs_review' order by occurred_at, id limit 1)`,
    [WORKSPACE_ID, USER_ID]
  );
  const payloadOnly = await ingestAndReplayLocationEvidence(semanticBatch, session, PROCESSING_AT);
  assert.equal(payloadOnly.replay.semanticChangeCount, 1, "A payload-only replay change was not counted.");
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

  const contentionTarget = await pool.query<{ segmentId: string }>(
    `select location_segment_id as "segmentId"
     from review_items
     where id = $1 and workspace_id = $2 and user_id = $3`,
    [reviews.rows[1].id, WORKSPACE_ID, USER_ID]
  );
  assert(contentionTarget.rows[0], "Location contention fixture is missing.");
  const expectBoundedLocationContention = async (
    label: string,
    lock: (client: import("pg").PoolClient) => Promise<unknown>
  ) => {
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await lock(holder);
      const startedAt = Date.now();
      await assert.rejects(
        () => resolveLocationReviewAction(
          reviews.rows[1].id,
          { action: "confirm" },
          session
        ),
        (error: unknown) => error instanceof Error &&
          "code" in error &&
          error.code === "review_item_locked"
      );
      assert(
        Date.now() - startedAt < 1_500,
        `${label} did not fail within the 1.5-second bound.`
      );
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  };
  await expectBoundedLocationContention(
    "Direct Location advisory-lock contention",
    (client) => client.query(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [WORKSPACE_ID, USER_ID]
    )
  );
  await expectBoundedLocationContention(
    "Location Review-row contention",
    (client) => client.query(
      `select id from review_items
       where id = $1 and workspace_id = $2 and user_id = $3
       for update`,
      [reviews.rows[1].id, WORKSPACE_ID, USER_ID]
    )
  );
  await expectBoundedLocationContention(
    "Exact stay-segment contention",
    (client) => client.query(
      `select id from stay_segments
       where id = $1 and workspace_id = $2 and user_id = $3
       for update`,
      [contentionTarget.rows[0].segmentId, WORKSPACE_ID, USER_ID]
    )
  );

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

  const concurrentConfirm = await Promise.allSettled([
    resolveLocationReviewAction(reviews.rows[1].id, { action: "confirm" }, session),
    resolveLocationReviewAction(reviews.rows[1].id, { action: "confirm" }, session)
  ]);
  const fulfilledConfirm = concurrentConfirm.filter(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof resolveLocationReviewAction>>> =>
      result.status === "fulfilled"
  );
  assert(fulfilledConfirm.length >= 1, "Concurrent confirm produced no canonical winner.");
  const rejectedConfirm = concurrentConfirm.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejectedConfirm) {
    assert(
      rejectedConfirm.reason instanceof Error &&
        "code" in rejectedConfirm.reason &&
        rejectedConfirm.reason.code === "review_item_locked",
      "Concurrent confirm did not return typed lock contention."
    );
  }
  const confirmReplay = await resolveLocationReviewAction(
    reviews.rows[1].id,
    { action: "confirm" },
    session
  );
  assert.equal(confirmReplay.alreadyResolved, true, "Confirm retry did not resolve idempotently.");
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

/**
 * E1 (Codex r2): Recent learns only descriptions the owner typed while deciding in Review. Each
 * real Review action records (or withholds) the owner-authored signal, and the bootstrap history
 * query reads it back.
 */
async function validateRecentOwnerAuthoredSignal() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const fixture = locationAcceptanceFixture();
  await ingestLocationEvidence(
    batch("db-recent-owner-authored", fixture.evidence, "v2_review", fixture.evidence[0].occurredAt),
    session,
    PROCESSING_AT
  );
  const reviews = await pool.query<{ id: string; title: string; startedAt: string; stoppedAt: string }>(
    `select id, title, suggested_started_at as "startedAt", suggested_stopped_at as "stoppedAt"
     from review_items
     where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id in (
       select id from stay_segments where workspace_id = $1 and user_id = $2
     ) order by suggested_started_at, id`,
    [WORKSPACE_ID, USER_ID]
  );
  assert(reviews.rows.length >= 6, "Six stay reviews are required for owner-authored validation.");
  const [kept, editedBack, renamed, splitSource, mergeKept, mergeRenamed] = reviews.rows;
  const midpoint = (row: { startedAt: string; stoppedAt: string }) => new Date(
    (Date.parse(row.startedAt) + Date.parse(row.stoppedAt)) / 2
  ).toISOString();

  // Accepted as suggested, and edited back to the suggestion: Dayframe's words.
  const keptResult = await resolveLocationReviewAction(kept.id, { action: "confirm" }, session);
  const editedBackResult = await resolveLocationReviewAction(editedBack.id, {
    action: "edit_and_confirm",
    edit: { description: `  ${editedBack.title.toUpperCase()}  ` }
  }, session);
  // Renamed in Review: the owner's words.
  const renamedResult = await resolveLocationReviewAction(renamed.id, {
    action: "edit_and_confirm",
    edit: { description: "Lunch with friends" }
  }, session);
  // Split for Review only, the left part titled by the owner; then confirm each part unchanged.
  const split = await resolveLocationReviewAction(splitSource.id, {
    action: "split",
    splitAt: midpoint(splitSource),
    left: { description: "Football practice" }
  }, session);
  assert("childSegmentIds" in split && split.childSegmentIds.length === 2, "Split did not create two parts.");
  const parts = await pool.query<{ id: string; title: string }>(
    `select id, title from review_items
     where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id = any($3::uuid[])
     order by suggested_started_at`,
    [WORKSPACE_ID, USER_ID, split.childSegmentIds]
  );
  assert.deepEqual(parts.rows.map((row) => row.title), ["Football practice", splitSource.title]);
  const typedPart = await resolveLocationReviewAction(parts.rows[0].id, { action: "confirm" }, session);
  // The inherited part goes through split and confirm again: one half renamed, one inherited.
  const inheritedPart = await pool.query<{ startedAt: string; stoppedAt: string }>(
    `select suggested_started_at as "startedAt", suggested_stopped_at as "stoppedAt" from review_items where id = $1`,
    [parts.rows[1].id]
  );
  const splitAndConfirm = await resolveLocationReviewAction(parts.rows[1].id, {
    action: "split_and_confirm",
    splitAt: midpoint(inheritedPart.rows[0]),
    left: { description: "Picnic" }
  }, session);
  assert("entryIds" in splitAndConfirm && splitAndConfirm.entryIds?.length === 2, "Split and confirm created no parts.");
  // Merge and confirm two parts of one visit: kept under the inherited title, or renamed.
  const mergeParts = async (source: typeof mergeKept, description?: string) => {
    const pieces = await resolveLocationReviewAction(source.id, { action: "split", splitAt: midpoint(source) }, session);
    assert("childSegmentIds" in pieces);
    const items = await pool.query<{ id: string }>(
      `select id from review_items
       where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id = any($3::uuid[])
       order by suggested_started_at`,
      [WORKSPACE_ID, USER_ID, pieces.childSegmentIds]
    );
    const merged = await resolveLocationReviewAction(items.rows[0].id, {
      action: "merge_and_confirm",
      adjacentReviewItemId: items.rows[1].id,
      acknowledgeContradictoryEvidence: false,
      ...(description ? { edit: { description } } : {})
    }, session);
    assert("entryId" in merged && merged.entryId, "Merge and confirm created no entry.");
    return merged.entryId;
  };
  const mergedKept = await mergeParts(mergeKept);
  const mergedRenamed = await mergeParts(mergeRenamed, "Band rehearsal");

  const statement = buildTimeEntriesQuery(session, { limit: 100 });
  const history = await pool.query<{
    id: string;
    description: string | null;
    confirmedInReview: boolean;
    ownerAuthoredInReview: boolean;
  }>(statement.text, statement.values);
  const flags = (entryId: unknown) => {
    const row = history.rows.find((candidate) => candidate.id === entryId);
    assert(row, `History is missing entry ${String(entryId)}.`);
    return [row.confirmedInReview, row.ownerAuthoredInReview];
  };
  assert("entryId" in keptResult && "entryId" in editedBackResult && "entryId" in renamedResult && "entryId" in typedPart);
  assert.deepEqual(flags(keptResult.entryId), [true, false], "A suggestion accepted as is counted as the owner's words.");
  assert.deepEqual(flags(editedBackResult.entryId), [true, false], "A suggestion edited back to itself counted as the owner's words.");
  assert.deepEqual(flags(renamedResult.entryId), [true, true], "A description typed in Review was not recorded as the owner's.");
  assert.deepEqual(flags(typedPart.entryId), [true, true], "A split part titled by the owner lost its owner-authored signal.");
  assert.deepEqual(flags(splitAndConfirm.entryIds[0]), [true, true], "A split-and-confirm part renamed by the owner was not recorded.");
  assert.deepEqual(flags(splitAndConfirm.entryIds[1]), [true, false], "An inherited split-and-confirm title counted as the owner's words.");
  assert.deepEqual(flags(mergedKept), [true, false], "A merge kept under its suggested title counted as the owner's words.");
  assert.deepEqual(flags(mergedRenamed), [true, true], "A merge renamed by the owner was not recorded.");

  // Repeating the decision is idempotent and never flips the signal.
  await resolveLocationReviewAction(kept.id, { action: "confirm" }, session);
  const repeated = await pool.query<{ ownerAuthoredInReview: boolean }>(statement.text, statement.values);
  assert.equal(
    repeated.rows.filter((row) => row.ownerAuthoredInReview).length,
    4,
    "Repeating a decision changed the owner-authored signal."
  );
  const markers = await pool.query<{ count: number }>(
    `select count(*)::integer as count from activity_events
     where workspace_id = $1 and user_id = $2 and raw_payload ? $3`,
    [WORKSPACE_ID, USER_ID, REVIEW_DECISION_PAYLOAD_KEY]
  );
  assert.equal(markers.rows[0].count, 4, "Owner-authored markers were written to unexpected events.");
}

/**
 * E1 (Codex r3): replay can retitle an open suggestion while an editor prefilled with the old
 * title is still open, and older clients send no proposal hash. Every title Dayframe ever
 * suggested must stay Dayframe's, through split corrections too.
 */
async function validateRecentTitleHistoryAcrossReplay() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const fixture = locationAcceptanceFixture();
  const evidenceBatch = batch("db-recent-title-history", fixture.evidence, "v2_review", fixture.evidence[0].occurredAt);
  await ingestLocationEvidence(evidenceBatch, session, PROCESSING_AT);
  const openStays = async () => pool.query<{ id: string; title: string; startedAt: string; stoppedAt: string }>(
    `select id, title, suggested_started_at as "startedAt", suggested_stopped_at as "stoppedAt"
     from review_items
     where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id in (
       select id from stay_segments where workspace_id = $1 and user_id = $2
     ) order by suggested_started_at, id`,
    [WORKSPACE_ID, USER_ID]
  );
  // A Stay is called by its place (PRD D19).
  const savedNames = new Set(LOCATION_ACCEPTANCE_PLACES.map((place) => place.name));
  const before = (await openStays()).rows.filter((row) => savedNames.has(row.title));
  assert(before.length >= 3, "Three saved-place visit suggestions are required for title-history validation.");

  // Rename every saved place, then replay: the open suggestions are retitled in place.
  const renamed = " (renamed)";
  await pool.query("update places set name = name || $2 where workspace_id = $1", [WORKSPACE_ID, renamed]);
  try {
    await ingestLocationEvidence(evidenceBatch, session, PROCESSING_AT);
    const after = new Map((await openStays()).rows.map((row) => [row.id, row]));
    for (const row of before) {
      assert.equal(after.get(row.id)?.title, `${row.title}${renamed}`, "Replay did not retitle the open suggestion.");
    }
    const [stale, chained, control] = before;
    const midpoint = (row: { startedAt: string; stoppedAt: string }) => new Date(
      (Date.parse(row.startedAt) + Date.parse(row.stoppedAt)) / 2
    ).toISOString();

    // A stale editor (or an older client without a proposal hash) confirms the old prefilled title.
    const staleResult = await resolveLocationReviewAction(stale.id, {
      action: "edit_and_confirm",
      edit: { description: stale.title }
    }, session);
    // Replay before a split: the owner splits, keeping the old title on the left part, then
    // confirms it; the right part goes through split and confirm with an inherited and an old title.
    const split = await resolveLocationReviewAction(chained.id, {
      action: "split",
      splitAt: midpoint(after.get(chained.id)!),
      left: { description: chained.title }
    }, session);
    assert("childSegmentIds" in split && split.childSegmentIds.length === 2);
    const parts = await pool.query<{ id: string; startedAt: string; stoppedAt: string }>(
      `select id, suggested_started_at as "startedAt", suggested_stopped_at as "stoppedAt" from review_items
       where workspace_id = $1 and user_id = $2 and status = 'open' and location_segment_id = any($3::uuid[])
       order by suggested_started_at`,
      [WORKSPACE_ID, USER_ID, split.childSegmentIds]
    );
    const oldTitledPart = await resolveLocationReviewAction(parts.rows[0].id, { action: "confirm" }, session);
    const splitAndConfirm = await resolveLocationReviewAction(parts.rows[1].id, {
      action: "split_and_confirm",
      splitAt: midpoint(parts.rows[1]),
      left: { description: `  ${chained.title.toLowerCase()} ` }
    }, session);
    // Control: the owner's own words after the same replay still count.
    const controlResult = await resolveLocationReviewAction(control.id, {
      action: "edit_and_confirm",
      edit: { description: "Dentist appointment" }
    }, session);

    const statement = buildTimeEntriesQuery(session, { limit: 100 });
    const history = await pool.query<{ id: string; ownerAuthoredInReview: boolean }>(statement.text, statement.values);
    const owned = (entryId: unknown) => history.rows.find((row) => row.id === entryId)?.ownerAuthoredInReview;
    assert("entryId" in staleResult && "entryId" in oldTitledPart && "entryId" in controlResult);
    assert("entryIds" in splitAndConfirm && splitAndConfirm.entryIds?.length === 2);
    assert.equal(owned(staleResult.entryId), false, "A stale editor's pre-replay title counted as the owner's words.");
    assert.equal(owned(oldTitledPart.entryId), false, "A split part keeping a pre-replay title counted as the owner's words.");
    assert.equal(owned(splitAndConfirm.entryIds[0]), false, "A split-and-confirm part with a pre-replay title counted as the owner's words.");
    assert.equal(owned(splitAndConfirm.entryIds[1]), false, "An inherited post-replay title counted as the owner's words.");
    assert.equal(owned(controlResult.entryId), true, "The owner's own words after a replay were not recorded.");
  } finally {
    await pool.query(
      "update places set name = left(name, length(name) - length($2)) where workspace_id = $1 and right(name, length($2)) = $2",
      [WORKSPACE_ID, renamed]
    );
  }
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
  // PRD D19: Commute is only between Home and Work. The fixture's Review journeys run from its home
  // to its short-stop place and on to its round-trip place, so the first two hold those roles here;
  // the other Moves suggest Travel.
  const [homePlace, , , workPlace] = LOCATION_ACCEPTANCE_PLACES;
  await pool.query("update places set role = case id when $2 then 'home' when $3 then 'work' end where workspace_id = $1 and id in ($2, $3)",
    [WORKSPACE_ID, homePlace.id, workPlace.id]);
  try {
  const fixture = locationAcceptanceFixture();
  const commuteBatches = Array.from({ length: 3 }, (_, index) => {
    const suffix = index + 1;
    const deviceId = `20000000-0000-4000-8000-${String(suffix + 1).padStart(12, "0")}`;
    const evidence = fixture.evidence.map((item) => ({
      ...item,
      deviceId,
      clientEvidenceId: `review-quality-${suffix}-${item.clientEvidenceId}`
    }));
    return batch(
      `db-commute-review-quality-${suffix}`,
      evidence,
      "v2_review",
      evidence[0].occurredAt,
      deviceId
    );
  });
  for (const commuteBatch of commuteBatches) {
    await ingestLocationEvidence(commuteBatch, session, PROCESSING_AT);
  }

  const categories = await pool.query<{ id: string; name: string; color: string }>(
    `select id, name, color from categories
     where workspace_id = $1 and lower(name) = 'commute' and coalesce(is_archived, false) = false`,
    [WORKSPACE_ID]
  );
  assert.deepEqual(
    categories.rows,
    [{ id: commuteCategoryId, name: "cOmMuTe", color: "graphite" }],
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
     join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2
       and ri.status = 'open' and ae.event_type = 'commute_detected'
       and array[cs.from_place_id, cs.to_place_id] @> array[$3::uuid, $4::uuid]
     order by ri.created_at, ri.id`,
    [WORKSPACE_ID, USER_ID, homePlace.id, workPlace.id]
  );
  assert(commuteReviews.rows.length >= 3, "Commute review quality fixture needs three Home ↔ Work rows.");
  const otherMoves = await pool.query<{ id: string; categoryId: string | null; categoryKey: string | null; title: string }>(
    `select ri.id, ri.suggested_category_id as "categoryId", c.starter_key as "categoryKey", ri.title
     from review_items ri
     join activity_events ae on ae.id = ri.event_id
     join commute_segments cs on cs.id = ri.location_segment_id
     left join categories c on c.id = ri.suggested_category_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ae.event_type = 'commute_detected'
       and not coalesce(array[cs.from_place_id, cs.to_place_id] @> array[$3::uuid, $4::uuid], false)`,
    [WORKSPACE_ID, USER_ID, homePlace.id, workPlace.id]);
  assert(otherMoves.rows.length > 0, "The fixture has no Move outside Home ↔ Work.");
  assert(otherMoves.rows.every((row) => row.categoryKey === "travel" && row.title !== "Commute"),
    `A Move outside Home ↔ Work suggested Commute: ${JSON.stringify(otherMoves.rows.map((row) => [row.title, row.categoryKey]))}`);
  // Description semantics below hold for every Move.
  const moveReviewIds = [...commuteReviews.rows.map((row) => row.id), ...otherMoves.rows.map((row) => row.id)];
  assert(moveReviewIds.length >= 6, "The fixture needs six Move Review rows.");
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
  for (const commuteBatch of commuteBatches) {
    await ingestLocationEvidence(commuteBatch, session, PROCESSING_AT);
  }
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
  for (const commuteBatch of commuteBatches) {
    await ingestLocationEvidence(commuteBatch, session, PROCESSING_AT);
  }
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
    moveReviewIds[3],
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
    moveReviewIds[4],
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
      moveReviewIds[5],
      { action: "confirm" },
      { ...session, workspaceId: "30000000-0000-4000-8000-000000000099" }
    ),
    /not found/i
  );

  // A replay whose only effect is recreating an archived Commute activity still changes what the app shows.
  await pool.query(
    `update review_items set status = 'ignored', ignored_scope = 'once', resolved_at = now()
     where workspace_id = $1 and user_id = $2 and status = 'open'`,
    [WORKSPACE_ID, USER_ID]
  );
  await pool.query(
    `update activity_events set review_status = 'ignored'
     where workspace_id = $1 and user_id = $2 and source = 'location_learning' and review_status = 'needs_review'`,
    [WORKSPACE_ID, USER_ID]
  );
  await pool.query("update categories set is_archived = true where id = $1", [commuteCategoryId]);
  try {
    const recreate = await ingestAndReplayLocationEvidence(commuteBatches[0], session, PROCESSING_AT);
    const active = await pool.query(
      `select id from categories
       where workspace_id = $1 and lower(name) = 'commute' and coalesce(is_archived, false) = false`,
      [WORKSPACE_ID]
    );
    assert.equal(active.rowCount, 1, "Replay did not recreate the archived Commute activity.");
    assert.equal(recreate.replay.semanticChangeCount, 1, "Recreating the Commute activity was not counted as a change.");
  } finally {
    await pool.query(
      "delete from categories where workspace_id = $1 and lower(name) = 'commute' and id <> $2",
      [WORKSPACE_ID, commuteCategoryId]
    );
    await pool.query("update categories set is_archived = false where id = $1", [commuteCategoryId]);
  }
  } finally {
    await pool.query("update places set role = null where workspace_id = $1 and id in ($2, $3)", [WORKSPACE_ID, homePlace.id, workPlace.id]);
  }
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
  assert.equal(overlapReview.rowCount, 0, "A manual overlap incorrectly blocked a trusted stay.");
  const overlappingStay = await pool.query(
    `select 1 from time_entries where workspace_id = $1 and user_id = $2 and place_id = $3
      and started_at = $4 and stopped_at = $5 and source = 'location_learning'`,
    [WORKSPACE_ID, USER_ID, blocked.placeId, blocked.startedAt, blocked.stoppedAt]
  );
  assert.equal(overlappingStay.rowCount, 1, "Trusted stay was not logged alongside manual time.");
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
      // A Move between two places that are not Home and Work suggests Getting around (PRD D19; "Travel" until 20 Oct 2026).
      categoryName: "getting around",
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
  assert.equal(overlapReview.rows[0].semanticReason, "commute_overlap_exceeded");
  assert.match(overlapReview.rows[0].notes ?? "", /more than five minutes/i);
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

async function validateSupersededReviewReactivation() {
  // A stop 126 m from a logging-disabled place is an unknown visit in Review. A late genuine entry makes it the
  // place (a different segment, so replay retires the proposal); a later exit revokes that proof and the original
  // segment returns, so its proposal must reopen. A user's own ignore is never reopened.
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const placeId = "30000000-0000-4000-8000-0000000000e1";
  const pin = { latitude: 51.61, longitude: -0.21 };
  await pool.query(
    `insert into places (id, workspace_id, name, latitude, longitude, radius_meters, priority, logging_enabled)
     values ($1, $2, 'Edge Home', $3, $4, 100, 0, false)`,
    [placeId, WORKSPACE_ID, pin.latitude, pin.longitude]
  );
  const startMs = Date.parse("2026-07-20T10:00:00.000Z");
  const cutoverAt = "2026-07-20T09:00:00.000Z";
  const reading = (id: string, seconds: number, patch: Partial<LocationEvidence>): LocationEvidence => ({
    clientEvidenceId: `flip-${id}`, deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location", occurredAt: new Date(startMs + seconds * 1_000).toISOString(), endedAt: null,
    latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null,
    receivedAt: PROCESSING_AT, timeZone: "Europe/London", ...patch
  });
  const fix = (id: string, seconds: number, metres: number, speed = 0) => reading(id, seconds, {
    latitude: pin.latitude + metres / 111_195, longitude: pin.longitude, horizontalAccuracyMeters: 5, speedMetersPerSecond: speed
  });
  const callback = (id: string, seconds: number, kind: "geofence_enter" | "geofence_exit") =>
    reading(id, seconds, { kind, savedPlaceId: placeId });
  const ingest = (id: string, evidence: LocationEvidence[]) =>
    ingestLocationEvidence(batch(`db-flip-${id}`, evidence, "v2_review", cutoverAt), session, PROCESSING_AT);
  const stayState = async (clientSegmentId: string) => (await pool.query<{
    status: string; reviewStatus: string | null; scope: string | null; eventStatus: string | null;
  }>(
    `select s.status, ri.status as "reviewStatus", ri.ignored_scope as scope, ae.review_status as "eventStatus"
     from stay_segments s
     left join review_items ri on ri.location_segment_id = s.id and ri.workspace_id = s.workspace_id
     left join activity_events ae on ae.id = ri.event_id
     where s.workspace_id = $1 and s.user_id = $2 and s.client_segment_id = $3`,
    [WORKSPACE_ID, USER_ID, clientSegmentId]
  )).rows[0];
  const currentStays = async () => (await pool.query<{ clientSegmentId: string; placeId: string | null }>(
    `select client_segment_id as "clientSegmentId", place_id as "placeId" from stay_segments
     where workspace_id = $1 and user_id = $2 and status <> 'superseded' and client_segment_id is not null
     order by started_at`,
    [WORKSPACE_ID, USER_ID]
  )).rows;
  try {
    await ingest("parked", [fix("p0", 0, 126), fix("p1", 600, 126), fix("p2", 1_200, 126), fix("l0", 1_300, 600, 10), fix("l1", 1_310, 700, 10)]);
    const [unknown] = await currentStays();
    assert.equal(unknown?.placeId, null, "The edge stop was not an unknown stay.");
    assert.deepEqual(await stayState(unknown.clientSegmentId),
      { status: "finalised", reviewStatus: "open", scope: null, eventStatus: "needs_review" }, "The edge stop was not offered in Review.");

    // Retiring the proposal is the replay's only Review effect (logging is off at this place): it still counts.
    const entered = await ingestAndReplayLocationEvidence(
      batch("db-flip-enter", [callback("enter", 1_100, "geofence_enter")], "v2_review", cutoverAt), session, PROCESSING_AT
    );
    assert.equal(entered.replay.semanticChangeCount, 1, "A retirement-only replay reported no change.");
    const [saved] = await currentStays();
    assert.equal(saved?.placeId, placeId, "A genuine entry did not make the stop the saved place.");
    assert.notEqual(saved.clientSegmentId, unknown.clientSegmentId, "The saved-place stay kept the unknown segment's ID.");
    assert.deepEqual(await stayState(unknown.clientSegmentId),
      { status: "superseded", reviewStatus: "ignored", scope: "superseded", eventStatus: "ignored" }, "Replay did not retire the unknown proposal.");

    const exited = await ingestAndReplayLocationEvidence(
      batch("db-flip-exit", [callback("exit", 1_150, "geofence_exit")], "v2_review", cutoverAt), session, PROCESSING_AT
    );
    assert((exited.replay.semanticChangeCount ?? 0) >= 1, "Reopening a retired proposal reported no change.");
    const [returned] = await currentStays();
    assert.equal(returned?.clientSegmentId, unknown.clientSegmentId, "Revoking the entry did not restore the unknown segment.");
    assert.deepEqual(await stayState(unknown.clientSegmentId),
      { status: "finalised", reviewStatus: "open", scope: null, eventStatus: "needs_review" }, "The restored segment's proposal did not reopen.");

    // Control: the user ignores it; flipping away and back must leave that decision alone.
    const review = await pool.query<{ id: string }>(
      `select ri.id from review_items ri join stay_segments s on s.id = ri.location_segment_id
       where s.workspace_id = $1 and s.user_id = $2 and s.client_segment_id = $3`,
      [WORKSPACE_ID, USER_ID, unknown.clientSegmentId]
    );
    await resolveLocationReviewAction(review.rows[0].id, { action: "ignore_once_location" }, session);
    await ingest("enter-again", [callback("enter-again", 1_170, "geofence_enter")]);
    await ingest("exit-again", [callback("exit-again", 1_180, "geofence_exit")]);
    const decided = await stayState(unknown.clientSegmentId);
    assert.equal(decided.reviewStatus, "ignored", "A user's ignore was reopened.");
    assert.notEqual(decided.scope, "superseded", "A user's ignore was marked as a replay retirement.");
    assert.equal(decided.eventStatus, "ignored", "A user's ignore lost its event status.");

    // A restored segment can come back with a different boundary or eligibility; neither its retired Review nor
    // its retired boundary may act as a user decision. An earlier departure fix moves the stay's end (the midpoint
    // to its departure) without changing its evidence, so it is the same segment.
    const reviewOf = async (clientSegmentId: string) => (await pool.query<{ stoppedAt: Date; reviewStatus: string }>(
      `select s.stopped_at as "stoppedAt", ri.status as "reviewStatus" from stay_segments s
       join review_items ri on ri.location_segment_id = s.id
       where s.workspace_id = $1 and s.user_id = $2 and s.client_segment_id = $3`,
      [WORKSPACE_ID, USER_ID, clientSegmentId])).rows[0];
    await clearDerivedLocationState();
    await ingest("bounds-parked", [fix("q0", 0, 126), fix("q1", 600, 126), fix("q2", 1_200, 126), fix("q3", 1_500, 126),
      fix("m0", 2_100, 600, 10), fix("m1", 2_110, 700, 10), fix("m2", 2_200, 2_000, 10),
      fix("w0", 2_300, 3_000), fix("w1", 2_900, 3_000), fix("w2", 3_500, 3_000)]);
    const [boundsBefore] = await currentStays();
    assert.equal((await reviewOf(boundsBefore.clientSegmentId)).stoppedAt.getTime(), startMs + 1_800_000, "Unexpected first boundary.");
    await ingest("bounds-enter", [callback("bounds-enter", 1_400, "geofence_enter")]);
    await ingest("bounds-exit", [callback("bounds-exit", 1_450, "geofence_exit"), fix("o0", 1_560, 900, 10)]);
    const [restored] = await currentStays();
    assert.equal(restored.clientSegmentId, boundsBefore.clientSegmentId, "The earlier-departing stay did not keep its segment.");
    const restoredReview = await reviewOf(restored.clientSegmentId);
    assert.equal(restoredReview.stoppedAt.getTime(), startMs + 1_530_000, "The restored stay kept its retired boundary.");
    assert.equal(restoredReview.reviewStatus, "open", "The restored, still eligible stay was not offered again.");
    const commute = await pool.query<{ startedAt: Date }>(
      `select started_at as "startedAt" from commute_segments
       where workspace_id = $1 and user_id = $2 and status <> 'superseded' order by started_at limit 1`, [WORKSPACE_ID, USER_ID]);
    assert.equal(commute.rows[0]?.startedAt.getTime(), startMs + 1_530_000,
      "The commute after the restored stay did not start where that stay now ends.");

    await clearDerivedLocationState();
    await ingest("short-parked", [fix("r0", 0, 126), fix("r1", 300, 126), fix("r2", 600, 126), fix("r3", 900, 126),
      fix("n0", 1_560, 600, 10), fix("n1", 1_570, 700, 10)]);
    const [shortBefore] = await currentStays();
    assert.equal((await reviewOf(shortBefore.clientSegmentId)).reviewStatus, "open", "The twenty-minute stop was not offered.");
    await ingest("short-enter", [callback("short-enter", 400, "geofence_enter")]);
    // Back as the same segment, shortened to about 15 minutes. Unknown stays reach Review from 10 minutes
    // (PRD D19; an unknown stay under that is no stay at all), so it is offered again.
    await ingest("short-exit", [callback("short-exit", 450, "geofence_exit"), fix("o1", 960, 900, 10)]);
    const [short] = await currentStays();
    assert.equal(short.clientSegmentId, shortBefore.clientSegmentId, "The shortened stay did not keep its segment.");
    assert.deepEqual(await stayState(short.clientSegmentId),
      { status: "finalised", reviewStatus: "open", scope: null, eventStatus: "needs_review" },
      "A restored stay of 10 minutes or more was not offered again.");
    // A later genuine entry must still make it the saved place: the retired Review is not a decision. The restored
    // unknown segment is gone from current output, so it must not linger as a second current stay.
    await ingest("short-enter-again", [callback("short-enter-again", 850, "geofence_enter")]);
    const afterReplacement = await currentStays();
    assert.equal(afterReplacement.length, 1, "A replay-retired restored stay lingered beside its replacement.");
    assert.equal(afterReplacement[0].placeId, placeId, "A restored stay with a retired Review blocked its saved-place replacement.");

    // A stay shrinking under the 10-minute offer threshold and growing back (Codex r2/r3 on #461): an earlier
    // departure fix moves its end from 607.5 to 597.5 seconds, so it is no longer a stay of its own and its open
    // card is retired as replay's own (never a decision); a repeated replay changes nothing; a later still fix
    // brings it back to 607.5 seconds and it is offered once again. A card the person ignored stays
    // ignored through the same shrink.
    for (const decided of [false, true]) {
      await clearDerivedLocationState();
      const tag = decided ? "decided" : "replay";
      await ingest(`shrink-${tag}`, [fix(`k0-${tag}`, 0, 126), fix(`k1-${tag}`, 300, 126), fix(`k2-${tag}`, 585, 126),
        fix(`j0-${tag}`, 630, 600, 10), fix(`j1-${tag}`, 640, 700, 10)]);
      const [tenMinutes] = await currentStays();
      assert.equal((await reviewOf(tenMinutes.clientSegmentId))?.stoppedAt.getTime(), startMs + 607_500, "Unexpected 10-minute boundary.");
      assert.equal((await stayState(tenMinutes.clientSegmentId)).reviewStatus, "open", "A 10-minute unknown stay was not offered.");
      if (decided) {
        const card = await pool.query<{ id: string }>(
          `select ri.id from review_items ri join stay_segments s on s.id = ri.location_segment_id
           where s.workspace_id = $1 and s.user_id = $2 and s.client_segment_id = $3`, [WORKSPACE_ID, USER_ID, tenMinutes.clientSegmentId]);
        await resolveLocationReviewAction(card.rows[0].id, { action: "ignore_once_location" }, session);
      }
      await ingest(`shrink-${tag}-early`, [fix(`j-early-${tag}`, 610, 900, 10)]);
      const shrunk = tenMinutes;
      const shrunkState = await stayState(shrunk.clientSegmentId);
      if (decided) {
        assert.equal(shrunkState.reviewStatus, "ignored", "A person's Ignore did not survive the stay shrinking.");
        assert.notEqual(shrunkState.scope, "superseded", "A person's Ignore became replay's own retirement.");
        continue;
      }
      assert.deepEqual({ reviewStatus: shrunkState.reviewStatus, scope: shrunkState.scope },
        { reviewStatus: "ignored", scope: "superseded" }, "A stay shrunk under 10 minutes kept its open card, or lost it as a decision.");
      await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
        rolloutMode: "v2_review", semanticModeAcknowledgedAt: cutoverAt }, session, PROCESSING_AT);
      assert.deepEqual(await stayState(shrunk.clientSegmentId), shrunkState, "A repeated replay changed the shrunk stay's retired card.");
      await ingest(`shrink-${tag}-still`, [fix(`k3-${tag}`, 605, 126)]);
      const grown = await currentStays();
      assert.equal(grown.length, 1, "The stay growing back is not one stay.");
      assert.equal((await stayState(grown[0].clientSegmentId)).reviewStatus, "open", "A stay back over 10 minutes was not offered.");
      if (grown[0].clientSegmentId !== tenMinutes.clientSegmentId) {
        // Its evidence changed, so it returns as a new segment: the old card stays replay's own retirement.
        assert.deepEqual(await stayState(tenMinutes.clientSegmentId), shrunkState, "The shrunk stay's retired card changed.");
      }
    }

    // An Ignore the user queued offline can arrive after replay retired the proposal. It is acknowledged and
    // recorded as the user's decision, so the proposal stays ignored when its segment returns.
    await clearDerivedLocationState();
    await ingest("queued-parked", [fix("u0", 0, 126), fix("u1", 600, 126), fix("u2", 1_200, 126),
      fix("v0", 1_300, 600, 10), fix("v1", 1_310, 700, 10)]);
    const [queued] = await currentStays();
    const queuedReview = await pool.query<{ id: string }>(
      `select ri.id from review_items ri join stay_segments s on s.id = ri.location_segment_id
       where s.workspace_id = $1 and s.user_id = $2 and s.client_segment_id = $3`, [WORKSPACE_ID, USER_ID, queued.clientSegmentId]);
    await ingest("queued-enter", [callback("queued-enter", 1_100, "geofence_enter")]);
    assert.equal((await stayState(queued.clientSegmentId)).scope, "superseded", "Replay did not retire the queued proposal.");
    const acknowledged = await resolveLocationReviewAction(queuedReview.rows[0].id, { action: "ignore_once_location" }, session);
    assert.equal(acknowledged.ok, true, "A queued Ignore of a retired proposal was not acknowledged.");
    await ingest("queued-exit", [callback("queued-exit", 1_150, "geofence_exit")]);
    const queuedAfter = await stayState(queued.clientSegmentId);
    assert.equal(queuedAfter.reviewStatus, "ignored", "A queued Ignore was reopened when its segment returned.");
    assert.equal(queuedAfter.scope, "once", "A queued Ignore was not recorded as the user's decision.");
    assert.equal(queuedAfter.eventStatus, "ignored", "A queued Ignore lost its event status.");
  } finally {
    await clearDerivedLocationState();
    await pool.query("delete from places where id = $1 and workspace_id = $2", [placeId, WORKSPACE_ID]);
  }
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

async function validateMotionActivityEvidence() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_shadow";
  const evidence = locationAcceptanceFixture().evidence;
  // Driving from the fixture's last Home reading to its short stop.
  const motion = (time: string, activity: "stationary" | "walking" | "automotive"): LocationEvidence => ({
    clientEvidenceId: `motion-${Date.parse(`2026-07-20T${time}.000Z`)}-${activity}-high`, deviceId: DEVICE_ID,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, kind: "motion_activity",
    occurredAt: `2026-07-20T${time}.000Z`, endedAt: null, latitude: null, longitude: null,
    receivedAt: "2026-07-20T19:00:00.000Z", timeZone: "Europe/London",
    metadata: { motionActivity: activity, motionConfidence: "high" }
  });
  const motionEvidence = [motion("10:30:00", "stationary"), motion("10:39:20", "walking"), motion("10:39:40", "automotive"),
    motion("11:10:00", "stationary")];
  await ingestLocationEvidence(batch("db-motion-activity", [...evidence, ...motionEvidence], "v2_shadow"), session);
  const stored = await pool.query<{ accepted: boolean; coordinate: string | null; activity: string; confidence: string }>(
    `select accepted, coordinate::text as coordinate, metadata->>'motionActivity' as activity, metadata->>'motionConfidence' as confidence
     from location_evidence where workspace_id = $1 and user_id = $2 and evidence_type = 'motion_activity'
     order by occurred_at`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.deepEqual(stored.rows.map((row) => [row.accepted, row.coordinate, row.activity, row.confidence]),
    motionEvidence.map((item) => [true, null, item.metadata!.motionActivity, "high"]),
    "Motion activity was not stored as accepted, coordinate-free evidence with its classification.");
  const linked = await pool.query<{ count: number }>(
    `select count(*)::integer as count from location_segment_evidence lse
     join location_evidence le on le.id = lse.evidence_id
     where le.workspace_id = $1 and le.user_id = $2 and le.evidence_type = 'motion_activity'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(linked.rows[0].count, 0, "Motion activity became segment lineage.");
  const modes = await pool.query<{ travelMode: string | null }>(
    `select metadata->>'travelMode' as "travelMode" from commute_segments
     where workspace_id = $1 and user_id = $2 and status <> 'superseded' and metadata ? 'travelMode'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.deepEqual(modes.rows, [{ travelMode: "automotive" }], "The driven commute did not persist its travel mode.");
  const refinedStays = await pool.query<{ count: number }>(
    `select count(*)::integer as count from stay_segments
     where workspace_id = $1 and user_id = $2 and status <> 'superseded' and metadata ? 'locationOnlyStoppedAt'`,
    [WORKSPACE_ID, USER_ID]);
  assert.equal(refinedStays.rows[0].count, 1, "A motion-refined stay did not persist its location-only end.");
  const summary = await pool.query<{ motionCount: number }>(
    `select (raw_payload->'evidenceKinds'->>'motion_activity')::integer as "motionCount" from activity_events
     where workspace_id = $1 and user_id = $2 and client_event_id like 'location-batch:%db-motion-activity'`,
    [WORKSPACE_ID, USER_ID]
  );
  assert.equal(summary.rows[0]?.motionCount, motionEvidence.length, "The coordinate-free batch summary did not count motion activity.");
  await assert.rejects(pool.query(
    `insert into location_evidence (workspace_id, user_id, device_id, client_evidence_id, client_batch_id, evidence_type,
       occurred_at, coordinate, algorithm_version, time_zone, expires_at)
     values ($1, $2, $3, 'motion-with-position', 'db-motion-position', 'motion_activity', now(),
       ST_GeogFromText('SRID=4326;POINT(0 0)'), $4, 'Europe/London', now() + interval '1 day')`,
    [WORKSPACE_ID, USER_ID, DEVICE_ID, LOCATION_ENGINE_V2_CONFIG.algorithmVersion]
  ), /location_evidence_motion_coordinate_free/, "A positioned motion row was accepted.");
}

async function validateMotionOnlyReviewRetirement() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  const point = (id: string, time: string, eastMetres: number): LocationEvidence => ({
    clientEvidenceId: id, deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location", occurredAt: `2026-07-20T${time}.000Z`, receivedAt: "2026-07-20T12:00:00.000Z",
    timeZone: "Europe/London", latitude: home.latitude,
    longitude: home.longitude + eastMetres / (111_320 * Math.cos(home.latitude * Math.PI / 180)),
    horizontalAccuracyMeters: 10, speedMetersPerSecond: 0
  });
  const motion = (time: string, activity: "stationary" | "walking" | "automotive"): LocationEvidence => ({
    clientEvidenceId: `motion-only-${time}-${activity}`, deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "motion_activity", occurredAt: `2026-07-20T${time}.000Z`, receivedAt: "2026-07-20T12:00:00.000Z",
    timeZone: "Europe/London", metadata: { motionActivity: activity, motionConfidence: "high" }
  });
  // Home, then nothing until a stop 2 km east: GPS never saw the drive.
  const location = [
    ...["08:00:00", "08:15:00", "08:30:00", "08:45:00", "09:00:00"].map((time, index) => point(`motion-only-home-${index}`, time, 0)),
    ...["09:30:00", "09:35:00", "09:40:00", "09:45:00", "09:50:00", "09:55:00"].map((time, index) => point(`motion-only-shop-${index}`, time, 2_000)),
    ...["10:20:00", "10:35:00", "10:50:00", "11:05:00"].map((time, index) => point(`motion-only-home-pm-${index}`, time, 0))
  ];
  const acknowledged = "2026-06-01T07:00:00.000Z";
  await ingestLocationEvidence(batch("db-motion-only-a", [...location, motion("08:00:00", "stationary"),
    motion("09:10:00", "walking"), motion("09:11:00", "automotive"), motion("09:17:00", "walking"), motion("09:18:00", "stationary")],
    "v2_review", acknowledged), session);
  const proposals = () => pool.query<{ status: string; ignoredScope: string | null }>(
    `select ri.status, ri.ignored_scope as "ignoredScope" from review_items ri
     join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and cs.metadata ? 'motionSupported'`,
    [WORKSPACE_ID, USER_ID]);
  assert.deepEqual((await proposals()).rows, [{ status: "open", ignoredScope: null }], "A drive only motion showed did not reach Review.");
  // Later history shows two separate movements: a stop may lie between them, so the journey is withdrawn.
  await ingestLocationEvidence(batch("db-motion-only-b", [motion("09:13:00", "stationary"), motion("09:16:00", "automotive")],
    "v2_review", acknowledged), session);
  assert.deepEqual((await proposals()).rows, [{ status: "ignored", ignoredScope: "superseded" }],
    "An obsolete motion-only proposal stayed open without lineage.");

  // A decision about a motion-only journey survives a change of its endpoint
  // stays' IDs (here a late origin Visit): it has no lineage, so its interval
  // protects it and no duplicate proposal appears.
  await clearDerivedLocationState();
  await ingestLocationEvidence(batch("db-motion-only-decided", [...location, motion("08:00:00", "stationary"),
    motion("09:10:00", "walking"), motion("09:11:00", "automotive"), motion("09:17:00", "walking"), motion("09:18:00", "stationary")],
    "v2_review", acknowledged), session);
  const open = await pool.query<{ id: string }>(
    `select ri.id from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and cs.metadata ? 'motionSupported'`,
    [WORKSPACE_ID, USER_ID]);
  assert.equal(open.rows.length, 1, "The motion-only drive was not proposed.");
  await resolveLocationReviewAction(open.rows[0].id, { action: "ignore_once_location" }, session);
  const lateVisit: LocationEvidence = { ...point("motion-only-late-visit", "07:58:00", 0), kind: "visit",
    endedAt: "2026-07-20T09:00:00.000Z", horizontalAccuracyMeters: 20, speedMetersPerSecond: null };
  // A late route fix now qualifies the replacement on location evidence alone; the decision still holds.
  const lateRoute: LocationEvidence = { ...point("motion-only-late-route", "09:14:00", 1_000), speedMetersPerSecond: 12, horizontalAccuracyMeters: 5 };
  await ingestLocationEvidence(batch("db-motion-only-late-visit", [lateVisit, lateRoute], "v2_review", acknowledged), session);
  const after = await pool.query<{ status: string }>(
    `select ri.status from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and cs.metadata ? 'motionSupported' order by ri.created_at`,
    [WORKSPACE_ID, USER_ID]);
  assert.deepEqual(after.rows.map((row) => row.status), ["ignored"], "A decided motion-only journey was proposed again under a new ID.");
  const reproposed = await pool.query<{ count: number }>(
    `select count(*)::integer as count from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
       and cs.started_at < '2026-07-20T09:20:00Z' and cs.stopped_at > '2026-07-20T09:10:00Z'`,
    [WORKSPACE_ID, USER_ID]);
  assert.equal(reproposed.rows[0].count, 0, "A location-qualified replacement re-proposed a decided motion-only journey.");

  // The same holds for a journey location evidence qualified (a route fix) and
  // motion only timed: its decision survives an endpoint ID change.
  await clearDerivedLocationState();
  // Motion ends the drive at 09:14, the time of its only route fix, so that fix is not interior lineage.
  await ingestLocationEvidence(batch("db-motion-timed", [...location, lateRoute, motion("08:00:00", "stationary"),
    motion("09:10:00", "walking"), motion("09:11:00", "automotive"), motion("09:14:00", "stationary")],
    "v2_review", acknowledged), session);
  const timed = await pool.query<{ id: string }>(
    `select ri.id from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and cs.metadata ? 'motionTimed'
       and not cs.metadata ? 'motionSupported'`,
    [WORKSPACE_ID, USER_ID]);
  assert.equal(timed.rows.length, 1, "A location-qualified, motion-timed drive was not proposed.");
  await resolveLocationReviewAction(timed.rows[0].id, { action: "ignore_once_location" }, session);
  await ingestLocationEvidence(batch("db-motion-timed-late-visit", [{ ...lateVisit, clientEvidenceId: "motion-timed-late-visit" }],
    "v2_review", acknowledged), session);
  const timedAfter = await pool.query<{ count: number }>(
    `select count(*)::integer as count from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
       and cs.started_at < '2026-07-20T09:20:00Z' and cs.stopped_at > '2026-07-20T09:10:00Z'`,
    [WORKSPACE_ID, USER_ID]);
  assert.equal(timedAfter.rows[0].count, 0, "A decided motion-timed journey was proposed again under a new ID.");

  // In v2_enabled the individual emitter carries the same motion fields and still needs Review.
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_enabled";
  await ingestLocationEvidence(batch("db-motion-only-enabled", [...location, motion("08:00:00", "stationary"),
    motion("09:10:00", "walking"), motion("09:11:00", "automotive"), motion("09:17:00", "walking"), motion("09:18:00", "stationary")],
    "v2_enabled", acknowledged), session);
  const enabled = await pool.query<{ reviewStatus: string; travelMode: string | null; motionSupported: boolean | null }>(
    `select review_status as "reviewStatus", raw_payload->>'travelMode' as "travelMode",
            (raw_payload->>'motionSupported')::boolean as "motionSupported"
     from activity_events where workspace_id = $1 and user_id = $2 and event_type = 'commute_detected'
       and occurred_at < '2026-07-20T09:30:00Z'`,
    [WORKSPACE_ID, USER_ID]);
  assert.deepEqual(enabled.rows, [{ reviewStatus: "needs_review", travelMode: "automotive", motionSupported: true }],
    "An enabled-mode motion-only drive lost its motion fields or was logged automatically.");
}

function timeAwayEvidence() {
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  const point = (id: string, time: string, eastMetres: number, speed = 0): LocationEvidence => ({
    clientEvidenceId: id, deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: "standard_location", occurredAt: `2026-07-20T${time}.000Z`, receivedAt: "2026-07-20T12:00:00.000Z",
    timeZone: "Europe/London", latitude: home.latitude,
    longitude: home.longitude + eastMetres / (111_320 * Math.cos(home.latitude * Math.PI / 180)),
    horizontalAccuracyMeters: 5, speedMetersPerSecond: speed
  });
  // Home, a quick drive 300 m to a shop and back, Home again: no journey qualifies.
  const evidence = [
    ...["08:00:00", "08:15:00", "08:30:00", "08:45:00", "09:00:00"].map((time, index) => point(`away-home-${index}`, time, 0)),
    point("away-out-0", "09:00:20", 150, 10), point("away-out-1", "09:00:30", 230, 10), point("away-shop", "09:01:00", 300),
    point("away-back-0", "09:07:30", 230, 10), point("away-back-1", "09:07:40", 150, 10),
    ...["09:08:00", "09:20:00", "09:35:00", "09:50:00"].map((time, index) => point(`away-home-pm-${index}`, time, 0))
  ];
  return evidence;
}

async function validateTimeAwayReview() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  await ingestLocationEvidence(batch("db-time-away", timeAwayEvidence(), "v2_review", "2026-06-01T07:00:00.000Z"), session);
  const reviews = await pool.query<{ id: string; title: string; suggestedCategoryId: string | null; reason: string | null; route: string | null }>(
    `select ri.id, ri.title, ri.suggested_category_id as "suggestedCategoryId", ae.raw_payload->>'qualificationReason' as reason,
            ae.raw_payload->>'routeLabel' as route
     from review_items ri join activity_events ae on ae.id = ri.event_id
     join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'`,
    [WORKSPACE_ID, USER_ID]);
  // PRD D19: time away is a round-trip Move named from its place; its activity is Travel.
  const travel = await pool.query<{ id: string }>(
    "select id from categories where workspace_id = $1 and starter_key = 'travel'", [WORKSPACE_ID]);
  assert.equal(travel.rowCount, 1, "Offering a Move did not create the Travel activity.");
  assert.deepEqual(reviews.rows.map(({ title, suggestedCategoryId, reason, route }) => ({ title, suggestedCategoryId, reason, route })),
    [{ title: "Trip", suggestedCategoryId: travel.rows[0].id, reason: "same_place_outing", route: `Round trip from ${home.name}` }],
    "A short drive to a shop and back was not offered as a round trip from Home.");
  await resolveLocationReviewAction(reviews.rows[0].id, { action: "confirm" }, session);
  const entry = await pool.query<{ categoryId: string | null; description: string | null }>(
    `select category_id as "categoryId", description from time_entries where workspace_id = $1 and user_id = $2`,
    [WORKSPACE_ID, USER_ID]);
  assert.deepEqual(entry.rows, [{ categoryId: travel.rows[0].id, description: null }],
    "Confirmed time away did not become a Travel block without a generated description.");
}

/**
 * Location v3 bug 6: a place with a same-place journey (time away, a round trip) could not be
 * deleted. ON DELETE SET NULL clears one end per update and the commute owner trigger rejected the
 * row whose other end still named the place, so the delete rolled back. deletePlace clears both
 * ends first; history keeps its times and loses the link.
 */
async function validatePlaceDeleteWithSamePlaceJourneys() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const home = LOCATION_ACCEPTANCE_PLACES[0];
  const homeRow = await pool.query("select * from places where id = $1 and workspace_id = $2", [home.id, WORKSPACE_ID]);
  assert.equal(homeRow.rowCount, 1, "The delete fixture's place is missing.");
  try {
    await ingestLocationEvidence(batch("db-place-delete", timeAwayEvidence(), "v2_review", "2026-06-01T07:00:00.000Z"), session);
    const [card] = (await pool.query<{ id: string }>(
      `select ri.id from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
       where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'`, [WORKSPACE_ID, USER_ID])).rows;
    assert(card, "The delete fixture produced no time-away card.");
    await resolveLocationReviewAction(card.id, { action: "confirm" }, session);
    const journeys = async () => (await pool.query<{ id: string; fromPlaceId: string | null; toPlaceId: string | null }>(
      `select id, from_place_id as "fromPlaceId", to_place_id as "toPlaceId" from commute_segments
       where workspace_id = $1 and user_id = $2 order by id`, [WORKSPACE_ID, USER_ID])).rows;
    const before = await journeys();
    assert(before.some((row) => row.fromPlaceId === home.id && row.toPlaceId === home.id),
      "The delete fixture has no journey with the place at both ends.");
    const staysAtPlace = Number((await pool.query<{ count: string }>(
      "select count(*) from stay_segments where workspace_id = $1 and user_id = $2 and place_id = $3",
      [WORKSPACE_ID, USER_ID, home.id])).rows[0].count);
    assert(staysAtPlace > 0, "The delete fixture has no stays at the place.");
    const entriesBefore = await count("time_entries");

    // The root cause, kept visible: a plain delete is refused by the commute owner trigger.
    await assert.rejects(
      pool.query("delete from places where id = $1 and workspace_id = $2", [home.id, WORKSPACE_ID]),
      /Commute (origin|destination) place must belong to its workspace/,
      "A plain delete of a place with a same-place journey no longer hits the commute trigger; revisit deletePlace."
    );

    const otherWorkspace = { ...session, workspaceId: "30000000-0000-4000-8000-0000000000ff" };
    assert.equal(await deletePlace(home.id, otherWorkspace), null, "Another workspace deleted this place.");
    assert.deepEqual(await journeys(), before, "A refused cross-workspace delete changed journeys.");

    // Two sessions (Codex r1 on #449): a replay holds the owner lock and a stay at the place, then
    // locks a journey there. A delete that cleared journeys before stays without the owner lock
    // deadlocked with it; now it waits for the replay and then succeeds.
    const replay = await pool.connect();
    let deleting: Promise<{ id: string } | null> | null = null;
    try {
      await replay.query("begin");
      await replay.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [WORKSPACE_ID, USER_ID]);
      await replay.query("select id from stay_segments where workspace_id = $1 and user_id = $2 and place_id = $3 for update",
        [WORKSPACE_ID, USER_ID, home.id]);
      // A delete that cannot get the lock within its timeout changes nothing and says so.
      await assert.rejects(deletePlace(home.id, session, { lockTimeoutMs: 300 }), PlaceDeleteBusyError,
        "A delete waiting past its lock timeout was not reported as busy.");
      let settled = false;
      deleting = deletePlace(home.id, session, { lockTimeoutMs: 20_000 });
      deleting.then(() => { settled = true; }, () => { settled = true; });
      // Longer than Postgres's default one-second deadlock_timeout.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      assert.equal(settled, false, "A place delete did not wait for a running replay's owner lock.");
      // It waits on the owner advisory lock (Codex r2 on #449), not on a row, and has locked no journey yet.
      const waiting = await replay.query<{ count: number }>(
        `select count(*)::integer as count from pg_locks
         where locktype = 'advisory' and not granted and pid <> pg_backend_pid()`);
      assert.equal(waiting.rows[0].count, 1, "A place delete was not waiting on the location owner lock.");
      const journeyLocks = await pool.query(
        `select id from commute_segments where workspace_id = $1 and user_id = $2
           and (from_place_id = $3 or to_place_id = $3) for update skip locked`, [WORKSPACE_ID, USER_ID, home.id]);
      assert.equal(journeyLocks.rowCount, before.filter((row) => row.fromPlaceId === home.id || row.toPlaceId === home.id).length,
        "A place delete locked journeys before it held the location owner lock.");
      await replay.query(
        `select id from commute_segments where workspace_id = $1 and user_id = $2
           and (from_place_id = $3 or to_place_id = $3) order by id for update`, [WORKSPACE_ID, USER_ID, home.id]);
      await replay.query("commit");
    } catch (error) {
      await replay.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      replay.release();
    }
    assert.deepEqual(await deleting, { id: home.id }, "A place with a same-place journey was not deleted after a replay.");
    assert.equal((await pool.query("select 1 from places where id = $1", [home.id])).rowCount, 0, "The place survived its delete.");
    const after = await journeys();
    assert.deepEqual(after.map((row) => row.id), before.map((row) => row.id), "Deleting a place removed journeys.");
    assert(after.every((row) => row.fromPlaceId !== home.id && row.toPlaceId !== home.id), "A journey still names the deleted place.");
    assert.equal(Number((await pool.query<{ count: string }>(
      "select count(*) from stay_segments where workspace_id = $1 and user_id = $2 and place_id is null",
      [WORKSPACE_ID, USER_ID])).rows[0].count) >= staysAtPlace, true, "Stays at the deleted place were not kept unlinked.");
    assert.equal(await count("time_entries"), entriesBefore, "Deleting a place removed blocks.");
    assert.equal(await deletePlace(home.id, session), null, "Deleting an already deleted place did not answer not found.");
  } finally {
    await clearDerivedLocationState();
    if ((await pool.query("select 1 from places where id = $1", [home.id])).rowCount === 0) {
      const row = homeRow.rows[0] as Record<string, unknown>;
      const columns = Object.keys(row);
      assert(columns.every((column) => /^[a-z_]+$/.test(column)));
      await pool.query(
        `insert into places (${columns.join(", ")}) values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
        columns.map((column) => row[column])
      );
    }
  }
}

/**
 * "Save this place" (PRD D19, design §7): saving an unsaved Stay's spot creates the place where the
 * Stay was, with its size, activity and switches, applies it to the card without logging it, and
 * re-matches the other open unsaved Stays inside the circle from the last seven days; it is durable
 * (the receipt replays), refuses a visit that already has a place, and a decided card stays decided.
 */
/**
 * One card per outing (PRD D19): an unknown Stay's card and the Move cards either side of it share an
 * outing key, are logged (or skipped) together atomically and idempotently, and a member decided on its
 * own makes the outing a conflict that changes nothing.
 */
/**
 * The count of cards and the outing map on a large backlog (Codex r1 on #475): 20,000 events of
 * history, 1,800 open cards and 90 outings of a Stay and two Moves, inside a transaction rolled back.
 * Each read is right and stays within its budget.
 */
async function validateOutingCountPlans() {
  const client = await pool.connect();
  const cardSql = `select count(*)::int as n from review_items ri
    left join activity_events ae on ae.id = ri.event_id and ae.workspace_id = ri.workspace_id and ae.user_id = ri.user_id
    where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and not ${foldedOutingMemberSql("ri", "ae")}`;
  try {
    await client.query("begin");
    const baseline = (await client.query<{ n: number }>(cardSql, [WORKSPACE_ID, USER_ID])).rows[0].n;
    const baselineStays = (await client.query(OUTING_STAYS_SQL, [WORKSPACE_ID, USER_ID])).rows.length;
    await client.query(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       select $1, $2, 'location_learning', 'unknown_stay', now() - make_interval(mins => n), 'low', jsonb_build_object('n', n)
       from generate_series(1, 20000) n`, [WORKSPACE_ID, USER_ID]);
    await client.query(
      `with plain as (
         insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
         select $1, $2, 'location_learning', 'unknown_stay', now() - make_interval(hours => n), 'low', '{}'::jsonb
         from generate_series(1, 1800) n returning id
       )
       insert into review_items (workspace_id, user_id, event_id, type, title, status)
       select $1, $2, id, 'location', 'Synthetic', 'open' from plain`, [WORKSPACE_ID, USER_ID]);
    await client.query(
      `with parts as (
         select n, role from generate_series(1, 90) n cross join unnest(array['stay', 'in', 'out']) role
       ), events as (
         insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
         select $1, $2, 'location_learning', case when role = 'stay' then 'unknown_stay' else 'commute_detected' end,
                now() - make_interval(days => n), 'low',
                jsonb_build_object('outingKey', 'outing:synthetic-' || n, 'outingRole', role)
         from parts returning id
       )
       insert into review_items (workspace_id, user_id, event_id, type, title, status)
       select $1, $2, id, 'location', 'Synthetic outing', 'open' from events`, [WORKSPACE_ID, USER_ID]);
    await client.query("analyze activity_events");
    await client.query("analyze review_items");
    const timed = async (label: string, sql: string, params: unknown[]) => {
      const plan = (await client.query<{ "QUERY PLAN": Array<{ "Execution Time": number }> }>(
        `explain (analyze, buffers, format json) ${sql}`, params)).rows[0]["QUERY PLAN"][0];
      const rows = (await client.query(sql, params)).rows;
      assert(plan["Execution Time"] < 250, `${label} took ${plan["Execution Time"]} ms on a large backlog.`);
      return rows;
    };
    const cards = await timed("The count of cards", cardSql, [WORKSPACE_ID, USER_ID]);
    assert.equal(cards[0].n - baseline, 1800 + 90, "The count of cards did not count each outing once on a large backlog.");
    const stays = await timed("The outing map", OUTING_STAYS_SQL, [WORKSPACE_ID, USER_ID]);
    assert.equal(stays.length - baselineStays, 180, "The outing map missed Moves on a large backlog.");
    console.log("Outing count plans validated", { cards: cards[0].n, mapped: stays.length });
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

async function validateOutingCards() {
  // The sparse 12-minute outing (two fast fixes each way, PR 11): a saved home, an unknown visit and a
  // low-confidence Move either side, on three recent days.
  const fixture = physicalStopFixture({ ...PHYSICAL_STOP_PICKUP,
    visit: [670_000, 1_390_000], slowAt: [860_000, 1_000_000, 1_200_000], departAt: 1_394_000, returnAt: 1_478_000 });
  const evidence = fixture.evidence.filter((item) => item.clientEvidenceId !== "out-2" && item.clientEvidenceId !== "back-2");
  const home = fixture.savedPlaces[0];
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  await pool.query(
    `insert into places (id, workspace_id, name, latitude, longitude, radius_meters, priority, logging_enabled)
     values ($1, $2, 'Synthetic home', $3, $4, $5, 10, true)`,
    [home.id, WORKSPACE_ID, home.latitude, home.longitude, home.radiusMeters]);
  try {
    await clearDerivedLocationState();
    const base = Date.parse(evidence[0].occurredAt);
    const today = new Date(); today.setUTCHours(8, 0, 0, 0);
    const shift = (iso: string, daysBack: number) => new Date(Date.parse(iso) - base + today.getTime() - daysBack * 86_400_000).toISOString();
    const shifted = [1, 2, 3].flatMap((daysBack) => evidence.map((item) => ({ ...item, deviceId: DEVICE_ID, timeZone: "Europe/London",
      clientEvidenceId: `${item.clientEvidenceId}-o${daysBack}`, occurredAt: shift(item.occurredAt, daysBack),
      ...(item.endedAt ? { endedAt: shift(item.endedAt, daysBack) } : {}), receivedAt: shift(item.occurredAt, daysBack) })))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    for (let offset = 0; offset < shifted.length; offset += 100) {
      await ingestLocationEvidence(batch(`db-outing-${offset}`, shifted.slice(offset, offset + 100), "v2_review", shifted[0].occurredAt),
        session, new Date().toISOString());
    }
    const outings = async () => {
      const rows = (await pool.query<{ id: string; status: string; key: string; role: string }>(
        `select ri.id, ri.status, ae.raw_payload ->> 'outingKey' as key, ae.raw_payload ->> 'outingRole' as role
         from review_items ri join activity_events ae on ae.id = ri.event_id
         where ri.workspace_id = $1 and ri.user_id = $2 and ae.raw_payload ? 'outingKey'
         order by ri.suggested_started_at, ri.id`, [WORKSPACE_ID, USER_ID])).rows;
      const byKey = new Map<string, typeof rows>();
      for (const row of rows) byKey.set(row.key, [...byKey.get(row.key) ?? [], row]);
      return [...byKey.values()].filter((group) => group.some((row) => row.role === "stay") && group.length > 1 &&
        group.every((row) => row.status === "open"));
    };
    const groups = await outings();
    assert(groups.length >= 3, `Expected an outing card group per day, found ${groups.length}.`);
    const parts = (group: Awaited<ReturnType<typeof outings>>[number]) => ({
      anchor: group.find((row) => row.role === "stay")!.id, members: group.filter((row) => row.role !== "stay").map((row) => row.id)
    });

    // One count per outing (PR 12c): every count of cards leaves out each open outing's Moves, while the
    // plain counts older iPhones read stay every open suggestion.
    const counts = async () => {
      const reader = { ...session, authMode: "dev" as const };
      const presentation = async (outingCount: boolean) => (await getReviewPresentation(reader,
        { version: 1, mode: "backlog", timeZone: "Etc/UTC", limit: 1 }, {}, { outingCount })).outstanding.globalCount;
      // The base schema profile predates columns bootstrap reads elsewhere: it checks the other counts.
      const stats = await getBootstrapData(reader).then((data) => data.stats, (error: unknown) => {
        if (error instanceof MissingRequiredColumnError) return null;
        throw error;
      });
      const presented = await getReviewPresentation(reader, { version: 1, mode: "backlog", timeZone: "Etc/UTC", limit: 1 }, {}, { outingCount: true });
      return { plain: await openReviewCountFor(reader), cards: await openReviewCountFor(reader, { cards: true }),
        presentationPlain: await presentation(false), presentationCards: await presentation(true),
        bootstrapPlain: stats?.reviewCount ?? null, bootstrapCards: stats?.reviewCardCount ?? null,
        bootstrapStays: stats ? stats.reviewOutingStays : null, presentationStays: presented.outstanding.outingStays };
    };
    const foldedMembers = groups.reduce((sum, group) => sum + group.filter((row) => row.role !== "stay").length, 0);
    const before = await counts();
    assert(before.plain !== undefined && before.cards !== undefined, "The Review counts were not read.");
    assert.equal(before.plain - before.cards, foldedMembers, "The count of cards did not count each outing once.");
    const withBootstrap = before.bootstrapPlain !== null;
    assert.deepEqual([before.presentationPlain, withBootstrap ? before.bootstrapPlain : before.plain], [before.plain, before.plain], "A plain Review count changed.");
    assert.deepEqual([before.presentationCards, withBootstrap ? before.bootstrapCards : before.cards], [before.cards, before.cards], "The counts of cards disagree.");
    // The outing map names each open outing's Moves with their Stay, alike in bootstrap and presentation.
    const expectedStays = Object.fromEntries(groups.flatMap((group) => {
      const stay = group.find((row) => row.role === "stay")!.id;
      return group.filter((row) => row.role !== "stay").map((row) => [row.id, stay]);
    }));
    if (withBootstrap) assert.deepEqual(before.bootstrapStays, expectedStays, "Bootstrap's outing map is wrong.");
    assert.deepEqual(before.presentationStays, expectedStays, "The presentation's outing map is wrong.");

    // Log it: every member accepted with its own block, in one go; a retry replays the receipt.
    const logged = parts(groups[0]);
    const envelope = { clientMutationId: "18800000-0000-4000-8000-000000000001",
      mutation: { action: "confirm_outing" as const, memberReviewItemIds: logged.members } };
    const result = await resolveIdempotentReviewMutation(logged.anchor, envelope, session) as { status: string; entryIds: string[]; reviewItemIds: string[] };
    assert.equal(result.status, "accepted", "Logging an outing did not accept it.");
    assert.equal(result.entryIds.length, logged.members.length + 1, "Logging an outing did not log every member.");
    const statuses = (await pool.query<{ status: string }>("select status from review_items where id = any($1::uuid[])",
      [[logged.anchor, ...logged.members]])).rows.map((row) => row.status);
    assert(statuses.every((status) => status === "accepted"), "An outing member stayed open after Log it.");
    assert.equal(Number((await pool.query("select count(*) from time_entries where id = any($1::uuid[])", [result.entryIds])).rows[0].count),
      result.entryIds.length, "An outing member's block is missing.");
    assert.deepEqual(await resolveIdempotentReviewMutation(logged.anchor, envelope, session), result, "A retried outing did not replay its receipt.");
    const afterLog = await counts();
    assert.equal(before.cards! - afterLog.cards!, 1, "Logging an outing did not take one card off the count.");
    assert.equal(before.plain! - afterLog.plain!, logged.members.length + 1, "Logging an outing did not take its suggestions off the plain count.");
    // Without its receipt (another device's identical decision): each member is proved logged as asked,
    // and a Skip of the logged outing is a conflict (Codex r1 on #466).
    const again = await resolveIdempotentReviewMutation(logged.anchor, { clientMutationId: "18800000-0000-4000-8000-000000000011",
      mutation: { action: "confirm_outing", memberReviewItemIds: logged.members } }, session) as { alreadyResolved?: boolean };
    assert.equal(again.alreadyResolved, true, "An identical decided outing was not acknowledged as already resolved.");
    await assert.rejects(resolveIdempotentReviewMutation(logged.anchor, { clientMutationId: "18800000-0000-4000-8000-000000000012",
      mutation: { action: "ignore_outing", memberReviewItemIds: logged.members } }, session), /resolved differently|changed/,
      "Skipping a logged outing was acknowledged.");

    // Skip: every member ignored.
    const skipped = parts(groups[1]);
    const ignored = await resolveIdempotentReviewMutation(skipped.anchor, { clientMutationId: "18800000-0000-4000-8000-000000000002",
      mutation: { action: "ignore_outing", memberReviewItemIds: skipped.members } }, session) as { status: string };
    assert.equal(ignored.status, "ignored", "Skipping an outing did not ignore it.");
    assert((await pool.query<{ status: string }>("select status from review_items where id = any($1::uuid[])",
      [[skipped.anchor, ...skipped.members]])).rows.every((row) => row.status === "ignored"), "An outing member stayed open after Skip.");
    // Receiptless reconciliation of the same Skip expects every member ignored (Codex r1 on #466).
    const reconciled = await reconcileReviewMutations({ mutations: [{ clientMutationId: "18800000-0000-4000-8000-000000000013",
      reviewItemId: skipped.anchor, mutation: { action: "ignore_outing", memberReviewItemIds: skipped.members } }] }, session);
    assert.notEqual(reconciled.results[0].state, "conflict", "Reconciling a skipped outing called it a different decision.");

    // A member decided on its own: the outing is a conflict and nothing else changes.
    const changed = parts(groups[2]);
    await resolveLocationReviewAction(changed.members[0], { action: "ignore_once_location" }, session);
    await assert.rejects(resolveIdempotentReviewMutation(changed.anchor, { clientMutationId: "18800000-0000-4000-8000-000000000003",
      mutation: { action: "confirm_outing", memberReviewItemIds: changed.members } }, session), (error: unknown) => {
      // The answer says which cards are still open, so clients bring back only those (Codex r2 on #466).
      const statuses = (error as { details?: { canonicalReviewStatuses?: Record<string, string> } }).details?.canonicalReviewStatuses;
      assert.equal(statuses?.[changed.anchor], "open", "The conflict did not say the Stay is still open.");
      assert.equal(statuses?.[changed.members[0]], "ignored", "The conflict did not say which member was decided.");
      return /changed since it was shown/.test((error as Error).message);
    }, "An outing with a member decided on its own was logged.");
    assert.equal((await pool.query<{ status: string }>("select status from review_items where id = $1", [changed.anchor])).rows[0].status, "open",
      "A refused outing changed its Stay card.");
    console.info("Outing cards validated", { outings: groups.length });
  } finally {
    await clearDerivedLocationState();
    await pool.query("delete from places where id = $1", [home.id]);
  }
}

async function validateSavePlace() {
  const fixture = locationAcceptanceFixture();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const venue = LOCATION_ACCEPTANCE_PLACES[2];
  // The venue's saved place moves far away, so its visits arrive as unsaved Stays.
  await pool.query("update places set latitude = latitude + 1 where id = $1", [venue.id]);
  const created: string[] = [];
  let movedSecond = false;
  const category = await pool.query<{ id: string }>(
    `insert into categories (workspace_id, name, color) values ($1, 'Swimming', 'mint') returning id`, [WORKSPACE_ID]);
  const categoryId = category.rows[0].id;
  try {
    await clearDerivedLocationState();
    // Recent enough for the seven-day re-match: the fixture's own days are long past.
    // Four recent days of the same synthetic visits, so a second visit at the venue can be re-matched
    // and enough other unsaved visits remain for the activity cases below.
    const shifted = [1, 2, 3, 4].flatMap((daysBack) => fixture.evidence.map((item) => ({ ...item,
      clientEvidenceId: `${item.clientEvidenceId}-d${daysBack}`,
      occurredAt: shiftedIso(item.occurredAt, daysBack), ...(item.endedAt ? { endedAt: shiftedIso(item.endedAt, daysBack) } : {}),
      receivedAt: shiftedIso(item.receivedAt, 1) }))).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    // Uploads hold at most 100 readings: oldest first, as the phone sends them.
    for (let offset = 0; offset < shifted.length; offset += 100) {
      await ingestLocationEvidence(batch(`db-save-place-${offset}`, shifted.slice(offset, offset + 100), "v2_review", shifted[0].occurredAt),
        session, new Date().toISOString());
    }
    const unsaved = async () => (await pool.query<{ id: string; startedAt: Date; distance: number }>(
      `select ri.id, ri.suggested_started_at as "startedAt",
              ST_Distance(st.centre, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography) as distance
       from review_items ri join stay_segments st on st.id = ri.location_segment_id
       where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ri.suggested_place_id is null and st.centre is not null
       order by ri.suggested_started_at, ri.id`, [WORKSPACE_ID, USER_ID, venue.longitude, venue.latitude])).rows;
    const atVenue = (await unsaved()).filter((row) => row.distance < 150);
    assert(atVenue.length >= 2, "The fixture offered fewer than two unsaved Stays at the moved venue.");
    const [first, other] = atVenue;
    // The other visit there has its own activity, which re-matching and replay keep (Codex r2 on #459).
    const ownCategory = (await pool.query<{ id: string }>(
      `insert into categories (workspace_id, name, color) values ($1, 'Visiting friends', 'violet') returning id`, [WORKSPACE_ID])).rows[0].id;
    await pool.query("update review_items set suggested_category_id = $2 where id = $1", [other.id, ownCategory]);
    const centre = (await pool.query<{ latitude: number; longitude: number }>(
      `select st_y(st.centre::geometry) as latitude, st_x(st.centre::geometry) as longitude
       from review_items ri join stay_segments st on st.id = ri.location_segment_id where ri.id = $1`, [first.id])).rows[0];
    const expectedOthers = (await pool.query<{ count: number }>(
      `select count(*)::integer as count from review_items ri join stay_segments st on st.id = ri.location_segment_id
       where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ri.id <> $3 and ri.suggested_place_id is null
         and st.place_id is null and st.status = 'finalised' and ri.suggested_started_at > now() - interval '7 days'
         and ST_DWithin(st.centre, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 200)`,
      [WORKSPACE_ID, USER_ID, first.id, centre.longitude, centre.latitude])).rows[0].count;

    // A card titled by a learned name: once saved it is titled by the place, which is never learned as
    // the person's name (Codex r4 on #459).
    await pool.query(
      `update activity_events set raw_payload = raw_payload || '{"nameSource":"learned","namePatternBand":"morning"}'::jsonb
       where id = (select event_id from review_items where id = $1)`, [first.id]);
    await pool.query("update review_items set title = 'Weekly lesson' where id = $1", [first.id]);
    // The visit's own activity, which an omitted one means (Codex r1 on #459).
    await pool.query("update review_items set suggested_category_id = $2 where id = $1", [first.id, categoryId]);
    const envelope = { clientMutationId: "18700000-0000-4000-8000-000000000001",
      mutation: { action: "save_place" as const, name: "Synthetic pool", radiusMeters: 200, suggestVisits: true, autoLog: false } };
    const saved = await resolveIdempotentReviewMutation(first.id, envelope, session) as { status: string; placeId: string; rematchedCount: number };
    created.push(saved.placeId);
    assert.equal(saved.status, "open", "Save this place logged the visit.");
    assert(expectedOthers >= 1, "The fixture left no other visit to re-match.");
    assert.equal(saved.rematchedCount, expectedOthers, "Save this place re-matched the wrong number of other visits.");
    assert.deepEqual(await resolveIdempotentReviewMutation(first.id, envelope, session), saved, "A retried Save this place did not replay its receipt.");
    assert.equal(Number((await pool.query("select count(*) from places where workspace_id = $1 and name = 'Synthetic pool'", [WORKSPACE_ID])).rows[0].count), 1,
      "A retried Save this place created a second place.");

    const place = (await pool.query<{ latitude: number; longitude: number; radius: number; categoryId: string | null; logging: boolean; autoLog: boolean }>(
      `select latitude, longitude, radius_meters as radius, default_category_id as "categoryId", logging_enabled as logging, auto_log as "autoLog"
       from places where id = $1`, [saved.placeId])).rows[0];
    assert.deepEqual({ ...place, latitude: Number(place.latitude.toFixed(6)), longitude: Number(place.longitude.toFixed(6)) },
      { latitude: Number(centre.latitude.toFixed(6)), longitude: Number(centre.longitude.toFixed(6)), radius: 200, categoryId, logging: true, autoLog: false },
      "The saved place is not centred on the Stay with the chosen size, activity and switches.");
    const card = (await pool.query<{ status: string; placeId: string | null; title: string; categoryId: string | null; segmentPlace: string | null; continuity: string; entries: number }>(
      `select ri.status, ri.suggested_place_id as "placeId", ri.title, ri.suggested_category_id as "categoryId",
              st.place_id as "segmentPlace", st.continuity_status as continuity,
              (select count(*)::integer from time_entries te where te.created_from_event_id = ri.event_id) as entries
       from review_items ri join stay_segments st on st.id = ri.location_segment_id where ri.id = $1`, [first.id])).rows[0];
    assert.deepEqual(card, { status: "open", placeId: saved.placeId, title: "Synthetic pool", categoryId, segmentPlace: saved.placeId, continuity: "manual", entries: 0 },
      "The card did not take its saved place while staying open and unlogged.");
    const rematched = Number((await pool.query("select count(*) from review_items where workspace_id = $1 and status = 'open' and suggested_place_id = $2 and id <> $3",
      [WORKSPACE_ID, saved.placeId, first.id])).rows[0].count);
    assert.equal(rematched, expectedOthers, "The other visits there did not take the saved place.");
    console.info("Save this place validated", { unsavedAtVenue: atVenue.length, rematched });

    // Replay keeps the saved place on the open card even when the place later moves away from the
    // visit, so logging it later still files it there (Codex r1 on #459).
    await pool.query("update places set latitude = latitude + 1 where id = $1", [saved.placeId]);
    await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: shifted[0].occurredAt }, session, new Date().toISOString());
    await pool.query("update places set latitude = latitude - 1 where id = $1", [saved.placeId]);
    const afterReplay = (await pool.query<{ status: string; placeId: string | null; categoryId: string | null }>(
      `select status, suggested_place_id as "placeId", suggested_category_id as "categoryId" from review_items where id = $1`, [first.id])).rows[0];
    assert.deepEqual(afterReplay, { status: "open", placeId: saved.placeId, categoryId }, "Replay undid Save this place on the open card.");
    const otherAfterReplay = (await pool.query<{ placeId: string | null; categoryId: string | null }>(
      `select suggested_place_id as "placeId", suggested_category_id as "categoryId" from review_items where id = $1`, [other.id])).rows[0];
    assert.deepEqual(otherAfterReplay, { placeId: saved.placeId, categoryId: ownCategory }, "Replay gave a re-matched visit the place's activity.");
    // A visit that has a place already is refused; the card can still be logged afterwards.
    await assert.rejects(resolveLocationReviewAction(first.id, { action: "save_place", name: "Again", radiusMeters: 110 }, session),
      /already has a saved place/, "Save this place saved a second place for one visit.");
    const logged = await resolveLocationReviewAction(first.id, { action: "confirm" }, session);
    assert("entryId" in logged && logged.entryId, "A saved, still-open visit could not be logged.");
    const entry = (await pool.query<{ placeId: string | null; categoryId: string | null }>(
      `select place_id as "placeId", category_id as "categoryId" from time_entries where id = $1`, [logged.entryId])).rows[0];
    assert.deepEqual(entry, { placeId: saved.placeId, categoryId }, "Logging a saved visit lost its place or activity.");
    assert.equal(Number((await pool.query("select count(*) from location_name_patterns where workspace_id = $1 and name = 'Synthetic pool'", [WORKSPACE_ID])).rows[0].count), 0,
      "Logging a saved card learned the place's name as the person's.");
    // A decided card can no longer be saved.
    await assert.rejects(resolveLocationReviewAction(first.id, { action: "save_place", name: "Late", radiusMeters: 110 }, session),
      /resolved differently/, "Save this place changed a decided card.");

    // An explicit null clears the card's activity (Codex r1 on #459).
    const clearable = (await unsaved())[0];
    assert(clearable, "The fixture left no other unsaved visit for the cleared-activity case.");
    {
      await pool.query("update review_items set suggested_category_id = $2 where id = $1", [clearable.id, categoryId]);
      const cleared = await resolveLocationReviewAction(clearable.id, { action: "save_place", name: "Synthetic cleared", radiusMeters: 50, categoryId: null }, session) as { placeId: string };
      created.push(cleared.placeId);
      const clearedCard = (await pool.query<{ categoryId: string | null }>(`select suggested_category_id as "categoryId" from review_items where id = $1`, [clearable.id])).rows[0];
      assert.equal(clearedCard.categoryId, null, "An explicitly cleared activity stayed on the card.");
    }

    // An activity the person chose when saving is theirs to teach when the card is logged, straight
    // after the save and after a replay in between (Codex r5 on #459; the emitter's side, when replay
    // rebuilds the card, is in corrected-stay-places.test.ts); a re-matched card's own activity, which
    // nobody chose there, teaches nothing.
    const learnedActivity = async (eventId: string) => (await pool.query<{ categoryId: string | null; categoryUses: number }>(
      `select category_id as "categoryId", category_uses as "categoryUses" from location_name_patterns
       where workspace_id = $1 and pattern_key = (select raw_payload ->> 'namePatternKey' from activity_events where id = $2)`,
      [WORKSPACE_ID, eventId])).rows;
    const eventOf = async (reviewId: string) => (await pool.query<{ eventId: string }>(
      `select event_id as "eventId" from review_items where id = $1`, [reviewId])).rows[0].eventId;
    const rematchedOther = (await pool.query<{ id: string }>(
      `select id from review_items where workspace_id = $1 and status = 'open' and suggested_place_id = $2 and id <> $3 order by id limit 1`,
      [WORKSPACE_ID, saved.placeId, first.id])).rows[0];
    assert(rematchedOther, "The fixture left no re-matched card to log.");
    await resolveLocationReviewAction(rematchedOther.id, { action: "confirm" }, session);
    assert.deepEqual((await learnedActivity(await eventOf(rematchedOther.id))).filter((row) => row.categoryUses > 0), [],
      "Logging a re-matched card learned an activity nobody chose there.");
    // Fresh unsaved visits for them, at two places so one save never re-matches the other case's
    // visit: Home and the round-trip home move away too, and replay re-offers their visits.
    const movedPlaces = [LOCATION_ACCEPTANCE_PLACES[0].id, LOCATION_ACCEPTANCE_PLACES[4].id];
    await pool.query("update places set latitude = latitude + 1 where id = any($1::uuid[])", [movedPlaces]);
    movedSecond = true;
    await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: shifted[0].occurredAt }, session, new Date().toISOString());
    const usedCentres: string[] = [];
    for (const replayFirst of [false, true]) {
      const chosen = (await pool.query<{ id: string; segmentId: string }>(
        `select ri.id, st.id as "segmentId" from review_items ri join stay_segments st on st.id = ri.location_segment_id
         where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ri.suggested_place_id is null and st.centre is not null
           and not exists (select 1 from stay_segments used where used.id = any($3::uuid[]) and ST_DWithin(used.centre, st.centre, 500))
         order by ri.suggested_started_at, ri.id limit 1`, [WORKSPACE_ID, USER_ID, usedCentres])).rows[0];
      assert(chosen, `The fixture left no unsaved visit for the chosen-activity case (replay ${replayFirst}).`);
      const result = await resolveLocationReviewAction(chosen.id, {
        action: "save_place", name: `Synthetic chosen ${replayFirst ? "replayed" : "direct"}`, radiusMeters: 50, categoryId: ownCategory }, session) as { placeId: string };
      created.push(result.placeId);
      usedCentres.push(chosen.segmentId);
      if (replayFirst) {
        await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
          rolloutMode: "v2_review", semanticModeAcknowledgedAt: shifted[0].occurredAt }, session, new Date().toISOString());
      }
      await resolveLocationReviewAction(chosen.id, { action: "confirm" }, session);
      assert.deepEqual((await learnedActivity(await eventOf(chosen.id))).map((row) => [row.categoryId, row.categoryUses]), [[ownCategory, 1]],
        `Logging a card saved with a chosen activity did not learn it (replay ${replayFirst}).`);
    }
  } finally {
    await clearDerivedLocationState();
    if (created.length) await pool.query("delete from places where id = any($1::uuid[])", [created]);
    await pool.query("update places set latitude = latitude - 1 where id = $1", [venue.id]);
    if (movedSecond) {
      await pool.query("update places set latitude = latitude - 1 where id = any($1::uuid[])",
        [[LOCATION_ACCEPTANCE_PLACES[0].id, LOCATION_ACCEPTANCE_PLACES[4].id]]);
    }
    await pool.query("delete from categories where id = $1", [categoryId]);
    await pool.query("delete from categories where workspace_id = $1 and name = 'Visiting friends'", [WORKSPACE_ID]);
  }
}

/** A fixture time (20 July) moved to the same time of day `daysBack` days before today. */
function shiftedIso(value: string, daysBack: number) {
  const days = Math.floor((Date.now() - Date.parse("2026-07-20T00:00:00.000Z")) / 86_400_000) - daysBack;
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

/**
 * Learned names (PRD D19, A8): a name and activity the person gives a Move in Review become its next
 * card's name and activity; keeping them counts another use; Dayframe's own titles never count; "Stop
 * suggesting this" forgets them.
 */
async function validateLearnedNames() {
  await clearDerivedLocationState();
  await pool.query("delete from location_name_patterns where workspace_id = $1", [WORKSPACE_ID]);
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const evidence = timeAwayEvidence();
  const patterns = async () => (await pool.query<{ name: string | null; uses: number; categoryId: string | null; categoryUses: number; key: string; band: string }>(
    `select name, uses, category_id as "categoryId", category_uses as "categoryUses", pattern_key as key, band from location_name_patterns
     where workspace_id = $1 and user_id = $2 order by band`, [WORKSPACE_ID, USER_ID])).rows;
  const card = async () => (await pool.query<{ id: string; title: string; categoryId: string | null; source: string | null; key: string | null }>(
    `select ri.id, ri.title, ri.suggested_category_id as "categoryId", ae.raw_payload ->> 'nameSource' as source,
            ae.raw_payload ->> 'namePatternKey' as key
     from review_items ri join activity_events ae on ae.id = ri.event_id
     join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open'
     order by ri.suggested_started_at, ri.id`, [WORKSPACE_ID, USER_ID])).rows;
  const offer = async () => {
    await clearDerivedLocationState({ keepNamePatterns: true });
    await ingestLocationEvidence(batch("db-learned-names", evidence, "v2_review", "2026-06-01T07:00:00.000Z"), session);
    const [only] = await card();
    assert(only, "The learned-name fixture offered no card.");
    return only;
  };
  const travelId = () => travelCategory!;
  let travelCategory: string | null = null;
  const errands = await pool.query<{ id: string }>(
    `insert into categories (workspace_id, name, color) values ($1, 'Shopping', 'amber') returning id`, [WORKSPACE_ID]);
  const shoppingId = errands.rows[0].id;
  try {
    // Dayframe's own title never counts.
    const first = await offer();
    travelCategory = first.categoryId;
    assert(travelCategory, "The fixture's Move suggested no activity.");
    assert.equal(first.title, "Trip", "The fixture's Move was not titled Trip.");
    assert(first.key && /^[0-9a-f]{64}$/.test(first.key), "The Move's pattern key was not a hash.");
    await resolveLocationReviewAction(first.id, { action: "confirm" }, session);
    assert.deepEqual(await patterns(), [], "Confirming Dayframe's own title was learned.");

    // A name and activity the person gives are learned once…
    const second = await offer();
    await resolveLocationReviewAction(second.id, { action: "edit_and_confirm", edit: { description: "Shop run", categoryId: shoppingId } }, session);
    assert.deepEqual((await patterns()).map(({ name, uses, categoryId, categoryUses }) => ({ name, uses, categoryId, categoryUses })),
      [{ name: "Shop run", uses: 1, categoryId: shoppingId, categoryUses: 1 }], "A typed name and chosen activity were not learned.");

    // …and are the next card's name and activity; keeping them counts another use.
    const third = await offer();
    assert.deepEqual({ title: third.title, categoryId: third.categoryId, source: third.source },
      { title: "Shop run", categoryId: shoppingId, source: "learned" }, "A learned name did not name the next card.");
    const kept = await resolveLocationReviewAction(third.id, { action: "confirm" }, session);
    assert("entryId" in kept && kept.entryId);
    const keptEntry = await pool.query<{ description: string | null }>("select description from time_entries where id = $1", [kept.entryId]);
    assert.equal(keptEntry.rows[0].description, "Shop run", "Accepting a learned name did not keep it on the block.");
    assert.deepEqual((await patterns()).map(({ uses, categoryUses }) => ({ uses, categoryUses })), [{ uses: 2, categoryUses: 2 }],
      "Keeping a learned name and activity did not count a use of each.");
    // An activity changed on its own never adds a use to the name (Codex r1 on #458).
    const fourth = await offer();
    await resolveLocationReviewAction(fourth.id, { action: "edit_and_confirm", edit: { categoryId: travelId() } }, session);
    assert.deepEqual((await patterns()).map(({ name, uses, categoryUses }) => ({ name, uses, categoryUses })),
      [{ name: "Shop run", uses: 3, categoryUses: 1 }], "A kept learned name with a new activity was counted wrongly.");
    const reset = await offer();
    const resetDecision = await resolveLocationReviewAction(reset.id, { action: "edit_and_confirm", edit: { categoryId: shoppingId } }, session);
    assert("entryId" in resetDecision && resetDecision.entryId);
    // A name in another band is a fallback; forgetting must remove it too.
    await pool.query(
      `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, uses)
       select workspace_id, user_id, pattern_key, 'weekend', 'Weekend shop', 1 from location_name_patterns
       where workspace_id = $1 and band <> 'weekend' limit 1`, [WORKSPACE_ID]);

    // "Stop suggesting this" forgets it.
    assert.equal(await forgetLearnedNameForEntry(pool, session, resetDecision.entryId), 2, "Stop suggesting this did not forget every band.");
    assert.deepEqual(await patterns(), [], "Stop suggesting this left the learned name.");
    assert.equal((await offer()).title, "Trip", "A forgotten name still named the card.");

    // After two uses a learned name also names a Log automatically block (D17 visits).
    const acceptance = locationAcceptanceFixture();
    for (const place of LOCATION_ACCEPTANCE_PLACES) {
      await pool.query(
        `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, uses)
         select $1, $2, $3, band, $4, 1 from unnest(array['morning', 'afternoon', 'evening', 'weekend']) as band`,
        [WORKSPACE_ID, USER_ID, hashedPatternKey(session, `p:${place.id}`), `Learned ${place.name}`]);
    }
    await pool.query("update places set auto_log = true where workspace_id = $1", [WORKSPACE_ID]);
    const autoBlocks = async () => {
      await clearDerivedLocationState({ keepNamePatterns: true });
      await ingestLocationEvidence(batch("db-learned-names-autolog", acceptance.evidence, "v2_review", acceptance.evidence[0].occurredAt), session);
      return (await pool.query<{ description: string | null }>(
        `select description from time_entries where workspace_id = $1 and user_id = $2 and source = 'location_auto_log'
         order by started_at`, [WORKSPACE_ID, USER_ID])).rows.map((row) => row.description);
    };
    const once = await autoBlocks();
    assert(once.length > 0, "The acceptance fixture logged no visit automatically.");
    assert(once.every((description) => !description?.startsWith("Learned ")), "A learned name used once named a Log automatically block.");
    await pool.query("update location_name_patterns set uses = 2 where workspace_id = $1 and name like 'Learned %'", [WORKSPACE_ID]);
    const twice = await autoBlocks();
    assert(twice.length > 0 && twice.every((description) => description?.startsWith("Learned ")),
      `A learned name used twice did not name the Log automatically block: ${JSON.stringify(twice)}`);
    await pool.query("update places set auto_log = false where workspace_id = $1", [WORKSPACE_ID]);
    await pool.query("delete from location_name_patterns where workspace_id = $1 and name like 'Learned %'", [WORKSPACE_ID]);
  } finally {
    await clearDerivedLocationState();
    await pool.query("update places set auto_log = false where workspace_id = $1", [WORKSPACE_ID]);
    await pool.query("delete from location_name_patterns where workspace_id = $1", [WORKSPACE_ID]);
    await pool.query("delete from categories where id = $1", [shoppingId]);
  }
}

/**
 * Learned names through corrections (Codex r2 on #458): a Stay corrected to another place, on its own
 * or in the editor, or to a learned place teaches that place; split parts keep learned provenance and
 * an activity chosen in the split; a cleared activity teaches none; an activity-only band never hides
 * another band's name; and an older client's plain accept of a location card is a Confirm.
 */
async function validateLearnedNameCorrections() {
  await clearDerivedLocationState();
  await pool.query("delete from location_name_patterns where workspace_id = $1", [WORKSPACE_ID]);
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const fixture = locationAcceptanceFixture();
  const [placeA, placeB] = LOCATION_ACCEPTANCE_PLACES;
  const keyOf = (id: string) => hashedPatternKey(session, `p:${id}`);
  const rows = async () => (await pool.query<{ key: string; band: string; name: string | null; uses: number; categoryId: string | null; categoryUses: number }>(
    `select pattern_key as key, band, name, uses, category_id as "categoryId", category_uses as "categoryUses"
     from location_name_patterns where workspace_id = $1 and user_id = $2 order by pattern_key, band`, [WORKSPACE_ID, USER_ID])).rows;
  const cards = async (type?: string) => (await pool.query<{ id: string; title: string; placeId: string | null; categoryId: string | null; band: string | null;
    startedAt: Date; stoppedAt: Date }>(
    `select ri.id, ri.title, ri.suggested_place_id as "placeId", ri.suggested_category_id as "categoryId",
            ae.raw_payload ->> 'namePatternBand' as band, ri.suggested_started_at as "startedAt", ri.suggested_stopped_at as "stoppedAt"
     from review_items ri join activity_events ae on ae.id = ri.event_id
     join stay_segments st on st.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ($3::text is null or ri.type = $3)
     order by ri.suggested_started_at, ri.id`, [WORKSPACE_ID, USER_ID, type ?? null])).rows;
  const offer = async () => {
    await clearDerivedLocationState({ keepNamePatterns: true });
    await ingestLocationEvidence(batch("db-learned-name-corrections", fixture.evidence, "v2_review", fixture.evidence[0].occurredAt), session);
    const card = (await cards()).find((row) => row.placeId === placeA.id);
    assert(card && card.band, "The acceptance fixture offered no Stay card at its first place.");
    return card;
  };
  const forgetAll = () => pool.query("delete from location_name_patterns where workspace_id = $1", [WORKSPACE_ID]);
  const seed = (key: string, name: string | null, uses: number, categoryId: string | null, categoryUses: number, bands = ["morning", "afternoon", "evening", "weekend"]) =>
    pool.query(
      `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, uses, category_id, category_uses)
       select $1, $2, $3, band, $4, $5, $6, $7 from unnest($8::text[]) as band`,
      [WORKSPACE_ID, USER_ID, key, name, uses, categoryId, categoryUses, bands]);
  const midpoint = (card: { startedAt: Date; stoppedAt: Date }) =>
    new Date((new Date(card.startedAt).getTime() + new Date(card.stoppedAt).getTime()) / 2).toISOString();
  const category = await pool.query<{ id: string }>(
    `insert into categories (workspace_id, name, color) values ($1, 'Visiting', 'amber') returning id`, [WORKSPACE_ID]);
  const chosenId = category.rows[0].id;
  let learnedPlaceId: string | null = null;
  try {
    // An older client's plain accept reaches a location card as Confirm.
    const located = await offer();
    assert.equal(await isLocationSegmentReview(located.id, session), true, "A Stay card was not recognised as a location card.");
    assert.equal(await isLocationSegmentReview("not-a-uuid", session), false);

    // Correcting the place in the editor teaches the corrected place.
    const edited = await offer();
    await resolveLocationReviewAction(edited.id, { action: "edit_and_confirm", edit: { placeId: placeB.id, description: "Corrected visit" } }, session);
    assert.deepEqual((await rows()).map((row) => row.key), [keyOf(placeB.id)], "An edited place still taught the original place.");
    await forgetAll();

    // A standalone change of place, confirmed later, teaches the new place.
    const changed = await offer();
    await resolveLocationReviewAction(changed.id, { action: "change_place", placeId: placeB.id }, session);
    await resolveLocationReviewAction(changed.id, { action: "edit_and_confirm", edit: { description: "Corrected visit" } }, session);
    assert.deepEqual((await rows()).map((row) => row.key), [keyOf(placeB.id)], "A standalone change of place still taught the original place.");
    await forgetAll();

    // Replay keeps a standalone correction's place in the card's pattern (Codex r3 on #458).
    const replayed = await offer();
    await resolveLocationReviewAction(replayed.id, { action: "change_place", placeId: placeB.id }, session);
    await ingestLocationEvidence(batch("db-learned-name-corrections", fixture.evidence, "v2_review", fixture.evidence[0].occurredAt), session);
    const replayedKey = await pool.query<{ key: string | null }>(
      `select ae.raw_payload ->> 'namePatternKey' as key from review_items ri join activity_events ae on ae.id = ri.event_id where ri.id = $1`,
      [replayed.id]);
    assert.equal(replayedKey.rows[0]?.key, keyOf(placeB.id), "Replay put back the uncorrected place's pattern.");
    await resolveLocationReviewAction(replayed.id, { action: "edit_and_confirm", edit: { description: "Corrected visit" } }, session);
    assert.deepEqual((await rows()).map((row) => row.key), [keyOf(placeB.id)], "A replayed correction taught the original place.");
    await forgetAll();

    // Split parts learn in their own time-of-day bands.
    const banded = await offer();
    const bandedSplit = await resolveLocationReviewAction(banded.id, { action: "split_and_confirm", splitAt: midpoint(banded),
      left: { description: "First part" }, right: { description: "Second part" } }, session);
    assert("entryIds" in bandedSplit);
    const expectedBands = [
      { name: "First part", band: nameBand(new Date(banded.startedAt).toISOString(), "Europe/London") },
      { name: "Second part", band: nameBand(midpoint(banded), "Europe/London") }
    ];
    // Each band keeps the last name given in it.
    const lastPerBand = [...new Map(expectedBands.map((part) => [part.band, part])).values()];
    assert.deepEqual((await rows()).map(({ name, band }) => ({ name, band })).sort((a, b) => a.band.localeCompare(b.band)),
      lastPerBand.sort((a, b) => a.band.localeCompare(b.band)), "Split parts did not learn in their own bands.");
    await forgetAll();

    // A part with no reading of its own takes its visit's zone, never a later trip's (Codex r5 on #458).
    const sparse = await offer();
    await pool.query(
      `insert into location_evidence
       select (jsonb_populate_record(null::location_evidence, to_jsonb(le) || jsonb_build_object(
         'id', gen_random_uuid(), 'client_evidence_id', le.client_evidence_id || '-later-zone',
         'occurred_at', le.occurred_at + interval '1 day', 'time_zone', 'Asia/Tokyo'))).*
       from location_evidence le where le.workspace_id = $1 and le.user_id = $2 order by le.occurred_at desc limit 1`,
      [WORKSPACE_ID, USER_ID]);
    const lateSplitAt = new Date(new Date(sparse.stoppedAt).getTime() - 70_000).toISOString();
    await resolveLocationReviewAction(sparse.id, { action: "split_and_confirm", splitAt: lateSplitAt,
      left: { description: "Before" }, right: { description: "Last minute" } }, session);
    const lastMinute = (await rows()).find((row) => row.name === "Last minute");
    assert.equal(lastMinute?.band, nameBand(lateSplitAt, "Europe/London"), "A sparse split part learned in a later trip's time zone.");
    await pool.query("delete from location_evidence where workspace_id = $1 and client_evidence_id like '%-later-zone'", [WORKSPACE_ID]);
    await forgetAll();

    // A correction to an accepted learned place teaches that learned place.
    const learned = await pool.query<{ id: string }>(
      `insert into learned_places (workspace_id, user_id, cluster_key, name, latitude, longitude, first_seen_at, last_seen_at, status)
       values ($1, $2, 'db-learned-name-corrections', 'Synthetic learned place', 0.001, 0.001, now(), now(), 'accepted') returning id`,
      [WORKSPACE_ID, USER_ID]);
    learnedPlaceId = learned.rows[0].id;
    const toLearned = await offer();
    await resolveLocationReviewAction(toLearned.id, { action: "change_place", placeId: null, learnedPlaceId }, session);
    await resolveLocationReviewAction(toLearned.id, { action: "edit_and_confirm", edit: { description: "Corrected visit" } }, session);
    assert.deepEqual((await rows()).map((row) => row.key), [hashedPatternKey(session, `l:${learnedPlaceId}`)],
      "A correction to a learned place did not teach that learned place.");
    await forgetAll();
    await clearDerivedLocationState();
    await pool.query("delete from learned_places where id = $1", [learnedPlaceId]);
    learnedPlaceId = null;

    // Split parts keep the learned name and activity; confirming one counts a use of each.
    await seed(keyOf(placeA.id), "Learned visit", 1, chosenId, 1);
    const parent = await offer();
    assert.deepEqual({ title: parent.title, categoryId: parent.categoryId }, { title: "Learned visit", categoryId: chosenId },
      "The seeded learned name did not name the Stay card.");
    await resolveLocationReviewAction(parent.id, { action: "split", splitAt: midpoint(parent) }, session);
    const [left] = await cards("location_manual_correction");
    assert(left, "Split offered no correction cards.");
    await resolveLocationReviewAction(left.id, { action: "confirm" }, session);
    const afterSplit = (await rows()).find((row) => row.band === parent.band);
    assert.deepEqual(afterSplit && { uses: afterSplit.uses, categoryUses: afterSplit.categoryUses }, { uses: 2, categoryUses: 2 },
      "Confirming a split part's kept learned name and activity was not learned.");
    await forgetAll();

    // A cleared activity in a split stays cleared and teaches no activity.
    await seed(keyOf(placeA.id), "Learned visit", 1, chosenId, 1);
    const cleared = await offer();
    const clearedSplit = await resolveLocationReviewAction(cleared.id,
      { action: "split_and_confirm", splitAt: midpoint(cleared), left: { categoryId: null }, right: {} }, session);
    assert("entryIds" in clearedSplit && clearedSplit.entryIds);
    const clearedEntry = await pool.query<{ categoryId: string | null }>(
      `select category_id as "categoryId" from time_entries where id = $1`, [clearedSplit.entryIds[0]]);
    assert.equal(clearedEntry.rows[0].categoryId, null, "A cleared activity got the suggested activity.");
    const afterClear = (await rows()).find((row) => row.band === cleared.band);
    assert.deepEqual(afterClear && { categoryId: afterClear.categoryId, categoryUses: afterClear.categoryUses }, { categoryId: chosenId, categoryUses: 2 },
      "A cleared activity was learned as a choice, or the kept one was not.");
    await forgetAll();

    // An activity chosen in a split is learned when its part is confirmed.
    const choosing = await offer();
    await resolveLocationReviewAction(choosing.id, { action: "split", splitAt: midpoint(choosing), left: { categoryId: chosenId } }, session);
    const [chosenPart] = await cards("location_manual_correction");
    await resolveLocationReviewAction(chosenPart.id, { action: "confirm" }, session);
    assert.deepEqual((await rows()).map(({ categoryId, categoryUses }) => ({ categoryId, categoryUses })), [{ categoryId: chosenId, categoryUses: 1 }],
      "An activity chosen in a split was not learned when its part was confirmed.");
    await forgetAll();

    // An activity-only band never hides another band's name.
    await seed("db-independent-bands", "Morning name", 3, null, 0, ["morning"]);
    await seed("db-independent-bands", null, 0, chosenId, 1, ["afternoon"]);
    const independent = await learnedNamesFor(pool, session, new Map([["card", { key: "db-independent-bands", band: "afternoon" as const }]]));
    assert.deepEqual(independent.get("card"), { name: "Morning name", categoryId: chosenId, uses: 3, categoryUses: 1 },
      "An activity-only band hid another band's learned name.");

    // Keeping another band's name in this band never makes it less trusted (Codex r4 on #458).
    await forgetAll();
    await seed("db-kept-fallback", "School run", 2, null, 0, ["morning"]);
    const fallbackPattern = { key: "db-kept-fallback", band: "afternoon" as const };
    assert.equal((await learnedNamesFor(pool, session, new Map([["card", fallbackPattern]]))).get("card")?.uses, 2);
    await recordLearnedName(pool, session, fallbackPattern, { name: "school  RUN", categoryId: null });
    assert.equal((await learnedNamesFor(pool, session, new Map([["card", fallbackPattern]]))).get("card")?.uses, 2,
      "Keeping a fallback name in its own band demoted it below the automatic-name threshold.");
  } finally {
    await clearDerivedLocationState();
    await forgetAll();
    if (learnedPlaceId) await pool.query("delete from learned_places where id = $1", [learnedPlaceId]);
    await pool.query("delete from categories where id = $1", [chosenId]);
  }
}

/**
 * Health walks win (PRD D19, design §9): a Move an Apple Health walk covers is not offered; when the
 * workout arrives after the card, the next replay retires the card, and it comes back if the
 * workout goes. A workout of another kind never hides a Move.
 */
async function validateHealthWalksWin() {
  await clearDerivedLocationState();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const evidence = timeAwayEvidence();
  const moveCards = async () => (await pool.query<{ status: string; scope: string | null }>(
    `select ri.status, ri.ignored_scope as scope from review_items ri join commute_segments cs on cs.id = ri.location_segment_id
     where ri.workspace_id = $1 and ri.user_id = $2`, [WORKSPACE_ID, USER_ID])).rows;
  // An imported Apple Health workout (`health_workouts`), whatever became of its own card or block.
  const addWorkout = async (id: string, workoutType: string, payload: Record<string, unknown> = { workoutType }) =>
    (await pool.query<{ id: string }>(
      `insert into health_workouts (workspace_id, user_id, external_sample_id, workout_type, started_at, stopped_at, duration_seconds, raw_payload)
       values ($1, $2, $3, $4, '2026-07-20T08:58:00Z', '2026-07-20T09:10:00Z', 720, $5) returning id`,
      [WORKSPACE_ID, USER_ID, `db-health-${id}`, workoutType, payload])).rows[0].id;
  const removeWorkout = (id: string) => pool.query("delete from health_workouts where id = $1", [id]);

  // Workout first: the walk it covers is never offered.
  const first = await addWorkout("first", "walking");
  await ingestLocationEvidence(batch("db-health-walk-first", evidence, "v2_review", "2026-06-01T07:00:00.000Z"), session);
  assert.deepEqual(await moveCards(), [], "A Move a Health walk covers was offered in Review.");
  await removeWorkout(first);

  // Card first, then the import alone (no location call) retires it.
  await clearDerivedLocationState();
  const cardFirst = batch("db-health-walk-card-first", evidence, "v2_review", "2026-06-01T07:00:00.000Z");
  await ingestLocationEvidence(cardFirst, session);
  assert.deepEqual(await moveCards(), [{ status: "open", scope: null }], "The Move was not offered without a workout.");
  const late = await addWorkout("late", "walking");
  assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT }), 1, "A Health import did not retire the Move it covers.");
  assert.deepEqual(await moveCards(), [{ status: "ignored", scope: "superseded" }], "A late Health walk did not retire the Move's card.");
  // Removing the workout brings it back while its evidence lasts.
  await removeWorkout(late);
  await ingestLocationEvidence(cardFirst, session);
  assert.deepEqual(await moveCards(), [{ status: "open", scope: null }], "The Move did not come back when its Health walk went.");

  // The card's stored window can be stale (later evidence moved the Move): emission retires it by the
  // Move's current window, not the card's (Codex r2 on #457).
  await pool.query(
    `update review_items set suggested_started_at = suggested_started_at - interval '3 hours',
            suggested_stopped_at = suggested_stopped_at - interval '3 hours'
     where workspace_id = $1 and user_id = $2 and status = 'open'`, [WORKSPACE_ID, USER_ID]);
  const stale = await addWorkout("stale", "walking");
  assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT }), 0,
    "The stored-card sweep matched a card whose stored window the workout does not cover.");
  await ingestLocationEvidence(cardFirst, session);
  assert.deepEqual(await moveCards(), [{ status: "ignored", scope: "superseded" }],
    "A Move covered by its current window kept its stale open card.");
  await removeWorkout(stale);
  await ingestLocationEvidence(cardFirst, session);
  assert.deepEqual(await moveCards(), [{ status: "open", scope: null }], "The Move did not come back after the stale-window case.");

  // Its evidence gone, a later workout is still reconciled from the card itself on the next replay.
  await pool.query("delete from location_evidence where workspace_id = $1 and user_id = $2", [WORKSPACE_ID, USER_ID]);
  const afterExpiry = await addWorkout("expired", "other", { workoutType: null, workoutLabel: "Walk" });
  const replayed = { replay: await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    rolloutMode: "v2_review", semanticModeAcknowledgedAt: "2026-06-01T07:00:00.000Z" }, session, PROCESSING_AT) };
  assert.deepEqual(await moveCards(), [{ status: "ignored", scope: "superseded" }],
    "A workout (typed only by its label) did not retire a Move whose evidence had aged out.");
  assert(replayed.replay.semanticChangeCount > 0, "Retiring a card for a Health walk reported no change.");
  await removeWorkout(afterExpiry);

  // A card older than the replay sweep's 30 days is still reached through the imported workout's own
  // window (Codex r3 on #457).
  await clearDerivedLocationState();
  await ingestLocationEvidence(cardFirst, session);
  await pool.query(
    `update review_items set suggested_started_at = suggested_started_at - interval '40 days',
            suggested_stopped_at = suggested_stopped_at - interval '40 days'
     where workspace_id = $1 and user_id = $2 and status = 'open'`, [WORKSPACE_ID, USER_ID]);
  const aged = (await pool.query<{ id: string }>(
    `insert into health_workouts (workspace_id, user_id, external_sample_id, workout_type, started_at, stopped_at, raw_payload)
     values ($1, $2, 'db-health-aged', 'walking', timestamptz '2026-07-20T08:58:00Z' - interval '40 days',
             timestamptz '2026-07-20T09:10:00Z' - interval '40 days', '{}'::jsonb) returning id`, [WORKSPACE_ID, USER_ID])).rows[0].id;
  assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT }), 0, "The 30-day sweep reached a 40-day-old card.");
  // The request's own window is not the stored one (an earlier revision of the sample set it, or the
  // request named no stop): the stored row decides (Codex r4 on #457).
  assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT, workout: {
    provider: null, externalSampleId: "db-health-aged", startedAt: PROCESSING_AT, stoppedAt: PROCESSING_AT } }), 1,
    "A workout import did not retire the old Move card its stored window covers.");
  assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT, workout: {
    provider: null, externalSampleId: "db-health-missing", startedAt: PROCESSING_AT, stoppedAt: PROCESSING_AT } }), 0,
    "A workout that was never stored retired a card.");
  await removeWorkout(aged);

  // No cap hides the covering workout among many others in the same window (Codex r1 on #457).
  await clearDerivedLocationState();
  await pool.query(
    `insert into health_workouts (workspace_id, user_id, external_sample_id, workout_type, started_at, stopped_at, raw_payload)
     select $1, $2, 'db-health-crowd-' || n, 'strength_training', '2026-07-20T08:30:00Z', '2026-07-20T09:30:00Z', '{}'::jsonb
     from generate_series(1, 600) as n`, [WORKSPACE_ID, USER_ID]);
  const crowded = await addWorkout("crowded", "walking");
  await ingestLocationEvidence(batch("db-health-walk-crowded", evidence, "v2_review", "2026-06-01T07:00:00.000Z"), session);
  assert.deepEqual(await moveCards(), [], "A covering Health walk among 600 other workouts did not hide its Move.");
  await removeWorkout(crowded);
  await pool.query("delete from health_workouts where workspace_id = $1 and external_sample_id like 'db-health-crowd-%'", [WORKSPACE_ID]);

  // A workout of another kind never hides a Move.
  await clearDerivedLocationState();
  const strength = await addWorkout("strength", "strength_training");
  await ingestLocationEvidence(cardFirst, session);
  assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT }), 0, "A strength workout retired a Move.");
  assert.deepEqual(await moveCards(), [{ status: "open", scope: null }], "A strength workout hid a Move.");
  await removeWorkout(strength);
  await clearDerivedLocationState();
}

/**
 * Per-place "Log automatically" in v2_review (owner decisions 14–15 Oct 2026): a trusted stay at an
 * auto_log place becomes a location_auto_log block instead of a Review card; overlaps, a running
 * timer or the switch off keep it in Review; retries never duplicate; replay moves an unedited block
 * with its visit and removes it with a vanished visit; edited or deleted blocks are never touched.
 */
/**
 * one Review card per outing (grouping, log and skip together, retry, conflict), Moves that log themselves in Review mode (PRD D19, A3/A4): with "Log trips automatically" on, a clear
 * Move between two saved places becomes a location_auto_log block, not a Review card; with it off, an
 * overlap over five minutes, or its pattern stopped ("Don't log trips like this"), it stays a card
 * saying why. Replay keeps one block per Move and moves it with a Move whose ID changed.
 */
async function validateReviewModeAutoMoves() {
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  // Real (not simulated) fixes, so the speed rule gives the drive its mode (PRD D19, A2).
  const base = trustedCommuteFixture("auto-move");
  const fixture = { ...base, evidence: base.evidence.map((item) => ({ ...item, isSimulated: false })) };
  const ingest = () => ingestLocationEvidence(batch("db-auto-moves", fixture.evidence, "v2_review", fixture.evidence[0].occurredAt), session, PROCESSING_AT);
  const setSwitch = (on: boolean) => pool.query("update users set log_trips_automatically = $2 where id = $1", [USER_ID, on]);
  const moveBlocks = async () => (await pool.query<{ id: string; eventId: string; categoryId: string | null; reason: string | null; status: string }>(
    `select te.id, te.created_from_event_id as "eventId", te.category_id as "categoryId",
            ae.raw_payload ->> 'semanticReason' as reason, ae.review_status as status
     from time_entries te join activity_events ae on ae.id = te.created_from_event_id
     where te.workspace_id = $1 and te.user_id = $2 and te.source = 'location_auto_log' and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID])).rows;
  const moveCards = async () => (await pool.query<{ reason: string | null; patternKey: string | null }>(
    `select ae.raw_payload ->> 'semanticReason' as reason, ae.raw_payload ->> 'namePatternKey' as "patternKey"
     from review_items ri join activity_events ae on ae.id = ri.event_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ae.event_type = 'commute_detected'`,
    [WORKSPACE_ID, USER_ID])).rows;
  try {
    // Off: a card that says the switch is off.
    await clearDerivedLocationState();
    await setSwitch(false);
    await ingest();
    assert.equal((await moveBlocks()).length, 0, "A Move logged itself with Log trips automatically off.");
    const offCards = await moveCards();
    assert.deepEqual(offCards.map((card) => card.reason), ["log_trips_off"], "The Move's card did not say Log trips automatically is off.");
    // Offered once, it never logs itself later, even under a new ID with the switch on (Codex r1 on #462).
    await pool.query(`update commute_segments set client_segment_id = client_segment_id || '-old'
      where workspace_id = $1 and user_id = $2 and status <> 'superseded'`, [WORKSPACE_ID, USER_ID]);
    await pool.query(`update activity_events set client_event_id = client_event_id || '-old'
      where workspace_id = $1 and user_id = $2 and event_type = 'commute_detected'`, [WORKSPACE_ID, USER_ID]);
    await setSwitch(true);
    await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: fixture.evidence[0].occurredAt }, session, PROCESSING_AT);
    assert.equal((await moveBlocks()).length, 0, "A Move offered before under another ID logged itself.");
    assert.deepEqual((await moveCards()).map((card) => card.reason), ["auto_log_offered_before"],
      "The re-identified Move's card did not say it was offered before.");

    // On (the default): one block, no card; its event is confirmed and says why.
    await clearDerivedLocationState();
    await setSwitch(true);
    await ingest();
    const blocks = await moveBlocks();
    assert.equal(blocks.length, 1, "A clear Move between two saved places did not log itself.");
    assert.deepEqual({ reason: blocks[0].reason, status: blocks[0].status }, { reason: "move_auto_log", status: "confirmed" },
      "The automatic Move's event does not say it logged itself.");
    assert(blocks[0].categoryId, "The automatic Move's block has no activity.");
    assert.equal((await moveCards()).length, 0, "A Move that logged itself still has a Review card.");

    // Replay keeps exactly that block, and moves it with the Move when its ID changes.
    await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: fixture.evidence[0].occurredAt }, session, PROCESSING_AT);
    assert.deepEqual((await moveBlocks()).map((block) => block.id), [blocks[0].id], "Replay changed an unedited automatic Move's block.");
    await pool.query(`update commute_segments set client_segment_id = client_segment_id || '-old'
      where workspace_id = $1 and user_id = $2 and created_from_event_id = $3`, [WORKSPACE_ID, USER_ID, blocks[0].eventId]);
    await pool.query(`update activity_events set client_event_id = client_event_id || '-old'
      where workspace_id = $1 and user_id = $2 and id = $3`, [WORKSPACE_ID, USER_ID, blocks[0].eventId]);
    await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: fixture.evidence[0].occurredAt }, session, PROCESSING_AT);
    const moved = await moveBlocks();
    assert.equal(moved.length, 1, "Replay left the automatic Move with no block, or two.");
    assert.equal(moved[0].id, blocks[0].id, "Replay did not move the unedited block to the Move's new ID.");
    assert.notEqual(moved[0].eventId, blocks[0].eventId, "The moved block still points at the retired Move.");
    // Its block follows the Move only while the Move, moved, would still log itself: a block it would
    // overlap by more than five minutes keeps it where it was (Codex r1 on #462).
    const shifted = (await pool.query<{ startedAt: Date; stoppedAt: Date }>(
      `update time_entries set started_at = started_at + interval '10 minutes', stopped_at = stopped_at + interval '10 minutes'
       where id = $1 returning started_at as "startedAt", stopped_at as "stoppedAt"`, [moved[0].id])).rows[0];
    const busy = await pool.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, source, review_status, started_at, stopped_at)
       values ($1, $2, 'manual_app', 'confirmed', $3::timestamptz - interval '15 minutes', $3::timestamptz - interval '3 minutes') returning id`,
      [WORKSPACE_ID, USER_ID, shifted.startedAt]);
    await replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: fixture.evidence[0].occurredAt }, session, PROCESSING_AT);
    const kept = (await pool.query<{ startedAt: Date }>(`select started_at as "startedAt" from time_entries where id = $1`, [moved[0].id])).rows[0];
    assert.equal(kept.startedAt.getTime(), shifted.startedAt.getTime(), "A Move's block followed it over tracked time.");
    await pool.query("delete from time_entries where id = $1", [busy.rows[0].id]);

    // Tracked time overlapping it by more than five minutes keeps it a card that says so.
    await clearDerivedLocationState();
    const overlap = await pool.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, source, review_status, started_at, stopped_at)
       values ($1, $2, 'manual_app', 'confirmed', $3, $4) returning id`,
      [WORKSPACE_ID, USER_ID, fixture.evidence[3].occurredAt, fixture.evidence[6].occurredAt]);
    await ingest();
    await pool.query("delete from time_entries where id = $1", [overlap.rows[0].id]);
    assert.equal((await moveBlocks()).length, 0, "A Move overlapping tracked time logged itself.");
    const overlapCards = await moveCards();
    assert.deepEqual(overlapCards.map((card) => card.reason), ["auto_log_overlap"], "The overlapping Move's card did not say why.");

    // "Don't log trips like this" (PR 11c): the person deletes an automatic Move's block and stops its
    // pattern from the toast; the block's row names its Move's event, which outlives the block. A later
    // Move like it stays a card saying so, Places › Trips lists the pattern, and resuming clears it.
    await clearDerivedLocationState();
    await ingest();
    const [stoppable] = await moveBlocks();
    assert(stoppable, "No automatic Move to stop.");
    const listed = await pool.query<{ id: string; automaticMoveEventId: string | null }>(
      buildTimeEntriesQuery(session, { entryId: stoppable.id }));
    assert.equal(listed.rows.find((row) => row.id === stoppable.id)?.automaticMoveEventId, stoppable.eventId,
      "The automatic Move's block did not name its Move's event.");
    await pool.query("delete from time_entries where id = $1", [stoppable.id]);
    assert.equal(await stopLoggingTripsLike(pool, session, stoppable.eventId), true, "Don't log trips like this found no pattern.");
    const stopped = await stoppedTripPatterns(pool, session);
    assert.equal(stopped.length, 1, "Places › Trips did not list the stopped trip.");
    assert(stopped[0].label.trim(), "The stopped trip has no label.");
    // The deleted block is a decision: replay never recreates it, stopped or resumed (Codex r1 on #463).
    const replayMoves = () => replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: fixture.evidence[0].occurredAt }, session, PROCESSING_AT);
    await replayMoves();
    assert.equal((await moveBlocks()).length, 0, "Replay recreated a deleted automatic Move.");
    await resumeLoggingTrips(pool, session, stopped[0].patternKey);
    await replayMoves();
    assert.equal((await moveBlocks()).length, 0, "Resuming brought a deleted automatic Move back.");
    assert.equal(await stopLoggingTripsLike(pool, session, stoppable.eventId), true, "Stopping the trip again failed.");
    // The deleted block's own Move is a decision and never comes back; a later Move like it does. Keep
    // the stop the API wrote across a fresh run of the same evidence, which stands in for that Move.
    const stops = (await pool.query<{ key: string; band: string }>(
      `select pattern_key as key, band from location_name_patterns where workspace_id = $1 and user_id = $2 and auto_log_opt_out`,
      [WORKSPACE_ID, USER_ID])).rows;
    assert.deepEqual(stops.map((row) => row.key), [stopped[0].patternKey], "The stop was not written for the trip's pattern.");
    await clearDerivedLocationState();
    for (const row of stops) {
      await pool.query(`insert into location_name_patterns (workspace_id, user_id, pattern_key, band, auto_log_opt_out)
        values ($1, $2, $3, $4, true)`, [WORKSPACE_ID, USER_ID, row.key, row.band]);
    }
    await ingest();
    assert.equal((await moveBlocks()).length, 0, "A Move whose pattern was stopped logged itself.");
    assert.deepEqual((await moveCards()).map((card) => card.reason), ["trip_logging_opted_out"], "The stopped Move's card did not say why.");
    await resumeLoggingTrips(pool, session, stopped[0].patternKey);
    assert.deepEqual(await stoppedTripPatterns(pool, session), [], "Resuming left the trip stopped.");
    // A Health walk that arrives after a walk logged itself takes the walk's block; when it goes, the
    // walk comes back and logs itself again (Codex r1 on #462).
    await clearDerivedLocationState();
    const walk = trustedCommuteFixture("auto-walk").evidence.map((item) => ({ ...item, isSimulated: false,
      ...(item.speedMetersPerSecond ? { speedMetersPerSecond: 1.4 } : {}) }));
    const walkBatch = batch("db-auto-walk", walk, "v2_review", walk[0].occurredAt);
    await ingestLocationEvidence(walkBatch, session, PROCESSING_AT);
    assert.equal((await moveBlocks()).length, 1, "A clear walk between two saved places did not log itself.");
    const addWalkWorkout = async (id: string) => (await pool.query<{ id: string }>(
      `insert into health_workouts (workspace_id, user_id, external_sample_id, workout_type, started_at, stopped_at, duration_seconds, raw_payload)
       values ($1, $2, $3, 'walking', $4::timestamptz - interval '3 minutes', $5::timestamptz + interval '3 minutes', 1200,
         '{"workoutType":"walking"}'::jsonb) returning id`,
      [WORKSPACE_ID, USER_ID, `db-auto-walk-${id}`, walk[2].occurredAt, walk[6].occurredAt])).rows[0].id;
    const replayWalk = () => replayRetainedLocationEvidence({ deviceId: DEVICE_ID, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      rolloutMode: "v2_review", semanticModeAcknowledgedAt: walk[0].occurredAt }, session, PROCESSING_AT);
    // Replay keeps the logged walk's event in step with the walk it re-emits (mode and window), so
    // later checks never judge a stale copy (Codex r4 on #462).
    await pool.query(`update activity_events set raw_payload = raw_payload || '{"travelMode":"running","startedAt":"2000-01-01T00:00:00.000Z"}'::jsonb
      where workspace_id = $1 and user_id = $2 and event_type = 'commute_detected' and review_status = 'confirmed'`, [WORKSPACE_ID, USER_ID]);
    await replayWalk();
    const aligned = (await pool.query<{ mode: string | null; startedAt: string | null; blockStart: Date }>(
      `select ae.raw_payload ->> 'travelMode' as mode, ae.raw_payload ->> 'startedAt' as "startedAt", te.started_at as "blockStart"
       from activity_events ae join time_entries te on te.created_from_event_id = ae.id
       where ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type = 'commute_detected' and te.source = 'location_auto_log'`,
      [WORKSPACE_ID, USER_ID])).rows;
    assert.equal(aligned.length, 1, "The logged walk lost its block.");
    assert.equal(aligned[0].mode, "walking", "Replay left a stale mode on the logged walk's event.");
    assert.equal(Date.parse(aligned[0].startedAt!), aligned[0].blockStart.getTime(), "Replay left a stale window on the logged walk's event.");
    // The import alone (no location call) removes it, by the Move's own window (Codex r2 on #462).
    const imported = await addWalkWorkout("imported");
    assert.equal(await reconcileHealthCoveredMoveCardsNow(session, { now: PROCESSING_AT }), 1, "A Health import did not remove the walk's own block.");
    assert.equal((await moveBlocks()).length, 0, "A later Health walk left the walk's own block.");
    await pool.query("delete from health_workouts where id = $1", [imported]);
    await replayWalk();
    assert.equal((await moveBlocks()).length, 1, "The walk did not log itself again when its Health workout went.");
    // Replay does the same when the workout arrived without an import reconciling it.
    const replayed = await addWalkWorkout("replayed");
    await replayWalk();
    assert.equal((await moveBlocks()).length, 0, "Replay left a walk's own block under a later Health walk.");
    assert.equal((await moveCards()).length, 0, "A walk a Health workout covers was offered in Review.");
    await pool.query("delete from health_workouts where id = $1", [replayed]);
    await replayWalk();
    assert.equal((await moveBlocks()).length, 1, "The walk did not log itself again after the replayed case.");
    console.info("Automatic Moves validated");
  } finally {
    await clearDerivedLocationState();
    await pool.query("delete from location_name_patterns where workspace_id = $1", [WORKSPACE_ID]);
    await pool.query("delete from health_workouts where workspace_id = $1 and external_sample_id like 'db-auto-walk%'", [WORKSPACE_ID]);
    await setSwitch(true);
  }
}

async function validateReviewModeAutoLogPlaces() {
  const fixture = locationAcceptanceFixture();
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const reviewBatch = batch("db-auto-log-places", fixture.evidence, "v2_review", fixture.evidence[0].occurredAt);
  const autoEntries = async () => (await pool.query<{
    id: string; placeId: string | null; eventId: string | null; startedAt: Date; stoppedAt: Date | null;
    reviewStatus: string; eventStatus: string | null; userEditedAt: Date | null;
  }>(
    `select te.id, te.place_id as "placeId", te.created_from_event_id as "eventId",
            te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.review_status as "reviewStatus",
            ae.review_status as "eventStatus", te.user_edited_at as "userEditedAt"
     from time_entries te left join activity_events ae on ae.id = te.created_from_event_id
     where te.workspace_id = $1 and te.user_id = $2 and te.source = 'location_auto_log'
     order by te.started_at`,
    [WORKSPACE_ID, USER_ID]
  )).rows;
  const setAutoLog = (on: boolean, placeIds = LOCATION_ACCEPTANCE_PLACES.map((place) => place.id)) =>
    pool.query("update places set auto_log = $3 where workspace_id = $1 and id = any($2::uuid[])", [WORKSPACE_ID, placeIds, on]);
  // Why a card at a place came to Review (location v3 bug 8): its stored semanticReason.
  const cardReasons = async (placeId: string | null, startedAt?: Date) => (await pool.query<{ reason: string | null }>(
    `select ae.raw_payload ->> 'semanticReason' as reason
     from review_items ri join activity_events ae on ae.id = ri.event_id
     where ri.workspace_id = $1 and ri.user_id = $2 and ri.status = 'open' and ri.suggested_place_id = $3
       and ($4::timestamptz is null or ri.suggested_started_at = $4)`,
    [WORKSPACE_ID, USER_ID, placeId, startedAt ?? null])).rows.map((row) => row.reason);
  const renameStay = async (entry: { eventId: string | null }, suffix: string) => {
    // What replay sees when a later run no longer produces this stay under its ID (its boundaries
    // moved, or it vanished): the persisted row and its event under an ID the engine never emits.
    await pool.query(
      `update stay_segments set client_segment_id = client_segment_id || $4
       where workspace_id = $1 and user_id = $2 and created_from_event_id = $3`, [WORKSPACE_ID, USER_ID, entry.eventId, suffix]);
    await pool.query(
      `update activity_events set client_event_id = client_event_id || $4
       where workspace_id = $1 and user_id = $2 and id = $3`, [WORKSPACE_ID, USER_ID, entry.eventId, suffix]);
  };

  // The switch's stored guard (Codex r2 on #434): it turns on only while logging is on, a request that
  // leaves logging alone reads the stored value, and a save without it keeps it.
  const guarded = LOCATION_ACCEPTANCE_PLACES[0].id;
  await updatePlace(guarded, { loggingEnabled: false }, session);
  assert.equal((await updatePlace(guarded, { autoLog: true }, session))?.autoLog, false, "Log automatically turned on while logging was off.");
  assert.equal((await updatePlace(guarded, { loggingEnabled: true, autoLog: true }, session))?.autoLog, true, "Log automatically did not turn on with logging.");
  assert.equal((await updatePlace(guarded, { name: LOCATION_ACCEPTANCE_PLACES[0].name }, session))?.autoLog, true, "A save without Log automatically changed it.");
  assert.equal((await updatePlace(guarded, { loggingEnabled: false }, session))?.autoLog, false, "Turning logging off left Log automatically on.");
  await updatePlace(guarded, { loggingEnabled: true }, session);

  // Baseline: with the switch off, trusted stays are Review cards and nothing is auto-logged.
  await clearDerivedLocationState();
  await setAutoLog(false);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.equal((await autoEntries()).length, 0, "A place without Log automatically logged a visit.");
  const reviewOnlyCount = await count("review_items");
  for (const place of LOCATION_ACCEPTANCE_PLACES) {
    const reasons = await cardReasons(place.id);
    assert(reasons.every((reason) => reason === "auto_log_off"),
      `A visit card at a place with Log automatically off said ${reasons.join(", ")}, not that the switch is off.`);
  }

  // On: trusted stays become blocks, never Review cards; their events are confirmed.
  await clearDerivedLocationState();
  await setAutoLog(true);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const logged = await autoEntries();
  assert(logged.length > 0, "Log automatically created no block for a trusted stay.");
  assert(logged.every((entry) => entry.placeId && entry.reviewStatus === "confirmed" && entry.eventStatus === "confirmed"),
    "An auto-logged block lacks its place or a confirmed event.");
  const loggedReviews = await pool.query(
    "select 1 from review_items where workspace_id = $1 and user_id = $2 and event_id = any($3::uuid[])",
    [WORKSPACE_ID, USER_ID, logged.map((entry) => entry.eventId)]);
  assert.equal(loggedReviews.rowCount, 0, "An auto-logged visit also created a Review card.");
  assert.equal(await count("review_items"), reviewOnlyCount - logged.length,
    "Log automatically did not replace exactly the trusted stays' Review cards.");
  const confirmedStays = await pool.query(
    "select 1 from stay_segments where workspace_id = $1 and user_id = $2 and review_status = 'confirmed' and created_from_event_id = any($3::uuid[])",
    [WORKSPACE_ID, USER_ID, logged.map((entry) => entry.eventId)]);
  assert.equal(confirmedStays.rowCount, logged.length, "An auto-logged stay was not marked confirmed.");

  // Retries are idempotent.
  const entryCount = await count("time_entries");
  const reviewCount = await count("review_items");
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.equal(await count("time_entries"), entryCount, "A retry duplicated an auto-logged block.");
  assert.equal(await count("review_items"), reviewCount, "A retry added a Review card for an auto-logged visit.");

  // Archive place after its visits (location v3 PR 15, PRD D19 A10; Codex r1 on #503): replay keeps
  // matching it for evidence before it was archived, so its unedited blocks and their visits stay as
  // they were and no Review card appears for them.
  const archivedPlaceId = logged[0].placeId!;
  await pool.query("update places set archived_at = $3 where workspace_id = $1 and id = $2", [WORKSPACE_ID, archivedPlaceId, PROCESSING_AT]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const afterArchive = await autoEntries();
  assert.deepEqual(afterArchive.map((entry) => [entry.id, entry.eventId, entry.placeId, entry.startedAt.toISOString()]),
    logged.map((entry) => [entry.id, entry.eventId, entry.placeId, entry.startedAt.toISOString()]),
    "Archiving a place moved, re-linked or removed its past auto-logged blocks on replay.");
  assert.equal(await count("review_items"), reviewCount, "Archiving a place brought its past visits back to Review.");
  // Replace the old place (Codex r2 on #503): a new place on the same spot, matching from the
  // moment it replaced the old one, leaves those blocks with the old place too.
  const successorId = "c0000000-0000-4000-8000-0000000000aa";
  await pool.query(
    `insert into places (id, workspace_id, name, latitude, longitude, radius_meters, priority, logging_enabled, auto_log, matching_starts_at)
     select $3, workspace_id, 'Replacement', latitude, longitude, radius_meters, priority + 1, logging_enabled, auto_log, $4
       from places where workspace_id = $1 and id = $2`, [WORKSPACE_ID, archivedPlaceId, successorId, PROCESSING_AT]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.deepEqual((await autoEntries()).map((entry) => [entry.id, entry.eventId, entry.placeId, entry.startedAt.toISOString()]),
    logged.map((entry) => [entry.id, entry.eventId, entry.placeId, entry.startedAt.toISOString()]),
    "A place that replaced an archived one took over the old place's past auto-logged blocks on replay.");
  assert.equal(await count("review_items"), reviewCount, "Replacing a place brought its past visits back to Review.");
  await pool.query("delete from places where workspace_id = $1 and id = $2", [WORKSPACE_ID, successorId]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  await pool.query("update places set archived_at = null where workspace_id = $1 and id = $2", [WORKSPACE_ID, archivedPlaceId]);

  // A late fix that keeps the stay's ID but moves a boundary: the unedited block follows (Codex r1 on #435).
  await pool.query("update time_entries set stopped_at = stopped_at - interval '3 minutes' where id = $1", [logged[1].id]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const sameId = (await autoEntries()).find((entry) => entry.id === logged[1].id);
  assert(sameId && sameId.stoppedAt?.toISOString() === logged[1].stoppedAt?.toISOString() && sameId.eventId === logged[1].eventId,
    "A block whose stay kept its ID did not follow the stay's boundaries.");

  // A replay that moves an unedited visit moves the same block to the new boundaries.
  const moved = logged[0];
  await pool.query("update time_entries set started_at = started_at - interval '7 minutes' where id = $1", [moved.id]);
  await renameStay(moved, ":moved");
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const afterMove = await autoEntries();
  const followed = afterMove.find((entry) => entry.id === moved.id);
  assert(followed, "Replay removed an unedited block instead of moving it with its visit.");
  assert.equal(followed.startedAt.toISOString(), moved.startedAt.toISOString(), "The moved block did not take the visit's boundaries.");
  assert.notEqual(followed.eventId, moved.eventId, "The moved block was not re-linked to the replacement visit.");
  assert.equal(afterMove.length, logged.length, "Moving a visit changed the number of auto-logged blocks.");
  assert.equal(await count("review_items"), reviewCount, "Moving an auto-logged visit created a Review card.");

  // A replay whose visit is not logged again (here: the switch is now off) removes the unedited block.
  const vanished = afterMove[0];
  await setAutoLog(false, [vanished.placeId!]);
  await renameStay(vanished, ":vanished");
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const afterVanish = await autoEntries();
  assert(!afterVanish.some((entry) => entry.id === vanished.id), "Replay kept the unedited block of a visit it no longer logs.");
  await setAutoLog(true, [vanished.placeId!]);

  // An edited block is the person's: replay never moves or removes it.
  await clearDerivedLocationState();
  await setAutoLog(true);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const edited = (await autoEntries())[0];
  await pool.query("update time_entries set user_edited_at = now(), description = 'Mine now' where id = $1", [edited.id]);
  await renameStay(edited, ":edited");
  const before = await count("time_entries");
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const kept = (await pool.query<{ startedAt: Date; description: string }>(
    "select started_at as \"startedAt\", description from time_entries where id = $1", [edited.id])).rows[0];
  assert(kept && kept.description === "Mine now" && kept.startedAt.toISOString() === edited.startedAt.toISOString(),
    "Replay changed an edited auto-logged block.");
  assert.equal(await count("time_entries"), before, "Replay re-logged a visit whose block the person edited.");

  // A deleted block is a decision too: replay never logs that visit again.
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const deleted = (await autoEntries())[0];
  await pool.query("delete from time_entries where id = $1", [deleted.id]);
  const afterDelete = await count("time_entries");
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.equal(await count("time_entries"), afterDelete, "Replay re-logged a visit whose block the person deleted.");

  // A visit offered in Review before keeps being a card when its stay is replaced under a new ID,
  // even after Log automatically is turned on (Codex r1 on #435).
  await clearDerivedLocationState();
  await setAutoLog(false);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const offered = (await pool.query<{ eventId: string; placeId: string; startedAt: Date }>(
    `select ri.event_id as "eventId", ri.suggested_place_id as "placeId", ri.suggested_started_at as "startedAt"
     from review_items ri where ri.workspace_id = $1 and ri.user_id = $2 and ri.suggested_place_id = $3
       and ri.suggested_started_at = $4`,
    [WORKSPACE_ID, USER_ID, logged[0].placeId, logged[0].startedAt])).rows[0];
  assert(offered, "The baseline did not offer the trusted visit in Review.");
  await setAutoLog(true);
  await renameStay(offered, ":offered");
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert(!(await autoEntries()).some((entry) => entry.startedAt.toISOString() === logged[0].startedAt.toISOString()),
    "A visit already offered in Review was auto-logged after its stay changed ID.");
  assert.deepEqual(await cardReasons(logged[0].placeId, logged[0].startedAt), ["auto_log_offered_before"],
    "A visit kept in Review because it was offered before did not say so.");
  // Reasons in order (Codex r2 on #450): an overlapping block comes before "offered before", and the
  // card's reason follows the evidence back when the block goes.
  const overlapping = await pool.query<{ id: string }>(
    `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at)
     values ($1, $2, 'manual_app', 'high', 'confirmed', 'Tracked by hand', $3, $4) returning id`,
    [WORKSPACE_ID, USER_ID, logged[0].startedAt, logged[0].stoppedAt]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.deepEqual(await cardReasons(logged[0].placeId, logged[0].startedAt), ["auto_log_overlap"],
    "An overlapping block did not come before offered-before as the card's reason.");
  await pool.query("delete from time_entries where id = $1", [overlapping.rows[0].id]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.deepEqual(await cardReasons(logged[0].placeId, logged[0].startedAt), ["auto_log_offered_before"],
    "A card's reason did not follow its overlap away.");
  const steadyOffered = await ingestAndReplayLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.equal(steadyOffered.replay.semanticChangeCount, 0, "An identical replay of an offered-before card reported changes.");

  // Ageing evidence: a stay older than retention less a day is never reconciled, so a visit that
  // expiring evidence can no longer rebuild keeps its block (Codex r1 on #435).
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const aged = (await autoEntries())[0];
  const sixDaysLater = new Date(Date.parse(PROCESSING_AT) + 6.25 * 86_400_000).toISOString();
  // The visit's earlier evidence has expired and only its last sample is retained, so replay can no
  // longer rebuild it (as Codex reproduced with the fixture's short stop).
  await pool.query(
    `update location_evidence le set expires_at = $4::timestamptz - interval '1 hour'
     from location_segment_evidence lse join stay_segments st on st.id = lse.stay_segment_id
     where lse.evidence_id = le.id and st.workspace_id = $1 and st.user_id = $2 and st.created_from_event_id = $3
       and le.id <> (select le2.id from location_segment_evidence lse2 join location_evidence le2 on le2.id = lse2.evidence_id
                     where lse2.stay_segment_id = st.id order by le2.occurred_at desc limit 1)`,
    [WORKSPACE_ID, USER_ID, aged.eventId, sixDaysLater]);
  // A replay only (as when evidence ages): ingesting the batch again would store it afresh.
  await replayRetainedLocationEvidence({
    deviceId: reviewBatch.deviceId,
    algorithmVersion: reviewBatch.algorithmVersion,
    rolloutMode: reviewBatch.rolloutMode,
    semanticModeAcknowledgedAt: reviewBatch.semanticModeAcknowledgedAt
  }, session, sixDaysLater);
  assert((await autoEntries()).some((entry) => entry.id === aged.id), "Replay removed the block of a visit older than it can rebuild.");

  // Another mode never reconciles: in v2_enabled an auto-logged stay stays a decision, so a changed ID
  // never adds a second entry beside its block (Codex r1 on #435).
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const enabledKept = (await autoEntries())[0];
  await renameStay(enabledKept, ":enabled");
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_enabled";
  await ingestLocationEvidence(batch("db-auto-log-enabled", fixture.evidence, "v2_enabled", fixture.evidence[0].occurredAt), session, PROCESSING_AT);
  process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  const sameVisit = await pool.query(
    `select 1 from time_entries where workspace_id = $1 and user_id = $2 and place_id = $3
       and started_at < $5 and coalesce(stopped_at, now()) > $4`,
    [WORKSPACE_ID, USER_ID, enabledKept.placeId, enabledKept.startedAt, enabledKept.stoppedAt]);
  assert.equal(sameVisit.rowCount, 1, "Switching to v2_enabled added an entry beside an auto-logged block.");

  // Waits until another session of this database is blocked on a lock (here: replay waiting for a
  // block the holder has), so the interleavings below never depend on timing.
  const waitForLockWait = async (what: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const waiting = await pool.query(
        `select 1 from pg_stat_activity
         where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`);
      if (waiting.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Replay never waited for ${what}.`);
  };

  // Contention (Codex r2/r3 on #435): replay locks every block it may touch in one entry-id-ordered
  // step, so a grouped edit holding the lower block and then taking the higher one never deadlocks
  // with it — here with one retired visit and one same-ID boundary correction in the same replay.
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const [low, high] = (await autoEntries()).slice(0, 2).sort((a, b) => a.id < b.id ? -1 : 1);
  assert(low && high, "The contention check needs two auto-logged blocks.");
  // The retired visit holds the higher block and the same-ID correction the lower one: phase-by-phase
  // locking would hold the higher block while asking for the lower one the holder already has.
  await renameStay(high, ":contended");
  await pool.query("update time_entries set stopped_at = stopped_at - interval '2 minutes' where id = $1", [low.id]);
  const holder = await pool.connect();
  try {
    await holder.query("begin");
    await holder.query("select id from time_entries where id = $1 for update", [low.id]);
    const replaying = ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
    await waitForLockWait("the lower block");
    // Replay waits for the lower block before taking the higher one, so this does not wait on replay.
    await holder.query("select id from time_entries where id = $1 for update", [high.id]);
    await holder.query("commit");
    await replaying;
  } finally {
    holder.release();
  }
  const afterContention = await autoEntries();
  const highAfter = afterContention.find((entry) => entry.id === high.id);
  assert(highAfter && highAfter.eventId !== high.eventId && highAfter.eventStatus === "confirmed",
    "Replay under interleaved contention did not move the retired visit's block to its replacement.");
  assert(afterContention.some((entry) => entry.id === low.id && entry.stoppedAt?.toISOString() === low.stoppedAt?.toISOString()),
    "Replay under interleaved contention did not correct the same-ID visit's block.");

  // A deletion landing while replay runs (Codex r3 on #435): replay waits for the block, then sees
  // its visit as the person's decision and never logs the replacement again.
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const raced = (await autoEntries())[0];
  await renameStay(raced, ":raced");
  const deleter = await pool.connect();
  try {
    await deleter.query("begin");
    await deleter.query("delete from time_entries where id = $1", [raced.id]);
    const replaying = ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
    await waitForLockWait("the block being deleted");
    await deleter.query("commit");
    await replaying;
  } finally {
    deleter.release();
  }
  const reLogged = await pool.query(
    `select 1 from time_entries where workspace_id = $1 and user_id = $2 and place_id = $3
       and started_at < $5 and stopped_at > $4`,
    [WORKSPACE_ID, USER_ID, raced.placeId, raced.startedAt, raced.stoppedAt]);
  assert.equal(reLogged.rowCount, 0, "Replay re-logged a visit whose block was deleted while it ran.");
  const reOffered = await pool.query(
    `select 1 from review_items where workspace_id = $1 and user_id = $2 and suggested_place_id = $3
       and suggested_started_at < $5 and suggested_stopped_at > $4`,
    [WORKSPACE_ID, USER_ID, raced.placeId, raced.startedAt, raced.stoppedAt]);
  assert.equal(reOffered.rowCount, 0, "Replay offered a visit in Review again after its block was deleted while it ran.");

  // A newer semantic cutover that suppresses a retired visit's replacement keeps its block: the
  // visit has not vanished (Codex r2 on #435). The old row starts after the cutover; the replacement
  // the engine produces starts before it, so emission does not offer it.
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const suppressed = (await autoEntries())[0];
  await renameStay(suppressed, ":cutover");
  await pool.query(
    `update stay_segments set started_at = started_at + interval '2 minutes'
     where workspace_id = $1 and user_id = $2 and client_segment_id like '%:cutover'`, [WORKSPACE_ID, USER_ID]);
  const laterCutover = new Date(suppressed.startedAt.getTime() + 60_000).toISOString();
  await ingestLocationEvidence(batch("db-auto-log-cutover", fixture.evidence, "v2_review", laterCutover), session, PROCESSING_AT);
  assert((await autoEntries()).some((entry) => entry.id === suppressed.id),
    "Replay removed the block of a visit whose replacement only the cutover held back.");

  // A changed-ID replacement that is not finalised yet keeps the old stay live and linked, so the
  // block follows the replacement once it is finalised (Codex r4 on #435).
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const awaited = (await autoEntries()).at(-1)!;
  assert(awaited.stoppedAt, "The held-replacement check needs a finished block.");
  await renameStay(awaited, ":awaiting");
  const replayRequest = {
    deviceId: reviewBatch.deviceId,
    algorithmVersion: reviewBatch.algorithmVersion,
    rolloutMode: reviewBatch.rolloutMode,
    semanticModeAcknowledgedAt: reviewBatch.semanticModeAcknowledgedAt
  };
  // Inside the finalisation lag: the replacement is closed, not finalised, so Review emission holds it.
  await replayRetainedLocationEvidence(replayRequest, session, new Date(awaited.stoppedAt.getTime() + 60_000).toISOString());
  const held = await pool.query<{ status: string }>(
    `select status from stay_segments where workspace_id = $1 and user_id = $2 and place_id = $3
       and client_segment_id not like '%:awaiting' and status <> 'superseded'
       and started_at < $5 and coalesce(stopped_at, 'infinity') > $4`,
    [WORKSPACE_ID, USER_ID, awaited.placeId, awaited.startedAt, awaited.stoppedAt]);
  assert(held.rows.length > 0 && held.rows.every((row) => row.status !== "finalised"),
    "The held-replacement check did not produce an unfinalised replacement.");
  assert((await autoEntries()).some((entry) => entry.id === awaited.id && entry.eventId === awaited.eventId),
    "Replay detached a block whose replacement was not finalised yet.");
  await replayRetainedLocationEvidence(replayRequest, session, PROCESSING_AT);
  const finalised = (await autoEntries()).find((entry) => entry.id === awaited.id);
  assert(finalised && finalised.eventId !== awaited.eventId && finalised.eventStatus === "confirmed",
    "The block did not follow its replacement once the replacement was finalised.");
  const heldReview = await pool.query(
    `select 1 from review_items where workspace_id = $1 and user_id = $2 and suggested_place_id = $3
       and suggested_started_at < $5 and suggested_stopped_at > $4`,
    [WORKSPACE_ID, USER_ID, awaited.placeId, awaited.startedAt, awaited.stoppedAt]);
  assert.equal(heldReview.rowCount, 0, "A finalised replacement of an auto-logged visit was offered in Review.");

  // A finalised replacement at the block's place takes it even while a stay elsewhere it overlaps is
  // still unfinished (Codex r5 on #435): the fixture's 12:27–12:49 saved visit, its block stretched
  // into the unknown stay from 12:53, replayed when only that unknown stay is still closed.
  await clearDerivedLocationState();
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  const mixed = (await autoEntries()).find((entry) => entry.startedAt.toISOString() === "2026-07-20T12:27:00.000Z");
  assert(mixed?.stoppedAt, "The mixed held-replacement check needs the 12:27 auto-logged visit.");
  await renameStay(mixed, ":mixed");
  await pool.query("update time_entries set stopped_at = '2026-07-20T13:30:00.000Z' where id = $1", [mixed.id]);
  await replayRetainedLocationEvidence(replayRequest, session, "2026-07-20T14:23:30.000Z");
  const unfinished = await pool.query(
    `select 1 from stay_segments where workspace_id = $1 and user_id = $2 and started_at = '2026-07-20T12:53:00.000Z'
       and status not in ('finalised', 'superseded')`, [WORKSPACE_ID, USER_ID]);
  assert.equal(unfinished.rowCount, 1, "The mixed held-replacement check did not leave the overlapping stay unfinished.");
  const taken = (await autoEntries()).find((entry) => entry.id === mixed.id);
  assert(taken && taken.eventId !== mixed.eventId && taken.eventStatus === "confirmed" &&
    taken.stoppedAt?.toISOString() === mixed.stoppedAt.toISOString(),
    "A finalised replacement at the block's place did not take the block while another stay was unfinished.");
  const mixedReview = await pool.query(
    `select 1 from review_items where workspace_id = $1 and user_id = $2 and suggested_place_id = $3
       and suggested_started_at < $5 and suggested_stopped_at > $4`,
    [WORKSPACE_ID, USER_ID, mixed.placeId, mixed.startedAt, mixed.stoppedAt]);
  assert.equal(mixedReview.rowCount, 0, "A finalised replacement was offered in Review because another stay was unfinished.");

  // A stay at an accepted learned place linked to a Log automatically saved place is that saved
  // place, as emission resolves it: its unfinished replacement holds the block (Codex r6 on #435).
  // The fixture's 12:50 stay at an accepted learned place never passes the trusted-stay policy itself,
  // so its auto-logged state is written as emission writes it.
  await clearDerivedLocationState();
  const linkedPlace = LOCATION_ACCEPTANCE_PLACES[4].id;
  const learnedId = "90000000-0000-4000-8000-000000000435";
  await pool.query(
    `insert into learned_places (id, workspace_id, user_id, place_id, cluster_key, name, latitude, longitude, radius_meters,
       first_seen_at, last_seen_at, status, confidence, classification)
     values ($1, $2, $3, $4, 'db-auto-log-learned', 'LEARNED_LINKED', 51.503, 0.08, 120, $5, $5, 'accepted', 'high', 'place_candidate')
     on conflict (id) do update set place_id = excluded.place_id, status = 'accepted'`,
    [learnedId, WORKSPACE_ID, USER_ID, linkedPlace, PROCESSING_AT]);
  try {
    await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
    const learnedStay = (await pool.query<{ id: string; eventId: string; startedAt: Date; stoppedAt: Date }>(
      `select id, created_from_event_id as "eventId", started_at as "startedAt", stopped_at as "stoppedAt"
       from stay_segments where workspace_id = $1 and user_id = $2 and learned_place_id = $3
         and status = 'finalised' and created_from_event_id is not null`,
      [WORKSPACE_ID, USER_ID, learnedId])).rows[0];
    assert(learnedStay, "The learned-place check needs a finalised stay at the learned place.");
    await pool.query("delete from review_items where workspace_id = $1 and user_id = $2 and event_id = $3", [WORKSPACE_ID, USER_ID, learnedStay.eventId]);
    await pool.query(
      `update activity_events set review_status = 'confirmed',
         raw_payload = raw_payload || '{"semanticDisposition":"auto_logged","semanticReason":"place_auto_log"}'::jsonb
       where workspace_id = $1 and user_id = $2 and id = $3`, [WORKSPACE_ID, USER_ID, learnedStay.eventId]);
    await pool.query("update stay_segments set review_status = 'confirmed' where id = $1", [learnedStay.id]);
    const learnedBlock = (await pool.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, place_id,
         created_from_event_id, started_at, stopped_at)
       values ($1, $2, 'location_auto_log', 'high', 'confirmed', null, $3, $4, $5, $6) returning id`,
      [WORKSPACE_ID, USER_ID, linkedPlace, learnedStay.eventId, learnedStay.startedAt, learnedStay.stoppedAt])).rows[0];
    await renameStay({ eventId: learnedStay.eventId }, ":learned");
    // The replacement at the learned place is still open at 14:23:30.
    await replayRetainedLocationEvidence(replayRequest, session, "2026-07-20T14:23:30.000Z");
    const openLearned = await pool.query(
      `select 1 from stay_segments where workspace_id = $1 and user_id = $2 and learned_place_id = $3
         and client_segment_id not like '%:learned' and status not in ('finalised', 'superseded')`,
      [WORKSPACE_ID, USER_ID, learnedId]);
    assert.equal(openLearned.rowCount, 1, "The learned-place check did not leave the replacement unfinished.");
    assert((await autoEntries()).some((entry) => entry.id === learnedBlock.id && entry.eventId === learnedStay.eventId),
      "Replay retired a block whose unfinished replacement is at a learned place linked to its saved place.");
  } finally {
    await pool.query("delete from learned_places where id = $1", [learnedId]);
  }

  // A block that ran for over a week and then stopped still overlaps a visit inside it (Codex r2 on #435).
  await clearDerivedLocationState();
  await pool.query(
    `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at)
     values ($1, $2, 'manual_app', 'high', 'confirmed', 'Left running', $3::timestamptz - interval '8 days', $4)`,
    [WORKSPACE_ID, USER_ID, logged[0].startedAt, logged[0].stoppedAt]);
  await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert(!(await autoEntries()).some((entry) => entry.startedAt.toISOString() === logged[0].startedAt.toISOString()),
    "A visit inside a block that ran for over a week was auto-logged.");

  // Fallbacks to Review: tracked time overlapping the visit, or a timer running during it.
  for (const [label, stoppedAt] of [["an overlapping block", "visit"], ["a running timer", null]] as const) {
    await clearDerivedLocationState();
    await pool.query(
      `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at)
       values ($1, $2, 'manual_app', 'high', 'confirmed', 'Existing tracked time', $3, $4)`,
      [WORKSPACE_ID, USER_ID, logged[0].startedAt, stoppedAt === "visit" ? logged[0].stoppedAt : null]);
    await ingestLocationEvidence(reviewBatch, session, PROCESSING_AT);
    const blocked = await pool.query(
      `select 1 from review_items where workspace_id = $1 and user_id = $2 and suggested_place_id = $3
         and suggested_started_at = $4`,
      [WORKSPACE_ID, USER_ID, logged[0].placeId, logged[0].startedAt]);
    assert.equal(blocked.rowCount, 1, `A visit overlapping ${label} was logged instead of going to Review.`);
    assert(!(await autoEntries()).some((entry) => entry.startedAt.toISOString() === logged[0].startedAt.toISOString()),
      `A visit overlapping ${label} was auto-logged.`);
    assert.deepEqual(await cardReasons(logged[0].placeId, logged[0].startedAt), ["auto_log_overlap"],
      `A visit overlapping ${label} did not say it overlaps a block.`);
  }
  // With every reason recorded, an identical replay changes nothing the app shows (Codex r1 on #450).
  const steady = await ingestAndReplayLocationEvidence(reviewBatch, session, PROCESSING_AT);
  assert.equal(steady.replay.semanticChangeCount, 0, "An identical replay with Log automatically fallbacks reported changes.");
  await setAutoLog(false);
}

async function main() {
  try {
    if (process.argv.includes("--saved-place-quality-only")) {
      await validateSavedPlaceQuality();
      await validateSavedPlaceArrivalBoundaries();
      return;
    }
    await validateSavedPlaceQuality();
    await validateSavedPlaceArrivalBoundaries();
    await seedOwner();
    await validateCommuteCategoryConcurrency();
    await validateOutOfOrderAndIdempotency();
    await validateIngestPerReadingFailures();
    await validateMotionActivityEvidence();
    await validateMotionOnlyReviewRetirement();
    await validateTimeAwayReview();
    await validateLearnedNames();
    await validateLearnedNameCorrections();
    await validatePlaceDeleteWithSamePlaceJourneys();
    await validateHealthWalksWin();
    await validateShadowToReviewCutover();
    await validateSemanticIdempotencyAndRollback();
    await validateCommuteReviewCategoryAndDescription();
    await validateRecentOwnerAuthoredSignal();
    await validateRecentTitleHistoryAcrossReplay();
    await validateReviewModeAutoLogPlaces();
    await validateReviewModeAutoMoves();
    await validateSavePlace();
    await validateOutingCards();
    await validateOutingCountPlans();
    await validateEnabledTrustedPlaceAutomation();
    await validateEnabledTrustedCommuteAutomation();
    await validateFinalisationWithoutNewEvidence();
    await validateSupersededReviewReactivation();
    await validateV1Compatibility();
    console.log("Location V2 database validation passed: ordered replay, duplicate ingest, per-reading ingest failures (deleted places, out-of-window times), coordinate-free Motion & Fitness evidence, time away from a saved place, learned names for Stays and Moves (corrections, splits, merges, bands), deleting a place with same-place journeys, Health walks winning over the Moves they cover, shadow cutover, no-new-evidence finalisation, semantic idempotency, Commute category concurrency/emission/replay/confirmation, uncertainty bounds, description semantics, isolation, trusted-place and trusted-commute automation, Moves that log themselves in Review mode (the switch, overlap and stopped-pattern fallbacks, replay moving the block), per-place Log automatically in Review mode (the stored switch guard, blocks instead of Review, overlap and running-timer fallbacks and the reason each card stores, idempotency, same-ID and changed-ID moves, removal with a vanished visit, earlier Review cards kept, ageing evidence, cutover-held and not-yet-finalised replacements and v2_enabled never removing a block, a finalised replacement taking its block beside an unfinished stay elsewhere, learned places linked to a saved place holding it, week-long blocks overlapping, interleaved entry-lock contention, edited and deleted blocks kept, including a deletion landing mid-replay), deliberate advisory/Review-row/exact-segment contention bounds, overlap fallback, terminal-decision preservation, superseded-Review reactivation, automatic-entry deletion safety, automatic-entry idempotency, atomic rollback, concurrent retry, split, merge, incompatible-merge rejection, the Recent owner-authored signal for every Review decision path and across replay retitles, and V1 compatibility.");
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
