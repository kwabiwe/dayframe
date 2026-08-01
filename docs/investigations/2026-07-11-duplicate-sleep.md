# Duplicate/Overlapping Sleep Investigation

Date: 2026-07-11; reopened 2026-08-01

## Summary

The original pass had no reproducible production duplicate. On 2026-08-01, screenshots established the failure shape: Dayframe had already logged an incomplete `22:53-04:24` Sleep entry, then Apple Health supplied the extended `22:53-05:51` session. The second event went to Review as an overlap and could become another confirmed entry.

## Root Cause

1. Mobile grouped sleep stages, but `externalSessionId` and the queued `localId` hashed exact session bounds and sample identifiers. A later extension or boundary adjustment therefore had a different technical event id.
2. Server idempotency covered only exact `client_event_id` and external sample/session identifiers. It had no semantic identity rule for revisions of the same night's session.
3. Generic Health overlap handling treated the existing Health-derived Sleep entry as a blocker and created a Review item for the revised event.
4. Review acceptance reused only an exact event-created entry or a narrowly covering row, so accepting an extension could insert a second persisted Sleep entry.
5. Grouping in Today was presentation-only. Reports and logged totals still summed both persisted rows, so duplicate imports inflated sleep totals.
6. The schema had no durable marker separating untouched imported entries from imported entries a user had explicitly edited.

## Existing Guardrails

- Mobile HealthKit sleep imports group stage samples into session events before queueing.
- Queued Health events use `clientEventId` idempotency when syncing through `/api/events`.
- `health_sleep_segments` stores audited sleep samples with a unique `(workspace_id, provider, external_sample_id)` guard when an external sample id is present.
- New high-confidence Health sleep auto-confirming is blocked when it overlaps unrelated existing time.
- Health Review reprocess accepts rows already covered by a created entry or confirmed legacy Health/Sleep entry.
- Legacy fragmented sleep-stage rows are consolidated into one Sleep window when the session is plausible.
- Remaining conflicts stay in Review with a blocking-entry reason instead of writing a second confirmed entry automatically.

## Implemented Resolution

- The existing 90-minute sleep-session gap is now a shared constant and mobile groups stages per normalized Health source. A gap greater than 90 minutes remains split sleep.
- A new logical-session matcher requires the same Health provider/source and at least 80% overlap of the shorter interval. This centralized threshold accepts contained or extended revisions but rejects weak partial overlap.
- New imports take the existing user/workspace advisory lock, lock a single matching untouched Health-derived entry, and update its time window in place to the union. The stable entry id and user metadata are preserved; identical, repeated, reversed-order, and incomplete-after-complete imports cannot add or shrink an entry.
- Explicit entry edits set `time_entries.user_edited_at`. Manual entries, edited imports, cross-source overlaps, weak overlaps, and multiple historical matches remain Review cases.
- Current grouped Review items reconcile through the same path before confirmation can insert a row. Legacy stage-fragment coverage and consolidation remain unchanged.
- The additive hosted migration adds the edit-protection column and reconciliation index. Its conservative backfill protects previously changed Health sleep rows rather than risking an automatic overwrite.

## Residual Risks

- Apple Health may produce different sample ids for the same real-world sleep window; same-source substantial overlap now handles this without relying on sample id stability.
- Manual Sleep entries can intentionally block Health auto-confirm and leave Health rows in Review.
- Historical rows created before this reconciliation path can still contain two already-confirmed entries.
- A changed Health source/device name is intentionally ambiguous and remains in Review even when time windows overlap.

## Cleanup Decision

Do not run a blanket data migration that merges or deletes already-confirmed duplicates. The available screenshots prove the user-visible symptom but do not establish row-level source, edit, category, tag, or event provenance for every historical pair. Open modern Review items can safely reconcile through the new path. Already-confirmed duplicates need a reviewed, user-visible cleanup or a one-time reconciliation based on production row evidence; until then they remain manually deletable and the item stays at `Watch` after release.
