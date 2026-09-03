import * as SQLite from "expo-sqlite";
import { REVIEW_EFFECTS_V5_SQL } from "./reviewSyncSchema";
import {
  LocationReviewEvidenceDtoSchema,
  ReviewMutationEnvelopeSchema,
  ReviewMutationSchema,
  type LocationReviewEvidenceDto,
  type ReviewMutation,
  type ReviewMutationEnvelope
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileRequestTimeoutError,
  mobileFetchWithTimeout
} from "./mobile-network";
import {
  invalidateMobileSessionIfCurrent,
  isAuthenticatedSessionSnapshotCurrent,
  readOwnedAuthenticatedSessionSnapshot
} from "./secure-session";
import type {
  MobileBootstrap,
  MobileReviewItem
} from "./api";
import { createSerialMutationQueue } from "./location/mutationQueue";
import { isLocationReviewItem } from "./review";

const DATABASE_NAME = "dayframe-review-sync.db";
const DATABASE_VERSION = 5;
const ACTIVE_ACCOUNT_KEY = "active_account";
const LAST_CACHE_AT_KEY = "last_cache_at";
const LAST_SUCCESSFUL_SYNC_AT_KEY = "last_successful_sync_at";
export const LOCATION_REVIEW_EVIDENCE_MAX_AGE_MS = 7 * 86_400_000;
export const LOCATION_REVIEW_EVIDENCE_MAX_ITEMS = 25;
export const LOCATION_REVIEW_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const REVIEW_SYNC_REQUEST_TIMEOUT_MS = 15_000;
const SYNC_STATES = [
  "pending",
  "in_flight",
  "retry_wait",
  "auth_required",
  "needs_attention",
  "acknowledged"
] as const;

export type ReviewMutationState = typeof SYNC_STATES[number];
export type ReviewItemSyncState = {
  action: string;
  state: ReviewMutationState;
};

export type ReviewSyncDiagnostics = {
  pendingCount: number;
  retryWaitCount: number;
  authenticationRequiredCount: number;
  needsAttentionCount: number;
  acknowledgedCount: number;
  waitingCount: number;
  oldestQueuedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  lastCachedAt: string | null;
  reviewCacheHitCount: number;
  reviewCacheMissCount: number;
  lastReviewCacheAgeMs: number | null;
  evidenceCacheItemCount: number;
  evidenceCacheBytes: number;
  evidenceCacheHitCount: number;
  evidenceCacheMissCount: number;
  lastEvidenceCacheAgeMs: number | null;
  lastEvidencePayloadBytes: number | null;
  lastLocalMutationAction: string | null;
  lastLocalMutationCommitDurationMs: number | null;
  lastLocalMutationCommittedAt: string | null;
};

export type ReviewSyncResult = {
  acknowledgedCount: number;
  waitingCount: number;
  needsAttentionCount: number;
  stopped: boolean;
  reason?: "no_account" | "no_session" | "retryable_failure";
};

export type ReviewSyncDiagnosticMutation = {
  clientMutationId: string;
  reviewItemId: string;
  action: string;
  state: ReviewMutationState;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptedAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
};

type AccountRow = {
  account_key: string;
  workspace_id: string;
  user_id: string;
  workspace_name: string;
};

type MutationRow = {
  client_mutation_id: string;
  account_key: string;
  workspace_id: string;
  user_id: string;
  review_item_id: string;
  action_kind: string;
  request_json: string;
  original_snapshot_json: string;
  original_position: number;
  preceding_ids_json: string;
  following_ids_json: string;
  state: ReviewMutationState;
  local_effect: "hidden" | "restore";
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
};

type CachedReviewRow = {
  snapshot_json: string;
  position: number;
  cached_at: string;
};

type CachedCategoryRow = {
  category_json: string;
};

type CachedDashboardRow = {
  snapshot_json: string;
  cached_at: string;
};

type CountRow = {
  pending_count: number;
  retry_wait_count: number;
  auth_required_count: number;
  needs_attention_count: number;
  acknowledged_count: number;
  oldest_queued_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
};

type CachedEvidenceRow = {
  evidence_json: string;
  fetched_at: string;
  expires_at: string;
  byte_size: number;
};

type EvidenceCacheSizeRow = {
  review_item_id: string;
  byte_size: number;
};

export type LocationReviewEvidenceCacheDiagnostics = {
  itemCount: number;
  totalBytes: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let synchronisationPromise: Promise<ReviewSyncResult> | null = null;
let synchronisationRequested = false;
let forcedSynchronisationRequested = false;
let reviewCacheHitCount = 0;
let reviewCacheMissCount = 0;
let lastReviewCacheAgeMs: number | null = null;
let evidenceCacheHitCount = 0;
let evidenceCacheMissCount = 0;
let lastEvidenceCacheAgeMs: number | null = null;
let lastEvidencePayloadBytes: number | null = null;
let lastLocalMutationAction: string | null = null;
let lastLocalMutationCommitDurationMs: number | null = null;
let lastLocalMutationCommittedAt: string | null = null;
const serialiseReviewMutation = createSerialMutationQueue();
const listeners = new Set<() => void>();

async function database() {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"
    );
    const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    if ((version?.user_version ?? 0) < DATABASE_VERSION) {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync(`
          create table if not exists review_store_metadata (
            key text primary key not null,
            value text not null,
            updated_at text not null
          );
          create table if not exists review_account_context (
            account_key text primary key not null,
            workspace_id text not null,
            user_id text not null,
            workspace_name text not null,
            configured_at text not null,
            updated_at text not null,
            unique(workspace_id, user_id)
          );
          create table if not exists review_item_cache (
            account_key text not null,
            review_item_id text not null,
            snapshot_json text not null,
            server_status text not null,
            position integer not null,
            cached_at text not null,
            primary key(account_key, review_item_id),
            foreign key(account_key) references review_account_context(account_key) on delete cascade
          );
          create index if not exists review_item_cache_order_idx
            on review_item_cache(account_key, position, cached_at);
          create table if not exists review_category_cache (
            account_key text not null,
            category_id text not null,
            category_json text not null,
            cached_at text not null,
            primary key(account_key, category_id),
            foreign key(account_key) references review_account_context(account_key) on delete cascade
          );
          create table if not exists dashboard_snapshot_cache (
            account_key text primary key not null,
            snapshot_json text not null,
            cached_at text not null,
            foreign key(account_key) references review_account_context(account_key) on delete cascade
          );
          create table if not exists review_mutation_outbox (
            client_mutation_id text primary key not null,
            account_key text not null,
            workspace_id text not null,
            user_id text not null,
            review_item_id text not null,
            action_kind text not null,
            request_json text not null,
            original_snapshot_json text not null,
            original_position integer not null,
            preceding_ids_json text not null,
            following_ids_json text not null,
            state text not null,
            local_effect text not null default 'hidden',
            attempt_count integer not null default 0,
            next_attempt_at text,
            last_attempted_at text,
            last_http_status integer,
            last_error text,
            created_at text not null,
            updated_at text not null,
            acknowledged_at text,
            foreign key(account_key) references review_account_context(account_key) on delete cascade,
            check(state in ('pending', 'in_flight', 'retry_wait', 'auth_required', 'needs_attention', 'acknowledged')),
            check(local_effect in ('hidden', 'restore'))
          );
          create unique index if not exists review_mutation_item_active_idx
            on review_mutation_outbox(account_key, review_item_id);
          create index if not exists review_mutation_drain_idx
            on review_mutation_outbox(account_key, state, next_attempt_at, created_at);
          create table if not exists location_review_evidence_cache (
            account_key text not null,
            review_item_id text not null,
            evidence_json text not null,
            fetched_at text not null,
            expires_at text not null,
            byte_size integer not null,
            last_accessed_at text not null,
            primary key(account_key, review_item_id),
            foreign key(account_key)
              references review_account_context(account_key)
              on delete cascade
          );
          create index if not exists location_review_evidence_expiry_idx
            on location_review_evidence_cache(account_key, expires_at);
          create index if not exists location_review_evidence_lru_idx
            on location_review_evidence_cache(account_key, last_accessed_at);
        `);
        if ((version?.user_version ?? 0) < 2) {
          await transaction.execAsync(`
            update review_mutation_outbox
            set local_effect = case
              when state = 'acknowledged' then 'hidden'
              else 'restore'
            end;
          `);
        }
        if ((version?.user_version ?? 0) < 4) {
          await transaction.execAsync(`
            update review_mutation_outbox
            set local_effect = 'hidden'
            where state in (
              'pending',
              'in_flight',
              'retry_wait',
              'auth_required',
              'acknowledged'
            );
          `);
        }
        await transaction.execAsync(REVIEW_EFFECTS_V5_SQL);
        await transaction.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
      });
    }
    await db.runAsync(
      `update review_mutation_outbox
       set state = 'pending',
           next_attempt_at = null,
           updated_at = ?
       where state = 'in_flight'`,
      new Date().toISOString()
    );
    return db;
  });
  return databasePromise;
}

