import {createOwnerSyncCoalescer} from "../ownerSyncCoalescer";
import {MobileHttpResponseError, isMobileTransportFailure} from "../mobile-network";
import type {SyncLaneOutcome} from "../syncLane";
import * as SQLite from "expo-sqlite";
import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceBatchRequestSchema,
  LocationEvidenceSchema,
  LocationReplayResponseSchema,
  LocationRolloutModeSchema,
  runLocationEngine,
  type LearnedPlaceForMatching,
  type LocationEngineState,
  type LocationEvidence,
  type LocationRolloutMode,
  type LocationSegment,
  type SavedPlaceForMatching
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "../config";
import {
  SecureSessionUnavailableError,
  invalidateMobileSessionIfCurrent,
  isAuthenticatedSessionSnapshotCurrent,
  readOwnedAuthenticatedSessionSnapshot,
  type AuthenticatedSessionSnapshot
} from "../secure-session";
import {
  mobileAccountOwnersEqual,
  type MobileAccountOwner
} from "../mobileAccount";
import { createSerialMutationQueue } from "./mutationQueue";
import { fetchLocationSync } from "./network";
import {
  executeOwnedLocationRequest,
  prepareOwnedLocationBatch
} from "./syncOwnership";
import {
  MAX_LOCATION_UPLOAD_BATCHES_PER_SYNC,
  locationUploadDisposition,
  partitionAcknowledgedEvidence,
  shouldRequestLocationReplay
} from "./uploadPolicy";

const DATABASE_NAME = "dayframe-location-v2.db";
const DATABASE_VERSION = 1;
const MAX_LOCAL_EVIDENCE_ITEMS = 5_000;
const ACTIVE_ACCOUNT_KEY = "active_account";
const ACTIVE_DEVICE_KEY = "active_device";
const ACTIVE_TIME_ZONE_KEY = "active_time_zone";
const ROLLOUT_MODE_KEY = "rollout_mode";
const SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY = "semantic_mode_acknowledged_at";

export type { LocationRolloutMode } from "@dayframe/shared";

export type LocationAccountContext = {
  userId: string;
  workspaceId: string;
  deviceId: string;
  timeZone: string;
  savedPlaces: SavedPlaceForMatching[];
  acceptedLearnedPlaces: LearnedPlaceForMatching[];
};

export type LocationStoreDiagnostics = {
  engineVersion: string;
  rolloutMode: LocationRolloutMode;
  accountConfigured: boolean;
  savedPlaceCatalogueCount: number;
  pendingEvidenceCount: number;
  acknowledgedEvidenceCount: number;
  outboxCount: number;
  segmentCount: number;
  oldestEvidenceAt: string | null;
  oldestUnsynchronisedAt: string | null;
  lastAcceptedEvidenceAt: string | null;
  lastEngineState: string | null;
  activeProvisionalSegmentKind: string | null;
  lastGapDurationSeconds: number | null;
  rejectedEvidenceCounts: Record<string, number>;
  lastUploadAt: string | null;
  lastServerReplayVersion: string | null;
  lastServerReplayAt: string | null;
  lastServerReplayStatus: "success" | "failed" | null;
  lastServerReplayFinalisedCount: number;
  lastServerReplaySemanticCount: number;
  lastServerReplayError: string | null;
  lastUploadError: string | null;
  droppedEvidenceCount: number;
  retentionCleanupDeletedCount: number;
  retentionCleanupAt: string | null;
  nextRetryAt?:string|null;
  semanticWarnings?:string[];
};

type MetadataRow = { value: string };
type EvidenceRow = { evidence_json: string };
type SegmentRow = { segment_json: string };
type OutboxRow = {
  account_key: string;
  client_batch_id: string;
  body_json: string;
  attempt_count: number;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

const locationMutationQueue = createSerialMutationQueue();
const locationStoreListeners = new Set<() => void>();

function serialiseLocationMutation<Result>(operation: () => Promise<Result>) {
  return locationMutationQueue(operation).finally(() => {
    for (const listener of locationStoreListeners) listener();
  });
}

export function subscribeLocationStore(listener: () => void) {
  locationStoreListeners.add(listener);
  return () => locationStoreListeners.delete(listener);
}

async function database() {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    if ((version?.user_version ?? 0) < DATABASE_VERSION) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync(`
          create table if not exists location_store_metadata (
            key text primary key not null,
            value text not null,
            updated_at text not null
          );
          create table if not exists location_account_context (
            account_key text primary key not null,
            context_json text not null,
            updated_at text not null
          );
          create table if not exists location_evidence_journal (
            client_evidence_id text primary key not null,
            account_key text not null,
            occurred_at text not null,
            expires_at text not null,
            evidence_json text not null,
            upload_state text not null default 'pending',
            client_batch_id text,
            inserted_at text not null
          );
          create index if not exists location_evidence_account_time_idx
            on location_evidence_journal(account_key, occurred_at);
          create index if not exists location_evidence_upload_idx
            on location_evidence_journal(account_key, upload_state, occurred_at);
          create table if not exists location_engine_state (
            account_key text primary key not null,
            state_json text not null,
            updated_at text not null
          );
          create table if not exists location_segment_snapshot (
            account_key text not null,
            client_segment_id text not null,
            segment_json text not null,
            updated_at text not null,
            primary key(account_key, client_segment_id)
          );
          create table if not exists location_upload_outbox (
            client_batch_id text primary key not null,
            account_key text not null,
            body_json text not null,
            state text not null default 'pending',
            attempt_count integer not null default 0,
            next_attempt_at text,
            last_error text,
            created_at text not null,
            updated_at text not null
          );
        `);
        await transaction.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
      });
    }
    return db;
  });
  return databasePromise;
}

async function metadata(key: string) {
  const db = await database();
  return (await db.getFirstAsync<MetadataRow>(
    "select value from location_store_metadata where key = ?",
    key
  ))?.value ?? null;
}

