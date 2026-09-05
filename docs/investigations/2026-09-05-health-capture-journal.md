# Health capture journal implementation

This branch implements the durable source boundary required by the September 4 execution plan. It does not establish the cause or final outcome of the missing September 4 sleep. Exact HealthKit sample evidence and the installed build's source/API/update attestation remain unavailable. No production repairs are authorised.

## Verified baseline

At `d649e2db3a9393d521bd8c127d54504451b65a47`, a behavioural import test returns an early sleep phase, then a later phase under a new anchor. The second emitted event contains only `late`, whereas the required complete episode contains `early` and `late`. The failure log is in the ignored private QA directory.

Installed `@kingstinct/react-native-healthkit` exposes `queryCategorySamplesWithAnchor` and `queryWorkoutSamplesWithAnchor`, positive `limit`, `filter.date`, `newAnchor`, and `deletedSamples[].uuid`. Native `sampleAnchoredQueryAsync` executes `HKAnchoredObjectQuery` and returns one promise; it exposes no cancellation handle. Late results must be ignored before journal commit when their captured owner or operation is no longer current. Observer delivery registration must remain independent of server processing.

## Durable handoff contract

A backend/workspace/user-owned SQLite transaction stores each query's additions, tombstones, query contract, anchor, episode revisions and pending event payloads. A stable SHA-256 identity binds an event ID to one immutable payload. Outbox enqueue then marks journal handoff; a crash between those stores repeats the same ID. Server acknowledgement is a separate durable record with event ID, processing disposition and Review/entry references. Existing global anchors and queued mutation IDs remain untouched.

Keep the existing per-source 90-minute grouping, server logical Sleep matching, user-edit protection and union-of-windows policy. Reconstruct from retained episode members, not one delta. Normal delta and explicit seven-day repair queries have separate persisted contracts and anchors; a fourteen-day repair is an explicit extension. A capped page is incomplete evidence and must continue from its own anchor.

## Source corrections and retention

Deletion records a tombstone. It must never silently shrink or remove recorded time, replace an already queued payload, or reuse an event ID for a changed payload. A deletion affecting an existing delivered episode creates an explicit unresolved source-correction record. The user may review the original entry or choose to retain the recorded time; the journal must not claim that source disappearance itself resolved the server record. New automatically delivered revisions remain conservative while that source correction is unresolved.

Retain only normalised sample fields needed for episode regeneration and provenance, not arbitrary native metadata. Acknowledged raw sample/event payloads expire after fourteen days; compact acknowledgement/episode/tombstone provenance expires after ninety days when no pending correction or handoff depends on it. Unacknowledged intent stays recoverable. Hard local capacity limits apply backpressure to capture before checkpoint advancement, rather than deleting pending work to make space. Export the retention/capacity state explicitly.

Environment-isolation deployment is a prerequisite: a new backend namespace alone cannot attest an old unscoped token. Unknown legacy state must remain isolated by the dedicated environment migration.

## Current implementation evidence and remaining work

The full mobile suite passed 959 tests; the subsequent focused capture/journal/API suites passed 136 tests, including two acknowledgement-write/legacy-disposition regressions. The mobile typecheck passed. Real SQLite tests cover atomic checkpoint rollback, cross-delta complete revisions, interrupted handoff with identical IDs, backend isolation, deletion preservation, restartable repair windows, canonical acknowledgement identity, retention protection and explicit keep-recorded-time decisions. Native query callers settle on deadline/cancellation without accepting late results. Type-specific observers mark a running capture dirty and coalesce a subsequent pass; sleep and workouts capture independently of server reprocess.

Source-decision guards now preserve prior ignores and known entry identity, and avoid recreating an unavailable prior resolution. Remaining release gates are native rebuild, staging Preview and hands-on device validation, plus proven environment/session provenance before an in-place environment replacement. Additional UI/diagnostics and the wider environment migration are deferred under the scope freeze. The current backend identity helper is only a journal namespace and does not prove an old global session belongs to that backend. The observed source/import defect is not an attestation of the historical missing night.

## Scope freeze (September 5)

The user requested a reviewable conclusion for the major fixes already implemented. Additional repair Settings UI, export enhancements and cross-cutting native/session migration are deferred. No additional Location redesign is included. The retained journal namespace isolates backend/workspace/user checkpoints, but cannot attest legacy unscoped credentials or queues; the broader environment work remains a separate, unfinished local branch and a release blocker for in-place environment replacement. Existing explicit repair functions and correction records are not exposed as a new user flow in this PR.

## Final automated checks

Full suites: mobile 962 passed; web 869 passed and one database integration test skipped; shared 220 passed. All workspace typechecks, web production build, lint (two existing test warnings), documentation alignment and diff whitespace checks pass. The source-decision PostgreSQL script passes on the disposable PostGIS database; its baseline counterpart created a duplicate entry and failed. Added handoff concurrency, disabled repair-type completion and bounded observer-caller checks pass.

CocoaPods installs 117 dependencies/116 pods including Expo Crypto 56.0.5. A fresh unsigned arm64 Release iOS Simulator build passes with the staging API and preview channel. This is compile evidence only: no app was installed, no phone state changed, and physical HealthKit/motion/visibility checks were not performed. The base-schema and ordered additive provenance migration are repeated from prerequisite PR #188 so this branch has a reviewable clean setup; there is no additional migration or backfill.
