# Location retained-replay production scalability V1

## Scope and source verification

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

Candidate S1 first-success 100 ms repeated median was `5,460 ms` (range `5,448–5,461 ms`), satisfying the duration/headroom gate for that profile. The full S1 gate still **FAILS**: stable 100 ms committed with only 577 ms remaining, changed-input 40 ms committed with 1,101 ms remaining and 5,942 ms duration, and changed-input 100 ms safely timed out before commit. S3 standard **PASS**; S3 adverse latency safely timed out before commit and is a capacity limitation. No timeout, target, fixture, protected row or semantic stage was changed to improve these results.

Candidate batch evidence stayed within production constants in every captured request: S1 protected batches `6`, max `2,048` IDs and `61,179` bytes; S3 protected batches `10`, max `2,048` IDs and `62,085` bytes; S1 lineage requests `3` first-success/`2` stable or changed-input, max `2,048` rows and `385,435` bytes; S3 lineage requests `5`, max `2,048` rows and `385,438` bytes. Base used 250-row legacy protected probes (S1 `36` batches, max `7,469` bytes; S3 `70`, max `7,719`) and 250-row legacy lineage inserts (S1 `18`/`16` requests for first/stable, S3 `35`). Candidate diagnostics asserted intended/prepared equality on every successful measured replay; the counter was never inferred from row counts.

The candidate second-batch rollback proof used S3: intended `8,489` links was asserted before injection; deletion dispatched; batch 1 executed; batch 2 reached and failed; exactly two lineage insert attempts were observed; semantic persistence and commit were not reached; max attempted batch was `2,048` rows/`385,435` bytes; pre-replay counts and the complete logical fingerprint including receipts matched exactly afterward. The existing S0 reliability validator also passed its executed-batch rollback and protected/manual/terminal checks.

The per-measurement logical fingerprints were emitted for both independently seeded owners. Their raw hashes are intentionally source/run-scoped because physical workspace/user/place/category IDs and volatile timestamps differ between independent copies; row counts, client segment/evidence identity, sequence/role maps, Review fields, entries and receipts were included in each hash. The rollback comparison is same-owner exact and passed. No hosted semantic equivalence or production outcome is claimed.

## Checks run

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
