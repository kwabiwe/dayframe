# PR #213 failed-operation recovery — 30 September 2026

Scope: the owner's two requested recovery corrections on the existing draft PR, starting at `574951580867fcad4613d232ec1c865e3a3b8486`, with base `f42543eae397074a02e586140d3d748882da7ff1`. No new PR or change to #212. The supplied recovery brief/report are supporting material; earlier broad implementation/build instructions do not expand this request.

Claude's saved report approves the exact starting head and rates these observations N-1/N-2 Nice-to-have. That historical verdict is preserved. This implementation does not establish independent approval of its new head.

## Recovery and Settings motion contract

The existing Settings permission/refresh action becomes **Retry capture** when this owner's consent is saved but effective capture is inactive. It calls the existing explicit-enable path. The switch continues to represent stored consent; adjacent copy separately states inactive capture or unresolved logout cleanup. No new row, overlay, conditional control, spinner or navigation is added.

Trigger: failed/interrupted activation, subsequent diagnostics refresh, or explicit Retry capture. The existing native Switch and Pressable own control feedback; React owns inline text/status updates, and the existing native Alert owns error presentation. No control enters or exits. Text may wrap/change height with Dynamic Type under the established Settings layout/scroll owner; no conditional row or global animation is introduced. Rapid opposite actions follow the existing Location serial lane and generation checks; stale activation cannot report on after off, logout or a replacement lifetime. No optimistic capture success is shown. Failure preserves actual consent and refreshes effective diagnostics; retry stays in Settings. There is no timer, Undo or dismissal change. Reduce Motion preserves immediate semantic updates with no added travel; VoiceOver keeps the same switch/button and receives the revised capture status/hint. Native interaction, text reflow, Dynamic Type, VoiceOver and Reduce Motion acceptance are NOT RUN in this job.

## Evidence and checks

All required materials were available. The complete recovery brief/report, original decision addendum/residual brief and original plan/reproduction were read. All three actual rereview probe sources and their README were read in full; actual logs were inspected for O-1/O-2 observations and check/error/result summaries. No private report, probe or Claude scratch export was changed.

The exact filename/line-count/full SHA-256/inspection manifest is `/Users/major/Library/Application Support/dayframe-location-quality/pr213-recovery-2026-09-30-codex/actual-materials-read.json`. Required sources read in full:


- `/Users/major/.codex/attachments/9a8fd143-eafa-46e5-a788-d1dfaaccb342/dayframe-pr213-recovery-follow-up-2026-09-30.md` — 117 lines; SHA-256 `3b06d7416391c57af77e4b797c33e780fa166737d1b66a5f43e2d891065f63e5`.
- `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/REVIEW-pr213-574951580867fcad4613d232ec1c865e3a3b8486.md` — 262 lines; SHA-256 `0e3d0e0ba2103dbec6fa4a40b428a70fb31afddd8e6f524cb51f49ec0d63e84a`.
- `/Users/major/.codex/attachments/e753719d-084e-4262-a0c9-9b7f2c02e447/dayframe-location-capture-ownership-implementation.md` — 159 lines; SHA-256 `b054222e36860ea439d14d591c06b35b57b5287a99d5106fb017e347f399483d`.
- `/Users/major/Downloads/dayframe-pr213-residual-lifecycle-fixes-2026-09-30.md` — 110 lines; SHA-256 `4429ac044c6a4ef9e86ae9accc6d71c78af96de731af2695069e83b5151d03e2`.
- `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/FIRST-FIX-PLAN-location-capture-ownership.md` — 184 lines; SHA-256 `e843169d1432b4132be35ec1cb114aac022285cbf0c782f724212aa5da7f2077`.
- `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/probes/ownership.repro.test.ts` — 181 lines; SHA-256 `512827f78722749da9bc143214f81a5629bbe79f73a8c5adebd4b79bc00f5922`.

Actual rereview directory: `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-claude-review/rereview-574951580867fcad4613d232ec1c865e3a3b8486`.

| Probe read in full (relative to that directory) | SHA-256 |
| --- | --- |
| `probes/README.md` | `807f74489ff332f12da25ab525ce3bb0d22e43944b0dfe8c3229255f1a1b3ed5` |
| `probes/zz-r3-contract.probe.test.ts` | `69f35443aff03a635eefd5bd433004983be50d06acd528a1558f403636d634a6` |
| `probes/zz-r3-controls.probe.test.ts` | `3ccdb516faf3c91d6b178163dd0114537471d965ec4387bde7cade0781015905` |
| `probes/zz-r3-fuzz.probe.test.ts` | `b79117fade53afeee31c1bb87fc050e3861f7f7f6ab91f8767169ad26af979e9` |

Actual logs inspected under that directory (observations/check/error summaries):

- `logs/h046-fuzz3-invariant-breakdown.log`
- `logs/h046-implementer-new-tests.log`
- `logs/h046-r3-probes-final.log`
- `logs/new-carried-probes-unchanged.log`
- `logs/new-check-docs.log`
- `logs/new-eradication-contract-evaluated.log`
- `logs/new-focused-9-files.log`
- `logs/new-fuzz3-extra-24-seeds.log`
- `logs/new-mobile-full-suite.log`
- `logs/new-mobile-tsc.log`
- `logs/new-r3-probes-final.log`

Repository reads covered AGENTS, documentation governance, applicable architecture/PRD/tracker/permissions/Location/validation/brand/motion guidance, the residual investigation and PR template, real API bootstrap/logout, Dashboard/Settings application callers, and the existing account/runtime/store/test paths. The manifest labels section reads separately from complete private materials.

## Reproduction and implementation

