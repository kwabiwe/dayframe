#!/usr/bin/env bash
set -euo pipefail

validation_dir="$(mktemp -d)"
database_path="$validation_dir/dayframe-review-sync-test.db"
trap 'rm -rf "$validation_dir"' EXIT

sqlite3 "$database_path" <<'SQL'
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE review_store_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE review_account_context (
  account_key TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  configured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id)
);
CREATE TABLE review_item_cache (
  account_key TEXT NOT NULL,
  review_item_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  server_status TEXT NOT NULL,
  position INTEGER NOT NULL,
  cached_at TEXT NOT NULL,
  PRIMARY KEY(account_key, review_item_id),
  FOREIGN KEY(account_key) REFERENCES review_account_context(account_key) ON DELETE CASCADE
);
CREATE TABLE review_category_cache (
  account_key TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_json TEXT NOT NULL,
  cached_at TEXT NOT NULL,
  PRIMARY KEY(account_key, category_id),
  FOREIGN KEY(account_key) REFERENCES review_account_context(account_key) ON DELETE CASCADE
);
CREATE TABLE review_mutation_outbox (
  client_mutation_id TEXT PRIMARY KEY NOT NULL,
  account_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  review_item_id TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  request_json TEXT NOT NULL,
  original_snapshot_json TEXT NOT NULL,
  original_position INTEGER NOT NULL,
  preceding_ids_json TEXT NOT NULL,
  following_ids_json TEXT NOT NULL,
  state TEXT NOT NULL,
  local_effect TEXT NOT NULL DEFAULT 'hidden',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempted_at TEXT,
  last_http_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  acknowledged_at TEXT,
  FOREIGN KEY(account_key) REFERENCES review_account_context(account_key) ON DELETE CASCADE,
  CHECK(state IN ('pending', 'in_flight', 'retry_wait', 'auth_required', 'needs_attention', 'acknowledged')),
  CHECK(local_effect IN ('hidden', 'restore'))
);
CREATE UNIQUE INDEX review_mutation_item_active_idx
  ON review_mutation_outbox(account_key, review_item_id);
PRAGMA user_version = 1;
SQL

expect_equal() {
  if [[ "$1" != "$2" ]]; then
    echo "Review SQLite validation failed: $3 (expected $2, got $1)" >&2
    exit 1
  fi
}

expect_equal "$(sqlite3 "$database_path" 'PRAGMA journal_mode')" "wal" "WAL mode"
expect_equal "$(sqlite3 "$database_path" 'PRAGMA foreign_keys=ON; PRAGMA foreign_keys' | tail -1)" "1" "foreign keys"
expect_equal "$(sqlite3 "$database_path" 'PRAGMA busy_timeout=5000; PRAGMA busy_timeout' | tail -1)" "5000" "busy timeout"
expect_equal "$(sqlite3 "$database_path" 'PRAGMA user_version')" "1" "schema version"

sqlite3 "$database_path" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO review_account_context VALUES
  ('workspace-a:user-a', 'workspace-a', 'user-a', 'Personal A', '2026-07-27T10:00:00Z', '2026-07-27T10:00:00Z'),
  ('workspace-a:user-b', 'workspace-a', 'user-b', 'Personal B', '2026-07-27T10:00:00Z', '2026-07-27T10:00:00Z');
INSERT INTO review_store_metadata VALUES
  ('active_account', 'workspace-a:user-a', '2026-07-27T10:00:00Z');
BEGIN IMMEDIATE;
INSERT INTO review_item_cache VALUES
  ('workspace-a:user-a', 'review-1', '{"id":"review-1","status":"open"}', 'open', 0, '2026-07-27T10:00:00Z');
INSERT INTO review_mutation_outbox (
  client_mutation_id, account_key, workspace_id, user_id, review_item_id,
  action_kind, request_json, original_snapshot_json, original_position,
  preceding_ids_json, following_ids_json, state, local_effect, created_at, updated_at
) VALUES (
  'mutation-1', 'workspace-a:user-a', 'workspace-a', 'user-a', 'review-1',
  'accept', '{"clientMutationId":"mutation-1","mutation":{"action":"accept"}}',
  '{"id":"review-1","status":"open"}', 0, '[]', '[]', 'pending', 'hidden',
  '2026-07-27T10:00:00Z', '2026-07-27T10:00:00Z'
);
COMMIT;
SQL

expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_mutation_outbox WHERE state='pending' AND local_effect='hidden'")" "1" "atomic enqueue and tombstone"

