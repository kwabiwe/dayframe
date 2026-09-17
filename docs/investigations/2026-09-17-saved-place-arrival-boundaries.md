# Saved-place arrival and boundary quality V1 implementation ledger

## Identity, source facts and scope

- The supplied document title and ID were verified as **Dayframe — Saved-place arrival and boundary quality V1** / `DF-SAVED-ARRIVAL-BOUNDARY-V1`. It explicitly distinguishes this work from PR #199's saved-place dwell plan and PR #202's replay-performance plan.
- Fresh `origin/main` was fetched at `63d61d83013331457b8c4ff4b5243ed9e418ac0d`. The implementation branch is `fix/saved-place-arrival-boundaries` in the isolated worktree `/Users/major/Projects/dayframe-saved-place-arrival-boundaries`. Other worktrees, including TestFlight work, were not changed.
- The copied plan is `docs/plans/saved-place-arrival-boundaries-v1.md`; only Markdown hard-break whitespace was normalized, with its instructions and document ID unchanged. This ledger covers implementation and local validation through Section 16 only. Sections 17–18, hosted/staging preparation and physical acceptance were not executed.
- The plan reports that the historical gym item is already confirmed. Its private trace was not inspected in this job, and no private account, device, route or raw Location evidence was copied or committed. The confirmation-protection check below uses fresh synthetic database rows.
- Documentation impact is required for product inference behaviour, replay data flow and regression evidence. PRD, Location-learning guidance, architecture, regression checklist, tracker and this investigation were updated; no UI/motion contract was needed for a shared-engine/server/test-only change.

## Baseline reproduction

The fixture uses invented place names/coordinates, fixed synthetic IDs and UTC timestamps chosen to represent the reported shape. It is not a reconstruction of the private trace. Its less-precise Visit uses a chosen `120m` accuracy, not an observed private value.

Before the implementation, the accepted broad Visit remained skipped by the existing state machine. The exact synthetic output was:

| Segment | Baseline result |
| --- | --- |
| Origin stay `stay_1elw5rk` | `10:50:00Z–11:06:00Z`, `medium_high`, `uncertain_gap` |
| Inbound `commute_c3l2gv` | `11:06:00Z–12:21:00Z`, `low`, `uncertain_gap`, route IDs `route-out-1/2/3`, maximum gap `3060s` |
| Target stay `stay_15r0u1h` | `12:21:00Z–12:33:30Z`, `medium_high`, `broken_by_other_place`, `later-strong-1/2/3` |
| Return commute `commute_1k87347` | `12:33:30Z–12:41:00Z`, `medium`, `continuous`, route IDs `route-back-1/2`, maximum gap `180s` |

The baseline focused run retained the existing saved-place suite and showed the two new arrival/boundary contract assertions failing as expected. No historical row was used to make the baseline pass.

## Implemented decisions

- Added a replay-local pure helper in `packages/shared/src/location/savedPlaceArrivalSupport.ts`. A finite accepted same-device Visit is eligible only when `65m < accuracy <= 200m`, its ordered departure is finite and no later than `processingAt`, its interval meets the unchanged `300_000ms` saved-place dwell floor, the saved match is unambiguous, two distinct strong standard/significant points corroborate the first `300_000ms`, and a later independent strong cluster spans the existing dwell near departure. Simulated, ambiguous, competing-place, moving/outside and unresolved-exit evidence vetoes support.
- Added only the dedicated config values `savedPlaceArrivalCorroborationWindowMs = 300_000`, `savedPlaceArrivalMinimumStrongPointCount = 2` and `savedArrivalWitnessMinimumSpanMs = 120_000`. Existing `65m` high-quality, `200m` acceptance, five-minute dwell, twelve-minute continuity, thirty-minute point-only bridge, finalisation and retention values were not changed.
- Integrated support at the original Visit occurrence in the existing occurrence-ordered segmenter. The broad Visit remains excluded from centre, speed and sample-count calculations. Actual point/callback/Visit IDs are retained in deterministic lineage; inferred start/stop bounds are `[Visit arrival, earliest early strong point]` and `[last compatible strong point, Visit departure]`. Later inside evidence reopens normal reconciliation rather than freezing an old Visit end.
- Added the narrow fallback witness in commute derivation. It suppresses only a different-saved-destination commute that spans a two-minute-to-five-minute stationary early witness without credible intervening away evidence. It does not create a stay, fabricate travel, shorten an endpoint or reject unrelated long travel. Commutes touching an inferred boundary carry low confidence through an ephemeral internal set, leaving the existing automatic-policy table unchanged.
- Added shared synthetic tests, mobile complete-journal/SQLite parity, and real local Postgres replay tests. The server fixture covers atomic rollback, actual endpoint/lineage IDs, Review fields, account ownership and a separately seeded confirmed historical gym/commute with exact receipt replay. No schema, native capture, scheduling, rollout, retention, policy, SQL timeout, or #202 implementation changed.

