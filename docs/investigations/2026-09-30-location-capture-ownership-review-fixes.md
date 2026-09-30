# PR #213 Location capture ownership review fixes — 30 September 2026

Status: correction of the existing draft PR, from `39c1ed84d5ddce78d5e0626d1fb11e0729676117` on `codex/location-capture-ownership`. Base and fresh remote main were verified as `f42543eae397074a02e586140d3d748882da7ff1`. No rebase, new PR, #212 work or acceptance/release claim.

## Actual materials read

All required private materials were available and read in full. The report/probes are evidence, and the addenda supplement the owner's explicit request; their later independent-review/device workflow does not authorise this job to invoke a reviewer or perform hosted/device work. No raw Location data or private audit report is copied into Git.

| Actual file | Lines | SHA-256 |
| --- | --- | --- |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/REVIEW-pr213-39c1ed84d5ddce78d5e0626d1fb11e0729676117.md` | 264 | `0d57d03102c63ba67d92ccfe96feb39fdfa11e142a39e31d5a3489efd60b1c91` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/README.md` | 22 | `2f3a939c9f1ff3186c4f2cfe16efb8668eb6fc867d530170dc3df1249baff6de` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/base-location-zz-base-tz.probe.test.ts` | 143 | `2aac0e37715e2471824b0e90d5a1814c5bfb474607b2ec1181a776df530fd53a` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/base-location-zz-base.probe.test.ts` | 160 | `4f726dd2e0d5c6a1091182ad40fec1fab821b1350cf8d61881c94b9fba1e8f88` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/head-lib-zz-e2e.probe.test.ts` | 301 | `b80ec259392ead121199109b68f191018f3081b13626753568989aa751d7f185` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/head-location-zz-fourth.probe.test.ts` | 197 | `75533ae81124dafb7e5c77d57f24533fced619789bd9ff73489a3c4338402b2c` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/head-location-zz-fuzz.probe.test.ts` | 241 | `3979d4b3817933f114f0d39172fa7b5b0430a761133976607f8f204c3954e377` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/head-location-zz-review.probe.test.ts` | 555 | `32e1c9147de417ee5e08048fdcf545139ea2a5a8be168b48942213163c6d9d08` |
| `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/probes/head-location-zz-third.probe.test.ts` | 205 | `d8bca2ef15d1a9b911d0ec0f66d297fdcb4b2a792597005165f743426320903b` |
| `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/FIRST-FIX-PLAN-location-capture-ownership.md` | 184 | `e843169d1432b4132be35ec1cb114aac022285cbf0c782f724212aa5da7f2077` |
| `/Users/major/.codex/attachments/e753719d-084e-4262-a0c9-9b7f2c02e447/dayframe-location-capture-ownership-implementation.md` | 159 | `b054222e36860ea439d14d591c06b35b57b5287a99d5106fb017e347f399483d` |
| `/Users/major/.codex/attachments/9e3017ee-2b0a-46d5-8f99-97634cd2c20b/dayframe-pr213-review-fixes-2026-09-30.md` | 115 | `eca69711c546e27f1ddf0ae860498cb79e89319b6045dccfe3612a4a125c3e54` |

The original implementation note records the unchanged saved S1–S6 reproduction (`architecture-audit-2026-09-29-claude/probes/ownership.repro.test.ts`) and original exact-base run. Repository authorities read in this correction include `AGENTS.md`, documentation governance, the affected PRD/architecture/tracker, Location and permission references, regression checklist, applicable validation and motion sections, and the original implementation note. Source reads cover the real API/logout/login, secure-session, mobileAccount/publication, Location runtime/store/task/cache paths, SQLite/lifecycle tests, and the unchanged server `location-rollout.ts` decision and segment-cutover filter.

## Reproduction and source resolution

Before changes, a scratch `git archive` of exact old head `39c1ed84d5ddce78d5e0626d1fb11e0729676117` ran Claude's five head probe files unchanged. Result: 43 tests, 37 passing, six expected failures (P1, P1b, P2, P6, E3, E4). P1b used the actual Dashboard configure-then-refresh sequence held only at native drain. It restarted geofencing/admitted a row while scoped consent was false. E3 retained journal/outbox/context after opt-out then real logout. E4 recreated capture/evidence while the logout request awaited. P6 left a newer same-A bind suspended. Observational P4/P4b/P23 exposed acknowledgement reset; P3/P3b showed raw outbox bodies and context surviving journal expiry. These are synthetic software reproductions, not production disclosure or physical acceptance.

