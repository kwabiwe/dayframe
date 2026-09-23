# PR #206 — authorised C20 evaluation

## Authority and exact source

Owner authorisation is the current request: “I authorise addendum
DF-PROD-REPLAY-SCALABILITY-A1-C20 for existing Dayframe PR #206.” It explicitly
allows evaluation and **conditional retention** of the existing combined
`UNION ALL`/`LATERAL` protected lookup and materialised eligible-lineage read.
Approval occurred in this request, not before the implementation deviation.
It does not approve the PR, waive C20, or authorise other optimisation work.

- Parent: [DF-PROD-REPLAY-SCALABILITY-V1](../plans/location-replay-production-scalability-v1.md), unchanged original copy.
- Governing exception: [DF-PROD-REPLAY-SCALABILITY-A1-C20](../plans/location-replay-production-scalability-a1-c20.md), original attachment preserved including its historical “Proposed” status; this entry records actual authorisation.
- Exact base: `791e57ea3d806c1474407b7b3546d05a42bd0153`.
- Starting candidate/PR head: `19950c8c5078aa2eed80d770735cc29b487421fd`, verified before editing; existing draft/branch/worktree reused.
- Exact-base application and shared code ran from detached `/private/tmp/dayframe-c20-base.yWtQap`. No benchmark adapter or baseline implementation edits were used for C20.
- The runner verifies the base hash, clean application/shared source and runtime's own shared-package resolution. Candidate production source remains identical to the starting head throughout this job.
- Only approved `127.0.0.1:54323/dayframe_saved_place_test` via the private supplied env file: PostgreSQL 17.11 / PostGIS 3.6.4. No recreation, schema/trigger change, hosted credentials or infrastructure repair.

Documentation impact: test guardrail and explicit architecture/scope clarification;
no product policy, runtime implementation, schema or mobile change.

## Lock audit before test implementation

Actual entry points are `replayRetainedLocationEvidence` and
`resolveIdempotentReviewMutation`. Base and candidate Review mutation,
Location Review and transaction-owner source are identical.

| Path | Actual ordering / conflict |
| --- | --- |
| Replay | blocking owner advisory lock → evidence/catalogue/engine → protected segment `FOR UPDATE OF s` → obsolete open Review selection `FOR UPDATE OF ri` and separate retirement writes → ordered segment locks/upserts → separate lineage delete/inserts → semantic Review writes → commit |
| Durable Review | receipt read → nonblocking mutation advisory lock → receipt read → nonblocking **same owner** advisory lock → Review/event `NOWAIT` locks ordered by Review ID → stay then commute `NOWAIT` locks ordered by segment ID → decision/entry writes → durable receipt → commit |
| Supported stay action | actual `change_place_and_confirm` envelope, place correction plus entry and durable receipt; segment becomes manual and Review accepted |
| Supported commute action | actual `confirm` envelope with proposal hash; manual/terminal segment, entry and durable receipt; no invented commute edit |

The common owner lock prevents the supported Review path from reaching segment
locks concurrently with replay. Review-first therefore blocks replay on that
owner lock. Replay-first returns the existing `review_item_locked / owner_busy`
without a wait; forcing Review to wait on a segment would not model this path.
Raw row-lock holders **without** the owner lock separately test each protected
arm. Textual `UNION ALL` order and per-arm ordering alone are not safety proof.

READ COMMITTED statement snapshots differ between the former two requests and
the combined request. For these supported decisions, owner-lock acquisition
serialises writers before either protected/obsolete read; after Review commits,
replay's subsequent statements see its decision. The finite tests verify that
claim for the exercised paths, not arbitrary direct SQL writers or all schedules.
The read-only materialised CTE does not combine any retirement writes.

## C20 execution and comparison

Runner: `scripts/validate-location-replay-c20.ts`, using real SQL through local
pool adapters, distinct backend PIDs, completion/commit barriers, and bounded
read-only `pg_stat_activity` / `pg_blocking_pids` observation. Application
timeouts, isolation, owner namespace and cleanup reserve are unchanged.

Commands (source only the approved private env first):

```sh
npm exec -- tsx scripts/validate-location-replay-c20.ts --source=base --runtime-root=/private/tmp/dayframe-c20-base.yWtQap
npm exec -- tsx scripts/validate-location-replay-c20.ts --source=candidate
```

