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

Web stores the Dayframe token in an HTTP-only `dayframe_session` cookie. iOS stores the same app-session token in SecureStore and sends it as a bearer token. Integration/ingest tokens are separate, hashed server-side, scoped, and must never substitute for a user app session. The shared lightweight `/api/timer-state` read accepts app sessions and an explicitly opted-in `x-dayframe-ingest-token` with `time:read`; its query stays workspace/user scoped, side-effect free apart from rate-limited token-use bookkeeping, and never waits for APNs.

Every protected route resolves a `RequestSession` before data access. Personal reads and writes use both `workspace_id` and `user_id` where the record is user-owned; shared catalogue data remains workspace-scoped. Supabase RLS is defense in depth, not a replacement for application scoping.

## Mobile ownership boundaries

React Native owns authentication, bootstrap data, routing, API mutations, offline reconciliation, timer truth, and sheet presentation. Targeted Swift/SwiftUI modules receive serializable presentation data and emit semantic actions; they must not call Dayframe APIs or maintain a second domain store.

Offline storage is intentionally split by responsibility:

- `apps/mobile/src/lib/api.ts`: general activity-event queue plus bounded API delivery;
- `apps/mobile/src/lib/healthSyncStore.ts`: backend/workspace/user-owned Health source journal. One SQLite transaction preserves query additions, tombstones, episode revisions and their recoverable event payloads before advancing the checkpoint, including historical changes returned by the anchor. The captured identity and immutable IDs survive general-queue handoff; queue selection, delivery and canonical acknowledgement enforce that identity. A transactional journal upgrade re-hands off queued work with unchanged IDs/payloads, and an untagged queue record is adopted only on exact journal payload/identity proof. Existing unscoped legacy checkpoints are preserved and never adopted into a new query contract;
- `apps/mobile/src/lib/timerStopOutbox.ts`: storage-only, account-owned explicit Stop intents that persist independently of the general queue, recover an unusable JSON container before accepting new intent, and become deliverable only after an optimistic timer ID has a durable canonical correlation;
- `apps/mobile/src/lib/timeEntryOutbox.ts`: account-owned offline Edit/Delete commands with bounded direct delivery, optimistic-ID dependencies, permanent/retryable classification, and a durable delivery hold for the existing Delete Undo window;
- `apps/mobile/src/lib/reviewSyncStore.ts`: account-scoped downloaded Review state, resolving/structural Review outbox, and a validated private Location Evidence presentation cache capped at seven days, 25 items, and 5 MiB;
- `apps/mobile/src/lib/location/store.ts`: protected Location V2 evidence journal, upload outbox, and bounded server-replay coordinator;
- native App Group/Keychain storage: bounded Live Activity/App Intent hand-off data.

These stores are not interchangeable. All resolving/structural Location actions use the Review outbox, including confirm/ignore, complete edit, change-place-and-confirm, record-once, one-time POI, save-place-and-confirm, split and merge variants. SQLite v5 atomically reserves one or both source IDs with account-owned snapshots and anchors; UI dismissal follows commit only. The direct pure `change_place` endpoint remains compatibility-only. Receipts commit with every Postgres side effect; ambiguous cross-device equivalence is a conflict. See `.codex/reference/offline-review-mutations.md`. Already-started durable timer Start/Switch/Stop/Edit/Delete work may share one native finite UIKit background assertion while it is actively transmitting. Native code owns exact-once identifier cleanup; expiry/logout/account replacement/cancellation/teardown release it while durable work stays queued. Review, Location Intelligence, and bootstrap remain foreground-owned. iOS promises neither connectivity nor background drain after expiry or explicit force-quit.

Mobile reachability has one process-wide `@react-native-community/netinfo` monitor above navigation. It begins unknown, uses a 300 ms native-offline confirmation, treats any current HTTP response as strong online evidence, and treats repeated transport failures or request deadlines within a bounded window as negative evidence while intentional cancellation stays neutral. Raw NetInfo deduplication still reprocesses unchanged native evidence when its candidate disagrees with an HTTP-forced committed state, so unchanged online evidence may repair Offline through the normal debounce without accepting stale-generation HTTP results. One root presentation owner subscribes to the account-owned durable-work and active-delivery snapshots and owns the expiry clock plus VoiceOver announcements. The shared Dayframe header on each primary tab consumes that state in one fixed 44-point icon slot immediately after the wordmark, so the header never shifts when the icon changes or disappears. Confirmed offline uses a neutral cloud-slash and supersedes the other one-slot states. Ordinary online queued work and retry backoff stay visually silent; only a live reconnect/recovery delivery attempt shows rotating neutral circular arrows. A pending-count transition from non-zero to zero uses a neutral cloud-check for about two seconds. Permanent timer Stop or time-entry Edit/Delete rejection is excluded from the retryable pending count and exposes a persistent neutral cloud-X action to Settings > Sync & diagnostics whenever offline is not the current state.

