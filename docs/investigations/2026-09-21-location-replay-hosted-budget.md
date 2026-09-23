# PR #206 — hosted upstream budget exhaustion

## Source, authority and scope

- Previous reviewed head: `4544a33dd27c6e8180860f9fd4403f1b94ed0930`.
- Base: `791e57ea3d806c1474407b7b3546d05a42bd0153`.
- Implementation commit: `51bff7d833ff6338cb4a8fccff99d1e205dd0f80`; subsequent changes are diagnostic presentation and this evidence/metadata, not additional runtime changes.
- Existing PR #206 and `fix/location-replay-production-scale` worktree reused.
- This separately requested diagnosis/fix follows the genuine signed-client staging failure, under the parent scalability plan and approved A1-C20 exception. Earlier local PASS records are unchanged, not staging acceptance.
- Verified disposable target: `127.0.0.1:54323/dayframe_saved_place_test`, PostgreSQL 17.11 / PostGIS 3.6.4. Restored env file required shell export (`set -a`); no credential values logged, no database recreation or hosted connection.

The change removes repeated timestamp parsing in the shared engine's measured
commute derivation path. It does not change engine policy/output, algorithm
version, server-effective `v2_review` profile selection, SQL, batch sizes,
locks, transaction ownership, triggers, schema or deadline/cleanup reserve.
The optimisation is shared pure computation, not a new profile/rollout selector;
existing callers keep identical output. No architecture contract changes.

## Authoritative staging failure (supplied, not rerun)

Request `bd2ff152-57f5-4c22-aa45-39b1990495cc`, exact source `4544a33`,
`dayframe-staging`, `v2_review`, genuine signed-client acknowledgement:
HTTP 503 / `operation_timeout`, `effect → lineage`, 7,000 ms server / 7,135 ms
client. All 43 uploads succeeded. No committed Review output; reported before/
after state unchanged. No production action.

The upload account reports 4,264 supplied observations (4,256 backlog + eight
witnesses); the authoritative runtime count is **4,271 eligible rows**. Do not
silently equate those counts or invent the identity of the seven additional rows.
Runtime output was 280 stays / 140 commutes, 4,200 intended lineage links,
2,048 prepared, one chunk started, none recorded completed. The supplied log
uses null for the missing completed counter. This is not a complete-link count.

The earlier hard-coded-cutover run remains invalid as acceptance evidence.
The corrected staging first-success **FAIL** remains open until a separate
hosted acceptance job succeeds on a new exact source.

## Mandatory stage comparison before implementation

Hosted values are the complete supplied structured record. Local before/after
columns are first-success S1 at 100 ms additional raw-call delay, including
500 ms request/auth allowance, on the approved local database. They are not
claims about the actual hosted network route or equivalent output cardinality.
All stages marked Yes completed; no timing is invented for unreached stages.

| Stage | Hosted ms | Completed | Hosted budget start → after | Local before ms | Local after ms |
| --- | ---: | --- | --- | ---: | ---: |
| request setup | 0 | Yes | not recorded | 0 | 0 |
| auth | 431 | Yes | not recorded | 502 (model) | 502 (model) |
| request body | 1 | Yes | not recorded | not modelled separately | not modelled separately |
| connection acquisition | 0 | Yes | 6568 → 6568 | 0 | 0 |
| transaction configuration | 349 | Yes | 6568 → 6219 | 409 | 408 |
| owner lock | 86 | Yes | 6219 → 6133 | 103 | 103 |
| evidence read | 641 | Yes | 6133 → 5492 | 138 | 134 |
| catalogue read | 174 | Yes | 5492 → 5318 | 206 | 204 |
| engine computation | **2034** | Yes | 5318 → 3284 | **281** | **117** |
| protected replacement | 545 | Yes | 3284 → 2739 | 324 | 323 |
| obsolete handling | 525 | Yes | 2738 → 2213 | 314 | 309 |
| stay persistence | **1040** | Yes | 2212 → 1172 | 229 | 223 |
| commute persistence | 409 | Yes | 1172 → 763 | 222 | 219 |
| lineage deletion | 260 | Yes | 763 → 503 | 105 | 106 |
| lineage insertion | 504 | **No** | **503 → not recorded** | 502 | 434 |
| semantic Review persistence | not reached | No | not recorded | 1425 | 1205 |
| transaction commit | not reached | No | not recorded | 101 | 104 |

The [machine-readable evidence](2026-09-21-location-replay-hosted-budget-evidence.json)
retains all local completed/start/after-budget fields, counters and measurements.
Hosted upstream SQL-labelled stages total about 4,029 ms before insertion,
but those stage times include guards, client work and network—not 4,029 ms of
proved PostgreSQL execution. Engine CPU is the largest single absolute stage.
Approximately 6,497 ms of the request had elapsed before insertion began.

## Diagnosis: what is established and what is not

