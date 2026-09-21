import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { Session as InspectorSession } from "node:inspector/promises";
import { LOCATION_ENGINE_V2_CONFIG, type LocationEvidence } from "@dayframe/shared";
import type {
  LocationObservation,
  LocationTimingCount,
  LocationTimingEvent
} from "../apps/web/src/lib/location/location-sync-diagnostics";
import {
  changedReplayEvidence,
  highSegmentReplayEvidence,
  REPLAY_SCALABILITY_CLOCK,
  REPLAY_SCALABILITY_CUTOVER,
  REPLAY_SCALABILITY_DEVICE,
  REPLAY_SCALABILITY_PLACE_A,
  REPLAY_SCALABILITY_PLACE_B,
  REPLAY_SCALABILITY_S1_DAYS,
  REPLAY_SCALABILITY_S3_DAYS,
  REPLAY_SCALABILITY_TRIPS_PER_DAY,
  replayScalabilityHistory,
  type ReplayScalabilityPlaceIds
} from "./fixtures/location-replay-scalability";
import type { RequestSession } from "../apps/web/src/lib/session";

/**
 * Finite, opt-in, local-only retained-replay evidence. The `base` mode is a
 * test-only legacy persistence adapter: it keeps the current Review emitter
 * and transaction owner but leaves the new profile unset so before/after
 * counts are comparable without adding a production switch.
 */
const LOCAL_LOOPBACK = new Set(["127.0.0.1", "localhost"]);
const REQUEST_DEADLINE_MS = 8_000;
const AUTH_COST_MS = 500;
const S1_ONLY = process.argv.includes("--s1-only");
const QUERY_PLAN_ONLY = process.argv.includes("--query-plan-only");
const STATEMENT_DIAGNOSTICS = process.argv.includes("--diagnose-statements");
const SOURCE = process.argv.find((value) => value.startsWith("--source="))?.split("=", 2)[1] ?? "candidate";
assert(SOURCE === "base" || SOURCE === "candidate", "Use --source=base or --source=candidate.");

function validatedTarget() {
  const raw = process.env.DATABASE_URL;
  assert(raw, "Explicit DATABASE_URL is required; no .env fallback is allowed.");
  const url = new URL(raw);
  assert(LOCAL_LOOPBACK.has(url.hostname), "Scalability validation requires a loopback DATABASE_URL.");
  assert(url.port === "54323", "Scalability validation requires PostgreSQL port 54323.");
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  assert(databaseName.endsWith("_test"), "Scalability validation requires a disposable *_test database.");
  assert(!url.search || url.search === "", "Scalability validation does not accept DATABASE_URL query overrides.");
  return { raw, databaseName };
}

let target!: ReturnType<typeof validatedTarget>;
let targetError: unknown;
try {
  target = validatedTarget();
} catch (error) {
  targetError = error;
}
let database!: pg.Pool;

type LocationDiagnosticsModule = typeof import("../apps/web/src/lib/location/location-sync-diagnostics");
type LocationBatchingModule = typeof import("../apps/web/src/lib/location/location-replay-batching");
let observeLocationStage!: LocationDiagnosticsModule["observeLocationStage"];
let observeLocationTiming!: LocationDiagnosticsModule["observeLocationTiming"];
let segmentStartedAfterSemanticCutover!: typeof import("../apps/web/src/lib/location/location-rollout")["segmentStartedAfterSemanticCutover"];
let jsonParameterBytes!: LocationBatchingModule["jsonParameterBytes"];
let locationProtectedEvidenceIdBatchSize!: LocationBatchingModule["LOCATION_PROTECTED_EVIDENCE_ID_BATCH_SIZE"];
let locationProtectedEvidenceIdPayloadMaxBytes!: LocationBatchingModule["LOCATION_PROTECTED_EVIDENCE_ID_PAYLOAD_MAX_BYTES"];
let locationLineageInsertBatchSize!: LocationBatchingModule["LOCATION_LINEAGE_INSERT_BATCH_SIZE"];
let locationLineageInsertPayloadMaxBytes!: LocationBatchingModule["LOCATION_LINEAGE_INSERT_PAYLOAD_MAX_BYTES"];

async function loadApplicationRuntime() {
  const diagnostics = await import("../apps/web/src/lib/location/location-sync-diagnostics");
  const batching = await import("../apps/web/src/lib/location/location-replay-batching");
  observeLocationStage = diagnostics.observeLocationStage;
  observeLocationTiming = diagnostics.observeLocationTiming;
  ({ segmentStartedAfterSemanticCutover } = await import("../apps/web/src/lib/location/location-rollout"));
  jsonParameterBytes = batching.jsonParameterBytes;
  locationProtectedEvidenceIdBatchSize = batching.LOCATION_PROTECTED_EVIDENCE_ID_BATCH_SIZE;
  locationProtectedEvidenceIdPayloadMaxBytes = batching.LOCATION_PROTECTED_EVIDENCE_ID_PAYLOAD_MAX_BYTES;
  locationLineageInsertBatchSize = batching.LOCATION_LINEAGE_INSERT_BATCH_SIZE;
  locationLineageInsertPayloadMaxBytes = batching.LOCATION_LINEAGE_INSERT_PAYLOAD_MAX_BYTES;
}

type Source = "base" | "candidate";
type Scenario = "first-success" | "stable" | "changed-input";
type AttemptOptions = {
  databasePool: Pick<pg.Pool, "connect">;
  deadlineAt: number;
  cleanupReserveMs: number;
  onLocationStage: (stage: Parameters<NonNullable<LocationObservation["onLocationStage"]>>[0]) => void;
  onLocationTiming: (event: LocationTimingEvent) => void;
  onLocationCount: (name: LocationTimingCount, value: number) => void;
  onSyncTiming: (event: { stage: "connection_acquisition" | "transaction_configuration" | "transaction_commit"; state: "started" | "completed"; remainingMs: number }) => void;
};

type DriverCapture = {
  timing: Record<string, { startedAt: number; elapsedMs: number | null; completed: boolean; remainingMsAtStart: number | null; remainingMsAfter: number | null; calls: number; driverMs: number }>;
  activeTimingStage: string | null;
  calls: number;
  timeoutConfigurationCalls: number;
  protectionQueryBatches: number;
  protectionEvidenceIds: number;
  protectedEvidenceBatchSizes: number[];
  protectedEvidenceBatchBytes: number[];
  lineageRequests: number;
  lineageBatchSizes: number[];
  lineageBatchBytes: number[];
  maxLineagePayloadBytes: number;
  maxParameterCount: number;
  maxParameterBytes: number;
  commitReached: boolean;
  remainingWorkBudgetAfterCommit: number | null;
  businessStatements: string[];
  counts: Record<string, number>;
  stages: Record<string, { calls: number; ms: number }>;
  currentStage: string;
  lastStageAt: number;
};

type MeasuredPoolHooks = {
  onBeforeDispatch?: (statement: string, params: unknown[]) => void;
  onAfterDispatch?: (statement: string, params: unknown[]) => void;
};

type OwnerFixture = {
  session: RequestSession;
  placeIds: ReplayScalabilityPlaceIds;
};

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizedSql(value: unknown) {
  return String(value).replace(/\s+/g, " ").trim();
}

function isTimeoutConfiguration(sql: string) {
  return /\b(?:statement_timeout|lock_timeout|set_config)\b/i.test(sql);
}