async function setMetadata(key: string, value: string, transaction?: SQLite.SQLiteDatabase) {
  const db = transaction ?? await database();
  await db.runAsync(
    `insert into location_store_metadata (key, value, updated_at) values (?, ?, ?)
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString()
  );
}

async function updateOwnedDiagnostics(key: string, patch: Partial<LocationStoreDiagnostics>, transaction: SQLite.SQLiteDatabase) {
  const metadataKey = `sync_diagnostics:${key}`;
  const row = await transaction.getFirstAsync<MetadataRow>("select value from location_store_metadata where key=?", metadataKey);
  let previous: Partial<LocationStoreDiagnostics> = {};
  try { previous = JSON.parse(row?.value ?? "{}"); } catch { /* Retain journals if diagnostic metadata is damaged. */ }
  await setMetadata(metadataKey, JSON.stringify({...previous,...patch}), transaction);
}

function locationFailureSummary(error: unknown) {
  if (isMobileTransportFailure(error)) return "transport_failure";
  if (error instanceof MobileHttpResponseError) return `HTTP ${error.statusCode}`;
  if (error instanceof Error && error.name === "MobileRequestTimeoutError") return "operation_timeout";
  return "response_unavailable";
}

function accountKey(context: Pick<LocationAccountContext, "userId" | "workspaceId">) {
  return `${context.workspaceId}:${context.userId}`;
}

function generatedId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function configureLocationAccount(
  context: LocationAccountContext,
  rolloutMode: LocationRolloutMode = "v2_shadow"
) {
  return serialiseLocationMutation(() => configureLocationAccountUnsafe(context, rolloutMode));
}

async function configureLocationAccountUnsafe(
  context: LocationAccountContext,
  rolloutMode: LocationRolloutMode
) {
  const db = await database();
  const key = accountKey(context);
  const previousMode = await getLocationRolloutMode();
  const existingSemanticAcknowledgement = await metadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY);
  const semanticModeAcknowledgedAt = isSemanticMode(rolloutMode)
    ? isSemanticMode(previousMode) && existingSemanticAcknowledgement
      ? existingSemanticAcknowledgement
      : new Date().toISOString()
    : "";
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `insert into location_account_context (account_key, context_json, updated_at) values (?, ?, ?)
       on conflict (account_key) do update set context_json = excluded.context_json, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(context),
      new Date().toISOString()
    );
    await setMetadata(ACTIVE_ACCOUNT_KEY, key, transaction);
    await setMetadata(ACTIVE_DEVICE_KEY, context.deviceId, transaction);
    await setMetadata(ACTIVE_TIME_ZONE_KEY, context.timeZone, transaction);
    await setMetadata(ROLLOUT_MODE_KEY, rolloutMode, transaction);
    await setMetadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY, semanticModeAcknowledgedAt, transaction);
  });
  await rebindUnownedEvidence(key, context);
  return key;
}

function isSemanticMode(mode: LocationRolloutMode) {
  return mode === "v2_review" || mode === "v2_enabled";
}

export async function getLocationRolloutMode(): Promise<LocationRolloutMode> {
  const value = await metadata(ROLLOUT_MODE_KEY);
  return value === "v1" || value === "v2_shadow" || value === "v2_review" || value === "v2_enabled"
    ? value
    : "v2_shadow";
}

async function currentContext() {
  const key = await metadata(ACTIVE_ACCOUNT_KEY);
  if (!key) return null;
  const db = await database();
  const row = await db.getFirstAsync<{ context_json: string }>(
    "select context_json from location_account_context where account_key = ?",
    key
  );
  if (!row) return null;
  return { key, context: JSON.parse(row.context_json) as LocationAccountContext };
}

async function currentContextForOwner(owner: MobileAccountOwner) {
  const current = await currentContext();
  return current?.key === accountKey(owner) ? current : null;
}

export async function getActiveLocationAccountIdentity() {
  const current = await currentContext();
  return current
    ? {
        userId: current.context.userId,
        workspaceId: current.context.workspaceId
      }
    : null;
}

async function rebindUnownedEvidence(key: string, context: LocationAccountContext) {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const rows = await transaction.getAllAsync<EvidenceRow>(
      "select evidence_json from location_evidence_journal where account_key = 'unbound' order by occurred_at"
    );
    for (const row of rows) {
      const evidence = LocationEvidenceSchema.parse(JSON.parse(row.evidence_json));
      const rebound = { ...evidence, deviceId: context.deviceId, timeZone: context.timeZone };
      await transaction.runAsync(
        "update location_evidence_journal set account_key = ?, evidence_json = ? where client_evidence_id = ?",
        key,
        JSON.stringify(rebound),
        evidence.clientEvidenceId
      );
    }
  });
}

function sanitiseEvidence(input: LocationEvidence) {
  const parsed = LocationEvidenceSchema.parse(input);
  if (
    parsed.horizontalAccuracyMeters != null &&
    parsed.horizontalAccuracyMeters > LOCATION_ENGINE_V2_CONFIG.maxAcceptedHorizontalAccuracyMeters
  ) {
    return { ...parsed, latitude: null, longitude: null, altitudeMeters: null, speedMetersPerSecond: null, courseDegrees: null };
  }
  return parsed;
}

export async function persistLocationEvidence(items: LocationEvidence[]) {
  return serialiseLocationMutation(() => persistLocationEvidenceUnsafe(items));
}

async function persistLocationEvidenceUnsafe(items: LocationEvidence[]) {
  if (items.length === 0) return { insertedCount: 0, duplicateCount: 0 };
  const current = await currentContext();
  const key = current?.key ?? "unbound";
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + LOCATION_ENGINE_V2_CONFIG.rawEvidenceRetentionDays * 86_400_000).toISOString();
  const db = await database();
  let insertedCount = 0;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    for (const item of items) {
      const evidence = sanitiseEvidence(item);
      const result = await transaction.runAsync(
        `insert or ignore into location_evidence_journal
         (client_evidence_id, account_key, occurred_at, expires_at, evidence_json, inserted_at)
         values (?, ?, ?, ?, ?, ?)`,
        evidence.clientEvidenceId,
        key,
        evidence.occurredAt,
        expiresAt,
        JSON.stringify(evidence),
        now
      );
      insertedCount += result.changes;
    }
  });
  await applyLocationRetentionUnsafe();
  if (current) await processPendingLocationEvidenceUnsafe();
  return { insertedCount, duplicateCount: items.length - insertedCount };
}

export async function processPendingLocationEvidence(processingAt = new Date().toISOString()) {
  return serialiseLocationMutation(() => processPendingLocationEvidenceUnsafe(processingAt));
}

