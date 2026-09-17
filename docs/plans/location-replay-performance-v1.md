# Dayframe Location Replay Performance V1

**Prepared:** 17 September 2026
**Repository:** kwabiwe/dayframe
**Verified planning main:** cf23168966e69abf2f3dfe853f806b9721e49db6
**Suggested branch:** fix/location-replay-performance
**Target PR:** #202, draft only
**Requested implementation model/effort:** GPT-5.6 Luna / MAX

## 0. Session boundary

This is one focused implementation PR from fresh main. Sections 1–15 are the
implementation, validation and handoff contract for this session. Section 16 is
later, separately authorised work and is not an instruction to the
implementation agent.

The session uses one isolated branch/worktree and must not touch the TestFlight
worktree or reuse a merged feature branch. It may fetch main, inspect local
history, edit the scoped files, run focused checks and one final broad pass,
commit, push and open one draft PR into main.

Do not poll CI or Vercel, wait for hosted jobs, invoke Claude, replay real
accounts, promote staging, access production, build/install iOS or TestFlight,
change hosted infrastructure, merge, or start Section 16 after the draft PR is
opened. Report those items as NOT RUN and stop.

Use only the verified task-owned local PostgreSQL/PostGIS test environment.
Never use Docker or the default 54322 service for this work, and never source
hosted credentials. If the narrow fix misses its target or exposes a new
unbounded bottleneck, preserve the evidence and stop for the scope decision
instead of weakening assertions or broadening implementation.

## 1. Objective and limits

Reduce redundant timeout-configuration round trips in the existing
withSyncTransaction owner for retained Location replay when the server-effective
rollout is v2_review.

The owner may reuse a known identical full-cap statement/lock timeout pair:

- statement_timeout = 3,000 ms;
- lock_timeout = 1,500 ms.

The pair may be reused only while the owner still knows those exact values are
installed. The optimisation must fall back to the existing per-query
configuration round trip when the remaining budget is below either cap or the
configuration state becomes uncertain. Every other withSyncTransaction caller,
including evidence ingest, Health, Review mutation/presentation, automatic-mode
replay and v2_enabled replay, keeps the current behaviour.

This is a server transaction-owner correction. It does not change the operation,
statement, lock, idle, cleanup, isolation, cancellation, advisory-lock,
savepoint, rollout, semantic, evidence-retention or retry budgets. It does not
change Location segmentation, automatic policy, mobile scheduling, capture
frequency, geofences, permissions or the PureGym incident outcome.

## 2. Baseline and evidence

Main was fetched before branching. Its exact head is
cf23168966e69abf2f3dfe853f806b9721e49db6, the PR #201 merge.

The current owner installs transaction-local guards in the BEGIN message, then
re-runs a parameterised statement/lock set_config pair before every nested
business query. This is safe but redundant while the full-cap pair is still
known to be intact. PR #201's replay diagnostics and existing bounded batching
remain the baseline.

The representative retained synthetic replay is the existing seven-day,
860-observation v2_review fixture. Its business result is 56 stays, 28
commutes, 28 Review items, zero entries and 840 lineage links. The ordered
business-query stream and stored/lineage fingerprints must remain unchanged.

The performance evidence must count calls at the raw pg driver boundary,
including BEGIN/configuration/COMMIT and every timeout-configuration query.
Artificial 20 ms and 40 ms per-driver-call delays are test-only and must never
enter production code.

## 3. Repository and owners

The transaction owner is apps/web/src/lib/sync-transaction.ts. The retained
replay caller is apps/web/src/lib/location/location-ingest-service.ts and the
business replay implementation remains
apps/web/src/lib/location/location-replay-service.ts.

Focused transaction regressions belong in
apps/web/src/lib/sync-transaction.test.ts. Replay caller routing belongs in a
focused Location test. The existing real-PostgreSQL harness is
scripts/validate-location-reliability.ts, with its existing synthetic fixture
and profiles. Do not create a second transaction owner, replay coordinator,
queue, migration or identity system.

## 4. Timeout-pair contract

At transaction start, record whether the BEGIN-installed statement and lock
values are exactly the two full caps. Do not infer a full-cap pair when the
initial remaining budget is lower than either cap.

Before each nested query:

1. Check cancellation, expiry and the existing cumulative operation budget.
2. Compute the same capped values the baseline path would apply.
3. Skip the configuration query only when the opt-in is enabled, the cached
   state is known full-cap, and the newly computed pair is still exactly
   3,000/1,500 ms.