function isTransactionScaffolding(sql: string) {
  return /^\s*(?:begin|commit|rollback)\b/i.test(sql) ||
    /current_setting\('\s*transaction_timeout|set_config\('\s*application_name/i.test(sql);
}

function isLineageInsertStatement(sql: string) {
  return /^insert into location_segment_evidence/i.test(sql) && sql.includes("jsonb_to_recordset");
}

function isLineageDeleteStatement(sql: string) {
  return /^delete from location_segment_evidence/i.test(sql);
}

function createCapture(): DriverCapture {
  const now = performance.now();
  return {
    timing: {},
    activeTimingStage: null,
    calls: 0,
    timeoutConfigurationCalls: 0,
    protectionQueryBatches: 0,
    protectionEvidenceIds: 0,
    protectedEvidenceBatchSizes: [],
    protectedEvidenceBatchBytes: [],
    lineageRequests: 0,
    lineageBatchSizes: [],
    lineageBatchBytes: [],
    maxLineagePayloadBytes: 0,
    maxParameterCount: 0,
    maxParameterBytes: 0,
    commitReached: false,
    remainingWorkBudgetAfterCommit: null,
    businessStatements: [],
    counts: {},
    stages: {},
    currentStage: "request_setup",
    lastStageAt: now
  };
}

function captureTiming(capture: DriverCapture, event: LocationTimingEvent) {
  const now = performance.now();
  if (event.state === "started") {
    capture.activeTimingStage = event.stage;
    capture.timing[event.stage] = {
      startedAt: now, elapsedMs: null, completed: false,
      remainingMsAtStart: event.remainingMs ?? null, remainingMsAfter: null,
      calls: 0, driverMs: 0
    };
  } else {
    const stage = capture.timing[event.stage];
    if (stage) {
      stage.elapsedMs = now - stage.startedAt;
      stage.completed = true;
      stage.remainingMsAfter = event.remainingMs ?? null;
    }
    capture.activeTimingStage = null;
  }
}

function timingSnapshot(capture: DriverCapture) {
  const now = performance.now();
  const stages = ["connection_acquisition", "transaction_configuration", "owner_lock", "evidence_read",
    "catalogue_read", "engine_computation", "protected_replacement_checks", "obsolete_segment_handling",
    "stay_persistence", "commute_persistence", "lineage_deletion", "lineage_insertion",
    "semantic_review_persistence", "transaction_commit"];
  return Object.fromEntries(stages.map(name => {
    const stage = capture.timing[name];
    if (!stage) return [name, { elapsedMs: null, completed: false, remainingMsAtStart: null,
      remainingMsAfter: null, calls: 0, driverMs: 0 }];
    return [name, {
      elapsedMs: Math.round(stage.elapsedMs ?? now - stage.startedAt),
      completed: stage.completed,
      remainingMsAtStart: stage.remainingMsAtStart,
      remainingMsAfter: stage.remainingMsAfter,
      calls: stage.calls,
      driverMs: Math.round(stage.driverMs)
    }];
  }));
}

function setCaptureStage(capture: DriverCapture, stage: string) {
  const now = performance.now();
  const elapsed = Math.max(0, now - capture.lastStageAt);
  const current = capture.stages[capture.currentStage] ?? { calls: 0, ms: 0 };
  current.ms += elapsed;
  capture.stages[capture.currentStage] = current;
  capture.currentStage = stage;
  capture.lastStageAt = now;
}

function createMeasuredPool(
  delayMs: number,
  capture: DriverCapture,
  hooks: MeasuredPoolHooks = {}
): Pick<pg.Pool, "connect"> {
  return {
    connect: async () => {
      const raw = await database.connect();
      let released = false;
      return new Proxy(raw, {
        get(client, property) {
          if (property === "query") {
            return async (sqlOrConfig: unknown, values?: unknown[]) => {
              const sql = typeof sqlOrConfig === "string"
                ? sqlOrConfig
                : (sqlOrConfig as { text?: string })?.text ?? "[query-config]";
              const params = values ?? (sqlOrConfig as { values?: unknown[] })?.values ?? [];
              const statement = normalizedSql(sql);
              capture.calls += 1;
              const detailedStage = capture.activeTimingStage ? capture.timing[capture.activeTimingStage] : undefined;
              if (detailedStage) detailedStage.calls += 1;
              const stage = capture.stages[capture.currentStage] ?? { calls: 0, ms: 0 };
              stage.calls += 1;
              capture.stages[capture.currentStage] = stage;
              if (isTimeoutConfiguration(statement)) capture.timeoutConfigurationCalls += 1;
              if (statement.includes("for update of s")) {
                capture.protectionQueryBatches += 1;
                const ids = params[4];
                if (Array.isArray(ids)) {
                  capture.protectionEvidenceIds += ids.length;
                  capture.protectedEvidenceBatchSizes.push(ids.length);
                  capture.protectedEvidenceBatchBytes.push(jsonParameterBytes(ids));
                }
              }
              if (/^insert into location_segment_evidence/i.test(statement)) {
                capture.lineageRequests += 1;
                const payload = statement.includes("jsonb_to_recordset") ? params[2] : undefined;
                if (typeof payload === "string") capture.maxLineagePayloadBytes = Math.max(
                  capture.maxLineagePayloadBytes,
                  Buffer.byteLength(payload, "utf8")
                );
                if (typeof payload === "string") {
                  capture.lineageBatchBytes.push(Buffer.byteLength(payload, "utf8"));
                  try {
                    const rows = JSON.parse(payload);
                    capture.lineageBatchSizes.push(Array.isArray(rows) ? rows.length : -1);
                  } catch {
                    capture.lineageBatchSizes.push(-1);
                  }
                }
              }
              capture.maxParameterCount = Math.max(capture.maxParameterCount, params.length);
              capture.maxParameterBytes = Math.max(capture.maxParameterBytes, Buffer.byteLength(JSON.stringify(params), "utf8"));
              if (!isTimeoutConfiguration(statement) && !isTransactionScaffolding(statement)) {
                capture.businessStatements.push(statement);
              }
              await sleep(delayMs);
              if (released) throw new Error("Measured client was released before query dispatch.");
              hooks.onBeforeDispatch?.(statement, params);
              const query = client.query.bind(client) as (query: unknown, values?: unknown[]) => Promise<pg.QueryResult>;
              const driverStartedAt = performance.now();
              let result: pg.QueryResult;
              try {
                result = values === undefined ? await query(sqlOrConfig) : await query(sqlOrConfig, values);
              } finally {
                if (detailedStage) detailedStage.driverMs += performance.now() - driverStartedAt;
              }
              hooks.onAfterDispatch?.(statement, params);
              if (/^commit\b/i.test(statement)) {
                capture.commitReached = true;
              }
              return result;
            };
          }
          if (property === "release") {
            return (destroy?: boolean) => {
              released = true;
              client.release(destroy);
            };
          }
          const value = Reflect.get(client, property);
          return typeof value === "function" ? value.bind(client) : value;
        }
      });
    }
  };
}

function maxBatchValue(values: number[]) {
  return values.length === 0 ? 0 : Math.max(...values);
}

function assertCandidateBatchBounds(capture: DriverCapture, context: string) {
  assert(
    capture.protectedEvidenceBatchSizes.every((size) => Number.isSafeInteger(size) && size >= 0 && size <= locationProtectedEvidenceIdBatchSize),
    `${context}: protected provenance item cap exceeded`
  );
  assert(
    capture.protectedEvidenceBatchBytes.every((bytes) => Number.isSafeInteger(bytes) && bytes <= locationProtectedEvidenceIdPayloadMaxBytes),
    `${context}: protected provenance payload cap exceeded`
  );
  assert(
    capture.lineageBatchSizes.every((size) => Number.isSafeInteger(size) && size >= 0 && size <= locationLineageInsertBatchSize),
    `${context}: lineage item cap exceeded`
  );
  assert(
    capture.lineageBatchBytes.every((bytes) => Number.isSafeInteger(bytes) && bytes <= locationLineageInsertPayloadMaxBytes),
    `${context}: lineage payload cap exceeded`
  );
}

function assertCandidateCompleteLineage(capture: DriverCapture, context: string) {
  const intended = capture.counts.lineageLinksIntended;
  const prepared = capture.counts.lineageLinksPrepared;
  assert(Number.isSafeInteger(intended) && intended >= 0, `${context}: missing intended lineage counter`);
  assert(Number.isSafeInteger(prepared) && prepared >= 0, `${context}: missing prepared lineage counter`);
  assert.equal(prepared, intended, `${context}: intended/prepared lineage mismatch`);
  assert(capture.commitReached, `${context}: transaction commit was not reached`);
}

function safeFailure(error: unknown) {
  const value = error as { code?: string; sqlState?: string; syncPhase?: string; phase?: string } | null;
  const sqlState = value?.sqlState ?? (/^[0-9A-Z]{5}$/.test(value?.code ?? "") ? value?.code : undefined);
  return {
    name: error instanceof Error ? error.name : "unknown",
    phase: value?.syncPhase ?? value?.phase ?? "unknown",
    ...(sqlState ? { sqlState } : {}),
    ...(error instanceof Error && error.name === "AssertionError" ? { message: error.message } : {})
  };
}

async function createOwner(): Promise<OwnerFixture> {
  const session: RequestSession = {
    workspaceId: randomUUID(),
    userId: randomUUID(),
    authMode: "token",
    scopes: ["app:read", "app:write", "events:write"]
  };
  const placeIds = { placeAId: randomUUID(), placeBId: randomUUID() };
  await database.query("insert into users(id,email,name) values($1,$2,$3)", [session.userId, `${session.userId}@example.test`, "Replay scalability synthetic"]);
  await database.query("insert into workspaces(id,name) values($1,$2)", [session.workspaceId, "Replay scalability synthetic"]);
  await database.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')", [session.workspaceId, session.userId]);
  await database.query(
    `insert into places(id,workspace_id,name,latitude,longitude,radius_meters,priority,logging_enabled)
     values ($1,$2,$3,$4,$5,$6,5,true),($7,$2,$8,$9,$10,$11,5,true)`,
    [
      placeIds.placeAId, session.workspaceId, REPLAY_SCALABILITY_PLACE_A.name,
      REPLAY_SCALABILITY_PLACE_A.latitude, REPLAY_SCALABILITY_PLACE_A.longitude, REPLAY_SCALABILITY_PLACE_A.radiusMeters,
      placeIds.placeBId, REPLAY_SCALABILITY_PLACE_B.name,
      REPLAY_SCALABILITY_PLACE_B.latitude, REPLAY_SCALABILITY_PLACE_B.longitude, REPLAY_SCALABILITY_PLACE_B.radiusMeters
    ]
  );
  return { session, placeIds };
}

async function cleanupOwner(owner: OwnerFixture) {
  await database.query("delete from workspaces where id = $1", [owner.session.workspaceId]);
  await database.query("delete from users where id = $1", [owner.session.userId]);
}

function requestFor() {
  return {
    deviceId: REPLAY_SCALABILITY_DEVICE,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    rolloutMode: "v2_review" as const,
    semanticModeAcknowledgedAt: REPLAY_SCALABILITY_CUTOVER
  };
}

async function uploadEvidence(owner: OwnerFixture, evidence: LocationEvidence[], processingAt: string, suffix: string) {
  const { ingestLocationEvidence } = await import("../apps/web/src/lib/location/location-ingest-service");
  for (let offset = 0; offset < evidence.length; offset += LOCATION_ENGINE_V2_CONFIG.maxEvidenceItemsPerUpload) {
    const chunk = evidence.slice(offset, offset + LOCATION_ENGINE_V2_CONFIG.maxEvidenceItemsPerUpload);
    await ingestLocationEvidence({
      clientBatchId: `scale-${suffix}-${offset}`,
      deviceId: REPLAY_SCALABILITY_DEVICE,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      timeZone: "Europe/London",
      rolloutMode: "v2_review",
      semanticModeAcknowledgedAt: REPLAY_SCALABILITY_CUTOVER,
      evidence: chunk
    }, owner.session, processingAt, { databasePool: database });
  }
}

async function markProtectedHistory(owner: OwnerFixture) {
  await database.query(
    `update stay_segments set continuity_status = 'manual'
     where id in (select id from stay_segments where workspace_id = $1 and user_id = $2 order by client_segment_id limit 12)`,
    [owner.session.workspaceId, owner.session.userId]
  );
  await database.query(
    `update commute_segments set continuity_status = 'manual'
     where id in (select id from commute_segments where workspace_id = $1 and user_id = $2 order by client_segment_id limit 4)`,
    [owner.session.workspaceId, owner.session.userId]
  );
  await database.query(
    `update review_items set status = 'ignored', resolved_at = now()
     where workspace_id = $1 and user_id = $2 and location_segment_id in (
       select id from stay_segments where workspace_id = $1 and user_id = $2 and continuity_status = 'manual'
     )`,
    [owner.session.workspaceId, owner.session.userId]
  );
}

async function markMinimalProtectedHistory(owner: OwnerFixture) {
  await database.query(
    `update stay_segments set continuity_status = 'manual'
     where id = (
       select id from stay_segments
       where workspace_id = $1 and user_id = $2
       order by client_segment_id limit 1
     )`,
    [owner.session.workspaceId, owner.session.userId]
  );
}

async function legacyReplayForBaseline(
  owner: OwnerFixture,
  processingAt: string,
  attempt: AttemptOptions
) {
  const { emitReviewSemanticSegments } = await import("../apps/web/src/lib/location/location-review-semantic-batch");
  const { replayLocationEvidence } = await import("../apps/web/src/lib/location/location-replay-service");
  const { withSyncTransaction } = await import("../apps/web/src/lib/sync-transaction");
  return withSyncTransaction("location_evidence", async ({ client, phase, remainingMs }) => {
    phase("owner_lock");
    const observation = { ...attempt, remainingOperationMs: remainingMs };
    observeLocationTiming(observation, "owner_lock", "started");
    await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [owner.session.workspaceId, owner.session.userId]);
    observeLocationTiming(observation, "owner_lock", "completed");
    phase("effect");
    const replay = await replayLocationEvidence(client, owner.session, {
      deviceId: REPLAY_SCALABILITY_DEVICE,
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      processingAt,
      onLocationStage: attempt.onLocationStage,
      onLocationTiming: attempt.onLocationTiming,
      onLocationCount: attempt.onLocationCount,
      remainingOperationMs: remainingMs
    });
    observeLocationStage(observation, "semantics");
    observeLocationTiming(observation, "semantic_review_persistence", "started");
    const eligible = replay.segments
      .filter((segment) => segment.status === "finalised")
      .filter((segment) => segmentStartedAfterSemanticCutover(segment.startedAt, REPLAY_SCALABILITY_CUTOVER));
    const semanticSegmentCount = await emitReviewSemanticSegments(client, owner.session, eligible, replay.stayIds, replay.commuteIds);
    observeLocationTiming(observation, "semantic_review_persistence", "completed");
    return { replay, semanticSegmentCount };
  }, {
    databasePool: attempt.databasePool,
    deadlineAt: attempt.deadlineAt,
    cleanupReserveMs: attempt.cleanupReserveMs,
    onSyncTiming: attempt.onSyncTiming,
    reuseFullCapTimeoutPair: true
  });
}