async function processPendingLocationEvidenceUnsafe(processingAt = new Date().toISOString()) {
  const current = await currentContext();
  if (!current) return [];
  const db = await database();
  const rows = await db.getAllAsync<EvidenceRow>(
    "select evidence_json from location_evidence_journal where account_key = ? order by occurred_at, client_evidence_id",
    current.key
  );
  const previous = await db.getFirstAsync<{ state_json: string }>(
    "select state_json from location_engine_state where account_key = ?",
    current.key
  );
  const priorState: LocationEngineState = previous
    ? JSON.parse(previous.state_json)
    : {
        algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
        mode: "idle",
        activeSegmentId: null,
        processedEvidenceIds: [],
        lastProcessedAt: null
      };
  const output = runLocationEngine({
    priorState,
    evidence: rows.map((row) => LocationEvidenceSchema.parse(JSON.parse(row.evidence_json))),
    savedPlaces: current.context.savedPlaces,
    acceptedLearnedPlaces: current.context.acceptedLearnedPlaces,
    config: LOCATION_ENGINE_V2_CONFIG,
    processingAt
  });
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `insert into location_engine_state (account_key, state_json, updated_at) values (?, ?, ?)
       on conflict (account_key) do update set state_json = excluded.state_json, updated_at = excluded.updated_at`,
      current.key,
      JSON.stringify(output.nextState),
      processingAt
    );
    for (const segment of output.segmentUpserts) {
      await transaction.runAsync(
        `insert into location_segment_snapshot (account_key, client_segment_id, segment_json, updated_at)
         values (?, ?, ?, ?)
         on conflict (account_key, client_segment_id) do update
         set segment_json = excluded.segment_json, updated_at = excluded.updated_at`,
        current.key,
        segment.clientSegmentId,
        JSON.stringify(segment),
        processingAt
      );
    }
    const rejectedCounts = output.rejectedEvidence.reduce<Record<string, number>>((counts, item) => {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1;
      return counts;
    }, {});
    const acceptedTimes = output.acceptedEvidence.map((item) => item.evidence.occurredAt).sort();
    const gaps = output.segmentUpserts.flatMap((segment) =>
      segment.kind === "commute" && segment.continuityStatus === "uncertain_gap"
        ? [segment.gapDurationSeconds]
        : []
    );
    await setMetadata("last_engine_state", output.nextState.mode, transaction);
    await setMetadata(
      "active_provisional_segment_kind",
      output.nextState.mode === "moving" ? "commute" : output.nextState.mode === "idle" ? "" : "stay",
      transaction
    );
    await setMetadata("last_gap_duration_seconds", gaps.length ? String(Math.max(...gaps)) : "", transaction);
    await setMetadata("rejected_evidence_counts", JSON.stringify(rejectedCounts), transaction);
    await setMetadata("last_accepted_evidence_at", acceptedTimes.at(-1) ?? "", transaction);
    await updateOwnedDiagnostics(current.key, {lastEngineState:output.nextState.mode,
      activeProvisionalSegmentKind:output.nextState.mode === "moving" ? "commute" : output.nextState.mode === "idle" ? null : "stay",
      lastGapDurationSeconds:gaps.length ? Math.max(...gaps) : null,rejectedEvidenceCounts:rejectedCounts},transaction);
  });
  return output.segmentUpserts;
}

export async function readLocationSegments(): Promise<LocationSegment[]> {
  const current = await currentContext();
  if (!current) return [];
  const db = await database();
  const rows = await db.getAllAsync<SegmentRow>(
    "select segment_json from location_segment_snapshot where account_key = ? order by updated_at",
    current.key
  );
  return rows.map((row) => JSON.parse(row.segment_json) as LocationSegment);
}

type UploadSelection = { forceUploadRetry?: boolean; excludeBatchIds?: string[]; excludeEvidenceIds?: string[] };
export async function prepareLocationUploadBatch(owner?: MobileAccountOwner, selection: UploadSelection = {}) {
  return serialiseLocationMutation(() => prepareLocationUploadBatchUnsafe(owner,selection));
}

async function prepareLocationUploadBatchUnsafe(owner?: MobileAccountOwner, selection: UploadSelection = {}) {
  const current = owner
    ? await currentContextForOwner(owner)
    : await currentContext();
  if (!current) return null;
  const db = await database();
  const excludedBatches=selection.excludeBatchIds??[];
  const excludedEvidence=selection.excludeEvidenceIds??[];
  const existing = await db.getFirstAsync<OutboxRow>(
    `select account_key, client_batch_id, body_json, attempt_count from location_upload_outbox
     where account_key = ? and state = 'pending'
       and (?=1 or next_attempt_at is null or next_attempt_at <= ?)
       ${excludedBatches.length ? `and client_batch_id not in (${excludedBatches.map(()=>'?').join(',')})` : ''}
     order by created_at, client_batch_id limit 1`,
    current.key,selection.forceUploadRetry?1:0,
    new Date().toISOString(),...excludedBatches
  );
  if (existing) return existing;
  const rows = await db.getAllAsync<EvidenceRow>(
    `select evidence_json from location_evidence_journal
     where account_key = ? and upload_state = 'pending'
       ${excludedEvidence.length ? `and client_evidence_id not in (${excludedEvidence.map(()=>'?').join(',')})` : ''}
     order by occurred_at, client_evidence_id limit ?`,
    current.key,...excludedEvidence,
    Math.max(
      1,
      Math.min(
        LOCATION_ENGINE_V2_CONFIG.maxEvidenceItemsPerUpload,
        Number(await metadata("location_upload_batch_limit")) || LOCATION_ENGINE_V2_CONFIG.maxEvidenceItemsPerUpload
      )
    )
  );
  if (rows.length === 0) return null;
  const clientBatchId = generatedId("location-batch");
  const evidence = rows.map((row) => LocationEvidenceSchema.parse(JSON.parse(row.evidence_json)));
  const body = LocationEvidenceBatchRequestSchema.parse({
    clientBatchId,
    deviceId: current.context.deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    timeZone: current.context.timeZone,
    rolloutMode: await getLocationRolloutMode(),
    semanticModeAcknowledgedAt: (await metadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY)) || undefined,
    evidence
  });
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `insert into location_upload_outbox
       (client_batch_id, account_key, body_json, state, created_at, updated_at)
       values (?, ?, ?, 'pending', ?, ?)`,
      clientBatchId,
      current.key,
      JSON.stringify(body),
      now,
      now
    );
    for (const item of evidence) {
      await transaction.runAsync(
        "update location_evidence_journal set client_batch_id = ?, upload_state = 'batched' where client_evidence_id = ?",
        clientBatchId,
        item.clientEvidenceId
      );
    }
  });
  return {
    account_key: current.key,
    client_batch_id: clientBatchId,
    body_json: JSON.stringify(body),
    attempt_count: 0
  };
}

