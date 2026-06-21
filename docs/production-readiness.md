# Dayframe Production Readiness

Dayframe keeps one invariant: signals become `activity_events` first. Only high-confidence or manual signals become `time_entries` automatically; ambiguous signals become `review_items`.

## Auth And Workspace Model

Web API routes resolve a `RequestSession` before reading or writing scoped data. Local development can use the unsafe bypass:

```bash
DAYFRAME_AUTH_MODE=dev
DAYFRAME_DEV_USER_ID=00000000-0000-4000-8000-000000000001
DAYFRAME_DEV_WORKSPACE_ID=00000000-0000-4000-8000-000000000010
```

Dayframe also supports `DAYFRAME_AUTH_MODE=local` for DB-backed email/password auth using `users.password_hash` and `auth_sessions`. Production provider auth is not yet wired. The next production step is to plug `resolveAppSession()` into Supabase Auth, Auth.js, or another provider, then add Postgres RLS policies matching `workspace_members`.

## Ingest Tokens

`POST /api/events` accepts either the current app session or a scoped ingest token for server-to-server/local bridge use.

Accepted token locations:

- App session: `Authorization: Bearer <session-token>` for mobile, or the web `dayframe_session` cookie.
- Ingest token: `x-dayframe-ingest-token: <token>`.

In local auth mode, Bearer tokens are treated as app session tokens only so an invalid mobile session cannot fall through to a bridge token. Persisted ingest tokens use `integration_tokens.token_hash`; store only a hash, not the original secret. DB-backed ingest sessions resolve to the workspace owner for event writes. For local development only, `DAYFRAME_INGEST_TOKEN` can be used without inserting a DB row.

Minimum scope for event posting:

```text
events:write
```

Future Home Assistant bridge payload example:

```json
{
  "source": "ha_button",
  "type": "quick_action",
  "occurredAt": "2026-06-21T15:07:00Z",
  "description": "House / Chores",
  "rawPayload": {
    "origin": "home_assistant",
    "device": "bilresa_dual_button",
    "button": "1",
    "gesture": "multi_press_2",
    "activity": "chores"
  }
}
```

Home Assistant is not wired in this repo yet.

## Toggl Import

The importer uses environment variables and does not store the Toggl API token in plaintext:

```bash
TOGGL_API_TOKEN=... TOGGL_WORKSPACE_ID=... npm run toggl:import -- --dry-run
TOGGL_API_TOKEN=... TOGGL_WORKSPACE_ID=... npm run toggl:import -- --since 2026-06-01T00:00:00Z --until 2026-06-21T23:59:59Z
```

The importer creates `external_entity_refs` for Toggl clients, projects, tags and time entries. Re-running the importer skips already imported time entries by external ID. `import_runs` records completed import summaries.

## Geofencing

Mobile geofencing now queues both `geofence_enter` and `geofence_exit`. iOS monitors are capped to the highest-priority 20 regions, preferring higher priority and smaller radius.

Behavior defaults:

- Specific enter: start/suggest/review based on automation rules.
- Specific exit: stop only when a user-created stop rule exists; otherwise review.
- Broad enter/exit: review-first.
- Home: ambiguous and review-first by default.
- Unknown stays over the threshold create review items.

Expo Go cannot fully exercise background geofencing; use a development build.

## HealthKit Sleep

iOS HealthKit sleep import uses `@kingstinct/react-native-healthkit` behind `apps/mobile/src/lib/health.ts`.

Implemented:

- HealthKit config plugin and iOS entitlement.
- Permission request for `HKCategoryTypeIdentifierSleepAnalysis`.
- Anchored sleep queries with local dedupe.
- Mapping for in-bed, asleep unspecified/core/deep/REM, and awake.
- Event-first queueing as `health_sleep_import`.
- Server-side audit/dedupe into `health_sleep_segments`.

HealthKit requires a native iOS build/device and does not work in plain Expo Go.

## Export And Backup

API exports:

- `/api/export?kind=workspace_json`
- `/api/export?kind=time_entries_csv`
- `/api/export?kind=time_entries_json`
- `/api/export?kind=activity_events_json`
- `/api/export?kind=review_items_json`

Local backup:

```bash
npm run export:workspace -- ./dayframe-backup.json
```

Deletion/privacy groundwork remains: implement safe user/workspace deletion with raw location and health payload hard-deletion before using Dayframe as a sole system of record.

## Remaining Before Replacing Toggl And LifeCycle

- Wire a real auth provider and RLS.
- Add token management UI for creating/revoking integration tokens.
- Add full Toggl import status UI and conflict review.
- Verify HealthKit import on a physical iPhone/native build.
- Add Home Assistant bridge after ingestion contracts are stable.
- Add richer report filtering and larger-data performance checks.
