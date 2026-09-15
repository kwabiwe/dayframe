# Location Reliability V1 implementation evidence

## Scope and identity

Planning and actual fresh-main base: `a83bfc976f03b14ffc48712681707ecdc27b2601`.
Fetched 14 September 2026; no intervening changes. Isolated branch:
`codex/location-reliability`. Final head is the commit containing this report;
the draft PR/handoff records its exact SHA without a self-referential commit hash.
The supplied [plan](../plans/location-reliability-v1.md) preserves all content;
its original Markdown double-space hard breaks use equivalent backslash syntax
to satisfy the staged whitespace check.
Sections 0–11 govern this implementation; later jobs are not authorised here.

Documentation impact: Location reliability, safe diagnostics/API observation and
validation. Canonical architecture/API/Location references and regression checks
are updated. Product rules in PRD are unchanged. No migration, native module,
queue, retry coordinator, rollout/cutover/retention/permission/threshold/timeout,
Health, timer or Review mutation change. Section 0 overrides older release/native
validation guidance for this session. No Claude/delegated review was invoked.

## Incident evidence and limits

Owner-supplied evidence described 860 retained observations (605 standard, 102
significant-change, 93 Visit and 60 provider-status), 555 acknowledged observations
and seven pending batches containing 305 observations. Local engine snapshots had
48 commute and 68 stay records; these are not canonical/user-visible journey counts.
There were no saved or accepted learned places. The historical phone and server
had different source revisions. Historical 503 bodies, request durations and DB
phases were unavailable. These are supplied historical observations, not new hosted
inspection or proof of a root cause.

Two plausible server causes were excessive round trips consuming the deadline,
and acquisition/lock/statement contention. Synthetic experiments distinguish those
mechanisms, but do not establish which caused the owner's incident. Missing retained
observations between approximately 05:40 and the approximately 06:35 return departure
remain **CAPTURE GAP — FOLLOW-UP REQUIRED**. No native signal/transfer/expiry cause
was established; upload optimisation cannot recover or invent that return journey.

## Implementation

- Routes generate independent UUID v4 correlation headers and safe server duration;
  one completion log per request distinguishes auth from processing failure.
  Closed parsers discard unknown keys/values and preserve actual transaction phase.
  Acquisition/lock/commit failures cannot inherit a misleading service substage.
  Successful replay JSON remains strict-compatible. Observation errors are contained.
- Existing mobile request/SQLite owners retain one backend/account-bound result per
  endpoint plus last success, with separate server and client elapsed time. Auth,
  cancellation and stale-session guards precede persistence; reads/share recheck
  ownership. Logout/replacement invalidates these records. Optional diagnostic
  failure cannot rollback an acknowledgement, alter backoff or poison the serial queue.
- Upload uses one parameterised VALUES insert for up to 100 observations after
  the existing summary/lock/cleanup sequence, retaining the original field mapping,
  classification, first duplicate, all acknowledged IDs and expiry on conflict.
- Replay lineage uses four bounded chunks for this 840-link fixture instead of
  840 individual inserts. Deletion and every chunk share the existing transaction.
  Exact protected/manual/terminal links and rollback on the second chunk are tested.

## Disposable setup and finite measurements

Fresh isolated PostgreSQL **17.11**, PostGIS **3.6**, six ordered local migrations,
loopback port 55437, unique synthetic owners; no hosted URL or credentials loaded.
`npm ci --ignore-scripts --no-audit --no-fund` succeeded without lockfile changes.
The new runner initially needed its top-level await changed to the repository's
CJS-compatible main function; setup did not require a second database version or
native build. Its owned cluster is stopped at handoff. The runner removes its synthetic owners;
the temporary cluster directory remains local because automatic approval review
rejected recursive directory removal.

One instrumented before run used the unchanged insert algorithms, after request-local
stage markers were added. Focused after correctness used normal local transport;
the final after run includes one normal and one each 20/40 ms profile. No p95 claims.
All timings below are service transactions through the real shared helper; full
route/auth/session timing is NOT RUN. Artificial delay is before each actual driver
query in the test-only injected pool and is not shipped in transaction code. Successful
query counts include BEGIN/configuration, per-query guards and COMMIT. Substage totals
attribute transaction startup to the initial stage and COMMIT to the last service stage;
route failure metadata separately preserves the helper's actual phase.

