import * as SQLite from "expo-sqlite";
import {
  ReviewMutationEnvelopeSchema,
  ReviewMutationSchema,
  type ReviewMutation,
  type ReviewMutationEnvelope
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import { clearSessionToken, getSessionToken } from "./secure-session";
import type {
  MobileBootstrap,
  MobileReviewItem
} from "./api";
import { createSerialMutationQueue } from "./location/mutationQueue";

const DATABASE_NAME = "dayframe-review-sync.db";
const DATABASE_VERSION = 3;
const ACTIVE_ACCOUNT_KEY = "active_account";
const LAST_CACHE_AT_KEY = "last_cache_at";
const LAST_SUCCESSFUL_SYNC_AT_KEY = "last_successful_sync_at";
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

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let synchronisationPromise: Promise<ReviewSyncResult> | null = null;
let synchronisationRequested = false;
let forcedSynchronisationRequested = false;
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
            local_effect text not null default 'restore',
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
      const acknowledged = await transaction.getAllAsync<{
        client_mutation_id: string;
        review_item_id: string;
      }>(
        `select client_mutation_id, review_item_id
         from review_mutation_outbox
         where account_key = ? and state = 'acknowledged'`,
        key
      );
      for (const row of acknowledged) {
        if (!openIds.has(row.review_item_id)) {
          await transaction.runAsync(
            "delete from review_mutation_outbox where client_mutation_id = ?",
            row.client_mutation_id
          );
        }
      }
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
  if (!account) return null;
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
    created_at: string;
  }>(
    `select original_snapshot_json, original_position, created_at
     from review_mutation_outbox
     where account_key = ? and local_effect = 'restore'
     order by original_position, created_at`,
    account.account_key
  );
  const byId = new Map<string, { item: MobileReviewItem; position: number }>();
  for (const row of cached) {
    const item = parseReviewSnapshot(row.snapshot_json);
    if (item) byId.set(item.id, { item, position: row.position });
  }
  for (const row of restored) {
    const item = parseReviewSnapshot(row.original_snapshot_json);
    if (item && !byId.has(item.id)) {
      byId.set(item.id, { item, position: row.original_position });
    }
  }
  const hiddenIds = await hiddenReviewItemIds(account.account_key);
  const reviewItems = [...byId.values()]
    .filter(({ item }) => !hiddenIds.has(item.id))
    .sort((left, right) => left.position - right.position)
    .map(({ item }) => item);
  const cachedAt = await metadata(
    accountMetadataKey(LAST_CACHE_AT_KEY, account.account_key),
    db
  );
  if (!cachedAt) return null;
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
}) {
  const mutation = ReviewMutationSchema.parse(input.mutation);
  const envelope = ReviewMutationEnvelopeSchema.parse({
    clientMutationId: input.clientMutationId,
    mutation
  });
  assertActionableReviewItem(input.item);
  const key = accountKey({
    workspaceId: input.bootstrap.workspace.id,
    userId: input.bootstrap.user.id
  });
  const requestJson = canonicalJson(envelope);
  const itemIds = input.bootstrap.reviewItems.map((item) => item.id);
  const position = itemIds.indexOf(input.item.id);
  const safePosition = position < 0 ? itemIds.length : position;
  const now = new Date().toISOString();
  const db = await database();
  let idempotent = false;

  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const account = await activeAccount(transaction);
      if (!account || account.account_key !== key) {
        throw new Error("Review data is not configured for this account.");
      }
      const existingId = await transaction.getFirstAsync<{
        account_key: string;
        request_json: string;
      }>(
        `select account_key, request_json
         from review_mutation_outbox
         where client_mutation_id = ?`,
        envelope.clientMutationId
      );
      if (existingId) {
        if (
          existingId.account_key === key &&
          existingId.request_json === requestJson
        ) {
          idempotent = true;
          return;
        }
        throw new Error("This Review mutation ID is already used for different data.");
      }
      const existingItem = await transaction.getFirstAsync<{
        client_mutation_id: string;
      }>(
        `select client_mutation_id
         from review_mutation_outbox
         where account_key = ? and review_item_id = ?`,
        key,
        input.item.id
      );
      if (existingItem) {
        throw new Error("A saved Review change already exists for this suggestion.");
      }
      await transaction.runAsync(
        `insert into review_item_cache (
           account_key, review_item_id, snapshot_json, server_status, position, cached_at
         ) values (?, ?, ?, ?, ?, ?)
         on conflict(account_key, review_item_id) do update set
           snapshot_json = excluded.snapshot_json,
           server_status = excluded.server_status,
           position = excluded.position,
           cached_at = excluded.cached_at`,
        key,
        input.item.id,
        JSON.stringify(sanitiseReviewItemForCache(input.item)),
        input.item.status,
        safePosition,
        now
      );
      for (const category of input.bootstrap.categories) {
        await transaction.runAsync(
          `insert into review_category_cache (
             account_key, category_id, category_json, cached_at
           ) values (?, ?, ?, ?)
           on conflict(account_key, category_id) do update set
             category_json = excluded.category_json,
             cached_at = excluded.cached_at`,
          key,
          category.id,
          JSON.stringify(category),
          now
        );
      }
      await transaction.runAsync(
        `insert into review_mutation_outbox (
           client_mutation_id, account_key, workspace_id, user_id,
           review_item_id, action_kind, request_json, original_snapshot_json,
           original_position, preceding_ids_json, following_ids_json,
           state, local_effect, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'restore', ?, ?)`,
        envelope.clientMutationId,
        key,
        input.bootstrap.workspace.id,
        input.bootstrap.user.id,
        input.item.id,
        mutation.action,
        requestJson,
        JSON.stringify(sanitiseReviewItemForCache(input.item)),
        safePosition,
        JSON.stringify(itemIds.slice(0, Math.max(safePosition, 0))),
        JSON.stringify(itemIds.slice(Math.max(safePosition + 1, 0))),
        now,
        now
      );
    })
  );

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
  const token = await getSessionToken();
  if (!token) {
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

  let acknowledgedCount = 0;
  let stopped = false;
  while (true) {
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
      const response = await fetch(
        `${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(row.review_item_id)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: row.request_json
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
          "restore"
        );
        await markAccountAuthenticationRequired(account.account_key);
        await clearSessionToken();
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
      const restore = responseBody?.canonicalStatus === "open";
      await markMutation(
        row.client_mutation_id,
        "needs_attention",
        response.status,
        safeFailureSummary(response.status, responseBody),
        null,
        restore ? "restore" : "hidden"
      );
    } catch {
      await scheduleRetry(row, null, "Network request failed.");
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
    "restore"
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

async function markMutation(
  clientMutationId: string,
  state: ReviewMutationState,
  status: number | null,
  error: string | null,
  nextAttemptAt: string | null,
  localEffect: "hidden" | "restore"
) {
  const db = await database();
  await serialiseReviewMutation(() =>
    db.runAsync(
      `update review_mutation_outbox
       set state = ?,
           local_effect = ?,
           next_attempt_at = ?,
           last_http_status = ?,
           last_error = ?,
           updated_at = ?
       where client_mutation_id = ?`,
      state,
      localEffect,
      nextAttemptAt,
      status,
      error,
      new Date().toISOString(),
      clientMutationId
    )
  );
}

async function markAccountAuthenticationRequired(accountKeyValue: string) {
  const db = await database();
  await serialiseReviewMutation(() =>
    db.runAsync(
      `update review_mutation_outbox
       set state = 'auth_required',
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
    )
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
    `select review_item_id, action_kind, state
     from review_mutation_outbox
     where account_key = ? and state != 'acknowledged'
     order by created_at`,
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
  const result = await serialiseReviewMutation(() =>
    db.runAsync(
      `delete from review_mutation_outbox
       where client_mutation_id = ?
         and account_key = ?
         and state = 'needs_attention'`,
      clientMutationId,
      account.account_key
    )
  );
  emitChange();
  return result.changes > 0;
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
    return JSON.parse(value) as MobileReviewItem;
  } catch {
    return null;
  }
}

async function hiddenReviewItemIds(accountKeyValue: string) {
  const db = await database();
  const rows = await db.getAllAsync<{ review_item_id: string }>(
    `select review_item_id
     from review_mutation_outbox
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

function canonicalJson(value: ReviewMutationEnvelope) {
  return JSON.stringify(sortJsonValue(value));
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
    lastCachedAt: null
  };
}
