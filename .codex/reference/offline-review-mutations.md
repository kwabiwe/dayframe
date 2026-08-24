# Offline Review Mutation Guardrail

Use this reference whenever a mobile Review terminal action must work without a
connection. This pattern is specific to Review decisions; it does not make timer,
Calendar, reporting, or location-evidence operations generally offline-capable.

## Ownership

- `activity_events`, the mobile event queue, and the protected location journal
  remain the owners of signal capture.
- `reviewSyncStore.ts` is the only durable mobile owner of downloaded Review
  snapshots, local terminal decisions, pending presentation, retry state, and account
  lifecycle.
- The server remains authoritative for canonical Review and time-entry state.
- React state may project the SQLite owner but must never be the only record of
  an accepted Review action.

## Local acknowledgement

Generate one UUID, validate the open item and its time window, and atomically
write the canonical request, safe original snapshot, ordering anchors, and a
hidden local projection. Disable repeated actions only while that local
transaction is in flight. After commit, remove the card or close the detail
route immediately through its existing presentation owner; do not wait for the
server. Network success is not part of local acknowledgement. A retryable
network failure leaves the durable row hidden and pending across refresh,
backgrounding, force-quit, and reopen.

One account may have at most one stored terminal mutation per Review item. The
same mutation ID plus the same canonical payload is idempotent; either a reused
ID with different data or a second terminal mutation for the item is rejected.

## Synchronisation

- Use one serial SQLite mutation owner and one in-flight drain promise.
- Reset stale `in_flight` work on database open.
- Preserve created order. Stop a pass after a retryable network failure, but let
  a permanent failure on one item move to `needs_attention` so later items run.
- Retry network errors, 408, 429, 5xx, and temporary lock contention with bounded
  jitter.
- Preserve 401/403 work as `auth_required`; resume only after authentication for
  the same account.
- Mark semantic conflicts and unchanged permanent validation errors
  `needs_attention`; never retry them forever.
- A successful response changes the already-hidden local row to `acknowledged`
  and triggers a canonical refresh. Delete the row only
  after a later canonical bootstrap proves that the Review item is no longer
  open.

## Server contract

Queued calls use the strict shared `{ clientMutationId, mutation }` envelope.
The workspace/user-scoped receipt lookup, Review lock, resulting entry/tags,
Review/event resolution, and receipt insert share one Postgres transaction.
Matching receipt replay returns the stored result. Reuse with different content
is a conflict. An already-resolved item is successful only when equivalence can
be proven.

## Accounts and privacy

Every SQLite and Postgres lookup is scoped by workspace and user. Cache only the
minimum Review/category presentation data. Never cache tokens, coordinates, raw
location evidence, or raw HealthKit payloads, and never expose descriptions or
place names in diagnostics. Session expiry preserves the same account's queue.
Confirmed logout or account change clears that active account's cache and
outbox after warning about unsynchronised work.

## Required evidence

Run the mobile/web/shared suites, both Review validators, both Location V2
validators, full lint/typecheck/test/build/brand/diff checks, and a clean native
build. On a physical iPhone, complete the Airplane Mode, conflict/session, app
restart, theme, Dynamic Type, VoiceOver, and Reduce Motion matrices in
`docs/dayframe-regression-checklist.md`. Never infer force-quit durability or
eventual sync from unit tests or screenshots.