function accountKey(input: { workspaceId: string; userId: string }) {
  return `${input.workspaceId}:${input.userId}`;
}

function accountMetadataKey(key: string, accountKeyValue: string) {
  return `${key}:${accountKeyValue}`;
}

async function metadata(
  key: string,
  transaction?: SQLite.SQLiteDatabase
) {
  const db = transaction ?? await database();
  return (await db.getFirstAsync<{ value: string }>(
    "select value from review_store_metadata where key = ?",
    key
  ))?.value ?? null;
}

async function setMetadata(
  key: string,
  value: string,
  transaction?: SQLite.SQLiteDatabase
) {
  const db = transaction ?? await database();
  await db.runAsync(
    `insert into review_store_metadata (key, value, updated_at)
     values (?, ?, ?)
     on conflict(key) do update
       set value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString()
  );
}

async function activeAccount(transaction?: SQLite.SQLiteDatabase) {
  const db = transaction ?? await database();
  const key = await metadata(ACTIVE_ACCOUNT_KEY, db);
  if (!key) return null;
  return await db.getFirstAsync<AccountRow>(
    `select account_key, workspace_id, user_id, workspace_name
     from review_account_context
     where account_key = ?`,
    key
  );
}

export async function getActiveReviewAccountIdentity() {
  const account = await activeAccount();
  return account
    ? {
        workspaceId: account.workspace_id,
        userId: account.user_id,
        workspaceName: account.workspace_name
      }
    : null;
}

export function createReviewClientMutationId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

export async function processReviewBootstrap(bootstrap: MobileBootstrap) {
  const parsedAccount = {
    workspaceId: bootstrap.workspace.id,
    userId: bootstrap.user.id
  };
  const key = accountKey(parsedAccount);
  const now = new Date().toISOString();
  const db = await database();

  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const previousAccount = await activeAccount(transaction);
      if (previousAccount && previousAccount.account_key !== key) {
        await transaction.runAsync(
          "delete from review_account_context where account_key = ?",
          previousAccount.account_key
        );
        await transaction.runAsync(
          "delete from review_store_metadata where key like ?",
          `%:${previousAccount.account_key}`
        );
      }
      await transaction.runAsync(
        `insert into review_account_context (
           account_key, workspace_id, user_id, workspace_name, configured_at, updated_at
         ) values (?, ?, ?, ?, ?, ?)
         on conflict(account_key) do update set
           workspace_name = excluded.workspace_name,
           configured_at = excluded.configured_at,
           updated_at = excluded.updated_at`,
        key,
        bootstrap.workspace.id,
        bootstrap.user.id,
        bootstrap.workspace.name,
        now,
        now
      );
      await setMetadata(ACTIVE_ACCOUNT_KEY, key, transaction);
      await setMetadata(
        accountMetadataKey(LAST_CACHE_AT_KEY, key),
        now,
        transaction
      );
      await transaction.runAsync(
        `update review_mutation_outbox
         set state = 'pending',
             next_attempt_at = null,
             last_error = null,
             updated_at = ?
         where account_key = ? and state = 'auth_required'`,
        now,
        key
      );
      await transaction.runAsync(
        "delete from review_item_cache where account_key = ?",
        key
      );
      for (const [position, item] of bootstrap.reviewItems.entries()) {
        if (item.status !== "open") continue;
        await transaction.runAsync(
          `insert into review_item_cache (
             account_key, review_item_id, snapshot_json, server_status, position, cached_at
           ) values (?, ?, ?, ?, ?, ?)`,
          key,
          item.id,
          JSON.stringify(sanitiseReviewItemForCache(item)),
          item.status,
          position,
          now
        );
      }
      await transaction.runAsync(
        "delete from review_category_cache where account_key = ?",
        key
      );
      for (const category of bootstrap.categories) {
        await transaction.runAsync(
          `insert into review_category_cache (
             account_key, category_id, category_json, cached_at
           ) values (?, ?, ?, ?)`,
          key,
          category.id,
          JSON.stringify(category),
          now
        );
      }
      const openIds = new Set(
        bootstrap.reviewItems
          .filter((item) => item.status === "open")
          .map((item) => item.id)
      );
      const commuteIds = new Set(
        bootstrap.reviewItems
          .filter((item) => item.status === "open" && item.eventType === "commute_detected")
          .map((item) => item.id)
      );
      for (const commuteId of commuteIds) {
        await transaction.runAsync(
          `delete from review_mutation_outbox
           where account_key = ? and review_item_id = ?
             and action_kind in (
               'split', 'split_and_confirm', 'merge', 'merge_and_confirm',
               'record_poi_once', 'save_place_and_confirm'
             )
             and state = 'needs_attention' and last_http_status = 422
             and last_error like '%invalid_action%'`,
          key,
          commuteId
        );
      }
      const acknowledged = await transaction.getAllAsync<{
        client_mutation_id: string;
        review_item_id: string;
      }>(
        `select o.client_mutation_id, e.review_item_id
         from review_mutation_outbox o
         join review_mutation_effects e on e.client_mutation_id = o.client_mutation_id and e.account_key = o.account_key
         where o.account_key = ? and o.state = 'acknowledged'`,
        key
      );
      for (const row of acknowledged) {
        if (!acknowledged.some((effect) => effect.client_mutation_id === row.client_mutation_id && openIds.has(effect.review_item_id))) {
          await transaction.runAsync(
            "delete from review_mutation_outbox where client_mutation_id = ?",
            row.client_mutation_id
          );
        }
      }
      await transaction.runAsync(
        `update review_mutation_effects set local_effect = 'hidden'
         where account_key = ? and local_effect = 'restore'
           and not exists (select 1 from review_item_cache c
             where c.account_key = review_mutation_effects.account_key
               and c.review_item_id = review_mutation_effects.review_item_id and c.server_status = 'open')`, key
      );
      const cachedEvidence = await transaction.getAllAsync<{
        review_item_id: string;
      }>(
        `select review_item_id
         from location_review_evidence_cache
         where account_key = ?`,
        key
      );
      for (const row of cachedEvidence) {
        if (!openIds.has(row.review_item_id)) {
          await transaction.runAsync(
            `delete from location_review_evidence_cache
             where account_key = ? and review_item_id = ?`,
            key,
            row.review_item_id
          );
        }
      }
      await pruneLocationReviewEvidenceCacheForAccount(transaction, key, now);
    })
  );

  emitChange();
  return projectReviewBootstrap(bootstrap, await hiddenReviewItemIds(key));
}

export async function activateReviewAccount(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
}) {
  const db = await database();
  const key = accountKey(input);
  const now = new Date().toISOString();
  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const previousAccount = await activeAccount(transaction);
      if (previousAccount && previousAccount.account_key !== key) {
        await transaction.runAsync(
          "delete from review_account_context where account_key = ?",
          previousAccount.account_key
        );
        await transaction.runAsync(
          "delete from review_store_metadata where key like ?",
          `%:${previousAccount.account_key}`
        );
      }
      await transaction.runAsync(
        `insert into review_account_context (
           account_key, workspace_id, user_id, workspace_name, configured_at, updated_at
         ) values (?, ?, ?, ?, ?, ?)
         on conflict(account_key) do update set
           workspace_name = excluded.workspace_name,
           configured_at = excluded.configured_at,
           updated_at = excluded.updated_at`,
        key,
        input.workspaceId,
        input.userId,
        input.workspaceName,
        now,
        now
      );
      await setMetadata(ACTIVE_ACCOUNT_KEY, key, transaction);
      await transaction.runAsync(
        `update review_mutation_outbox
         set state = 'pending',
             next_attempt_at = null,
             last_error = null,
             updated_at = ?
         where account_key = ? and state = 'auth_required'`,
        now,
        key
      );
    })
  );
  emitChange();
}

export async function loadCachedReviewBootstrap(): Promise<{
  bootstrap: MobileBootstrap;
  cachedAt: string | null;
} | null> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) {
    reviewCacheMissCount += 1;
    return null;
  }
  const categories = await db.getAllAsync<CachedCategoryRow>(
    `select category_json
     from review_category_cache
     where account_key = ?
     order by rowid`,
    account.account_key
  );
  const cached = await db.getAllAsync<CachedReviewRow>(
    `select snapshot_json, position, cached_at
     from review_item_cache
     where account_key = ?
     order by position, cached_at`,
    account.account_key
  );
  const restored = await db.getAllAsync<{
    original_snapshot_json: string;
    original_position: number;
    preceding_ids_json: string;
    following_ids_json: string;
    created_at: string;
  }>(
    `select e.snapshot_json as original_snapshot_json, e.original_position,
            e.preceding_ids_json, e.following_ids_json, o.created_at
     from review_mutation_effects e
     join review_mutation_outbox o on o.client_mutation_id = e.client_mutation_id and o.account_key = e.account_key
     where e.account_key = ? and e.local_effect = 'restore'
     order by e.original_position, o.created_at, e.review_item_id`,
    account.account_key
  );
  const cachedItems = cached.flatMap((row) => {
    const item = parseReviewSnapshot(row.snapshot_json);
    return item ? [{ item, position: row.position }] : [];
  });
  const orderedItems = restoreReviewItemsWithAnchors(
    cachedItems
      .sort((left, right) => left.position - right.position)
      .map(({ item }) => item),
    restored.flatMap((row) => {
      const item = parseReviewSnapshot(row.original_snapshot_json);
      return item
        ? [{
            item,
            originalPosition: row.original_position,
            precedingIds: parseStringArray(row.preceding_ids_json),
            followingIds: parseStringArray(row.following_ids_json)
          }]
        : [];
    })
  );
  const hiddenIds = await hiddenReviewItemIds(account.account_key);
  const reviewItems = orderedItems.filter((item) => !hiddenIds.has(item.id));
  const cachedAt = await metadata(
    accountMetadataKey(LAST_CACHE_AT_KEY, account.account_key),
    db
  );
  if (!cachedAt) {
    reviewCacheMissCount += 1;
    return null;
  }
  reviewCacheHitCount += 1;
  lastReviewCacheAgeMs = ageMilliseconds(cachedAt);
  return {
    cachedAt,
    bootstrap: {
      user: {
        id: account.user_id,
        email: "",
        name: ""
      },
      workspace: {
        id: account.workspace_id,
        name: account.workspace_name
      },
      activeEntry: null,
      projects: [],
      categories: categories.flatMap((row) => {
        try {
          return [JSON.parse(row.category_json) as MobileBootstrap["categories"][number]];
        } catch {
          return [];
        }
      }),
      entries: [],
      places: [],
      reviewItems,
      stats: {
        todaySeconds: 0,
        weekSeconds: 0,
        reviewCount: reviewItems.length
      }
    }
  };
}

export async function projectReviewBootstrapFromStore(
  bootstrap: MobileBootstrap
): Promise<MobileBootstrap> {
  const db = await database();
  const account = await activeAccount(db);
  if (
    !account ||
    account.workspace_id !== bootstrap.workspace.id ||
    account.user_id !== bootstrap.user.id
  ) {
    return bootstrap;
  }
  return projectReviewBootstrap(
    bootstrap,
    await hiddenReviewItemIds(account.account_key)
  );
}

export async function loadCachedLocationReviewEvidence(
  reviewItemId: string
): Promise<{
  evidence: LocationReviewEvidenceDto;
  fetchedAt: string;
  expiresAt: string;
} | null> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return null;
  const row = await db.getFirstAsync<CachedEvidenceRow>(
    `select evidence_json, fetched_at, expires_at, byte_size
     from location_review_evidence_cache
     where account_key = ? and review_item_id = ?`,
    account.account_key,
    reviewItemId
  );
  if (!row) {
    evidenceCacheMissCount += 1;
    return null;
  }
  if (!isFutureIso(row.expires_at)) {
    evidenceCacheMissCount += 1;
    await serialiseReviewMutation(() =>
      db.runAsync(
        `delete from location_review_evidence_cache
         where account_key = ? and review_item_id = ?`,
        account.account_key,
        reviewItemId
      )
    );
    return null;
  }
  try {
    const evidence = LocationReviewEvidenceDtoSchema.parse(
      JSON.parse(row.evidence_json)
    );
    if (evidence.reviewItemId !== reviewItemId) throw new Error("Evidence identity mismatch.");
    await serialiseReviewMutation(() =>
      db.runAsync(
        `update location_review_evidence_cache
         set last_accessed_at = ?
         where account_key = ? and review_item_id = ?`,
        new Date().toISOString(),
        account.account_key,
        reviewItemId
      )
    );
    evidenceCacheHitCount += 1;
    lastEvidenceCacheAgeMs = ageMilliseconds(row.fetched_at);
    lastEvidencePayloadBytes = Math.max(0, Number(row.byte_size) || 0);
    return {
      evidence,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at
    };
  } catch {
    evidenceCacheMissCount += 1;
    await serialiseReviewMutation(() =>
      db.runAsync(
        `delete from location_review_evidence_cache
         where account_key = ? and review_item_id = ?`,
        account.account_key,
        reviewItemId
      )
    );
    return null;
  }
}

export async function cacheLocationReviewEvidence(input: {
  expectedWorkspaceId: string;
  expectedUserId: string;
  reviewItemId: string;
  evidence: LocationReviewEvidenceDto;
  fetchedAt?: string;
  isStillCurrent?: () => boolean;
}) {
  const evidence = LocationReviewEvidenceDtoSchema.parse(input.evidence);
  if (evidence.reviewItemId !== input.reviewItemId) {
    throw new Error("Location evidence does not match this Review item.");
  }
  const fetchedAt = validIso(input.fetchedAt) ?? new Date().toISOString();
  const expiresAt = locationReviewEvidenceExpiry(evidence, fetchedAt);
  const evidenceJson = JSON.stringify(evidence);
  const byteSize = utf8ByteSize(evidenceJson);
  const key = accountKey({
    workspaceId: input.expectedWorkspaceId,
    userId: input.expectedUserId
  });
  const db = await database();
  let written = false;
  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const discardIfUnchanged = () => transaction.runAsync(
        `delete from location_review_evidence_cache
         where account_key = ? and review_item_id = ?
           and fetched_at = ? and evidence_json = ?`,
        key,
        input.reviewItemId,
        fetchedAt,
        evidenceJson
      );
      if (input.isStillCurrent && !input.isStillCurrent()) return;
      const account = await activeAccount(transaction);
      if (!account || account.account_key !== key) return;
      if (input.isStillCurrent && !input.isStillCurrent()) return;
      if (!isFutureIso(expiresAt)) {
        await transaction.runAsync(
          `delete from location_review_evidence_cache
           where account_key = ? and review_item_id = ?`,
          key,
          input.reviewItemId
        );
        return;
      }
      await transaction.runAsync(
        `insert into location_review_evidence_cache (
           account_key, review_item_id, evidence_json, fetched_at,
           expires_at, byte_size, last_accessed_at
         ) values (?, ?, ?, ?, ?, ?, ?)
         on conflict(account_key, review_item_id) do update set
           evidence_json = excluded.evidence_json,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at,
           byte_size = excluded.byte_size,
           last_accessed_at = excluded.last_accessed_at`,
        key,
        input.reviewItemId,
        evidenceJson,
        fetchedAt,
        expiresAt,
        byteSize,
        fetchedAt
      );
      if (input.isStillCurrent && !input.isStillCurrent()) {
        await discardIfUnchanged();
        return;
      }
      await pruneLocationReviewEvidenceCacheForAccount(
        transaction,
        key,
        fetchedAt
      );
      if (input.isStillCurrent && !input.isStillCurrent()) {
        await discardIfUnchanged();
        return;
      }
      written = true;
    })
  );
  if (written) emitChange();
  return written;
}

export async function removeCachedLocationReviewEvidenceIfUnchanged(input: {
  expectedWorkspaceId: string;
  expectedUserId: string;
  reviewItemId: string;
  evidence: LocationReviewEvidenceDto;
  fetchedAt: string;
}) {
  const evidence = LocationReviewEvidenceDtoSchema.parse(input.evidence);
  if (evidence.reviewItemId !== input.reviewItemId) {
    throw new Error("Location evidence does not match this Review item.");
  }
  const fetchedAt = validIso(input.fetchedAt);
  if (!fetchedAt) throw new Error("Location evidence cache time is invalid.");
  const key = accountKey({
    workspaceId: input.expectedWorkspaceId,
    userId: input.expectedUserId
  });
  const db = await database();
  const result = await serialiseReviewMutation(() =>
    db.runAsync(
      `delete from location_review_evidence_cache
       where account_key = ? and review_item_id = ?
         and fetched_at = ? and evidence_json = ?`,
      key,
      input.reviewItemId,
      fetchedAt,
      JSON.stringify(evidence)
    )
  );
  if (result.changes > 0) emitChange();
  return result.changes > 0;
}

export async function removeCachedLocationReviewEvidence(reviewItemId: string) {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return false;
  const result = await serialiseReviewMutation(() =>
    db.runAsync(
      `delete from location_review_evidence_cache
       where account_key = ? and review_item_id = ?`,
      account.account_key,
      reviewItemId
    )
  );
  if (result.changes > 0) emitChange();
  return result.changes > 0;
}

export async function pruneLocationReviewEvidenceCache() {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) {
    return { expiredRemoved: 0, countEvicted: 0, bytesEvicted: 0 };
  }
  let result = { expiredRemoved: 0, countEvicted: 0, bytesEvicted: 0 };
  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      result = await pruneLocationReviewEvidenceCacheForAccount(
        transaction,
        account.account_key,
        new Date().toISOString()
      );
    })
  );
  return result;
}

export async function getLocationReviewEvidenceCacheDiagnostics(): Promise<
  LocationReviewEvidenceCacheDiagnostics
> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) {
    return {
      itemCount: 0,
      totalBytes: 0,
      oldestFetchedAt: null,
      newestFetchedAt: null
    };
  }
  const row = await db.getFirstAsync<{
    item_count: number;
    total_bytes: number;
    oldest_fetched_at: string | null;
    newest_fetched_at: string | null;
  }>(
    `select count(*) as item_count,
            coalesce(sum(byte_size), 0) as total_bytes,
            min(fetched_at) as oldest_fetched_at,
            max(fetched_at) as newest_fetched_at
     from location_review_evidence_cache
     where account_key = ?`,
    account.account_key
  );
  return {
    itemCount: Number(row?.item_count) || 0,
    totalBytes: Number(row?.total_bytes) || 0,
    oldestFetchedAt: row?.oldest_fetched_at ?? null,
    newestFetchedAt: row?.newest_fetched_at ?? null
  };
}

export async function loadCachedDashboardBootstrap(): Promise<{
  bootstrap: MobileBootstrap;
  cachedAt: string;
} | null> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return null;
  const row = await db.getFirstAsync<CachedDashboardRow>(
    `select snapshot_json, cached_at
     from dashboard_snapshot_cache
     where account_key = ?`,
    account.account_key
  );
  if (!row) return null;
  try {
    const bootstrap = JSON.parse(row.snapshot_json) as MobileBootstrap;
    if (
      bootstrap.user?.id !== account.user_id ||
      bootstrap.workspace?.id !== account.workspace_id ||
      !Array.isArray(bootstrap.entries) ||
      !Array.isArray(bootstrap.categories) ||
      !Array.isArray(bootstrap.reviewItems)
    ) {
      return null;
    }
    return {
      bootstrap: projectReviewBootstrap(
        bootstrap,
        await hiddenReviewItemIds(account.account_key)
      ),
      cachedAt: row.cached_at
    };
  } catch {
    return null;
  }
}

export async function cacheDashboardBootstrap(bootstrap: MobileBootstrap) {
  const db = await database();
  const account = await activeAccount(db);
  if (
    !account ||
    account.user_id !== bootstrap.user.id ||
    account.workspace_id !== bootstrap.workspace.id
  ) {
    return false;
  }
  const cachedAt = new Date().toISOString();
  await serialiseReviewMutation(() =>
    db.runAsync(
      `insert into dashboard_snapshot_cache (
         account_key, snapshot_json, cached_at
       ) values (?, ?, ?)
       on conflict(account_key) do update set
         snapshot_json = excluded.snapshot_json,
         cached_at = excluded.cached_at`,
      account.account_key,
      JSON.stringify(sanitiseDashboardBootstrapForCache(bootstrap)),
      cachedAt
    )
  );
  return true;
}

export async function enqueueReviewMutation(input: {
  bootstrap: MobileBootstrap;
  item: MobileReviewItem;
  mutation: ReviewMutation;
  clientMutationId: string;
  affectedItems?: MobileReviewItem[];
}) {
  const envelope = ReviewMutationEnvelopeSchema.parse({ clientMutationId: input.clientMutationId, mutation: input.mutation });
  const mutation = envelope.mutation;
  const expectedIds = [...new Set(mutation.action === "merge" || mutation.action === "merge_and_confirm"
    ? [input.item.id, mutation.adjacentReviewItemId] : [input.item.id])].sort();
  if ((mutation.action === "merge" || mutation.action === "merge_and_confirm") && expectedIds.length !== 2) {
    throw new Error("Choose a different adjacent visit.");
  }
  const affected = [...(input.affectedItems ?? [input.item])].sort((a, b) => a.id.localeCompare(b.id));
  if (affected.length !== expectedIds.length || affected.some((item, index) => item.id !== expectedIds[index])) {
    throw new Error("Both visits must be available in saved Review data before merging.");
  }
  for (const item of affected) {
    assertActionableReviewItem(item);
    if ((mutation.action === "merge" || mutation.action === "merge_and_confirm") && !isLocationReviewItem(item)) {
      throw new Error("Only saved Location Review visits can be merged.");
    }
    if (!input.bootstrap.reviewItems.some((cached) => cached.id === item.id && cached.status === "open")) {
      throw new Error("This suggestion is no longer available in this account's Review data.");
    }
  }
  const key = accountKey({ workspaceId: input.bootstrap.workspace.id, userId: input.bootstrap.user.id });
  const requestJson = canonicalJson(envelope);
  const itemIds = input.bootstrap.reviewItems.map((item) => item.id);
  const effects = affected.map((item) => {
    const position = itemIds.indexOf(item.id);
    return { item, position, snapshot: JSON.stringify(sanitiseReviewItemForCache(item)),
      preceding: JSON.stringify(itemIds.slice(0, position)), following: JSON.stringify(itemIds.slice(position + 1)) };
  });
  const primary = effects.find((effect) => effect.item.id === input.item.id)!;
  const now = new Date().toISOString();
  const db = await database();
  let idempotent = false;
  const localCommitStartedAt = Date.now();
  await serialiseReviewMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
    const account = await activeAccount(transaction);
    if (!account || account.account_key !== key) throw new Error("Review data is not configured for this account.");
    const existing = await transaction.getFirstAsync<{ account_key: string; review_item_id: string; request_json: string }>(
      "select account_key, review_item_id, request_json from review_mutation_outbox where client_mutation_id = ?", envelope.clientMutationId
    );
    if (existing) {
      if (existing.account_key === key && existing.review_item_id === input.item.id && existing.request_json === requestJson) {
        idempotent = true;
        return;
      }
      throw new Error("This Review mutation ID is already used for different data.");
    }
    for (const effect of effects) {
      const cached = await transaction.getFirstAsync<{ server_status: string }>(
        "select server_status from review_item_cache where account_key = ? and review_item_id = ?", key, effect.item.id
      );
      if (cached?.server_status !== "open") throw new Error("Refresh Review before saving this suggestion.");
      const owned = await transaction.getFirstAsync<{ client_mutation_id: string }>(
        "select client_mutation_id from review_mutation_effects where account_key = ? and review_item_id = ?", key, effect.item.id
      );
      if (owned) throw new Error("A saved Review change already exists for one of these suggestions.");
    }
    await transaction.runAsync(
      `insert into review_mutation_outbox (
        client_mutation_id, account_key, workspace_id, user_id, review_item_id, action_kind, request_json,
        original_snapshot_json, original_position, preceding_ids_json, following_ids_json,
        state, local_effect, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'hidden', ?, ?)`,
      envelope.clientMutationId, key, input.bootstrap.workspace.id, input.bootstrap.user.id, input.item.id,
      mutation.action, requestJson, primary.snapshot, primary.position, primary.preceding, primary.following, now, now
    );
    for (const effect of effects) {
      await transaction.runAsync(
        `insert into review_mutation_effects (
          client_mutation_id, account_key, review_item_id, snapshot_json, original_position,
          preceding_ids_json, following_ids_json, local_effect
        ) values (?, ?, ?, ?, ?, ?, ?, 'hidden')`,
        envelope.clientMutationId, key, effect.item.id, effect.snapshot, effect.position, effect.preceding, effect.following
      );
    }
  }));
  lastLocalMutationAction = mutation.action;
  lastLocalMutationCommitDurationMs = Date.now() - localCommitStartedAt;
  lastLocalMutationCommittedAt = new Date().toISOString();
  emitChange();
  return { envelope, idempotent };
}

export async function synchroniseReviewMutations(options: { force?: boolean } = {}) {
  synchronisationRequested = true;
  forcedSynchronisationRequested ||= options.force ?? false;
  synchronisationPromise ??= runRequestedSynchronisation().finally(() => {
    synchronisationPromise = null;
    emitChange();
  });
  return synchronisationPromise;
}

async function runRequestedSynchronisation() {
  let result: ReviewSyncResult = {
    acknowledgedCount: 0,
    waitingCount: 0,
    needsAttentionCount: 0,
    stopped: false,
    reason: "no_account"
  };
  while (synchronisationRequested) {
    synchronisationRequested = false;
    const force = forcedSynchronisationRequested;
    forcedSynchronisationRequested = false;
    result = await synchroniseReviewMutationsUnsafe({ force });
  }
  return result;
}

async function synchroniseReviewMutationsUnsafe(
  options: { force?: boolean }
): Promise<ReviewSyncResult> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) {
    return {
      acknowledgedCount: 0,
      waitingCount: 0,
      needsAttentionCount: 0,
      stopped: false,
      reason: "no_account"
    };
  }
  if (options.force) {
    await serialiseReviewMutation(() =>
      db.runAsync(
        `update review_mutation_outbox
         set state = case when state = 'retry_wait' then 'pending' else state end,
             next_attempt_at = case when state = 'retry_wait' then null else next_attempt_at end,
             updated_at = ?
         where account_key = ? and state in ('retry_wait', 'pending')`,
        new Date().toISOString(),
        account.account_key
      )
    );
  }
  const sessionRead = await readOwnedAuthenticatedSessionSnapshot({
    userId: account.user_id,
    workspaceId: account.workspace_id
  });
  if (sessionRead.status !== "authenticated") {
    await markAccountAuthenticationRequired(account.account_key);
    const diagnostics = await getReviewSyncDiagnostics();
    return {
      acknowledgedCount: 0,
      waitingCount: diagnostics.waitingCount,
      needsAttentionCount: diagnostics.needsAttentionCount,
      stopped: true,
      reason: "no_session"
    };
  }
  const token = sessionRead.snapshot.token;

  let acknowledgedCount = 0;
  let stopped = false;
  while (true) {
    const currentOwner = await activeAccount(db);
    const currentSession = await readOwnedAuthenticatedSessionSnapshot({ userId: account.user_id, workspaceId: account.workspace_id });
    if (currentOwner?.account_key !== account.account_key || currentSession.status !== "authenticated" || currentSession.snapshot.token !== token) {
      stopped = true;
      break;
    }
    const row = await nextMutation(account.account_key, options.force ?? false);
    if (!row) break;
    const attemptedAt = new Date().toISOString();
    await serialiseReviewMutation(() =>
      db.runAsync(
        `update review_mutation_outbox
         set state = 'in_flight',
             attempt_count = attempt_count + 1,
             last_attempted_at = ?,
             updated_at = ?
         where client_mutation_id = ?`,
        attemptedAt,
        attemptedAt,
        row.client_mutation_id
      )
    );
    try {
      if (!isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot)) {
        await markMutation(row.client_mutation_id, "pending", null, null, null, "hidden");
        stopped = true;
        break;
      }
      const response = await mobileFetchWithTimeout(
        `${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(row.review_item_id)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: row.request_json
        },
        {
          timeoutMilliseconds: REVIEW_SYNC_REQUEST_TIMEOUT_MS,
          timeoutMessage: "Review sync timed out. Your saved change will retry automatically."
        }
      );
      const responseBody = await safeResponseJson(response);
      const disposition = reviewSyncDisposition(
        response.status,
        typeof responseBody?.code === "string" ? responseBody.code : null
      );
      if (disposition === "acknowledge") {
        await serialiseReviewMutation(() =>
          db.runAsync(
            `update review_mutation_outbox
             set state = 'acknowledged',
                 local_effect = 'hidden',
                 next_attempt_at = null,
                 last_http_status = ?,
                 last_error = null,
                 acknowledged_at = ?,
                 updated_at = ?
             where client_mutation_id = ?`,
            response.status,
            attemptedAt,
            attemptedAt,
            row.client_mutation_id
          )
        );
        await setMetadata(
          accountMetadataKey(
            LAST_SUCCESSFUL_SYNC_AT_KEY,
            account.account_key
          ),
          attemptedAt
        );
        acknowledgedCount += 1;
        continue;
      }
      if (disposition === "authentication_required") {
        await markMutation(
          row.client_mutation_id,
          "auth_required",
          response.status,
          "Authentication required.",
          null,
          "hidden"
        );
        await markAccountAuthenticationRequired(account.account_key);
        await invalidateMobileSessionIfCurrent(token);
        stopped = true;
        break;
      }
      if (disposition === "retry") {
        await scheduleRetry(
          row,
          response.status,
          safeFailureSummary(response.status, responseBody)
        );
        stopped = true;
        break;
      }
      const restoreIds = canonicalOpenEffectIds(responseBody, row.review_item_id);
      await markMutation(
        row.client_mutation_id,
        "needs_attention",
        response.status,
        safeFailureSummary(response.status, responseBody),
        null,
        "hidden",
        restoreIds
      );
    } catch (error) {
      await scheduleRetry(
        row,
        null,
        error instanceof MobileRequestTimeoutError
          ? error.message
          : "Network request failed."
      );
      stopped = true;
      break;
    }
  }
  const diagnostics = await getReviewSyncDiagnostics();
  return {
    acknowledgedCount,
    waitingCount: diagnostics.waitingCount,
    needsAttentionCount: diagnostics.needsAttentionCount,
    stopped,
    ...(stopped ? { reason: "retryable_failure" as const } : {})
  };
}

