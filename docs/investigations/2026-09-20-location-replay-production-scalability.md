# Location retained-replay production scalability V1

## Authorised C20 addendum follow-up

The owner's current request explicitly authorises
`DF-PROD-REPLAY-SCALABILITY-A1-C20` at starting head
`19950c8c5078aa2eed80d770735cc29b487421fd`. See the
[unaltered addendum copy](../plans/location-replay-production-scalability-a1-c20.md)
and [C20 evidence ledger](2026-09-20-location-replay-c20.md).
This is new, conditional scope authorisation for the selected profile's combined
protected lookup and materialised eligible-lineage read, **not retrospective
approval** of their earlier deviation or a waiver of C20. The original parent
plan remains byte-identical; read it together with the addendum.

Run/head key: the performance follow-up below shipped in `19950c8`; its broad
test **FAIL** and separate focused retry **PASS** remain historical facts.
The older review-fix checks under `321dc7a` legitimately passed their broad test
run; they are not the latest broad result. The linked C20 ledger records this
job's new validation separately. No earlier PASS is silently transferred.

## Historical performance follow-up: `321dc7a` → `19950c8`

This section supersedes the historical failing handoff below. Exact planning/base
remains `791e57ea3d806c1474407b7b3546d05a42bd0153`; the same existing PR #206 and
`fix/location-replay-production-scale` worktree are used. Documentation impact:
server persistence/performance and local validation, not product policy.

### Validator-first evidence and measured decision

Every S1 measurement now independently asserts commit, duration <=5,500 ms and
post-commit work budget >=1,500 ms. The three first-success 100 ms samples must
also have median <=5,000 ms. A replay that commits but fails either budget bound
is reported FAIL, not PASS. Request timing stops after the transaction settles,
before validation snapshot reads. Local-only stage capture records elapsed time,
completion, starting/ending budget and raw driver calls; unreached stages are
explicitly incomplete. No production logging was expanded.

The once-only pre-optimization S1 run failed: first-success 100 ms median 5,402;
stable 100 ms 6,371/629 remaining; changed-input 40 ms 6,189/811 remaining;
changed-input 100 ms 7,004/no commit. The prior 5,460 ms median also **FAILS**
the <=5,000 ms criterion. Successful individual requests never implied plan
acceptance.

The measured dominant avoidable database costs were protected provenance
(stable 0 ms: 836 ms, six driver calls, 818 ms driver execution) and obsolete
handling (changed-input 0 ms: 1,817 ms, seven calls, 1,808 ms driver execution).
These costs grow only after lineage/Review history exists. PostgreSQL's
one-row owner estimates selected nested loops repeatedly scanning thousands of
owner evidence rows for each lineage row. At 100 ms latency the later unchanged
semantic work also incurred additional #202 near-budget timeout settings.

An intermediate SQL shape was rejected and its evidence retained: combining
protected requests helped first-success (median 4,799 ms), but stable still took
6,032 ms and splitting the obsolete existence test doubled its bad evidence
join, causing unchanged 3s statement-cap failures. One initial SQL syntax
attempt failed before measurements (`0A000`); this was not a performance sample.
Focused EXPLAIN probes, not repeated acceptance sampling, then isolated the
join problem. No statistics refresh, index, migration or infrastructure repair
was performed.

### Exact correction

- Protected queries share each bounded ID parameter across two locking
  subqueries in one request. Both keep their exact joins, manual/non-superseded/
  source-event/no-open-Review predicate, scope, ordered `FOR UPDATE OF s`, and
  occupied-portion filtering. A lateral unique-ID lookup with `OFFSET 0` as an
  optimization boundary prevents repeated owner-evidence scans; it is not a
  result limit. There are three S1 requests instead of six.
- Obsolete selection materializes eligible lineage once using the identical
  owner/device/algorithm/accepted/expiry predicates, then applies the original
  stay-or-commute provenance existence test. No Review/segment write is combined,
  omitted or moved outside the transaction.
- Both changes are selected only by the existing server-effective `v2_review`
  internal profile. Legacy query behavior, the shared engine, semantic emitter,
  lineage identity/order/bounds, #202 reuse and 8s/1s deadline contract are intact.

