# PR #213 residual Location lifecycle corrections — 30 September 2026

Status: narrow follow-up on the existing draft `codex/location-capture-ownership` branch, departing head `046d840a20321f5840deae8caae9bd357c93f4cd`. Fresh remote main/base was verified as `f42543eae397074a02e586140d3d748882da7ff1`; remote PR head matched. No rebase, new PR or #212 change.

Claude's saved report records **APPROVE for 046d840**, with R-1, R-2 and R-3 rated Nice-to-have. This correction follows the owner's later request to fix those residuals. It does not rewrite that historical verdict or establish independent approval of the new commit. The prior four Important fixes and their evidence remain in the [review-fix note](2026-09-30-location-capture-ownership-review-fixes.md); the [original implementation note](2026-09-30-location-capture-ownership.md) preserves the plan and S1–S6 history.

## Actual materials read

Required materials were available. The complete residual brief, complete report, original plan/reproduction and decision addenda were read; the actual rereview probe sources and their logged observations/results/errors were inspected. Probe logs are evidence, not regression assertions or device acceptance. The brief's separate OpenClaw housekeeping and later acceptance sections are outside this implementation request; no Claude scratch export, report or private probe was modified.

The full filename/line-count/SHA-256/inspection manifest is `/Users/major/Library/Application Support/dayframe-location-quality/pr213-residual-lifecycle-2026-09-30-codex/actual-materials-read.json`. Exact filenames follow; the two tables below are relative only to the explicitly named evidence directory.

- `/Users/major/Downloads/dayframe-pr213-residual-lifecycle-fixes-2026-09-30.md` — 110 lines; SHA-256 `4429ac044c6a4ef9e86ae9accc6d71c78af96de731af2695069e83b5151d03e2`.
- `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/REVIEW-pr213-046d840a20321f5840deae8caae9bd357c93f4cd.md` — 293 lines; SHA-256 `53806760dcbfc28cda3555c5d1ed931ccd662702960638e10353f4065125042d`.
- `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/FIRST-FIX-PLAN-location-capture-ownership.md` — 184 lines; SHA-256 `e843169d1432b4132be35ec1cb114aac022285cbf0c782f724212aa5da7f2077`.
- `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/probes/ownership.repro.test.ts` — 181 lines; SHA-256 `512827f78722749da9bc143214f81a5629bbe79f73a8c5adebd4b79bc00f5922`.
- `/Users/major/.codex/attachments/e753719d-084e-4262-a0c9-9b7f2c02e447/dayframe-location-capture-ownership-implementation.md` — 159 lines; SHA-256 `b054222e36860ea439d14d591c06b35b57b5287a99d5106fb017e347f399483d`.
- `/Users/major/.codex/attachments/9e3017ee-2b0a-46d5-8f99-97634cd2c20b/dayframe-pr213-review-fixes-2026-09-30.md` — 115 lines; SHA-256 `eca69711c546e27f1ddf0ae860498cb79e89319b6045dccfe3612a4a125c3e54`.

Rereview directory: `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/rereview-046d840a20321f5840deae8caae9bd357c93f4cd`.

| Actual probe source | SHA-256 |
| --- | --- |
| `probes/README.md` | `1f09c9504ac78b6ed87a57e78809eb5088d940bcc28208dd6ed3fe374d67ab19` |
| `probes/base-lib-zz-base-reviewresidue.probe.test.ts` | `af10e82e5828969a03240b4ddacaf2d679ce71f9dccf947fb30cc684b7462652` |
| `probes/head-lib-zz-rr-reviewresidue.probe.test.ts` | `0dbbaf6e6571a4ff3c1f420ec1c1386afea1653223fd4a96430323dcda88ccff` |
| `probes/head-lib-zz-rr-semantic.probe.test.ts` | `e7a2cf7bc9f60bd36063acf4e278537e6494fd4a17458ae264ba81df89b54c13` |
| `probes/head-lib-zz-rr-session.probe.test.ts` | `cc0b63471951f10301dc8d3aa31e33f50175449c72735b00dc221ce1af4938d9` |
| `probes/head-location-zz-rr-consent.probe.test.ts` | `f15a984d045b611479f55aa83eef39b0be7857239872dc524a4789ad7f9e5350` |
| `probes/head-location-zz-rr-upgrade.probe.test.ts` | `2d285506ffa106209fb50a46cc23bba90ce8f7e2cbaec6cd492c42f177c5ea4d` |
| `probes/prev-lib-zz-prev-b11.probe.test.ts` | `464104df9a748496e63f07c2a5a239f21e0b52be04e2861515a30eaea67e95d8` |