async function nextMutation(accountKeyValue: string, force: boolean) {
  const db = await database();
  const now = new Date().toISOString();
  return await db.getFirstAsync<MutationRow>(
    `select *
     from review_mutation_outbox
     where account_key = ?
       and (
         state = 'pending'
         or (
           state = 'retry_wait'
           and (? = 1 or next_attempt_at is null or next_attempt_at <= ?)
         )
       )
     order by created_at, client_mutation_id
     limit 1`,
    accountKeyValue,
    force ? 1 : 0,
    now
  );
}

async function scheduleRetry(
  row: MutationRow,
  status: number | null,
  error: string
) {
  const attemptCount = Math.max(1, row.attempt_count + 1);
  const retryAt = nextReviewRetryAt(new Date(), attemptCount);
  await markMutation(
    row.client_mutation_id,
    "retry_wait",
    status,
    error,
    retryAt,
    "hidden"
  );
}

export function nextReviewRetryAt(
  attemptedAt: Date,
  attemptCount: number,
  random = Math.random
) {
  const baseSeconds = [30, 120, 300, 900, 1_800, 3_600][
    Math.min(Math.max(attemptCount, 1), 6) - 1
  ];
  const jitter = 0.8 + Math.max(0, Math.min(random(), 1)) * 0.4;
  return new Date(attemptedAt.getTime() + Math.round(baseSeconds * jitter * 1000)).toISOString();
}