Probe P0's shared source stack resolved inside the scratch export. Worktree `@dayframe/shared`, `@dayframe/mobile` and `@dayframe/web` links were independently verified to resolve to this existing worktree, not the primary checkout. External packages use the reused installation. Logs/manifests remain outside Git under `/Users/major/Library/Application Support/dayframe-location-quality/pr213-review-fixes-2026-09-30-codex/`. The primary checkout and paused #212 were not edited.

## Fix-to-test map

| Finding | Implementation | Evidence |
| --- | --- | --- |
| I-1 consent | Catalogue refresh performs an update of the exact live owner/binding/revision only; it cannot configure, acknowledge a mode, enable capture or lift suspension. Scoped local consent is rechecked at task/start/admission/commit boundaries. Opt-out keeps a disabled binding/context for accepted work. | Real task/runtime/SQLite P1/P1b races, no restarted sources or geofence/Expo/native admission while off, independent preference/transaction veto and later legitimate opt-in in `location/ownership.sqlite.test.ts`. |
| I-2 explicit logout | The existing API captures owner/session before awaits, using the bound session owner when the capture owner is already absent and rejecting contradictory authorities. A narrow fence consults that authority for the whole logout; all binds are blocked for that signing-out lifetime. Deletion targets the captured owner even without binding, rechecks generation/session before SQLite commit, and rolls back if superseded. OS/store failures reject logout; no success is claimed and admission remains closed until retry/replacement. Conditional shared-owner deactivation precedes token clearing, so old completion cannot deactivate a newer same-A session. Concurrent opt-out honours consent without superseding logout deletion. | Real API/session/account/runtime/SQLite E1/E3/E4/E6, no-binding/idempotence, opt-out during deletion, B/new-A transaction and network interleavings, storage/native failure/retry, E2 real 401 retain/resume and E5 offline/503 controls in `locationSession.sqlite.test.ts`. P6 cancelled same-owner teardown is covered in ownership tests. |
| I-3 semantic cutover | Backend/account-scoped metadata stores the existing semantic eligibility separately from capture lifetime. Temporary bind setup restores known state; explicit logout deletes that owner's projection. Only compatible, attributable legacy state restores an acknowledgement; invalid/foreign-owner/backend state is not guessed. Bootstrap/upload/replay retain actual mode transitions. A frozen old shadow request cannot reset a known current semantic acknowledgement. | Real shared engine produces finalized retained stays; generated upload bodies go through unchanged server `decideLocationRollout`/`segmentStartedAfterSemanticCutover` across involuntary invalidation, opt-out and attributable upgrade. Eligible retained stay survives; shadow stay remains excluded. A/B, logout reset, ambiguous upgrade and actual bootstrap mode changes are tested. Real API upload-401/relogin generates replay values through the same server functions. Real upload/replay response mode transitions/restoration are covered in `store.sqlite.test.ts`. |
| I-4 retention wording | Canonical PRD/architecture/Location/permission references, checklist and Settings copy distinguish journal expiry from upload copies and retained contexts; login/upload are not purges. The tracker has a separate bounded-expiry/deletion follow-up. Retention runtime is unchanged. | Real SQLite tests expire journal rows after 40 days while queued and successfully acknowledged raw upload bodies/context remain. These characterize the disclosed gap, not an implemented expiry guarantee. |

Original S1–S6 and offline/headless restart, same-owner refresh, A→B→A, old regions, Visit/source times, native drain/clear, diagnostics cache and SQLite rollback protections remain in the existing ownership harness. Timer, Review and Health policies and authority modules are unchanged; full mobile regression coverage is part of the final pass.

## Privacy boundary and deferred work

Journal rows expire after seven days when existing cleanup runs. Queued/batched upload bodies, including acknowledged bodies, and engine/account/segment context can retain coordinates beyond that window. Login and successful upload do not purge those bodies. Explicit logout removes all five owner-local stores and exposed caches. Delete recent evidence removes the local journal, outbox and engine state, but account/segment context remains. Consent preferences remain owner-scoped. Server history is not deleted by logout.