export type LocationSyncOptions = { forceReplay?: boolean; forceUploadRetry?: boolean; signal?: AbortSignal; deadlineAt?: number };
export type LocationSyncResult = { synced: boolean; reason?: string; message?: string; outcome?: SyncLaneOutcome;
  acknowledgedCount?: number; uploadedBatchCount?: number; replayed?: boolean; finalisedSegmentCount?: number; semanticSegmentCount?: number;
  remainingEvidenceCount?:number|null; remainingBatchCount?:number|null; remainingPendingEvidence?: number|null; remainingBatches?: number|null; rejectedEvidenceCount?: number; nextRetryAt?: string|null; warnings?: string[] };
const locationCoalescer=createOwnerSyncCoalescer<LocationSyncResult>();

export async function syncLocationEvidence(options: LocationSyncOptions = {}): Promise<LocationSyncResult> {
  const owner=await getActiveLocationAccountIdentity();
  if(!owner)return {synced:false,reason:"no_session",outcome:"authentication_required"};
  return locationCoalescer.run(accountKey(owner),Boolean(options.forceReplay||options.forceUploadRetry),async()=>{
    if(!mobileAccountOwnersEqual(await getActiveLocationAccountIdentity(),owner))return {synced:false,reason:"session_changed",outcome:"cancelled"};
    const bounded={...options,deadlineAt:Math.min(options.deadlineAt??Infinity,Date.now()+45_000)};
    const result=await synchroniseLocationEvidenceUnsafe(owner,bounded);
    if(!mobileAccountOwnersEqual(await getActiveLocationAccountIdentity(),owner))return {...result,synced:false,reason:"session_changed",outcome:"cancelled"};
    const db=await database();
    const counts=await db.getFirstAsync<{pending:number;rejected:number}>(`select count(*) filter(where upload_state in ('pending','batched')) as pending,
      count(*) filter(where upload_state='rejected') as rejected from location_evidence_journal where account_key=?`,accountKey(owner));
    const batches=await db.getFirstAsync<{pending:number;nextRetryAt:string|null}>(`select count(*) as pending,min(next_attempt_at) as nextRetryAt
      from location_upload_outbox where account_key=? and state='pending'`,accountKey(owner));
    const remaining=counts?.pending??0;
    const outcome:SyncLaneOutcome=result.outcome??(!result.synced?"server_busy":counts?.rejected?"needs_attention":remaining>0?
      batches?.nextRetryAt&&Date.parse(batches.nextRetryAt)>Date.now()?"backoff":"partial":result.warnings?.length?"partial":"complete");
    return {...result,synced:outcome==="complete",outcome,remainingEvidenceCount:remaining,remainingBatchCount:batches?.pending??0,remainingPendingEvidence:remaining,remainingBatches:batches?.pending??0,
      rejectedEvidenceCount:counts?.rejected??0,nextRetryAt:batches?.nextRetryAt??null};
  },async()=>{});
}

async function synchroniseLocationEvidenceUnsafe(owner:MobileAccountOwner, options:LocationSyncOptions): Promise<LocationSyncResult> {
  let sessionRead: Awaited<ReturnType<typeof readOwnedAuthenticatedSessionSnapshot>>;
  try {
    sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner);
  } catch (error) {
    if (!(error instanceof SecureSessionUnavailableError)) throw error;
    await recordLocationStoreError(error).catch(() => undefined);
    return {
      synced: false,
      reason: "session_unavailable" as const,outcome:"backoff",
      message: error.message,
      acknowledgedCount: 0,
      uploadedBatchCount: 0,
      replayed: false
    };
  }
  if (sessionRead.status !== "authenticated") {
    return { synced: false, reason: "no_session" as const,outcome:"authentication_required" };
  }
  const session = sessionRead.snapshot;
  const db = await database();
  let acknowledgedCount = 0;
  let uploadedBatchCount = 0;
  let rejectedBatchCount = 0;
  const attemptedBatches:string[]=[];const attemptedEvidence:string[]=[];const warnings:string[]=[];
  for (let batchIndex = 0; batchIndex < MAX_LOCATION_UPLOAD_BATCHES_PER_SYNC; batchIndex += 1) {
    if(options.signal?.aborted||Date.now()>=(options.deadlineAt??Infinity)) return {synced:false,outcome:"cancelled",acknowledgedCount,uploadedBatchCount,warnings};
    const preparation = await prepareOwnedLocationBatch({
      isCurrent: () => isLocationSyncOwnershipCurrent(owner, session),
      prepare: () => prepareLocationUploadBatch(owner,{forceUploadRetry:options.forceUploadRetry,excludeBatchIds:attemptedBatches,excludeEvidenceIds:attemptedEvidence})
    });
    if (preparation.status === "session_changed") {
      return interruptedLocationSyncResult(acknowledgedCount, uploadedBatchCount);
    }
    if (preparation.status === "empty") break;
    attemptedBatches.push(preparation.batch.client_batch_id);
    attemptedEvidence.push(...LocationEvidenceBatchRequestSchema.parse(JSON.parse(preparation.batch.body_json)).evidence.map(item=>item.clientEvidenceId));
    const attempt = await uploadLocationEvidenceBatch(
      owner,
      session,
      db,
      preparation.batch, options
    );
    if (attempt.status === "success") {
      warnings.push(...(attempt.warnings??[]));
      acknowledgedCount += attempt.acknowledgedCount;
      uploadedBatchCount += 1;
      continue;
    }
    if (attempt.status === "rejected") {
      rejectedBatchCount += 1;
      continue;
    }
    if (attempt.reason === "session_changed") {
      return interruptedLocationSyncResult(acknowledgedCount, uploadedBatchCount);
    }
    return {
      synced: false,
      reason: attempt.reason,
      outcome: attempt.outcome,
      warnings,
      message: attempt.message,
      acknowledgedCount,
      uploadedBatchCount,
      replayed: false
    };
  }

  const now = Date.now();
  const replayState = await serialiseOwnedLocationMutation(owner, session, async () => ({
    lastAttemptAt: await metadata("last_server_replay_attempt_at")
  }));
  if (!replayState) {
    return interruptedLocationSyncResult(acknowledgedCount, uploadedBatchCount);
  }
  const shouldReplay = shouldRequestLocationReplay({
    force: Boolean(options.forceReplay),
    uploadedBatchCount,
    lastAttemptAt: replayState.lastAttemptAt,
    now
  });
  if (!shouldReplay) {
    return {
      synced: rejectedBatchCount === 0,
      ...(rejectedBatchCount ? { reason: "invalid_batch" as const } : {}),
      acknowledgedCount,
      uploadedBatchCount,
      replayed: false,warnings
    };
  }

  if (!await isLocationSyncOwnershipCurrent(owner, session)) {
    return interruptedLocationSyncResult(acknowledgedCount, uploadedBatchCount);
  }
  const replay = await requestServerLocationReplay(owner, session, now,options);
  return {
    synced: replay.ok && rejectedBatchCount === 0,
    warnings:[...new Set([...warnings,...(replay.ok?replay.warnings??[]:[])])],
    ...(!replay.ok&&"outcome" in replay?{outcome:replay.outcome}:{}),
    ...(!replay.ok
      ? {
          reason: replay.reason === "session_changed"
            ? "session_changed" as const
            : "replay_failed" as const,
          message: replay.message
        }
      : rejectedBatchCount
        ? { reason: "invalid_batch" as const }
        : {}),
    acknowledgedCount,
    uploadedBatchCount,
    replayed: replay.ok,
    ...(replay.ok
      ? {
          finalisedSegmentCount: replay.finalisedSegmentCount,
          semanticSegmentCount: replay.semanticSegmentCount
        }
      : {})
  };
}