| Workload | Before ms / driver calls | Focused after ms / driver calls |
| --- | --- | --- |
| Upload 1 | 20 / 13 | 18 / 13 |
| Upload 25 | 11 / 61 | 6 / 13 |
| Upload 100 | 23 / 211 | 9 / 13 |
| Upload 100 + 20 ms artificial delay | 4,800 / 211 | 290 / 13 (final) |
| Upload 100 + 40 ms artificial delay | FAIL at 7,008 ms, evidence write | 565 / 13 (final) |
| Replay 860, meaningful retained history | 336 / 2,541 | 192 / 869 |
| Replay + 20 ms artificial delay | FAIL at 7,003 ms, segment persistence | FAIL at 7,002 ms / 307 calls (final) |
| Replay + 40 ms artificial delay | FAIL at 7,003 ms, segment persistence | FAIL at 7,003 ms / 162 calls (final) |

The before stress failure counters included an attempted delayed query that could
be cancelled before reaching the driver; they are deliberately not reported as actual
query counts. The final runner counts only calls actually sent to the driver.

Seven days of synthetic London-relative observations produce **56 stays, 28 commutes,
28 Review items, zero entries and 840 links**, with no saved places. This is a synthetic
workload, not a reconstruction of the private 48/68 engine snapshot. Exact ordered
lineage hash before and after:
`2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899`.
The fixture explicitly fixes the clock and cutover. A one-way 30-observation subset
produces one outbound Review commute and no invented return.

Lineage consumed 1,682 guarded driver calls (165 ms local) before, versus 10 calls
(42 ms in the focused after run). This directly supports the plan's conditional
batching. The remaining normal profile includes **342 segment-persistence** and
**505 semantics/commit** calls. Under artificial latency, segment persistence hits
the existing budget before lineage. Further segment/semantic batching, partial replay,
cursors or timeout changes are outside scope. **Replay budget decision required**;
normal loopback completion is not hosted repair or robust network-latency proof.

## Focused validation ledger

| Command / scope | Outcome | Elapsed | Last relevant edit |
| --- | --- | --- | --- |
| Evidence route regression before implementation | Expected FAIL: no request ID | 2.16 s | Before diagnostics |
| Route tests after diagnostics | PASS, 14 tests | <1 s | Current route implementation |
| Shared allowlist parser | PASS, 8 tests | 0.11 s | Before last-success/auth enums; final suite covers them |
| Mobile Location network + real SQLite | PASS, 15 tests | <1 s | Before last-success field; final suite covers it |
| Reliability correctness-only PostGIS | PASS | <3 s | Before additional owner/device/invalid-body assertions; final runner covers them |

Focused PostGIS checks include exact mapped values/zero metrics/rejected-coordinate
nulling, within/across-request duplicates, immutable retry expiry, coordinate-free
summaries, FK/bulk/commit/cancellation rollback, second-lineage-chunk rollback,
manual/terminal lineage, meaningful unknown-endpoint Review, absent return, and
upload-versus-replay contention. Held-owner replay failed with SQLSTATE 55P03 in
1,509 ms at `owner_lock`; another owner uploaded concurrently. The test releases
the lock and makes one later explicit replay attempt. Real SQLite additionally proves
seven batches progress in maximum-five passes and preserve their request bodies/IDs.

## Settings motion and accessibility contract

The existing Privacy & troubleshooting disclosure owns entrance/exit and surrounding
layout via its existing local Reanimated presence/layout helpers. The new text has
no independent animation, navigation, spinner, banner or floating surface. A sync
result updates in that established region; rapid disclosure toggles and navigation
retain the current owner. Failure/success replaces endpoint text only; there is no
optimistic mutation or Undo to roll back. Reduce Motion retains the existing no-travel
path. Body text is uncapped, multiline and selectable, including the UUID, within the
existing scroll area; no line-count truncation or fixed height is introduced.

Large Dynamic Type, VoiceOver, normal/Reduce Motion transitions and signed-app
presentation are **NOT RUN BY CODEX**. No native build/install is authorised. The
later acceptance uses an ordinary locally signed Xcode staging app, without Expo/EAS.

## Final validation ledger

One final broad pass ran with an explicit disposable local DATABASE_URL and dev
auth, without loading hosted configuration. Lint includes docs/config checks.

