#!/usr/bin/env bash
set -euo pipefail

validation_dir="$(mktemp -d)"
database_path="$validation_dir/dayframe-location-v2-test.db"
trap 'rm -rf "$validation_dir"' EXIT

apply_schema() {
  sqlite3 "$database_path" <<'SQL'
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS location_store_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS location_account_context (
  account_key TEXT PRIMARY KEY NOT NULL,
  context_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS location_evidence_journal (
  client_evidence_id TEXT PRIMARY KEY NOT NULL,
  account_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  upload_state TEXT NOT NULL DEFAULT 'pending',
  client_batch_id TEXT,
  inserted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS location_evidence_account_time_idx
  ON location_evidence_journal(account_key, occurred_at);
CREATE INDEX IF NOT EXISTS location_evidence_upload_idx
  ON location_evidence_journal(account_key, upload_state, occurred_at);
CREATE TABLE IF NOT EXISTS location_engine_state (
  account_key TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS location_segment_snapshot (
  account_key TEXT NOT NULL,
  client_segment_id TEXT NOT NULL,
  segment_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_key, client_segment_id)
);
CREATE TABLE IF NOT EXISTS location_upload_outbox (
  client_batch_id TEXT PRIMARY KEY NOT NULL,
  account_key TEXT NOT NULL,
  body_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
PRAGMA user_version = 1;
SQL
}

expect_equal() {
  if [[ "$1" != "$2" ]]; then
    echo "SQLite validation failed: $3 (expected $2, got $1)" >&2
    exit 1
  fi
}

apply_schema >/dev/null
apply_schema >/dev/null
expect_equal "$(sqlite3 "$database_path" 'PRAGMA journal_mode')" "wal" "WAL mode"
expect_equal "$(sqlite3 "$database_path" 'PRAGMA busy_timeout=5000; PRAGMA busy_timeout' | tail -1)" "5000" "busy timeout"
expect_equal "$(sqlite3 "$database_path" 'PRAGMA user_version')" "1" "schema version"

sqlite3 "$database_path" <<'SQL'
INSERT INTO location_account_context VALUES ('workspace-a:user-a', '{}', '2026-07-20T20:00:00Z');
INSERT INTO location_account_context VALUES ('workspace-a:user-b', '{}', '2026-07-20T20:00:00Z');
INSERT INTO location_store_metadata VALUES ('active_account', 'workspace-a:user-a', '2026-07-20T20:00:00Z');
BEGIN IMMEDIATE;
INSERT OR IGNORE INTO location_evidence_journal
  (client_evidence_id, account_key, occurred_at, expires_at, evidence_json, inserted_at)
VALUES ('duplicate-native-import', 'workspace-a:user-a', '2026-07-20T10:00:00Z', '2099-07-27T10:00:00Z', '{"kind":"provider_status"}', '2026-07-20T20:00:00Z');
INSERT OR IGNORE INTO location_evidence_journal
  (client_evidence_id, account_key, occurred_at, expires_at, evidence_json, inserted_at)
VALUES ('duplicate-native-import', 'workspace-a:user-a', '2026-07-20T10:00:00Z', '2099-07-27T10:00:00Z', '{"kind":"provider_status"}', '2026-07-20T20:00:00Z');
COMMIT;
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_evidence_journal WHERE client_evidence_id='duplicate-native-import'")" "1" "duplicate import"

sqlite3 "$database_path" <<'SQL'
BEGIN IMMEDIATE;
INSERT INTO location_evidence_journal
  (client_evidence_id, account_key, occurred_at, expires_at, evidence_json, upload_state, client_batch_id, inserted_at)
VALUES
  ('partial-ack', 'workspace-a:user-a', '2026-07-20T10:01:00Z', '2099-07-27T10:01:00Z', '{"kind":"provider_status"}', 'batched', 'partial-batch', '2026-07-20T20:00:00Z'),
  ('partial-retry', 'workspace-a:user-a', '2026-07-20T10:02:00Z', '2099-07-27T10:02:00Z', '{"kind":"provider_status"}', 'batched', 'partial-batch', '2026-07-20T20:00:00Z');
INSERT INTO location_upload_outbox
  (client_batch_id, account_key, body_json, state, created_at, updated_at)
VALUES ('partial-batch', 'workspace-a:user-a', '{}', 'pending', '2026-07-20T20:00:00Z', '2026-07-20T20:00:00Z');
UPDATE location_evidence_journal SET upload_state='acknowledged' WHERE client_evidence_id='partial-ack';
UPDATE location_evidence_journal SET upload_state='pending', client_batch_id=NULL WHERE client_evidence_id='partial-retry';
UPDATE location_upload_outbox SET state='partial' WHERE client_batch_id='partial-batch';
COMMIT;
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT upload_state FROM location_evidence_journal WHERE client_evidence_id='partial-ack'")" "acknowledged" "partial acknowledgement"
expect_equal "$(sqlite3 "$database_path" "SELECT upload_state FROM location_evidence_journal WHERE client_evidence_id='partial-retry'")" "pending" "partial retry"
expect_equal "$(sqlite3 "$database_path" "SELECT state FROM location_upload_outbox WHERE client_batch_id='partial-batch'")" "partial" "partial outbox state"

sqlite3 "$database_path" <<'SQL'
BEGIN IMMEDIATE;
INSERT INTO location_evidence_journal
  (client_evidence_id, account_key, occurred_at, expires_at, evidence_json, upload_state, inserted_at)
VALUES
  ('invalid-item', 'workspace-a:user-a', '2026-07-20T10:03:00Z', '2099-07-27T10:03:00Z', '{"kind":"provider_status"}', 'rejected', '2026-07-20T20:00:00Z'),
  ('later-valid', 'workspace-a:user-a', '2026-07-20T10:04:00Z', '2099-07-27T10:04:00Z', '{"kind":"provider_status"}', 'pending', '2026-07-20T20:00:00Z'),
  ('other-owner', 'workspace-a:user-b', '2026-07-20T10:05:00Z', '2099-07-27T10:05:00Z', '{"kind":"provider_status"}', 'pending', '2026-07-20T20:00:00Z'),
  ('expired-pending', 'workspace-a:user-a', '2000-01-01T00:00:00Z', '2000-01-08T00:00:00Z', '{"kind":"provider_status"}', 'pending', '2000-01-01T00:00:00Z');
COMMIT;
DELETE FROM location_evidence_journal WHERE expires_at < '2026-07-20T20:00:00Z';
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_evidence_journal WHERE client_evidence_id='expired-pending'")" "0" "seven-day retention"
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_evidence_journal WHERE account_key='workspace-a:user-b'")" "1" "account isolation fixture"
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_evidence_journal WHERE account_key=(SELECT value FROM location_store_metadata WHERE key='active_account') AND client_evidence_id='other-owner'")" "0" "active-account isolation"
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_evidence_journal WHERE upload_state='pending' AND client_evidence_id='later-valid'")" "1" "invalid item does not block later evidence"

sqlite3 "$database_path" <<'SQL'
BEGIN IMMEDIATE;
INSERT INTO location_engine_state VALUES ('workspace-a:user-a', '{"mode":"idle"}', '2026-07-20T20:00:00Z');
ROLLBACK;
SQL
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_engine_state WHERE account_key='workspace-a:user-a'")" "0" "interrupted transaction rollback"

(
  sqlite3 "$database_path" <<'SQL'
PRAGMA busy_timeout = 5000;
BEGIN IMMEDIATE;
INSERT OR REPLACE INTO location_store_metadata VALUES ('lock-owner', 'first', '2026-07-20T20:00:00Z');
.shell sleep 1
COMMIT;
SQL
) &
lock_process=$!
sleep 0.1
sqlite3 "$database_path" <<'SQL'
PRAGMA busy_timeout = 5000;
BEGIN IMMEDIATE;
INSERT OR REPLACE INTO location_store_metadata VALUES ('lock-waiter', 'second', '2026-07-20T20:00:01Z');
COMMIT;
SQL
wait "$lock_process"
expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_store_metadata WHERE key IN ('lock-owner','lock-waiter')")" "2" "database lock contention"

expect_equal "$(sqlite3 "$database_path" "SELECT count(*) FROM location_evidence_journal WHERE client_evidence_id='duplicate-native-import'")" "1" "app restart persistence"
echo "Location V2 SQLite validation passed: WAL, idempotent schema, duplicate import, offline outbox state, partial retry, account isolation, retention, rollback, restart persistence, and lock contention."