Included directly related Nice-to-haves: N1 activation before hydration, N3 disabled context/diagnostics/backlog, N4 consent-aware status and privacy wording, N6 cancelled same-owner logout recovery, N7 real API/runtime/SQLite integration, and N8 documentation of shared headless deactivation/validator scope. Local cleanup failures have explicit errors and retry coverage (the directly relevant portion of N2).

Deferred: general OS-operation timeout/hang redesign and broader auth error recovery (N2); conservative loss of ambiguous/inactive legacy device consent (N5); the crash window between secure-session clearing and asynchronous involuntary-sign-out teardown (N8); timezone capture/batch mismatch (N9); dependency repair; raw outbox/context bounded expiry; and the speculative foreign/deleted-place server batch fix. No segmentation, thresholds, Core Motion, rollout policy, schema/migration, server-runtime, native Swift or hosted work is included. An ambiguous legacy acknowledgement is dropped; a later real mode acknowledgement establishes a new cutover rather than inventing/backdating one.

## Copy and motion impact

Settings changes are text/status only, within its existing layouts and native Alerts. There is no new navigation, gesture or animation owner. The initial logout warning's native Alert contract remains: cancellation has no mutation, repeated confirm uses the existing guard, failure stays in the existing alert path, and Reduce Motion/focus/VoiceOver belong to that native presentation. Phone width, Dynamic Type, VoiceOver and physical Alert acceptance are NOT RUN under this job's build/device prohibition.

## Validation

The final focused command passed all 226 tests in eight lifecycle/API/SQLite/session/source-contract files. Focused tests also caught a timestamp-validator source mismatch: the refined batch schema has no object shape; validation now uses the existing replay-request timestamp schema. Earlier focused failures included test-fixture corrections (explicit scoped consent for isolated V1 classifier fixtures, ten-minute segment finalisation, distinct places for separate retained stays, and a valid acknowledgement response). They were corrected without loosening the ownership/cutover assertions.

One final broad pass ran the commands below after source changes were complete. All three commands passed; no broad suite was repeated. Database/hosted opt-in environment variables were removed from the runner. The three existing gated web tests remained skipped.

| Command/check | Result |
| --- | --- |
| Focused Vitest lifecycle/API/SQLite/session/source contracts | PASS — 8 files / 226 tests, including all S1–S6 controls |
| `npm run validate:location-v2-sqlite` | PASS — scratch SQL WAL, schema idempotency, duplicates, partial retry, account isolation, journal retention, rollback, restart and contention; not application-lifecycle proof |
| `npm run test` | PASS — mobile 142 files / 1,301 tests; web 139 files / 970 tests, 2 files / 3 tests skipped; shared 24 files / 367 tests |
| `npm run typecheck` | PASS — mobile, web and shared |
| `npm run lint` | PASS — docs (152 Markdown files) and iOS configuration checks included; 2 existing unused-parameter warnings in unchanged web tests |
| Final `npm run check:docs`, staged `git diff --check` and full base/head scope inspection | PASS — docs 152 Markdown files, clean diff; full base/head file scope inspected before commit/push; no build, reviewer or hosted acceptance implied |

The existing `expo-symbols` limitation remains. `ConnectivityStatusStrip.tsx` imports it without a direct mobile dependency; resolution here uses `/Users/major/Projects/dayframe/node_modules/expo-symbols/build/index.js` from the reused installation. Clean-install resolution and native bundling are unverified. No dependency repair, install or native acceptance is claimed. Node is `v24.21.0`; Vitest resolves the reused `4.1.9` installation. The SQL validator exercises its scratch SQLite script, not application lifecycle; real application transaction/lifecycle evidence comes from the tests above.

NOT RUN: all web/native/Swift/Pods/simulator builds; physical signed-staging/mobile overlay/accessibility acceptance; hosted replay/data/staging/aliases; disposable PostGIS/scalability checks and server batch investigation; migrations, reviewer invocation, CI/Vercel polling, merge, rollout, production and TestFlight. A separate authorised job must establish independent review and physical acceptance.
