# EVENING-A strong-evidence short journeys

Plan DF-LQ-EVENING-A-V1.1. Independent branch `agent/evening-a-short-journeys`, base `d641e5daf5402087d280cc6de19adca57b91691c`. Main was freshly fetched before worktree creation. PR #207 and #208 were read once for identity, not changed. No branches were combined. Implementation is pending independent review and later exact-head staging/signed-device acceptance, not shipped.

## Before-fix evidence

Before editing runtime code, an external diagnostic used the exact base source and the test-only `shortJourneysFixture`: arbitrary equatorial coordinates, synthetic IDs and January 2026 dates. It retained three existing-rule stays, including a ten-minute unknown destination, and produced zero commutes. Candidate windows were exactly 84,496ms and 81,000ms, each with three accurate faster samples and 1,000.756m endpoint displacement. Calling the unchanged displacement qualifier separately passed both. Bypassing only the duration setting in diagnostic code yielded IDs `commute_tjgxd3` and `commute_oil8sz`, original bounds and low confidence. That instrumentation is not application code.

The diagnostic harness initially needed two harness-only corrections (required prior state and `segmentUpserts` output name); the final before-edit assertions passed. No real locations or owner identifiers are included here.

## Narrow policy change

Existing stays and strict candidate windows remain authoritative. A positive short candidate must have distinct endpoints, existing significant displacement and three independent accurate non-simulated faster GPS observations. Proof is invocation-local and reused; ordinary summaries, confidence, identities, ordering, arrival witnesses and maximum duration remain intact. Actual start/stop duration guards automatic logging with `short_journey_review_only`; rounded display seconds are not used. Mobile adds only compatible reason copy, not presentation or motion changes.

### Identity and source limitations

Expo capture IDs contain device/kind/source milliseconds, with `sourceTimestamp` and simulation state. Native significant-change IDs hash kind, second-resolution occurrence and coordinates, but its bridge omits speed, source timestamp and simulation status. Existing preprocessing deduplicates device/ID only; source kind and timestamp precision can therefore preserve mirrors. Exception-only device/ID, parsed source-time and exact device/coordinate deduplication prevents those mirrors from adding independent proof without time buckets or a new capture identity. Identical coordinates at different times conservatively add no proof. Explicit non-simulated provenance is required: current native callbacks alone cannot qualify. This is a limitation, not a capture fix or proof of actual device performance.

Native speed takes existing precedence over implied speed. All sources in the exception are checked against the existing 120m/s plausibility ceiling; implied proof additionally needs the real preceding coordinate point to be accurate, non-simulated GPS from the same device. A broad/Visit/simulated predecessor cannot manufacture a qualifying speed. Existing ordinary-duration handling is unchanged.

## Validation evidence

- Focused shared tests: 91 passed, including A, threshold edges, native/implied speed, duplicates/mirrors, invalid/simulated/unknown-provenance samples, retained Home, unknown endpoint, finalisation, confidence, and separate B/C failure signatures.
- Disposable local PostgreSQL 17.11 / PostGIS 3.6.4 at loopback port 54323, fresh `dayframe_evening_a_test`; ordered local migrations/seed applied. No hosted credentials or data used.
- New database validator: 17 scenarios passed. Saved/saved with logging enabled, disabled-home saved/unknown, review/enabled/shadow modes, pre-cutover silence, actual event/Review linkage and ordered persisted evidence joins, exact retries and no automatic short-trip entries. Confirm, explicit ignore and manual edit/confirm preserve decisions, entries, receipts and commute lineage through same-input and changed-catalogue/changed-ID replay.
- Initial validator drafts used generic rather than Location-specific mutation names; corrected to the real Location API. A strict snapshot also exposed existing enabled-mode event relinking refreshing commute `updated_at`. Source confirmed that maintenance-only write; comparisons exclude only that field, not decision/entry/receipt/lineage data. No persistence implementation change was made.
- Existing `validate:location-v2-db`: passed, including arrival, protected-history, rollback, concurrency, ordinary automation and deletion protections.
- Complete base/candidate outputs match for the existing acceptance fixture, 4,256-observation retained-journal fixture and failure-preserving B/C fixtures. B still omits the short remote stays and emits the long round trip; C still chooses the sole saved area. Neither is fixed or treated as acceptable venue certainty.
- CPU benchmark (15 alternating measurements after warm-up): seven-day full engine median 88.3ms base / 89.0ms candidate; 112 newly eligible short pairs among 1,008 evidence rows / 168 stays: derivation median 1.77ms base / 3.76ms candidate. Local wall time is noisy and does not prove hosted budget or physical acceptance.
- Finite local scalability validator: 13/13 runner cases passed. S1 worst request-model duration 5,183ms, minimum remaining work budget 1,817ms. Larger S3 at 100ms artificial per-call delay completed in 6,902ms with only 98ms headroom: the runner passes its S3 correctness assertions, but this does **not** meet the separate 5,500ms/1,500ms hosted target. No deadline, batch or performance tuning was made.
- One final broad pass: lint passed (two existing unused-variable warnings in unchanged `event-service.test.ts`); web/shared typechecks passed; aggregate typecheck **failed** only on mobile's missing `expo-symbols` import. An exact-base mobile-source check with the same installed dependencies reproduces that error. Baseline harness setup first needed the mobile TypeScript binary and a missing test-fixture file; the final baseline result has only the same `expo-symbols` failure. No dependency fix included.
- Workspace tests: mobile 1,238 passed; shared 341 passed; web 957 passed, 1 timed-out Calendar DOM test, 3 skipped. Thus the aggregate test command **failed**, not all-green. The unchanged Calendar file's focused rerun passed all 9 tests without changing deadlines or expectations. No second broad pass was run.
- Web production build, docs alignment and `git diff --check` passed. The two new validation scripts also passed a temporary no-emit TypeScript configuration extending the web configuration; the temporary config was removed. No native app build ran.

