# API Guidelines

Use this when adding or changing API routes, server actions, controllers, services, or backend handlers.

## Mobile Reports summary

`POST /api/reports/summary` resolves an app-read session before reading input.
The strict body supplies ISO start/end (exclusive) and unique ordered contiguous
bucket boundaries covering that exact range. Bound the raw body to 100 KB, buckets
to 366 and elapsed range to 366 days plus one DST rollback hour. Do not accept
client category metadata, workspace IDs or user IDs. One parameterized SQL query
scopes entries to both session workspace and user, includes confirmed/accepted
entries and captures one server instant. Clip every contribution to its bucket,
range and current instant; concurrent activities count independently.

The private/no-store response contains capturedNow, range, summed seconds,
category metadata/totals, bucket category allocations and the minimal current
timer contribution used by the existing mobile projection. Never return raw
history, descriptions, Health/Location payloads or project/client metadata.
Fractional seconds remain unrounded across all aggregates; UI labels alone round.
Test real SQL with synthetic disposable-localhost fixtures and shared-workspace
users, as well as malformed/auth/oversize failures. This does not change web
Reports, ingest, timer mutations or bootstrap caps.

## Review presentation read

`POST /api/review/presentation` is a private, read-only app-session route for
the mobile Today/Review presentation. It accepts only contract version 1 and a
strict `window`, `backlog`, or ID-bounded `lookup` request. Validate the 64 KiB
body before expensive work, IANA zone/local-day boundaries, ordered finite
instants, the 61-day DST-allowance window, page limit (1–200), opaque cursor,
and unique Review/entry UUID lists (at most 100 each). Ingest/integration
tokens do not authorise this route.

Resolve the app-read session before any database access and scope every
Review/event/entry/link query by its workspace **and** user. Return a
whitelisted snapshot token, completeness, exact global/today outstanding
counts, bounded records, explicit persisted source/result links and lookup
statuses. Do not expose raw Health/location/provider payloads, coordinates,
tokens, mutation requests, or fabricated full entry objects. Page reads share
a bounded repeatable-read snapshot; a stale cursor returns typed
`snapshot_changed`, not mixed generations. This route is never a mutation
receipt and does not acquire timer/user advisory locks or Review row locks.

