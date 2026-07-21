import * as SQLite from "expo-sqlite";
import {
  LOCATION_ENGINE_V2_CONFIG,
  LocationEvidenceBatchRequestSchema,
  LocationEvidenceSchema,
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
import { clearSessionToken, getSessionToken } from "../api";
import { createSerialMutationQueue } from "./mutationQueue";
import { locationUploadDisposition, partitionAcknowledgedEvidence } from "./uploadPolicy";

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
  lastUploadError: string | null;
  droppedEvidenceCount: number;
  retentionCleanupDeletedCount: number;
  retentionCleanupAt: string | null;
};

type MetadataRow = { value: string };
type EvidenceRow = { evidence_json: string };
type SegmentRow = { segment_json: string };
type OutboxRow = { client_batch_id: string; body_json: string; attempt_count: number };

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let synchronisationPromise: Promise<Awaited<ReturnType<typeof synchroniseLocationEvidenceUnsafe>>> | null = null;
const serialiseLocationMutation = createSerialMutationQueue();

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

export async function prepareLocationUploadBatch() {
  return serialiseLocationMutation(prepareLocationUploadBatchUnsafe);
}

async function prepareLocationUploadBatchUnsafe() {
  const current = await currentContext();
  if (!current) return null;
  const db = await database();
  const existing = await db.getFirstAsync<OutboxRow>(
    `select client_batch_id, body_json, attempt_count from location_upload_outbox
     where account_key = ? and state = 'pending'
       and (next_attempt_at is null or next_attempt_at <= ?)
     order by created_at limit 1`,
    current.key,
    new Date().toISOString()
  );
  if (existing) return existing;
  const rows = await db.getAllAsync<EvidenceRow>(
    `select evidence_json from location_evidence_journal
     where account_key = ? and upload_state = 'pending'
     order by occurred_at, client_evidence_id limit ?`,
    current.key,
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
  return { client_batch_id: clientBatchId, body_json: JSON.stringify(body), attempt_count: 0 };
}

export async function syncLocationEvidence() {
  synchronisationPromise ??= synchroniseLocationEvidenceUnsafe().finally(() => {
    synchronisationPromise = null;
  });
  return synchronisationPromise;
}

async function synchroniseLocationEvidenceUnsafe() {
  const token = await getSessionToken();
  if (!token) return { synced: false, reason: "no_session" as const };
  const batch = await prepareLocationUploadBatch();
  if (!batch) return { synced: true, acknowledgedCount: 0 };
  const db = await database();
  try {
    const response = await fetch(`${DAYFRAME_API_BASE}/api/location/evidence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: batch.body_json
    });
    if (response.status === 401 || response.status === 403) {
      await clearSessionToken();
      throw new Error("Location evidence sync requires a new login.");
    }
    const disposition = locationUploadDisposition(response.status);
    if (disposition === "shrink") {
      const parsed = LocationEvidenceBatchRequestSchema.parse(JSON.parse(batch.body_json));
      const nextLimit = Math.max(1, Math.floor(parsed.evidence.length / 2));
      await serialiseLocationMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
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
      }));
      return { synced: false, reason: "payload_too_large" as const };
    }
    if (disposition === "reject") {
      await serialiseLocationMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
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
      }));
      return { synced: false, reason: "invalid_batch" as const };
    }
    if (!response.ok) throw new Error(`Location evidence sync failed with status ${response.status}.`);
    const payload = await response.json() as {
      acknowledgedEvidenceIds?: string[];
      replayVersion?: string;
      rolloutMode?: LocationRolloutMode;
    };
    const parsedBatch = LocationEvidenceBatchRequestSchema.parse(JSON.parse(batch.body_json));
    const partition = partitionAcknowledgedEvidence(
      parsedBatch.evidence.map((item) => item.clientEvidenceId),
      payload.acknowledgedEvidenceIds ?? []
    );
    const acknowledged = partition.acknowledgedIds;
    const serverMode = LocationRolloutModeSchema.safeParse(payload.rolloutMode);
    const existingSemanticAcknowledgement = serverMode.success && isSemanticMode(serverMode.data)
      ? await metadata(SEMANTIC_MODE_ACKNOWLEDGED_AT_KEY)
      : null;
    await serialiseLocationMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
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
      await setMetadata("last_upload_error", "", transaction);
    }));
    return { synced: true, acknowledgedCount: acknowledged.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "Location evidence sync failed.";
    const exponentialDelay = Math.min(3_600_000, 30_000 * 2 ** Math.min(batch.attempt_count, 7));
    const jitteredDelay = Math.round(exponentialDelay * (0.8 + Math.random() * 0.4));
    await serialiseLocationMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
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
    }));
    return { synced: false, reason: "request_failed" as const, message };
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
          (select count(*) from location_evidence_journal where account_key = ? and upload_state != 'acknowledged') as pending,
          (select count(*) from location_evidence_journal where account_key = ? and upload_state = 'acknowledged') as acknowledged,
          (select count(*) from location_segment_snapshot where account_key = ?) as segments,
          (select count(*) from location_upload_outbox where account_key = ? and state = 'pending') as outbox,
          (select min(occurred_at) from location_evidence_journal where account_key = ?) as oldest,
          (select min(occurred_at) from location_evidence_journal where account_key = ? and upload_state != 'acknowledged') as "oldestUnsynchronised",
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
  return {
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
    lastAcceptedEvidenceAt: counts?.lastAccepted ?? ((await metadata("last_accepted_evidence_at")) || null),
    lastEngineState: await metadata("last_engine_state"),
    activeProvisionalSegmentKind: (await metadata("active_provisional_segment_kind")) || null,
    lastGapDurationSeconds: Number(await metadata("last_gap_duration_seconds")) || null,
    rejectedEvidenceCounts: parseDiagnosticCounts(await metadata("rejected_evidence_counts")),
    lastUploadAt: await metadata("last_upload_at"),
    lastServerReplayVersion: await metadata("last_server_replay_version"),
    lastUploadError: (await metadata("last_upload_error")) || null,
    droppedEvidenceCount: Number(await metadata("dropped_evidence_count") ?? 0),
    retentionCleanupDeletedCount: Number(await metadata("retention_cleanup_deleted_count") ?? 0),
    retentionCleanupAt: await metadata("retention_cleanup_at")
  };
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