export function canonicalOpenEffectIds(body: Record<string, unknown> | null, primaryId: string): string[] {
  const statuses = body?.canonicalReviewStatuses;
  if (statuses && typeof statuses === "object" && !Array.isArray(statuses)) {
    return Object.entries(statuses).filter(([, status]) => status === "open").map(([id]) => id);
  }
  // Compatibility for an older server: canonicalStatus proves only the primary.
  return body?.canonicalStatus === "open" ? [primaryId] : [];
}

async function markMutation(
  clientMutationId: string, state: ReviewMutationState, status: number | null,
  error: string | null, nextAttemptAt: string | null, localEffect: "hidden" | "restore",
  canonicalOpenIds: string[] = []
) {
  const db = await database();
  await serialiseReviewMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `update review_mutation_outbox set state = ?, local_effect = ?, next_attempt_at = ?, last_http_status = ?, last_error = ?, updated_at = ?
       where client_mutation_id = ?`,
      state, localEffect, nextAttemptAt, status, error, new Date().toISOString(), clientMutationId
    );
    await transaction.runAsync("update review_mutation_effects set local_effect = 'hidden' where client_mutation_id = ?", clientMutationId);
    for (const id of canonicalOpenIds) {
      await transaction.runAsync(
        "update review_mutation_effects set local_effect = 'restore' where client_mutation_id = ? and review_item_id = ?",
        clientMutationId, id
      );
    }
  }));
}