1. **Established budget failure:** lineage inherited only 503 ms. Labelling the
   incident a slow lineage INSERT alone would misattribute it. No semantics or
   commit were reached. The started counter occurs before `JSON.stringify` and
   the guarded client call; that wrapper can configure timeouts and recheck the
   deadline before raw INSERT dispatch. The hosted record cannot distinguish
   time in a dispatched INSERT from transport/configuration/pre-dispatch expiry.
2. **Established avoidable CPU work:** `deriveCommutes` scanned all accepted
   evidence for boundary support and again for route points for each stay pair,
   parsing identical ISO timestamps each time. Local CPU sampling attributed
   about 167 ms of a 301 ms instrumented engine stage to commute derivation,
   principally those filters. This repeated conversion grows with evidence ×
   stay pairs; hosted had 280 stays, versus local S1's 112. The runtime engine
   stage also includes evidence mapping/validation, so not all its 2,034 ms can
   be attributed to these filters from this hosted log alone.
3. **Guard amplification:** hosted drops below the 3,000 ms full-cap threshold
   during protected lookup. Existing #202 safeguards then legitimately install
   smaller timeout settings before subsequent queries. With 280 stays, the
   unchanged 250-row segment cap also requires two lock and two upsert batches
   rather than S1's one of each. These are source-derived explanations for
   extra work, not measured hosted raw-query counts. No guard is bypassed.
4. **No measured reason to alter lineage shape:** rollback-contained local
   EXPLAIN of actual first-success statements took 49.645 / 48.218 / 3.519 ms
   for 2,048 / 2,048 / 160 links. JSONB function scans took 1.786 / 1.758 /
   0.126 ms. Trigger times sum to 40.830 / 39.290 / 2.849 ms, including real
   ownership and FK checks. This does not justify smaller batches, relaxed
   triggers or a different insertion representation. JSONB serialization and
   transport were not independently timed on hosted infrastructure.
5. **Other SQL:** local first-success evidence read 2.981 ms, three protected
   reads 0.272 / 0.079 / 0.040 ms, obsolete statements 0.025 / 0.013 / 0.008 ms,
   stay insert 4.060 ms (112 rows), commute insert 3.844 ms (56 rows), lineage
   deletion 0.010 ms. Actual local plans/index names/rows/loops and trigger
   costs are retained. Empty first-success relations can legitimately scan;
   there is no proved hosted bad plan or lock wait from this log.
6. **Unresolved hosted contributors:** actual execution plans, CPU allocation/
   cold-runtime cost, per-query waits, pooler behaviour and function/database
   topology were not measured. The 641 ms evidence read and remaining stay
   persistence excess cannot be causally isolated here. No new hosted calls,
   region changes, credentials or infrastructure fixes were attempted.

The corrected conversion cost is a demonstrated contributor to the largest
stage, **not proof of the complete hosted causal breakdown**. Earlier CPU
savings can leave time for lineage and avoid some near-budget guard calls;
whether they are sufficient for hosted semantics/commit and 1,500 ms headroom
remains a separate acceptance question. Do not extrapolate a hosted duration
by subtracting local CPU measurements or call this staging fixed.

## Smallest correction and exact-output checks

Compute one numeric timestamp array inside each `deriveCommutes` invocation and
index it in the two existing filters. Do not sort, window, deduplicate, change
endpoint comparisons, change latest-origin support, or cache across calls.
One additional O(N) array; evidence and segment objects remain unmodified.
The filters still scan their original arrays in original order. No SQL or
lineage change was needed, and no unrelated engine cleanup was attempted.

Focused regression coverage proves strict endpoints, original route ordering,
latest origin support, separate intervals, input immutability, no stale
cross-invocation cache, and one parse per unrelated observation rather than
one per observation/stay pair. An initial new test wrongly expected a commute
without route support; the existing policy correctly returned none. Only that
test expectation/type fixture was corrected, not policy.

Direct complete-output comparisons ran against the detached actual-base shared
engine. Git verified that shared source was identical between planning base
and previous head `4544a33`, so this is a valid pre-change engine oracle, not
the legacy SQL benchmark adapter. Full object equality passed:

| Input | Observations / stays / commutes | Before → after engine ms | Complete-output SHA-256 |
| --- | --- | --- | --- |
| S1 | 4256 / 112 / 56 | 278.181 → 135.629 | `1fc6382113e5257b9303a2f9ad1af273beb5d7932c95585bbdca009d0863e627` |
| changed input | 4257 / 112 / 56 | 297.450 → 112.846 | `a5e57d3f88caf8410409c4217cc0b908d2b81ba986cfb4b194b163a86b4facca` |
| additional high-segment diagnostic | 4271 / 233 / 140 | 357.281 → 63.099 | `98cfb17553082fccb74dcd5bdf91df264cf0a2c445ddd94f3b31db39ad30695c` |

