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

The required database baseline was **NOT RUN**. The only permitted target is an explicit task-owned `*_test` database on `127.0.0.1:54323`; `DATABASE_URL` was unset, and both `nc`/`pg_isready` found no listener there. An existing `dayframe-postgis` container on default port `54322` was deliberately not used, and no infrastructure repair or database setup was attempted. The local host also reported critically low free disk space, so no disposable database recovery was started.

The fixture is deterministic and production-shaped by construction: S1 contains 56 episodes × 76 real location observations = 4,256 accepted eligible observations across seven days; S3 contains 112 episodes × 76 = 8,512. It mixes saved and unknown stationary episodes, finite Visits, significant-change and standard route observations, genuine episode transitions and saved-place catalogue rows. The validator seeds 12 manual stay segments and 4 manual commute segments as protected history after the initial replay. Actual derived stay/commute counts, protected-source fan-out, mutable/resolvable lineage count, schema/trigger fingerprint, query-plan fingerprints, before/after timings and logical fingerprints are **NOT RUN** because the verified database target was absent.

The finite 26-measurement base/candidate matrix, S0 real-PostgreSQL rollback, trigger execution, receipt/Review equivalence and concurrency evidence are therefore **NOT RUN**. No before/after driver-call, protection-probe, timeout-configuration, lineage-request, payload-byte or commit-headroom result is claimed. The missing target is the scope decision needed before any performance gate can be evaluated; the implementation does not increase timeouts, omit evidence, rewrite semantic stages or weaken targets.

## Checks run

- PASS — attachment title/ID verification, fresh-main advancement check and isolated feature worktree creation.
- PASS — focused web replay/batching/diagnostic suite: 4 files, 13 tests, rerun after the final boundary correction.
- PASS — `npm run typecheck -w @dayframe/web` and root `npm run typecheck`; the feature worktree’s pruned optional `expo-symbols` package was restored from the clean main install without a tracked dependency change.
- PASS — bounded batch row/UTF-8/oversized-row tests.
- PASS — validator target guard emits structured `NOT RUN` with no `DATABASE_URL` and does not create its PostgreSQL pool.
- NOT RUN — `npm run validate:location-v2-db`, `npm run validate:review-mutation-db`, `npm run validate:sync-transactions`, `npm run validate:location-reliability` and `npm run validate:location-replay-scalability`; all require the unavailable task-owned target for this handoff.
- PASS — final broad `npm run lint` (documentation/iOS-config checks included; two pre-existing web test-file warnings only), `npm run test` (mobile 1,238 passed; web 954 passed/3 skipped; shared 305 passed), `npm run build` and `npm run check:docs`.
- PASS — implementation-only `git diff --check`; the full staged check reports only the eight trailing-space Markdown hard breaks preserved byte-for-byte from the attached plan copy (lines 3–10), which were intentionally not rewritten.

No hosted credentials/data, default-port database, staging promotion, TestFlight, iOS validation, production replay, schema/trigger/region change, merge or CI/Vercel polling was used.