Final focused EXPLAIN execution: three protected requests 13.608/8.200/7.360 ms,
with one-row primary-key evidence lookups, and obsolete selection 40.960 ms.
The rejected shape's corresponding protected total was 858.770 ms and obsolete
selection 3,582.230 ms. These are local query probes, not whole-request claims.

### Stage-level before/after evidence

Each cell is **elapsed ms / raw calls / remaining budget start→after (ms)**.
These are the failing pre-change cases and their final matching scenarios.
All final S1 stages completed. The [machine-readable ledger](2026-09-20-location-replay-production-scalability-measurements.json)
preserves every S1/S3 measurement, all stage fields, fingerprints and rejected attempts.

| Stage | Stable 100 ms before | Stable 100 ms after | Changed 100 ms before | Changed 100 ms after |
| --- | --- | --- | --- | --- |
| connection acquisition | 0 / 0 / 6497→6497 | 0 / 0 / 6498→6498 | 0 / 0 / 6498→6498 | 0 / 0 / 6497→6497 |
| transaction configuration | 409 / 4 / 6497→6088 | 408 / 4 / 6498→6090 | 406 / 4 / 6498→6092 | 409 / 4 / 6497→6088 |
| owner lock | 103 / 1 / 6088→5985 | 102 / 1 / 6090→5988 | 102 / 1 / 6092→5989 | 102 / 1 / 6088→5986 |
| evidence read | 132 / 1 / 5985→5854 | 141 / 1 / 5988→5847 | 130 / 1 / 5989→5859 | 133 / 1 / 5986→5853 |
| catalogue read | 203 / 2 / 5853→5650 | 205 / 2 / 5847→5641 | 203 / 2 / 5859→5657 | 203 / 2 / 5853→5649 |
| engine computation | 291 / 0 / 5650→5359 | 273 / 0 / 5641→5368 | 276 / 0 / 5657→5381 | 268 / 0 / 5649→5381 |
| protected replacement checks | 1424 / 6 / 5359→3936 | 343 / 3 / 5368→5025 | 1503 / 6 / 5381→3878 | 359 / 3 / 5381→5022 |
| obsolete segment handling | 317 / 3 / 3936→3619 | 311 / 3 / 5025→4714 | 3166 / 13 / 3878→711 | 768 / 7 / 5022→4255 |
| stay persistence | 227 / 2 / 3617→3390 | 219 / 2 / 4713→4494 | 447 / 4 / 709→261 | 229 / 2 / 4253→4024 |
| commute persistence | 223 / 2 / 3390→3167 | 219 / 2 / 4494→4275 | 265 / 3 / 261→— (incomplete) | 218 / 2 / 4024→3806 |
| lineage deletion | 107 / 1 / 3167→3060 | 104 / 1 / 4275→4171 | not reached | 108 / 1 / 3806→3698 |
| lineage insertion | 436 / 3 / 3060→2624 | 312 / 2 / 4171→3859 | not reached | 327 / 2 / 3698→3371 |
| semantic review persistence | 1894 / 18 / 2624→731 | 957 / 9 / 3859→2902 | not reached | 1478 / 14 / 3371→1893 |
| transaction commit | 102 / 1 / 731→629 | 103 / 1 / 2902→2799 | not reached | 103 / 1 / 1893→1790 |

### Final base-adapter comparison

The baseline adapter is explicitly not an exact-base checkout or a candidate
profile claim. It retains legacy persistence SQL and the existing Review emitter
and #202 transaction owner. Its 13 measurements completed; nine requests failed
and their pre/post logical state was unchanged. Adapter-run PASS means the
measurement run finished, not that legacy performance passed S1 acceptance.

| Base adapter case | Delay ms | Duration ms | Calls | Commit / remaining ms |
| --- | ---: | ---: | ---: | --- |
| S1 first-success | 0 | 1138 | 81 | yes / 5863 |
| S1 first-success | 40 | 5046 | 92 | yes / 1954 |
| S1 first-success | 100 | 7004 | 61 | no / — |
| S1 stable | 0 | 6916 | 132 | yes / 84 |
| S1 stable | 40 | 7002 | 45 | no / — |
| S1 stable | 100 | 7003 | 30 | no / — |
| S1 changed-input | 0 | 7002 | 66 | no / — |
| S1 changed-input | 40 | 7002 | 110 | no / — |
| S1 changed-input | 100 | 7002 | 30 | no / — |
| S1 first-success | 100 | 7001 | 61 | no / — |
| S1 first-success | 100 | 7002 | 61 | no / — |
| S3 first-success | 0 | 2034 | 136 | yes / 4966 |
| S3 first-success | 100 | 7000 | 53 | no / — |

