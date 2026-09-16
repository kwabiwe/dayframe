# Saved-place detection quality V1

## Provenance and scope

- Base and fresh main: `5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a`; no intervening commits on the authorised resume.
- Existing isolated worktree/branch: `dayframe-saved-place-quality`, `fix/saved-place-detection-quality`. The three previously preserved files were verified before resuming.
- Sections 1–11 of [the supplied plan](../plans/saved-place-detection-quality-v1.md) only. Section 12 remains later work.
- Documentation impact: product behavior, existing replay/snapshot ownership and a missing protection guardrail. PRD, architecture, Location guidance, regression checklist and tracker were updated for PR #199. This post-merge reconciliation updates the tracker, investigation and stale roadmap status without starting Stage C or Today UX work.

## Synthetic baseline reproduction

`packages/shared/test/saved-place-quality.test.ts` uses generic synthetic coordinates and identifiers. Only timings derive from the supplied incident summary. It contains no private route, account identifiers, or exported data. The incident summary does not establish complete absence of unrelated accepted observations, exact building entry, or exact physical departure.

Before behavior edits, the three focused assertions failed as expected:

| Assertion | Baseline result |
| --- | --- |
| No sub-five-minute Visit-backed fragment | FAIL: emitted `11:55:29Z–11:56:09Z`, 40 seconds, `uncertain_gap`, `medium_high` |
| Compatible Visit continuity survives a lone exit | FAIL: three stays instead of one |
| Strong same-place endpoints bridge 26m38s silence | FAIL: two stays instead of one |

This confirms the completed-Visit dwell waiver and immediate-exit/ordinary-gap segmentation hypotheses. The reproduction does not supply route observations and makes no commute or exact physical endpoint claim.

## Historical setup stops and authorised resume

The first session stopped after `npm ci` exhausted disk space and the one recovery attempt was consumed. Local Docker-backed Postgres then failed with `global/pg_filenode.map: Input/output error`. Experimental behavior edits were removed, preserving the plan, baseline tests and investigation. The next readiness check encountered the same database error plus an Xcode licence blocker; it made no changes. Those historical attempts are not acceptance evidence.

On 16 September the owner supplied `/private/tmp/dayframe-saved-place-db.env` for a separately repaired instance. Each Postgres command sources that file and checks `DATABASE_URL` for exactly `127.0.0.1`, port `54323`, and a database ending `_test`. Connection and PostGIS verification passed: PostgreSQL 17.11, PostGIS 3.6. The ordered existing six local migrations and seed completed against the disposable database. The old port 54322 instance was not used, Docker was not started, and no hosted environment was sourced. Dependencies were already usable on this resume; no dependency update was made.

## Implemented decisions

- Known saved/accepted-learned dwell is at least `300_000ms` of effective supported attendance. Completed Visit support is clipped to the resolved episode; neither a short Visit elsewhere in its history, an inferred midpoint, registration callbacks nor elapsed processing time can waive the floor. Both semantic emitters apply the same finite-window defense before database work.
- A same-place exit stays ephemeral/pending. Strong re-entry within `300_000ms`, or compatible finite Visit-supported re-entry, cancels chatter. Real other-place/outside corroboration closes the episode. A lone unsupported exit expires on ordinary processing into bounded uncertainty capped at medium, with the existing ten-minute finalisation lag.
- Strong distinct same-saved-ID endpoints can bridge at most `1_800_000ms`; confidence remains medium and continuity uncertain without interval support. Credible intervening evidence blocks that exception. Finite same-device Visit support can bridge longer quiet intervals but is clipped to a later independently supported episode after a real departure.
- Unknown/learned gap rules, commute qualification, matching radii, algorithm version, rollout/cutover, queues and native capture remain unchanged. The engine fails closed on a mixed-device journal.
- Bounded exact source-lineage reads hold changed-ID replacements of protected decisions rather than stretching historical entries. A shared Visit cannot block a later separate episode. Obsolete open sources become superseded atomically; manual open corrections are excluded from retirement. The new real-database fixture exposed that prior manual-open retirement gap and now protects it.
- Complete successful account-journal replay replaces local derived snapshots in the state transaction, including empty output. Journal, uploads, Review work and other accounts remain untouched; injected failure rolls back pruning.

