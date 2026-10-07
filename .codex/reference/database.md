# Database And Hosted Migration Guidelines

Use this when changing schema, RLS, hosted auth, timer/event writes, or migrations.

## Schema Sources

- Local schema history lives in the ordered SQL files under `packages/db/migrations`. `001_init.sql` is the base; later numbered migrations add tags and Live Activity delivery state. The setup script applies every SQL file in filename order.
- Hosted Supabase-only migrations live in `supabase/migrations`.
- `integration_tokens` is server-only authentication material: hosted schemas must enable RLS, expose no client policies, and grant no table privileges to `PUBLIC`, `anon`, or `authenticated`.
- Hosted deployments must run all required Supabase migrations before the Vercel code that depends on them is deployed or smoke-tested.

## Hosted Migration Checks

Before declaring hosted auth/timer/event changes ready, verify:

- `activity_events.client_event_id` exists when mobile event idempotency is deployed.
- indexes required by the deployed code exist.
- any new health audit columns exist before HealthKit imports are tested.
- `categories.icon` and `categories.starter_key` (with the partial unique index `categories_workspace_starter_key_idx`) exist before a server that reads activity icons or seeds starter activities is deployed.
- `places.role` (check `home`/`work`, partial unique index `places_workspace_role_idx` on `(workspace_id, role)`) exists before a server that reads place roles is deployed: every place-name read path selects it.
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
- `places.role` moves only through `assignPlaceRoleWith` (`apps/web/src/lib/place-role-service.ts`): one transaction locks the current holder and the target in id order with `FOR NO KEY UPDATE` (so swapping Home and Work from both sides cannot deadlock, and entry/segment key-share locks are not blocked), clears and optionally renames the old holder, then sets the target. A racing move that hits the unique index returns a retryable `409 place_role_conflict`. `apps/web/src/lib/place-role-service.postgres.test.ts` covers this against a disposable database (`DAYFRAME_PLACE_ROLE_TEST_DATABASE_URL`, run in CI).
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

SQLite v5 adds account-owned per-source mutation effects and backfills v4 outbox rows transactionally; v6 adds contention, reconciliation, resolution, and validated-acknowledgement metadata without replacing immutable envelopes or effect anchors. Neither migration removes queued intent or compatibility columns. Two-source merge intent must reserve both IDs atomically. Postgres already has the boundary fields, `commute_segments.max_gap_seconds` and Review mutation receipts; changing these policies needs no new Postgres migration. The max-gap column means maximum internal observation gap (ceil to integral seconds), not total commute duration. Verify existing columns, receipt uniqueness and indexes in staging before smoke tests; do not fabricate bounds for old rows. Keep same-source Sleep lookup plus insertion under its existing user lock, and preserve `user_edited_at` protection.

SQLite v7 is an additive migration inside the existing Review-store exclusive
transaction. It adds owner/backend-bound Review-presentation context and
terminal-source evidence only; it does not rename the database, rewrite queued
request JSON, alter old UUIDs/hashes/anchors, or add a hosted migration. A
context is a bounded, whitelisted display snapshot, not a second canonical
entry store. A capped bootstrap or evicted display context cannot prune an
effect. Retire an acknowledged envelope only after every affected source has
explicit terminal status and every receipt-linked entry is current in the
existing Dashboard cache or explicitly `missing`; prove that transaction and
v4/v5/v6-to-v7 rollback/reopen path against a disposable SQLite database.

## Sync recovery schema and transaction checks

Apply `supabase/migrations/202610050001_location_motion_activity.sql` to staging before the Preview that accepts Motion & Fitness evidence, and to production before that server deploys and before any phone build that sends `motion_activity` (the clean/local migration is `packages/db/migrations/007_location_motion_activity.sql`, folded into `001_init.sql`). It replaces the `location_evidence` kind check under either name (local auto-named, hosted `location_evidence_type_check`) to admit `motion_activity`, and adds `location_evidence_motion_coordinate_free`; no row changes. Server code that accepts motion must not deploy before it: those inserts would fail and retry. The phone uploads motion only in batches of its own, so a server without this change refuses just those batches (the phone marks them rejected and that motion is lost) while location batches continue.

Apply `supabase/migrations/202609040001_health_sleep_resolution_link.sql` to staging before the sync-server Preview. The corresponding clean/local migration is `packages/db/migrations/006_health_sleep_resolution_link.sql`. It adds a nullable, indexed, server-owned Sleep resolution link with delete-to-null behavior; it performs no data repair. Production application requires explicit release approval and this migration before deploying the dependent code.

Run `npx tsx scripts/validate-sync-transactions.ts` with an explicit disposable local `*_test` DATABASE_URL, plus the Review and Location database validation commands. Check both PostgreSQL 16 fallback and the deployed PostgreSQL 17 transaction pooler. Connection destruction and database lock release are separately measured: a disconnected PostgreSQL 16 active query may remain until its statement guard fires. Never use a Promise race as a substitute for releasing/destroying the checked-out client, and never return a connection with uncertain rollback health to the pool.