### Final candidate acceptance

All 11 mandatory S1 measurements PASS, complete semantic persistence and commit.
S1 retains 4,256 observations, 112 stays/56 commutes and 148 Reviews at first
success; stable/changed fixtures retain 16 deliberately manual/protected sources.

| S1 case | 0 ms: duration / remaining / calls | 40 ms: duration / remaining / calls | 100 ms: duration / remaining / calls |
| --- | --- | --- | --- |
| First-success | 1,034 / 5,966 / 33 | 2,449 / 4,551 / 33 | 4,623 / 2,377 / 35 |
| Stable | 1,030 / 5,970 / 31 | 2,400 / 4,600 / 31 | 4,201 / 2,799 / 31 |
| Changed-input | 1,053 / 5,947 / 35 | 2,580 / 4,420 / 35 | 5,209 / 1,790 / 40 |

First-success 100 ms additional samples: 4,626/2,374 remaining and 4,631/2,369
remaining, both 35 driver calls. Median **4,626 ms — PASS**. Worst S1 duration
**5,209 ms — PASS**; minimum post-commit budget **1,790 ms — PASS**.
S3 0 ms commits in 1,859 ms, 41 calls, 5,141 ms remaining. S3 100 ms fails safely
at 7,005 ms/50 attempted calls during semantics: no commit, exact pre/post logical
fingerprint and row counts preserved. This remains a permitted capacity limit.

S1 protected requests: three, <=2,048 IDs, max 61,179 bytes; S3: five, max
62,085 bytes. Lineage: S1 first-success 4,256 intended=prepared, three requests;
stable 3,862–3,864 and changed-input 3,863 intended=prepared, two requests.
S3 8,512 intended=prepared, five requests (including the later rolled-back
adverse-latency request). Every batch <=2,048 items; max S1 JSON 385,435 bytes,
max S3 385,438 bytes. Production byte/item constants are imported and asserted.
S1 timeout-configuration calls: three at 0/40 ms; at 100 ms, five first-success,
three stable, eight changed-input. No timeout configuration was suppressed.

Same-input profile comparisons use an untimed owner-locked/savepoint semantic
oracle, not a relaxed performance deadline. Both profiles start from identical
input/category/protection state; all three logical fingerprints match:

- First-success: `d11520558b3e9e13408b507145973d3bc42df14ca6a14a56a2a8fa1b28663682`.
- Stable: `bd0e7c422f135fe220b19668e3739152f9723efc1e91e03dc277b99fe42ff106`.
- Changed-input: `2477d463c611832dfab836003fb04ccd0d513f57ba76f74f753431bc2b7113fe`.

The S3 second-lineage-batch fault again proves deletion, first batch success,
exactly two insertion attempts, second batch failure and full rollback before
semantics/commit: 8,489 intended links, 4,096 prepared at the fault, exact
pre/post counts and fingerprint including protected state/receipts. Performance
samples remain separate from the existing **85 ms TOTAL-deadline** test.

Hosted recovery and production repair are not established by these local results.
The unchanged schema fingerprint is
`cf931925bbe1a65e3140de651c734d9cd044794dabf6216fab54d6ae17914eb9`.

### Checks for the follow-up committed as `19950c8` (historical run)

- PASS — candidate acceptance: all 11 S1 cases and S3 standard, real PostgreSQL
  ownership triggers, imported batch bounds, intended/prepared equality,
  same-input logical fingerprints and reached second-batch rollback. S3 100 ms
  request FAIL is a permitted capacity limitation with rollback verified.
- PASS — base-adapter runner completed all 13 cases; nine legacy request FAILs
  are retained, not candidate acceptance claims. This is the existing adapter,
  not an independently executed checkout of planning main.
- PASS — `npm run validate:location-reliability`, `npm run validate:location-v2-db`,
  `npm run validate:review-mutation-db`, `npm run validate:sync-transactions`.
  These exercise protected/manual/terminal rows and link UUIDs, receipts and
  Quick Confirm, changed-ID protection, workspace/user/device isolation,
  ownership/constraint failures, real contention, cancellation and rollback.
  The 85 ms total-deadline case timed out at 87 ms with unchanged lineage.
