# Dayframe Production Readiness

Dayframe keeps one invariant: signals become `activity_events` first. Only high-confidence or manual signals become `time_entries` automatically; ambiguous signals become `review_items`.

## Auth And Workspace Model

Web API routes resolve a `RequestSession` before reading or writing scoped data. Local development can use the unsafe bypass:

```bash
DAYFRAME_AUTH_MODE=dev
DAYFRAME_DEV_USER_ID=00000000-0000-4000-8000-000000000001
DAYFRAME_DEV_WORKSPACE_ID=00000000-0000-4000-8000-000000000010
```

Dayframe also supports `DAYFRAME_AUTH_MODE=local` for DB-backed email/password auth using `users.password_hash` and `auth_sessions`. Production provider auth uses Supabase Auth for identity/password verification and Dayframe app sessions for web/mobile API access. Hosted Supabase RLS policies live in `supabase/migrations/202607020001_dayframe_rls.sql`.

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

## Geofencing

Mobile geofencing now queues both `geofence_enter` and `geofence_exit`. iOS monitors are capped to the highest-priority 20 regions, preferring higher priority and smaller radius.

Behavior defaults:

- Specific enter: start/suggest/review based on automation rules.
- Specific exit: stop only when a user-created stop rule exists; otherwise review.
- Broad enter/exit: review-first.
- Home: ambiguous and review-first by default.
- Unknown stays over the threshold create review items.
- Mobile start, Shortcut, NFC, widget, and Home Assistant button events can use local auto-log defaults to fill blank category/description values while preserving explicit event values.

Expo Go cannot fully exercise background geofencing; use a development build.

## HealthKit Sleep And Workouts

iOS HealthKit sleep and workout imports use `@kingstinct/react-native-healthkit` behind `apps/mobile/src/lib/health.ts`.

Implemented:

- HealthKit config plugin and iOS entitlement.
- Permission requests for `HKCategoryTypeIdentifierSleepAnalysis` and `HKWorkoutTypeIdentifier`.
- Anchored sleep queries with local dedupe.
- Mapping for in-bed, asleep unspecified/core/deep/REM, and awake.
- Event-first queueing as `health_sleep_import` and `health_workout_import`.
- Server-side audit/dedupe into `health_sleep_segments` and `health_workouts`.
- Foreground sync, HealthKit observer callbacks, and native background-delivery wiring for sleep/workout changes.
- Apple Health mapping defaults for category and description, applied to new imports and Health Review reprocess.
- Duplicate/overlapping Sleep guardrails are documented in `docs/investigations/2026-07-11-duplicate-sleep.md`; keep merge/delete logic evidence-led.

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

## Current Internal Beta State

As of 2026-07-11, the active internal TestFlight lane has verified build `0.1.0 (16)` in `Internal Health Debug`. The product is usable for owner testing, but several areas remain `Watch`, `Planned`, or `Future` in `docs/feature-fix-tracker.md`.

## Remaining Before Wider Daily Beta Use

- Keep duplicate/overlapping Sleep on Watch and collect real production row metadata before adding any merge/delete logic.
- Keep offline/mobile queue recovery on Watch while real-device testing confirms foreground queue drains, retry backoff, manual retry, idempotency, and diagnostics export.
- Add safe account deletion, workspace deletion, and stronger privacy controls for raw Health/location payloads and integration tokens.
- Add token management UI before Home Assistant or other local bridge inputs are promoted beyond manual/local setup.
- Add the Home Assistant/Cockpit bridge only after ingestion contracts and token controls are stable.
- Add richer report filtering, larger-data performance checks, backup verification, and restore/import confidence.
- Keep HealthKit background sync and Health mapping defaults at `Watch` until KB validates real-device behavior over normal daily use.
