# Dayframe PR #206 — C20 race verification and narrow scope addendum

- **Addendum ID:** `DF-PROD-REPLAY-SCALABILITY-A1-C20`
- **Parent plan:** `DF-PROD-REPLAY-SCALABILITY-V1`
- **Date:** 20 September 2026
- **Repository:** `kwabiwe/dayframe`
- **Base:** `791e57ea3d806c1474407b7b3546d05a42bd0153`
- **Reviewed starting head:** `19950c8c5078aa2eed80d770735cc29b487421fd`
- **Existing branch:** `fix/location-replay-production-scale`
- **Status:** Proposed. Effective only when KB explicitly forwards the accompanying authorisation prompt or otherwise approves this addendum. Creating this document does not approve the PR or retrospectively authorise the earlier deviation.
- **Job:** Codex GPT-6 Astra, low reasoning. Local tests and documentation, then push the existing draft PR and stop.

## 1. Decision and limits

The owner is being asked to authorise evaluation and conditional retention of two **already implemented** SQL changes at the reviewed starting head:

1. The combined protected-source request, consisting of stay and commute locking subqueries joined with `UNION ALL`, including the existing `LATERAL ... OFFSET 0` evidence lookup.
2. The read-only materialised eligible-lineage CTE used to identify obsolete open Review proposals, with subsequent writes remaining separately awaited statements.

This is not permission for a new optimisation campaign. The proposed decision recognises the measured performance improvement while requiring the missing concurrency evidence before these implementations can be accepted.

For the selected `review_scalability_v1` profile only, this addendum conditionally supersedes the parent plan's requirement for **two separate sequential table-query statements**. It does not supersede the requirement for one checked-out replay client, no parallel query dispatch on that client, unchanged predicates, locks, owner boundaries, or C20 testing. Every other default/legacy/rollout path remains subject to its original requirements.

The addendum also provides the narrow scope decision for the existing obsolete-proposal read rewrite. It does not permit combining lineage deletion and insertion into one data-modifying CTE, removing row locks, changing isolation, changing the coarse owner-lock namespace, or adding connection-level concurrency to production.

**Conditional retention is not safety approval.** A successful finite test is evidence for its exercised schedules, not a proof that all possible deadlocks are impossible. Static analysis of lock order and statement snapshots must accompany execution evidence. An unsafe ordering or stale-decision outcome is a stop condition even when performance passes.

## 2. Starting evidence, without overstating it

The latest supplied review reports the three original defects fixed: incremental JSON byte accounting, enforced row/byte/intended-lineage bounds, and a reachable second-lineage-batch rollback test. It also reports passing local S1 performance: first-success median 4,626 ms, worst S1 5,209 ms, minimum remaining work budget 1,790 ms. These remain existing local results, not new test executions or hosted acceptance.

The original plan explicitly requires two real concurrent connections for C20 and says unrelated Review-lock tests are insufficient. The current production query shapes differ from the original sequential-read requirement. The outstanding work is therefore concurrency evidence, explicit scope reconciliation and honest documentation; it is not another attempt to make the benchmark faster.

Known broad-suite evidence must stay honest: the later broad run failed one category-picker DOM test and its focused retry passed. An earlier legitimate PASS must be dated/scoped to its actual run/head, not silently deleted, relabelled or presented as the latest result.

## 3. Setup and ownership

Verify the PR head and working tree before editing. If the head advanced, inspect the delta and resolve the test target; do not reset someone else's changes. Keep this work in the existing feature branch/worktree. A detached, read-only base checkout is permitted solely for the comparative tests, not as another feature branch.

Use `/private/tmp/dayframe-saved-place-db.env` only after validating its contents privately. The approved target is `127.0.0.1:54323/dayframe_saved_place_test`, previously verified as PostgreSQL 17.11 / PostGIS 3.6.4. Recheck the connection and test identity. Do not recreate the instance, use port 54322, source a hosted environment, or perform infrastructure repairs. If unavailable, report BLOCKED and stop.

Use synthetic, task-owned fixture rows and the repository's real schema/triggers. Do not import production or staging data. Reset or remove only rows created by the test. Keep secrets, full connection strings and private observations out of logs and Git.

Likely files, to confirm rather than invent:

- Existing scalability validator and an appropriate dedicated fixture under `scripts/fixtures/`.
- Existing local Review-mutation/Location fixtures and service injection points, reused where possible.
- The replay service test only for a minimal test seam or contract check, if necessary.
- The investigation ledger and a narrowly scoped architecture/validation statement when inaccurate.
- An in-repository copy of this addendum, referenced by the parent plan and evidence ledger.

Do not rewrite the original byte-identical parent plan as though the exception had always existed. Add a clear link to the governing addendum elsewhere if preserving that original file is required; the addendum explicitly records what it supersedes.

## 4. Audit actual lock paths before implementing the fixture