- PASS — S0 lineage hash
  `2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899`
  and segment/semantic hash
  `79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3`
  retain their existing assertions.
- PASS — final focused replay/batching tests: two files, eight tests; focused
  lint on changed replay files. The SQL regression checks both locking arms,
  scope/protection predicates, bounded parameter sharing, unique evidence
  lookup and unchanged expiry/provenance conditions. Real-DB profile equivalence
  covers first-success, stable and changed-input state.
- PASS — one broad `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm run check:docs`, and `git diff --check`. No mobile TS2307 occurred.
  Broad lint had two existing event-service test warnings plus two new unused
  mock argument warnings; the latter were removed by a test-only signature
  cleanup and checked with focused lint/tests afterward.
- FAIL — one broad `npm run test`: mobile 1,238 passed; shared 305 passed;
  web 957 passed, three skipped, one failed. The category-picker DOM test at
  line 151 could not find its Create new category dialog after Escape.
  Its component/test and web dependency/lockfile state are unchanged from base.
  The single permitted isolated retry **PASS** (six tests); the broad result
  remains FAIL. No unrelated UI or dependency repair was made.
- NOT RUN — CI/Vercel polling, independent review, hosted/staging/production
  acceptance, deployment, merge, regions/schema changes and iOS/TestFlight.

The semantic oracle uses the existing logical projection with client identity
keys; it is not a raw-UUID equality claim for newly inserted rows on rolled-back
savepoint branches. Protected physical rows/links and real durable receipts have
separate specialist assertions. Synthetic driver delay and the fixed 500 ms
request/auth allowance are a local request model, not measured hosted topology.
The three existing Important fixes remain intact; no further stage, rollout or
timeout changes were made after S1 passed.

## Historical initial implementation / review-fix evidence (`168f622` / `321dc7a`)

The following scope verification originated with `168f622`; the measurements
and checks below were completed in the review-fix pass committed as `321dc7a`.
They do not describe the newer `19950c8` or addendum validation runs.

### Scope and source verification

- Plan title: `Dayframe — Production retained-replay scalability V1`.
- Plan ID: `DF-PROD-REPLAY-SCALABILITY-V1`.
- The attachment was verified from `/Users/major/Downloads/dayframe-production-replay-scalability-plan-v1.md` and copied byte-for-byte to `docs/plans/location-replay-production-scalability-v1.md` (SHA-256 `4b76623f95effdfc3945c3b5f16d61e57ea0742015bcf3a5ecb42c97ce0dea66`).
- The planning main advanced from `9ceb944dddf156d7dd87afe5aef4066b877a7ce2` to fresh `origin/main` `791e57ea3d806c1474407b7b3546d05a42bd0153` through the documentation-only PR #205. The isolated worktree is `fix/location-replay-production-scale`, based exactly on `791e57ea3d806c1474407b7b3546d05a42bd0153` before implementation changes.
- This record covers Sections 1–16 only. Review, staging, production and release sections remain separate jobs.

## Implemented scope

- Server-effective `v2_review` selects the internal `review_scalability_v1` persistence profile; request-visible rollout/profile input is not added and #202 timeout-pair reuse is unchanged.
- Protected provenance keeps the existing SQL joins, ownership predicates, occupied-portion rules, deterministic ordering and `FOR UPDATE OF s` locks, while using a dedicated sequential candidate-ID batcher capped at 2,048 IDs or 512 KiB of UTF-8 JSON-array representation.
- Mutable lineage deletion remains a separate awaited statement. The new profile streams typed rows into sequential `jsonb_to_recordset` inserts capped at 2,048 links or 1 MiB UTF-8 JSON, preserving owner parameters, sequence indexes, roles, conflict behavior, skips and unresolved commute endpoints. Segment and semantic batches remain 250.
- The existing server-only diagnostics whitelist gains exactly three aggregate counters: `protectionEvidenceIds`, `protectionQueryBatches` and `lineageLinksIntended`. The cumulative meaning of `lineageLinksPrepared` is retained.
- The S0 rollback seam now fails after a real lineage write has executed, so the enlarged first batch cannot make the test a false pass.
- A finite local validator and production-shaped fixture were added for base/candidate replay through semantic persistence and commit. It applies a 500 ms request/auth cost, 0/40/100 ms raw-driver delay, an 8,000 ms absolute deadline and 1,000 ms cleanup reserve, and refuses non-loopback, wrong-port, non-`_test` or implicit database targets.