## Commands

All commands ran in the independent worktree. Database commands used the explicit loopback `_test` URL, never environment-file fallback.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test -w @dayframe/shared -- --run test/short-journeys.test.ts test/commute-timestamps.test.ts test/automatic-policy.test.ts
npm run db:setup
npx tsx scripts/validate-location-short-journeys.ts
npm run validate:location-v2-db
npx tsx scripts/benchmark-location-short-journeys.ts --base-root=/private/tmp/dayframe-evening-a-base
npx tsx scripts/validate-location-replay-scalability.ts
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:docs
git diff --check
npm run test -w @dayframe/web -- --run src/components/calendarClickCreate.dom.test.tsx
npm run typecheck --prefix /private/tmp/dayframe-evening-a-base/apps/mobile
npx tsc --noEmit -p tsconfig.short-journeys.validation.json
```

The base archive was created with `git archive` from the exact verified base, not an unmerged branch. Test-only fixtures are not exported from a runtime barrel. No schema, dependency, native capture, matching, stay formation, outbox, rollout configuration or acknowledgement changes are included.

## Acceptance and NOT RUN

No reviewer invocation, CI/Vercel polling, staging alias assignment, hosted replay, Simulator/signed app build, physical test, merge or production action. C20 is not required for this change: no SQL shape, lock or transaction owner changes; existing DB concurrency checks ran, but no new concurrency claim is made. Native builds and hosted timing are distinct later gates, not inferred from local results.

Newly eligible retained observations after the unchanged semantic cutover can create Review on a later ordinary replay; this code does not limit eligibility to captures after deployment. Existing retention and terminal/manual protections remain. PR #208's partial acceptance remains separate. B, C and afternoon Review retirement remain outside this implementation.

## Changed files and ownership

- Shared runtime: `packages/shared/src/location/commute.ts`, `automaticPolicy.ts` (eligibility and automatic-policy guard only).
- Mobile compatibility: `apps/mobile/src/lib/review.ts`, `review.test.ts` (reason text only).
- Shared tests: `packages/shared/test/short-journeys.test.ts`, `test/fixtures/shortJourneys.ts`, `test/fixtures/eveningBaseline.ts`.
- Local validators: `scripts/validate-location-short-journeys.ts`, `scripts/benchmark-location-short-journeys.ts`.
- Documentation: PRD, canonical feature tracker, regression checklist, Location reference, validation matrix and this synthetic evidence note. Documentation impact is product eligibility/guardrails; no runtime ownership or schema change.

The worktree is `/Users/major/Projects/dayframe-evening-a`. Validation logs and the exact-base archive remain outside the repository under `/private/tmp/dayframe-evening-a-*`. The task-owned local PostgreSQL cluster is stopped after checks. No other worktree, service or private evidence was modified.