async function runReplay(
  source: Source,
  owner: OwnerFixture,
  processingAt: string,
  attempt: AttemptOptions
) {
  if (source === "base") return legacyReplayForBaseline(owner, processingAt, attempt);
  const { replayRetainedLocationEvidence } = await import("../apps/web/src/lib/location/location-ingest-service");
  return replayRetainedLocationEvidence(requestFor(), owner.session, processingAt, attempt);
}

async function logicalFingerprint(owner: OwnerFixture, reader: Pick<pg.PoolClient, "query"> = database) {
  const [stays, commutes, links, reviews, entries, receipts] = [
    await reader.query(
      `select client_segment_id,status,started_at,stopped_at,start_lower_bound_at,start_upper_bound_at,
              stop_lower_bound_at,stop_upper_bound_at,place_id,learned_place_id,centre::text,radius_m,
              sample_count,continuity_status,confidence,metadata
       from stay_segments where workspace_id = $1 and user_id = $2 order by client_segment_id`,
      [owner.session.workspaceId, owner.session.userId]
    ),
    await reader.query(
      `select c.client_segment_id,c.status,c.started_at,c.stopped_at,c.start_lower_bound_at,c.start_upper_bound_at,
              c.stop_lower_bound_at,c.stop_upper_bound_at,f.client_segment_id as from_client_segment_id,
              t.client_segment_id as to_client_segment_id,c.from_place_id,c.to_place_id,c.route_distance_m,
              c.straight_line_distance_m,c.route_sample_count,c.max_gap_seconds,c.continuity_status,c.confidence,c.metadata
       from commute_segments c
       join stay_segments f on f.id = c.from_stay_segment_id
       join stay_segments t on t.id = c.to_stay_segment_id
       where c.workspace_id = $1 and c.user_id = $2 order by c.client_segment_id`,
      [owner.session.workspaceId, owner.session.userId]
    ),
    await reader.query(
      `select e.client_evidence_id,coalesce(s.client_segment_id,c.client_segment_id) as client_segment_id,
              l.sequence_index,l.role
       from location_segment_evidence l
       join location_evidence e on e.id = l.evidence_id
       left join stay_segments s on s.id = l.stay_segment_id
       left join commute_segments c on c.id = l.commute_segment_id
       where l.workspace_id = $1 and l.user_id = $2
       order by client_segment_id,l.sequence_index,l.role,e.client_evidence_id`,
      [owner.session.workspaceId, owner.session.userId]
    ),
    await reader.query(
      `select ae.client_event_id,ae.event_type,ae.review_status,ri.status,ri.title,
              ri.suggested_started_at,ri.suggested_stopped_at,ri.suggested_category_id,ri.suggested_place_id
       from activity_events ae left join review_items ri on ri.event_id = ae.id
       where ae.workspace_id = $1 and ae.user_id = $2 and ae.event_type <> 'location_evidence_batch'
       order by ae.client_event_id,ri.id`,
      [owner.session.workspaceId, owner.session.userId]
    ),
    await reader.query(
      `select te.source,te.description,te.started_at,te.stopped_at,te.review_status,
              ae.client_event_id
       from time_entries te left join activity_events ae on ae.id = te.created_from_event_id
       where te.workspace_id = $1 and te.user_id = $2
       order by te.started_at,te.id`,
      [owner.session.workspaceId, owner.session.userId]
    ),
    await reader.query(
      `select client_mutation_id,review_item_id,action_key,request_hash,result_json,created_at
       from review_mutation_receipts
       where workspace_id = $1 and user_id = $2
       order by client_mutation_id,created_at`,
      [owner.session.workspaceId, owner.session.userId]
    )
  ];
  return createHash("sha256").update(JSON.stringify({
    stays: stays.rows,
    commutes: commutes.rows,
    links: links.rows,
    reviews: reviews.rows,
    entries: entries.rows,
    receipts: receipts.rows
  })).digest("hex");
}