## Baseline and measurement ledger

The required database baseline and candidate matrix ran against the explicitly approved task-owned target only: `127.0.0.1:54323/dayframe_saved_place_test`, PostgreSQL `17.11` (`170011`), PostGIS `3.6.4`. The validator rejected implicit, hosted, wrong-port and non-`_test` targets before importing the application runtime. Default port `54322`, hosted credentials/data and infrastructure repair were not used.

The fixture is deterministic and production-shaped by construction: S1 contains 56 episodes × 76 real location observations = 4,256 accepted eligible observations across seven days; S3 contains 112 episodes × 76 = 8,512. It mixes saved and unknown stationary episodes, finite Visits, significant-change and standard route observations, genuine episode transitions and saved-place catalogue rows. Fresh first-success output derived to 112 stays/56 commutes/148 Reviews/4,256 lineage links for S1 and 224/112/261/8,512 for S3. Stable candidate replay intended 3,862–3,864 mutable links after protected history; changed-input intended 3,863.

The real local schema evidence was identical for both sources: five ownership triggers, 17 relevant indexes and schema fingerprint `cf931925bbe1a65e3140de651c734d9cd044794dabf6216fab54d6ae17914eb9`. Base query-plan fingerprints were protected `0dfa8f2c005f8043de8e5cfcb3facbb9a4bca837e3f18b6d4b71e3f7a7983c1c` / lineage `708822a23216d7b4faef3f15a09c1e913a25a71c99dd109e34bf082f19199f40`; final candidate fingerprints were protected `f9ce092b75080900e8e8a5ae56fdea26427d0c60a4593cc490e8450f2e800989` / lineage `74f49216cf03481c5c9525caa8e5098d83aecd8729519e184a912eb71409783d`. EXPLAIN hashes include planner/timing output and are source/run evidence, not semantic identity.

### Post-fix finite matrix

Base uses the test-only legacy adapter; candidate forces process-local server-effective `v2_review` and therefore selects `review_scalability_v1`. Both keep the 500 ms request/auth cost, 8,000 ms deadline, 1,000 ms cleanup reserve and 0/40/100 ms raw-driver delay matrix. `PASS` below means the individual replay committed; the candidate handoff gate additionally requires the S1 duration/headroom limits.

| Workload/state/delay | Base: duration / driver calls / commit / remaining | Candidate: duration / driver calls / commit / remaining | Candidate lineage intended=prepared |
| --- | ---: | ---: | --- |
| S1 first-success 0 ms | 1,659 / 81 / yes / 5,374 | 1,094 / 36 / yes / 5,934 | 4,256=4,256 |
| S1 first-success 40 ms | 5,954 / 98 / yes / 1,079 | 2,657 / 36 / yes / 4,384 | 4,256=4,256 |
| S1 first-success 100 ms | 7,044 / 60 / no | 5,461 / 42 / yes / 1,584 | 4,256=4,256 |
| S1 stable 0 ms | 6,699 / 130 / yes / 323 | 1,868 / 34 / yes / 5,152 | 3,862=3,862 |
| S1 stable 40 ms | 7,041 / 97 / no | 3,303 / 34 / yes / 3,728 | 3,864=3,864 |
| S1 stable 100 ms | 7,024 / 30 / no | 6,466 / 44 / yes / 577 | 3,862=3,862 |
| S1 changed-input 0 ms | 7,029 / 66 / no | 3,519 / 38 / yes / 3,502 | 3,863=3,863 |
| S1 changed-input 40 ms | 7,023 / 46 / no | 5,942 / 57 / yes / 1,101 | 3,863=3,863 |
| S1 changed-input 100 ms | 7,026 / 30 / no | 7,039 / 36 / no | not reached after safe rollback |
| S1 first-success 100 ms sample 2 | 7,033 / 60 / no | 5,460 / 42 / yes / 1,583 | 4,256=4,256 |
| S1 first-success 100 ms sample 3 | 7,030 / 60 / no | 5,448 / 42 / yes / 1,597 | 4,256=4,256 |
| S3 first-success 0 ms | 2,131 / 136 / yes / 4,909 | 1,890 / 46 / yes / 5,144 | 8,512=8,512 |
| S3 first-success 100 ms | 7,145 / 54 / no | 7,032 / 50 / no | 8,512 prepared before semantic timeout |