Read the current replay, Review mutation and Location correction services. Identify the actual entry point used by the durable Review mutation envelope/receipt flow and the real retained-replay entry point. Do not guess function names or substitute a direct SQL status update for a user action.

Produce a compact lock-and-statement map covering:

- Replay's owner advisory lock, protected stay/commute reads, segment persistence locks, obsolete Review selection/retirement and final semantic writes.
- Review's mutation/receipt lock, Review-row lock, event/segment/lineage writes and commit.
- Which explicit actions can actually affect a stay versus a commute. Do not invent an unsupported manual commute edit to fill the matrix.
- Whether a concrete conflict is on `stay_segments`, `commute_segments`, `review_items`, an advisory lock, or a later write.

`ORDER BY` inside each arm and text order of the `UNION ALL` are not, on their own, sufficient evidence of cross-table lock safety. Inspect the actual local query plan and the real competing action path. PostgreSQL's statement-snapshot rules also matter: checking the same predicates in one statement is not automatically the same interleaving as checking them in two statements.

If this audit establishes a new unsafe ordering or a stale protected-read path, preserve a minimal reproduction and stop for a correction decision. Do not add retries, use `SKIP LOCKED`, weaken predicates or change isolation to force the tests green.

## 5. C20 test mechanics: real overlap, not pretend concurrency

Use two independent PostgreSQL connections for the two transactions. A third bounded, read-only monitoring connection is allowed when needed to inspect `pg_blocking_pids` / `pg_stat_activity`; it must not participate in writes or become a production connection pattern.

Use deterministic barriers at actual query-dispatch, query-completion and transaction-commit boundaries through a test-only pool adapter or existing harness. Always execute the actual SQL on a real client. SQL-text matching alone is not a race test.

Record the two backend PIDs, reached barrier, relevant statement family, observed wait/blocker and final outcomes. Bounded monitoring is permitted **inside the local test**; the prohibition on CI/Vercel polling does not prohibit observing a local lock. Do not rely on arbitrary long sleeps or only on a pending JavaScript promise. Release barriers promptly within existing lock/deadline limits and clean up in `finally`.

Keep production statement, lock and operation budgets unchanged. A test harness watchdog may detect a hang but must not replace the application's own timeout/rollback behaviour. Any timer or delayed query must be cancelled/settled before returning a released connection or starting the next scenario.

### Family A — prove each changed locking arm is effective

Run a targeted case for a qualifying protected stay and another for a qualifying protected commute.

- Transaction A holds the relevant segment-row lock in the disposable fixture, without taking an unnecessary coarse advisory lock that would mask the segment conflict.
- Transaction B executes the actual candidate replay/protected read.
- Verify that the relevant locking statement was reached and that the expected database transaction blocks it.
- Release A and verify correct completion or the existing bounded conflict outcome, with the protected record and lineage unchanged.

A raw SQL row lock is permitted for this lock probe. It is **not** a substitute for the genuine Review mutation races in Family B. Use a source that actually satisfies the protected predicate; a legitimately excluded open proposal cannot prove that a protected locking arm ran.

### Family B — real Review decision versus replay in both orders

Use an actual valid Review envelope and the real receipt-producing mutation service. Cover a supported stay correction and a supported commute confirmation/terminal action, based on the lock-path audit. Test both Review-first and replay-first schedules where they are reachable in normal operation.

Make the case meaningful: retained evidence must propose a changed client segment identity or a potentially obsolete open proposal whose handling could damage the explicit decision. Merely confirming an already protected, unchanged row is not enough.

- **Review-first:** let the genuine Review transaction reach its real locks/writes, pause before commit, and dispatch replay. Record where replay actually waits or continues. Commit the decision and inspect the complete final state.
- **Replay-first:** dispatch replay to the audited sensitive boundary, then begin the genuine Review action. Record the actual conflict/ordering and let the transactions settle under their existing contracts.

Do not hold both sides at barriers that manufacture an application deadlock absent from the normal lock order. Conversely, do not serialise both calls in the test or let a shared pool connection hide the race.

Required invariants:

- A successfully committed explicit decision is not overwritten, duplicated, resurrected or retired as obsolete by a stale replay.
- The canonical entry and receipt created by a successful confirmation remain explicitly linked, and repeating that same acknowledged request returns the existing result without a second entry.
- A losing stale mutation may return the existing documented conflict/retryable result; do not invent a success requirement that bypasses proposal validation.
- Manual/terminal bounds, IDs, actual lineage and receipts remain exact where protected.
- No candidate-only deadlock cycle or new unbounded wait is introduced. A bounded deadlock victim alone is not proof that the new locking arrangement is acceptable.

Use at least one relevant multi-ID or multi-batch mixed stay/commute case to exercise ordering, not only a one-row SQL shape.

### Family C — obsolete retirement cannot erase a concurrent decision

Exercise the materialised eligible-lineage read with a genuinely stale open proposal and a real competing decision. This may share a fixture with Family B, but its selection/materialisation boundary and final terminal protection must be observable.