async function counts(owner: OwnerFixture) {
  const result = await database.query(
    `select
       (select count(*)::int from location_evidence where workspace_id = $1 and user_id = $2 and accepted) as evidence,
       (select count(*)::int from stay_segments where workspace_id = $1 and user_id = $2) as stays,
       (select count(*)::int from commute_segments where workspace_id = $1 and user_id = $2) as commutes,
       (select count(*)::int from review_items where workspace_id = $1 and user_id = $2) as reviews,
       (select count(*)::int from time_entries where workspace_id = $1 and user_id = $2) as entries,
       (select count(*)::int from location_segment_evidence where workspace_id = $1 and user_id = $2) as lineage`,
    [owner.session.workspaceId, owner.session.userId]
  );
  return result.rows[0] as Record<string, number>;
}

async function measure(
  source: Source,
  owner: OwnerFixture,
  scenario: Scenario,
  workload: "S1" | "S3",
  processingAt: string,
  delayMs: number
) {
  const before = { counts: await counts(owner), fingerprint: await logicalFingerprint(owner) };
  const capture = createCapture();
  const startedAt = performance.now();
  const deadlineAt = Date.now() + REQUEST_DEADLINE_MS;
  setCaptureStage(capture, "request_auth");
  await sleep(AUTH_COST_MS);
  setCaptureStage(capture, "effect");
  let error: unknown;
  try {
    await runReplay(source, owner, processingAt, {
      databasePool: createMeasuredPool(delayMs, capture),
      deadlineAt,
      cleanupReserveMs: 1_000,
      onLocationStage: (stage) => setCaptureStage(capture, stage),
      onLocationTiming: (event) => {
        captureTiming(capture, event);
        if (event.stage === "transaction_commit" && event.state === "completed") {
          capture.remainingWorkBudgetAfterCommit = event.remainingMs ?? null;
        }
      },
      onLocationCount: (name, value) => {
        capture.counts[name] = value;
      },
      onSyncTiming: (event) => {
        captureTiming(capture, event);
        if (event.stage === "transaction_commit" && event.state === "completed") {
          capture.remainingWorkBudgetAfterCommit = event.remainingMs;
        }
        setCaptureStage(capture, event.stage);
      }
    });
  } catch (caught) {
    error = caught;
  }
  setCaptureStage(capture, "complete");
  const requestModelDurationMs = Math.round(performance.now() - startedAt);
  const detailedStages = timingSnapshot(capture);
  if (source === "candidate") {
    assertCandidateBatchBounds(capture, `${workload}/${scenario}/${delayMs}ms`);
    if (!error) assertCandidateCompleteLineage(capture, `${workload}/${scenario}/${delayMs}ms`);
  }
  const snapshot = await counts(owner);
  const fingerprint = await logicalFingerprint(owner);
  if (error) {
    assert.deepEqual(snapshot, before.counts, `${workload}/${scenario}/${delayMs}ms: failure changed row counts.`);
    assert.equal(fingerprint, before.fingerprint, `${workload}/${scenario}/${delayMs}ms: failure changed logical state.`);
  }
  const businessQueryHash = createHash("sha256").update(JSON.stringify(capture.businessStatements)).digest("hex");
  const report = {
    source,
    workload,
    scenario,
    delayMs,
    authCostMs: AUTH_COST_MS,
    deadlineMs: REQUEST_DEADLINE_MS,
    requestModelDurationMs,
    driverCalls: capture.calls,
    timeoutConfigurationCalls: capture.timeoutConfigurationCalls,
    protectionQueryBatches: capture.counts.protectionQueryBatches ?? capture.protectionQueryBatches,
    protectionEvidenceIds: capture.counts.protectionEvidenceIds ?? capture.protectionEvidenceIds,
    protectedEvidenceBatchCount: capture.protectedEvidenceBatchSizes.length,
    maxProtectedEvidenceBatchItems: maxBatchValue(capture.protectedEvidenceBatchSizes),
    maxProtectedEvidencePayloadBytes: maxBatchValue(capture.protectedEvidenceBatchBytes),
    lineageRequests: capture.lineageRequests,
    lineageBatchCount: capture.lineageBatchSizes.length,
    maxLineageBatchItems: maxBatchValue(capture.lineageBatchSizes),
    lineageLinksIntended: capture.counts.lineageLinksIntended ?? null,
    lineageLinksPrepared: capture.counts.lineageLinksPrepared ?? null,
    lineageChunksStarted: capture.counts.lineageChunksStarted ?? null,
    lineageChunksCompleted: capture.counts.lineageChunksCompleted ?? null,
    maxLineagePayloadBytes: capture.maxLineagePayloadBytes,
    maxParameterCount: capture.maxParameterCount,
    maxParameterBytes: capture.maxParameterBytes,
    commitReached: capture.commitReached,
    rollbackUnchanged: error ? fingerprint === before.fingerprint : null,
    remainingWorkBudgetAfterCommit: capture.remainingWorkBudgetAfterCommit,
    businessQueryHash,
    detailedStages,
    stages: Object.fromEntries(Object.entries(capture.stages).map(([name, value]) => [name, { calls: value.calls, ms: Math.round(value.ms) }])),
    snapshot: {
      ...snapshot,
      logicalFingerprint: fingerprint
    },
    outcome: error ? "FAIL" : "PASS",
    ...(error ? { failure: safeFailure(error) } : {})
  };
  const acceptanceFailures: string[] = [];
  if (source === "candidate" && workload === "S1") {
    for (const [passed, message] of [
      [!error && capture.commitReached, "S1 must commit successfully"],
      [requestModelDurationMs <= 5_500, "S1 request duration exceeds 5,500 ms"],
      [capture.remainingWorkBudgetAfterCommit != null && capture.remainingWorkBudgetAfterCommit >= 1_500, "S1 post-commit work budget is below 1,500 ms"]
    ] as const) {
      try { assert(passed, message); } catch { acceptanceFailures.push(message); }
    }
  }
  Object.assign(report, {
    replayOutcome: report.outcome,
    outcome: error || acceptanceFailures.length ? "FAIL" : "PASS",
    acceptanceFailures
  });
  console.log(JSON.stringify(report));
  return { report, error };
}