These single local engine probes are not medians or hosted benchmarks. The
additional synthetic shape is **not an exact hosted reconstruction**: 233 stays
is below hosted 280 and does not cross its stay-batch boundary. A discarded
fixture-construction attempt using a 0.5 time scale yielded only 94/93 segments;
it was not used to shrink acceptance work. Its log remains at
`/private/tmp/pr206-0921-engine-equivalence-dense-final.log`. The retained 0.7
fixture and the original S1/S3 workloads are unchanged by that experiment.

Local diagnostic commands (approved exported test env required):

```sh
npm run validate:location-replay-scalability -- --source=candidate --diagnose-statements
npm run validate:location-replay-scalability -- --source=candidate --diagnose-statements --high-segment
```

They run the full real replay and EXPLAIN selected statements under rollback
savepoints, preserving actual triggers/constraints. Extra profiling/probe work
makes their stage timing **diagnostic, not acceptance timing**. Their raw-driver
counts are unmeasured/null; use the ordinary matrix for actual counts. Full
local CPU profiles/plans are retained under `/private/tmp/pr206-0921-*.log`.

## Finite performance results

Fresh previous-head S1: all 11 PASS; first-success 100 ms median 4,859 ms,
worst 5,465 ms, minimum remaining budget 1,535 ms. These are a new baseline
run, not replacements for the historical C20 4,604 / 5,387 / 1,613 results.

One final candidate matrix: **all 13 requests committed**, including every
required S1 semantic stage. Cells: duration / remaining work budget / raw calls.

| S1 scenario | 0 ms | 40 ms | 100 ms |
| --- | --- | --- | --- |
| first-success | 870 / 6130 / 33 | 2308 / 4692 / 33 | 4393 / 2607 / 34 |
| stable | 922 / 6078 / 31 | 2310 / 4691 / 31 | 4203 / 2798 / 31 |
| changed-input | 943 / 6057 / 35 | 2550 / 4450 / 35 | 5058 / 1942 / 39 |

Additional first-success 100 ms samples 4,585 and 4,567 ms (35 calls each).
Median **4,567 <=5,000 — PASS**, worst **5,058 <=5,500 — PASS**, minimum
remaining **1,942 >=1,500 — PASS**. First 100 ms sample calls 36→34 and
changed-input calls 41→39 versus the fresh previous-head run; fewer timeout
configurations arise naturally from saved CPU budget, not guard modification.
First 100 ms lineage time 502→434 ms is not an INSERT optimisation claim:
SQL is unchanged and local execution variance remains.

S3 standard commits at 1,283 ms / 5,718 remaining / 41 calls. S3 100 ms
commits at 6,975 ms / **26 ms remaining** / 54 calls. That single completion
is precarious capacity evidence, not an S1-equivalent headroom pass or a claim
that the earlier S3 safe-timeout limitation is universally resolved.

Intended=prepared for every committed measurement; completed batch counts equal
all dispatched batches (independently checked from the saved reports). Three S1
first-success lineage batches total 4,256 links; two stable/changed batches
total 3,861–3,864; S3 five batches total 8,512. All production item/byte caps
remain enforced, including three/five protected requests and exact lineage
order/role checks. Semantic/profile fingerprints agree for all three states.
Second-batch rollback again reaches deletion, first insert success and exactly
two attempts, then restores complete state without semantics or commit.

## Validation and handoff limits

- PASS — focused shared engine/arrival/timestamp tests: 3 files, 62 tests.
- PASS — explicit strict typecheck of the diagnostic validator. The final presentation-only null-counter adjustment initially failed TS2698 because `Object.entries` inferred an unknown stage; an object assertion corrected that local output path and the focused strict retry passed. The initial failure and corrected retry logs remain separate.
- PASS — `validate:location-reliability`, `validate:location-v2-db`, `validate:review-mutation-db`, `validate:sync-transactions`, once each, on the approved test target.
- PASS — unchanged C20 runner, candidate 8/8 at implementation commit; real blocked schedules, receipt-backed correction/confirmation, protected history, conflict and rollback checks retained. Prior exact-base C20 evidence remains applicable because no lock/SQL path changed.
- PASS — one final broad pass: `npm run lint` (including `check:docs` and static `check:ios-config`), `npm run typecheck`, `npm run test`, `npm run build`; no iOS build. Tests: mobile 1,238, web 958 (three skipped), shared 307. Lint retained two existing unused-variable warnings in `event-service.test.ts`; no errors. Mobile TS2307 did not occur. `git diff --check` passed. Final documentation alignment was checked again after recording these results; no broad or performance repeat.
- NOT RUN — new hosted acceptance, Vercel/CI polling, Claude, production, staging promotion, iOS, deployment or merge.

No staging success is claimed. Remaining acceptance is the separately authorised
preserved hosted fixture with real acknowledgement, genuine Review output,
complete lineage, zero automatic Location entries in `v2_review`, <=5,500 ms
representative duration and >=1,500 ms post-commit work budget.