async function markAccountAuthenticationRequired(accountKeyValue: string) {
  const db = await database();
  await serialiseReviewMutation(() =>
    db.runAsync(
      `update review_mutation_outbox
       set state = 'auth_required',
           local_effect = 'hidden',
           next_attempt_at = null,
           last_error = 'Authentication required.',
           updated_at = ?
       where account_key = ? and state in ('pending', 'in_flight', 'retry_wait')`,
      new Date().toISOString(),
      accountKeyValue
    )
  );
  emitChange();
}

export async function getReviewSyncDiagnostics(): Promise<ReviewSyncDiagnostics> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return emptyDiagnostics();
  const row = await db.getFirstAsync<CountRow>(
    `select
       count(*) filter (where state in ('pending', 'in_flight')) as pending_count,
       count(*) filter (where state = 'retry_wait') as retry_wait_count,
       count(*) filter (where state = 'auth_required') as auth_required_count,
       count(*) filter (where state = 'needs_attention') as needs_attention_count,
       count(*) filter (where state = 'acknowledged') as acknowledged_count,
       min(created_at) filter (
         where state in ('pending', 'in_flight', 'retry_wait', 'auth_required')
       ) as oldest_queued_at,
       min(next_attempt_at) filter (where state = 'retry_wait') as next_retry_at,
       max(last_error) filter (where last_error is not null) as last_error
     from review_mutation_outbox
     where account_key = ?`,
    account.account_key
  );
  const diagnostics = row ?? {
    pending_count: 0,
    retry_wait_count: 0,
    auth_required_count: 0,
    needs_attention_count: 0,
    acknowledged_count: 0,
    oldest_queued_at: null,
    next_retry_at: null,
    last_error: null
  };
  const pendingCount = Number(diagnostics.pending_count) || 0;
  const retryWaitCount = Number(diagnostics.retry_wait_count) || 0;
  const authenticationRequiredCount = Number(diagnostics.auth_required_count) || 0;
  const evidenceCache = await getLocationReviewEvidenceCacheDiagnostics();
  return {
    pendingCount,
    retryWaitCount,
    authenticationRequiredCount,
    needsAttentionCount: Number(diagnostics.needs_attention_count) || 0,
    acknowledgedCount: Number(diagnostics.acknowledged_count) || 0,
    waitingCount: pendingCount + retryWaitCount + authenticationRequiredCount,
    oldestQueuedAt: diagnostics.oldest_queued_at,
    lastSuccessfulSyncAt: await metadata(
      accountMetadataKey(
        LAST_SUCCESSFUL_SYNC_AT_KEY,
        account.account_key
      ),
      db
    ),
    nextRetryAt: diagnostics.next_retry_at,
    lastError: diagnostics.last_error,
    lastCachedAt: await metadata(
      accountMetadataKey(LAST_CACHE_AT_KEY, account.account_key),
      db
    ),
    evidenceCacheItemCount: evidenceCache.itemCount,
    evidenceCacheBytes: evidenceCache.totalBytes,
    reviewCacheHitCount,
    reviewCacheMissCount,
    lastReviewCacheAgeMs,
    evidenceCacheHitCount,
    evidenceCacheMissCount,
    lastEvidenceCacheAgeMs,
    lastEvidencePayloadBytes,
    lastLocalMutationAction,
    lastLocalMutationCommitDurationMs,
    lastLocalMutationCommittedAt
  };
}

