# API Guidelines

Use this when adding or changing API routes, server actions, controllers, services, or backend handlers.

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
- Prefer parameterized queries or ORM query builders.
- Make ownership checks explicit for user-owned records.
- Use transactions when writing `activity_events` plus derived `time_entries` or `review_items`.
- Scope active timer updates by workspace and user.
- Mobile explicit Stop posts to `/api/events` with its original `occurredAt`, stable `clientEventId`, `rawPayload.stopScope=entry`, and exact canonical `targetEntryId`. The client captures and revalidates the authenticated SecureStore generation/token pair immediately before dispatch; an account switch retains old-account intent without sending it under the replacement bearer. Success, duplicate, and `superseded` acknowledge the durable intent; `timer_busy` is a stable retryable `503`.
- An unchanged web Stop posts one stable-idempotency exact-entry `timer_stop` for the captured timer rather than an unscoped current-timer Stop. A dirty Stop first preserves the existing editable-metadata PATCH boundary, omitting `stoppedAt`, then posts that exact Stop. If a concurrent Start has replaced the captured timer, the exact Stop resolves as `superseded`; neither request may reopen or stop the replacement. Start while running remains the advisory-lock-protected atomic Switch.
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