async function schemaEvidence() {
  const client = await database.connect();
  try {
    const version = await client.query<{ version: number; postgis: string; databaseName: string }>(
      `select current_setting('server_version_num')::int as version,
              postgis_full_version() as postgis,
              current_database() as "databaseName"`
    );
    assert(version.rows[0].version >= 170000 && version.rows[0].version < 180000, "PostgreSQL 17 is required.");
    const triggers = await client.query<{ name: string; definition: string }>(
      `select tgname as name, pg_get_triggerdef(oid) as definition
       from pg_trigger where not tgisinternal and tgname in (
         'dayframe_location_evidence_owner_links','dayframe_stay_owner_links',
         'dayframe_commute_owner_links','dayframe_segment_evidence_owner_links','dayframe_review_owner'
       ) order by tgname`
    );
    assert.equal(triggers.rows.length, 5, "The complete local ownership-trigger set is required.");
    const indexes = await client.query<{ name: string; definition: string }>(
      `select indexname as name,indexdef as definition from pg_indexes
       where schemaname = 'public' and tablename in ('location_evidence','stay_segments','commute_segments','location_segment_evidence','review_items')
       order by tablename,indexname`
    );
    const schemaFingerprint = createHash("sha256").update(JSON.stringify({
      triggers: triggers.rows,
      indexes: indexes.rows
    })).digest("hex");
    console.log(JSON.stringify({
      target: { host: "127.0.0.1", port: 54323, database: target.databaseName },
      postgres: version.rows[0].version,
      postgis: version.rows[0].postgis,
      triggerNames: triggers.rows.map((row) => row.name),
      indexCount: indexes.rows.length,
      schemaFingerprint
    }));
    return { schemaFingerprint };
  } finally {
    client.release();
  }
}

