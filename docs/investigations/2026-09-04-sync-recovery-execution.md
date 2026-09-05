# Sync recovery execution evidence — 4 September 2026

This investigation separates code correction from recovery of the reported production records. Delivery state belongs in the [feature tracker](../feature-fix-tracker.md). The [architecture](../architecture.md), [database reference](../../.codex/reference/database.md) and [Health pipeline](../../.codex/reference/health-review-pipeline.md) own the durable contracts.

## Identity and evidence boundaries

Read-only inspection pinned `origin/main` and the production API deployment to `d649e2db3a9393d521bd8c127d54504451b65a47` (PR #187). The original checkout contained unrelated iOS staging-identity changes; implementation uses a separate worktree. These changes neither adopt nor revert that work.

The paired iPhone reports production version 0.1.0 build 103 and a separately installed staging version 0.1.0 build 1. App Store Connect confirms build 103 is valid. This does **not** attest its source SHA, embedded API base, runtime, channel, or active JS update. An archived build manifest or diagnostic export exposing those fields remains required. The plan's shared-identity warning and the clean-main configuration differ from the two apps actually installed and the unrelated local work. No app was replaced, signed out, reset or retried for diagnosis.

The production alias served deployment `dpl_2LAfrviiH9J2A38BXUxrpvYrifyE`, created 2026-09-04T00:59:26.793Z. Production and staging connect to separate verified Supabase projects using port 6543 transaction poolers. Both returned PostgreSQL 17.6, statement timeout 2 minutes, and zero lock, idle-in-transaction and transaction timeouts for the inspected application connection role. Those are observed defaults, not historical proof of a particular transaction. Application migration history is unavailable; required columns/indexes were checked separately.

Exact device and owner-scoped database exports are preserved in an ignored, private local QA folder. No production records were copied into staging. The following table records every requested boundary without substituting hypotheses for evidence.

| Boundary | Review mutation | Sleep ending 4 September | Missing commute |
| --- | --- | --- | --- |
| Source identity | Observed: supplied mutation/item IDs and immutable accept envelope retained | Not available: exact HealthKit sample IDs/source/window; existing Health debug export or date-bounded native query required | Not available: reported journey date/window required to select a particular segment |
| Device capture/native journal | Observed: persisted Review SQLite row, attempt count 22 at export | Observed: sleep and automatic import enabled; unscoped anchors/seen IDs present. Historical capture run not available | Observed: retained native journal has 60 signals during 4 September afternoon/evening; visits enabled. Live permission/monitor status not available |
| Owner/local durable work | Observed: Review row and active account ownership agree | Observed: current generic queue empty; legacy checkpoint keys cannot attest historical backend owner. This does not prove source capture | Observed: matching active owner has 17 pending batches; 617 evidence rows since 3 September remain pending |
| Server acknowledgement/receipt | Observed: exact Review receipt absent at read time | Not available: no exact client event/sample identity to seek an acknowledgement | Observed: no server evidence for the inspected owner/device since 3 September; last local upload error is timeout |
| Server canonical effect | Observed: Review open; source is an older Sleep event; no directly linked entry | Observed: no Health Sleep entry overlaps the inspected previous-noon to next-noon window, and no Sleep segments in that window. The adjacent Sleep event is from 3 September, not proof of the missing night | Not available for the named journey: local segments exist but cannot select the reported one without its window; upload failure alone does not prove which semantic outcome it should have |
| Lock/cancellation attribution | Not available: historical SQLSTATE/phase/blocker not retained. A later empty transaction snapshot cannot settle it | Not applicable until a particular capture/event has been identified | Not available: last error is a client timeout, not proof of a particular server blocker |
| Bootstrap membership | Not available: no authenticated raw historical bootstrap captured | Not available for exact source; server interval-overlap read confirms no Health Sleep entry in inspected window | Not available for exact journey |
| Projected visible state | Not available: no physical-device UI recovery performed | Not available: exact source and current selected-day projection not captured | Not available: exact journey and visible projection not captured |
| Final disposition | Outstanding; original intent preserved, no production retry/repair executed | Outstanding; source query/export gap remains | Outstanding; precise journey window and live native diagnostics remain |

The observed old Review Sleep window is distinct from the missing overnight Sleep. Review retries do not prove one lock lasted for the age of the intent. Location replay diagnostics include stale August values; they cannot be attributed to the September journey.

## Server defect-to-test evidence

| Correction | Baseline reproduction | Changed behavior and checks |
| --- | --- | --- |
| F01 truthful contention/cancellation | New mocked boundary tests fail on baseline for fabricated `open` and SQLSTATE 57014 classified as a row lock | Unknown canonical state until read; statement cancellation/timeout remain separate from contention; safe phase/SQLSTATE retained |
| F02 Health unit locking | Real PostgreSQL baseline probe fails NOWAIT against a later candidate while the first SQL effect sleeps | Later candidate remains unlocked; controlled first-item timeout leaves intent open; 24 independent commits and cursor continuation of 5 items pass |
| B1 transaction lifetime | Added real PostgreSQL tests, including version 16 fallback and version 17 protection | Finite acquisition/work/cleanup, decreasing statement budget, abort destroys lease, idle guard terminates abandoned transaction; exact-once release unit coverage |
| B3 receipt and logical Sleep proof | New real baseline test fails second-ID equivalent logical Sleep acceptance | Atomic explicit provenance supports equivalent receipt; later user edits survive receipt replay; accepted status alone is insufficient proof |
| B3 post-failure recovery | New test supplies a concurrently committed receipt only after failed transaction rollback | Fresh bounded read returns exact receipt and performs no second effect |
| F12 compatible acknowledgement contract | New shared contract tests | Accept valid existing success shapes; reject malformed, partial and mismatched acknowledgements. Client adoption belongs to dependent mobile work |

Synthetic PostgreSQL/PostGIS checks cover Review mutation families, owner scoping, duplicate delivery, atomic rollback, Location ingestion/replay, and ordered local setup. Staging migration and read-only pooler cancellation checks passed; observed staging advisory-lock release after cancellation was 144 ms. On PostgreSQL 16, an active server query may outlive socket destruction until its statement guard; the test measures that bound rather than assuming instantaneous cancellation.

## Deployment and remaining gates

Apply `supabase/migrations/202609040001_health_sleep_resolution_link.sql` before deploying this server revision. Clean local setup applies `packages/db/migrations/006_health_sleep_resolution_link.sql` in order. The migration is additive, has no backfill and was applied only to staging during this work. Production migration/deployment/recovery requires explicit approval.

Run the repository checks plus the real database scripts in the [validation matrix](../../.codex/reference/validation-matrix.md). Every implementation PR requires a staging-backed Preview; manually promote the selected Ready deployment to the stable staging alias and record the actual SHA/backend identity. Hosted synthetic mutation smoke tests and relevant physical-iPhone validation remain independent gates. A server-only build does not exercise new mobile recovery, Health journaling, namespace migration or native capture.

Outstanding dependent work: bounded Review escalation/coalescing, full JSON deadlines, independent/manual sync lanes, Location upload override/prefetch diagnostics, durable Health source journal and nondestructive backend ownership migration. Production incident closure additionally requires exact receipt/effect and source-to-visible-state evidence or an explicitly documented source limitation.

## Health ingestion transaction follow-up

Health event ingestion now uses the same bounded transaction for its fast duplicate receipt, normalisation reads, owner lock, event and derived rows. Other timer ingestion retains its existing transaction ownership. A duplicate caused by concurrent delivery is read on a fresh bounded transaction after rollback; the retry retains the original client event ID. The Events route passes its request cancellation and deadline through Health ingestion and returns a retryable 503 for an exhausted operation.

`validate-health-ingest-bounds.ts` passed on isolated PostgreSQL 17/PostGIS: a deliberately slow SQL insert was cancelled within the operation budget, its event and derived row rolled back, another connection acquired the owner row, and same-ID/concurrent retries produced exactly one event/entry per intent. The focused server event/query/route suite passed 105 tests. This is synthetic local evidence; the Vercel author-permission block and required staging/physical validation remain outstanding.

The corresponding bounded-ingest regression fails on the pinned baseline with `Missing expected rejection`: its five-second SQL effect completes despite the supplied sub-second operation deadline. The original fixture is removed in the script finalizer. The updated full web suite passed 874 tests (one existing skip) before the additional Events-route timeout assertion.
