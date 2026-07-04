# API Guidelines

Use this when adding or changing API routes, server actions, controllers, services, or backend handlers.

## Request Handling

- Validate all external input.
- Check authentication and authorization before reading or mutating protected data.
- Return consistent error shapes.
- Keep secrets server-side.
- Timer, event, and entry routes must resolve a `RequestSession` before reading or writing workspace data.
- User-facing timer APIs must support category/task-first flows and must not require projects unless the product model explicitly changes.

## Data Access

- Reuse existing database clients, repositories, models, and transaction helpers.
- Prefer parameterized queries or ORM query builders.
- Make ownership checks explicit for user-owned records.
- Use transactions when writing `activity_events` plus derived `time_entries` or `review_items`.
- Scope active timer updates by workspace and user.

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
- unauthorized request handling

## Review Checklist

- [ ] Input validation covers required fields and edge cases.
- [ ] Auth checks happen before data access.
- [ ] Errors are useful without leaking sensitive details.
- [ ] Tests cover success, validation failure, unauthorized access, and the timer regression matrix where relevant.
