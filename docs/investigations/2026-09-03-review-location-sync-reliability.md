# Review and Location sync reliability — 2026-09-03

## Evidence and joined failure chain

- The exported general event queue was empty, while Review SQLite contained one permanent mutation: `split` for Review item `0f3a4a59-b8d4-4443-ac2a-6d3bf71b2770`, rejected after 14 attempts with `HTTP 422 · invalid_action`.
- Production recorded authenticated `POST /api/location/evidence` as HTTP 500 with a PostgreSQL-shaped error. Location ingest and Health sleep reconciliation share the account advisory-lock namespace; an interactive Health reprocess can retain that transaction lock across its batch.
- Review controls remained disabled beyond the 45-second client deadline. The screen stored `running` in React state but guarded settlement by a navigation generation, so focus/transition ownership could reject the completion that was responsible for clearing the state.
- The header rendered any non-zero durable pending count as visible sync, even when no request was active. A retrying Location batch therefore made ordinary background persistence look like endless foreground work.

## Implementation plan

1. Validate location actions against the source segment kind before the SQLite commit. Split, merge and place-only corrections are stay-only; commute corrections cannot enter the durable outbox.
2. During canonical Review bootstrap, identify the narrow legacy signature already proven impossible by the server—an open commute with a `split`/`split_and_confirm` mutation in permanent 422 `invalid_action`—and remove only that mutation. Keep the canonical open cached item so controls recover without deleting user data.
3. Give each Health reprocess attempt its own run identity and settle its diagnostics independently of screen focus generations. Keep Review actions enabled during background reprocess; durable mutations may wait/retry if the server row is briefly locked.
4. Bound Location ingest/replay lock and statement waits. Return `503 location_processing_busy` for lock/statement contention so the existing mobile retry policy preserves the batch without presenting a generic permanent failure. Log only safe database error metadata, never coordinates or payloads.
5. Keep ordinary online queues and retry backoff invisible in the shared header. Show arrows only during active reconnect/recovery transmission, retain the brief successful transition, Offline, and actionable permanent attention.
6. Cover action compatibility, legacy repair, lifecycle presentation, background-header silence and retryable Location contention with focused tests; then run broad repository validation and iOS build checks where feasible.

## Motion contract

- Trigger: active reconnect/recovery transmission or its durable non-zero-to-zero completion.
- Owner: the existing root connectivity presentation owner.
- Entrance/update/exit: active transmission shows the established rotating arrows; background wait exits to the reserved empty slot; completion uses the existing two-second cloud-check and then empties.
- Surrounding layout: the fixed 44-point slot remains reserved, so no header content moves.
- Interruption: Offline and permanent attention keep their existing priority; another active attempt replaces empty state deterministically.
- Async outcome: queue/backoff remains durable and visible in Sync & diagnostics without persistent header chrome.
- Accessibility: VoiceOver announces active sync/completion only; Reduce Motion keeps the active arrows static.

## Closure criteria

- Production-like Location contention is a retryable 503, never a generic 500, and later retry acknowledges the preserved batch.
- A commute cannot enqueue split/merge/place-only actions; the known legacy rejected split self-repairs after canonical bootstrap.
- Health reprocess timeout/focus changes cannot leave Review actions disabled.
- Waiting/backoff alone never shows the header sync icon; active reconnect and completion still do.
- Focused tests, full lint/typecheck/test/build/docs checks, CI, staging smoke and physical-iPhone verification are recorded honestly.