## Synthetic expected and actual outcomes

| Fixture | Expected / actual |
| --- | --- |
| Chatter plus completed Visit | PASS: one stay `11:55:29Z–12:46:44Z`; no 40-second fragment |
| Synthetic corroborated parking departure | PASS: earlier fragment filtered, one later stay `11:58:52Z–12:46:44Z` |
| 26m38s point-supported gap | PASS: one open evidence-supported stay, uncertain/medium; no fabricated end |
| Earlier synthetic outside departure | PASS: Visit endpoint clipped within genuine last-inside/outside bounds, not labelled exact |
| Unsupported lone exit | PASS: no split before grace; stable bounded medium fallback after grace and ordinary finalisation |
| Old open fragments | PASS: three historical sources retire to one replacement; repeat replay does not duplicate |
| Accepted/ignored/manual changed identity | PASS: held competing replacement; original fields, entries, receipts and lineage unchanged |
| Later episode sharing a long Visit | PASS: still emitted after corroborated departure despite the protected earlier fragment |
| Confirmed adjacent commute and Quick Confirm | PASS: changed client identity preserves resolved journey and lineage; next unchanged content hash confirms once |
| SQLite parity and rollback | PASS: current shared output equals the local snapshot; empty output clears only current-account snapshots; failure restores state/snapshots |

The incident-only synthetic fixture intentionally supplies no commute route. Existing route-backed nearby-place, round-trip and exact-departure fixtures remain active and pass. No exact physical building entry/departure or missing return was inferred.

Two existing fixture expectations needed explicit adjustment for the requested policy: the single-sample return fixture now supplies a five-minute supporting observation while retaining its A→B→A assertions; the 19-minute saved-place silence fixture now retains that legitimate extra stay while preserving all commute endpoints/sample assertions. The original three baseline regressions were preserved; their helpers were extracted unchanged into a shared synthetic fixture for server/mobile parity.

## Specialist validation and performance

All specialist commands ran once near handoff; development iterations used only the affected fixture.

- PASS: `validate:location-v2-db`, including synthetic convergence, protected changed identities, receipts/lineage, rollback, shadow/cutover, existing local automatic-policy, scoping and contention coverage.
- PASS: `validate:location-v2-sqlite` and 17 focused real-SQLite store tests.
- PASS: `validate:review-mutation-db`, including two sequential unchanged Quick Confirms, genuine-change rejection and confirmed changed-ID commute protection.
- PASS: `validate:location-reliability`: unchanged 860 observations, 56 stays, 28 commutes, 28 reviews, zero entries, 840 lineage links. No golden hashes changed: lineage `2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899`; segment/semantic `79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3`.

| Replay profile | Prior recorded #197 ms / calls | This run ms / calls | Result |
| --- | --- | --- | --- |
| Normal first replay | 123 / 53 | 140 / 69 | PASS |
| 20ms per-call repeat | 1,323 / 51 | 1,692 / 67 | PASS |
| 40ms per-call repeat | 2,380 / 51 | 3,089 / 67 | PASS |

The extra 16 driver calls are bounded provenance reads, not per-segment writes. The 250-row write/lineage batching and deadlines remain intact. Semantic calls remain 17 initially/15 on repeat; lineage remains 10. Upload 1/25/100 uses 13 calls at 11/6/10ms; 100-item upload at 20/40ms delay passed at 303/578ms. The comparison uses previously recorded #197 measurements, not a new baseline run; synthetic timings are not hosted latency. A final narrow supported-dwell edge-case correction affects known places only; this unchanged unknown-place reliability workload is unaffected.

## Final broad validation

