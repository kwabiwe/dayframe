# Duplicate/Overlapping Sleep Investigation

Date: 2026-07-11

## Summary

KB reports no current duplicate Sleep entries in TestFlight build `0.1.0 (14)`. This pass found no reason to add automatic merge/delete logic without a real duplicate export or production row sample.

## Existing Guardrails

- Mobile HealthKit sleep imports group stage samples into session events before queueing.
- Queued Health events use `clientEventId` idempotency when syncing through `/api/events`.
- `health_sleep_segments` stores audited sleep samples with a unique `(workspace_id, provider, external_sample_id)` guard when an external sample id is present.
- New high-confidence Health sleep auto-confirming is blocked when it overlaps existing time.
- Health Review reprocess first accepts rows already covered by a created entry or confirmed Health/Sleep entry.
- Legacy fragmented sleep-stage rows are consolidated into one Sleep window when the session is plausible.
- Remaining conflicts stay in Review with a blocking-entry reason instead of writing a second confirmed entry.

## Residual Risks

- Apple Health may produce different sample ids for the same real-world sleep window after source/device changes.
- Manual Sleep entries can intentionally block Health auto-confirm and leave Health rows in Review.
- Historical rows created before the current grouping/cleanup path can still need review metadata to explain why they remain.

## Decision

Keep duplicate/overlapping Sleep at `Watch`. If duplicates appear, collect a Health debug export plus the affected time-entry/review rows before adding merge/delete behaviour.
