# Mobile Review Offline-First And Location Evidence Cache

Date: 2026-08-20
Branch: `codex/pr1-offline-first-review`
Baseline: `origin/main` at `e849d929a4913186a35fbc898ca1c7b044e674d2`
Contract: `dayframe_pr1_offline_first_review_plan.md`

## Scope and baseline

The baseline already had an account-scoped Review SQLite outbox, idempotent
server receipts, a private Location Evidence API, Location V2 correction
actions, and bounded general mobile request infrastructure. It was still
network-first at Review presentation boundaries: the list waited for bootstrap,
Health reprocess shared the broad load owner, detail waited on network context
and evidence, detail actions bypassed the Review outbox, locally committed cards
remained visible until server acknowledgement, and Review mutation advisory
locks could wait.

The implementation plan matched the fetched baseline. No scope conflict was
found and no new product decision was inferred. The branch does not add a
global offline banner, background execution, map-tile caching, timer/Live
Activity behavior, HealthKit or Location Intelligence algorithms, general
activity-event queue changes, or offline support for complex place/split/merge/
record actions.

## Implementation

### Mobile Review ownership

- Review hydrates the active account's cached projection before starting a
  separately owned bootstrap refresh.
- Health reprocess has its own in-flight owner, timeout, and diagnostics. It may
  gate only Health Review items and requests one silent refresh after canonical
  changes.
- Store notifications reconcile local SQLite projection and diagnostics without
  issuing a bootstrap per state transition.
- Schema v4 changes active pending/in-flight/retry/auth/acknowledged effects to
  hidden. New Confirm, Dismiss, and complete Edit-and-confirm actions disappear
  only after the SQLite transaction commits. Timeout, retry, authentication,
  termination, and stale in-flight recovery retain hidden state.
- Only a permanent result proving the canonical item is still open uses
  `restore`; the sanitised snapshot is inserted once using its stored original
  position and surviving preceding/following anchors.

### Private Location Evidence cache

`dayframe-review-sync.db` now contains a validated presentation DTO cache keyed
by the active account and Review item. This data may contain precise route/sample
coordinates and is therefore sensitive local data. Controls are:

- active workspace/user validation before write and after response;
- `LocationReviewEvidenceDtoSchema` and Review-ID validation on read/write;
- malformed-row deletion;
- expiry at the earlier of server retention or seven days;
- 25-item and 5-MiB UTF-8 LRU bounds;
- pruning after canonical bootstrap, plus TTL/count/byte pruning;
- foreign-key cascade on logout/account switch;
- no bearer/token, request JSON, analytics payload, or duplicate upload journal.

A serial foreground prefetcher begins after the Review list is visible, skips a
fresh cache, shares in-flight network work by account and Review ID, writes one
row at a time, yields between items, stops at the cache cap or first failure,
and cancels on blur/background/owner change. Cancellation before cache ownership
does not write the response. The request creator's abort signal reaches the
actual evidence fetch; cancellation marks that exact request invalid and
synchronously evicts only its identity so immediate reopen creates a
replacement. Deduplicated consumers of the invalid request reject, only the
current valid in-flight identity can begin cache persistence, and ownership
remains observed until every shared consumer settles. Each consumer checks the
request again after the shared cache-write await. If cancellation occurs while
SQLite persistence is open, the transaction discards that exact write when it
can; a post-commit fallback awaits deletion only when account, Review ID,
timestamp, and payload still match. A cancelled fetch therefore cannot return
or remain cached, while cleanup cannot delete a newer replacement.

### Detail and transport behavior

Location Evidence detail renders cached evidence/context immediately and
revalidates evidence and bootstrap independently. Fresh same-item evidence
replaces the presentation in place without a React key remount, preserving the
editor draft. Cached evidence remains usable when revalidation or Apple map
tiles fail; inline copy is sanitized and Back/Try again remain available.

The evidence GET has a 10-second client ceiling. Direct-only location actions
have a 15-second ceiling and keep their draft after failure. Confirm,
Ignore once, and complete Edit-and-confirm instead commit through the Review
outbox, announce local acceptance, start sync without awaiting it, and return to
Review. Complex actions never enqueue a substitute.

### Server bounds

The evidence service resolves the scoped Review/segment first, then runs the
independent accepted-evidence, rejected-evidence, and nearby-place reads in
parallel while preserving DTO ordering and schema validation. Slow requests log
only phase durations/counts/query presence and error class.

Review mutation delivery now performs receipt lookup before lock acquisition,
uses `pg_try_advisory_xact_lock`, sets an 8-second transaction statement timeout
and 1.5-second lock timeout, rechecks the receipt after acquiring ownership, and
returns typed `review_item_locked` contention. Location Review mutation rows are
locked in deterministic Review-ID order, followed by exact stay/commute segment
rows in deterministic order with `NOWAIT`. Logs contain action kind, timing,
lock outcome, receipt replay, and outcome only when slow or operationally
notable; they contain no user content or location payload.