Clients parse records strictly, so a new optional record field is sent only to
clients that list it in the `x-dayframe-review-features` request header
(comma-separated). Older phones send no header and receive exactly the version 1
shape; a new phone talking to an older server simply receives no field. The
`time-away` feature adds `timeAway: { stopCount }` to Location Review records
for time away from a saved place, so cached and backlog items keep their
round-trip labels and never fall back to the Commute category. The `move-route`
feature adds `routeLabel` (a Move's second line, "Home → Gym", PRD D19) to
Location Review records for Moves, so cards beyond the bootstrap's page keep it.

A Review edit may carry `descriptionTyped: true` (PRD D19): current iPhone and web editors start a
Move's name empty and send it with any name the person typed. A Move description without it that
equals a title Dayframe suggested (current or earlier) is treated as an older app's prefill and not
stored; with it, the typed words are stored as they are.

`accept` and Location `confirm` may carry the optional 64-lower-hex
`expectedProposalHash`. New Quick Confirm envelopes (Today offered the shortcut until Blocks parity
moved confirming to Review) require it and the
server checks it under the existing mutation lock immediately before applying
the existing action. A mismatch returns `proposal_changed` with scoped
canonical-open evidence and writes no entry. Historical envelopes without the
field, and receipt-first replay of their original request hashes, remain
compatible.

Location (`sourceKind = location_v2`) confirmation fingerprints track effective
proposal content: Review/event/segment identity, source kind, title, category,
place, start/stop instants, confidence, event source and event type. The shared
server hash helper normalises only Location `semanticRevision` to null in the
hash input, so harmless replay timestamp updates cannot invalidate confirmation.
Presentation and locked mutation validation use the same helper. Revision fields
remain in responses and cache metadata. Generic fingerprints retain their original
version, normalisation and revision participation unchanged.

Previously committed immutable requests still replay their original receipts.
An uncommitted old-format Location hash can fail with `proposal_changed`; the user
must refresh/review the current proposal and make a new explicit decision through
the existing recovery flow. Never rewrite the queued envelope or substitute a new
hash automatically, discard receipts, or infer permission to reconfirm from refresh.

## Request Handling

- Validate all external input.
- Check authentication and authorization before reading or mutating protected data.
- Return consistent error shapes.
- Keep secrets server-side.
- Timer, event, and entry routes must resolve a `RequestSession` before reading or writing workspace data.
- User-facing timer APIs must support category/task-first flows and must not require projects unless the product model explicitly changes.
- Discriminated request modes are closed sets. Unknown `/api/time-entries` modes must return `400`; they must never fall through to timer start or another mutation.
- Query enums such as export `kind` return a structured `400` when unsupported rather than reaching a service default and surfacing a `500`.

## Data Access

- Reuse existing database clients, repositories, models, and transaction helpers.
- `/api/bootstrap` entry windows remain capped at 100 day, 300 week, and 2,000 history rows. Reports uses its separate bounded aggregate read, not overflow metadata or raw-history pagination. Keep entry ordering deterministic with an ID tie-break.
- Prefer parameterized queries or ORM query builders.
- Make ownership checks explicit for user-owned records.
- Use transactions when writing `activity_events` plus derived `time_entries` or `review_items`.
- Scope active timer updates by workspace and user.
- Mobile explicit Stop posts to `/api/events` with its original `occurredAt`, stable `clientEventId`, `rawPayload.stopScope=entry`, and exact canonical `targetEntryId`. The client captures and revalidates the authenticated SecureStore generation/token pair immediately before dispatch; an account switch retains old-account intent without sending it under the replacement bearer. Success, duplicate, and `superseded` acknowledge the durable intent; `timer_busy` is a stable retryable `503`.
- An iOS Shortcut/NFC Stop posts `rawPayload.stopScope=running_at`: it locks every confirmed non-Health block that covers `occurredAt` (`started_at < occurredAt` and running or ending later) and ends the running one and each finished one a timer started whose end no person set, else resolves `superseded`. A block a timer started has a `created_from_event_id` explicit Start event (`timer_start`, `timer_switch`, `quick_action`, `nfc_action`, `shortcut_action`) that the server marked `rawPayload.serverTimerStart=true` when it ran it as a timer (server-owned, stripped from client input, like `serverStopOutcome`); an unmarked older one counts unless it has the manual-entry shape (`manual_app` `timer_start` with no `rawPayload.origin`, which `createManualEntry` writes), which stays protected as ambiguous. Manual entries, Review/Location blocks and blocks with no creating event are never cut by a late Stop or Start (stability audit server-1). The covering blocks are locked in entry-id order, the order every multi-entry lock uses. The same rule picks which covering blocks a late Start ends (the others still bound it) and whether an entry-scoped Stop pulls back a later end. Any Stop that ends a non-Health block gets the server-owned `rawPayload.serverStopOutcome=stopped` (stripped from client input); a Stop that ends a Health sleep or workout entry does not, so it never bounds a late Shortcut Start. A `shortcut`-source or `mobile_app`-source explicit Start (`mobile_app` since PRD D20, 22 Oct 2026) takes the user timer lock, locks the non-Health blocks covering its moment and is bounded by the next block's start and the earliest later `running_at` Stop; once it arrives more than 10 s after `occurredAt`, also by the earliest later Stop with `serverStopOutcome=stopped` and the covering blocks' old ends. With a bound it ends the covering blocks at its start and is inserted completed (`startOutcome: "recorded_completed"`); without one it replaces the running block as usual. A Shortcut Start at the same moment as an existing block inserts nothing (`startOutcome: "superseded"`); an in-app Start always gets a block, and one at exactly the running block's start is refused. `/api/events` answers a Start it can't place (`TimerReplacementWindowError`) with `422 {code: "timer_start_before_running_block"}` and a Stop at or before its block's start (entry-scoped or unscoped) with `422 {code: "timer_stop_before_start"}` (also on `/api/time-entries`), never a generic `500` that the phone would retry forever. An entry-scoped Stop whose block already ended later at an end no person chose (a later Start replaced it, a late Start was placed or bounded, or another device stopped it later) pulls that end back to its own moment; an end a person set, a Health entry, or an earlier end stays. Every person edit records one `audit_log` row (`entity_type = time_entry`, `created_at = user_edited_at`) in the edit's transaction: a `PATCH /api/time-entries/[id]` that changes `stoppedAt` to a different time (compared in Postgres at microsecond precision) records `action = time_entry.end_set` with `metadata.stoppedAt`; any other PATCH or grouped description save records `time_entry.edited`. Only an end still equal to an `end_set` row counts as person-set; a details-only save (title, activity, tags, or unchanged times resent) is not one. A block whose `user_edited_at` no recorded edit explains (no `end_set`/`edited` row at or after it: an edit made before edits were recorded, Codex r4 on #531) keeps its end, and a later details-only save carries that protection forward as an `end_set` row for the current end; no backfill or cutoff date is involved. The Stop locks the block in one statement and reads this provenance in a separate one (fresh snapshot), only when the block already ended later than the Stop, so an edit committed while it waited is never missed. Workspace exports (`workspace_json` as `timeEntryEdits`, `npm run export:workspace` as `time_entry_edits`) carry these rows as entry id, action, `stopped_at` and `created_at` only. An in-app Start at another block's exact start is always refused; a redelivered in-app Start repeats its `startOutcome`. A duplicate Shortcut Start reports `startOutcome` from its block's current state.
- An unchanged web Stop posts one stable-idempotency exact-entry `timer_stop` for the captured timer rather than an unscoped current-timer Stop. A dirty Stop first preserves the existing editable-metadata PATCH boundary, omitting `stoppedAt`, then posts that exact Stop. If a concurrent Start has replaced the captured timer, the exact Stop resolves as `superseded`; neither request may reopen or stop the replacement. Start while running remains the advisory-lock-protected atomic Switch.
- `PATCH /api/time-entries/[id]` accepts optional `expectedDetails` (`categoryId`, `description`, `tagNames`: the values the client's edit was based on, for the fields it sends). After locking the row (`for update`, its own statement) it reads the stored details and tags in a fresh statement (under READ COMMITTED a read inside the locking statement would pair a concurrently updated row with its pre-change tags); if any named field now differs as stored (description trimmed, tags by normalized name), it returns `409` with `code: "time_entry_details_conflict"` and the current block as `entry`, and writes nothing. Absent, the PATCH behaves exactly as before (mobile and older web clients). The web timer sends only the fields its user edited, always with `expectedDetails`. It may also carry optional `expectedUpdatedAt` (ISO date-time with offset): the block's `updatedAt` as the client last had it from the server. Read in its own statement after the lock, a stored `updated_at` that differs at millisecond precision (the precision the API returns) means the block was written since, whatever changed, and returns the same `409` with the current block; `null` or absent is ignored, so the iPhone, which never sends it, is unchanged. No migration: `updated_at` is set by every write. The web timer sends it, as ISO, with every description save and Stop's details write for a block it has a server version of (Codex r3/r4 on #539), so a late save can never land over a newer write from the same tab; saves on page hide and on leaving the shell send only `expectedDetails`, since no page is left to retry them (a save on the tab going hidden is versioned).
- `PATCH /api/time-entries/[id]` and `DELETE` accept an optional `X-Dayframe-Client-Command-Id` header (`TIME_ENTRY_CLIENT_COMMAND_ID_HEADER` in `packages/shared`; 1–128 chars of `[A-Za-z0-9:._-]`, else `400`): the iPhone time-entry outbox sends each command's own `clientCommandId` on every attempt, unchanged across retries; the Edit body is unchanged (stability audit 22 Oct 2026, item 17). A PATCH with it records the id as `metadata.clientCommandId` on the edit's `time_entry.edited`/`end_set` `audit_log` row (merged with `stoppedAt`), in the same transaction. Before applying, right after the row lock (and before `expectedUpdatedAt`/`expectedDetails`), it looks for that id among this person's edit rows for this block: if found the edit already landed and its response was lost, so it returns `200 {ok, id, updatedAt, replayed: true, entry}` with the current block, writes nothing (no audit row, no Live Activity push) and so never reverts a newer edit. If the block is gone and the id is found it returns `200 {replayed: true, entry: null}` instead of `404`; an unrecorded id on a missing block is still `404`. Without the header (web, older iPhone builds) the PATCH is unchanged. `DELETE` ignores the header: a resent Delete already gets `404`, which the outbox treats as delivered. Not covered: an Edit queued offline and first delivered after a newer web edit still overwrites it (last writer wins; owner decision pending). `audit_log` has no index yet; the lookup scans one block's rows under its row lock, and an `(workspace_id, entity_type, entity_id)` index is a separate later migration. No migration.
- `GET /api/timer-state` is the lightweight active-timer fingerprint. It accepts ordinary web-cookie/mobile-bearer app sessions and, only through `x-dayframe-ingest-token`, a separate integration token with `time:read`. It returns `activeEntryId`, `updatedAt`, and `serverNow` with `private, no-store`; it does not enqueue or drain Live Activity delivery. High-frequency reads must not touch integration-token usage on every request.
- Timer/event mutation routes schedule Live Activity desired-state enqueue and APNs drain through the supported post-response boundary plus the existing durable revisioned outbox. APNs latency/failure never changes or delays an already committed timer result. Low-frequency authenticated bootstrap reconciliation and the protected retry cron reconstruct current desired state before draining, so a failed post-response schedule or enqueue cannot strand an empty outbox. Do not move that repair work onto `/api/timer-state` or replace the post-response boundary with a bare unawaited promise.
- Location retained-evidence replay is an authenticated, private/no-store command. It accepts only device/version/rollout acknowledgement metadata, uses server time, returns coordinate-free counts, and must share ingestion's owner lock, semantic cutover, and idempotent event-first transaction.
- A Location Review confirmation has one transaction owner. `change_place_and_confirm` may carry the existing strict `ReviewEntryEdit` payload so saved-place feedback, category, description, start, and stop either commit together or roll back together; clients must not sequence a place correction and a second confirm request.

## Timer Regression Matrix

When changing `/api/time-entries`, `/api/events`, session handling, or mobile sync, cover:

- web start timer
- web stop timer
- mobile start timer
- mobile stop timer
- manual completed entry creation
- active timer bootstrap refresh
- completed entry persistence
- category assignment while running
- queued event sync with `clientEventId` dedupe
- direct/replayed entry-scoped Stop with the same `clientEventId`, bounded contention, stale-target safety, and account/session isolation
- unauthorized request handling

## Review Checklist

- [ ] Input validation covers required fields and edge cases.
- [ ] Unknown discriminators, malformed JSON, and unsupported query enums are client errors with no mutation.
- [ ] Auth checks happen before data access.
- [ ] Errors are useful without leaking sensitive details.
- [ ] Tests cover success, validation failure, unauthorized access, and the timer regression matrix where relevant.

## Durable Location Review

`POST /api/review/:id` accepts every resolving/structural Location action through the strict shared `{ clientMutationId, mutation }` envelope. Reject malformed envelopes rather than falling back to a direct action. Complete `edit_and_confirm` requires both valid timestamps; optional edits on other structural actions preserve the existing server validation. Receipt replay returns exact stored IDs/results. Complex actions share the Location replay owner lock and one transaction for all side effects. On permanent conflict, scoped canonical statuses identify each source independently after rollback; mobile must not infer the adjacent merge item's status from the primary. See `offline-review-mutations.md` for the SQLite/account contract.

A generic (non-Location) `edit_and_confirm` keeps the moment's own provenance: the entry is stored with the review event's source and the item's confidence (falling back to `manual_app`/`high` only when the item has no event) and is marked `user_edited_at`, so a later Health re-import never overwrites the user's changes. An edited `health_sleep_import` finds the night already logged from Health by its suggested (original) window, like `accept` does, and that one entry takes the user's name, activity, times and the item's confidence (its tags are kept unless the edit sends tags) and records the event's sleep resolution link.

## Safe Location request diagnostics

Both Location POST routes return `X-Dayframe-Request-Id` (new server UUID v4) and
`X-Dayframe-Duration-Ms`, including private auth and validation responses. Success
JSON remains compatible with the strict replay schema. Failure JSON retains safe
classification/status and adds allowlisted endpoint, phase, optional service
stage, SQLSTATE, request ID and bounded server duration/retry hint. Unknown or
malformed values are dropped or reduced to fixed classifications. Never echo an
unchecked inbound request ID or return/log SQL details or raw payloads. One
completion log correlates each request; auth rejection is distinct from processing
failure. Transaction acquisition/lock/commit phases take precedence over stale
service stages. Observation failures cannot change committed outcomes. Mobile
reads the already-consumed response once and treats retry hints as diagnostic only.