4. Otherwise issue the existing set_config pair, preserve its parameters and
   check the budget again before the business query.

Do not cache a lower or partially capped pair. Near the deadline, the existing
per-query configuration path is authoritative even if it costs another round
trip.

## 5. Uncertainty and fallback rules

The cache is fail-closed. It becomes unknown after successful savepoint,
rollback-to-savepoint or release-savepoint handling, and after SQL that could
change or obscure timeout settings, including parameterised set_config, SET,
RESET, statement_timeout or lock_timeout references. The next ordinary query
must restore the existing guard before proceeding.

Keep the existing special handling that lets rollback-to-savepoint and release
savepoint run without first issuing a guard query. Preserve rollback cleanup,
connection destruction, SQLSTATE and original-error behavior.

If initial configuration, transaction_timeout feature detection, a timeout
configuration query, cancellation, connection acquisition, isolation setup,
business query or commit fails, use the existing failure/rollback path. The
optimisation must never turn uncertainty into a successful skip, mask an error
or extend the deadline.

## 6. Replay routing

Retained replay computes the server-effective rollout before opening its
transaction. Pass the opt-in only when effectiveMode is exactly v2_review.
Requested client mode, acknowledgement, semantic cutover and whether a
particular replay emits a Review item do not grant the opt-in.

The evidence-ingest transaction and every other caller pass no opt-in. Keep the
existing operation name, checked-out client, advisory owner lock, Repeatable
Read/read-only options, observation hooks, response schema, semantic batching,
terminal protections, lineage and current ID behaviour unchanged.

## 7. Implementation sequence

1. Fetch origin/main, verify the merge and inspect advancement before creating
   the isolated branch/worktree.
2. Run the focused baseline tests and the existing local reliability fixture.
   Record raw driver counts, timeout-configuration counts, business-query order
   hash, logical counts, stored fingerprint and lineage hash.
3. Add the narrowly scoped opt-in/state tracking to the existing transaction
   owner.
4. Route only server-effective v2_review retained replay through the opt-in.
5. Add focused unit tests for default behavior, full-cap reuse, finite-budget
   fallback, savepoint invalidation, parameterised timeout-setting uncertainty,
   cancellation and isolation.
6. Extend the existing raw-driver harness with timeout-configuration counts,
   business-query order hashing and the finite 85 ms replay profile.
7. Run focused checks, the real local PostgreSQL/PostGIS validator and one final
   broad pass after the diff settles.
8. Review status/diff, commit, push and open one draft PR. Stop immediately.

## 8. Regression matrix

Required focused assertions:

- Default transaction callers still configure before each ordinary nested query.
- Opted-in full-cap replay skips only redundant full-cap configuration calls.
- A lower remaining budget reconfigures before the business query and does not
  reuse a partial pair.
- Savepoint creation/recovery and parameterised timeout-setting SQL invalidate
  the cache and restore the guard on the next ordinary query.
- Cancellation still prevents late body SQL and destroys the lease.
- Repeatable Read/read-only BEGIN ordering and configuration remain unchanged.
- Configuration failure still fails closed before work starts.
- The ordered non-configuration business SQL stream is identical before/after.
- Real replay produces identical logical counts, stored fields, segment IDs,
  Review/entry decisions, foreign keys and lineage.
- Evidence ingest, v2_shadow and v2_enabled replay retain baseline call-path
  behavior.

## 9. Raw-driver performance profiles

Use the existing reliability fixture and raw pg-driver wrapper. Report actual
elapsed milliseconds; do not invent p95 values from finite samples.

Run the existing profiles:

- upload batches of 1, 25 and 100;
- upload-100 with 20 ms and 40 ms per-driver-call delay;
- retained replay-860 with no delay;
- retained replay-860 with 20 ms and 40 ms per-driver-call delay.

Add one finite 85 ms replay attempt using the existing operation owner and no
new timer. It is a near-deadline fallback profile: report whether the attempt
settles successfully or with the existing bounded operation timeout, its raw
driver/configuration counts, phase and business-query hash, and prove that an
unsuccessful attempt leaves lineage unchanged.

Count timeout-configuration calls separately from total raw driver calls.
Compare before/after business-query order and logical output. A performance
win is not sufficient if the business order, rollback, ownership or stored
result changes.

