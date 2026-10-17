import { createOwnerSyncCoalescer } from "./ownerSyncCoalescer";
import type { SyncLaneOutcome } from "./syncLane";
import * as SQLite from "expo-sqlite";
import { REVIEW_EFFECTS_V5_SQL, REVIEW_OBSERVATION_V8_SQL,
  REVIEW_SAVE_PLACE_V9_SQL, REVIEW_PRESENTATION_V7_SQL, REVIEW_RECOVERY_V6_SQL } from "./reviewSyncSchema";
import {
  LocationReviewEvidenceDtoSchema,
  OUTING_KEY_PAYLOAD_KEY,
  OUTING_ROLE_PAYLOAD_KEY,
  REVIEW_PRESENTATION_MAX_IDS,
  ReviewPresentationSnapshotSchema,
  ReviewMutationEnvelopeSchema,
  ReviewReconciliationResponseSchema,
  validReviewAcknowledgement,
  ReviewMutationSchema,
  type LocationReviewEvidenceDto,
  type ReviewPresentationSnapshot,
  type ReviewProposalPresentation,
  type ReviewMutation,
  type ReviewMutationEnvelope
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import { DAYFRAME_BACKEND_ID } from "./backendIdentity";
import { reviewPresentationRequestedAt } from "./reviewPresentationRequestTime";
import {
  MobileRequestTimeoutError,
  mobileJsonRequest,
  StaleMobileSessionResponseError,
  isMobileTransportFailure
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
const DATABASE_VERSION = 9;
const ACTIVE_ACCOUNT_KEY = "active_account";
const LAST_CACHE_AT_KEY = "last_cache_at";
const LAST_SUCCESSFUL_SYNC_AT_KEY = "last_successful_sync_at";
const SETTLED_ELSEWHERE_COUNT_KEY = "settled_elsewhere_count";
const LAST_SETTLED_ELSEWHERE_AT_KEY = "last_settled_elsewhere_at";
const PRESENTATION_REVISION_KEY = "presentation_revision";
const REVIEW_PRESENTATION_CONTEXT_LIMIT = 3;
const REVIEW_PRESENTATION_DISPLAY_CACHE_MAX_BYTES = 4 * 1024 * 1024;
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
/**
 * I1: a needs_attention row whose outcome is only unknown (or whose re-check was interrupted) is
 * not a rejection. Every surface treats it as waiting, it is re-checked on its own, and it is never
 * discardable. SQL predicate over review_mutation_outbox (optionally aliased).
 */
function unknownOutcomeSql(alias = "") {
  return `(${alias}state = 'needs_attention' and coalesce(${alias}resolution_status,'') in ('resolution_unknown','reconciling'))`;
}
/**
 * A rejection an older build parked for the person although the server had only decided the
 * moment elsewhere (another device, or location replay superseding it). Re-checked once on an
 * ordinary pass so it settles quietly; nothing written today matches it.
 */
function legacyResolvedElsewhereSql(alias = "") {
  return `(${alias}state = 'needs_attention' and (coalesce(${alias}resolution_status,'') in ('resolution_conflict','canonical_missing')
    or coalesce(${alias}last_error,'') in ('HTTP 409 · resolution_conflict','HTTP 404 · review_item_not_found')))`;
}
const LEGACY_RECHECKED_KEY = "legacy_resolved_elsewhere_rechecked";

/**
 * SQL: terminal evidence row `alias` is in force, i.e. no presentation read of the same backend
 * listed the source open strictly after it. Equal times keep the source closed.
 */
function terminalInForceSql(alias: string) {
  return `not exists (select 1 from review_source_open_observation o
    where o.account_key = ${alias}.account_key and o.review_item_id = ${alias}.review_item_id
      and o.backend_id = ${alias}.backend_id and o.observed_at > ${alias}.captured_at)`;
}

/** Terminal evidence at `at` makes an open observation at or before it irrelevant: drop it. */
async function compactOpenObservation(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  reviewItemId: string,
  backendId: string,
  at: string
) {
  await transaction.runAsync(
    `delete from review_source_open_observation
     where account_key = ? and review_item_id = ? and backend_id = ? and observed_at <= ?`,
    accountKeyValue, reviewItemId, backendId, at
  );
}

async function recordOpenObservation(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  reviewItemId: string,
  backendId: string,
  observedAt: string
) {
  await transaction.runAsync(
    `insert into review_source_open_observation (account_key, review_item_id, backend_id, observed_at)
     values (?, ?, ?, ?)
     on conflict(account_key, review_item_id, backend_id) do update set observed_at = excluded.observed_at
     where excluded.observed_at > review_source_open_observation.observed_at`,
    accountKeyValue, reviewItemId, backendId, observedAt
  );
}
export type ReviewItemSyncState = {
  action: string;
  state: ReviewMutationState;
};

export type ReviewSyncDiagnostics = {
  presentationReads?: PresentationReadDiagnostic[];
  pendingCount: number;
  retryWaitCount: number;
  authenticationRequiredCount: number;
  /** Real rejections only (unknown outcomes are in checkingCount and waitingCount). */
  needsAttentionCount: number;
  /** Unknown outcomes Dayframe re-checks on its own (I1). */
  checkingCount?: number;
  /** Actions for moments already decided elsewhere, settled quietly (never a rejection). */
  settledElsewhereCount?: number;
  lastSettledElsewhereAt?: string | null;
  acknowledgedCount: number;
  waitingCount: number;
  oldestQueuedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
  lastCachedAt: string | null;
  reviewCacheHitCount: number;
  /** Cached Review items removed because a complete read no longer listed them open (this process). */
  reviewCacheEvictedCount?: number;
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
  outcome?: SyncLaneOutcome;
  nextRetryAt?: string | null;
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
  contentionCount?: number;
  reconciliationAttemptCount?: number;
  lastReconciledAt?: string | null;
  resolutionStatus?: string | null;
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
  contention_count: number;
  reconciliation_attempt_count: number;
  resolution_status: string | null;
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
  checking_count?: number;
  checking_due_at?: string | null;
};

type CachedEvidenceRow = {
  evidence_json: string;
  fetched_at: string;
  expires_at: string;
  byte_size: number;
};

type PresentationContextRow = {
  scope_key: string;
  backend_id: string;
  contract_version: number;
  snapshot_token: string;
  captured_at: string;
  cached_at: string;
  complete: number;
  context_json: string;
};

type TerminalSourceRow = {
  review_item_id: string;
  status: "accepted" | "ignored" | "missing";
};

export type ReviewPresentationOwner = {
  workspaceId: string;
  userId: string;
  backendId: string;
};

const PRESENTATION_READ_STATUSES = ["success", "offline", "server", "validation", "cache", "snapshot_changed"] as const;
export type PresentationReadStatus = typeof PRESENTATION_READ_STATUSES[number];
type PresentationReadDiagnostic = {
  surface: "today" | "backlog";
  status: PresentationReadStatus;
  checkedAt: string;
};
// Like the existing cache counters, these are process-lifetime diagnostics.
// Keep just the latest result per surface, including when SQLite is unavailable.
const presentationReads = new Map<string, { owner: ReviewPresentationOwner; diagnostic: PresentationReadDiagnostic }>();
export function recordReviewPresentationRead(owner: ReviewPresentationOwner, surface: "today" | "backlog", status: PresentationReadStatus) {
  if (!PRESENTATION_READ_STATUSES.includes(status) || !["today", "backlog"].includes(surface)) return;
  presentationReads.set(surface, {
    owner: { backendId: owner.backendId, workspaceId: owner.workspaceId, userId: owner.userId },
    diagnostic: { surface, status, checkedAt: new Date().toISOString() }
  });
  // Do not emit a Review mutation notification: read diagnostics must not
  // schedule delivery, refresh presentation, or affect connectivity counts.
}

export type ReviewPresentationStoreEffect = {
  reviewItemId: string;
  action: string;
  state: ReviewMutationState;
  localEffect: "hidden" | "restore";
  resolution: "none" | "pending" | "verified" | "unknown" | "rejected";
  canonicalEntryIds: string[];
  source: {
    reviewItemId: string;
    sourceKind: "generic" | "location_v2";
    title: string;
    category: { id: string | null; name: string | null; color: string | null };
    placeLabel: string | null;
    interval: { start: string | null; end: string | null };
    createdAt: string;
    eventSource: string | null;
    eventType: string | null;
  } | null;
};

export type ReviewPresentationStoreSnapshot = {
  response: ReviewPresentationSnapshot;
  cachedAt: string;
  localRevision: number;
  effects: ReviewPresentationStoreEffect[];
};

/**
 * One bounded, durable-proof lookup request. The existing outbox remains the
 * owner of delivery and retention; this exposes only opaque source/result IDs
 * to the cancellable presentation reader after a receipt is acknowledged.
 */
export type AcknowledgedReviewHandoverLookup = {
  clientMutationId: string;
  reviewItemIds: string[];
  entryIds: string[];
  signature: string;
};

export type CurrentQuickConfirmSource = {
  source: ReviewProposalPresentation;
  item: MobileReviewItem;
  bootstrap: MobileBootstrap;
  effect: ReviewPresentationStoreEffect | null;
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
let reviewCacheHitCount = 0;
let reviewCacheEvictedCount = 0;
let reviewCacheMissCount = 0;
let lastReviewCacheAgeMs: number | null = null;
let evidenceCacheHitCount = 0;
let evidenceCacheMissCount = 0;
let lastEvidenceCacheAgeMs: number | null = null;
let lastEvidencePayloadBytes: number | null = null;
let lastLocalMutationAction: string | null = null;
let lastLocalMutationCommitDurationMs: number | null = null;
let lastLocalMutationCommittedAt: string | null = null;
// Bumped whenever the counters above are reset for another account.
let processDiagnosticsEpoch = 0;

/**
 * The in-process cache and mutation counters describe the store's active account: they start over
 * when the store's account changes or is cleared, so one account's activity never shows as
 * another's (Codex r5 on #355).
 */
function resetProcessReviewDiagnostics() {
  reviewCacheHitCount = 0;
  reviewCacheEvictedCount = 0;
  reviewCacheMissCount = 0;
  lastReviewCacheAgeMs = null;
  evidenceCacheHitCount = 0;
  evidenceCacheMissCount = 0;
  lastEvidenceCacheAgeMs = null;
  lastEvidencePayloadBytes = null;
  lastLocalMutationAction = null;
  lastLocalMutationCommitDurationMs = null;
  lastLocalMutationCommittedAt = null;
  processDiagnosticsEpoch += 1;
}

/**
 * Taken when an operation that updates those counters starts: its update lands only while no
 * account change or clear has happened since (each bumps the epoch), so a late completion from one
 * account never writes into another's counters (Codex r6 on #355).
 */
function captureDiagnosticsWriter() {
  const epoch = processDiagnosticsEpoch;
  return (write: () => void) => {
    if (epoch === processDiagnosticsEpoch) write();
  };
}
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
        if ((version?.user_version ?? 0) < 6) await transaction.execAsync(REVIEW_RECOVERY_V6_SQL);
        if ((version?.user_version ?? 0) < 7) await transaction.execAsync(REVIEW_PRESENTATION_V7_SQL);
        await transaction.execAsync(REVIEW_OBSERVATION_V8_SQL);
        if ((version?.user_version ?? 0) < 9) await transaction.execAsync(REVIEW_SAVE_PLACE_V9_SQL);
        await transaction.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
      });
    }
    await db.runAsync(
      `update review_mutation_outbox
       set state = 'pending', resolution_status = 'delivery_interrupted',
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

  let accountChanged = false;
  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const previousAccount = await activeAccount(transaction);
      if (previousAccount?.account_key !== key) {
        // The counters describe the store's account: they start over for a new one (also from none).
        accountChanged = true;
        resetProcessReviewDiagnostics();
      }
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
      // Bootstrap's Review list is deliberately capped. Treat it as a partial
      // open-source update: it can refresh returned rows, never prove that an
      // older cached proposal or an acknowledged intent no longer exists.
      // Server data that shows a saved card's place, or the card decided, ends its saved-name overlay.
      await retireSavedPlaceOverlays(transaction, key, bootstrap.reviewItems
        .filter((item) => item.status !== "open" || item.suggestedPlaceId).map((item) => item.id));
      for (const [position, item] of bootstrap.reviewItems.entries()) {
        if (item.status !== "open") continue;
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
          item.id,
          JSON.stringify(sanitiseReviewItemForCache(item)),
          item.status,
          position,
          now
        );
      }
      for (const category of bootstrap.categories) {
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
               'split', 'split_and_confirm', 'merge', 'merge_and_confirm', 'save_place',
               'record_poi_once', 'save_place_and_confirm'
             )
             and state = 'needs_attention' and last_http_status = 422
             and last_error like '%invalid_action%'`,
          key,
          commuteId
        );
      }
      // A bootstrap omission is not terminal proof. Restore/hidden effects,
      // acknowledged envelopes and map evidence therefore survive until an
      // explicit scoped presentation result or their own retention policy.
      await pruneLocationReviewEvidenceCacheForAccount(transaction, key, now);
    })
  );
  // Again once committed: an operation that started while the switch was in progress never lands.
  if (accountChanged) resetProcessReviewDiagnostics();

  emitChange();
  return projectReviewBootstrap(
    bootstrap,
    await suppressedReviewItemIds(key, await presentationBackendIdForBootstrap(key, bootstrap)),
    await pendingSavedPlaceNames(key)
  );
}