Prove that expiry/owner/device/algorithm/provenance filters remain effective and that the separate retirement writes do not retire a decision that has committed successfully. Preserve the relation from old proposal to current/protected source; equal counts alone are insufficient.

## 6. Compare against actual base, and be honest about limits

Run the meaningful C20 schedules against the actual base `791e57ea3d806c1474407b7b3546d05a42bd0153` and the candidate using equivalent synthetic starting state. Do not call the existing test-only legacy benchmark adapter an exact-base race oracle: its iteration/statement behaviour may differ.

A detached base checkout or a transparently extracted exact-base test runner is permitted. Do not modify the baseline implementation to make results agree. Keep initial evidence, catalogue, processing time and logical source keys equivalent, while preserving raw snapshots.

If the base has the same harmful race, report **pre-existing**, show both traces and stop to resolve release relevance. Do not automatically approve it because it is old, or quietly repair it within this test task. If candidate-only, report regression and stop. If the required overlap never occurs, mark the test INCONCLUSIVE/FAIL rather than PASS.

The handoff should say which schedules were exercised and that no new deadlock was observed there. Do not claim universal deadlock freedom from a finite test suite.

## 7. Documentation and PR metadata

Create an explicit scope entry referencing this addendum and the owner's actual authorisation message. State that the exception was approved now, not before the original deviation. Do not fabricate a time or approval reference.

Reconcile every ambiguous `Checks run` block by actual commit/run. Preserve historical measurements and legitimate earlier results; identify the latest head's broad failure and separate focused retry. If a prior claimed PASS was simply incorrect, correct it explicitly.

Update any current architecture statement that still claims the candidate uses two sequential protected table requests. Describe the selected-profile exception accurately and retain the unchanged one-client/transaction/protection boundaries.

Refresh the PR body from the latest verified handoff. Remove stale current-head and database-NOT-RUN claims, without erasing historical limitations. Keep the PR draft. Updating this metadata is authorised in the implementation job; merge or deployment is not.

## 8. Finite validation and stopping point

1. Run focused tests while constructing the fixture. Record and fix harness mistakes; do not mislabel those as product defects.
2. Execute the defined C20 base/candidate schedules once after the fixture is valid. A single evidence-preserved retry is allowed for a demonstrated harness/environment anomaly, not to select a favourable race outcome.
3. Run affected local Location/Review/transaction validators once near handoff, including real receipt/protected-history/rollback coverage. Retain the existing second-lineage-batch proof.
4. Run the candidate's finite 13-measurement scalability matrix once on the final candidate. All 11 S1 cases must commit and meet the existing targets: first-success 100 ms median <=5,000 ms; every S1 <=5,500 ms and >=1,500 ms post-commit work budget. S3 adverse failure remains acceptable only with proved safe rollback and accurate capacity reporting.
5. Reuse the existing baseline performance report if baseline production code, fixture and measurement definitions have not changed; the **new C20 exact-base race run is still required**. Rerun the full base performance matrix only when comparability actually changed.
6. Perform one appropriate final broad validation pass: lint, typecheck, tests, build, docs validation (avoid duplicating it when already executed by lint), and `git diff --check`. Report a broad FAIL and isolated retry separately. Do not repair unrelated category UI/dependencies or repeatedly rerun everything for a green result.
7. Review files/status, commit and push to the existing draft PR, update its description, report and STOP. If C20 or scope/safety/performance fails, preserve evidence and hand off the draft with a clear NOT READY result, not approval.

No native build, TestFlight, hosted replay, staging promotion, production access, CI/Vercel polling, automatic Claude invocation, schema/trigger/index/region/timeout/rollout change, or merge.

## 9. Handoff and later independent review

Report exact base/previous/new heads; the scope authorisation reference; changed files; C20 cases with actual lock/wait/commit/receipt outcomes; base versus candidate findings; stage and timing evidence retained; performance gates; specialist and broad results; and NOT RUN items.

The later Claude review is a separate read-only job of the complete final diff against the parent plan **plus this approved addendum**. It must not treat scope authorisation as a substitute for concurrency correctness. If a new head is pushed, approval of any older head does not transfer.

## References

Repository references inspected at the starting head:

- `apps/web/src/lib/location/location-replay-service.ts`, especially `excludeProtectedReplacements` and `retireOpenReviewsForMissingSegments`.
- `docs/plans/location-replay-production-scalability-v1.md`, Sections 7.3, 11 (C19/C20/C27), and 12.4.
- `docs/investigations/2026-09-20-location-replay-production-scalability.md`, scoped and unscoped validation sections.

PostgreSQL 17 primary documentation for the test design:

- Transaction isolation: https://www.postgresql.org/docs/17/transaction-iso.html
- Explicit locks and deadlocks: https://www.postgresql.org/docs/17/explicit-locking.html
- Blocking-process observation: https://www.postgresql.org/docs/17/functions-info.html

These references inform test design. They do not establish that Dayframe's candidate is safe or that C20 has been run.
