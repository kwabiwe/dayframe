# Database And Hosted Migration Guidelines

Use this when changing schema, RLS, hosted auth, timer/event writes, or migrations.

## Schema Sources

- Local schema history lives in the ordered SQL files under `packages/db/migrations`. `001_init.sql` is the base; later numbered migrations add tags and Live Activity delivery state. The setup script applies every SQL file in filename order.
- Hosted Supabase-only migrations live in `supabase/migrations`.
- Hosted deployments must run all required Supabase migrations before the Vercel code that depends on them is deployed or smoke-tested.

## Hosted Migration Checks

Before declaring hosted auth/timer/event changes ready, verify:

- `activity_events.client_event_id` exists when mobile event idempotency is deployed.
- indexes required by the deployed code exist.
- any new health audit columns exist before HealthKit imports are tested.
- RLS policies still allow expected workspace-member reads/writes.
- `DATABASE_URL` matches the Supabase pooler string that works in Vercel.

## Timer/Event Writes

- Timer start/stop should be transactionally event-first: insert `activity_events`, then create/close `time_entries` when the event is high-confidence.
- Timer writes must scope by both `workspace_id` and `user_id` where active user state matters.
- Entry-scoped Stop updates only its exact active `time_entries.id` and bypasses the coarse per-user advisory timer lock. Keep a transaction-local 2-second row-lock deadline inside a 5-second statement deadline and map bounded contention to retryable `timer_busy`; current-scope Stop, starts/replacements, and Health sleep serialization retain the advisory lock where required.
- Check `client_event_id` receipts before the timer lock and again inside the transaction. The existing unique index remains the final replay/race boundary; do not add a redundant Stop receipt table.
- Category-only and uncategorized entries are valid if approved by product rules; do not reintroduce project requirements in service logic.
- Add regression coverage for start, stop, manual entry, duplicate `clientEventId`, and cross-workspace isolation.
- For lock-strategy changes, retain a gated disposable-database test with two real Postgres connections: one holds the user's advisory lock while the other completes an exact entry-scoped Stop. Verify the hosted `activity_events.client_event_id` unique index before staging smoke tests.
- User-created overlaps require no exclusion constraint or overlap-uniqueness index on `time_entries`. Technical uniqueness belongs to source identifiers such as client event IDs, external Health samples, location segments, and Review mutation receipts.
- `time_entries.user_edited_at` is the protection boundary for automatic Health sleep reconciliation. Every explicit entry update must set it; automatic same-source sleep-window extension may update only rows where it is null and must preserve the stable entry id and metadata.
- `time_entries.place_label` is the bounded one-time location name for a confirmed unknown visit. The database check permits `place_id` or a trimmed 1–120-character `place_label`, never both. Explicit saved-place edits clear `place_label`; ordinary time/category/description/tag edits preserve it. Deploy `supabase/migrations/202608120001_time_entry_place_label.sql` before code that selects or writes this column.
- Deploy `supabase/migrations/202608010001_health_sleep_session_reconciliation.sql` before server code that queries `user_edited_at`. Its historical backfill intentionally protects all previously changed Health sleep rows. It does not merge or delete historical duplicates.
- Reporting coverage must clip intervals to the requested range and use a gaps-and-islands union. Do not infer covered time by subtracting pairwise intersections.

## Session And Personal-Report Reads

- Root layout/page consumers must share one request-scoped optional-session result. Do not create separate `cache()` wrappers or a cross-request user-session cache.
- Optional session resolution may return anonymous state for no cookie or an explicit `401` authentication error only. Database, SQL, configuration and programming errors must propagate to the normal server error path.
- Bound `auth_sessions.last_used_at` writes with an age condition; ordinary page/API polling must not update the row on every read.
- Bound `integration_tokens.last_used_at` writes with the same age-conditioned principle. A scoped high-frequency fingerprint consumer must authenticate and update its usage timestamp periodically without creating one MVCC row write per poll.
- Personal Reports queries must scope `time_entries` by both `workspace_id` and `user_id`, including daily series and workspace-qualified joins. Add a two-user/same-workspace regression whenever report query architecture changes.

## Migration Safety

- Prefer additive migrations for repair work.
- Keep legacy nullable fields until data migration is explicitly approved.
- Do not drop historical data or integration tables without an export/safety decision.

## Review automation storage

SQLite v5 adds account-owned per-source mutation effects and backfills v4 outbox rows transactionally; it removes no queue or compatibility columns. Two-source merge intent must reserve both IDs atomically. Postgres already has the boundary fields, `commute_segments.max_gap_seconds` and Review mutation receipts; changing these policies needs no new Postgres migration. The max-gap column means maximum internal observation gap (ceil to integral seconds), not total commute duration. Verify existing columns, receipt uniqueness and indexes in staging before smoke tests; do not fabricate bounds for old rows. Keep same-source Sleep lookup plus insertion under its existing user lock, and preserve `user_edited_at` protection.
