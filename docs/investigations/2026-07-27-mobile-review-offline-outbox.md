# Mobile Review Offline Outbox

Date: 2026-07-27

Branch: `feat/mobile-review-offline-outbox`

Baseline: `ab0a8c9e4492f9bf5e8823ddb52d88103e0d0ff8` (merged PR #123)

## Scope and confirmed starting point

PR #123 made Review removal immediate in React state and protected the
overflow-to-Edit handover, item ordering, concurrent action identity, rollback,
and stale bootstrap response. Its tombstones did not survive process
termination. Confirm/Dismiss still depended on the request completing, while a
generic Edit-and-confirm used two requests: create an entry, then dismiss its
Review item.

This change makes downloaded Review decisions local-first and durable. It does
not make the whole mobile app offline-capable. Timers keep their existing event
queue behavior, and non-terminal location operations remain online.

## Existing capture architecture

Dayframe remains event-first:

- HealthKit sleep/workout capture already writes `activity_events` through the
  mobile event queue.
- Location evidence already uses its protected SQLite journal and upload
  outbox before server-side segment/Review derivation.
- Shortcut, NFC-style, geofence, and manual event inputs retain their existing
  activity-event queue.
- This work begins only after the server has produced a Review item and mobile
  has downloaded it. It persists the user's later terminal Review decision.

The activity-event queue is not used because Review resolution has a different
payload, local card effect, conflict model, server receipt, and account
lifecycle. The location-evidence database is not used because it owns raw
evidence retention/upload, while this store contains no coordinates or evidence
maps.

## Review-store ownership

`apps/mobile/src/lib/reviewSyncStore.ts` owns:

- the active workspace/user account context;
- the safe downloaded Review/category cache;
- the terminal mutation outbox;
- the durable hidden/restore local effect;
- retry/authentication/conflict state;
- one serial SQLite mutation queue and one shared drain promise.

React renders a projection of this owner. It no longer owns authoritative
tombstones.

Expo SQLite database: `dayframe-review-sync.db`

- WAL mode;
- foreign keys on;
- 5-second busy timeout;
- `PRAGMA user_version = 1`;
- exclusive transactions for account, bootstrap, enqueue, and logout changes;
- stale `in_flight` rows reset to `pending` on open.

### SQLite schema

`review_store_metadata`

- active-account pointer;
- account-qualified last-cache and last-successful-sync timestamps.

`review_account_context`

- `account_key`, workspace ID, user ID, display-safe workspace name;
- configured/updated timestamps;
- unique workspace/user identity.

`review_item_cache`

- account and Review item ID;
- sanitised Review snapshot and original server status;
- stable cached position and timestamp.

`review_category_cache`

- minimum category snapshot needed by the offline Edit sheet.

`review_mutation_outbox`

- client mutation ID, account/workspace/user and Review item IDs;
- action and canonical request JSON;
- sanitised original Review snapshot;
- original position plus preceding/following ordering anchors;
- `pending`, `in_flight`, `retry_wait`, `auth_required`,
  `needs_attention`, or `acknowledged`;
- hidden/restore local effect;
- attempt/retry/HTTP/error timestamps and acknowledgement time.

The mutation ID is the primary key. A unique account/item index prevents a
second stored terminal decision. Identical ID/payload enqueue is idempotent;
different data with the same ID and a second decision for the item are rejected.
Valid unsynchronised work has no row-cap eviction.

## Local-first state flow

1. Validate an open Review item and a complete increasing time window.
2. Generate a UUID before the transaction.
3. Strictly parse the shared mutation envelope.
4. Atomically cache the safe item/categories and write the canonical request,
   original snapshot/order, and hidden local effect.
5. Only after SQLite commits, remove the card and update Review count.
6. Announce that the action was saved locally.
7. Attempt the shared drain without awaiting the network in the interaction.
8. Keep the tombstone for retryable failure or authentication loss.
9. Mark success `acknowledged`; delete it only after canonical bootstrap no
   longer reports the item open.
10. On a permanent conflict, restore from the snapshot only when the server
    reports canonical status `open`; otherwise retain a safe sync issue.

A local SQLite failure leaves Confirm/Dismiss visible or the Edit sheet open
with its entered values. Network failure never implies that the local action was
lost.

## Bootstrap and offline cache

Every authenticated bootstrap configures the account, replaces that account's
open-item/category cache, resumes same-account authentication-paused work, and
projects all durable hidden item IDs out of the response. This projection also
updates `stats.reviewCount`; therefore a slow, pull-to-refresh, focus, dashboard,
Health-reprocess, or older cached bootstrap cannot reinsert pending work.

Acknowledged rows remain until a later bootstrap proves the item is absent.
When bootstrap cannot load, Review uses only the active account's cache, applies
the same durable effects, and labels it with the saved time. No cache produces
an explicit offline empty state.

Detailed Location Evidence still calls the server. Offline it explains that
evidence needs a connection and preserves Back navigation; terminal actions
remain available from the cached Review card.

## Supported and unsupported offline actions

Supported:

- generic `accept`;
- generic `ignore_once`;
- location `confirm`;
- location `ignore_once_location`;
- generic or location `edit_and_confirm`, including an explicit null category,
  description, start/end, and current tag names.

Connectivity-dependent and intentionally excluded:

- save/change place;
- split/merge;
- record once;
- map-centre changes;
- raw Location Evidence;
- timer start/stop redesign;
- locally creating a Review item from unsynchronised evidence.

## Synchronisation and retry

Triggers:

- immediately after enqueue;
- Review focus and pull-to-refresh;
- successful login and authenticated bootstrap;
- app foreground while Review is mounted;
- dashboard/Settings bootstrap cadence;
- Settings Retry and Sync now.

The single drain preserves creation order. A network-class failure stops the
current pass to avoid a storm; a permanent failure moves aside so later work
continues.

| Outcome | Local state | Automatic behavior |
| --- | --- | --- |
| 2xx | `acknowledged` | await canonical bootstrap cleanup |
| network, timeout, 408, 429, 5xx | `retry_wait` | bounded exponential retry with 0.8–1.2 jitter |
| temporary Review row lock | `retry_wait` | same bounded retry |
| 401/403 or no token | `auth_required` | preserve and pause until same-account login |
| invalid payload/category/time | `needs_attention` | stop unchanged retries |
| semantic resolution conflict | `needs_attention` | expose safe issue and canonical state |
| legacy overlap response from an older API | `retry_wait` | retry after the intentional-overlap API is available |

Backoff bases are 30 seconds, 2 minutes, 5 minutes, 15 minutes, 30 minutes, and
1 hour, capped at 1 hour before jitter. Manual Retry overrides `retry_wait`
timing. iOS does not guarantee a drain while the app is force-quit; the
guarantee is durable now and automatically retried when Dayframe is active
again.

## Server idempotency and atomic generic edit

Queued calls use the strict shared shape:

```json
{
  "clientMutationId": "uuid",
  "mutation": {
    "action": "accept | ignore_once | confirm | ignore_once_location | edit_and_confirm"
  }
}
```

Legacy non-enveloped callers remain supported by the Review route.

`review_mutation_receipts` stores workspace/user/client-mutation identity,
Review item, action, SHA-256 canonical request hash, canonical result JSON, and
creation time. Its uniqueness boundary is workspace + user + client mutation
ID.

One Postgres transaction:

1. takes a workspace/user/mutation advisory lock;
2. reads a matching receipt;
3. returns its stored result or rejects different content;
4. locks the Review item;
5. applies the generic or location terminal mutation using the same client;
6. inserts the receipt;
7. commits both together.

A generic Edit-and-confirm now validates category/place/time,
creates one confirmed entry, writes tags, resolves the Review item and source
event, and stores the receipt in the same transaction. Any failure rolls back
the entry, tags, resolution, and receipt.

Different mutation IDs for one item converge through `FOR UPDATE NOWAIT`:
temporary contention retries; after the winner commits, the loser must prove an
equivalent final state or become a semantic conflict.

## Conflict semantics

| Queued action | Canonical state | Outcome |
| --- | --- | --- |
| Dismiss | already ignored | equivalent success |
| Confirm | already accepted | equivalent success |
| Edit-and-confirm | accepted entry matches exact category/place/description/time/tags | equivalent success |
| Dismiss | accepted | `resolution_conflict` |
| Confirm | ignored | `resolution_conflict` |
| Edit-and-confirm | accepted with different details | `resolution_conflict` |
| Edit category archived/deleted | open | `invalid_category`, restore cached card |
| Edited time overlaps an entry | accepted | preserve both entries; overlap is intentional |
| Item missing/superseded without provable equivalence | unknown/resolved | needs attention; do not fabricate an open item |
| Receipt ID reused with different content | unchanged | `mutation_id_conflict` |

Canonical server state wins. Discard in Settings removes only a
`needs_attention` local mutation after confirmation; it never offers a casual
clear-pending-queue operation.

## Authentication and account lifecycle

Session expiry clears the unusable token but retains the account cache/outbox
and changes actionable work to `auth_required`. A successful login for that
same workspace/user reactivates it.

Login as a different account deletes the previous active account's Review
SQLite rows before activation, so cached suggestions cannot cross accounts.
Explicit logout first warns with the exact pending/retry/auth/conflict count.
After confirmation it stops useful sync by removing the account context
(cascading cache/outbox), clears projections, and clears the app token.

## Privacy

Stored Review data can include sensitive times and place/category display
names, so every table and query is account-scoped. The cache allow-lists only
presentation metadata required by Review and strips coordinates, address/evidence
maps, raw Health content, token-like fields, and all other raw payload keys.
Bearer tokens are never stored in SQLite.

Settings diagnostics expose counts, time/state, safe action labels, HTTP status,
and truncated opaque IDs. They do not expose descriptions, place names,
coordinates, request JSON, raw HealthKit data, or tokens. Request bodies are not
logged.

## Motion and accessibility contract

Local enqueue:

- Trigger: Confirm, Dismiss, or Save in Edit details.
- Owner: Review screen for the existing Reanimated card exit/reflow;
  `reviewSyncStore` for durable state.
- Update: wait only for the SQLite transaction.
- Success: the card exits and surrounding cards reflow through PR #123's
  existing owner; Edit closes through the deterministic native-modal handover.
- Retryable network outcome: no card rollback.
- Permanent outcome: deliberate restore from an open canonical state or a
  needs-attention status, never a transient flash.
- Interruption: one item/mutation identity ignores repeated taps and stale
  callbacks.
- VoiceOver: announces local save; status uses live-region text and count is
  recomputed.
- Reduce Motion: existing helpers use an immediate/opacity-only state change
  without hiding the update.

Status:

- Trigger/owner: durable diagnostics subscription.
- Entrance/update/exit: the restrained existing notice surface; newer counts
  replace older counts deterministically.
- Failure: waiting becomes needs-attention without restoring a canonically
  resolved item or communicating by color alone.
- Large text can wrap inside the surface; controls retain the existing mobile
  touch target treatment.

## Automated validation

Results recorded on 2026-07-27:

- mobile typecheck: PASS;
- web typecheck: PASS;
- shared tests: PASS, 6 files / 107 tests;
- mobile tests: PASS, 40 files / 293 tests;
- web tests: PASS, 78 files / 475 tests;
- aggregate workspace tests: PASS, 875 tests;
- `validate:review-sync-sqlite`: PASS;
- `validate:review-mutation-db`: PASS against fresh disposable local
  `dayframe_review_outbox_test`;
- `validate:location-v2-sqlite`: PASS;
- `validate:location-v2-db`: PASS against the same disposable database;
- lint: PASS without warnings;
- full workspace typecheck: PASS;
- production web build: PASS;
- brand-asset contract: PASS;
- `git diff --check`: PASS.

SQLite validation covers WAL/foreign keys/busy timeout/version, atomic
enqueue+tombstone, failed-write rollback, uniqueness, stale in-flight recovery,
restart persistence, account isolation, auth-required retention, acknowledged
canonical cleanup, and account-scoped logout.

Postgres validation covers atomic generic edit, tags, receipt/result commit,
lost-response replay, equivalent and conflicting resolution, concurrent
identical and competing mutations, duplicate prevention, mutation-content
conflict, transaction rollback, and user/workspace scoping. The existing
Location V2 validator continues to cover atomic location resolution and
rollback.

## Native and physical-device evidence

- CocoaPods synchronisation: PASS (`npx pod-install`); Expo SQLite 56.0.5 is
  present in both lock and installed manifests. Checksum-only lockfile churn
  from the install was not retained.
- Clean isolated-DerivedData iPhone 17 Pro Max Simulator build: PASS with Xcode
  26.5 and `CODE_SIGNING_ALLOWED=NO`. The first attempt exhausted disk space
  while compiling Metal; after deleting only stale Dayframe DerivedData caches,
  a fresh retry completed with no `exsqlite3_*` link failure.
- Simulator install: PASS. Launch with Metro: PASS through JavaScript bundle
  load and Dayframe UI render.
- Authenticated Review SQLite store exercise in the simulator: NOT RUN. The
  deliberately unsigned build has no keychain entitlement, so Expo SecureStore
  stopped authenticated bootstrap with the expected missing-entitlement alert.
- Signed/ad-hoc physical-device build: NOT RUN.
- Physical-iPhone Airplane Mode/failure/UX matrices: NOT RUN. These must not be
  inferred from unit tests, SQL validators, or screenshots.

PR #123 documented unresolved `exsqlite3_*` simulator symbols. The clean build
above resolves that prior blocker without changing Expo SQLite source or
upgrading Expo.

## Migration and deployment order

## 2026-07-28 production correction

Production inspection proved that
`public.review_mutation_receipts` was absent even though TestFlight contained
the durable envelope client. Every queued mutation therefore failed before it
could create a time entry or receipt. The additive
`202607270001_review_mutation_receipts.sql` migration was applied on
2026-07-28 and verified with an empty receipt table before retry.

The local presentation contract also changes. Enqueue keeps the Review card
visible, disabled, and labelled `Waiting to sync`. Retry and authentication
pause retain that state; permanent failure becomes `Sync issue`. Only server
acknowledgement hides the card and triggers canonical bootstrap reconciliation.
Schema version 2 restores every pre-existing unacknowledged tombstone so the
four affected decisions cannot remain silently absent from Review.

Motion contract:

- enqueue updates badge/status in place; it does not remove or reflow the row;
- acknowledgement lets the existing Reanimated presence/layout owner remove
  and reflow the card;
- retry/authentication/permanent failure keep the row stable;
- repeated actions are disabled while any durable mutation owns that item;
- existing Reduce Motion, Dynamic Type, and VoiceOver behavior remains the
  transition/accessibility owner.

Release evidence: PR #127 merged at `b6132b7`; the production receipt table
exists; Vercel production reached `READY`; TestFlight `0.1.0 (74)` reached
`VALID` and `IN_BETA_TESTING` in `Internal Health Debug`, delivery/build ID
`c729c0f0-97dc-4281-87a1-10a7eab710bd`. The two identified Sunday suggestions
remained open before retry, so build 74 can reconcile the original durable
actions without inventing replacement decisions.

## 2026-07-28 diagnostics export follow-up

PR #129 merged at `64d041f`. The Sync screen already read the dedicated Review
SQLite outbox, but Export diagnostics only serialised the older activity-event
queue. This allowed the screen to report a Review issue while the exported JSON
reported zero queued and failed events.

The export now adds a `reviewSync` section containing the same aggregate counts
as the Sync screen plus safe operational fields for every Review mutation:
action, state, client mutation ID, Review item ID, attempt count, retry and
attempt timestamps, HTTP status, and last error. It deliberately excludes the
canonical request, cached Review snapshot, coordinates, and location evidence.
No retry, conflict, reconciliation, API, or database behaviour changed.

The merged change shipped in TestFlight `0.1.0 (75)`, delivery/build ID
`222760fc-e59c-4b67-a2cb-7d0aab33069b`. App Store Connect reports
`processingState=VALID`, `usesNonExemptEncryption=false`, en-GB notes set,
`Internal Health Debug` all-build access, and
`internalBuildState=IN_BETA_TESTING`. The signed archive uses production API
`https://dayframe-web.vercel.app`.

Files:

- base/local schema: `packages/db/migrations/001_init.sql`;
- hosted additive migration:
  `supabase/migrations/202607270001_review_mutation_receipts.sql`.

Required order:

1. apply the additive database migration;
2. deploy API/web;
3. distribute the compatible mobile/TestFlight build;
4. verify receipt replay, queue drain, conflicts, and diagnostics at runtime.

The existing mobile build keeps using legacy Review payloads and remains
compatible before the receipt migration. The new mobile outbox must not be
released until the migration and API envelope support are live. This branch
does not apply the hosted migration, deploy, merge, modify Vercel variables, or
create a TestFlight build.

## Remaining limitations and approval gate

- No general background execution was added. Force-quit sync waits until the
  user next opens Dayframe.
- Cached Review is the last authenticated snapshot, clearly marked stale.
- Detailed Location Evidence and non-terminal location Review operations still
  require the server.
- Timers remain outside this offline scope.
- Canonical conflicts need the user to inspect/discard a safe issue; mobile
  never overwrites another device's terminal resolution.
- KB must complete the full physical-iPhone Airplane Mode, failure, and UX
  matrices before approval.