| Command | Outcome | Elapsed | Evidence / scope |
| --- | --- | --- | --- |
| `npm run lint` | PASS | 9.20 s | Two existing unused-variable warnings in event-service tests; no errors. |
| `npm run typecheck` | FAIL | 10.30 s | FAIL: only baseline TS2307 expo-symbols in ConnectivityStatusStrip.tsx:27. Web/shared PASS. |
| `npm run test` | PASS | 15.38 s | 2,409 passed; 3 existing skipped tests. |
| `npm run build` | PASS | 14.24 s | Web production build PASS. |
| `git diff --check` | PASS | 0.04 s | Tracked diff PASS; staged check found original plan hard-break whitespace, normalised before final staged PASS. |
| `npm run validate:location-v2-db` | PASS | 1.50 s | Real ordered PostGIS correctness/Review/terminal/cutover regressions PASS. |
| `npm run validate:location-v2-sqlite` | PASS | 1.26 s | Existing SQLite validator PASS. |
| `npm run validate:sync-transactions` | PASS | 4.22 s | Real statement/lock/idle guards, cancellation/lock release and cumulative deadline PASS. |
| `npm run validate:location-reliability` | FAIL | 17.90 s | Correctness PASS; overall FAIL for 20/40 ms synthetic replay budget at segment persistence. No redesign/retry loop. |
CI, Preview, hosted smoke, signed build and physical tests are **NOT RUN BY CODEX**.
No CI/Vercel polling, staging promotion, hosted writes/migrations, production access,
real-user replay, Claude invocation, Xcode build, installation, owner acceptance or
merge is performed. STOP at the pushed draft.

Final normal after values: upload 1/25/100 = **8/5/9 ms**, all **13 calls**;
replay = **203 ms / 869 calls**, same 56/28/28/0 outputs and exact lineage hash.
Final lineage stage: **47 ms / 10 calls**. The synthetic 20 ms replay failure spends
6,655 ms / 295 calls in segment persistence; 40 ms spends 6,426 ms / 150 calls
there. This is the first still-failing stage. Neither failure reaches lineage or
semantic emission, and both preserve all prior links transactionally.

A final diff review added only malformed-metadata containment and a Settings
post-native-await session check, plus last-success/account-replacement regressions.
Affected mobile Location network/SQLite/replay-contract tests then passed **25/25**
in 0.59 s. Mobile typecheck was rerun for these edits and still reports only the
same baseline expo-symbols error. Web/build/DB evidence remains applicable; the
broad pass was not restarted. The final documentation update is separately checked
with `npm run check:docs` and `git diff --check` before commit.

Simulated acquisition exhaustion is covered by existing helper unit tests; it was
not separately induced on the real pool in this session. Full route/auth timing,
Settings rendering/large-text/VoiceOver/motion, hosted schema and synthetic hosted
write smoke remain NOT RUN. There is no claim that those gates passed. Local ordered
schema application was disposable setup, not a hosted migration.

## Changed files