No Postgres index migration is included. The implementation contract requires a
representative staging `EXPLAIN (ANALYZE, BUFFERS)` regression before adding an
index; that evidence is not safely available from source or an empty local
fixture, so query parallelism and instrumentation are the only endpoint changes.

## Motion and accessibility contract

- Trigger: successful local SQLite mutation commit.
- Single list owner: the existing Reanimated Review-card exit and surrounding
  layout transition. No second translation or temporary scale is added.
- Entrance/update/exit: normal cache hydration has no banner/entrance motion;
  local commit exits one stable-ID card; canonical-open conflict restores that
  ID once at stored anchors; retry/auth states do not re-enter it.
- Detail owner: the existing native stack pop occurs after local commit. Failed
  local/direct writes retain the route and draft. Fresh evidence updates local
  state without remount or spatial animation, and a reserved inline status area
  avoids control movement.
- Interruption: per-item/screen guards reject repeated actions; generation and
  abort ownership prevent stale callbacks from navigating a newer route.
- Reduce Motion: existing opacity/immediate layout paths remain the owner; no new
  spatial branch is introduced.
- VoiceOver: local acceptance is announced only after SQLite commit; failure and
  stale evidence use polite/assertive inline regions without false success.

## Validation record

Repository checks and physical/staging results were recorded before the pull
request was opened and updated after review fixes. A passing
source/unit/simulator check is not recorded as physical-iPhone, staging
Supabase, Vercel Preview, or production evidence.

Current results:

- focused mobile Review/API tests: PASS (5 files, 104 tests); the cancellation
  follow-up passed the evidence-cache, API, and network boundary suites at 3
  files and 91 tests, followed by the complete mobile suite at 77 files and 733
  tests;
- focused web Location Evidence/Review mutation tests: PASS (18 tests), followed
  by the complete web suite at 122 passed files, 1 skipped file, 836 passed
  tests, and 1 skipped test;
- `npm run lint`: PASS with two pre-existing unused-parameter warnings in
  `event-service.test.ts`; `npm run typecheck`: PASS; `npm run test`: PASS with
  1,725 passed tests and 1 skipped test; `npm run build`: PASS;
- the unrelated timing-sensitive `categoryPicker.dom.test.tsx` and
  `calendarClickCreate.dom.test.tsx` tests each failed once in separate full
  runs, then passed 6/6 and 9/9 in isolation respectively; each following
  complete repository rerun passed;
- `npm run check:docs`: PASS (117 Markdown files),
  `npm run check:brand-assets`: PASS, and `git diff --check`: PASS;
- Review SQLite v4 validator: PASS; Location V2 SQLite validator: PASS;
- disposable Postgres Review mutation validator: PASS, including advisory-lock
  contention in 5 ms, row-lock contention in 10 ms, and an 8.046-second
  statement-timeout rollback followed by a successful retry;
- disposable Postgres Location V2 validator: PASS, including advisory-lock,
  Review-row, and exact-segment contention in 5 ms, 72 ms, and 13 ms;
- `npx pod-install apps/mobile`: PASS with 114 dependencies and 113 pods and no
  tracked lockfile change; `npx expo install --check`: FAIL because the baseline
  pins TypeScript 5.9.3 while Expo currently recommends `~6.0.3` (no dependency
  was changed in this focused branch);
- unsigned arm64 iOS Simulator build: PASS. Two universal-architecture attempts
  first stopped when the host disk filled; the reduced-footprint build compiled
  and linked Dayframe successfully after the generated CocoaPods sandbox
  manifest was aligned with the unchanged tracked lockfile;
- Vercel Preview/staging Supabase: NOT RUN;
- physical iPhone: NOT RUN.

## Required physical-iPhone evidence before merge

Record `PASS`, `FAIL`, or `NOT RUN` separately for warm/cold Review launch,
cached content under Airplane Mode, slow/stalled bootstrap, Health reprocess
isolation, cached and uncached evidence, map-tile loss, prefetch/tap
deduplication, all three durable actions from list/detail, all direct-only action
failures, background/foreground, force-quit/reopen, retry/reconnect, lost success,
canonical-open and canonical-resolved web conflicts, session expiry and
same-account login, account switch/logout privacy, overlap retention, timers,
Live Activities, HealthKit, Location Intelligence, VoiceOver, Reduce Motion,
large Dynamic Type, and System/Light/Dark.

Measure cached Review presentation (<300 ms target), warm/cold evidence paint,
healthy evidence API p50/p95 (target <1.5 s/<3 s), durable local commit, direct
action completion, and first/second simultaneous mutation outcomes. Do not infer
these timings from unit tests.

## Rollback and limitations

The mobile cache is additive and disposable. Rollback may stop reads/prefetch
and leave schema v4 rows for a later compatible cleanup; do not delete pending
outbox rows during rollback. Server changes can be reverted independently while
the existing idempotent receipt route remains available. There is no new hosted
migration to roll back.

Force-quit still prevents guaranteed background drain. Apple map tiles are not
cached. Evidence is only as current as its validated cached DTO. Complex
location corrections remain direct-only. Full physical-device, Preview, staging
schema, and performance evidence remain merge gates rather than claims made by
this branch.