export async function activateReviewAccount(input: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
}) {
  const db = await database();
  const key = accountKey(input);
  const now = new Date().toISOString();
  let accountChanged = false;
  await serialiseReviewMutation(() =>
    db.withExclusiveTransactionAsync(async (transaction) => {
      const previousAccount = await activeAccount(transaction);
      if (previousAccount?.account_key !== key) {
        // The counters describe the store's account: they start over for a new one (also from none).
        accountChanged = true;
        resetProcessReviewDiagnostics();
      }
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
  // Again once committed: an operation that started while the switch was in progress never lands.
  if (accountChanged) resetProcessReviewDiagnostics();
  emitChange();
}

export async function loadCachedReviewBootstrap(): Promise<{
  bootstrap: MobileBootstrap;
  cachedAt: string | null;
} | null> {
  const record = captureDiagnosticsWriter();
  const db = await database();
  const account = await activeAccount(db);
  if (!account) {
    record(() => { reviewCacheMissCount += 1; });
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
  const hiddenIds = await suppressedReviewItemIds(
    account.account_key,
    await latestPresentationBackendId(account.account_key)
  );
  const savedNames = await pendingSavedPlaceNames(account.account_key);
  const reviewItems = orderedItems.filter((item) => !hiddenIds.has(item.id)).map((item) => withSavedPlace(item, savedNames));
  const cachedAt = await metadata(
    accountMetadataKey(LAST_CACHE_AT_KEY, account.account_key),
    db
  );
  if (!cachedAt) {
    record(() => { reviewCacheMissCount += 1; });
    return null;
  }
  record(() => {
    reviewCacheHitCount += 1;
    lastReviewCacheAgeMs = ageMilliseconds(cachedAt);
  });
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
    await suppressedReviewItemIds(
      account.account_key,
      await presentationBackendIdForBootstrap(account.account_key, bootstrap)
    ),
    await pendingSavedPlaceNames(account.account_key)
  );
}

export async function loadCachedLocationReviewEvidence(
  reviewItemId: string
): Promise<{
  evidence: LocationReviewEvidenceDto;
  fetchedAt: string;
  expiresAt: string;
} | null> {
  const record = captureDiagnosticsWriter();
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
    record(() => { evidenceCacheMissCount += 1; });
    return null;
  }
  if (!isFutureIso(row.expires_at)) {
    record(() => { evidenceCacheMissCount += 1; });
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
    record(() => {
      evidenceCacheHitCount += 1;
      lastEvidenceCacheAgeMs = ageMilliseconds(row.fetched_at);
      lastEvidencePayloadBytes = Math.max(0, Number(row.byte_size) || 0);
    });
    return {
      evidence,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at
    };
  } catch {
    record(() => { evidenceCacheMissCount += 1; });
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
  return evidenceCacheDiagnosticsForAccount(db, account);
}

async function evidenceCacheDiagnosticsForAccount(
  db: SQLite.SQLiteDatabase,
  account: AccountRow
): Promise<LocationReviewEvidenceCacheDiagnostics> {
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
        await suppressedReviewItemIds(
          account.account_key,
          await presentationBackendIdForBootstrap(account.account_key, bootstrap)
        ),
        await pendingSavedPlaceNames(account.account_key)
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

/**
 * Persist one server-verified presentation generation under the existing
 * Review store. Its response schema is whitelisted by the shared contract;
 * raw event payloads and saved mutation envelopes never enter this cache.
 */
export async function cacheReviewPresentation(input: {
  owner: ReviewPresentationOwner;
  response: ReviewPresentationSnapshot;
  /** When the request was sent (client clock); defaults to what the presentation client recorded. */
  requestedAt?: string;
}) {
  const requestedAt = input.requestedAt ?? reviewPresentationRequestedAt(input.response);
  const response = ReviewPresentationSnapshotSchema.parse(input.response);
  const db = await database();
  const key = accountKey(input.owner);
  const scopeKey = reviewPresentationScopeKey(input.owner.backendId, response);
  const contextJson = JSON.stringify(response);
  if (new TextEncoder().encode(contextJson).byteLength > REVIEW_PRESENTATION_DISPLAY_CACHE_MAX_BYTES) {
    return false;
  }
  const now = new Date().toISOString();
  let wrote = false;
  let evicted = 0;
  await serialiseReviewMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
    const account = await activeAccount(transaction);
    if (
      !account ||
      account.account_key !== key ||
      account.workspace_id !== input.owner.workspaceId ||
      account.user_id !== input.owner.userId ||
      !input.owner.backendId
    ) {
      return;
    }

    const existing = await transaction.getFirstAsync<{ backend_id: string }>(
      `select backend_id from review_presentation_context
       where account_key = ? and scope_key = ?`,
      key,
      scopeKey
    );
    if (existing && existing.backend_id !== input.owner.backendId) return;

    const cachedReviewItems = presentationReviewItems(response);
    for (const [position, presented] of cachedReviewItems.entries()) {
      // A presentation record carries no reason fields; keep those an earlier bootstrap cached for
      // the same proposal, so the card's reason does not change with whichever read wrote last.
      const existing = await transaction.getFirstAsync<{ snapshot_json: string }>(
        "select snapshot_json from review_item_cache where account_key = ? and review_item_id = ?",
        key, presented.id
      );
      const earlier = existing ? parseReviewSnapshot(existing.snapshot_json) : null;
      // Presented fields (a time-away subtype) win; earlier reason fields fill in underneath.
      // The presentation is the outing's owner (this build always asks for it): a card it lists
      // in no outing keeps no outing an earlier read cached.
      const item = earlier?.rawPayload && sameCachedProposal(earlier, presented)
        ? { ...presented, rawPayload: { ...withoutOuting(earlier.rawPayload), ...(presented.rawPayload ?? {}) } }
        : presented;
      await transaction.runAsync(
        `insert into review_item_cache (
           account_key, review_item_id, snapshot_json, server_status, position, cached_at
         ) values (?, ?, ?, 'open', ?, ?)
         on conflict(account_key, review_item_id) do update set
           snapshot_json = excluded.snapshot_json,
           server_status = excluded.server_status,
           position = excluded.position,
           cached_at = excluded.cached_at`,
        key,
        item.id,
        JSON.stringify(sanitiseReviewItemForCache(item)),
        position,
        now
      );
    }
    // Records, looked-up items or links that show a saved card's place or its decision (Codex r2 on #460).
    await retireSavedPlaceOverlays(transaction, key, [...new Set([
      ...[...response.records, ...response.lookup.reviewItems].flatMap((record) =>
        record.kind === "missing_review" || (record.kind === "review" && (record.status !== "open" || record.place.id)) ? [record.reviewItemId] : []),
      ...response.links.flatMap((link) => link.status !== "open" ? [link.reviewItemId] : [])
    ])]);
    await transaction.runAsync(
      `insert into review_presentation_context (
         account_key, scope_key, backend_id, contract_version, snapshot_token,
         captured_at, cached_at, complete, context_json
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(account_key, scope_key) do update set
         backend_id = excluded.backend_id,
         contract_version = excluded.contract_version,
         snapshot_token = excluded.snapshot_token,
         captured_at = excluded.captured_at,
         cached_at = excluded.cached_at,
         complete = excluded.complete,
         context_json = excluded.context_json`,
      key,
      scopeKey,
      input.owner.backendId,
      response.version,
      response.snapshotToken,
      response.capturedAt,
      now,
      response.completeness.records && response.completeness.outstandingCounts ? 1 : 0,
      contextJson
    );
    await recordTerminalPresentationSources(transaction, key, scopeKey, input.owner.backendId, response);
    if (requestedAt) evicted = await evictItemsNoLongerOpen(transaction, key, response, requestedAt, scopeKey, input.owner.backendId);
    await pruneReviewPresentationContexts(transaction, key, scopeKey);
    await materialiseAcknowledgedReviewHandover(transaction, key, response, input.owner.backendId);
    await bumpPresentationRevision(key, transaction);
    wrote = true;
  }));
  if (wrote) {
    reviewCacheEvictedCount += evicted;
    emitChange();
  }
  return wrote;
}

/**
 * Every presentation read carries the complete set of open Review items (up to 5,000) from one
 * snapshot taken after the request arrived. A cached item written before the request and missing
 * from that set is no longer open (decided elsewhere, superseded by location replay, deleted): it
 * leaves the cache and gets terminal evidence at the read's capturedAt, and so does a card restored
 * by a rejection. That evidence is in force only until a strictly newer read lists the source open
 * (replay reopening it), so a delayed older open response or an older Today snapshot cannot bring
 * the card back, while a real reopening still does. Items cached after the request started and
 * hidden local decisions are left alone.
 */
async function evictItemsNoLongerOpen(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  response: ReviewPresentationSnapshot,
  requestedAt: string,
  scopeKey: string,
  backendId: string
) {
  if (!response.completeness.outstandingCounts) return 0;
  const open = new Set(response.outstanding.openReviewItemIds);
  const cached = await transaction.getAllAsync<{ review_item_id: string }>(
    "select review_item_id from review_item_cache where account_key = ? and cached_at < ?",
    accountKeyValue, requestedAt
  );
  const stale = cached.map((row) => row.review_item_id).filter((id) => !open.has(id));
  for (let offset = 0; offset < stale.length; offset += 200) {
    const chunk = stale.slice(offset, offset + 200);
    await transaction.runAsync(
      `delete from review_item_cache where account_key = ? and review_item_id in (${chunk.map(() => "?").join(",")})`,
      accountKeyValue, ...chunk
    );
  }
  const restored = await transaction.getAllAsync<{ review_item_id: string }>(
    `select e.review_item_id from review_mutation_effects e
     join review_mutation_outbox o on o.client_mutation_id = e.client_mutation_id and o.account_key = e.account_key
     where e.account_key = ? and e.local_effect = 'restore' and o.updated_at < ?`,
    accountKeyValue, requestedAt
  );
  const closed = new Set([...stale, ...restored.map((row) => row.review_item_id).filter((id) => !open.has(id))]);
  for (const reviewItemId of closed) {
    await compactOpenObservation(transaction, accountKeyValue, reviewItemId, backendId, response.capturedAt);
    await transaction.runAsync(
      `insert into review_presentation_terminal_source (
         account_key, review_item_id, scope_key, backend_id, snapshot_token, status, captured_at
       ) values (?, ?, ?, ?, ?, 'ignored', ?)
       on conflict(account_key, review_item_id) do update set
         scope_key = excluded.scope_key, backend_id = excluded.backend_id,
         snapshot_token = excluded.snapshot_token, status = excluded.status,
         captured_at = excluded.captured_at
       where excluded.captured_at >= review_presentation_terminal_source.captured_at
         or excluded.backend_id <> review_presentation_terminal_source.backend_id`,
      accountKeyValue, reviewItemId, scopeKey, backendId, `not-open:${response.snapshotToken}`, response.capturedAt
    );
  }
  return stale.length;
}

/**
 * Select a bounded batch of whole acknowledged mutations for a terminal read.
 * A structural action never has its affected sources split between requests;
 * one unmaterialised result cannot mask other sources in the batch. Old or
 * malformed envelopes are deliberately retained instead of being inferred as
 * resolved.
 */
export async function readAcknowledgedReviewHandoverLookup(input: {
  owner: ReviewPresentationOwner;
}): Promise<AcknowledgedReviewHandoverLookup | null> {
  const db = await database();
  const account = await activeAccount(db);
  const key = accountKey(input.owner);
  if (
    !account ||
    account.account_key !== key ||
    account.workspace_id !== input.owner.workspaceId ||
    account.user_id !== input.owner.userId ||
    !input.owner.backendId
  ) return null;

  const rows = await db.getAllAsync<{
    client_mutation_id: string;
    review_item_id: string;
    request_json: string;
    acknowledgement_json: string | null;
  }>(
    `select client_mutation_id, review_item_id, request_json, acknowledgement_json
     from review_mutation_outbox
     where account_key = ? and state = 'acknowledged' and action_kind <> 'save_place'
     order by coalesce(acknowledged_at, updated_at), client_mutation_id
     limit ?`,
    key,
    REVIEW_PRESENTATION_MAX_IDS
  );

  const batch: AcknowledgedReviewHandoverLookup[] = [];
  const sourceIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const row of rows) {
    const envelope = parseReviewMutationEnvelope(row.request_json);
    const acknowledgement = parseAcknowledgement(row.acknowledgement_json);
    if (!envelope || !acknowledgement || !validReviewAcknowledgement(acknowledgement, envelope, row.review_item_id)) {
      continue;
    }
    const effects = await db.getAllAsync<{ review_item_id: string }>(
      `select review_item_id from review_mutation_effects
       where account_key = ? and client_mutation_id = ?
       order by review_item_id`,
      key,
      row.client_mutation_id
    );
    const reviewItemIds = [...new Set(effects.map((effect) => effect.review_item_id))].sort();
    const entryIds = acknowledgementEntryIds(acknowledgement).sort();
    if (
      !reviewItemIds.length ||
      reviewItemIds.length > REVIEW_PRESENTATION_MAX_IDS ||
      entryIds.length > REVIEW_PRESENTATION_MAX_IDS
    ) {
      // Do not query a partial structural action or an unbounded legacy value.
      // Its durable receipt/effects remain recoverable for the existing
      // reconciliation path.
      continue;
    }
    const nextSources = new Set([...sourceIds, ...reviewItemIds]);
    const nextResults = new Set([...resultIds, ...entryIds]);
    if (nextSources.size > REVIEW_PRESENTATION_MAX_IDS || nextResults.size > REVIEW_PRESENTATION_MAX_IDS) continue;
    reviewItemIds.forEach((id) => sourceIds.add(id));
    entryIds.forEach((id) => resultIds.add(id));
    batch.push({
      clientMutationId: row.client_mutation_id,
      reviewItemIds,
      entryIds,
      signature: canonicalJson({
        clientMutationId: row.client_mutation_id,
        reviewItemIds,
        entryIds
      })
    });
  }
  if (!batch.length) return null;
  return {
    clientMutationId: batch[0].clientMutationId,
    reviewItemIds: [...sourceIds].sort(),
    entryIds: [...resultIds].sort(),
    signature: canonicalJson(batch.map((item) => item.signature))
  };
}

