# Dayframe Architecture

This is the canonical description of Dayframe's runtime boundaries and data ownership. Product outcomes belong in `docs/PRD.md`; delivery status belongs in `docs/feature-fix-tracker.md`; feature-specific implementation detail belongs in `.codex/reference/` and dated investigations.

## System shape

```text
iOS capture and manual actions ─┐
Web manual actions ─────────────┼─> Next.js API ─> activity_events
Private integration events ─────┘                     │
                                                      ├─> time_entries
                                                      └─> review_items

Web and iOS bootstrap/read models <──── workspace/user-scoped Postgres queries
```

- `apps/web` owns the Next.js UI, authenticated API routes, event processing, reports, export, and hosted auth adapter.
- `apps/mobile` owns the Expo iOS UI, SecureStore app session, local capture queues, HealthKit and location adapters, and targeted native iOS surfaces.
- `packages/shared` owns cross-platform schemas, event normalization, palette/theme contracts, timer state logic, tags, time intervals, and the deterministic Location V2 engine.
- `packages/db/migrations` is the ordered local Postgres/PostGIS schema history. `packages/db/scripts/setup.ts` applies every SQL migration in filename order, then seed data.
- `supabase/migrations` is the ordered hosted Supabase migration history, including RLS, hosted indexes/functions, tags, location, Review receipts, Health reconciliation, and Live Activity delivery.

## Event-first write model

Every newly captured signal must have an `activity_events` record before it creates a `time_entries` record. This includes web/mobile starts and stops, completed manual entries, HealthKit imports, geofence/location evidence summaries, Shortcuts/App Intents, and private integration ingest.

- Explicit user actions and separately approved high-confidence automation may derive a time entry immediately.
- Ambiguous Health/location/automation signals derive an open `review_items` record.
- Confirming a Review item derives or reuses a time entry from its existing source event.
- Editing or deleting an existing time entry is a mutation of already-derived user data; it does not invent a new capture signal.
- Technical idempotency uses source identifiers such as `client_event_id`, Health sample/session identity, Location segment identity, and Review mutation receipts. User-intended time overlaps remain valid.

The primary services are:

- `apps/web/src/lib/event-service.ts` for event processing and manual/timer derivation;
- `apps/web/src/lib/review-mutation-service.ts` for ordinary Review terminal actions;
- `apps/web/src/lib/location/location-ingest-service.ts` and `location-review-service.ts` for Location V2 evidence and corrections;
- `apps/web/src/app/api/time-entries/**` and `apps/web/src/app/api/events/route.ts` for app-facing writes.

## Authentication and scoping

Dayframe has three server auth modes:

- `dev`: unsafe seeded-user bypass for local development only;
- `local`: database-backed email/password and Dayframe app sessions;
- `provider`: Supabase Auth for identity plus Dayframe app sessions for all app API access.

Web stores the Dayframe token in an HTTP-only `dayframe_session` cookie. iOS stores the same app-session token in SecureStore and sends it as a bearer token. Integration/ingest tokens are separate, hashed server-side, scoped, and must never substitute for a user app session.

Every protected route resolves a `RequestSession` before data access. Personal reads and writes use both `workspace_id` and `user_id` where the record is user-owned; shared catalogue data remains workspace-scoped. Supabase RLS is defense in depth, not a replacement for application scoping.

## Mobile ownership boundaries

React Native owns authentication, bootstrap data, routing, API mutations, offline reconciliation, timer truth, and sheet presentation. Targeted Swift/SwiftUI modules receive serializable presentation data and emit semantic actions; they must not call Dayframe APIs or maintain a second domain store.

Offline storage is intentionally split by responsibility:

- `apps/mobile/src/lib/api.ts`: general activity-event queue and timer fallback;
- `apps/mobile/src/lib/reviewSyncStore.ts`: account-scoped downloaded Review state and terminal Review outbox;
- `apps/mobile/src/lib/location/store.ts`: protected Location V2 evidence journal and upload outbox;
- native App Group/Keychain storage: bounded Live Activity/App Intent hand-off data.

These stores are not interchangeable. Detailed Location actions remain connectivity-dependent, and iOS does not promise background drain after an explicit force-quit.

## Health and location privacy

- HealthKit and precise location are sensitive and must not enter analytics, ordinary logs, screenshots, or committed fixtures.
- Location V2 stores exact evidence in user-owned `location_evidence`; coordinate-free summaries enter `activity_events`.
- Retained exact location evidence is exported and deletable. Production retention is enforced through the protected Vercel cron route.
- Health imports store only the data needed for sleep/workout reconciliation and Review. Debug export remains bounded and local to the user action.
- Full account/workspace deletion and backup-retention semantics are still a product decision; do not imply they are complete.

## Deployed lanes

- Pull-request Vercel Preview: staging Supabase.
- Stable staging: the one selected Ready Preview manually aliased to `https://dayframe-staging.vercel.app`.
- Production: `https://dayframe-web.vercel.app` with production Supabase.
- EAS `preview`: stable staging API.
- EAS `production` and TestFlight: production API.

Preview and production currently share one iOS bundle identity. Installing Preview can replace the installed TestFlight app; the separate staging identity remains an explicit future decision.

## Change checklist

When changing a boundary above:

1. Update this document only if ownership or architecture changes.
2. Update the relevant `.codex/reference/` contract and `docs/feature-fix-tracker.md` delivery state.
3. Add a focused executable regression for the changed boundary.
4. Select commands and hands-on evidence from `.codex/reference/validation-matrix.md`.
5. Run `npm run check:docs` before opening the PR.