| Actual log inspected (OBS/check/error summaries) | SHA-256 |
| --- | --- |
| `logs/base-zz-base-reviewresidue.probe.log` | `154fbbfe878acff4ead08cba0f748989e5ec45d60e16dc34b71a8802d422f7ee` |
| `logs/newhead-all-probes-one-run.log` | `4a14da551f527f5103911898d75dd7f590bc41fd152f5ac12c3c2bce2ba060cb` |
| `logs/newhead-check-docs.log` | `50104d392347c8bc0f3202144bba9d2dea5ecc39f855fa1a43bd4c908694c3e9` |
| `logs/newhead-eradication-contract-evaluated.log` | `1bc249e7405790addb256ac6999fbc9f088ea67300869fa51522b8800e3da0b4` |
| `logs/newhead-focused-21-files.log` | `c4458d48f2261f48b902b644a65939d2647c56083ad730c4156f7a3c56f5b196` |
| `logs/newhead-focused-9-files.log` | `64768b5668cf2f624e67109f3834ee435ae232b65a0b6a4c87cd8b23c55ae073` |
| `logs/newhead-mobile-full-suite.log` | `675a56852e4c0d86d12785f1b0f066efc78a2d2371b5456e68896219a2ba87c6` |
| `logs/newhead-mobile-tsc.log` | `f873d95f5c5473ed6c48d3e86b85919da55cdab0221e6aadb662d074b292568f` |
| `logs/newhead-pr-ownership-and-session.log` | `4a2c308badf0f87d38be6f177b24835962ea9c57cac6c36da7ac3c0a8fcdc161` |
| `logs/newhead-prior-zz-e2e.probe.log` | `f3a5c5e5f39f1a54e5a318fe35890d2a3d2f4b2b8b2360330f05b05d62c995a4` |
| `logs/newhead-prior-zz-fourth.probe.log` | `70a2c0d8c2e26fe0e52480b315edd3183f1cf7030d9d633c9329cd09ca514509` |
| `logs/newhead-prior-zz-fuzz.probe.log` | `2170519f42ed1ec274c201f5e9def788037a83e3ba31c3d4340b82543964ad0e` |
| `logs/newhead-prior-zz-review.probe.log` | `efb8e1560b70d4477be1df34a33d0bff238a653b19b79b1927e8b3cef97e4a87` |
| `logs/newhead-prior-zz-third.probe.log` | `d0fb877b8ef960f22da80ef674612f1779a7eb7636aef1f83abc1fbbc8f73f64` |
| `logs/newhead-zz-rr-consent.probe.log` | `cc13e859227d49c03191a6713cbba02d606aac343ee6b6aa80a54b058cc76dcb` |
| `logs/newhead-zz-rr-reviewresidue.probe.log` | `36cf497023abf8069b2342002404afa888da15bcc909db1091c5c18df1edf22d` |
| `logs/newhead-zz-rr-semantic.probe.log` | `5bf6f34aa35fcc669d188c94e43f56d89e5262309c4eb673023473dcbdaa84f6` |
| `logs/newhead-zz-rr-session.probe.log` | `c324a8d748ae4e8dc34296f9f05065260af52b16860ae02fee7ffefb4306b88d` |
| `logs/newhead-zz-rr-upgrade.probe.log` | `a8f09552d31f6102d1ae0fd9ea65ae6ce1b98ca545b13a46eb39ab91d309c725` |
| `logs/prevhead-zz-prev-b11.probe.log` | `244a588f98fdf24d28008bf77c319e0e7abbd5c3e306dcf5db2657d2744a4e6d` |

Repository reads included `AGENTS.md`, documentation governance, the applicable PRD/architecture/tracker, hosting context, Location/permission/validation references and regression checklist; both earlier investigation notes; real `api.ts` bootstrap/login/logout, `mobileAccount.ts`, `secure-session.ts`, `mobileSessionTransition.ts`, Dashboard load/refreshLocationServices and Settings load/logout callers; Location runtime/task/store/consent paths and the real API/SQLite and ownership harnesses. The authority modules remain unchanged.

## Reproduction and corrections

The two relevant saved head probes were copied unchanged into this worktree and run before production edits: **24/24 observational probes passed**, while B4/B4b recorded old-A reactivation/residue, B11 recorded preference `true` after both logout and real 401, and A4/A4b recorded all three OS sources still running after durable off. Six explicit assertions ported to the existing real API/session/account/runtime/SQLite harness then **failed on 046d840**: two final-deactivation cases, two lost-opt-out cases and two interrupted-off/restart cases. Their failures establish the regressions; the all-green observational result alone does not.