Candidate S1 first-success 100 ms repeated median was `5,460 ms` (range `5,448–5,461 ms`), which **FAILS** the <=5,000 ms median criterion. Individual request success is not equivalent to plan acceptance. The full S1 gate also **FAILS**: stable 100 ms committed with only 577 ms remaining, changed-input 40 ms committed with 1,101 ms remaining and 5,942 ms duration, and changed-input 100 ms safely timed out before commit. S3 standard **PASS**; S3 adverse latency safely timed out before commit and is a capacity limitation. No timeout, target, fixture, protected row or semantic stage was changed to improve these results.

Candidate batch evidence stayed within production constants in every captured request: S1 protected batches `6`, max `2,048` IDs and `61,179` bytes; S3 protected batches `10`, max `2,048` IDs and `62,085` bytes; S1 lineage requests `3` first-success/`2` stable or changed-input, max `2,048` rows and `385,435` bytes; S3 lineage requests `5`, max `2,048` rows and `385,438` bytes. Base used 250-row legacy protected probes (S1 `36` batches, max `7,469` bytes; S3 `70`, max `7,719`) and 250-row legacy lineage inserts (S1 `18`/`16` requests for first/stable, S3 `35`). Candidate diagnostics asserted intended/prepared equality on every successful measured replay; the counter was never inferred from row counts.

The candidate second-batch rollback proof used S3: intended `8,489` links was asserted before injection; deletion dispatched; batch 1 executed; batch 2 reached and failed; exactly two lineage insert attempts were observed; semantic persistence and commit were not reached; max attempted batch was `2,048` rows/`385,435` bytes; pre-replay counts and the complete logical fingerprint including receipts matched exactly afterward. The existing S0 reliability validator also passed its executed-batch rollback and protected/manual/terminal checks.

The per-measurement logical fingerprints were emitted for both independently seeded owners. Their raw hashes are intentionally source/run-scoped because physical workspace/user/place/category IDs and volatile timestamps differ between independent copies; row counts, client segment/evidence identity, sequence/role maps, Review fields, entries and receipts were included in each hash. The rollback comparison is same-owner exact and passed. No hosted semantic equivalence or production outcome is claimed.

## Checks run for review-fix head `321dc7a59b85d6be29f60a7ebd17ac997866f395`

- PASS — attachment title/ID verification, fresh-main advancement check and isolated feature worktree creation.
- PASS — focused web replay/batching/diagnostic suite: 4 files, 14 tests, including exact ASCII boundary, UTF-8, caps, flush and actual JSON-byte checks.
- PASS — `npm run typecheck -w @dayframe/web` and root `npm run typecheck`; the feature worktree’s pruned optional `expo-symbols` package was restored from the clean main install without a tracked dependency change.
- PASS — bounded batch row/UTF-8/oversized-row tests.
- PASS — validator target guard emits structured `NOT RUN` with no `DATABASE_URL` and does not create its PostgreSQL pool.
- PASS — `npm run validate:location-v2-db`, `npm run validate:review-mutation-db`, `npm run validate:sync-transactions` and `npm run validate:location-reliability` on the approved `54323` target.
- PASS — base `npm run validate:location-replay-scalability -- --source=base` completed all 13 measurements and recorded legacy timeout outcomes.
- FAIL — candidate `npm run validate:location-replay-scalability -- --source=candidate` completed all 13 measurements and the second-batch rollback proof, but missed the declared S1 1,500 ms headroom/5,500 ms duration gates and safely timed out in S1 changed-input 100 ms; S3 adverse latency is a recorded capacity limitation.
- PASS — final broad `npm run lint` (documentation/iOS-config checks included; two pre-existing web test-file warnings only), `npm run test` (mobile 1,238 passed; web 957 passed/3 skipped; shared 305 passed), `npm run build` and `npm run check:docs`.
- PASS — final `git diff --check`.

No hosted credentials/data, default-port database, staging promotion, TestFlight, iOS validation, production replay, schema/trigger/region change, merge or CI/Vercel polling was used. The candidate gate miss is the smallest scope decision needed before hosted acceptance; this job does not authorize further optimization, timeout changes or rollout changes.
