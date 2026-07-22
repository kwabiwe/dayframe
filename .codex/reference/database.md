# Database And Hosted Migration Guidelines

Use this when changing schema, RLS, hosted auth, timer/event writes, or migrations.

## Schema Sources

- Local base schema lives in `packages/db/migrations/001_init.sql`.
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
- Category-only and uncategorized entries are valid if approved by product rules; do not reintroduce project requirements in service logic.
- Add regression coverage for start, stop, manual entry, duplicate `clientEventId`, and cross-workspace isolation.

## Session And Personal-Report Reads

- Root layout/page consumers must share one request-scoped optional-session result. Do not create separate `cache()` wrappers or a cross-request user-session cache.
- Optional session resolution may return anonymous state for no cookie or an explicit `401` authentication error only. Database, SQL, configuration and programming errors must propagate to the normal server error path.
- Bound `auth_sessions.last_used_at` writes with an age condition; ordinary page/API polling must not update the row on every read.
- Personal Reports queries must scope `time_entries` by both `workspace_id` and `user_id`, including daily series and workspace-qualified joins. Add a two-user/same-workspace regression whenever report query architecture changes.

## Migration Safety

- Prefer additive migrations for repair work.
- Keep legacy nullable fields until data migration is explicitly approved.
- Do not drop historical data or integration tables without an export/safety decision.