export async function getReviewItemSyncStates() {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return new Map<string, ReviewItemSyncState>();
  const rows = await db.getAllAsync<{
    action_kind: string;
    review_item_id: string;
    state: ReviewMutationState;
  }>(
    `select e.review_item_id, o.action_kind, o.state
     from review_mutation_effects e join review_mutation_outbox o
       on o.client_mutation_id = e.client_mutation_id and o.account_key = e.account_key
     where e.account_key = ? and o.state != 'acknowledged'
     order by o.created_at, e.review_item_id`,
    account.account_key
  );
  return new Map(
    rows.map((row) => [
      row.review_item_id,
      { action: row.action_kind, state: row.state }
    ])
  );
}

export async function listReviewSyncIssues() {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return [];
  return await db.getAllAsync<{
    clientMutationId: string;
    reviewItemId: string;
    action: string;
    createdAt: string;
    lastHttpStatus: number | null;
    lastError: string | null;
  }>(
    `select client_mutation_id as "clientMutationId",
            review_item_id as "reviewItemId",
            action_kind as action,
            created_at as "createdAt",
            last_http_status as "lastHttpStatus",
            last_error as "lastError"
     from review_mutation_outbox
     where account_key = ? and state = 'needs_attention'
     order by created_at`,
    account.account_key
  );
}