## Synthetic before/after outcomes

| Case | Before | After |
| --- | --- | --- |
| Full corroborated Visit | Target began `12:21:00Z`; inbound ended `12:21:00Z` with a `3060s` gap | Target `stay_mm4c1o` is `11:32:51Z–12:34:53Z`, `medium`, `uncertain_gap`; bounds are `11:32:51Z–11:33:30Z` and `12:31:00Z–12:34:53Z`; lineage is `arrival-visit`, `arrival-geofence-enter`, `arrival-strong-1/2`, `later-strong-1/2/3` |
| Corrected inbound | `commute_c3l2gv`, `11:06:00Z–12:21:00Z`, low/uncertain, route `route-out-1/2/3` | `commute_1ikr3w8`, `11:06:00Z–11:32:51Z`, low/uncertain, route sample count `3`, maximum gap `600s`, same actual route IDs; the broad Visit coordinate is not a route sample |
| Return after full support | `12:33:30Z–12:41:00Z`, medium/continuous | `12:34:53Z–12:41:00Z`, low/uncertain, route IDs `route-back-1/2`, maximum gap `180s` |
| Insufficient-support fallback | Same late target stay plus the spanning inbound commute | Late target remains `12:21:00Z–12:33:30Z`; the conflicting inbound commute is omitted; return remains `12:33:30Z–12:41:00Z`, medium/continuous |

## Validation ledger

- PASS — shared focused tests: 100 tests across saved-place quality, arrival/boundary and automatic-policy suites; shared typecheck PASS.
- PASS — mobile `store.sqlite.test.ts`: 19 tests, including full and fallback complete-journal snapshots equal to `runLocationEngine`; journal, upload outbox and other-account state remain unchanged.
- PASS — `npm run validate:location-v2-db`: full local PostgreSQL/PostGIS validator, including the new synthetic full/fallback/history/receipt fixture, rollback and existing Location V2 coverage.
- PASS — `npm run validate:location-v2-sqlite`: WAL, idempotency, offline outbox, retry, isolation, retention, rollback, restart and contention coverage.
- PASS — `npm run validate:review-mutation-db`: unchanged receipt replay, meaningful proposal-change rejection, terminal decision and owner-isolation coverage.
- PASS — `npm run validate:sync-transactions`: existing transaction-local guard, abort, idle-expiry and cumulative-budget checks.
- PASS — `npm run validate:location-reliability`: the existing seven-day 860-observation #202 workload retained 56 stays, 28 commutes, 28 Reviews, zero entries, 840 lineage links, lineage hash `2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899` and segment/semantic hash `79008808b7458bde476a813ec5ba3419e2c692dd01121351dca894c27ca5a1e3`. The finite 85 ms case still timed out and rolled back as designed.
- PASS — five warmed shared-engine runs over the committed finite 1,040-row/20-episode arrival-rich fixture: exact-base median `18ms`, head median `27ms`, a `9ms` absolute increase below the plan's `50ms` regression trigger. This is a local synthetic CPU comparison, not hosted latency or p95 evidence.
- PASS — broad `npm run lint`: documentation and iOS-config checks passed; only the two existing unused-variable warnings in `apps/web/src/lib/event-service.test.ts` remained.
- FAIL — broad `npm run typecheck`: the unchanged mobile `src/components/ConnectivityStatusStrip.tsx:27` `expo-symbols` TS2307 remains. A clean copy of the exact base produces the same failure; independent web and shared typechecks PASS. No dependency repair or suppression was attempted.
- PASS — broad `npm run test`: mobile 1,238 passed; web 951 passed with 3 existing skips; shared 304 passed. Total: 2,493 passed and 3 skipped.
- PASS — broad `npm run build`: Next.js web production build completed. `npm run check:docs` and `git diff --check` passed.

The local database commands used only the verified task-owned loopback PostgreSQL 17.11/PostGIS 3.6 `_test` environment. No hosted credentials or private trace was used.

## Not run and limitations

- Final commit hash/head is recorded in the draft-PR handoff after commit; the verified implementation base is the SHA above.
- CI observation/polling, Claude invocation, Vercel build/preview, hosted replay, staging promotion, signed iOS build/install, physical iPhone validation, TestFlight, production action, merge and release claims are **NOT RUN by Codex**.
- Sections 17–18 of the supplied plan were not executed. The historical confirmed gym was not repaired or overwritten; only the fresh synthetic unconfirmed episode was corrected.
- The private incident's exact accuracy, complete point inventory, native delivery history and physical boundaries remain unknown. The chosen synthetic `120m` Visit demonstrates the authorised rule, not exact private-trace reproduction.