/** Reads a stable, owner- and backend-bound display snapshot without exposing
 * raw payloads or queued request JSON to a consuming Today component. */
export async function readReviewPresentationSnapshot(input: {
  owner: ReviewPresentationOwner;
  response: Pick<ReviewPresentationSnapshot, "scope">;
}): Promise<ReviewPresentationStoreSnapshot | null> {
  const db = await database();
  const account = await activeAccount(db);
  const key = accountKey(input.owner);
  if (
    !account ||
    account.account_key !== key ||
    account.workspace_id !== input.owner.workspaceId ||
    account.user_id !== input.owner.userId ||
    !input.owner.backendId
  ) return null;
  const scopeKey = reviewPresentationScopeKey(input.owner.backendId, input.response as ReviewPresentationSnapshot);
  const row = await db.getFirstAsync<PresentationContextRow>(
    `select scope_key, backend_id, contract_version, snapshot_token, captured_at,
            cached_at, complete, context_json
     from review_presentation_context
     where account_key = ? and scope_key = ? and backend_id = ?`,
    key,
    scopeKey,
    input.owner.backendId
  );
  if (!row) return null;
  let response: ReviewPresentationSnapshot;
  try {
    response = ReviewPresentationSnapshotSchema.parse(JSON.parse(row.context_json));
  } catch {
    return null;
  }
  const activeAfterRead = await activeAccount(db);
  if (activeAfterRead?.account_key !== key) return null;
  const terminal = await db.getAllAsync<{ review_item_id: string; captured_at: string }>(
    `select t.review_item_id, t.captured_at from review_presentation_terminal_source t
     where t.account_key = ? and t.backend_id = ? and t.captured_at >= ? and ${terminalInForceSql("t")}`,
    key, input.owner.backendId, response.capturedAt
  );
  response = withNewerTerminalEvidence(response, new Set(terminal.map((source) => source.review_item_id)));
  // Today shows a card being saved as a place under that place, as Review does (Codex r1 on #460).
  const saved = await pendingSavedPlaceNames(key, db);
  if (saved.size) {
    response = { ...response, records: response.records.map((record) => {
      const place = record.kind === "review" ? saved.get(record.reviewItemId) : undefined;
      return place && record.kind === "review"
        ? { ...record, title: place.name, place: { id: place.placeId ?? record.place.id, label: place.name } }
        : record;
    }) };
  }
  // A card restored by a rejection is drawn from its effect; once its source is closed it is gone.
  const closed = await terminalReviewItemIds(key, input.owner.backendId);
  const effects = (await readPresentationEffects(db, key))
    .filter((effect) => !(effect.localEffect === "restore" && closed.has(effect.reviewItemId)));
  const revision = Number(await metadata(accountMetadataKey(PRESENTATION_REVISION_KEY, key), db) ?? "0");
  return {
    response,
    cachedAt: row.cached_at,
    localRevision: Number.isFinite(revision) ? revision : 0,
    effects
  };
}

/**
 * A cached snapshot shows what was open when it was captured. Sources with terminal evidence newer
 * than that (settled elsewhere, a later lookup) are no longer open: they leave its records and its
 * open set, and its counts drop by the ones it counted, so Today never shows them again.
 */
export function withNewerTerminalEvidence(
  response: ReviewPresentationSnapshot,
  closed: ReadonlySet<string>
): ReviewPresentationSnapshot {
  if (closed.size === 0) return response;
  const wasOpen = new Set(response.outstanding.openReviewItemIds);
  const removedOpen = [...closed].filter((id) => wasOpen.has(id));
  const today = response.scope.today;
  const todayStart = today ? Date.parse(today.start) : NaN;
  const todayEnd = today ? Date.parse(today.end) : NaN;
  const removedToday = response.records.filter((record) => {
    if (record.kind !== "review" || record.status !== "open" || !closed.has(record.reviewItemId)) return false;
    const start = Date.parse(record.interval.start ?? "");
    const end = Date.parse(record.interval.end ?? "");
    return Number.isFinite(start) && Number.isFinite(end)
      ? start < todayEnd && end > todayStart
      : Date.parse(record.createdAt) >= todayStart && Date.parse(record.createdAt) < todayEnd;
  }).length;
  return {
    ...response,
    records: response.records.filter((record) => !(record.kind === "review" && record.status === "open" && closed.has(record.reviewItemId))),
    links: response.links.filter((link) => !(link.status === "open" && closed.has(link.reviewItemId))),
    outstanding: {
      ...response.outstanding,
      globalCount: Math.max(0, response.outstanding.globalCount - removedOpen.length),
      todayCount: Math.max(0, response.outstanding.todayCount - removedToday),
      openReviewItemIds: response.outstanding.openReviewItemIds.filter((id) => !closed.has(id))
    }
  };
}

/** Re-reads the cached source under the current owner instead of allowing a
 * rendered row to close over stale proposal values. */
export async function readCurrentReviewSourceForQuickConfirm(input: {
  owner: ReviewPresentationOwner;
  response: Pick<ReviewPresentationSnapshot, "scope">;
  reviewItemId: string;
}): Promise<CurrentQuickConfirmSource | null> {
  const snapshot = await readReviewPresentationSnapshot({
    owner: input.owner,
    response: input.response
  });
  if (!snapshot) return null;
  const source = [...snapshot.response.records, ...snapshot.response.lookup.reviewItems]
    .find((record): record is ReviewProposalPresentation =>
      record.kind === "review" && record.reviewItemId === input.reviewItemId
    );
  if (!source) return null;
  const bootstrap = await loadCachedReviewBootstrap();
  if (
    !bootstrap ||
    bootstrap.bootstrap.workspace.id !== input.owner.workspaceId ||
    bootstrap.bootstrap.user.id !== input.owner.userId
  ) return null;
  const item = bootstrap.bootstrap.reviewItems.find((candidate) => candidate.id === input.reviewItemId);
  if (!item) return null;
  return {
    source,
    item,
    bootstrap: bootstrap.bootstrap,
    effect: snapshot.effects.find((effect) => effect.reviewItemId === input.reviewItemId) ?? null
  };
}

export function reviewPresentationScopeKey(
  backendId: string,
  response: Pick<ReviewPresentationSnapshot, "scope">
) {
  const { scope } = response;
  return canonicalJson({
    backendId,
    version: 1,
    mode: scope.mode,
    window: scope.window ?? null,
    today: scope.today ?? null,
    timeZone: scope.timeZone,
    reviewItemIds: scope.reviewItemIds ? [...scope.reviewItemIds].sort() : null,
    entryIds: scope.entryIds ? [...scope.entryIds].sort() : null
  });
}

function sameCachedProposal(left: MobileReviewItem, right: MobileReviewItem) {
  return left.id === right.id && left.title === right.title && left.eventType === right.eventType &&
    left.suggestedStartedAt === right.suggestedStartedAt && left.suggestedStoppedAt === right.suggestedStoppedAt &&
    left.suggestedCategoryId === right.suggestedCategoryId && left.suggestedPlaceId === right.suggestedPlaceId &&
    left.confidence === right.confidence && left.eventSource === right.eventSource;
}