The single broad pass completed with explicit guarded local database configuration and dev auth. Final focused shared coverage passed 121 tests across saved-place, Location V2 and automatic policy.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run lint` | PASS | Includes documentation/iOS-config checks; two unchanged unused-variable warnings in `event-service.test.ts` |
| `npm run typecheck` | FAIL — baseline dependency | New optional-stop argument errors were repaired and a focused web check passed. The one allowed broad typecheck rerun reports only mobile `ConnectivityStatusStrip.tsx:27` TS2307 for `expo-symbols`; web/shared pass |
| `npm run test` | PASS | 2,456 passed, three existing skips: mobile 1,236; web 936; shared 284 |
| `npm run build` | PASS | Next.js production build; no native build |
| Diff/status review | Completed before commit | Only the scoped files below; no generated screenshots, database exports or secrets |

A final review also added a focused registration/overlapping-region callback case: contextual callbacks must not split a quiet saved stay before the next real observation. The final focused shared suite and saved-place Postgres fixture passed after that correction; successful broad commands were not repeated. The supplied plan's Markdown hard breaks were normalized without changing its instructions.

The baseline attribution was checked on this checkout: `ConnectivityStatusStrip.tsx`, mobile `package.json` and `package-lock.json` match base exactly, the base imports `expo-symbols` at line 27, and resolution fails in the unchanged installed dependency tree. No unrelated dependency repair or further broad rerun was attempted.

## Changed files

- `.codex/reference/location-learning.md`
- `apps/mobile/src/lib/location/store.ts`
- `apps/mobile/src/lib/location/store.sqlite.test.ts`
- `apps/web/src/lib/location/location-ingest-service.ts`
- `apps/web/src/lib/location/location-replay-service.ts`
- `apps/web/src/lib/location/location-review-semantic-batch.ts`
- `packages/shared/src/location/config.ts`
- `packages/shared/src/location/segmenter.ts`
- `packages/shared/src/location/savedPlaceQualityFixture.ts`
- `packages/shared/test/location-v2.test.ts`
- `packages/shared/test/saved-place-quality.test.ts`
- `scripts/validate-location-v2-db.ts`
- `scripts/fixtures/location-saved-place-quality.ts`
- `scripts/fixtures/location-quick-confirm.ts`
- `scripts/fixtures/location-review-semantics.ts`
- `docs/PRD.md`
- `docs/architecture.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- `docs/plans/saved-place-detection-quality-v1.md`
- `docs/investigations/2026-09-15-saved-place-detection-quality.md`

## Post-merge reconciliation

PR #199 merged at `9f9c421a6d3f7e2d9ff2bb54c4e354da2e7174d1` from final approved head `28de5e9a700a44c8d8f6f0194cac91cf764425e7`. Independent review was **APPROVE**: Claude Opus 5 at low reasoning approved the exact final head. GitHub Review/Location validation and Documentation alignment passed. The exact-head signed staging build/install/launch passed. Current owner-reported physical acceptance so far passed ordinary Location commute behaviour, quick Location entries, Quick Confirm, and general staging use.

The remaining multi-day saved-place soak is a post-merge Watch observation: sub-five-minute saved-place crossing, sustained PureGym-style visit, parking-boundary chatter, and later A→B→A return behaviour. These cases are not claimed as passed. Replay latency remains Watch, and missing-return capture remains a separate follow-up. Production provenance remains the previously established source `5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a` with effective mode `v2_shadow`; production `v2_review` is an explicit operational follow-up and is not claimed active. No production `v2_enabled` rollout is claimed.

## Not run and later acceptance

CI/Vercel polling, real-account replay, production access, rollout changes, hosted automatic-mode activation, and native/Simulator build are NOT RUN. No migration, dependency update or infrastructure repair is part of this PR. The exact-head signed staging build/install/launch and current owner physical acceptance above do not cover the remaining multi-day soak. A draft PR is not physical acceptance or release approval.