Two byte-identical Claude O-1/O-2 probes ran at `5749515` before production edits. They passed observationally while recording blocked fresh bootstrap and saved true/disabled binding/stopped sources respectively. Twelve explicit assertions ported into the existing real API/session/account/runtime/SQLite harness then produced **10 failures and 2 passing replacement controls** at the old head. Four further interrupted-start controls cover logout, real 401, B and genuine newer A. The final harness contains 16 added cases, 51 total.

| Requested correction | Result and preservation |
| --- | --- |
| Failed logout (N-1) | API request gating ends when logout settles; the existing capture cleanup/admission fence remains. A retained request cancellation revision rejects pre-/during-logout responses after failure. Fresh current-session Dashboard/Settings bootstrap works, but configuration/callbacks cannot restart capture or accept new rows. Both SQLite rollback and native cleanup failure are covered, with legacy tokens and real Review projection. Filling a legacy owner at the same token/generation cannot release cleanup. Retry completes deletion. Newer B/A and final removal controls remain passing. |
| Interrupted opt-in (N-2) | Diagnostics separate scoped stored consent from the live enabled binding/admission, permissions and learning registration. Settings keeps the consent switch truthful, shows inactive capture, refreshes diagnostics on error and reuses its existing action as explicit Retry capture. Enable completion rechecks current capture/consent after OS awaits; Settings also uses the current effective projection instead of replaying old on copy. Disabled bindings remain disabled through bootstrap/restart. Consent is not erased; explicit retry works without an off/on cycle. Later off, logout, real 401 and replacement B/newer A cannot receive a stale on success or late stop. |

The final focused compatibility run passed **12 files / 318 tests**: nine existing suites (266 tests) and the three saved probes unchanged (52 tests, including eight randomized real-API seeds). S1–S6, R-1/R-2/R-3, offline/headless restart, same-owner refresh, original-owner involuntary retention, semantic acknowledgement and generated requests through the unchanged real server rollout/cutover helpers remain covered. After strengthening forced-window assertions and the final Settings projection edit, the 51 real session/SQLite tests were run again and passed. No general Nice-to-have sweep or source attribution change.

Private implementation logs: `old-head-actual-recovery-probes.log`, `old-head-recovery-assertions.log`, `focused-first-recovery.log`, `focused-recovery-and-carried-probes.log`, `focused-mobile-typecheck.log`, `focused-source-mobile-typecheck.log`, `focused-final-source-regressions.log`, under `/Users/major/Library/Application Support/dayframe-location-quality/pr213-recovery-2026-09-30-codex/`. The first focused correction run had four fixture failures because a realistic OS-start check was applied to older cases that clear their call log; the realistic projection is now scoped to the recovery cases. The private fuzz probe has a TypeScript 6/Vitest `it.each` typing failure when copied into the compiler's source tree. All three copied probes were hash-verified and removed before final source checks; private originals remain unchanged. The source-only mobile typecheck passed. Initial probe logging needed `--disableConsoleIntercept` to retain its OBS output; no probe source was modified.

## Documentation impact and final validation

Affected durable recovery/Settings/error contracts are updated in architecture, PRD, Location/permission references, regression checklist, validation matrix and tracker. The new evidence record preserves the report's historical approval/severity. The journal-versus-retained-body privacy disclosure and expiry runtime are unchanged.

One final broad pass ran full mobile tests, root lint (including docs/iOS configuration checks), workspace typechecks and diff hygiene. Web/shared production is unchanged, so their full suites and unrelated SQL/DB/scalability validators are not repeated.

| Check | Result |
| --- | --- |
| Focused lifecycle/SQLite/source suites plus unchanged saved probes | PASS — 12 files / 318 tests |
| Final real session/SQLite recovery and preservation assertions | PASS — 51 tests |
| `npm run test -w @dayframe/mobile` | PASS — 142 files / 1,336 tests |
| `npm run typecheck` | PASS — mobile/web/shared |
| `npm run lint` | PASS — docs (154 Markdown files), iOS configuration and web ESLint; two existing unused-parameter warnings in unchanged web tests |
| Final docs/diff/status/scope inspection | PASS — final docs/diff hygiene; intended client/tests/docs only; primary checkout unchanged and clean |

Workspace links target this worktree's mobile/web/shared packages, including `@dayframe/shared` → this worktree's `packages/shared/src/index.ts`. External dependencies reuse the existing installation: Node 24.21.0, Vitest 4.1.9 and mobile TypeScript 6.0.3. `expo-symbols` remains an undeclared direct mobile dependency resolving from `/Users/major/Projects/dayframe/node_modules/expo-symbols/build/index.js`; this is not a clean-install or native-bundling claim and no dependency repair/install was performed.

## Limits and deferred work

The OS/network/storage edges are synthetic doubles; real `node:sqlite` transactions and Node scheduling are not Expo SQLite, Hermes, Keychain or CoreLocation/device evidence. Registered-learning status is observed app state, not proof of delivery or native background reliability. Process termination or persistent OS stop failure cannot guarantee immediate teardown; admission guards and existing reconciliation remain intact.

General R-4 auth/error/timeout/hung-lane recovery, raw upload/context expiry, native capture quality, timezone batching, the speculative server batch correction and other previously deferred work remain separate. No native/session-authority contract, server/shared/schema, retention-runtime, segmentation/threshold/radius, Core Motion/Health capture, rollout or #212 change.

NOT RUN: web/shared full test suites; clean install, dependency repair or native bundling; web/mobile/native/Swift/Pods/simulator builds; physical/device/UI motion, text reflow, VoiceOver, Dynamic Type or Reduce Motion acceptance; hosted replay/data, staging/configuration/aliases, migrations, SQL/PostGIS/scalability validators, reviewer invocation, CI/Vercel polling, merge, production or TestFlight. Commit/push the existing draft PR only, then stop.
