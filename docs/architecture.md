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
- A reviewed unknown visit may give the derived entry either a workspace saved-place `place_id` or a user-selected one-time `place_label`, never both. Read models expose the resolved `placeName` plus `placeKind`; edits preserve the one-time label unless place selection is explicitly changed.
- Editing or deleting an existing time entry is a mutation of already-derived user data; it does not invent a new capture signal.
- Technical idempotency uses source identifiers such as `client_event_id`, Health sample/session identity, Location segment identity, and Review mutation receipts. User-intended time overlaps remain valid.
- Mobile explicit Stop uses one durable `client_event_id` and the original tap timestamp across direct delivery and replay. Its `timer_stop` event targets one canonical `time_entries.id`; `superseded` is a successful no-op when that exact timer is no longer active.

The primary services are:

- `apps/web/src/lib/event-service.ts` for event processing and manual/timer derivation;
- `apps/web/src/lib/review-mutation-service.ts` for ordinary Review terminal actions;
- `apps/web/src/lib/location/location-ingest-service.ts` and `location-review-service.ts` for Location V2 evidence, retained-evidence replay, and corrections;
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

- `apps/mobile/src/lib/api.ts`: general activity-event queue plus bounded API delivery;
- `apps/mobile/src/lib/timerStopOutbox.ts`: storage-only, account-owned explicit Stop intents that persist independently of the general queue, recover an unusable JSON container before accepting new intent, and become deliverable only after an optimistic timer ID has a durable canonical correlation;
- `apps/mobile/src/lib/reviewSyncStore.ts`: account-scoped downloaded Review state, terminal Review outbox, and a validated private Location Evidence presentation cache capped at seven days, 25 items, and 5 MiB;
- `apps/mobile/src/lib/location/store.ts`: protected Location V2 evidence journal, upload outbox, and bounded server-replay coordinator;
- native App Group/Keychain storage: bounded Live Activity/App Intent hand-off data.

These stores are not interchangeable. Location `confirm`, `ignore_once_location`, and complete `edit_and_confirm` actions use the terminal Review outbox; place creation/change, split, merge, record-once, and one-time POI actions remain connectivity-dependent. iOS does not promise background drain after an explicit force-quit.

Mobile reachability has one process-wide `@react-native-community/netinfo` monitor above navigation. It begins as unknown, treats explicit native state and current Dayframe HTTP responses as transport evidence, refreshes once on foreground, and publishes a monotonic reconnect epoch to existing React domain owners. The passive offline/restored banner is informational: it neither owns sync nor disables offline-capable actions. Reconnect handling preserves the dependency order of ready explicit Stops, the general event queue, Stops awaiting canonical correlation, Review mutations, Location Intelligence replay, and one silent bootstrap. Connectivity state is not persisted, contains no account data, and uses no custom ping endpoint or periodic poll.

React projects pending Stop intents over cached/fetched bootstrap before publishing timer state or reconciling ActivityKit. The running sheet retains sole ownership of its existing coordinated exit; local Stop durability, not HTTP completion, accepts dismissal. Stop delivery captures the authenticated SecureStore generation/token pair and revalidates it immediately before dispatch, so a logout/login boundary retains old-account intent without sending it under the replacement account. Native ActivityKit cleanup receives exact observed IDs, awaits their end operations, and must re-read snapshots until the requested generation has either zero active activities or exactly one running canonical survivor. Remote registration and Stop enablement occur only after that verified convergence.

## Health and location privacy

- HealthKit and precise location are sensitive and must not enter analytics, ordinary logs, screenshots, or committed fixtures.
- Location V2 stores exact evidence in user-owned `location_evidence`; coordinate-free summaries enter `activity_events`.
- The Review SQLite database intentionally caches only the validated Location Evidence presentation DTO for the active account. It stores no bearer token or upload-journal copy, is pruned against canonical open Review IDs, expires at the earlier of server retention or seven days, enforces 25-item/5-MiB LRU bounds, and cascades on logout/account switch. Exact points therefore remain sensitive local data even though the cache is bounded.
- Native Apple nearby/search responses remain transient presentation data. A one-time POI resolution crosses the API boundary as a trimmed name only; no Apple identifier, address, POI coordinate, or raw response is persisted.
- Mobile reprocesses its local journal against current time and calls the private authenticated `/api/location/replay` route after foregrounding or a bounded periodic interval. The route reuses the same owner lock, deterministic engine, semantic cutover, and event-first transaction as evidence ingestion, so the ten-minute finalisation lag does not depend on a later location sample.
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