Each source executed eight schedules once, followed by the single permitted
evidence-preserved harness-correction retry described below. Each fixture has 228
mixed stay/commute observations plus one earlier first witness, three journeys,
multiple provenance IDs and independently generated task-owned physical rows.
The shared engine must propose a different target client identity before the
test proceeds. This is C20's deterministic race fixture, not a reduction of the
unchanged 4,256/8,512-observation performance workloads.

| Schedule, separately for stay and commute | Exact base | Candidate | Observed database/final result |
| --- | --- | --- | --- |
| A: protected segment lock probe | PASS | PASS | target locking request dispatched; `transactionid` wait blocked by raw holder PID; after release replay commits and exact protected state/lineage remains |
| B/C: Review receipt written, paused before commit | PASS | PASS | replay visibly waits on `advisory`; Review commits; replay commits, excludes decision from obsolete selection and preserves raw segment/event/Review/entry/receipt/lineage snapshot |
| B: replay after protected read | PASS | PASS | actual owner lock granted; distinct Review backend returns `owner_busy`; replay commits retirement; stale retry gets existing `resolution_conflict`, no entry or receipt |
| C: replay at actual obsolete-selection boundary | PASS | PASS | target actually selected; same supported owner conflict, replay retirement and stale retry; no falsely claimed row-lock wait |

Acknowledged successful envelopes were repeated and returned the existing result
without a second entry or snapshot change. Every expected blocked schedule
required an observed database blocker; an unreached overlap fails the test.
Both obsolete arms also passed positive controls and six real-SQL negative
predicate probes: expiry, device, algorithm, accepted, provenance and owner.
These probes run in rolled-back fixture savepoints on the exact selected-source
statement before the race barrier; they are not represented as concurrency tests.