export async function listReviewSyncDiagnosticMutations(): Promise<
  ReviewSyncDiagnosticMutation[]
> {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return [];
  return await db.getAllAsync<ReviewSyncDiagnosticMutation>(
    `select client_mutation_id as "clientMutationId",
            review_item_id as "reviewItemId",
            action_kind as action,
            state,
            created_at as "createdAt",
            updated_at as "updatedAt",
            attempt_count as "attemptCount",
            next_attempt_at as "nextAttemptAt",
            last_attempted_at as "lastAttemptedAt",
            last_http_status as "lastHttpStatus",
            last_error as "lastError"
     from review_mutation_outbox
     where account_key = ?
     order by created_at`,
    account.account_key
  );
}

export async function discardReviewSyncIssue(clientMutationId: string) {
  const db = await database();
  const account = await activeAccount(db);
  if (!account) return false;
  let removed = false;
  await serialiseReviewMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
    // Discard must not reveal an old cached source that the server never proved
    // open. Canonical refresh can reintroduce it later if it is actually open.
    await transaction.runAsync(
      `delete from review_item_cache where account_key = ? and review_item_id in (
        select e.review_item_id from review_mutation_effects e
        join review_mutation_outbox o on o.client_mutation_id = e.client_mutation_id
        where e.account_key = ? and o.client_mutation_id = ?
          and o.state = 'needs_attention' and e.local_effect = 'hidden'
      )`, account.account_key, account.account_key, clientMutationId
    );
    const result = await transaction.runAsync(
      `delete from review_mutation_outbox
       where client_mutation_id = ?
         and account_key = ?
         and state = 'needs_attention'`,
      clientMutationId,
      account.account_key
    );
    removed = result.changes > 0;
  }));
  emitChange();
  return removed;
}

export async function clearActiveReviewAccountData() {
  const db = await database();
  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const account = await activeAccount(transaction);
      if (account) {
        await transaction.runAsync(
          "delete from review_account_context where account_key = ?",
          account.account_key
        );
        await transaction.runAsync(
          "delete from review_store_metadata where key like ?",
          `%:${account.account_key}`
        );
      }
      await transaction.runAsync(
        "delete from review_store_metadata where key = ?",
        ACTIVE_ACCOUNT_KEY
      );
    })
  );
  emitChange();
}

export function subscribeReviewSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitChange() {
  for (const listener of listeners) listener();
}

function assertActionableReviewItem(item: MobileReviewItem) {
  if (!item.id || item.status !== "open") {
    throw new Error("This Review suggestion is no longer actionable.");
  }
  if (!item.suggestedStartedAt || !item.suggestedStoppedAt) {
    throw new Error("This Review suggestion does not include a complete time window.");
  }
  const startedAt = Date.parse(item.suggestedStartedAt);
  const stoppedAt = Date.parse(item.suggestedStoppedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(stoppedAt) || stoppedAt <= startedAt) {
    throw new Error("This Review suggestion has an invalid time window.");
  }
}

export function sanitiseReviewItemForCache(
  item: MobileReviewItem
): MobileReviewItem {
  return {
    ...item,
    rawPayload: sanitiseRawPayload(item.rawPayload)
  };
}

export function sanitiseDashboardBootstrapForCache(
  bootstrap: MobileBootstrap
): MobileBootstrap {
  return {
    ...bootstrap,
    places: bootstrap.places.map(({ latitude: _latitude, longitude: _longitude, ...place }) => place),
    learnedPlaces: undefined,
    reviewItems: bootstrap.reviewItems.map(sanitiseReviewItemForCache)
  };
}