function interruptedLocationSyncResult(
  acknowledgedCount: number,
  uploadedBatchCount: number
) {
  return {
    synced: false,
    reason: "session_changed" as const,
    acknowledgedCount,
    uploadedBatchCount,
    replayed: false
  };
}

async function isLocationSyncOwnershipCurrent(
  owner: MobileAccountOwner,
  session: AuthenticatedSessionSnapshot
) {
  if (!isAuthenticatedSessionSnapshotCurrent(session)) return false;
  const activeOwner = await getActiveLocationAccountIdentity();
  return isAuthenticatedSessionSnapshotCurrent(session) &&
    mobileAccountOwnersEqual(activeOwner, owner);
}

async function serialiseOwnedLocationMutation<Result>(
  owner: MobileAccountOwner,
  session: AuthenticatedSessionSnapshot,
  operation: () => Promise<Result>
) {
  return serialiseLocationMutation(async () => {
    if (!await isLocationSyncOwnershipCurrent(owner, session)) return null;
    return operation();
  });
}

async function uploadLocationEvidenceBatch(
  owner: MobileAccountOwner,
  session: AuthenticatedSessionSnapshot,
  db: SQLite.SQLiteDatabase,
  batch: OutboxRow, options:LocationSyncOptions
): Promise<
  | { status: "success"; acknowledgedCount: number; warnings?:string[] }
  | { status: "rejected" }
  | {
      status: "stopped";
      reason: "payload_too_large" | "request_failed" | "session_changed" | "cancelled" | "authentication_required";
      outcome?:SyncLaneOutcome;
      message?: string;
    }