Actual `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans are retained. Base has
separate protected locking statements; candidate has an Append with both locking
arms and unique evidence-ID lookup. Candidate obsolete selection uses the
materialised eligible-lineage subplan. The plans are evidence of the local
execution, not reliance on text order as a global guarantee.

[Final C20 evidence](2026-09-20-location-replay-c20-correction-evidence.json)
contains PIDs, barriers, wait/blocker traces, physical identity/bounds/lineage
projections, full raw-snapshot hashes and flattened actual plans. Full raw
snapshots/plans remain in `/private/tmp/df206-c20-{base,candidate}-correction.log`.
Random owner/place/physical IDs make cross-source raw hashes different by design;
the comparison is identical asserted decisions, relationships, protected physical
state within each run and conflict outcomes, not a false raw-hash equality claim.
The separate performance validator retains its whole-engine logical oracle.

The eight-case base/candidate logical decision/conflict/bounds/lineage
sequence-role projections were also compared directly and are equal: SHA-256
`c0c92de4237f2d73a3888b4b20f664a184eecfa0d1d0031b407b5afdb05a259c`.
This limited projection is not a whole-database fingerprint; exact physical
protected-state preservation is asserted separately within each run.

Construction evidence is preserved separately: initial candidate fixture failed
before a race because its final witness did not change the selected identity;
switching to an earlier first witness corrected the fixture, then eight
construction schedules passed. Logs: `/private/tmp/df206-c20-construction.log`
and `/private/tmp/df206-c20-construction-2.log`. Post-run snapshot review then
found that the first final pair used a change-place envelope selecting the
original place. Those lock/conflict checks passed but did not prove a genuine
place correction. [Original traces and target snapshots](2026-09-20-location-replay-c20-evidence.json)
and full `/private/tmp/df206-c20-{base,candidate}-final.log` logs are preserved.
The runner now requires a different place before injection and verifies it after
commit. The **single permitted harness-correction retry** passed all eight
schedules on each source, including that real correction. No further C20 retry
was made. These are not product races or performance acceptance retries.
No harmful base/candidate race or new deadlock
was observed in the final exercised schedules. **This is not universal deadlock
proof.** No safety correction or production optimisation was made.

## Final validation

Results recorded below belong to this addendum job, on unchanged `19950c8`
production source plus the new local runner/docs. Earlier broad PASS at
`321dc7a`, broad category-picker FAIL at `19950c8`, and its focused six-test PASS
remain separately recorded in the [historical ledger](2026-09-20-location-replay-production-scalability.md).

- PASS — exact-base C20 8/8 and candidate C20 8/8; 12 predicate checks per source.
- PASS — focused runner TypeScript check with repository-equivalent strict mode.
  A preliminary ad hoc non-strict command produced discriminated-union narrowing
  errors; strict mode passed without changing the tested runner.
- PASS — once each: `npm run validate:location-reliability`, `npm run validate:location-v2-db`, `npm run validate:review-mutation-db`, `npm run validate:sync-transactions`.
- PASS — one final 13-measurement candidate performance matrix; all 11 mandatory
  S1 measurements committed through semantic persistence. See detailed results
  below. Base performance reused only because production source, fixture and
  measurement definitions are unchanged; the exact-base C20 run above is new.
- PASS — one broad `npm run lint` (includes `npm run check:docs`),
  `npm run typecheck`, `npm run test`, `npm run build`. Lint retains only two
  pre-existing event-service test warnings. No `expo-symbols` TS2307 occurred.
  Mobile 1,238 passed; web 958 passed / three skipped; shared 305 passed.
  This new broad PASS does not erase the historical `19950c8` broad FAIL or
  turn its focused retry into a broad PASS. No category UI/dependency repair.
- PASS — final runner strict TypeScript check after the fixture correction;
  final diff whitespace and documentation-link review.
- NOT RUN — hosted acceptance, independent external review, CI/Vercel polling,
  staging/production, iOS/TestFlight, deployment or merge, all outside this job.

### Single final candidate performance run

[Full measurements](2026-09-20-location-replay-c20-performance.json) retain
stage elapsed/completed/starting and ending budget, driver counts, payload
bounds, semantic/commit results, rollback proof and logical fingerprints.
No production performance code was changed in this job.

Each S1 cell is **duration / post-commit work budget / raw driver calls** (ms).

| Scenario | 0 ms | 40 ms | 100 ms |
| --- | --- | --- | --- |
| First success | 1,029 / 5,971 / 33 | 2,452 / 4,548 / 33 | 4,604 / 2,396 / 35 |
| Stable | 1,054 / 5,946 / 31 | 2,472 / 4,529 / 31 | 4,426 / 2,574 / 32 |
| Changed input | 1,103 / 5,896 / 35 | 2,606 / 4,394 / 35 | 5,387 / 1,613 / 41 |

Additional first-success 100 ms samples: 4,794 / 2,206 / 36 and
4,601 / 2,399 / 35. Median **4,604 <= 5,000 — PASS**. Worst S1
**5,387 <= 5,500 — PASS**; minimum remaining work budget
**1,613 >= 1,500 — PASS**, with only 113 ms margin against those last two gates.
No timeout, fixture, protection, semantic or rollout threshold was relaxed.

S3 standard: 1,814 ms, 5,186 ms remaining, 41 calls, commit PASS.
S3 100 ms: 7,004 ms, 50 attempted calls, no commit, exact logical rollback
PASS; the request itself **FAILS**, a permitted capacity limitation.

S1 protection: three batches, maximum 2,048 IDs / 61,179 bytes. S3:
five batches, maximum 2,048 IDs / 62,085 bytes. S1 lineage: three requests
for first-success (4,256 intended = prepared); two for stable (3,860–3,862)
and changed input (3,863). S3: five requests, 8,512 intended = prepared.
Every completed candidate measurement preserves intended/prepared equality;
maximum lineage batch 2,048 items, 385,435 bytes S1 / 385,438 bytes S3.
All imported production item/byte caps pass.

Second-batch rollback: 8,489 intended links (>2,048), lineage deletion reached,
first insert executed, exactly two insert attempts, second failed, no semantics
or commit; 4,096 prepared at injection, complete pre/post state restored.
The separate existing **85 ms TOTAL-deadline** specialist test timed out at
86 ms with safe rollback; it is not the synthetic 100 ms per-call model.

Same-input base-profile/candidate logical oracle fingerprints match:

- First-success: `b6a5fc156bb7106aa1ec1679364dbedb6ea12dc0be25cb6c96561cbf4913be5b`.
- Stable: `793490795392b88f742bbbf7546f37554c3c3b45f8901318014bc869df0285c7`.
- Changed-input: `8d68d143a60860886c846dac4bc388df634598e3226cd32bc413566fbdd4c5f4`.

Those are same-input profile comparisons, not the exact-base C20 oracle. Prior
base-adapter performance remains explicitly labelled in the historical ledger
(nine failed requests in its 13-case run); it is not rerun or renamed exact-base.
Schema fingerprint remains
`cf931925bbe1a65e3140de651c734d9cd044794dabf6216fab54d6ae17914eb9`;
all five required ownership triggers are present. Hosted latency/topology,
universal deadlock freedom and production recovery are **not established**.