function presentationReviewItems(response: ReviewPresentationSnapshot) {
  const records = [
    ...response.records,
    ...response.lookup.reviewItems
  ];
  const byId = new Map<string, MobileReviewItem>();
  for (const record of records) {
    if (record.kind !== "review" || record.status !== "open") continue;
    const item = mobileReviewItemFromPresentation(record);
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function mobileReviewItemFromPresentation(record: ReviewProposalPresentation): MobileReviewItem {
  return {
    id: record.reviewItemId,
    type: record.sourceKind === "location_v2" ? "location" : "review",
    ...(record.sourceKind === "location_v2"
      ? { presentationSourceKind: "location_v2" as const }
      : {}),
    title: record.title,
    eventSource: record.eventSource,
    eventType: record.eventType,
    categoryName: record.category.name,
    categoryColor: record.category.color,
    placeName: record.place.label,
    suggestedCategoryId: record.category.id,
    suggestedPlaceId: record.place.id,
    suggestedStartedAt: record.interval.start,
    suggestedStoppedAt: record.interval.end,
    confidence: record.confidence,
    status: record.status,
    notes: null,
    // Coordinate-free subtype and a Move's route line only, so time away keeps its labels and no
    // Commute fallback, and a Move keeps its second line (PRD D19).
    rawPayload: record.timeAway || record.routeLabel || record.outing ? {
      ...(record.timeAway ? { qualificationReason: "same_place_outing", stopCount: record.timeAway.stopCount } : {}),
      ...(record.routeLabel ? { routeLabel: record.routeLabel } : {}),
      // One card per outing (PRD D19): which outing it belongs to and its part in it.
      ...(record.outing ? { [OUTING_KEY_PAYLOAD_KEY]: record.outing.key, [OUTING_ROLE_PAYLOAD_KEY]: record.outing.role } : {}),
      // A Move's way of travelling, so a backlog-only outing's travel line names it (Codex r2 on #473).
      ...(record.outing?.travelMode ? { travelMode: record.outing.travelMode } : {})
    } : null,
    createdAt: record.createdAt
  };
}

function proposalHashFromPresentationContext(contextJson: string, reviewItemId: string) {
  try {
    const response = ReviewPresentationSnapshotSchema.parse(JSON.parse(contextJson));
    const source = [...response.records, ...response.lookup.reviewItems]
      .find((record): record is ReviewProposalPresentation =>
        record.kind === "review" && record.reviewItemId === reviewItemId
      );
    return source?.status === "open" ? source.proposalHash : null;
  } catch {
    return null;
  }
}

async function recordTerminalPresentationSources(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  scopeKey: string,
  backendId: string,
  response: ReviewPresentationSnapshot
) {
  const records = [...response.records, ...response.lookup.reviewItems];
  for (const record of records) {
    // Only a later authoritative open record reverses terminal suppression
    // from this backend. An older or equal captured snapshot cannot resurrect
    // a source after a delayed response arrives, and another backend stays
    // isolated.
    if (record.kind !== "review" || record.status !== "open") continue;
    await recordOpenObservation(transaction, accountKeyValue, record.reviewItemId, backendId, response.capturedAt);
    await transaction.runAsync(
      `delete from review_presentation_terminal_source
       where account_key = ? and review_item_id = ? and backend_id = ?
         and captured_at < ?`,
      accountKeyValue,
      record.reviewItemId,
      backendId,
      response.capturedAt
    );
  }
  for (const [reviewItemId, status] of terminalStatusesFromPresentation(response)) {
    await compactOpenObservation(transaction, accountKeyValue, reviewItemId, backendId, response.capturedAt);
    await transaction.runAsync(
      `insert into review_presentation_terminal_source (
         account_key, review_item_id, scope_key, backend_id, snapshot_token, status, captured_at
       ) values (?, ?, ?, ?, ?, ?, ?)
       on conflict(account_key, review_item_id) do update set
         scope_key = excluded.scope_key,
         backend_id = excluded.backend_id,
         snapshot_token = excluded.snapshot_token,
         status = excluded.status,
         captured_at = excluded.captured_at
       -- Terminal evidence only moves forward in time; a delayed older read cannot lower it.
       where excluded.captured_at >= review_presentation_terminal_source.captured_at
         or excluded.backend_id <> review_presentation_terminal_source.backend_id`,
      accountKeyValue,
      reviewItemId,
      scopeKey,
      backendId,
      response.snapshotToken,
      status,
      response.capturedAt
    );
  }
}

async function pruneReviewPresentationContexts(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  currentScopeKey: string
) {
  const rows = await transaction.getAllAsync<PresentationContextRow>(
    `select scope_key, backend_id, contract_version, snapshot_token, captured_at,
            cached_at, complete, context_json
     from review_presentation_context
     where account_key = ?
     order by cached_at desc, scope_key desc`,
    accountKeyValue
  );
  let retainedBytes = 0;
  for (const [index, row] of rows.entries()) {
    const bytes = new TextEncoder().encode(row.context_json).byteLength;
    const shouldKeep = index < REVIEW_PRESENTATION_CONTEXT_LIMIT &&
      retainedBytes + bytes <= REVIEW_PRESENTATION_DISPLAY_CACHE_MAX_BYTES;
    if (shouldKeep || row.scope_key === currentScopeKey) {
      retainedBytes += bytes;
      continue;
    }
    await transaction.runAsync(
      `delete from review_presentation_context where account_key = ? and scope_key = ?`,
      accountKeyValue,
      row.scope_key
    );
  }
}

async function materialiseAcknowledgedReviewHandover(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  response: ReviewPresentationSnapshot,
  backendId: string
) {
  const rows = await transaction.getAllAsync<{
    client_mutation_id: string;
    review_item_id: string;
    request_json: string;
    acknowledgement_json: string | null;
  }>(
    `select client_mutation_id, review_item_id, request_json, acknowledgement_json
     from review_mutation_outbox
     where account_key = ? and state = 'acknowledged' and action_kind <> 'save_place'`,
    accountKeyValue
  );
  const terminalById = terminalStatusesFromPresentation(response);
  const lookupEntries = entryLookupFromPresentation(response);
  const linksByReviewId = new Map(response.links.map((link) => [link.reviewItemId, link]));
  for (const row of rows) {
    const envelope = parseReviewMutationEnvelope(row.request_json);
    const acknowledgement = parseAcknowledgement(row.acknowledgement_json);
    if (!envelope || !acknowledgement || !validReviewAcknowledgement(acknowledgement, envelope, row.review_item_id)) continue;
    const effects = await transaction.getAllAsync<{ review_item_id: string }>(
      `select review_item_id from review_mutation_effects
       where account_key = ? and client_mutation_id = ?`,
      accountKeyValue,
      row.client_mutation_id
    );
    if (!effects.length || effects.some((effect) => !terminalById.has(effect.review_item_id))) continue;
    const acknowledgementIds = acknowledgementEntryIds(acknowledgement);
    const requiresLinkedResult = acknowledgementRequiresLinkedResult(
      acknowledgement,
      envelope
    );
    const linkedEntryIds: string[] = [];
    let missingAcceptedProof = false;
    for (const effect of effects) {
      if (terminalById.get(effect.review_item_id) !== "accepted") continue;
      const link = linksByReviewId.get(effect.review_item_id);
      const sourceEntryIds = link?.status === "accepted" ? link.entryIds : [];
      linkedEntryIds.push(...sourceEntryIds);
      // An equivalent accept/confirm intentionally has no result ID in its
      // receipt. It must first follow the server's explicit source-to-entry
      // link; ordinary merge/split structural receipts already identify their
      // canonical outcome (or have no time-entry outcome at all).
      if (requiresLinkedResult && !sourceEntryIds.length) {
        missingAcceptedProof = true;
      }
    }
    if (missingAcceptedProof) continue;
    const resultEntryIds = [...new Set([...acknowledgementIds, ...linkedEntryIds])];
    const materialised = resultEntryIds.every((entryId) => {
      const status = lookupEntries.get(entryId);
      return status === "missing" || status === "present";
    });
    if (!materialised) continue;
    for (const effect of effects) {
      // A newer read already lists this source open again (replay reopened it): it is a live card
      // now, so the handover retires the acknowledged intent but keeps the cached source.
      const reopened = await transaction.getFirstAsync(
        `select 1 as found from review_source_open_observation
         where account_key = ? and review_item_id = ? and backend_id = ? and observed_at > ?`,
        accountKeyValue, effect.review_item_id, backendId, response.capturedAt
      );
      if (reopened) continue;
      await transaction.runAsync(
        `delete from review_item_cache where account_key = ? and review_item_id = ?`,
        accountKeyValue,
        effect.review_item_id
      );
    }
    await transaction.runAsync(
      `delete from review_mutation_outbox
       where account_key = ? and client_mutation_id = ? and state = 'acknowledged'`,
      accountKeyValue,
      row.client_mutation_id
    );
  }
}

function terminalStatusesFromPresentation(response: ReviewPresentationSnapshot) {
  const statuses = new Map<string, "accepted" | "ignored" | "missing">();
  for (const record of [...response.records, ...response.lookup.reviewItems]) {
    if (record.kind === "missing_review") {
      statuses.set(record.reviewItemId, "missing");
    } else if (record.kind === "review" && (
      record.status === "accepted" || record.status === "ignored"
    )) {
      statuses.set(record.reviewItemId, record.status);
    }
  }
  return statuses;
}

function entryLookupFromPresentation(response: ReviewPresentationSnapshot) {
  const statuses = new Map<string, "present" | "missing">();
  for (const record of [...response.records, ...response.lookup.entries]) {
    if (record.kind === "completed_entry") statuses.set(record.entryId, "present");
    if (record.kind === "missing_entry") statuses.set(record.entryId, "missing");
  }
  return statuses;
}

function parseAcknowledgement(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function acknowledgementEntryIds(value: Record<string, unknown>) {
  const ids = [
    typeof value.entryId === "string" ? value.entryId : null,
    ...(Array.isArray(value.entryIds) ? value.entryIds.filter((id): id is string => typeof id === "string") : [])
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

function acknowledgementRequiresLinkedResult(
  acknowledgement: Record<string, unknown>,
  envelope: ReviewMutationEnvelope
) {
  return (
    (envelope.mutation.action === "accept" || envelope.mutation.action === "confirm" || envelope.mutation.action === "confirm_outing") &&
    acknowledgement.alreadyResolved === true &&
    acknowledgement.equivalent === true
  );
}

async function readPresentationEffects(db: SQLite.SQLiteDatabase, accountKeyValue: string) {
  const rows = await db.getAllAsync<{
    review_item_id: string;
    action_kind: string;
    state: ReviewMutationState;
    local_effect: "hidden" | "restore";
    resolution_status: string | null;
    acknowledgement_json: string | null;
    snapshot_json: string;
  }>(
    `select e.review_item_id, o.action_kind, o.state, e.local_effect,
            o.resolution_status, o.acknowledgement_json, e.snapshot_json
     from review_mutation_effects e
     join review_mutation_outbox o
       on o.client_mutation_id = e.client_mutation_id and o.account_key = e.account_key
     where e.account_key = ?
     order by o.created_at, e.review_item_id`,
    accountKeyValue
  );
  return rows.map((row): ReviewPresentationStoreEffect => ({
    reviewItemId: row.review_item_id,
    action: row.action_kind,
    state: row.state,
    localEffect: row.local_effect,
    resolution: reviewPresentationResolution(row.state, row.resolution_status),
    canonicalEntryIds: acknowledgementEntryIds(parseAcknowledgement(row.acknowledgement_json) ?? {}),
    source: presentationEffectSource(row.review_item_id, row.snapshot_json)
  }));
}

function presentationEffectSource(reviewItemId: string, snapshotJson: string): ReviewPresentationStoreEffect["source"] {
  const item = parseReviewSnapshot(snapshotJson);
  if (!item) return null;
  return {
    reviewItemId,
    sourceKind: item.type === "location" ? "location_v2" : "generic",
    title: item.title,
    category: {
      id: item.suggestedCategoryId,
      name: item.categoryName,
      color: item.categoryColor ?? null
    },
    placeLabel: item.placeName,
    interval: { start: item.suggestedStartedAt, end: item.suggestedStoppedAt },
    createdAt: item.createdAt,
    eventSource: item.eventSource,
    eventType: item.eventType
  };
}

function reviewPresentationResolution(state: ReviewMutationState, status: string | null): ReviewPresentationStoreEffect["resolution"] {
  if (state === "acknowledged") return "verified";
  if (state === "needs_attention") return status === "resolution_unknown" ? "unknown" : "rejected";
  return "pending";
}

async function bumpPresentationRevision(accountKeyValue: string, transaction: SQLite.SQLiteDatabase) {
  const value = Number(await metadata(accountMetadataKey(PRESENTATION_REVISION_KEY, accountKeyValue), transaction) ?? "0");
  await setMetadata(
    accountMetadataKey(PRESENTATION_REVISION_KEY, accountKeyValue),
    String((Number.isFinite(value) ? value : 0) + 1),
    transaction
  );
}

function isOutingMutation(mutation: ReviewMutation): mutation is Extract<ReviewMutation, { action: "confirm_outing" | "ignore_outing" }> {
  return mutation.action === "confirm_outing" || mutation.action === "ignore_outing";
}

export async function enqueueReviewMutation(input: {
  bootstrap: MobileBootstrap;
  item: MobileReviewItem;
  mutation: ReviewMutation;
  clientMutationId: string;
  affectedItems?: MobileReviewItem[];
  presentation?: {
    backendId: string;
    scope: ReviewPresentationSnapshot["scope"];
  };
}) {
  const envelope = ReviewMutationEnvelopeSchema.parse({ clientMutationId: input.clientMutationId, mutation: input.mutation });
  const mutation = envelope.mutation;
  const outing = isOutingMutation(mutation);
  const expectedIds = [...new Set(mutation.action === "merge" || mutation.action === "merge_and_confirm"
    ? [input.item.id, mutation.adjacentReviewItemId]
    : outing ? [input.item.id, ...mutation.memberReviewItemIds] : [input.item.id])].sort();
  if ((mutation.action === "merge" || mutation.action === "merge_and_confirm") && expectedIds.length !== 2) {
    throw new Error("Choose a different adjacent visit.");
  }
  if (outing && expectedIds.length !== mutation.memberReviewItemIds.length + 1) {
    throw new Error("An outing lists the same moment twice.");
  }
  const affected = [...(input.affectedItems ?? [input.item])].sort((a, b) => a.id.localeCompare(b.id));
  if (affected.length !== expectedIds.length || affected.some((item, index) => item.id !== expectedIds[index])) {
    throw new Error(outing
      ? "Every part of this outing must be available in saved Review data."
      : "Both visits must be available in saved Review data before merging.");
  }
  for (const item of affected) {
    assertActionableReviewItem(item);
    if ((mutation.action === "merge" || mutation.action === "merge_and_confirm") && !isLocationReviewItem(item)) {
      throw new Error("Only saved Location Review visits can be merged.");
    }
    if (outing && !isLocationReviewItem(item)) throw new Error("Only Location Review moments make an outing.");
    if (!input.bootstrap.reviewItems.some((cached) => cached.id === item.id && cached.status === "open")) {
      throw new Error("This suggestion is no longer available in this account's Review data.");
    }
  }
  const key = accountKey({ workspaceId: input.bootstrap.workspace.id, userId: input.bootstrap.user.id });
  const requestJson = canonicalJson(envelope);
  // "Save this place" (PRD D19) keeps its card open: it owns no source effect, so the card stays shown
  // and its own decision can follow (`afterSave`).
  const keepsCardOpen = mutation.action === "save_place";
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
  let persistedEnvelope = envelope;
  const localCommitStartedAt = Date.now();
  const record = captureDiagnosticsWriter();
  await serialiseReviewMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
    const account = await activeAccount(transaction);
    if (!account || account.account_key !== key) throw new Error("Review data is not configured for this account.");
    const existing = await transaction.getFirstAsync<{ account_key: string; review_item_id: string; request_json: string }>(
      "select account_key, review_item_id, request_json from review_mutation_outbox where client_mutation_id = ?", envelope.clientMutationId
    );
    if (existing) {
      if (existing.account_key === key && existing.review_item_id === input.item.id &&
        existing.request_json === requestJson) {
        idempotent = true;
        return;
      }
      // A confirmation stored as its explicit edit behind a save (`afterSave`): the same one only when
      // its times are still the card's (Codex r2 on #460).
      const stored = parseReviewMutationEnvelope(existing.request_json);
      const converted = afterSave(envelope, input.item, null);
      if (existing.account_key === key && existing.review_item_id === input.item.id && stored?.mutation.action === "edit_and_confirm" &&
        converted.mutation.action === "edit_and_confirm" && (mutation.action === "confirm" || mutation.action === "accept") &&
        stored.mutation.edit.startedAt === converted.mutation.edit.startedAt && stored.mutation.edit.stoppedAt === converted.mutation.edit.stoppedAt) {
        idempotent = true;
        persistedEnvelope = stored;
        return;
      }
      throw new Error("This Review mutation ID is already used for different data.");
    }
    for (const effect of effects) {
      const cached = await transaction.getFirstAsync<{ server_status: string }>(
        "select server_status from review_item_cache where account_key = ? and review_item_id = ?", key, effect.item.id
      );
      if (cached?.server_status !== "open") throw new Error("Refresh Review before saving this suggestion.");
      const owned = await transaction.getFirstAsync<{ client_mutation_id: string; request_json: string }>(
        `select e.client_mutation_id, o.request_json
         from review_mutation_effects e
         join review_mutation_outbox o
           on o.client_mutation_id = e.client_mutation_id
          and o.account_key = e.account_key
         where e.account_key = ? and e.review_item_id = ?`, key, effect.item.id
      );
      if (owned) {
        const existingEnvelope = parseReviewMutationEnvelope(owned.request_json);
        if (
          existingEnvelope &&
          canonicalJson(existingEnvelope.mutation) === canonicalJson(mutation)
        ) {
          idempotent = true;
          persistedEnvelope = existingEnvelope;
          return;
        }
        throw new Error("A different saved Review change already exists for one of these suggestions.");
      }
    }
    const pendingSave = await transaction.getFirstAsync<{ request_json: string; state: ReviewMutationState }>(
      `select request_json, state from review_mutation_outbox
       where account_key = ? and review_item_id = ? and action_kind = 'save_place'`, key, input.item.id
    );
    if (keepsCardOpen && pendingSave) {
      const existingEnvelope = parseReviewMutationEnvelope(pendingSave.request_json);
      if (existingEnvelope && canonicalJson(existingEnvelope.mutation) === canonicalJson(mutation)) {
        idempotent = true;
        persistedEnvelope = existingEnvelope;
        return;
      }
      throw new Error("This place is already being saved.");
    }
    // Behind a save still going through, or answered while the card still shows it from this iPhone,
    // a confirmation states what the person saw (its times and the activity the save gives it) instead
    // of the proposal hash the save changed, so replay can't slip other values in (Codex r1/r2 on
    // #460). Behind a rejected save it stays as it was.
    const savedFor = pendingSave && pendingSave.state !== "needs_attention" ? parseReviewMutationEnvelope(pendingSave.request_json) : null;
    const stored = savedFor ? afterSave(envelope, input.item, savedFor.mutation) : envelope;
    const expectedProposalHash = stored.mutation.action === "accept" || stored.mutation.action === "confirm"
      ? stored.mutation.expectedProposalHash
      : undefined;
    if (expectedProposalHash) {
      if (!input.presentation?.backendId) {
        throw new Error("Refresh Review before saving this confirmation.");
      }
      const scopeKey = reviewPresentationScopeKey(input.presentation.backendId, { scope: input.presentation.scope });
      const context = await transaction.getFirstAsync<PresentationContextRow>(
        `select scope_key, backend_id, contract_version, snapshot_token, captured_at,
                cached_at, complete, context_json
         from review_presentation_context
         where account_key = ? and scope_key = ? and backend_id = ?`,
        key,
        scopeKey,
        input.presentation.backendId
      );
      const currentHash = context
        ? proposalHashFromPresentationContext(context.context_json, input.item.id)
        : null;
      if (currentHash !== expectedProposalHash) {
        throw new Error("This Review proposal changed. Refresh it before confirming.");
      }
    }
    if (idempotent) return;
    persistedEnvelope = stored;
    await transaction.runAsync(
      `insert into review_mutation_outbox (
        client_mutation_id, account_key, workspace_id, user_id, review_item_id, action_kind, request_json,
        original_snapshot_json, original_position, preceding_ids_json, following_ids_json,
        state, local_effect, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      envelope.clientMutationId, key, input.bootstrap.workspace.id, input.bootstrap.user.id, input.item.id,
      stored.mutation.action, canonicalJson(stored), primary.snapshot, primary.position, primary.preceding, primary.following,
      keepsCardOpen ? "restore" : "hidden", now, now
    );
    if (keepsCardOpen) return;
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
  record(() => {
    lastLocalMutationAction = mutation.action;
    lastLocalMutationCommitDurationMs = Date.now() - localCommitStartedAt;
    lastLocalMutationCommittedAt = new Date().toISOString();
  });
  emitChange();
  return { envelope: persistedEnvelope, idempotent };
}

export type ReviewSyncOptions = { force?: boolean; signal?: AbortSignal; deadlineAt?: number; clientMutationId?: string };
// An outcome left unknown (a reconcile that timed out or got no proof, e.g. while connectivity
// dropped) is not a rejection: it is re-checked on ordinary passes after this pause, so it
// settles on its own instead of waiting for the person (I1).
export const REVIEW_UNKNOWN_RECHECK_MS = 5 * 60_000;
export const REVIEW_RECONCILE_AGE_MS = 10 * 60_000;
export const REVIEW_CONTENTION_LIMIT = 3;
const reviewCoalescer = createOwnerSyncCoalescer<ReviewSyncResult>();

export async function synchroniseReviewMutations(options: ReviewSyncOptions = {}): Promise<ReviewSyncResult> {
  const account = await activeAccount();
  if (!account) return { acknowledgedCount: 0, waitingCount: 0, needsAttentionCount: 0, stopped: false, reason: "no_account", outcome: "complete" };
  const manualKey = accountMetadataKey("manual_reconciliation_requested", account.account_key);
  return reviewCoalescer.run(account.account_key, Boolean(options.force), async force => {
    // A later owner must never inherit an earlier owner's forced follow-up.
    if ((await activeAccount())?.account_key !== account.account_key) {
      return {acknowledgedCount:0,waitingCount:0,needsAttentionCount:0,stopped:true,outcome:"cancelled"};
    }
    const persistedManual = await metadata(manualKey) === "true";
    try { return await synchroniseReviewMutationsUnsafe(account, { ...options, force: force || persistedManual }); }
    finally { emitChange(); }
  }, () => serialiseReviewMutation(() => setMetadata(manualKey, "true")));
}

async function synchroniseReviewMutationsUnsafe(account: AccountRow, options: ReviewSyncOptions): Promise<ReviewSyncResult> {
  const db = await database();
  const sessionRead = await readOwnedAuthenticatedSessionSnapshot({ userId: account.user_id, workspaceId: account.workspace_id });
  if (sessionRead.status !== "authenticated") {
    // A changed owner is cancellation, not a rejection of that owner's intent.
    if (sessionRead.status === "changed" || sessionRead.status === "owner_mismatch" || (await activeAccount(db))?.account_key !== account.account_key) return {acknowledgedCount:0,waitingCount:0,needsAttentionCount:0,stopped:true,outcome:"cancelled"};
    await markAccountAuthenticationRequired(account.account_key);
    const diagnostics = await getReviewSyncDiagnostics();
    return {acknowledgedCount:0,waitingCount:diagnostics.waitingCount,needsAttentionCount:diagnostics.needsAttentionCount,stopped:true,reason:"no_session",outcome:"authentication_required"};
  }
  const isCurrent = async () => !options.signal?.aborted && isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) &&
    (await activeAccount(db))?.account_key === account.account_key;
  if (!await isCurrent()) return {acknowledgedCount:0,waitingCount:0,needsAttentionCount:0,stopped:true,outcome:"cancelled"};
  if (options.force) await serialiseReviewMutation(() => setMetadata(accountMetadataKey("manual_reconciliation_requested",account.account_key), "false"));
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + 45_000);
  await restoreInterruptedReconciliation(db, account.account_key);
  // Snapshot selection prevents force from consuming a newly written backoff.
  const rows = await db.getAllAsync<MutationRow>(
    `select * from review_mutation_outbox o where account_key=?
       and (? is null or client_mutation_id=?)
       and ${saveBlockedSql("o")}
       and (state in ('pending','in_flight') or (state='needs_attention' and ?=1)
         or (${unknownOutcomeSql()} and updated_at<=?)
         or (state='retry_wait' and (?=1 or next_attempt_at is null or next_attempt_at<=?
           or (reconciliation_attempt_count=0 and (contention_count>=3 or created_at<=?)))))
     order by created_at,client_mutation_id limit 25`,
    account.account_key,options.clientMutationId??null,options.clientMutationId??null,options.force?1:0,
    new Date(Date.now()-REVIEW_UNKNOWN_RECHECK_MS).toISOString(),options.force?1:0,new Date().toISOString(),new Date(Date.now()-REVIEW_RECONCILE_AGE_MS).toISOString());
  // Rows an older build parked although the moment was only decided elsewhere are re-checked once
  // each (an ordinary pass, no force); a row that is still a real rejection afterwards stays parked.
  const recheckedKey = accountMetadataKey(LEGACY_RECHECKED_KEY, account.account_key);
  const rechecked = new Set(parseStringArray(await metadata(recheckedKey, db) ?? "[]"));
  const legacyCandidates = (await db.getAllAsync<MutationRow>(
    `select * from review_mutation_outbox where account_key=? and (? is null or client_mutation_id=?) and ${legacyResolvedElsewhereSql()}
     order by created_at,client_mutation_id`,
    account.account_key,options.clientMutationId??null,options.clientMutationId??null
  )).filter(row => !rechecked.has(row.client_mutation_id));
  // Marked when processed, however the pass selected it (an ordinary pass or a forced one).
  const legacyIds = new Set(legacyCandidates.map(row => row.client_mutation_id));
  const selected = new Set(rows.map(row => row.client_mutation_id));
  rows.push(...legacyCandidates.filter(row => !selected.has(row.client_mutation_id)));
  rows.sort((left,right) => left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1
    : left.client_mutation_id < right.client_mutation_id ? -1 : left.client_mutation_id > right.client_mutation_id ? 1 : 0);
  rows.splice(25);
  let acknowledgedCount=0;
  let outcome: SyncLaneOutcome="complete";
  let stopped=false;
  const affected = new Set<string>();
  for (const row of rows) {
    if (!await isCurrent() || Date.now() >= deadlineAt) { outcome="cancelled";stopped=true;break; }
    const envelope = parseReviewMutationEnvelope(row.request_json);
    if (!envelope) { await markMutation(row.client_mutation_id,"needs_attention",null,"Saved action could not be read.",null,"hidden");outcome="needs_attention";continue; }
    const effectRows=await db.getAllAsync<{review_item_id:string}>("select review_item_id from review_mutation_effects where account_key=? and client_mutation_id=?",account.account_key,row.client_mutation_id);
    // A card's actions go one per pass, in order: a "Save this place" row (no source effect) holds
    // its card too, so the decision saved after it is sent only once the save has gone.
    const holds=effectRows.length?effectRows.map(effect=>effect.review_item_id):[row.review_item_id];
    if(holds.some(id=>affected.has(id))) continue;
    // A decision waits for any earlier save of its cards' places still unresolved, whatever this pass
    // selected (backoff, attention): it is sent only once the save went or was discarded (Codex r1 on #460).
    if(row.action_kind!=="save_place") {
      const waiting=await db.getFirstAsync<{n:number}>(`select 1 as n from review_mutation_outbox where account_key=? and action_kind='save_place'
        and state<>'acknowledged' and created_at<=? and client_mutation_id<>? and review_item_id in (${holds.map(()=>"?").join(",")})`,
        account.account_key,row.created_at,row.client_mutation_id,...holds);
      if(waiting) continue;
    }
    holds.forEach(id=>affected.add(id));
    if (legacyIds.has(row.client_mutation_id)) {
      rechecked.add(row.client_mutation_id);
      const live = new Set((await db.getAllAsync<{client_mutation_id:string}>(
        "select client_mutation_id from review_mutation_outbox where account_key=?",account.account_key)).map(item=>item.client_mutation_id));
      await serialiseReviewMutation(()=>setMetadata(recheckedKey,JSON.stringify([...rechecked].filter(id=>live.has(id)))));
    }
    const reconcile = row.state === "needs_attention" || row.state === "in_flight" || row.resolution_status === "delivery_interrupted" ||
      row.contention_count >= REVIEW_CONTENTION_LIMIT || Date.now()-Date.parse(row.created_at) >= REVIEW_RECONCILE_AGE_MS;
    const request = (path: string, body: string) => mobileJsonRequest(`${DAYFRAME_API_BASE}${path}`, {
      method:"POST",headers:{Authorization:`Bearer ${sessionRead.snapshot.token}`,"Content-Type":"application/json"},body,signal:options.signal
    }, {timeoutMilliseconds:Math.max(1,Math.min(REVIEW_SYNC_REQUEST_TIMEOUT_MS,deadlineAt-Date.now())),
      timeoutMessage:"Review sync timed out. Your saved change is preserved.",isCurrent});
    const attention = async (reason: string, status: number|null = null, restoreIds: string[] = []) => {
      await markMutation(row.client_mutation_id,"needs_attention",status,reason,null,"hidden",restoreIds);
      await serialiseReviewMutation(()=>db.runAsync("update review_mutation_outbox set resolution_status=? where client_mutation_id=? and account_key=?",reason,row.client_mutation_id,account.account_key));
      outcome="needs_attention";
    };
    try {
      if (reconcile) {
        await serialiseReviewMutation(()=>db.runAsync(`update review_mutation_outbox set reconciliation_attempt_count=reconciliation_attempt_count+1,
          last_reconciled_at=?,resolution_status='reconciling' where client_mutation_id=? and account_key=?`,new Date().toISOString(),row.client_mutation_id,account.account_key));
        const {response,body}=await request("/api/review/mutations/reconcile",JSON.stringify({mutations:[{...envelope,reviewItemId:row.review_item_id}]}));
        if(response.status===401||response.status===403) {if((await activeAccount(db))?.account_key===account.account_key) await markAccountAuthenticationRequired(account.account_key);outcome="authentication_required";stopped=true;break;}
        if(!await isCurrent()) {outcome="cancelled";stopped=true;break;}
        const parsed=ReviewReconciliationResponseSchema.safeParse(body);
        const proof=parsed.success&&parsed.data.results.length===1?parsed.data.results[0]:null;
        if(!response.ok && !(response.status>=200&&response.status<300) || !proof || proof.clientMutationId!==row.client_mutation_id || proof.reviewItemId!==row.review_item_id) {
          await attention("resolution_unknown",response.status);continue;
        }
        if ((proof.state==="applied"||proof.state==="equivalent_applied") && validReviewAcknowledgement(proof.result,envelope,row.review_item_id)) {
          await acknowledgeReviewMutation(row,proof.result!,response.status,isCurrent);acknowledgedCount++;continue;
        }
        // Gone, or decided differently elsewhere: the moment is settled, not a rejection.
        // Only a single-source proof says which source was decided; a merge keeps its parked row.
        // An outing is decided whole or not at all (no receipt, nothing written): its own request
        // answers which parts are still open, and that answer settles it (below).
        if(isOutingMutation(envelope.mutation)&&(proof.state==="missing"||(proof.state==="conflict"&&proof.reason==="different_final_decision"))) {
          // Falls through to the request.
        } else if(effectRows.length<=1&&(proof.state==="missing"||(proof.state==="conflict"&&proof.reason==="different_final_decision"))) {
          const status=proof.state==="missing"?"missing":envelope.mutation.action.startsWith("ignore")?"accepted":"ignored";
          await settleResolvedElsewhere(row,[{reviewItemId:row.review_item_id,status}],proof.checkedAt,isCurrent);continue;
        }
        else if(proof.state==="conflict") {await attention(proof.reason==="mutation_id_conflict"?"mutation_id_conflict":"resolution_conflict",response.status);continue;}
        else if(proof.state!=="open" && !(proof.state==="unknown"&&proof.retryOriginal)) {await attention("resolution_unknown",response.status);continue;}
      }
      if(!await isCurrent()) {outcome="cancelled";stopped=true;break;}
      const attemptedAt=new Date().toISOString();
      await serialiseReviewMutation(()=>db.runAsync(`update review_mutation_outbox set state='in_flight',resolution_status='delivery_unknown',
        attempt_count=attempt_count+1,last_attempted_at=?,updated_at=? where client_mutation_id=? and account_key=?`,attemptedAt,attemptedAt,row.client_mutation_id,account.account_key));
      const {response,body}=await request(`/api/review/${encodeURIComponent(row.review_item_id)}`,row.request_json);
      if(response.status===401||response.status===403) {if((await activeAccount(db))?.account_key===account.account_key) await markAccountAuthenticationRequired(account.account_key);outcome="authentication_required";stopped=true;break;}
      if(!await isCurrent()) {outcome="cancelled";stopped=true;break;}
      const responseBody=body&&typeof body==="object"&&!Array.isArray(body)?body:null;
      const disposition=reviewSyncDisposition(response.status,typeof responseBody?.code==="string"?responseBody.code:null);
      if(disposition==="acknowledge"&&validReviewAcknowledgement(responseBody,envelope,row.review_item_id)) {
        await acknowledgeReviewMutation(row,responseBody!,response.status,isCurrent);acknowledgedCount++;continue;
      }
      if(disposition==="authentication_required") {await markAccountAuthenticationRequired(account.account_key);outcome="authentication_required";stopped=true;break;}
      if(disposition==="retry"||disposition==="acknowledge") {
        if(response.status===409&&responseBody?.code==="review_item_locked") await serialiseReviewMutation(()=>db.runAsync("update review_mutation_outbox set contention_count=contention_count+1 where client_mutation_id=? and account_key=?",row.client_mutation_id,account.account_key));
        if(reconcile) await attention("resolution_unknown",response.status);
        else {await scheduleRetry(row,response.status,disposition==="acknowledge"?"Invalid acknowledgement. Saved action retained.":safeFailureSummary(response.status,responseBody));if(outcome!=="needs_attention")outcome="server_busy";}
        continue;
      }
      const settlement=reviewResolvedElsewhere(response.status,responseBody,row.review_item_id,effectRows.map(effect=>effect.review_item_id),
        {outing:isOutingMutation(envelope.mutation)});
      if(settlement) {await settleResolvedElsewhere(row,settlement.retired,reviewResponseServerTime(response),isCurrent);continue;}
      await attention(safeFailureSummary(response.status,responseBody),response.status,canonicalOpenEffectIds(responseBody,row.review_item_id));
    } catch(error) {
      if(!await isCurrent() || error instanceof StaleMobileSessionResponseError || (error instanceof Error&&error.name==="AbortError")) {outcome="cancelled";stopped=true;break;}
      if(isMobileTransportFailure(error)) {await scheduleRetry(row,null,"Network request failed. Saved action retained.");outcome="transport_failure";stopped=true;break;}
      if(reconcile) await attention("resolution_unknown");
      else {await scheduleRetry(row,null,error instanceof MobileRequestTimeoutError?error.message:"Server response unavailable. Saved action retained.");if(outcome!=="needs_attention")outcome="server_busy";}
    }
  }
  // A re-check cancelled, signed out (401) or cut off mid-request leaves the row unknown again:
  // retry-eligible on the next pass, never a discardable rejection (I1).
  await restoreInterruptedReconciliation(db, account.account_key);
  if ((await activeAccount(db))?.account_key !== account.account_key) return {acknowledgedCount,waitingCount:0,needsAttentionCount:0,stopped:true,outcome:"cancelled"};
  const diagnostics=await getReviewSyncDiagnostics();
  if(outcome==="complete") outcome=diagnostics.needsAttentionCount>0?"needs_attention":diagnostics.waitingCount>0?"backoff":"complete";
  return {acknowledgedCount,waitingCount:diagnostics.waitingCount,needsAttentionCount:diagnostics.needsAttentionCount,
    stopped,outcome,nextRetryAt:diagnostics.nextRetryAt,...(outcome==="authentication_required"?{reason:"no_session" as const}:{})};
}

async function acknowledgeReviewMutation(row: MutationRow, body: Record<string,unknown>, status: number, isCurrent:()=>Promise<boolean>) {
  const db=await database();const now=new Date().toISOString();
  await serialiseReviewMutation(()=>db.withExclusiveTransactionAsync(async transaction=>{
    if (!await isCurrent()) throw new StaleMobileSessionResponseError();
    // An acknowledged "Save this place" stays until Review data from the server shows its card with a
    // place (or decided): until then the card keeps showing the saved place (Codex r1 on #460).
    await transaction.runAsync(`update review_mutation_outbox set state='acknowledged',local_effect='hidden',resolution_status='verified',
      next_attempt_at=null,last_error=null,last_http_status=?,acknowledged_at=?,updated_at=?,acknowledgement_json=?
      where client_mutation_id=? and account_key=?`,status,now,now,JSON.stringify(body),row.client_mutation_id,row.account_key);
    await transaction.runAsync("update review_mutation_effects set local_effect='hidden' where client_mutation_id=? and account_key=?",row.client_mutation_id,row.account_key);
    await setMetadata(accountMetadataKey(LAST_SUCCESSFUL_SYNC_AT_KEY,row.account_key),now,transaction);
  }));
  // Today is subscribed to the same durable owner. Publish at the committed
  // acknowledgement boundary rather than waiting for the rest of a 25-item
  // delivery drain to settle.
  emitChange();
}

type RetiredReviewSource = { reviewItemId: string; status: "accepted" | "ignored" | "missing" };
const TERMINAL_REVIEW_STATUSES = new Set(["accepted", "ignored", "missing"]);

/**
 * The server answered that the moment is no longer open: decided on another device, superseded by
 * location replay, or gone. That is the moment settling, not a rejection the person can act on
 * (as on web). It applies only when the server proves the primary source accepted, ignored or
 * missing and reports every source's status; sources it reports open are not retired, so only those
 * cards come back. An open or unreported primary (an existing entry that differs, a changed
 * proposal) is a real rejection and keeps its saved action. Returns null for those.
 */
export function reviewResolvedElsewhere(
  status: number,
  body: Record<string, unknown> | null,
  primaryId: string,
  sourceIds: string[],
  /**
   * One card per outing (PRD D19): an outing refused because a part of it changed saved nothing, so
   * it settles whatever its Stay's status: the parts decided elsewhere leave, the open ones come back
   * as cards of their own (as on web), and nothing waits for Retry or Discard.
   */
  options: { outing?: boolean } = {}
): { retired: RetiredReviewSource[] } | null {
  const code = typeof body?.code === "string" ? body.code : null;
  const notFound = status === 404 && code === "review_item_not_found";
  if (!notFound && !(status === 409 && code === "resolution_conflict")) return null;
  const sources = sourceIds.length ? sourceIds : [primaryId];
  const listed = body?.canonicalReviewStatuses;
  const statuses: Record<string, unknown> = listed && typeof listed === "object" && !Array.isArray(listed)
    ? listed as Record<string, unknown>
    : notFound
      ? (sources.length === 1 ? { [primaryId]: "missing" } : {})
      : { [primaryId]: body?.canonicalStatus };
  if (!TERMINAL_REVIEW_STATUSES.has(String(statuses[primaryId])) && !(options.outing && statuses[primaryId] === "open")) return null;
  if (sources.some((id) => statuses[id] !== "open" && !TERMINAL_REVIEW_STATUSES.has(String(statuses[id])))) return null;
  return {
    retired: sources.flatMap((reviewItemId): RetiredReviewSource[] => {
      const canonical = statuses[reviewItemId];
      return canonical === "accepted" || canonical === "ignored" || canonical === "missing"
        ? [{ reviewItemId, status: canonical }]
        : [];
    })
  };
}

/**
 * The server's time for a direct response. HTTP `Date` has whole seconds while snapshot
 * `capturedAt` has milliseconds, so it is rounded up to the end of its second: an open snapshot
 * captured earlier in that second can never clear the settlement.
 */
export function reviewResponseServerTime(response: { headers?: { get(name: string): string | null } }) {
  const parsed = Date.parse(response.headers?.get("date") ?? "");
  return Number.isFinite(parsed) ? new Date(parsed + 999).toISOString() : new Date().toISOString();
}

/** A presentation read of this backend listed the source open after `checkedAt` (replay reopened it). */
async function newerOpenEvidence(
  transaction: SQLite.SQLiteDatabase,
  accountKeyValue: string,
  reviewItemId: string,
  checkedAt: string
) {
  if (!DAYFRAME_BACKEND_ID) return false;
  return Boolean(await transaction.getFirstAsync(
    `select 1 as found from review_source_open_observation
     where account_key = ? and review_item_id = ? and backend_id = ? and observed_at > ?`,
    accountKeyValue, reviewItemId, DAYFRAME_BACKEND_ID, checkedAt
  ));
}

async function settleResolvedElsewhere(
  row: MutationRow,
  retired: RetiredReviewSource[],
  checkedAt: string,
  isCurrent: () => Promise<boolean>
) {
  const db = await database();
  const now = new Date().toISOString();
  await serialiseReviewMutation(() => db.withExclusiveTransactionAsync(async (transaction) => {
    if (!await isCurrent()) throw new StaleMobileSessionResponseError();
    for (const source of retired) {
      // A newer read already shows it open again: that read wins, whatever order they arrived in.
      if (await newerOpenEvidence(transaction, row.account_key, source.reviewItemId, checkedAt)) continue;
      await transaction.runAsync(
        "delete from review_item_cache where account_key = ? and review_item_id = ?",
        row.account_key, source.reviewItemId
      );
      if (!DAYFRAME_BACKEND_ID) continue;
      await compactOpenObservation(transaction, row.account_key, source.reviewItemId, DAYFRAME_BACKEND_ID, checkedAt);
      await transaction.runAsync(
        `insert into review_presentation_terminal_source (
           account_key, review_item_id, scope_key, backend_id, snapshot_token, status, captured_at
         ) values (?, ?, 'settled_elsewhere', ?, ?, ?, ?)
         on conflict(account_key, review_item_id) do update set
           scope_key = excluded.scope_key, backend_id = excluded.backend_id,
           snapshot_token = excluded.snapshot_token, status = excluded.status,
           captured_at = excluded.captured_at
         where excluded.captured_at >= review_presentation_terminal_source.captured_at
           or excluded.backend_id <> review_presentation_terminal_source.backend_id`,
        row.account_key, source.reviewItemId, DAYFRAME_BACKEND_ID, `settled:${row.client_mutation_id}`,
        source.status, checkedAt
      );
    }
    await transaction.runAsync(
      "delete from review_mutation_effects where client_mutation_id = ? and account_key = ?",
      row.client_mutation_id, row.account_key
    );
    await transaction.runAsync(
      "delete from review_mutation_outbox where client_mutation_id = ? and account_key = ?",
      row.client_mutation_id, row.account_key
    );
    const countKey = accountMetadataKey(SETTLED_ELSEWHERE_COUNT_KEY, row.account_key);
    const settled = (Number(await metadata(countKey, transaction)) || 0) + 1;
    await setMetadata(countKey, String(settled), transaction);
    await setMetadata(accountMetadataKey(LAST_SETTLED_ELSEWHERE_AT_KEY, row.account_key), now, transaction);
    await setMetadata(accountMetadataKey(LAST_SUCCESSFUL_SYNC_AT_KEY, row.account_key), now, transaction);
  }));
  emitChange();
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

async function restoreInterruptedReconciliation(db: SQLite.SQLiteDatabase, accountKeyValue: string) {
  await serialiseReviewMutation(() => db.runAsync(
    `update review_mutation_outbox set resolution_status = 'resolution_unknown'
     where account_key = ? and state = 'needs_attention' and resolution_status = 'reconciling'`,
    accountKeyValue
  ));
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
  return reviewSyncDiagnosticsForAccount(db, account);
}

async function reviewSyncDiagnosticsForAccount(
  db: SQLite.SQLiteDatabase,
  account: AccountRow
): Promise<ReviewSyncDiagnostics> {
  const row = await db.getFirstAsync<CountRow>(
    `select
       count(*) filter (where state in ('pending', 'in_flight')) as pending_count,
       count(*) filter (where state = 'retry_wait') as retry_wait_count,
       count(*) filter (where state = 'auth_required') as auth_required_count,
       count(*) filter (where state = 'needs_attention' and not ${unknownOutcomeSql()}) as needs_attention_count,
       count(*) filter (where ${unknownOutcomeSql()}) as checking_count,
       min(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+${REVIEW_UNKNOWN_RECHECK_MS / 1000} seconds')) filter (where ${unknownOutcomeSql()}) as checking_due_at,
       count(*) filter (where state = 'acknowledged') as acknowledged_count,
       min(created_at) filter (
         where state in ('pending', 'in_flight', 'retry_wait', 'auth_required')
       ) as oldest_queued_at,
       min(next_attempt_at) filter (where state = 'retry_wait') as next_retry_at,
       null as last_error
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
  const escalation=await db.getFirstAsync<{due:string|null}>(`select min(case when contention_count>=3 then updated_at
    else strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+10 minutes') end) as due from review_mutation_outbox
    where account_key=? and state='retry_wait' and reconciliation_attempt_count=0`,account.account_key);
  const checkingCount = Number(diagnostics.checking_count) || 0;
  const dueDates=[diagnostics.next_retry_at,escalation?.due,diagnostics.checking_due_at].filter((value):value is string=>Boolean(value)).sort();
  const evidenceCache = await evidenceCacheDiagnosticsForAccount(db, account);
  return {
    pendingCount,
    presentationReads: [...presentationReads.values()]
      .filter(({ owner }) => accountKey(owner) === account.account_key && owner.backendId === DAYFRAME_BACKEND_ID)
      .map(({ diagnostic }) => ({ ...diagnostic })),
    retryWaitCount,
    authenticationRequiredCount,
    needsAttentionCount: Number(diagnostics.needs_attention_count) || 0,
    acknowledgedCount: Number(diagnostics.acknowledged_count) || 0,
    checkingCount,
    settledElsewhereCount: Number(await metadata(accountMetadataKey(SETTLED_ELSEWHERE_COUNT_KEY, account.account_key), db)) || 0,
    lastSettledElsewhereAt: await metadata(accountMetadataKey(LAST_SETTLED_ELSEWHERE_AT_KEY, account.account_key), db),
    waitingCount: pendingCount + retryWaitCount + authenticationRequiredCount + checkingCount,
    oldestQueuedAt: diagnostics.oldest_queued_at,
    lastSuccessfulSyncAt: await metadata(
      accountMetadataKey(
        LAST_SUCCESSFUL_SYNC_AT_KEY,
        account.account_key
      ),
      db
    ),
    nextRetryAt: pendingCount>0?null:dueDates[0]??null,
    lastError: (await db.getFirstAsync<{last_error:string}>("select last_error from review_mutation_outbox where account_key=? and last_error is not null order by updated_at desc,client_mutation_id desc limit 1",account.account_key))?.last_error ?? null,
    lastCachedAt: await metadata(
      accountMetadataKey(LAST_CACHE_AT_KEY, account.account_key),
      db
    ),
    evidenceCacheItemCount: evidenceCache.itemCount,
    evidenceCacheBytes: evidenceCache.totalBytes,
    reviewCacheHitCount,
    reviewCacheEvictedCount,
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
    `select e.review_item_id, o.action_kind,
            case when ${unknownOutcomeSql("o.")} then 'retry_wait' else o.state end as state
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
  return reviewSyncIssuesForAccount(db, account);
}

/**
 * Settings' remembered reads (Codex r4 on #355): this store keeps its own active account, which can
 * differ from the app's active account while accounts reconcile. The diagnostics and rejected
 * issues are read only when the store's active account is `owner`, every query keyed to that one
 * account; otherwise null (nothing to show for `owner` here).
 */
export async function readReviewSyncStateForOwner(owner: { userId: string; workspaceId: string }) {
  return readOwnedReviewState(owner, async (db, account) => ({
    diagnostics: await reviewSyncDiagnosticsForAccount(db, account),
    issues: await reviewSyncIssuesForAccount(db, account)
  }));
}

/**
 * The support export's Review section (Codex r6 on #355): the diagnostics and every saved Review
 * change of `owner` only, under the same rules as `readReviewSyncStateForOwner`; null when the
 * store holds another account (or moved during the read).
 */
export async function readReviewSupportExportForOwner(owner: { userId: string; workspaceId: string }) {
  return readOwnedReviewState(owner, async (db, account) => ({
    diagnostics: await reviewSyncDiagnosticsForAccount(db, account),
    mutations: await reviewSyncDiagnosticMutationsForAccount(db, account)
  }));
}

async function readOwnedReviewState<Result>(
  owner: { userId: string; workspaceId: string },
  read: (db: SQLite.SQLiteDatabase, account: AccountRow) => Promise<Result>
): Promise<Result | null> {
  const db = await database();
  const epoch = processDiagnosticsEpoch;
  const account = await activeAccount(db);
  if (!account || account.account_key !== accountKey(owner)) return null;
  const result = await read(db, account);
  // The store moved to another account during the read (even and back): its in-process counters
  // may no longer be this account's, so nothing is returned.
  if (epoch !== processDiagnosticsEpoch || (await activeAccount(db))?.account_key !== account.account_key) return null;
  return result;
}

async function reviewSyncIssuesForAccount(db: SQLite.SQLiteDatabase, account: AccountRow) {
  return await db.getAllAsync<{
    clientMutationId: string;
    reviewItemId: string;
    action: string;
    createdAt: string;
    lastHttpStatus: number | null;
    lastError: string | null;
    resolutionStatus: string | null;
  }>(
    `select client_mutation_id as "clientMutationId",
            review_item_id as "reviewItemId",
            action_kind as action,
            created_at as "createdAt",
            last_http_status as "lastHttpStatus",
            last_error as "lastError", resolution_status as "resolutionStatus"
     from review_mutation_outbox
     where account_key = ? and state = 'needs_attention' and not ${unknownOutcomeSql()}
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
  return reviewSyncDiagnosticMutationsForAccount(db, account);
}

async function reviewSyncDiagnosticMutationsForAccount(
  db: SQLite.SQLiteDatabase,
  account: AccountRow
): Promise<ReviewSyncDiagnosticMutation[]> {
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
            last_error as "lastError", contention_count as "contentionCount",
            reconciliation_attempt_count as "reconciliationAttemptCount",last_reconciled_at as "lastReconciledAt",resolution_status as "resolutionStatus"
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
          and o.state = 'needs_attention' and not ${unknownOutcomeSql("o.")} and e.local_effect = 'hidden'
      )`, account.account_key, account.account_key, clientMutationId
    );
    const result = await transaction.runAsync(
      `delete from review_mutation_outbox
       where client_mutation_id = ?
         and account_key = ?
         and state = 'needs_attention' and not ${unknownOutcomeSql()}`,
      clientMutationId,
      account.account_key
    );
    removed = result.changes > 0;
  }));
  emitChange();
  return removed;
}

export async function clearActiveReviewAccountData() {
  presentationReads.clear();
  resetProcessReviewDiagnostics();
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
  // Again once cleared: an operation that started before the clear finished never lands.
  presentationReads.clear();
  resetProcessReviewDiagnostics();
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

function withoutOuting(rawPayload: Record<string, unknown>) {
  const { [OUTING_KEY_PAYLOAD_KEY]: _key, [OUTING_ROLE_PAYLOAD_KEY]: _role, ...rest } = rawPayload;
  return rest;
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
    "durationSeconds",
    "qualificationReason",
    "stopCount",
    // Display-only commute mode ("car", "walk"): shown on the card's time line.
    "travelMode",
    // A Move's second line ("Home → Gym"; PRD D19).
    "routeLabel",
    // One card per outing (PRD D19): an opaque outing id and the card's part in it.
    OUTING_KEY_PAYLOAD_KEY,
    OUTING_ROLE_PAYLOAD_KEY
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

/**
 * A decision held behind an earlier unresolved "Save this place" of one of its cards: left out of a
 * sync pass's selection, so blocked decisions never use up its 25 rows (Codex r2 on #460).
 */
function saveBlockedSql(alias: string) {
  // Two indexed probes per row (Codex r3 on #460): the row's own card, then each of its effect cards,
  // each through the partial save index (account, card) where action_kind = 'save_place'.
  const unresolvedSave = (card: string) => `select 1 from review_mutation_outbox s
    where s.account_key = ${alias}.account_key and s.review_item_id = ${card} and s.action_kind = 'save_place'
      and s.state <> 'acknowledged' and s.created_at <= ${alias}.created_at and s.client_mutation_id <> ${alias}.client_mutation_id`;
  return `not (${alias}.action_kind <> 'save_place' and (
    exists (${unresolvedSave(`${alias}.review_item_id`)}) or
    exists (select 1 from review_mutation_effects e
      -- By mutation ID alone (unique, the effects primary key's lead): an account filter here makes the
      -- planner scan the account's effects instead (Codex r4 on #460). The probe below keeps the account.
      where e.client_mutation_id = ${alias}.client_mutation_id
        and exists (${unresolvedSave("e.review_item_id")}))))`;
}

/**
 * Writes a saved place into every cached Review presentation that shows its card, so Today keeps the
 * place once the saved-name overlay ends (Codex r2 on #460).
 */
async function writeSavedPlaceIntoPresentations(
  transaction: SQLite.SQLiteDatabase, accountKeyValue: string, reviewItemId: string, place: SavedPlaceName
) {
  const contexts = await transaction.getAllAsync<{ scope_key: string; context_json: string }>(
    "select scope_key, context_json from review_presentation_context where account_key = ? and context_json like ?",
    accountKeyValue, `%${reviewItemId}%`
  );
  for (const context of contexts) {
    let response: ReviewPresentationSnapshot;
    try { response = ReviewPresentationSnapshotSchema.parse(JSON.parse(context.context_json)); } catch { continue; }
    // The place goes in without the proposal hash it was shown with, which no longer describes the
    // card: Quick Confirm waits for a fresh proposal (Codex r3 on #460).
    const patch = <T extends { kind: string }>(record: T): T => record.kind === "review" && (record as unknown as { reviewItemId: string }).reviewItemId === reviewItemId
      ? { ...record, title: place.name, proposalHash: null,
          place: { id: place.placeId ?? (record as unknown as { place: { id: string | null } }).place.id, label: place.name } }
      : record;
    const next = JSON.stringify({ ...response, records: response.records.map(patch),
      lookup: { ...response.lookup, reviewItems: response.lookup.reviewItems.map(patch) } });
    // Over the display cache's budget, the context goes; the next read fetches it again.
    if (new TextEncoder().encode(next).byteLength > REVIEW_PRESENTATION_DISPLAY_CACHE_MAX_BYTES) {
      await transaction.runAsync("delete from review_presentation_context where account_key = ? and scope_key = ?", accountKeyValue, context.scope_key);
      continue;
    }
    await transaction.runAsync("update review_presentation_context set context_json = ? where account_key = ? and scope_key = ?",
      next, accountKeyValue, context.scope_key);
  }
}

/** Ends acknowledged saves' overlays for cards the server now shows with a place or decided. */
async function retireSavedPlaceOverlays(transaction: SQLite.SQLiteDatabase, accountKeyValue: string, reviewItemIds: readonly string[]) {
  if (!reviewItemIds.length) return;
  let rewrote = false;
  const saved = await pendingSavedPlaceNames(accountKeyValue, transaction);
  for (const id of reviewItemIds) {
    const place = saved.get(id);
    const row = await transaction.getFirstAsync<{ state: string }>(
      "select state from review_mutation_outbox where account_key = ? and review_item_id = ? and action_kind = 'save_place'", accountKeyValue, id);
    if (!place || row?.state !== "acknowledged") continue;
    await writeSavedPlaceIntoPresentations(transaction, accountKeyValue, id, place);
    rewrote = true;
    await transaction.runAsync(
      `delete from review_mutation_outbox where account_key = ? and review_item_id = ?
         and action_kind = 'save_place' and state = 'acknowledged'`, accountKeyValue, id);
  }
  // Rewritten contexts stay within the account's display-cache budget (Codex r4 on #460).
  if (rewrote) await pruneReviewPresentationContexts(transaction, accountKeyValue, "");
}

/**
 * The names of places being saved from a card ("Save this place", PRD D19) that the server has not
 * answered yet: the card shows the place as soon as it is saved on this iPhone. A rejected save
 * shows nothing (its card keeps what the server says).
 */
async function pendingSavedPlaceNames(accountKeyValue: string, db?: SQLite.SQLiteDatabase) {
  const reader = db ?? await database();
  const rows = await reader.getAllAsync<{ review_item_id: string; request_json: string; acknowledgement_json: string | null }>(
    `select review_item_id, request_json, acknowledgement_json from review_mutation_outbox
     where account_key = ? and action_kind = 'save_place' and state <> 'needs_attention'`,
    accountKeyValue
  );
  return new Map(rows.flatMap((row) => {
    const envelope = parseReviewMutationEnvelope(row.request_json);
    if (envelope?.mutation.action !== "save_place") return [];
    const acknowledgement = parseAcknowledgement(row.acknowledgement_json);
    const placeId = typeof acknowledgement?.placeId === "string" ? acknowledgement.placeId : null;
    return [[row.review_item_id, { name: envelope.mutation.name, placeId }] as const];
  }));
}

type SavedPlaceName = { name: string; placeId: string | null };

/** A card being saved as a place shows that place (bootstrap items). */
function withSavedPlace<T extends { id: string; title: string; placeName: string | null; suggestedPlaceId: string | null }>(
  item: T, saved: ReadonlyMap<string, SavedPlaceName>
): T {
  const place = saved.get(item.id);
  return place ? { ...item, title: place.name, placeName: place.name, suggestedPlaceId: place.placeId ?? item.suggestedPlaceId } : item;
}

/**
 * A confirmation saved behind a pending "Save this place" on its card, as the explicit edit of what
 * the person saw: the card's times, and the activity the save gives it (its own when the save names
 * none). Without both times it stays as it was.
 */
function afterSave(envelope: ReviewMutationEnvelope, item: MobileReviewItem, save: ReviewMutation | null): ReviewMutationEnvelope {
  const mutation = envelope.mutation;
  if (mutation.action !== "confirm" && mutation.action !== "accept") return envelope;
  const startedAt = item.suggestedStartedAt ? new Date(item.suggestedStartedAt).toISOString() : null;
  const stoppedAt = item.suggestedStoppedAt ? new Date(item.suggestedStoppedAt).toISOString() : null;
  if (!startedAt || !stoppedAt || Date.parse(stoppedAt) <= Date.parse(startedAt)) return envelope;
  const categoryId = save?.action === "save_place" && save.categoryId !== undefined ? save.categoryId : item.suggestedCategoryId ?? null;
  return ReviewMutationEnvelopeSchema.parse({ clientMutationId: envelope.clientMutationId,
    mutation: { action: "edit_and_confirm", edit: { startedAt, stoppedAt, categoryId } } });
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

/**
 * Review items this account must not show again: hidden by a local decision, or terminal in a
 * newer read (the same suppression the cached bootstrap uses), for that backend.
 */
export async function readSuppressedReviewItemIds(owner: ReviewPresentationOwner) {
  return suppressedReviewItemIds(accountKey(owner), owner.backendId);
}

async function suppressedReviewItemIds(accountKeyValue: string, backendId: string | null) {
  const [hidden, terminal] = await Promise.all([
    hiddenReviewItemIds(accountKeyValue),
    terminalReviewItemIds(accountKeyValue, backendId)
  ]);
  return new Set([...hidden, ...terminal]);
}

async function terminalReviewItemIds(accountKeyValue: string, backendId: string | null) {
  if (!backendId) return new Set<string>();
  const db = await database();
  const rows = await db.getAllAsync<{ review_item_id: string }>(
    `select t.review_item_id
     from review_presentation_terminal_source t
     where t.account_key = ? and t.backend_id = ? and ${terminalInForceSql("t")}`,
    accountKeyValue,
    backendId
  );
  return new Set(rows.map((row) => row.review_item_id));
}

async function latestPresentationBackendId(accountKeyValue: string) {
  const db = await database();
  const row = await db.getFirstAsync<{ backend_id: string }>(
    `select backend_id
     from review_presentation_context
     where account_key = ?
     order by cached_at desc, scope_key desc
     limit 1`,
    accountKeyValue
  );
  // No presentation read cached yet: this build's own backend (where settled sources are recorded).
  return row?.backend_id ?? DAYFRAME_BACKEND_ID ?? null;
}

async function presentationBackendIdForBootstrap(
  accountKeyValue: string,
  bootstrap: MobileBootstrap
) {
  return bootstrap.serverBuild?.backendId ?? await latestPresentationBackendId(accountKeyValue);
}

export function projectReviewBootstrap(
  bootstrap: MobileBootstrap,
  hiddenIds: Set<string>,
  /** Cards with a pending "Save this place": the place they are being saved as (PRD D19). */
  savedPlaceNames: ReadonlyMap<string, SavedPlaceName> = new Map()
) {
  if (hiddenIds.size === 0 && savedPlaceNames.size === 0) return bootstrap;
  const reviewItems = bootstrap.reviewItems.filter((item) => !hiddenIds.has(item.id)).map((item) => withSavedPlace(item, savedPlaceNames));
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

function canonicalJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value));
}

function parseReviewMutationEnvelope(value: string) {
  try {
    const parsed = ReviewMutationEnvelopeSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