> {
  if (
    batch.account_key !== accountKey(owner) ||
    !await isLocationSyncOwnershipCurrent(owner, session)
  ) {
    return { status: "stopped", reason: "session_changed" };
  }
  try {
    const request = await executeOwnedLocationRequest({
      isCurrent: () => isLocationSyncOwnershipCurrent(owner, session),
      request: () => fetchLocationSync(`${DAYFRAME_API_BASE}/api/location/evidence`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json"
        },
        body: batch.body_json,signal:options.signal
      },Math.max(1,Math.min(15_000,(options.deadlineAt??Date.now()+15_000)-Date.now())),()=>isLocationSyncOwnershipCurrent(owner,session))
    });
    if (request.status === "session_changed") {
      return { status: "stopped", reason: "session_changed" };
    }
    const {response,body} = request.response;
    if (response.status === 401 || response.status === 403) {
      await invalidateMobileSessionIfCurrent(session.token);
      return {status:"stopped",reason:"authentication_required",outcome:"authentication_required"};
    }
    const disposition = locationUploadDisposition(response.status);
    if (disposition === "shrink") {
      const parsed = LocationEvidenceBatchRequestSchema.parse(JSON.parse(batch.body_json));
      const nextLimit = Math.max(1, Math.floor(parsed.evidence.length / 2));
      const applied = await serialiseOwnedLocationMutation(owner, session, () =>
        db.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            "update location_upload_outbox set state = 'rejected', last_error = 'payload_too_large', updated_at = ? where client_batch_id = ?",
            new Date().toISOString(),
            batch.client_batch_id
          );
          await transaction.runAsync(
            `update location_evidence_journal
             set upload_state = ?, client_batch_id = null
             where client_batch_id = ?`,
            parsed.evidence.length > 1 ? "pending" : "rejected",
            batch.client_batch_id
          );
          await setMetadata("location_upload_batch_limit", String(nextLimit), transaction);
          await setMetadata("last_upload_error", "payload_too_large", transaction);
        })
      );
      if (applied === null) return { status: "stopped", reason: "session_changed" };
      return { status: "stopped", reason: "payload_too_large" };
    }
    if (disposition === "reject") {
      const applied = await serialiseOwnedLocationMutation(owner, session, () =>
        db.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            "update location_upload_outbox set state = 'rejected', last_error = 'invalid_batch', updated_at = ? where client_batch_id = ?",
            new Date().toISOString(),
            batch.client_batch_id
          );
          await transaction.runAsync(
            "update location_evidence_journal set upload_state = 'rejected' where client_batch_id = ?",
            batch.client_batch_id
          );
          await setMetadata("last_upload_error", "invalid_batch", transaction);
        })
      );
      if (applied === null) return { status: "stopped", reason: "session_changed" };
      return { status: "rejected" };
    }
    if (!response.ok) throw new MobileHttpResponseError(response.status,`Location evidence sync failed with status ${response.status}.`);
    const payload = body as {
      acknowledgedEvidenceIds?: string[];
      replayVersion?: string;
      rolloutMode?: LocationRolloutMode;
      warnings?: string[];
    };
    const parsedBatch = LocationEvidenceBatchRequestSchema.parse(JSON.parse(batch.body_json));
    const partition = partitionAcknowledgedEvidence(
      parsedBatch.evidence.map((item) => item.clientEvidenceId),
      payload.acknowledgedEvidenceIds ?? []
    );
    const acknowledged = partition.acknowledgedIds;
    const serverMode = LocationRolloutModeSchema.safeParse(payload.rolloutMode);
    const applied = await serialiseOwnedLocationMutation(owner, session, async () => {
      const existingSemanticAcknowledgement = serverMode.success && isSemanticMode(serverMode.data)
        ? await metadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY)
        : null;
      return db.withExclusiveTransactionAsync(async (transaction) => {
        for (const id of acknowledged) {
          await transaction.runAsync(
            "update location_evidence_journal set upload_state = 'acknowledged' where client_evidence_id = ?",
            id
          );
        }
        for (const id of partition.retryIds) {
          await transaction.runAsync(
            "update location_evidence_journal set upload_state = 'pending', client_batch_id = null where client_evidence_id = ?",
            id
          );
        }
        await transaction.runAsync(
          `update location_upload_outbox set state = ?, updated_at = ? where client_batch_id = ?`,
          partition.retryIds.length ? "partial" : "acknowledged",
          new Date().toISOString(),
          batch.client_batch_id
        );
        await setMetadata("last_upload_at", new Date().toISOString(), transaction);
        await setMetadata("last_server_replay_version", payload.replayVersion ?? LOCATION_ENGINE_V2_CONFIG.algorithmVersion, transaction);
        if (serverMode.success) {
          await setMetadata(ROLLOUT_MODE_KEY, serverMode.data, transaction);
          if (isSemanticMode(serverMode.data)) {
            const acknowledgement = isSemanticMode(parsedBatch.rolloutMode) && existingSemanticAcknowledgement
              ? existingSemanticAcknowledgement
              : new Date().toISOString();
            await setMetadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY, acknowledgement, transaction);
          } else {
            await setMetadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY, "", transaction);
          }
        }
        await setMetadata("last_upload_error", partition.retryIds.length?"partial_acknowledgement":"", transaction);
        await setMetadata(`last_upload_warnings:${accountKey(owner)}`,JSON.stringify(payload.warnings??[]),transaction);
        await updateOwnedDiagnostics(accountKey(owner),{lastUploadAt:new Date().toISOString(),lastUploadError:partition.retryIds.length?"partial_acknowledgement":null},transaction);
      });
    });
    if (applied === null) return { status: "stopped", reason: "session_changed" };
    return { status: "success", acknowledgedCount: acknowledged.length,warnings:payload.warnings };
  } catch (error) {
    if(options.signal?.aborted||error instanceof Error&&error.name==="AbortError")return {status:"stopped",reason:"cancelled",outcome:"cancelled"};
    if (!await isLocationSyncOwnershipCurrent(owner, session)) {
      return { status: "stopped", reason: "session_changed" };
    }
    const message = locationFailureSummary(error);
    const exponentialDelay = Math.min(3_600_000, 30_000 * 2 ** Math.min(batch.attempt_count, 7));
    const jitteredDelay = Math.round(exponentialDelay * (0.8 + Math.random() * 0.4));
    const applied = await serialiseOwnedLocationMutation(owner, session, () =>
      db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `update location_upload_outbox
           set attempt_count = attempt_count + 1, last_error = ?,
               next_attempt_at = ?, updated_at = ? where client_batch_id = ?`,
          message,
          new Date(Date.now() + jitteredDelay).toISOString(),
          new Date().toISOString(),
          batch.client_batch_id
        );
        await setMetadata("last_upload_error", message, transaction);
        await updateOwnedDiagnostics(accountKey(owner), {lastUploadError:message},transaction);
      })
    );
    if (applied === null) return { status: "stopped", reason: "session_changed" };
    return { status: "stopped", reason: "request_failed", message,outcome:isMobileTransportFailure(error)?"transport_failure":"server_busy" };
  }
}