| Residual | Correction through existing owners | Regression evidence |
| --- | --- | --- |
| R-1 final logout race | The actual `fetchBootstrap` caller checks the existing logout fence before owner binding/account activation and rechecks the session around activation. The fence consults the departing secure-session generation through final account-removal I/O, independently of that removal's transient account state. No second authentication authority, session-authority change, sleep or repeated owner deletion. | Final AsyncStorage removal forced with deterministic gates; screen/no-screen/legacy ownerless-token variants; real Review projection cannot repopulate; genuine B/new-A replacement during removal still bootstraps/captures. No-binding logout and existing storage/OS failure controls remain. |
| R-2 lost off intent | An already authorised backend/account-scoped off decision is written in the lifecycle lane before obsolete capture work can be skipped. Logout/401 cannot cancel that decision. Later authorised on writes in the same serial lane and wins. Failed persistence rejects the toggle and disables the applicable binding; ordinary bootstrap cannot enable it from the previous stored preference. | Busy-lane off overtaken by real logout/401; A returns off without an opt-in; original evidence survives only the involuntary case. B consent/capture isolation, newer A opt-in ordering, stale A screen rejection and preference-write failure/explicit retry. |
| R-3 skipped OS teardown | Nested finalisation attempts OS stop/clear despite a later local SQLite failure. Off/disabled learning or geofence callbacks and bootstrap reconcile through the existing lane while keeping owned evidence/context/cutover. Start operations cannot overtake an applicable old stop. OS failures remain counted and explicit opt-out rejects incomplete cleanup. | Off saved then local SQLite failure or real 401; callback-only cold/headless recovery and bootstrap-only recovery; actual failed OS stop with diagnostic and callback retry; in-flight A stop versus genuine B/new-A login and enable. Accepted work, cutover and no new off-era evidence asserted. |

The five saved head probe files were also run unchanged against corrected source: 46 probes, including generated real client requests through unchanged server rollout/cutover functions and eight randomized upgrade/consent/OS-source/acknowledgement seeds. Combined with the then-current nine regression suites: **14 files / 293 tests passed**. Updated B4/B11/A4 logs show no residue/restart/running monitors. Three final OS-lane/bootstrap controls were added afterwards; the final focused run is **9 files / 250 tests passed**. There are 19 added regression cases in the existing session SQLite harness. S1–S6, same-owner refresh, offline/headless capture, accepted-owner involuntary retention and semantic cutover coverage remain passing.

Logs are under `/Users/major/Library/Application Support/dayframe-location-quality/pr213-residual-lifecycle-2026-09-30-codex/`: `old-head-actual-probes.log`, `old-head-regression-assertions.log`, `focused-first-fix.log`, `focused-ordering-failures.log`, `focused-mobile-typecheck.log`, `focused-compatibility.log`, `focused-final-regressions.log`. The first invocation used a nonexistent workspace-local Vitest entry; the existing npm workspace script corrected that runner path. The first fix run's two remaining failures were the fixture's retry/backoff batch lookup, corrected with the existing forced-retry option without weakening ownership assertions. Five verified copied probes were removed before the broad pass; no generated probes or logs are committed.

## Documentation and validation

Documentation impact: runtime ownership/mobile lifecycle guardrails and missing race assertions. Canonical architecture, product consent requirements, Location/permission references, regression checklist, validation matrix and tracker are updated. There is no layout, presentation or motion change. The current retention/privacy wording and runtime are preserved.

Dependency links resolve `@dayframe/shared` to this worktree's `packages/shared/src/index.ts` and mobile/web workspace packages to this worktree. External dependencies reuse the existing installation; Node is v24.21.0, Vitest 4.1.9 and mobile TypeScript 6.0.3. `expo-symbols` remains an undeclared direct mobile dependency resolving from `/Users/major/Projects/dayframe/node_modules/expo-symbols/build/index.js`. No install/dependency repair or clean-install/native bundling claim.

One final broad pass, after all production/test changes, ran full mobile tests, root lint (docs/iOS configuration checks included), applicable workspace typechecks and diff hygiene. Web/shared production code is unchanged, so their full suites and unrelated SQL/DB/scalability validators are not repeated. The saved generated-client/server-helper probes cover the unchanged semantic integration.

| Final command/check | Result |
| --- | --- |
| Focused real API/runtime/SQLite/lifecycle tests | PASS — 9 files / 250 tests |
| `npm run test -w @dayframe/mobile` | PASS — 142 files / 1,320 tests; real Git checkout contract included |
| `npm run lint` | PASS — docs (153 Markdown files), iOS configuration and web ESLint; 2 existing unused-parameter warnings in unchanged web tests |
| `npm run typecheck` | PASS — mobile, web and shared |
| Final `npm run check:docs`, diff/status/scope inspection | PASS — 153 Markdown files; clean diff, only the intended client/tests/docs; primary checkout clean at its original SHA |

## Limits and deferred work

Synthetic OS/network/storage doubles, Node scheduling and real `node:sqlite` are not CoreLocation/Expo/SecureStore/Hermes or physical-device evidence. Forced windows prove these interleavings, not their frequency in production. Process termination or an OS failure cannot guarantee immediate source removal; off evidence admission stays closed and callback/bootstrap reconciliation is tested. The existing general timeout/hung OS-lane and auth-recovery items (R-4), raw upload/context bounded expiry, timezone batching, speculative server batch handling and independent exact-head review/device acceptance remain separate.

NOT RUN: web/shared full test suites; clean install or dependency repair; any web/mobile/native/Swift/Pods/simulator build, native bundling or physical test; hosted replay/data, staging/configuration/aliases, migrations, PostGIS/scalability/SQL validators, reviewer invocation, CI/Vercel polling, merge, production or TestFlight. No segmentation, threshold, Core Motion, rollout-policy, native, schema or #212 change. Stop after commit/push of the existing draft PR.