async function queryPlanEvidence(owner: OwnerFixture) {
  const client = await database.connect();
  try {
    const ids = await client.query<{ clientEvidenceId: string }>(
      `select client_evidence_id as "clientEvidenceId" from location_evidence
       where workspace_id = $1 and user_id = $2 and device_id = $3 order by client_evidence_id limit 1`,
      [owner.session.workspaceId, owner.session.userId, REPLAY_SCALABILITY_DEVICE]
    );
    const link = await client.query<{
      evidenceId: string;
      staySegmentId: string | null;
      commuteSegmentId: string | null;
      sequenceIndex: number;
      role: string;
    }>(
      `select l.evidence_id as "evidenceId",l.stay_segment_id as "staySegmentId",
              l.commute_segment_id as "commuteSegmentId",l.sequence_index as "sequenceIndex",l.role
       from location_segment_evidence l
       where l.workspace_id = $1 and l.user_id = $2 limit 1`,
      [owner.session.workspaceId, owner.session.userId]
    );
    assert(ids.rows[0] && link.rows[0], "Production-shaped fixture did not persist evidence and lineage for EXPLAIN.");
    await client.query("begin");
    const protectedPlan = await client.query(
      `explain (analyze, buffers, format json)
       select s.client_segment_id, le.client_evidence_id
       from stay_segments s
       join location_segment_evidence lse on lse.stay_segment_id = s.id
         and lse.workspace_id = s.workspace_id and lse.user_id = s.user_id
       join location_evidence le on le.id = lse.evidence_id
         and le.workspace_id = s.workspace_id and le.user_id = s.user_id
       where s.workspace_id = $1 and s.user_id = $2 and s.device_id = $3 and s.algorithm_version = $4
         and le.device_id = $3 and le.algorithm_version = $4 and le.client_evidence_id = any($5::text[])
         and (s.continuity_status = 'manual' or (s.status <> 'superseded' and s.created_from_event_id is not null
           and not exists (select 1 from review_items ri where ri.workspace_id = s.workspace_id
             and ri.user_id = s.user_id and ri.location_segment_id = s.id and ri.status = 'open')))
       order by s.id, le.client_evidence_id for update of s`,
      [owner.session.workspaceId, owner.session.userId, REPLAY_SCALABILITY_DEVICE, LOCATION_ENGINE_V2_CONFIG.algorithmVersion, [ids.rows[0].clientEvidenceId]]
    );
    const row = link.rows[0];
    const lineagePlan = await client.query(
      `explain (analyze, buffers, format json)
       insert into location_segment_evidence
         (workspace_id,user_id,evidence_id,stay_segment_id,commute_segment_id,sequence_index,role)
       select $1::uuid,$2::uuid,r.evidence_id,r.stay_segment_id,r.commute_segment_id,r.sequence_index,r.role
       from jsonb_to_recordset($3::jsonb) as r(
         evidence_id uuid,stay_segment_id uuid,commute_segment_id uuid,sequence_index integer,role text,ordinal integer
       ) order by r.ordinal on conflict do nothing`,
      [owner.session.workspaceId, owner.session.userId, JSON.stringify([{
        evidence_id: row.evidenceId,
        stay_segment_id: row.staySegmentId,
        commute_segment_id: row.commuteSegmentId,
        sequence_index: row.sequenceIndex,
        role: row.role,
        ordinal: 0
      }])]
    );
    await client.query("rollback");
    console.log(JSON.stringify({
      queryPlans: {
        protectedProvenanceFingerprint: createHash("sha256").update(JSON.stringify(protectedPlan.rows[0])).digest("hex"),
        lineageInsertFingerprint: createHash("sha256").update(JSON.stringify(lineagePlan.rows[0])).digest("hex")
      }
    }));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Local diagnostic only: EXPLAIN executes in a rolled-back savepoint before
 * each actual statement. Its extra work is not an acceptance timing sample. */
async function statementDiagnostics(owner: OwnerFixture) {
  const capture = createCapture();
  const statements: Record<string, unknown>[] = [];
  const profiler = new InspectorSession();
  profiler.connect();
  await profiler.post("Profiler.enable");
  await profiler.post("Profiler.start");
  try {
    await runReplay("candidate", owner, REPLAY_SCALABILITY_CLOCK, {
      databasePool: { connect: async () => {
        const raw = await database.connect();
        return new Proxy(raw, { get(client, key) {
          if (key === "query") return async (sql: string, params?: unknown[]) => {
            const stage = capture.activeTimingStage;
            const relevant = stage && ["evidence_read", "protected_replacement_checks", "obsolete_segment_handling",
              "stay_persistence", "commute_persistence", "lineage_deletion", "lineage_insertion"].includes(stage)
              && !sql.includes("set_config") && !sql.includes("pg_advisory");
            if (relevant) {
              await client.query("savepoint diagnostic_plan");
              try {
                const plan = await client.query(`explain (analyze, buffers, format json) ${sql}`, params);
                statements.push({ stage, parameterBytes: Buffer.byteLength(JSON.stringify(params ?? [])),
                  parameterCount: params?.length ?? 0, plan: plan.rows[0]["QUERY PLAN"] });
              } finally {
                await client.query("rollback to savepoint diagnostic_plan");
                await client.query("release savepoint diagnostic_plan");
              }
            }
            return client.query(sql, params);
          };
          const value = Reflect.get(client, key);
          return typeof value === "function" ? value.bind(client) : value;
        } });
      } } as Pick<pg.Pool, "connect">,
      deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
      cleanupReserveMs: 1_000,
      onLocationStage: stage => setCaptureStage(capture, stage),
      onLocationTiming: event => captureTiming(capture, event),
      onLocationCount: (name, value) => { capture.counts[name] = value; },
      onSyncTiming: event => captureTiming(capture, event)
    });
  } finally {
    const { profile } = await profiler.post("Profiler.stop");
    profiler.disconnect();
    const stages = Object.fromEntries(Object.entries(timingSnapshot(capture)).map(([name, stage]) => {
      assert(stage && typeof stage === "object");
      return [name, { ...stage, calls: null, driverMs: null }];
    }));
    console.log(JSON.stringify({ statementDiagnostics: { counts: capture.counts, stages, statements, profile,
      note: "Local rollback-contained EXPLAIN and CPU profile; not acceptance timing or hosted attribution." } }));
  }
}

async function secondLineageBatchRollback() {
  const owner = await createOwner();
  try {
    const history = replayScalabilityHistory(
      owner.placeIds,
      REPLAY_SCALABILITY_S3_DAYS,
      REPLAY_SCALABILITY_TRIPS_PER_DAY * 2
    );
    assert(history.length >= 8_400, "Second-batch rollback fixture must contain at least 8,400 eligible observations.");
    await uploadEvidence(owner, history, REPLAY_SCALABILITY_CLOCK, "second-lineage-rollback-seed");
    const seedCapture = createCapture();
    await runReplay(SOURCE as Source, owner, REPLAY_SCALABILITY_CLOCK, {
      databasePool: createMeasuredPool(0, seedCapture),
      deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
      cleanupReserveMs: 1_000,
      onLocationStage: (stage) => setCaptureStage(seedCapture, stage),
      onLocationTiming: () => undefined,
      onLocationCount: (name, value) => { seedCapture.counts[name] = value; },
      onSyncTiming: (event) => setCaptureStage(seedCapture, event.stage)
    });
    await markMinimalProtectedHistory(owner);
    const before = {
      counts: await counts(owner),
      logicalFingerprint: await logicalFingerprint(owner)
    };

    const capture = createCapture();
    let lineageAttempts = 0;
    let firstLineageBatchExecuted = false;
    let secondLineageBatchReached = false;
    let lineageDeletionDispatched = false;
    let semanticPersistenceReached = false;
    let failure: unknown;
    try {
      await runReplay("candidate", owner, REPLAY_SCALABILITY_CLOCK, {
        databasePool: createMeasuredPool(0, capture, {
          onBeforeDispatch: (statement) => {
            if (isLineageInsertStatement(statement)) {
              lineageAttempts += 1;
              if (lineageAttempts === 1) {
                const intended = capture.counts.lineageLinksIntended;
                assert(
                  Number.isSafeInteger(intended) && intended > locationLineageInsertBatchSize,
                  `Second-batch rollback requires intended lineage links above ${locationLineageInsertBatchSize}.`
                );
              } else if (lineageAttempts === 2) {
                secondLineageBatchReached = true;
                throw new Error("synthetic second lineage insert failure");
              }
            }
          },
          onAfterDispatch: (statement) => {
            if (isLineageDeleteStatement(statement)) lineageDeletionDispatched = true;
            if (isLineageInsertStatement(statement) && lineageAttempts === 1) firstLineageBatchExecuted = true;
          }
        }),
        deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
        cleanupReserveMs: 1_000,
        onLocationStage: (stage) => {
          if (stage === "semantics") semanticPersistenceReached = true;
          setCaptureStage(capture, stage);
        },
        onLocationTiming: () => undefined,
        onLocationCount: (name, value) => { capture.counts[name] = value; },
        onSyncTiming: (event) => setCaptureStage(capture, event.stage)
      });
    } catch (caught) {
      failure = caught;
    }
    setCaptureStage(capture, "complete");
    assert(
      failure,
      `Second-lineage-batch rollback did not fail at the injected seam (lineageAttempts=${lineageAttempts}, intended=${capture.counts.lineageLinksIntended ?? "missing"}, prepared=${capture.counts.lineageLinksPrepared ?? "missing"}, deletion=${lineageDeletionDispatched}, semantic=${semanticPersistenceReached}, commit=${capture.commitReached}).`
    );
    assert.equal(lineageAttempts, 2, "The second-lineage-batch seam was not reached exactly twice.");
    assert(lineageDeletionDispatched, "Lineage deletion did not dispatch before the injected failure.");
    assert(firstLineageBatchExecuted, "The first lineage batch did not execute successfully.");
    assert(secondLineageBatchReached, "The second lineage batch was not reached.");
    assert.equal(capture.commitReached, false, "The injected rollback unexpectedly committed.");
    assert.equal(semanticPersistenceReached, false, "Semantic persistence began before the second-batch failure.");
    assertCandidateBatchBounds(capture, "second-lineage-batch-rollback");
    assert(Number.isSafeInteger(capture.counts.lineageLinksIntended));
    assert(capture.counts.lineageLinksIntended > locationLineageInsertBatchSize);
    assert.equal(capture.lineageRequests, 2, "The rollback proof did not reach exactly two lineage insert attempts.");
    assert.deepEqual(await counts(owner), before.counts, "Rollback changed owner row counts.");
    assert.equal(
      await logicalFingerprint(owner),
      before.logicalFingerprint,
      "Rollback did not restore lineage, protected history, semantic state and receipts exactly."
    );
    console.log(JSON.stringify({
      planId: "DF-PROD-REPLAY-SCALABILITY-V1",
      source: "candidate",
      rollbackProof: {
        outcome: "PASS",
        workload: "S3",
        intendedLineageLinks: capture.counts.lineageLinksIntended,
        preparedLineageLinks: capture.counts.lineageLinksPrepared ?? null,
        lineageAttempts,
        firstLineageBatchExecuted,
        secondLineageBatchReached,
        lineageDeletionDispatched,
        semanticPersistenceReached,
        commitReached: capture.commitReached,
        lineageBatchCount: capture.lineageBatchSizes.length,
        maxLineageBatchItems: maxBatchValue(capture.lineageBatchSizes),
        maxLineagePayloadBytes: maxBatchValue(capture.lineageBatchBytes),
        failure: safeFailure(failure)
      }
    }));
  } finally {
    await cleanupOwner(owner);
  }
}

/** Untimed semantic oracle, not a request/performance sample. Savepoints give
 * both persistence profiles identical IDs, retained inputs and protected rows.
 * Every timed request below still uses the unchanged 8s/1s deadline contract.
 */
async function sameOwnerProfileEquivalence() {
  const { replayLocationEvidence } = await import("../apps/web/src/lib/location/location-replay-service");
  const { emitReviewSemanticSegments } = await import("../apps/web/src/lib/location/location-review-semantic-batch");
  const { ensureCommuteCategoryId } = await import("../apps/web/src/lib/automatic-category-service");
  const { LOCATION_REPLAY_SCALABILITY_PROFILE } = await import("../apps/web/src/lib/location/location-replay-batching");
  const owner = await createOwner();
  const client = await database.connect();
  try {
    await uploadEvidence(owner, replayScalabilityHistory(owner.placeIds,
      REPLAY_SCALABILITY_S1_DAYS, REPLAY_SCALABILITY_TRIPS_PER_DAY), REPLAY_SCALABILITY_CLOCK, "equivalence");
    await ensureCommuteCategoryId(client, owner.session);
    for (const scenario of ["first-success", "stable", "changed-input"] as const) {
      if (scenario === "stable") await markProtectedHistory(owner);
      if (scenario === "changed-input") await uploadEvidence(owner,
        [changedReplayEvidence(owner.placeIds).at(-1)!], REPLAY_SCALABILITY_CLOCK, "equivalence-changed");
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [owner.session.workspaceId, owner.session.userId]);
      await client.query("savepoint identical_input");
      const fingerprints: string[] = [];
      for (const profile of [undefined, LOCATION_REPLAY_SCALABILITY_PROFILE]) {
        const replay = await replayLocationEvidence(client, owner.session, {
          deviceId: REPLAY_SCALABILITY_DEVICE, algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
          processingAt: REPLAY_SCALABILITY_CLOCK, persistenceProfile: profile
        });
        await emitReviewSemanticSegments(client, owner.session, replay.segments
          .filter(segment => segment.status === "finalised")
          .filter(segment => segmentStartedAfterSemanticCutover(segment.startedAt, REPLAY_SCALABILITY_CUTOVER)),
        replay.stayIds, replay.commuteIds);
        fingerprints.push(await logicalFingerprint(owner, client));
        if (!profile) await client.query("rollback to savepoint identical_input");
      }
      assert.equal(fingerprints[1], fingerprints[0], `${scenario}: base/candidate logical state differs.`);
      await client.query("commit");
      console.log(JSON.stringify({ profileEquivalence: { scenario, outcome: "PASS",
        baseFingerprint: fingerprints[0], candidateFingerprint: fingerprints[1] } }));
    }
  } finally {
    await client.query("rollback");
    client.release();
    await cleanupOwner(owner);
  }
}

async function runMatrix(source: Source) {
  const measurements: Array<{ report: Record<string, unknown>; error: unknown }> = [];
  const run = async (workload: "S1" | "S3", scenario: Scenario, delayMs: number, sample = "") => {
    const days = workload === "S1" ? REPLAY_SCALABILITY_S1_DAYS : REPLAY_SCALABILITY_S3_DAYS;
    const trips = workload === "S1" ? REPLAY_SCALABILITY_TRIPS_PER_DAY : REPLAY_SCALABILITY_TRIPS_PER_DAY * 2;
    const processingAt = workload === "S1" ? REPLAY_SCALABILITY_CLOCK : "2026-09-14T00:00:00.000Z";
    const owner = await createOwner();
    try {
      const history = replayScalabilityHistory(owner.placeIds, days, trips);
      assert(workload !== "S1" || history.length >= 4_200, "S1 fixture must contain at least 4,200 eligible observations.");
      assert(workload !== "S3" || history.length >= 8_400, "S3 fixture must contain at least 8,400 eligible observations.");
      await uploadEvidence(owner, history, processingAt, `${workload}-${scenario}-${delayMs}-${sample}-seed`);
      if (scenario !== "first-success") {
        const seedCapture = createCapture();
        await runReplay(source, owner, processingAt, {
          databasePool: createMeasuredPool(0, seedCapture),
          deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
          cleanupReserveMs: 1_000,
          onLocationStage: (stage) => setCaptureStage(seedCapture, stage),
          onLocationTiming: () => undefined,
          onLocationCount: (name, value) => { seedCapture.counts[name] = value; },
          onSyncTiming: (event) => setCaptureStage(seedCapture, event.stage)
        });
        await markProtectedHistory(owner);
      }
      if (scenario === "changed-input") {
        await uploadEvidence(owner, [changedReplayEvidence(owner.placeIds).at(-1)!], processingAt, `${workload}-changed`);
      }
      const measured = await measure(source, owner, scenario, workload, processingAt, delayMs);
      measurements.push(measured);
    } finally {
      await cleanupOwner(owner);
    }
  };

  for (const scenario of ["first-success", "stable", "changed-input"] as const) {
    for (const delayMs of [0, 40, 100]) await run("S1", scenario, delayMs);
  }
  for (const sample of ["sample-2", "sample-3"]) await run("S1", "first-success", 100, sample);
  if (!S1_ONLY) for (const delayMs of [0, 100]) await run("S3", "first-success", delayMs);
  return measurements;
}

async function main() {
  await loadApplicationRuntime();
  if (SOURCE === "candidate") {
    // The candidate claim is specifically the server-effective v2_review path.
    // This is process-local validator setup, never a hosted or production change.
    process.env.DAYFRAME_LOCATION_ROLLOUT_MODE = "v2_review";
  }
  const schema = await schemaEvidence();
  const owner = await createOwner();
  try {
    const history = STATEMENT_DIAGNOSTICS && process.argv.includes("--high-segment")
      ? highSegmentReplayEvidence(owner.placeIds)
      : replayScalabilityHistory(owner.placeIds, REPLAY_SCALABILITY_S1_DAYS, REPLAY_SCALABILITY_TRIPS_PER_DAY);
    await uploadEvidence(owner, history, REPLAY_SCALABILITY_CLOCK, "plans");
    if (STATEMENT_DIAGNOSTICS) { await statementDiagnostics(owner); return; }
    const seedCapture = createCapture();
    await runReplay(SOURCE as Source, owner, REPLAY_SCALABILITY_CLOCK, {
      databasePool: createMeasuredPool(0, seedCapture),
      deadlineAt: Date.now() + REQUEST_DEADLINE_MS,
      cleanupReserveMs: 1_000,
      onLocationStage: (stage) => setCaptureStage(seedCapture, stage),
      onLocationTiming: () => undefined,
      onLocationCount: (name, value) => { seedCapture.counts[name] = value; },
      onSyncTiming: (event) => setCaptureStage(seedCapture, event.stage)
    });
    if (QUERY_PLAN_ONLY) {
      await markProtectedHistory(owner);
      await uploadEvidence(owner, [changedReplayEvidence(owner.placeIds).at(-1)!], REPLAY_SCALABILITY_CLOCK, "plan-changed");
      const { replayLocationEvidence } = await import("../apps/web/src/lib/location/location-replay-service");
      const { LOCATION_REPLAY_SCALABILITY_PROFILE } = await import("../apps/web/src/lib/location/location-replay-batching");
      const client = await database.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [owner.session.workspaceId, owner.session.userId]);
        const proxy = new Proxy(client, { get(raw, property) {
          if (property === "query") return async (sql: string, params: unknown[]) => {
            if (sql.includes("for update of s") || sql.includes('ri.id as "reviewId"')) {
              const plan = await raw.query(`explain (analyze, buffers, format json) ${sql}`, params);
              console.log(JSON.stringify({ measuredQueryPlan: plan.rows[0] }));
            }
            return raw.query(sql, params);
          };
          return Reflect.get(raw, property);
        } });
        await replayLocationEvidence(proxy, owner.session, { deviceId: REPLAY_SCALABILITY_DEVICE,
          algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, processingAt: REPLAY_SCALABILITY_CLOCK,
          persistenceProfile: SOURCE === "candidate" ? LOCATION_REPLAY_SCALABILITY_PROFILE : undefined });
      } finally {
        await client.query("rollback");
        client.release();
      }
    } else await queryPlanEvidence(owner);
  } finally {
    await cleanupOwner(owner);
  }
  if (QUERY_PLAN_ONLY) return;
  if (SOURCE === "candidate" && !S1_ONLY) {
    await sameOwnerProfileEquivalence();
    await secondLineageBatchRollback();
  }
  const measurements = await runMatrix(SOURCE as Source);
  const candidateS1 = measurements.filter(({ report }) => report.source === "candidate" && report.workload === "S1");
  let gateFailure: unknown;
  if (SOURCE === "candidate") {
    try {
      const requiredCandidate = measurements.filter(({ report }) =>
        report.source === "candidate" &&
        (report.workload === "S1" || (report.workload === "S3" && report.delayMs === 0))
      );
      assert(requiredCandidate.every(({ report }) =>
        report.outcome === "PASS" &&
        report.commitReached === true &&
        report.lineageLinksIntended === report.lineageLinksPrepared
      ), "Candidate S1 and S3 standard cases must prepare all intended lineage links and reach commit.");
      const candidateS3Adverse = measurements.filter(({ report }) =>
        report.source === "candidate" && report.workload === "S3" && report.delayMs === 100
      );
      assert(candidateS3Adverse.every(({ report }) => report.outcome === "PASS" || report.commitReached === false),
        "Candidate S3 adverse-latency failures must terminate before commit.");
      assert(candidateS1.every(({ report }) => report.outcome === "PASS" && report.commitReached === true), "Candidate S1 must reach semantic persistence and commit for every required case.");
      const first100 = candidateS1.filter(({ report }) => report.scenario === "first-success" && report.delayMs === 100);
      const durations = first100.map(({ report }) => report.requestModelDurationMs as number).sort((a, b) => a - b);
      const median = durations[Math.floor(durations.length / 2)];
      assert(median <= 5_000, `Candidate S1 first-success 100 ms median exceeded 5,000 ms (${median} ms).`);
      assert.equal(first100.length, 3, "Three first-success 100 ms samples are required.");
      assert(candidateS1.every(({ report }) => (report.requestModelDurationMs as number) <= 5_500 &&
        (report.remainingWorkBudgetAfterCommit as number | null) != null &&
      (report.remainingWorkBudgetAfterCommit as number) >= 1_500), "Candidate S1 per-request gate failed.");
    } catch (error) {
      gateFailure = error;
    }
  }
  console.log(JSON.stringify({
    planId: "DF-PROD-REPLAY-SCALABILITY-V1",
    source: SOURCE,
    outcome: gateFailure ? "FAIL" : "PASS",
    schemaFingerprint: schema.schemaFingerprint,
    principalMeasurements: measurements.length,
    expectedPrincipalMeasurements: S1_ONLY ? 11 : 13,
    firstSuccess100msMedian: candidateS1.filter(({ report }) => report.scenario === "first-success" && report.delayMs === 100)
      .map(({ report }) => report.requestModelDurationMs as number).sort((a, b) => a - b)[1] ?? null,
    matrixFailures: measurements.filter(({ report }) => report.outcome === "FAIL").length,
    ...(gateFailure ? { failure: safeFailure(gateFailure) } : {}),
    note: SOURCE === "base"
      ? "Base measurements use the test-only legacy persistence adapter with the unchanged Review emitter and #202 timeout reuse."
      : "Candidate measurements use server-effective v2_review and review_scalability_v1."
  }));
  if (gateFailure) process.exitCode = 1;
}

if (targetError) {
  console.error(JSON.stringify({
    planId: "DF-PROD-REPLAY-SCALABILITY-V1",
    source: SOURCE,
    outcome: "NOT RUN",
    failure: safeFailure(targetError)
  }));
  process.exitCode = 1;
} else {
  database = new pg.Pool({ connectionString: target.raw, max: 6, connectionTimeoutMillis: 1_500 });
  main().catch((error) => {
    console.error(JSON.stringify({
      planId: "DF-PROD-REPLAY-SCALABILITY-V1",
      source: SOURCE,
      outcome: "NOT RUN",
      failure: safeFailure(error)
    }));
    process.exitCode = 1;
  }).finally(async () => {
    await database.end();
    const { pool } = await import("../apps/web/src/lib/db").catch(() => ({ pool: null }));
    await pool?.end();
  });
}