set +e
sqlite3 "$database_path" "INSERT INTO review_mutation_outbox SELECT 'mutation-1', account_key, workspace_id, user_id, 'review-2', action_kind, '{}', original_snapshot_json, 1, '[]', '[]', state, local_effect, 0, NULL, NULL, NULL, NULL, created_at, updated_at, NULL FROM review_mutation_outbox WHERE client_mutation_id='mutation-1';" >/dev/null 2>&1
duplicate_id_status=$?
sqlite3 "$database_path" "INSERT INTO review_mutation_outbox SELECT 'mutation-2', account_key, workspace_id, user_id, review_item_id, 'ignore_once', '{}', original_snapshot_json, 0, '[]', '[]', state, local_effect, 0, NULL, NULL, NULL, NULL, created_at, updated_at, NULL FROM review_mutation_outbox WHERE client_mutation_id='mutation-1';" >/dev/null 2>&1
duplicate_item_status=$?
set -e
expect_equal "$duplicate_id_status" "19" "duplicate mutation ID rejection"
expect_equal "$duplicate_item_status" "19" "one active mutation per Review item"

set +e
sqlite3 "$database_path" <<'SQL' >/dev/null 2>&1
.bail on
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
INSERT INTO review_item_cache VALUES
  ('workspace-a:user-a', 'review-local-write-failure', '{"id":"review-local-write-failure","status":"open"}', 'open', 4, '2026-07-27T10:01:00Z');
INSERT INTO review_mutation_outbox (
  client_mutation_id, account_key, workspace_id, user_id, review_item_id,
  action_kind, request_json, original_snapshot_json, original_position,
  preceding_ids_json, following_ids_json, state, local_effect, created_at, updated_at
) VALUES (
  'mutation-local-write-failure', 'workspace-a:user-a', 'workspace-a', 'user-a',
  'review-local-write-failure', 'accept', '{}',
  '{"id":"review-local-write-failure","status":"open"}', 4, '[]', '[]',
  'invalid_state', 'hidden', '2026-07-27T10:01:00Z', '2026-07-27T10:01:00Z'
);
COMMIT;
SQL
failed_transaction_status=$?
set -e
if [[ "$failed_transaction_status" == "0" ]]; then
  echo "Review SQLite validation failed: invalid local transaction unexpectedly committed" >&2
  exit 1
fi
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_item_cache WHERE review_item_id='review-local-write-failure'")" "0" "failed local write rollback leaves no tombstone"

sqlite3 "$database_path" <<'SQL'
UPDATE review_mutation_outbox SET state='in_flight' WHERE client_mutation_id='mutation-1';
UPDATE review_mutation_outbox
SET state='pending', next_attempt_at=NULL
WHERE state='in_flight';
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT state FROM review_mutation_outbox WHERE client_mutation_id='mutation-1'")" "pending" "stale in-flight recovery"

sqlite3 "$database_path" <<'SQL'
BEGIN IMMEDIATE;
INSERT INTO review_item_cache VALUES
  ('workspace-a:user-b', 'review-b', '{"id":"review-b","status":"open"}', 'open', 0, '2026-07-27T10:00:00Z');
INSERT INTO review_mutation_outbox (
  client_mutation_id, account_key, workspace_id, user_id, review_item_id,
  action_kind, request_json, original_snapshot_json, original_position,
  preceding_ids_json, following_ids_json, state, local_effect, created_at, updated_at
) VALUES (
  'mutation-b', 'workspace-a:user-b', 'workspace-a', 'user-b', 'review-b',
  'ignore_once', '{}', '{"id":"review-b","status":"open"}', 0, '[]', '[]',
  'auth_required', 'hidden', '2026-07-27T10:00:00Z', '2026-07-27T10:00:00Z'
);
COMMIT;
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_mutation_outbox WHERE account_key='workspace-a:user-a'")" "1" "account A isolation"
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_mutation_outbox WHERE account_key='workspace-a:user-b'")" "1" "account B isolation"

sqlite3 "$database_path" <<'SQL'
UPDATE review_mutation_outbox
SET state='acknowledged', acknowledged_at='2026-07-27T10:02:00Z'
WHERE client_mutation_id='mutation-1';
DELETE FROM review_item_cache
WHERE account_key='workspace-a:user-a' AND review_item_id='review-1';
DELETE FROM review_mutation_outbox
WHERE client_mutation_id='mutation-1'
  AND state='acknowledged'
  AND NOT EXISTS (
    SELECT 1
    FROM review_item_cache cache
    WHERE cache.account_key=review_mutation_outbox.account_key
      AND cache.review_item_id=review_mutation_outbox.review_item_id
  );
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_mutation_outbox WHERE client_mutation_id='mutation-1'")" "0" "acknowledged canonical cleanup"

sqlite3 "$database_path" <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
DELETE FROM review_account_context WHERE account_key='workspace-a:user-a';
DELETE FROM review_store_metadata WHERE key='active_account';
COMMIT;
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_mutation_outbox WHERE account_key='workspace-a:user-a'")" "0" "active-account logout cleanup"
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM review_mutation_outbox WHERE account_key='workspace-a:user-b'")" "1" "logout preserves other isolated account fixture"

echo "Review SQLite validation passed: WAL, foreign keys, busy timeout, schema version, atomic enqueue, durable tombstone, duplicate rejection, item uniqueness, failed-write rollback, stale in-flight recovery, restart persistence, account isolation, auth-required retention, acknowledged canonical cleanup, and scoped logout cleanup."