function sanitiseRawPayload(rawPayload: Record<string, unknown> | null) {
  if (!rawPayload) return null;
  const allowedKeys = [
    "algorithmVersion",
    "clientSegmentId",
    "continuityStatus",
    "evidenceKind",
    "placeMatchKind",
    "uncertaintyReason",
    "semanticReason",
    "policyVersion",
    "workoutType",
    "workoutLabel",
    "activityType",
    "durationSeconds"
  ];
  return Object.fromEntries(
    allowedKeys.flatMap((key) =>
      Object.prototype.hasOwnProperty.call(rawPayload, key)
        ? [[key, rawPayload[key]]]
        : []
    )
  );
}

function parseReviewSnapshot(value: string) {
  try {
    const item = JSON.parse(value) as MobileReviewItem;
    if (!item || typeof item.id !== "string" || item.status !== "open" || typeof item.title !== "string") return null;
    // Incomplete server suggestions remain valid cached presentation. Enqueue
    // separately requires a complete window before allowing local dismissal.
    return sanitiseReviewItemForCache(item);
  } catch {
    return null;
  }
}

async function hiddenReviewItemIds(accountKeyValue: string) {
  const db = await database();
  const rows = await db.getAllAsync<{ review_item_id: string }>(
    `select review_item_id
     from review_mutation_effects
     where account_key = ? and local_effect = 'hidden'`,
    accountKeyValue
  );
  return new Set(rows.map((row) => row.review_item_id));
}

export function projectReviewBootstrap(
  bootstrap: MobileBootstrap,
  hiddenIds: Set<string>
) {
  if (hiddenIds.size === 0) return bootstrap;
  const reviewItems = bootstrap.reviewItems.filter((item) => !hiddenIds.has(item.id));
  const hiddenOpenCount =
    bootstrap.reviewItems.filter((item) => item.status === "open").length -
    reviewItems.filter((item) => item.status === "open").length;
  return {
    ...bootstrap,
    reviewItems,
    ...(bootstrap.stats
      ? {
          stats: {
            ...bootstrap.stats,
            reviewCount: Math.max(0, bootstrap.stats.reviewCount - hiddenOpenCount)
          }
        }
      : {})
  };
}

export function restoreReviewItemsWithAnchors(
  currentItems: MobileReviewItem[],
  restorations: Array<{
    item: MobileReviewItem;
    originalPosition: number;
    precedingIds: string[];
    followingIds: string[];
  }>
) {
  const result = [...currentItems];
  const ids = new Set(result.map((item) => item.id));
  for (const restoration of restorations) {
    if (ids.has(restoration.item.id)) continue;
    const precedingIndex = restoration.precedingIds
      .slice()
      .reverse()
      .map((id) => result.findIndex((item) => item.id === id))
      .find((index) => index >= 0);
    const followingIndex = restoration.followingIds
      .map((id) => result.findIndex((item) => item.id === id))
      .find((index) => index >= 0);
    const insertionIndex = precedingIndex != null
      ? precedingIndex + 1
      : followingIndex != null
        ? followingIndex
        : Math.max(0, Math.min(restoration.originalPosition, result.length));
    result.splice(insertionIndex, 0, restoration.item);
    ids.add(restoration.item.id);
  }
  return result;
}

function canonicalJson(value: ReviewMutationEnvelope) {
  return JSON.stringify(sortJsonValue(value));
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)])
  );
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

export function reviewSyncDisposition(
  status: number,
  code: string | null = null
) {
  if (status >= 200 && status < 300) return "acknowledge" as const;
  if (status === 401 || status === 403) {
    return "authentication_required" as const;
  }
  if (
    isRetryableStatus(status) ||
    (status === 409 && (code === "review_item_locked" || code === "overlap"))
  ) {
    return "retry" as const;
  }
  return "needs_attention" as const;
}

async function safeResponseJson(response: Response) {
  try {
    const value = await response.json();
    return value && typeof value === "object"
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeFailureSummary(
  status: number,
  body: Record<string, unknown> | null
) {
  const code = typeof body?.code === "string" ? body.code.slice(0, 80) : null;
  return code ? `HTTP ${status} · ${code}` : `HTTP ${status}`;
}

function emptyDiagnostics(): ReviewSyncDiagnostics {
  return {
    pendingCount: 0,
    retryWaitCount: 0,
    authenticationRequiredCount: 0,
    needsAttentionCount: 0,
    acknowledgedCount: 0,
    waitingCount: 0,
    oldestQueuedAt: null,
    lastSuccessfulSyncAt: null,
    nextRetryAt: null,
    lastError: null,
    lastCachedAt: null,
    reviewCacheHitCount,
    reviewCacheMissCount,
    lastReviewCacheAgeMs,
    evidenceCacheItemCount: 0,
    evidenceCacheBytes: 0,
    evidenceCacheHitCount,
    evidenceCacheMissCount,
    lastEvidenceCacheAgeMs,
    lastEvidencePayloadBytes,
    lastLocalMutationAction,
    lastLocalMutationCommitDurationMs,
    lastLocalMutationCommittedAt
  };
}

async function pruneLocationReviewEvidenceCacheForAccount(
  db: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  now: string
) {
  const expired = await db.runAsync(
    `delete from location_review_evidence_cache
     where account_key = ? and expires_at <= ?`,
    accountKeyValue,
    now
  );
  const rows = await db.getAllAsync<EvidenceCacheSizeRow>(
    `select review_item_id, byte_size
     from location_review_evidence_cache
     where account_key = ?
     order by last_accessed_at, fetched_at, review_item_id`,
    accountKeyValue
  );
  let itemCount = rows.length;
  let totalBytes = rows.reduce(
    (sum, row) => sum + Math.max(0, Number(row.byte_size) || 0),
    0
  );
  let countEvicted = 0;
  let bytesEvicted = 0;
  for (const row of rows) {
    if (
      itemCount <= LOCATION_REVIEW_EVIDENCE_MAX_ITEMS &&
      totalBytes <= LOCATION_REVIEW_EVIDENCE_MAX_BYTES
    ) {
      break;
    }
    const byteSize = Math.max(0, Number(row.byte_size) || 0);
    await db.runAsync(
      `delete from location_review_evidence_cache
       where account_key = ? and review_item_id = ?`,
      accountKeyValue,
      row.review_item_id
    );
    itemCount -= 1;
    totalBytes -= byteSize;
    countEvicted += 1;
    bytesEvicted += byteSize;
  }
  return {
    expiredRemoved: expired.changes,
    countEvicted,
    bytesEvicted
  };
}

export function locationReviewEvidenceExpiry(
  evidence: Pick<LocationReviewEvidenceDto, "evidenceExpiresAt">,
  fetchedAt: string
) {
  const fetchedAtMs = Date.parse(fetchedAt);
  const localExpiryMs = fetchedAtMs + LOCATION_REVIEW_EVIDENCE_MAX_AGE_MS;
  const serverExpiryMs = evidence.evidenceExpiresAt
    ? Date.parse(evidence.evidenceExpiresAt)
    : Number.NaN;
  return new Date(
    Number.isFinite(serverExpiryMs)
      ? Math.min(localExpiryMs, serverExpiryMs)
      : localExpiryMs
  ).toISOString();
}

export function utf8ByteSize(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function validIso(value: string | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isFutureIso(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.now();
}

function ageMilliseconds(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null;
}