async function requestServerLocationReplay(
  owner: MobileAccountOwner,
  session: AuthenticatedSessionSnapshot,
  now: number, options:LocationSyncOptions
) {
  if(options.signal?.aborted||Date.now()>=(options.deadlineAt??Infinity))return {ok:false as const,reason:"cancelled" as const,outcome:"cancelled" as const,message:"Location pass ended."};
  const prepared = await serialiseOwnedLocationMutation(owner, session, async () => {
    const current = await currentContextForOwner(owner);
    if (!current) return null;
    const requestedMode = await getLocationRolloutMode();
    const semanticModeAcknowledgedAt = await metadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY);
    await setMetadata("last_server_replay_attempt_at", new Date(now).toISOString());
    return { current, requestedMode, semanticModeAcknowledgedAt };
  });
  if (!prepared) {
    return {
      ok: false as const,
      reason: "session_changed" as const,
      message: "Location account changed before replay."
    };
  }
  try {
    const request = await executeOwnedLocationRequest({
      isCurrent: () => isLocationSyncOwnershipCurrent(owner, session),
      request: () => fetchLocationSync(`${DAYFRAME_API_BASE}/api/location/replay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json"
        },
        signal:options.signal,
        body: JSON.stringify({
          deviceId: prepared.current.context.deviceId,
          algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
          rolloutMode: prepared.requestedMode,
          ...(prepared.semanticModeAcknowledgedAt
            ? { semanticModeAcknowledgedAt: prepared.semanticModeAcknowledgedAt }
            : {})
        })
      },Math.max(1,Math.min(15_000,(options.deadlineAt??Date.now()+15_000)-Date.now())),()=>isLocationSyncOwnershipCurrent(owner,session))
    });
    if (request.status === "session_changed") {
      return {
        ok: false as const,
        reason: "session_changed" as const,
        message: "Location account changed while replay was running."
      };
    }
    const {response,body} = request.response;
    if (response.status === 401 || response.status === 403) {
      await invalidateMobileSessionIfCurrent(session.token);
      return {ok:false as const,reason:"authentication_required" as const,outcome:"authentication_required" as const,message:"Location requires a new login."};
    }
    if (!response.ok) throw new MobileHttpResponseError(response.status,`Location replay failed with status ${response.status}.`);
    const payload = LocationReplayResponseSchema.parse(body);
    const completedAt = new Date().toISOString();
    const applied = await serialiseOwnedLocationMutation(owner, session, async () => {
      const existingSemanticAcknowledgement = isSemanticMode(payload.rolloutMode)
        ? await metadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY)
        : null;
      const replayDb = await database();
      await replayDb.withExclusiveTransactionAsync(async (transaction) => {
        await setMetadata("last_server_replay_at", completedAt, transaction);
        await setMetadata("last_server_replay_status", "success", transaction);
        await setMetadata("last_server_replay_version", payload.replayVersion, transaction);
        await setMetadata("last_server_replay_finalised_count", String(payload.finalisedSegmentCount), transaction);
        await setMetadata("last_server_replay_semantic_count", String(payload.semanticSegmentCount), transaction);
        await setMetadata("last_server_replay_error", "", transaction);
        await setMetadata(`last_replay_warnings:${accountKey(owner)}`,JSON.stringify(payload.warnings),transaction);
        await updateOwnedDiagnostics(accountKey(owner), {lastServerReplayAt:completedAt,lastServerReplayStatus:"success",
          lastServerReplayVersion:payload.replayVersion,lastServerReplayFinalisedCount:payload.finalisedSegmentCount,
          lastServerReplaySemanticCount:payload.semanticSegmentCount,lastServerReplayError:null},transaction);
        await setMetadata(ROLLOUT_MODE_KEY, payload.rolloutMode, transaction);
        if (isSemanticMode(payload.rolloutMode)) {
          const acknowledgement =
            isSemanticMode(prepared.requestedMode) && existingSemanticAcknowledgement
              ? existingSemanticAcknowledgement
              : completedAt;
          await setMetadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY, acknowledgement, transaction);
        } else {
          await setMetadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY, "", transaction);
        }
      });
    });
    if (applied === null) {
      return {
        ok: false as const,
        reason: "session_changed" as const,
        message: "Location account changed before replay was accepted."
      };
    }
    return {
      ok: true as const,
      finalisedSegmentCount: payload.finalisedSegmentCount,
      semanticSegmentCount: payload.semanticSegmentCount,warnings:payload.warnings
    };
  } catch (error) {
    if(options.signal?.aborted||error instanceof Error&&error.name==="AbortError")return {ok:false as const,reason:"cancelled" as const,outcome:"cancelled" as const,message:"Location pass ended."};
    if (!await isLocationSyncOwnershipCurrent(owner, session)) {
      return {
        ok: false as const,
        reason: "session_changed" as const,
        message: "Location account changed while replay was running."
      };
    }
    const message = locationFailureSummary(error);
    const applied = await serialiseOwnedLocationMutation(owner, session, async () => {
      const replayDb = await database();
      await replayDb.withExclusiveTransactionAsync(async (transaction) => {
        await setMetadata("last_server_replay_status", "failed", transaction);
        await setMetadata("last_server_replay_error", message, transaction);
        await updateOwnedDiagnostics(accountKey(owner), {lastServerReplayStatus:"failed",lastServerReplayError:message},transaction);
      });
    });
    if (applied === null) {
      return {
        ok: false as const,
        reason: "session_changed" as const,
        message: "Location account changed before replay failure was recorded."
      };
    }
    return { ok: false as const, message,outcome:(isMobileTransportFailure(error)?"transport_failure":"server_busy") as SyncLaneOutcome };
  }
}

export async function applyLocationRetention() {
  return serialiseLocationMutation(applyLocationRetentionUnsafe);
}

async function applyLocationRetentionUnsafe() {
  const db = await database();
  const now = new Date().toISOString();
  const expired = await db.runAsync("delete from location_evidence_journal where expires_at < ?", now);
  const count = await db.getFirstAsync<{ count: number }>("select count(*) as count from location_evidence_journal");
  const overflow = (count?.count ?? 0) - MAX_LOCAL_EVIDENCE_ITEMS;
  if (overflow > 0) {
    const result = await db.runAsync(
      `delete from location_evidence_journal where client_evidence_id in (
         select client_evidence_id from location_evidence_journal
         where upload_state in ('acknowledged', 'rejected')
         order by case upload_state when 'acknowledged' then 0 else 1 end, occurred_at
         limit ?
       )`,
      overflow
    );
    const prior = Number(await metadata("dropped_evidence_count") ?? 0);
    await setMetadata("dropped_evidence_count", String(prior + result.changes));
  }
  await setMetadata("retention_cleanup_deleted_count", String(expired.changes));
  await setMetadata("retention_cleanup_at", now);
  return { deletedCount: expired.changes, cleanedAt: now };
}

export async function clearActiveLocationAccountData() {
  return serialiseLocationMutation(clearActiveLocationAccountDataUnsafe);
}

async function clearActiveLocationAccountDataUnsafe() {
  const key = await metadata(ACTIVE_ACCOUNT_KEY);
  if (!key) return;
  const db = await database();
  await db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync("delete from location_evidence_journal where account_key = ?", key);
    await transaction.runAsync("delete from location_engine_state where account_key = ?", key);
    await transaction.runAsync("delete from location_segment_snapshot where account_key = ?", key);
    await transaction.runAsync("delete from location_upload_outbox where account_key = ?", key);
    await transaction.runAsync("delete from location_account_context where account_key = ?", key);
    await transaction.runAsync(
      "delete from location_store_metadata where key in (?, ?, ?, ?, ?)",
      ACTIVE_ACCOUNT_KEY,
      ACTIVE_DEVICE_KEY,
      ACTIVE_TIME_ZONE_KEY,
      ROLLOUT_MODE_KEY,
      SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY
    );
  });
}

export async function deleteRetainedLocationEvidence() {
  return serialiseLocationMutation(deleteRetainedLocationEvidenceUnsafe);
}

async function deleteRetainedLocationEvidenceUnsafe() {
  const current = await currentContext();
  if (!current) return { deletedCount: 0 };
  const db = await database();
  let deletedCount = 0;
  await db.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      "delete from location_evidence_journal where account_key = ?",
      current.key
    );
    deletedCount = result.changes;
    await transaction.runAsync("delete from location_upload_outbox where account_key = ?", current.key);
    await transaction.runAsync("delete from location_engine_state where account_key = ?", current.key);
  });
  return { deletedCount };
}

export async function getLocationStoreDiagnostics(): Promise<LocationStoreDiagnostics> {
  const current = await currentContext();
  const db = await database();
  const counts = current
    ? await db.getFirstAsync<{
        pending: number;
        acknowledged: number;
        segments: number;
        outbox: number;
        oldest: string | null;
        oldestUnsynchronised: string | null;
        lastAccepted: string | null;
      }>(
        `select
          (select count(*) from location_evidence_journal where account_key = ? and upload_state in ('pending', 'batched')) as pending,
          (select count(*) from location_evidence_journal where account_key = ? and upload_state = 'acknowledged') as acknowledged,
          (select count(*) from location_segment_snapshot where account_key = ?) as segments,
          (select count(*) from location_upload_outbox where account_key = ? and state = 'pending') as outbox,
          (select min(occurred_at) from location_evidence_journal where account_key = ?) as oldest,
          (select min(occurred_at) from location_evidence_journal where account_key = ? and upload_state in ('pending', 'batched')) as "oldestUnsynchronised",
          (select max(occurred_at) from location_evidence_journal where account_key = ? and upload_state != 'rejected') as "lastAccepted"`,
        current.key,
        current.key,
        current.key,
        current.key,
        current.key,
        current.key,
        current.key
      )
    : null;
  const retry=current?await db.getFirstAsync<{nextRetryAt:string|null;ready:number}>(`select
    (select min(next_attempt_at) from location_upload_outbox where account_key=? and state='pending') as nextRetryAt,
    (select count(*) from location_evidence_journal where account_key=? and upload_state='pending')+
    (select count(*) from location_upload_outbox where account_key=? and state='pending' and next_attempt_at is null) as ready`,current.key,current.key,current.key):null;
  const warningText=current?await metadata(`last_replay_warnings:${current.key}`):null;
  let owned:Partial<LocationStoreDiagnostics>={};
  try {owned=JSON.parse(current?await metadata(`sync_diagnostics:${current.key}`)??"{}":"{}");} catch {}
  let semanticWarnings:string[]=[];
  for(const raw of [warningText,current?await metadata(`last_upload_warnings:${current.key}`):null]) {try {const parsed=JSON.parse(raw??"[]");if(Array.isArray(parsed))semanticWarnings.push(...parsed.filter(value=>typeof value==="string"));} catch {}}
  return {
    nextRetryAt:retry?.ready?null:retry?.nextRetryAt??null,semanticWarnings,
    engineVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    rolloutMode: await getLocationRolloutMode(),
    accountConfigured: Boolean(current),
    savedPlaceCatalogueCount: current?.context.savedPlaces.length ?? 0,
    pendingEvidenceCount: counts?.pending ?? 0,
    acknowledgedEvidenceCount: counts?.acknowledged ?? 0,
    outboxCount: counts?.outbox ?? 0,
    segmentCount: counts?.segments ?? 0,
    oldestEvidenceAt: counts?.oldest ?? null,
    oldestUnsynchronisedAt: counts?.oldestUnsynchronised ?? null,
    lastAcceptedEvidenceAt: counts?.lastAccepted ?? null,
    lastEngineState: owned.lastEngineState ?? null,
    activeProvisionalSegmentKind: owned.activeProvisionalSegmentKind ?? null,
    lastGapDurationSeconds: owned.lastGapDurationSeconds ?? null,
    rejectedEvidenceCounts: owned.rejectedEvidenceCounts ?? {},
    lastUploadAt: owned.lastUploadAt ?? null,
    lastServerReplayVersion: owned.lastServerReplayVersion ?? null,
    lastServerReplayAt: owned.lastServerReplayAt ?? null,
    lastServerReplayStatus: owned.lastServerReplayStatus ?? null,
    lastServerReplayFinalisedCount: owned.lastServerReplayFinalisedCount ?? 0,
    lastServerReplaySemanticCount: owned.lastServerReplaySemanticCount ?? 0,
    lastServerReplayError: owned.lastServerReplayError ?? null,
    lastUploadError: owned.lastUploadError ?? null,
    droppedEvidenceCount: Number(await metadata("dropped_evidence_count") ?? 0),
    retentionCleanupDeletedCount: Number(await metadata("retention_cleanup_deleted_count") ?? 0),
    retentionCleanupAt: await metadata("retention_cleanup_at")
  };
}

function parseReplayStatus(value: string | null): LocationStoreDiagnostics["lastServerReplayStatus"] {
  return value === "success" || value === "failed" ? value : null;
}

function parseDiagnosticCounts(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, count]) =>
        typeof count === "number" && Number.isFinite(count) ? [[key, count]] : []
      )
    );
  } catch {
    return {};
  }
}

export async function recordLocationStoreError(error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 200) : "Location service failed.";
  await serialiseLocationMutation(() => setMetadata("last_upload_error", message));
}

export function evidenceFromExpoLocation(input: {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
  };
  timestamp: number;
  mocked?: boolean;
}, context: { deviceId: string; timeZone: string }, kind: LocationEvidence["kind"] = "standard_location") {
  const occurredAt = new Date(input.timestamp).toISOString();
  return LocationEvidenceSchema.parse({
    clientEvidenceId: `${context.deviceId}-${kind}-${input.timestamp}`,
    deviceId: context.deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind,
    occurredAt,
    latitude: input.coords.latitude,
    longitude: input.coords.longitude,
    horizontalAccuracyMeters: input.coords.accuracy ?? null,
    altitudeMeters: input.coords.altitude ?? null,
    speedMetersPerSecond: input.coords.speed != null && input.coords.speed >= 0 ? input.coords.speed : null,
    courseDegrees: input.coords.heading != null && input.coords.heading >= 0 ? input.coords.heading : null,
    sourceTimestamp: occurredAt,
    receivedAt: new Date().toISOString(),
    timeZone: context.timeZone,
    isSimulated: input.mocked ?? false
  });
}

export async function activeLocationCaptureContext() {
  return {
    deviceId: await metadata(ACTIVE_DEVICE_KEY),
    timeZone: await metadata(ACTIVE_TIME_ZONE_KEY)
  };
}