## 10. Real PostgreSQL/PostGIS validation

Use one explicit loopback PostgreSQL 17/PostGIS task-owned database whose name
ends in _test. Verify the server version, PostGIS version and target before
running validators. Apply only the existing ordered local schema if setup is
needed. Do not use the default 54322 service, Docker, hosted URLs, Supabase,
Vercel or production credentials.

Run the existing reliability correctness/protection/isolation/rollback
fixtures. Synthetic owners must be unique and cleaned by the harness. Preserve
the existing seven-day logical output and lineage fingerprints. The finite
85 ms attempt may fail by the existing deadline contract, but it must not
leave partial segments, semantics, lineage or Review effects.

## 11. Documentation impact

Add this plan at docs/plans/location-replay-performance-v1.md. Add a dated
investigation with the actual baseline/after measurements, SQL-call accounting,
logical-result/order evidence and PASS/FAIL/NOT RUN ledger.

Update the canonical architecture or Location-learning reference only enough to
state that the existing transaction owner may reuse a known full-cap timeout
pair for server-effective v2_review retained replay, with fail-closed fallback;
all other callers and budgets remain unchanged. Add the regression guard to the
Location reliability checklist if the existing checklist is the canonical home
for this invariant. Do not rewrite product requirements, rollout state,
mobile-capture guidance or release records.

## 12. Validation budget

During development use the narrowest affected web tests and the existing
reliability correctness/measurement harness. Do not run the entire workspace
after every edit.

After the diff settles, run one broad pass:

    npm run lint
    npm run typecheck
    npm run test
    npm run build
    git diff --check

Run the materially relevant real validators once near handoff, including the
existing Location V2/PostGIS and transaction checks when their owners are
affected. Report baseline errors separately. Do not weaken assertions, rerun
successful suites in loops, repair unrelated infrastructure or treat a later
isolated pass as proof that a broad command passed.

## 13. Stop and escalation conditions

Stop before broadening if the correction requires a schema migration, new
transaction/replay owner, new identity/version namespace, timeout increase,
partial replay commit, cursor, mobile/native scheduling or capture change,
hosted configuration, or a general performance programme.

Stop if finite 85 ms behavior changes in a way not explained by the existing
deadline contract, business-query order or logical results differ, the
timeout-setting state cannot be proven safe, a protected/terminal result could
be overwritten, or the real local validator exposes a new stage bottleneck.

Preserve the failing fixture, raw-driver evidence, scope and minimum decision
needed. Do not change thresholds or delete an assertion to force a pass.

## 14. Acceptance and handoff

Before the draft PR:

- exact base/head SHAs and branch are recorded;
- the plan is present at the requested path;
- changed files and documentation impact are reviewed;
- normal, 20 ms, 40 ms and finite 85 ms raw-driver measurements are recorded;
- configuration-call reduction is separated from total-call reduction;
- business-query order and all logical/fingerprint/lineage results are proven;
- default, non-v2_review, fallback, savepoint, cancellation, isolation,
  rollback and ownership tests are recorded;
- no hosted/device/CI/release work is implied.

Commit and push the focused branch, open one draft PR into main, report the
exact base/head and changed files, then STOP.

## 15. Required final report

Report:

- exact base SHA, head SHA, branch and draft PR;
- changed files;
- the attached-plan mismatch if relevant to interpretation;
- baseline and after raw driver calls plus timeout-configuration calls for every
  profile, including finite 85 ms;
- before/after business-query order hash and logical/fingerprint/lineage
  results;
- implemented routing and fallback rules;
- focused, real-PostgreSQL, SQLite-if-affected and broad checks as
  PASS/FAIL/NOT RUN;
- any baseline-only failures;
- explicit NOT RUN statements for CI/Vercel polling, hosted replay or
  promotion, production, iOS/TestFlight, live replay, Claude and merge.

No claim may exceed the evidence. A local synthetic performance result is not a
hosted latency claim and no replay-performance fix proves missing native
capture or PureGym arrival accuracy.

## 16. Later jobs — not instructions for this implementation session

Independent review, exact-head CI/Preview observation, staging promotion,
hosted replay, production checks, iOS/TestFlight build or installation,
physical-device acceptance, automatic-mode scheduling/capture investigation,
PureGym accuracy assessment and merge are separate jobs requiring their own
explicit authorization. Do not perform or poll them from this session.
