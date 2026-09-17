# Location replay performance V1 implementation evidence

## Scope and identity

This focused correction starts from fresh main
cf23168966e69abf2f3dfe853f806b9721e49db6 on branch
fix/location-replay-performance. The isolated worktree is
/Users/major/Projects/dayframe-location-replay-performance. The TestFlight
worktree and merged feature branches were not reused.

The implementation changes only the existing transaction owner and the
server-effective v2_review retained-replay call path, plus focused tests,
measurement instrumentation, the requested plan and narrow canonical
documentation. No schema, rollout, timeout budget, mobile/native capture or
scheduling behavior changed.

## Baseline reproduction

The baseline was run before the transaction-owner change with the existing
synthetic seven-day 860-observation fixture against the task-owned loopback
PostgreSQL 17.11 / PostGIS 3.6 database at port 54323. The forbidden default
54322 service and hosted credentials were not used.

The baseline replay produced 56 stays, 28 commutes, 28 Review items, zero
entries and 840 lineage links. Stored/semantic fingerprint:

    79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3

Ordered lineage hash:

    2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899

The ordered non-configuration business-query hash for the normal replay was:

    c0981c2acc8349d725bb559362453c21c2435b3b5718552b68b356d222af1895

The finite 85 ms baseline attempt ended with the existing operation timeout in
the effect path after rollback-safe partial work. It left lineage unchanged.
Its business-query hash was:

    bd744ca5b2e391410ea4fd78e54c69fdd1eb4668c1b53f30f302416ead0b8192

## Implementation

withSyncTransaction now has an explicit opt-in that tracks only the exact
3,000 ms / 1,500 ms full-cap pair installed by BEGIN. It skips the redundant
guard query only while the pair remains known and the remaining budget still
supports both caps. Near the deadline it uses the existing parameterised
set_config path.

The opt-in is set only when retained replay resolves to server-effective
v2_review. Evidence ingest, v2_shadow, v2_enabled, Health, Review and generic
transaction callers remain on the baseline path. Savepoint recovery,
parameterised or textual timeout-setting SQL, SET/RESET and other uncertain
configuration paths invalidate the cache. Existing cancellation, isolation,
rollback and release behavior remains owner-controlled.

## Raw-driver measurements

Counts include every call observed at the injected raw pg driver boundary,
including timeout configuration and transaction setup. Artificial delay is
test-only and is applied before each driver call. Values are finite single
runs, not p95 or hosted latency claims.

| Profile | Before ms / calls / timeout-config calls | After ms / calls / timeout-config calls | Result |
| --- | ---: | ---: | --- |
| Upload 1 | 16 / 13 / 5 | 14 / 13 / 5 | PASS |
| Upload 25 | 8 / 13 / 5 | 7 / 13 / 5 | PASS |
| Upload 100 | 13 / 13 / 5 | 10 / 13 / 5 | PASS |
| Upload 100 + 20 ms/call | 324 / 13 / 5 | 319 / 13 / 5 | PASS |
| Upload 100 + 40 ms/call | 584 / 13 / 5 | 595 / 13 / 5 | PASS |
| Replay 860, no delay | 206 / 69 / 33 | 201 / 37 / 1 | PASS |
| Replay 860 + 20 ms/call | 1,834 / 67 / 32 | 1,143 / 36 / 1 | PASS |
| Replay 860 + 40 ms/call | 3,196 / 67 / 32 | 1,821 / 36 / 1 | PASS |
| Replay 860, finite 85 ms | 87 / 46 / 22 | 88 / 47 / 22 | PASS: bounded timeout/rollback in both |

The normal replay removes 32 raw driver calls, all but the BEGIN-installed
timeout configuration call. The delayed profiles remove 31 raw calls and 31
timeout-configuration round trips. The finite near-deadline profile does not
reuse the pair: both runs make 22 timeout-configuration calls and terminate
with the existing bounded operation-timeout behavior. One raw-call difference
and a database-vs-JavaScript timeout race are timing details at the 85 ms
boundary; neither run reaches semantic commit, and lineage is unchanged.

The after normal/20 ms/40 ms business-query hashes are respectively:

    c0981c2acc8349d725bb559362453c21c2435b3b5718552b68b356d222af1895
    aaecdab48d497c83717dc160e074063758af08f3d1d32426c0a428a197381fa5
    aaecdab48d497c83717dc160e074063758af08f3d1d32426c0a428a197381fa5

They match the corresponding baseline streams. The finite 85 ms hash also
matches its baseline.

## Validation ledger

Focused web transaction/Location tests: PASS, 20 tests.

Web typecheck: PASS.

Real local validate:location-reliability: PASS. It covered the existing
v2_review upload/replay profiles, output/lineage fingerprints, protected and
terminal rows, isolation, rollback, contention and the finite 85 ms profile.

Real local validate:sync-transactions: PASS. Real local
validate:location-v2-db: PASS.

Final broad pass:

- `npm run lint` — PASS; documentation/iOS-config checks passed, with two existing
  unused-variable warnings in event-service.test.ts.
- `npm run typecheck` — FAIL only at the baseline mobile
  ConnectivityStatusStrip.tsx expo-symbols TS2307; web and shared passed. The
  source/package comparison against origin/main is unchanged.
- `npm run test` — PASS; mobile 1,236, web 951 passed with 3 skipped, shared 285.
- `npm run build` — PASS; web production build completed.
- git diff --check: PASS.

CI/Vercel polling, hosted replay, staging promotion, production access, iOS or
TestFlight build/install, physical-device acceptance, live replay, Claude,
merge and automatic-mode activation: NOT RUN BY CODEX.

The attached Downloads document was a different saved-place-detection-quality
plan. This implementation follows the explicit PR #202 Location Replay
Performance request and records that distinction in the handoff.

## Post-merge reconciliation

PR #202 was approved at exact head
`51fafed06ca66cfede8d01972c97e9e3b0152bd7` and merged to main as
`c72cba498805bf80ba683239610a7b50a7109825`. Claude approved the exact head;
GitHub Documentation alignment, Review/Location validation and Vercel checks
passed. The exact Preview deployment
`dpl_73JkSMeVZLS4WBVTp4ubpGVg7dzb` was promoted to staging, which remained
`v2_review`.

The hosted staging observation recorded five HTTP 200 replays with materially
improved headroom. A fresh controlled same-input replay also completed in
5,049 ms with 1,954 ms remaining at commit. The authoritative before/after
comparison passed: no unexpected time entries, receipts or events were created,
and no unexplained Review or segment loss was observed. One eligible evidence
row expired naturally during the check. Four later Location-derived time
entries were traced to explicit user Quick Confirm actions, not automatic
logging.

The historical 17-item Review comparison remains unreconstructed. This evidence
does not establish production deployment or production performance, and does
not claim that missing-return capture or the saved-place/PureGym arrival and
boundary issue is fixed.