Authoritative timer/event mutations commit before any Live Activity/APNs work. Route handlers schedule the existing revisioned durable outbox through Next.js post-response execution; enqueue/delivery failure is observable and retryable but cannot change the committed timer response. Low-frequency authenticated bootstrap reconciliation and the protected retry cron reconstruct current desired state before draining, repairing a missing outbox row if post-response scheduling or enqueue failed; the lightweight timer fingerprint stays APNs-free. Start while running remains one event-first transaction under the workspace/user advisory lock and is the atomic Switch operation. An unchanged web Stop sends one stable-idempotency exact-entry event for the captured timer. A dirty Stop first PATCHes its editable metadata without `stoppedAt`, then sends that exact Stop; a concurrent replacement can make the Stop `superseded` but neither the PATCH nor Stop can reopen/stop the replacement. Browser reconciliation and push work run outside the authoritative mutation gate, and request generations prevent older refreshes from replacing newer intent.

One authenticated account/workspace coordinator wakes when durable work is created, connectivity becomes online, the app foregrounds, or jittered exponential retry becomes due. It pauses offline, supersedes obsolete retry timers on a newer reconnect epoch, and shares every in-flight drain. Reconnect order is: ready exact Stops; native Shortcut plus explicit timer events (`timer_start`, `timer_stop`, `timer_switch`, `quick_action`, `nfc_action`, and `shortcut_action`); offline time-entry Edit/Delete commands; Stops awaiting canonical Start correlation; remaining non-timer events; Review mutations; Location native drain/upload/replay; one silent bootstrap. Only the timer phases may finish under an already-acquired finite UIKit assertion. Health and Location evidence remain durable for the foreground-only phase; their authoritative `occurredAt` values and completed-entry-only Health semantics prevent older evidence from replacing a newer explicit timer; eligible Health overlaps may coexist. Returned retryable outcomes schedule another pass without a network toggle. A scheduled retry is not a new work epoch: its bounded exponential attempt continues increasing while the same durable work remains, and resets only after work clears or a genuine reconnect/new-work epoch arrives. Permanent commands remain outside the global pending count for targeted diagnostics. Account replacement invalidates old work without sending it under the replacement session.

`projectDurableLocalWork(serverBootstrap, durableCommands, correlations)` is the single Dashboard merge rule. It deterministically layers unresolved retryable queued Starts, dependent and persisted Edit/Delete commands, explicit Stops and local-to-canonical correlations over cached or fetched server truth. Permanently rejected Stops and Edit/Delete commands do not project: direct Stop rejection rolls back safely before canonical refresh, and later loads retain server truth. Normal load, pull-to-refresh, reconnect bootstrap and cold restoration all use the same rule; a correlated Start renders once, and a wholly offline Start → Edit → Stop restores as one completed entry. The durable Dashboard cache remains the last server snapshot, so local truth is reconstructed from its owners rather than written into competing snapshots. Reachability remains informational and never replaces or disables a durable owner.

React projects pending Stop intents over cached/fetched bootstrap before publishing timer state or reconciling ActivityKit. The running sheet retains sole ownership of its existing coordinated exit; local Stop durability, not HTTP completion, accepts dismissal. Stop delivery captures the authenticated SecureStore generation/token pair and revalidates it immediately before dispatch, so a logout/login boundary retains old-account intent without sending it under the replacement account. Native ActivityKit cleanup receives exact observed IDs, awaits their end operations, and must re-read snapshots until the requested generation has either zero active activities or exactly one running canonical survivor. Remote registration and Stop enablement occur only after that verified convergence.

## Health and location privacy

- HealthKit and precise location are sensitive and must not enter analytics, ordinary logs, screenshots, or committed fixtures.
- Location V2 stores exact evidence in user-owned `location_evidence`; coordinate-free summaries enter `activity_events`.
- The Review SQLite database intentionally caches only the validated Location Evidence presentation DTO for the active account. It stores no bearer token or upload-journal copy, is pruned against canonical open Review IDs, expires at the earlier of server retention or seven days, enforces 25-item/5-MiB LRU bounds, and cascades on logout/account switch. Exact points therefore remain sensitive local data even though the cache is bounded.
- Durable save-place intent necessarily retains the chosen bounded name/coordinate/radius and edits in the account-owned SQLite request until acknowledgement/conflict resolution. This is private intent, not a raw provider response, and must never appear in diagnostics.
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