- `.codex/reference/api.md`
- `.codex/reference/location-learning.md`
- `.codex/reference/validation-matrix.md`
- `apps/mobile/app/settings.tsx`
- `apps/mobile/src/lib/location/network.test.ts`
- `apps/mobile/src/lib/location/network.ts`
- `apps/mobile/src/lib/location/store.sqlite.test.ts`
- `apps/mobile/src/lib/location/store.ts`
- `apps/web/src/app/api/location/evidence/route.test.ts`
- `apps/web/src/app/api/location/evidence/route.ts`
- `apps/web/src/app/api/location/replay/route.test.ts`
- `apps/web/src/app/api/location/replay/route.ts`
- `apps/web/src/lib/location/location-ingest-service.ts`
- `apps/web/src/lib/location/location-replay-service.ts`
- `apps/web/src/lib/location/location-sync-diagnostics.test.ts`
- `apps/web/src/lib/location/location-sync-diagnostics.ts`
- `docs/architecture.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- `docs/investigations/2026-09-14-location-reliability.md`
- `docs/plans/location-reliability-v1.md`
- `docs/roadmaps/review-ux-roadmap.md`
- `package.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/location/syncDiagnostics.test.ts`
- `packages/shared/src/location/syncDiagnostics.ts`
- `scripts/fixtures/location-reliability-correctness.ts`
- `scripts/fixtures/location-reliability.ts`
- `scripts/validate-location-reliability.ts`

## PR #197 focused correction — segment persistence

This correction continues `codex/location-reliability` from reviewed head
`b96aa11b2c1ac77bf860d5f366d7b0e67711fb98`. It does not reopen the initial plan's
later jobs. The user explicitly authorises only set-based segment persistence
and local validation, then a commit/push to this existing draft PR.

### Supplied hosted evidence

The owner reports the exact reviewed head was promoted to stable staging:

- Upload HTTP 201 in **1,302 ms**, phase `commit`; **262 retained evidence records**
  acknowledged and all **seven pending batches** cleared.
- Replay HTTP 503, `location_processing_busy`, `operation_timeout`, phase `effect`,
  stage **`segment_persistence`**, duration **7,001 ms**.
- Rollout remains `v2_review`, semantic cutover is unchanged, and the failed
  transaction produced no partial Review/output.

This establishes the remaining hosted timeout stage and, together with the
342-call local segment profile, supports targeting its per-segment round-trip
amplification. These are owner-supplied hosted results, not a new hosted inspection
by Codex. Hosted repair at the correction head is **NOT VERIFIED**; it requires a
later explicitly authorised exact-head staging replay. Capture remains outside scope.

### Exact correction and preservation

Only production file `location-replay-service.ts` changes. For stays, sort engine
client IDs deterministically, lock existing matches in chunks of at most 250 with
workspace/user/device scope and `FOR UPDATE`, then retain IDs for rows whose
continuity is `manual` or whose non-null `created_from_event_id` has no owner-scoped
open Review. Those rows never enter the write batch. Parameterised VALUES upserts
persist only mutable/new rows, returning both client and database IDs. The map
includes protected and upserted stays. Commutes resolve their actual from/to stay
IDs from this map, omit unresolved relationships as before, then follow the same
lock/partition/upsert flow.

The 250-row limit caps stays at 5,250 and commutes at 5,750 SQL parameters per write.
No per-segment SQL remains. The conflict targets, insert mapping, update column
lists, open-Review predicate and created-from-event semantics are unchanged. All
locks/chunks share the original transaction, advisory lock and deadlines. Engine,
semantic emission, lineage implementation, upload, diagnostics, capture, retries,
rollout/cutover and native/mobile code are unchanged. No migration or new owner.

### Regression and baseline evidence

The new real-Postgres fixture first ran against the old persistence implementation
and then the bulk implementation. It covers multiple/mutable/new stays/commutes,
full protected row equivalence including `updated_at`, exact open-Review behavior,
actual commute foreign keys and protected ID maps, owner/workspace/device isolation,
idempotency, second-segment-write rollback of segments/lineage/Review/events, and
unchanged protected lineage. A fixture-only wrong Review column name was corrected
to the actual `event_id` before the passing baseline run.

The 860-observation fixture asserts exactly **56 stays, 28 commutes, 28 Review items,
0 entries**. Complete stored business fields plus semantic output, normalising
only generated database identities/timestamps, match the pre-batching SHA-256:
`79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3`.
The 840-link lineage hash remains
`2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899`.

Passing focused baseline: **212 ms / 869 total driver calls**, with segment
persistence **55 ms / 342 calls**. Initial passing bulk profile: **165 ms / 541 calls**,
with segment persistence **11 ms / 14 calls**. The 14 calls include the unchanged
three supersession statements plus one lock and one write per segment kind, each
with its timeout-configuration call. The 505 semantic/commit calls are unchanged.
Final bounded measurements and validation are recorded below before handoff.
### Final correction measurements and stop decision

Disposable local PostgreSQL 17.11 / PostGIS 3.6 only; same synthetic 860-observation
fixture and existing seven-second operation budget. Driver counts include timeout
configuration calls. The normal before row is the passing pre-change focused run;
synthetic before rows are retained reviewed-head measurements above. After rows are
from the single final validation pass.

| Profile | Before replay ms / calls | Before segment ms / calls | After replay ms / calls | After segment ms / calls | After outcome |
| --- | --- | --- | --- | --- | --- |
| Local, no delay | 212 / 869 | 55 / 342 | 164 / 541 | 11 / 14 | PASS |
| 20 ms / driver call | 7,002 / 307 | 6,655 / 295 (incomplete) | 7,001 / 304 | 343 / 14 (complete) | FAIL: `semantics` |
| 40 ms / driver call | 7,003 / 162 | 6,426 / 150 (incomplete) | 7,002 / 159 | 629 / 14 (complete) | FAIL: `semantics` |

Both synthetic failures are `operation_timeout`, phase `effect`. Semantic emission
consumed 5,997 ms / 268 calls at 20 ms and 5,241 ms / 123 calls at 40 ms before
rollback. The failure moved to a different stage, triggering the user's stop
condition: **no semantic optimisation was attempted**. Segment persistence loses
328 driver calls; total successful replay loses the same 328 calls. Local success
is not evidence of hosted repair or a missing return-capture fix.

Upload was measured separately by the unchanged runner: 1 / 25 / 100 observations
completed in 8 / 6 / 9 ms; the delayed upload profiles completed in 304 ms (20 ms)
and 572 ms (40 ms). All passed. Upload production code is unchanged in this correction.

### Final validation ledger

- **PASS** focused affected web/Location tests: 10 files, 59 tests.
- **PASS** `npm run validate:location-v2-db` against disposable PostGIS.
- **PASS** `npm run validate:sync-transactions` against disposable PostGIS.
- **FAIL** `npm run validate:location-reliability` overall: both synthetic replay
  profiles time out at `semantics`; normal replay, upload, exact fingerprints,
  segment preservation/isolation/idempotency/rollback, lineage rollback and the
  remaining correctness checks pass.
- **PASS** one broad `npm run test`: web 1,234; mobile 921 (3 skipped); shared 259.
- **PASS** web and shared typechecks.
- **PASS** docs check and `git diff --check`, also checked after final documentation edits.
- **NOT RUN** hosted replay, CI/Vercel inspection, deployment/promotion, native/iOS
  build/install, Claude or merge. Mobile typecheck was not rerun; the previously
  recorded `expo-symbols` TS2307 baseline remains separate.

Correction files: `apps/web/src/lib/location/location-replay-service.ts`,
`scripts/fixtures/location-segment-persistence.ts`,
`scripts/validate-location-reliability.ts`, `docs/architecture.md`,
`docs/feature-fix-tracker.md`, and this investigation. Documentation impact is
runtime persistence plus current investigation/tracker state; no product or
rollout/cutover contract changed. The existing draft PR remains the handoff target.

## PR #197 focused correction — v2_review semantic emission

Continues approved head `787d03a63c671065162fa5143cc8c1bd9ff5a395` on the existing
branch/PR. Owner-supplied exact-head staging evidence reports evidence upload
HTTP 201, phase `commit`, **2,430 ms**; replay HTTP 503, `operation_timeout`, phase
`effect`, stage **semantics**, **7,002 ms and 7,001 ms**. The owner confirms segment
persistence now completes, rollout remains `v2_review`, semantic cutover is
unchanged, and replay left no partial Review/output. This is supplied evidence,
not a new hosted replay or deployment by Codex.

The correction introduces a dedicated `v2_review` emitter. The existing finalised
and post-cutover filter, persisted-ID check, minimum unknown-stay dwell and
trusted logging suppression remain. Workspace saved places and owner-scoped
learned links/display names are preloaded with the original trust predicates.
Existing semantic events are locked by owner and deterministic client ID. The
existing automatic Commute category helper/lock runs once if needed. Parameterised
`jsonb_to_recordset` writes use deterministic chunks of at most 250 rows: source
event upserts, missing Review inserts, open-only Review updates, and stay/commute
event links. Conflict/update column lists and terminal preservation are unchanged.
No Review type/status is rewritten on refresh. Segment updates touch only the
original event-link/status/timestamp fields; manual business fields stay intact.

`locationSemanticDisposition` and the `v2_enabled` emitter remain unchanged. The
review path retains the same pure overlap assessment with an empty input, including
its invalid-window result, and performs no overlap reads or entry writes. All
work remains in the existing advisory-locked atomic replay transaction, with
unchanged operation/statement/lock deadlines, retries, rollout/cutover, engine,
lineage and capture. No schema or native/UI change.

Focused PostGIS regressions cover multiple Review semantics, exact refresh and
terminal preservation (including a terminal source without Review), saved/learned
trust and fallback titles, logging-disabled suppression, short unknown/unpersisted
suppression, category creation/reuse under one lock, actual segment/event links,
workspace/user isolation, manual fields, 251-row chunk boundaries and full replay
rollback after semantic writes and segment links for both new and existing output.
The existing 860-observation golden semantic and lineage fingerprints are retained.
An initial SQL recordset confidence type was corrected from numeric to the schema's
text confidence before the passing focused run; synthetic setup columns/FKs were
aligned with the actual schema. These were local development failures, not hosted
evidence or changes to the data model.

Final measurements and the single final validation ledger follow below.

### Final semantic measurements

Same disposable PostgreSQL 17.11 / PostGIS 3.6, synthetic 860-observation fixture
and seven-second operation budget. Before values are retained final measurements
at approved head `787d03a`; after values are the single final validation run for
this correction. Driver counts include timeout configuration and the successful
commit in the last observed stage. No separate before rerun was necessary.

| Profile | Before total ms / calls | Before semantics ms / calls | After total ms / calls | After semantics ms / calls | Result |
| --- | --- | --- | --- | --- | --- |
| Normal first replay | 164 / 541 | 54 / 505 | 123 / 53 | 11 / 17 | PASS |
| 20 ms/call repeat | 7,001 / 304 | 5,997 / 268 (incomplete) | 1,323 / 51 | 352 / 15 | PASS |
| 40 ms/call repeat | 7,002 / 159 | 5,241 / 123 (incomplete) | 2,380 / 51 | 660 / 15 | PASS |

First replay includes creating the Commute category; repeat reuses it and saves
two guarded driver calls. The normal reduction is **488 semantic/total driver
calls**. Segment persistence remains 14 calls and lineage remains 10. At 40 ms
per driver call the measured replay retains 4,620 ms inside the unchanged budget.
These are finite synthetic measurements, not p95 or hosted latency claims.
**No remaining failure stage was observed.** No other stage was optimised.

Upload stayed separate and unchanged: 100 observations passed in 9 ms / 13 calls,
and the 20/40 ms-per-call upload profiles passed in 305/574 ms / 13 calls.

The normal fixture remains **56 stays, 28 commutes, 28 Review items, zero entries,
840 lineage links**. Its stored-field/semantic fingerprint remains
`79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3`, and lineage
remains `2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899`.

### Final semantic validation ledger

Development used focused semantic/Postgres checks. The single final pass completed:

| Check | Result |
| --- | --- |
| Affected Location/web tests | PASS: 10 files, 59 tests |
| `npm run validate:location-v2-db` | PASS, including unchanged trusted-place/commute automatic policy, overlaps, cutover and terminal decisions |
| `npm run validate:sync-transactions` | PASS |
| `npm run validate:location-reliability` | PASS: all normal/latency profiles and correctness regressions |
| One broad `npm run test` | PASS: web 1,234; mobile 921; shared 259; 3 existing skips |
| Web/shared typechecks | PASS |
| Docs check and `git diff --check` | PASS, including final documentation edits |

**NOT RUN**: CI/Vercel observation, hosted replay, deployment/promotion, build,
iOS installation, Claude, merge, mobile typecheck (the prior `expo-symbols` TS2307
baseline remains separate). The owned local disposable database was stopped after
validation. No user data was replayed. Hosted repair at the correction head remains
**NOT VERIFIED** until a later explicitly authorised exact-head staging replay.
The missing return-capture problem is not fixed by this change.

Correction files: `apps/web/src/lib/location/location-ingest-service.ts`,
`apps/web/src/lib/location/location-review-semantic-batch.ts`,
`scripts/fixtures/location-review-semantics.ts`,
`scripts/validate-location-reliability.ts`, `docs/architecture.md`,
`docs/feature-fix-tracker.md`, and this investigation. Documentation impact is
runtime persistence and current evidence/delivery state; no product, schema,
rollout or native/UI contract changed. Existing draft PR #197 is the handoff.

## 2026-09-15 — targeted Location Quick Confirm fingerprint correction

Owner-reported physical staging symptom: one commute Quick Confirm succeeded;
a second a few seconds later returned HTTP 409 `proposal_changed` and became
Needs attention. The exact device request sequence has not been traced. This
entry does not present replay between those device requests as established history.

Verified clean existing branch at `2da87a885a051fde3cf10298a619c693c550770b`;
fetched main remains `a83bfc976f03b14ffc48712681707ecdc27b2601`. No rebase/reset.
Before changing production code, the focused timestamp-only regression failed
(1 failed, 15 passed): the previous helper changed the Location hash when only
`semanticRevision` changed. The correction normalises that value to null solely
for `location_v2` inside the existing shared server helper. Every other hash field,
normalisation and version remains unchanged. Generic fingerprints retain revision
protection and match a frozen pre-correction SHA-256 exactly.

Quick Confirm's inserted entry uses the retained suggested category/place,
interval, confidence and event identity; stay description uses the retained title,
commute description is a fixed null default, source/status are fixed action values,
and empty edit tags are fixed. Commute's existing absent-category fallback uses
its established category owner. Segment kind is tied to the retained segment ID.
No additional proposal value requiring timestamp protection was found. Presentation
and locked mutation reads continue calling the same helper, and response/cache
revision metadata remains intact. No replay batching, timestamp write, schema,
mobile runtime, outbox, request hashing, receipt, lock or transaction code changes.

Real disposable PostgreSQL/PostGIS coverage read two independent commute proposals,
confirmed one, committed unchanged-evidence replay after a real clock gap, proved
that the second revision changed but its effective proposal and hash did not, and
confirmed it using the original captured hash. Both receipts replayed exactly once.
A changed stop time rejected with `proposal_changed` and no entry. Tests also cover
owner isolation, ignored terminal decisions, pending old-format hash rejection,
and a constructed pre-deployment successful receipt with its original timestamp-
bearing hash/result. Receipt replay preserves a later user edit, creates no entry,
and rejects substitution of a new hash under the old mutation ID.

Compatibility: old cached/queued uncommitted Location hashes may require refresh,
review of the current proposal, and a new explicit user decision. Successful
immutable requests continue resolving through their original receipts. Existing
Needs-attention records were not touched. No envelopes, receipts or caches were
rewritten or cleared. Refresh is not permission to silently reconfirm.

Documentation impact: shared confirmation/API contract and investigation evidence;
`.codex/reference/api.md` documents content-based Location fingerprints and unchanged
generic behaviour. Hosted and physical retest remain outstanding; this correction
does not establish that the observed phone incident is fully resolved.

Validation results follow below.

### Quick Confirm validation and handoff

- **FAIL before fix (expected regression):** hash suite, 1 timestamp-only failure;
  the other 15 cases passed on the approved helper.
- **PASS after fix:** affected hash/presentation/mutation tests, 33 tests.
- **PASS:** `npm run validate:review-mutation-db`, run once after the correction
  settled against the existing disposable PostgreSQL 17/PostGIS cluster. Includes
  new real replay/Quick Confirm cases and existing receipt/transaction regressions.
- **PASS:** one final web-wide lint/typecheck/test/build pass. Web tests: 936 passed,
  3 existing skips. Lint: zero errors, two existing unused `_values` warnings in
  `event-service.test.ts`. Build used the explicit disposable local database.
- **PASS:** documentation check and `git diff --check`, including final docs edits.
- **NOT RUN:** CI/Vercel, hosted/physical retest, deployment/promotion, mobile,
  SQLite, native/simulator, synthetic latency suites, Claude/OpenClaw or merge.

The disposable cluster is stopped after validation. The Needs-attention records
remain untouched; retrying the unchanged old envelope may continue to reject.
A fresh explicit decision after reviewing the current proposal is required when
its cached hash no longer matches. No claim of physical incident closure is made.

Changed files: `apps/web/src/lib/review-proposal-hash.ts`, its `.test.ts`,
`scripts/fixtures/location-quick-confirm.ts`, `scripts/validate-review-mutation-db.ts`,
`.codex/reference/api.md`, and this investigation. Only the shared helper changes
production behaviour; presentation/mutation consumers remain unchanged.

## Post-merge reconciliation — PR #197

PR #197 merged at `a48abcc4ca55de68009b33a401f36743e4577cd6` from final approved
head `9ea67111ad4e8af63ca56f21e86ff6253d294d9a`. The owner reports functional
exact-head staging replay success and consecutive Quick Confirm **PASS**: three
fresh Location commute Reviews canonicalised exactly once, with no duplicate
entries or new `proposal_changed` failures. One temporary `review_item_locked`
recovered through the normal retry path. The merged hash correction excludes
Location `semanticRevision` bookkeeping timestamps while retaining effective
proposal fields and unchanged generic fingerprints. This supplied acceptance
supersedes the earlier pending hosted/physical retest notes for that correction;
it does not retrospectively prove the original device request sequence.

Residual items remain separate: saved-place short-dwell false visit, same-place
geofence-exit/continuity fragmentation, missing-return capture investigation, and
replay latency watch. Staging remains `v2_review`. This record does not establish
`v2_enabled` activation, production/TestFlight release, production Location
acceptance or resolution of saved-place dwell/continuity defects. Current delivery
state and sequencing remain in the canonical tracker and existing roadmap.
